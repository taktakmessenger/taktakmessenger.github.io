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
    .send({ messages: [{ role: 'user', content: 'hola' }] });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test('the assistant requires a session', async () => {
  const agent = app();
  const res = await agent
    .post('/api/admin/assistant')
    .send({ messages: [{ role: 'user', content: 'hola' }] });
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
      .send({ messages: [{ role: 'user', content: 'hola' }] });
    assert.equal(res.status, 503, JSON.stringify(res.body));
  } finally {
    env.assistantApiKey = original;
  }
});

test('an empty conversation is rejected', async () => {
  const admin = await makeAdmin();
  const res = await app()
    .post('/api/admin/assistant')
    .set('Authorization', `Bearer ${signToken(admin)}`)
    .send({ messages: [] });
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
      .send({ messages: [{ role: 'user', content: 'hola' }] });
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
        .send({ messages: [{ role: 'user', content: 'busca a buscame' }] });
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
        .send({ messages: [{ role: 'user', content: 'aprueba ese vídeo' }] });
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
        .send({ messages: [{ role: 'user', content: 'dale 500 monedas a premiado' }] });
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
        .send({ messages: [{ role: 'user', content: 'bucle' }] });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.match(res.body.reply, /demasiados pasos/i);
      assert.ok(fake.calls.length <= 6, `se hicieron ${fake.calls.length} llamadas`);
    }
  );
});
