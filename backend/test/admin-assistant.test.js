const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { connectTestDb, resetDb, disconnectTestDb, app, registerUser } = require('./helpers');
const env = require('../src/config/env');
const User = require('../src/models/User');
const Video = require('../src/models/Video');
const assistant = require('../src/services/adminAssistant');
const { signToken } = require('../src/utils/tokens');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// Servidor falso del modelo. Responde por turnos: el primero puede pedir una
// herramienta, el siguiente devuelve texto. Así se ejercita el bucle real de
// function calling (petición, ejecución, vuelta del resultado) sin red externa.
function startFakeModel(turns) {
  return new Promise((resolve) => {
    const calls = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        calls.push(JSON.parse(body));
        const turn = turns[Math.min(calls.length - 1, turns.length - 1)];
        const message = typeof turn === 'function' ? turn(calls.length) : turn;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message }] }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        calls,
        close: () =>
          new Promise((done) => {
            // `fetch` reutiliza conexiones (keep-alive); sin cerrarlas, `close`
            // se queda esperando a que el cliente las suelte y el proceso no
            // termina.
            server.closeAllConnections();
            server.close(done);
          }),
      });
    });
  });
}

async function withModel(turns, run) {
  const fake = await startFakeModel(turns);
  const original = { key: env.assistantApiKey, base: env.assistantApiBase };
  env.assistantApiKey = 'test-key';
  env.assistantApiBase = fake.base;
  try {
    return await run(fake);
  } finally {
    env.assistantApiKey = original.key;
    env.assistantApiBase = original.base;
    await fake.close();
  }
}

async function makeAdmin() {
  return User.create({
    username: 'elidep',
    email: 'elidep@example.com',
    password: 'clave12345',
    role: 'admin',
  });
}

/* ------------------------------------------------------------------ */
/* Permisos                                                            */
/* ------------------------------------------------------------------ */

test('the assistant is closed to non-admin accounts', async () => {
  const agent = app();
  const reg = await registerUser(agent);
  const res = await agent
    .post('/api/admin/assistant')
    .set('Authorization', `Bearer ${reg.token}`)
    .send({ message: 'hola' });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test('the assistant requires a session', async () => {
  const agent = app();
  const res = await agent
    .post('/api/admin/assistant')
    .send({ message: 'hola' });
  assert.equal(res.status, 401, JSON.stringify(res.body));
});

test('without an api key the assistant reports it is not configured', async () => {
  const admin = await makeAdmin();
  const original = env.assistantApiKey;
  env.assistantApiKey = null;
  try {
    const res = await app()
      .post('/api/admin/assistant')
      .set('Authorization', `Bearer ${signToken(admin)}`)
      .send({ message: 'hola' });
    assert.equal(res.status, 503, JSON.stringify(res.body));
  } finally {
    env.assistantApiKey = original;
  }
});

test('an empty message is rejected', async () => {
  const admin = await makeAdmin();
  const res = await app()
    .post('/api/admin/assistant')
    .set('Authorization', `Bearer ${signToken(admin)}`)
    .send({ message: '' });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

/* ------------------------------------------------------------------ */
/* Conversación                                                        */
/* ------------------------------------------------------------------ */

test('a plain answer is returned without tools', async () => {
  const admin = await makeAdmin();
  await withModel([{ role: 'assistant', content: 'Hola, ¿en qué te ayudo?' }], async () => {
    const res = await app()
      .post('/api/admin/assistant')
      .set('Authorization', `Bearer ${signToken(admin)}`)
      .send({ message: 'hola' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.body.reply, /en qué te ayudo/);
    assert.equal(res.body.executed.length, 0);
  });
});

test('the model can search a user through a tool', async () => {
  const admin = await makeAdmin();
  await User.create({ username: 'buscame', email: 'buscame@example.com', password: 'clave12345' });

  await withModel(
    [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'buscar_usuario', arguments: JSON.stringify({ termino: 'buscame' }) },
          },
        ],
      },
      { role: 'assistant', content: 'Encontré a @buscame.' },
    ],
    async (fake) => {
      const res = await app()
        .post('/api/admin/assistant')
        .set('Authorization', `Bearer ${signToken(admin)}`)
        .send({ message: 'busca a buscame' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.executed[0].tool, 'buscar_usuario');
      assert.equal(res.body.executed[0].result.usuarios[0].username, 'buscame');
      // El segundo turno recibió el resultado de la herramienta.
      const secondTurn = fake.calls[1];
      const toolMsg = secondTurn.messages.find((m) => m.role === 'tool');
      assert.ok(toolMsg, 'debe reenviar el resultado como mensaje de herramienta');
      assert.match(toolMsg.content, /buscame/);
    }
  );
});

test('the model can approve a pending video', async () => {
  const admin = await makeAdmin();
  const video = await Video.create({
    title: 'pendiente',
    videoUrl: 'https://ejemplo.com/v.mp4',
    creator: admin._id,
    moderationStatus: 'pending',
  });

  await withModel(
    [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'aprobar_video', arguments: JSON.stringify({ id: video._id.toString() }) },
          },
        ],
      },
      { role: 'assistant', content: 'Vídeo aprobado.' },
    ],
    async () => {
      const res = await app()
        .post('/api/admin/assistant')
        .set('Authorization', `Bearer ${signToken(admin)}`)
        .send({ message: 'aprueba ese vídeo' });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const updated = await Video.findById(video._id);
      assert.equal(updated.moderationStatus, 'approved');
      assert.equal(updated.moderatedBy.toString(), admin._id.toString());
    }
  );
});

test('the model can credit coins and a ledger entry is written', async () => {
  const admin = await makeAdmin();
  const target = await User.create({
    username: 'premiado',
    email: 'premiado@example.com',
    password: 'clave12345',
  });
  const before = target.wallet.bonusC;

  await withModel(
    [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'acreditar_monedas',
              arguments: JSON.stringify({ id: target._id.toString(), cantidad: 500 }),
            },
          },
        ],
      },
      { role: 'assistant', content: 'Acreditadas 500 monedas.' },
    ],
    async () => {
      const res = await app()
        .post('/api/admin/assistant')
        .set('Authorization', `Bearer ${signToken(admin)}`)
        .send({ message: 'dale 500 monedas a premiado' });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const updated = await User.findById(target._id);
      assert.equal(updated.wallet.bonusC, before + 500);
    }
  );
});

/* ------------------------------------------------------------------ */
/* Herramientas directas                                               */
/* ------------------------------------------------------------------ */

test('aprobar_video reports a missing video instead of throwing', async () => {
  const admin = await makeAdmin();
  const result = await assistant.runTool('aprobar_video', {
    id: '64b000000000000000000000',
    adminId: admin._id,
  });
  assert.match(result.error, /no encontrado/i);
});

test('acreditar_monedas rejects a non-numeric amount', async () => {
  const admin = await makeAdmin();
  const result = await assistant.runTool('acreditar_monedas', {
    id: admin._id.toString(),
    cantidad: 'muchas',
    adminId: admin._id,
  });
  assert.match(result.error, /inválida/i);
});

test('an unknown tool is reported, not crashed on', async () => {
  const admin = await makeAdmin();
  const result = await assistant.runTool('hackear_la_nasa', { adminId: admin._id });
  assert.match(result.error, /desconocida/i);
});

test('the tool loop is bounded so a stuck model cannot hang the request', async () => {
  const admin = await makeAdmin();
  // El modelo pide la misma herramienta en todos los turnos. Sin tope, esto
  // sería un bucle infinito; con tope, corta y avisa.
  await withModel(
    [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_x',
            type: 'function',
            function: { name: 'estadisticas', arguments: '{}' },
          },
        ],
      },
    ],
    async (fake) => {
      const res = await app()
        .post('/api/admin/assistant')
        .set('Authorization', `Bearer ${signToken(admin)}`)
        .send({ message: 'bucle' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.match(res.body.reply, /demasiados pasos/i);
      assert.ok(fake.calls.length <= 6, `se hicieron ${fake.calls.length} llamadas`);
    }
  );
});

/* ------------------------------------------------------------------ */
/* Memoria de la conversación                                          */
/* ------------------------------------------------------------------ */

test('el historial se guarda y se recupera tras la recarga', async () => {
  const admin = await makeAdmin();
  await withModel([{ role: 'assistant', content: 'Hola, ¿en qué te ayudo?' }], async () => {
    await app()
      .post('/api/admin/assistant')
      .set('Authorization', `Bearer ${signToken(admin)}`)
      .send({ message: 'hola' });
  });

  // Un panel recién abierto pide el hilo: debe traer los dos turnos.
  const res = await app()
    .get('/api/admin/assistant')
    .set('Authorization', `Bearer ${signToken(admin)}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.messages.length, 2);
  assert.equal(res.body.messages[0].role, 'user');
  assert.equal(res.body.messages[0].content, 'hola');
  assert.equal(res.body.messages[1].role, 'assistant');
});

test('el segundo turno recibe la conversación anterior como contexto', async () => {
  const admin = await makeAdmin();
  await withModel(
    [
      { role: 'assistant', content: 'Anotado.' },
      { role: 'assistant', content: 'Seguimos donde lo dejamos.' },
    ],
    async (fake) => {
      await app()
        .post('/api/admin/assistant')
        .set('Authorization', `Bearer ${signToken(admin)}`)
        .send({ message: 'recuerda que estamos con los pagos' });
      await app()
        .post('/api/admin/assistant')
        .set('Authorization', `Bearer ${signToken(admin)}`)
        .send({ message: '¿dónde quedamos?' });

      // La segunda llamada al modelo debe llevar el turno anterior del usuario.
      const sent = fake.calls[1].messages.map((m) => m.content).join('\n');
      assert.match(sent, /recuerda que estamos con los pagos/);
      assert.match(sent, /dónde quedamos/);
    }
  );
});

test('limpiar borra el hilo guardado, no solo la pantalla', async () => {
  const admin = await makeAdmin();
  await withModel([{ role: 'assistant', content: 'Hola.' }], async () => {
    await app()
      .post('/api/admin/assistant')
      .set('Authorization', `Bearer ${signToken(admin)}`)
      .send({ message: 'hola' });
  });

  await app()
    .delete('/api/admin/assistant')
    .set('Authorization', `Bearer ${signToken(admin)}`);

  const res = await app()
    .get('/api/admin/assistant')
    .set('Authorization', `Bearer ${signToken(admin)}`);
  assert.equal(res.body.messages.length, 0);
});

test('el historial es de cada administrador, no compartido', async () => {
  const uno = await makeAdmin();
  const dos = await User.create({
    username: 'otroadmin',
    email: 'otro@example.com',
    password: 'clave12345',
    role: 'admin',
  });

  await withModel([{ role: 'assistant', content: 'Hola.' }], async () => {
    await app()
      .post('/api/admin/assistant')
      .set('Authorization', `Bearer ${signToken(uno)}`)
      .send({ message: 'soy el primero' });
  });

  const res = await app()
    .get('/api/admin/assistant')
    .set('Authorization', `Bearer ${signToken(dos)}`);
  assert.equal(res.body.messages.length, 0);
});

/* ------------------------------------------------------------------ */
/* Torneos de POKERTAK                                                 */
/* ------------------------------------------------------------------ */

test('el asistente puede organizar un torneo de POKERTAK', async () => {
  const admin = await makeAdmin();
  const Squad = require('../src/models/Squad');
  await Squad.create({
    name: 'Mesa del jefe',
    slug: 'mesa-jefe',
    owner: admin._id,
    visibility: 'public',
    voiceRoom: 'voice-jefe',
  });

  const when = new Date(Date.now() + 86400_000).toISOString();
  await withModel(
    [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_t1',
            type: 'function',
            function: {
              name: 'organizar_torneo_poker',
              arguments: JSON.stringify({
                titulo: 'Torneo del viernes',
                sala: 'mesa-jefe',
                fecha: when,
                entrada: 100,
                jugadores: 9,
              }),
            },
          },
        ],
      },
      { role: 'assistant', content: 'Torneo creado.' },
    ],
    async (fake) => {
      const res = await app()
        .post('/api/admin/assistant')
        .set('Authorization', `Bearer ${signToken(admin)}`)
        .send({ message: 'organiza un torneo el viernes' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.executed[0].tool, 'organizar_torneo_poker');
      assert.equal(res.body.executed[0].result.ok, true);
      // El reparto por defecto queda congelado en el torneo.
      assert.deepEqual(res.body.executed[0].result.torneo.split, [0.4, 0.3, 0.2]);
      assert.equal(res.body.executed[0].result.torneo.rakeRate, 0.1);
      // Con el aforo lleno: 900 de bruto, 810 de bote y 40/30/20.
      assert.deepEqual(
        res.body.executed[0].result.torneo.projectedPlaces.map((p) => p.amount),
        [360, 270, 180]
      );
      assert.ok(fake.calls.length >= 2);
    }
  );
});

test('el asistente informa del error si la sala del torneo no existe', async () => {
  const admin = await makeAdmin();
  await withModel(
    [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_t2',
            type: 'function',
            function: {
              name: 'organizar_torneo_poker',
              arguments: JSON.stringify({
                titulo: 'Torneo fantasma',
                sala: 'no-existe',
                fecha: new Date(Date.now() + 86400_000).toISOString(),
                entrada: 100,
                jugadores: 9,
              }),
            },
          },
        ],
      },
      { role: 'assistant', content: 'Esa sala no existe.' },
    ],
    async () => {
      const res = await app()
        .post('/api/admin/assistant')
        .set('Authorization', `Bearer ${signToken(admin)}`)
        .send({ message: 'organiza un torneo' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.match(res.body.executed[0].result.error, /No existe esa sala/);
    }
  );
});

/* ------------------------------------------------------------------ */
/* Compras de monedas y retiros                                        */
/* ------------------------------------------------------------------ */

const ManualOrder = require('../src/models/ManualOrder');
const walletService = require('../src/services/walletService');

// Crea una orden manual aprobada con su asiento, para que el resumen tenga algo
// que agregar. Va por el modelo y no por el endpoint porque aquí se prueba la
// lectura, no el cobro.
async function seedPurchase({ user, coins, priceUsd, status = 'approved', method = 'zinli' }) {
  return ManualOrder.create({
    user: user._id,
    packageId: 'starter',
    coins,
    priceUsd,
    method,
    reference: `REF-${Math.random().toString(36).slice(2, 10)}`,
    status,
  });
}

test('listar_pagos devuelve quién compró y con qué detalle', async () => {
  const admin = await makeAdmin();
  const buyer = await User.create({
    username: 'comprador',
    email: 'comprador@example.com',
    password: 'clave12345',
  });
  await seedPurchase({ user: buyer, coins: 500, priceUsd: 6.99 });

  const result = await assistant.runTool('listar_pagos', { adminId: admin._id });

  assert.equal(result.ordenes.length, 1);
  assert.equal(result.ordenes[0].usuario, 'comprador');
  assert.equal(result.ordenes[0].monedas, 500);
  assert.equal(result.ordenes[0].precioUsd, 6.99);
  assert.equal(result.ordenes[0].estado, 'approved');
});

test('listar_pagos filtra por estado y respeta el límite', async () => {
  const admin = await makeAdmin();
  const buyer = await User.create({
    username: 'comprador2',
    email: 'comprador2@example.com',
    password: 'clave12345',
  });
  await seedPurchase({ user: buyer, coins: 100, priceUsd: 1.99, status: 'pending' });
  await seedPurchase({ user: buyer, coins: 200, priceUsd: 2.99, status: 'approved' });

  const result = await assistant.runTool('listar_pagos', {
    estado: 'pending',
    limite: 5,
    adminId: admin._id,
  });

  assert.equal(result.ordenes.length, 1);
  assert.equal(result.ordenes[0].monedas, 100);
});

test('resumen_compras suma monedas, USD y lista compradores', async () => {
  const admin = await makeAdmin();
  const a = await User.create({ username: 'ana', email: 'ana@example.com', password: 'clave12345' });
  const b = await User.create({ username: 'bruno', email: 'bruno@example.com', password: 'clave12345' });
  await seedPurchase({ user: a, coins: 500, priceUsd: 6.99 });
  await seedPurchase({ user: b, coins: 1000, priceUsd: 12.99 });
  await seedPurchase({ user: b, coins: 100, priceUsd: 1.99, status: 'pending' });

  const result = await assistant.runTool('resumen_compras', { adminId: admin._id });

  assert.equal(result.ordenes, 3);
  assert.equal(result.monedas, 1600);
  assert.equal(result.usd, 21.97);
  // Solo las aprobadas cuentan como compradores, y bruno va primero.
  assert.equal(result.compradores.length, 2);
  assert.equal(result.compradores[0].usuario, 'bruno');
  assert.equal(result.compradores[0].usd, 12.99);
});

test('aprobar_pago acredita las monedas de una orden pendiente', async () => {
  const admin = await makeAdmin();
  const buyer = await User.create({
    username: 'paganini',
    email: 'paganini@example.com',
    password: 'clave12345',
  });
  const order = await seedPurchase({ user: buyer, coins: 500, priceUsd: 6.99, status: 'pending' });

  const result = await assistant.runTool('aprobar_pago', {
    id: order._id.toString(),
    adminId: admin._id,
  });

  assert.equal(result.ok, true);
  const updated = await User.findById(buyer._id);
  assert.equal(updated.wallet.bonusC + updated.wallet.ttcC, 500);
});

test('aprobar_pago dos veces no duplica el abono', async () => {
  const admin = await makeAdmin();
  const buyer = await User.create({
    username: 'doble',
    email: 'doble@example.com',
    password: 'clave12345',
  });
  const order = await seedPurchase({ user: buyer, coins: 500, priceUsd: 6.99, status: 'pending' });

  await assistant.runTool('aprobar_pago', { id: order._id.toString(), adminId: admin._id });
  const second = await assistant.runTool('aprobar_pago', {
    id: order._id.toString(),
    adminId: admin._id,
  });

  assert.match(second.error, /revisada/i);
  const updated = await User.findById(buyer._id);
  assert.equal(updated.wallet.bonusC + updated.wallet.ttcC, 500);
});

test('rechazar_pago no acredita monedas', async () => {
  const admin = await makeAdmin();
  const buyer = await User.create({
    username: 'rechazado',
    email: 'rechazado@example.com',
    password: 'clave12345',
  });
  const order = await seedPurchase({ user: buyer, coins: 500, priceUsd: 6.99, status: 'pending' });

  const result = await assistant.runTool('rechazar_pago', {
    id: order._id.toString(),
    motivo: 'No aparece el pago',
    adminId: admin._id,
  });

  assert.equal(result.estado, 'rejected');
  const updated = await User.findById(buyer._id);
  assert.equal(updated.wallet.bonusC + updated.wallet.ttcC, 0);
});

test('listar_retiros muestra las solicitudes pendientes con datos de cobro', async () => {
  const admin = await makeAdmin();
  const user = await User.create({
    username: 'retiradora',
    email: 'retiradora@example.com',
    password: 'clave12345',
    wallet: { ttcR: 500 },
  });
  await walletService.requestWithdrawal({
    userId: user._id,
    amount: 200,
    method: 'paypal',
    details: 'eliecerdepablos@gmail.com',
  });

  const result = await assistant.runTool('listar_retiros', { adminId: admin._id });

  assert.equal(result.retiros.length, 1);
  assert.equal(result.retiros[0].usuario, 'retiradora');
  assert.equal(result.retiros[0].diamantes, 200);
  assert.equal(result.retiros[0].datosCobro, 'eliecerdepablos@gmail.com');
});

test('pagar_retiro marca pagado y rechazar_retiro devuelve los Diamantes', async () => {
  const admin = await makeAdmin();
  const user = await User.create({
    username: 'retira2',
    email: 'retira2@example.com',
    password: 'clave12345',
    wallet: { ttcR: 500 },
  });
  const first = await walletService.requestWithdrawal({
    userId: user._id,
    amount: 200,
    method: 'paypal',
    details: 'x@y.com',
  });
  const paid = await assistant.runTool('pagar_retiro', {
    id: first.transactionId.toString(),
    adminId: admin._id,
  });
  assert.equal(paid.estado, 'completed');

  const second = await walletService.requestWithdrawal({
    userId: user._id,
    amount: 100,
    method: 'paypal',
    details: 'x@y.com',
  });
  const rejected = await assistant.runTool('rechazar_retiro', {
    id: second.transactionId.toString(),
    motivo: 'Datos incorrectos',
    adminId: admin._id,
  });
  assert.equal(rejected.estado, 'rejected');

  const updated = await User.findById(user._id);
  // 500 - 200 (pagado, no vuelve) - 100 + 100 (rechazado, vuelve) = 300.
  assert.equal(updated.wallet.ttcR, 300);
});
