const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
} = require('./helpers');
const User = require('../src/models/User');
const Video = require('../src/models/Video');
const Report = require('../src/models/Report');
const safetyService = require('../src/services/safetyService');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// --- Bloqueo ----------------------------------------------------------------

test('bloquear y desbloquear deja el estado coherente en ambos lados', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);

  const blocked = await agent
    .post(`/api/safety/block/${beto.user.id}`)
    .set('Authorization', `Bearer ${ana.token}`);
  assert.equal(blocked.status, 200);
  assert.equal(blocked.body.blocked, true);

  const list = await agent
    .get('/api/safety/blocked')
    .set('Authorization', `Bearer ${ana.token}`);
  assert.equal(list.body.blocked.length, 1);
  assert.equal(list.body.blocked[0].username, beto.username);

  const unblocked = await agent
    .delete(`/api/safety/block/${beto.user.id}`)
    .set('Authorization', `Bearer ${ana.token}`);
  assert.equal(unblocked.status, 200);

  const after = await agent
    .get('/api/safety/blocked')
    .set('Authorization', `Bearer ${ana.token}`);
  assert.equal(after.body.blocked.length, 0);
});

test('bloquear dos veces no duplica la entrada', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);

  await agent.post(`/api/safety/block/${beto.user.id}`).set('Authorization', `Bearer ${ana.token}`);
  await agent.post(`/api/safety/block/${beto.user.id}`).set('Authorization', `Bearer ${ana.token}`);

  const list = await agent.get('/api/safety/blocked').set('Authorization', `Bearer ${ana.token}`);
  assert.equal(list.body.blocked.length, 1);
});

test('no se puede bloquear a uno mismo', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const res = await agent
    .post(`/api/safety/block/${ana.user.id}`)
    .set('Authorization', `Bearer ${ana.token}`);
  assert.equal(res.status, 400);
});

test('bloquear exige sesión', async () => {
  const agent = app();
  const beto = await registerUser(agent);
  assert.equal((await agent.post(`/api/safety/block/${beto.user.id}`)).status, 401);
});

test('los vídeos del bloqueado desaparecen del feed', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);

  await Video.create({
    title: 'De Beto',
    videoUrl: '/uploads/b.mp4',
    creator: beto.user.id,
    moderationStatus: 'approved',
  });
  await Video.create({
    title: 'De Ana',
    videoUrl: '/uploads/a.mp4',
    creator: ana.user.id,
    moderationStatus: 'approved',
  });

  const before = await agent.get('/api/feed/for-you').set('Authorization', `Bearer ${ana.token}`);
  assert.ok(before.body.videos.some((v) => v.title === 'De Beto'));

  await agent.post(`/api/safety/block/${beto.user.id}`).set('Authorization', `Bearer ${ana.token}`);

  const after = await agent.get('/api/feed/for-you').set('Authorization', `Bearer ${ana.token}`);
  assert.ok(!after.body.videos.some((v) => v.title === 'De Beto'));
  assert.ok(after.body.videos.some((v) => v.title === 'De Ana'));
});

test('el bloqueo es mutuo: Beto tampoco ve los vídeos de Ana', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);

  await Video.create({
    title: 'De Ana',
    videoUrl: '/uploads/a.mp4',
    creator: ana.user.id,
    moderationStatus: 'approved',
  });

  await agent.post(`/api/safety/block/${beto.user.id}`).set('Authorization', `Bearer ${ana.token}`);

  const feed = await agent.get('/api/feed/for-you').set('Authorization', `Bearer ${beto.token}`);
  assert.ok(!feed.body.videos.some((v) => v.title === 'De Ana'));
});

test('un bloqueado no puede abrir un chat directo ni escribir', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);

  // Hilo previo, para probar también el envío sobre un hilo ya existente.
  const opened = await agent
    .post('/api/messages/conversations')
    .set('Authorization', `Bearer ${beto.token}`)
    .send({ userId: ana.user.id });
  assert.equal(opened.status, 201);
  const conversationId = opened.body.conversationId;

  await agent.post(`/api/safety/block/${beto.user.id}`).set('Authorization', `Bearer ${ana.token}`);

  // Beto intenta abrir el hilo otra vez.
  const open = await agent
    .post('/api/messages/conversations')
    .set('Authorization', `Bearer ${beto.token}`)
    .send({ userId: ana.user.id });
  assert.ok(open.status >= 400, `esperaba error, llegó ${open.status}`);

  // Ana intenta escribirle en el hilo que ya existía.
  const sent = await agent
    .post(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${ana.token}`)
    .send({ text: 'hola' });
  assert.ok(sent.status >= 400, `esperaba error, llegó ${sent.status}`);

  // Y Beto tampoco.
  const reply = await agent
    .post(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${beto.token}`)
    .send({ text: 'hola' });
  assert.ok(reply.status >= 400, `esperaba error, llegó ${reply.status}`);
});

// --- Reportes ---------------------------------------------------------------

test('crear un reporte lo deja pendiente y con el motivo elegido', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);
  const video = await Video.create({
    title: 'Ofensivo',
    videoUrl: '/uploads/x.mp4',
    creator: beto.user.id,
    moderationStatus: 'approved',
  });

  const res = await agent
    .post('/api/safety/reports')
    .set('Authorization', `Bearer ${ana.token}`)
    .send({
      targetType: 'video',
      targetId: video._id.toString(),
      reason: 'harassment',
      details: 'insultos en el vídeo',
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.report.reason, 'harassment');
  assert.equal(res.body.report.status, 'open');

  const stored = await Report.findById(res.body.report.id);
  assert.equal(stored.reporter.toString(), ana.user.id);
});

test('un motivo inventado se rechaza', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);
  const res = await agent
    .post('/api/safety/reports')
    .set('Authorization', `Bearer ${ana.token}`)
    .send({ targetType: 'user', targetId: beto.user.id, reason: 'porque_si' });
  assert.equal(res.status, 400);
});

test('reportar dos veces lo mismo no duplica la fila: la actualiza', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);

  const first = await agent
    .post('/api/safety/reports')
    .set('Authorization', `Bearer ${ana.token}`)
    .send({ targetType: 'user', targetId: beto.user.id, reason: 'spam' });
  assert.equal(first.status, 201);

  const second = await agent
    .post('/api/safety/reports')
    .set('Authorization', `Bearer ${ana.token}`)
    .send({ targetType: 'user', targetId: beto.user.id, reason: 'harassment' });
  assert.equal(second.status, 201);

  // Un doble toque no debe crear dos entradas en la cola de moderación: se
  // queda con el último motivo, que es lo que la persona quiso decir.
  assert.equal(String(second.body.report.id), String(first.body.report.id));
  assert.equal(await Report.countDocuments(), 1);

  const stored = await Report.findById(first.body.report.id);
  assert.equal(stored.reason, 'harassment');
});

test('no se puede reportar el propio contenido', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const res = await agent
    .post('/api/safety/reports')
    .set('Authorization', `Bearer ${ana.token}`)
    .send({ targetType: 'user', targetId: ana.user.id, reason: 'spam' });
  assert.equal(res.status, 400);
});

test('el reporte es anónimo para el reportado', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);

  await agent
    .post('/api/safety/reports')
    .set('Authorization', `Bearer ${ana.token}`)
    .send({ targetType: 'user', targetId: beto.user.id, reason: 'spam' });

  // Beto mira sus propios reportes: no debe ver el de Ana.
  const mine = await agent
    .get('/api/safety/reports')
    .set('Authorization', `Bearer ${beto.token}`);
  assert.equal(mine.body.reports.length, 0);
});

test('se pueden ver y retirar los reportes propios', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);

  const created = await agent
    .post('/api/safety/reports')
    .set('Authorization', `Bearer ${ana.token}`)
    .send({ targetType: 'user', targetId: beto.user.id, reason: 'spam' });

  const list = await agent
    .get('/api/safety/reports')
    .set('Authorization', `Bearer ${ana.token}`);
  assert.equal(list.body.reports.length, 1);

  const withdrawn = await agent
    .delete(`/api/safety/reports/${created.body.report.id}`)
    .set('Authorization', `Bearer ${ana.token}`);
  assert.equal(withdrawn.status, 200);

  const after = await agent
    .get('/api/safety/reports')
    .set('Authorization', `Bearer ${ana.token}`);
  assert.equal(after.body.reports.length, 0);
});

test('no se puede retirar el reporte de otra persona', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);
  const carla = await registerUser(agent);

  const created = await agent
    .post('/api/safety/reports')
    .set('Authorization', `Bearer ${ana.token}`)
    .send({ targetType: 'user', targetId: beto.user.id, reason: 'spam' });

  const res = await agent
    .delete(`/api/safety/reports/${created.body.report.id}`)
    .set('Authorization', `Bearer ${carla.token}`);
  assert.ok(res.status >= 400, `esperaba error, llegó ${res.status}`);
});

test('listar reportes exige sesión', async () => {
  const agent = app();
  assert.equal((await agent.get('/api/safety/reports')).status, 401);
  assert.equal((await agent.get('/api/safety/blocked')).status, 401);
});

test('el servicio rechaza un tipo de contenido desconocido', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);
  await assert.rejects(
    () =>
      safetyService.createReport({
        reporterId: ana.user.id,
        targetType: 'planeta',
        targetId: beto.user.id,
        reason: 'spam',
      }),
    /inválido|no válido|desconocido/i
  );
});

// --- Moderación -------------------------------------------------------------

test('el admin ve la cola de reportes y puede resolverlos', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);

  const admin = await User.create({
    username: `boss_${Math.random().toString(36).slice(2, 7)}`,
    email: `boss_${Math.random().toString(36).slice(2, 7)}@example.com`,
    password: 'secret123',
    role: 'admin',
  });
  const { signToken } = require('../src/utils/tokens');
  const adminToken = signToken(admin);

  const created = await agent
    .post('/api/safety/reports')
    .set('Authorization', `Bearer ${ana.token}`)
    .send({ targetType: 'user', targetId: beto.user.id, reason: 'harassment' });

  const queue = await agent
    .get('/api/admin/reports')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(queue.status, 200);
  assert.ok(queue.body.reports.length >= 1);

  const resolved = await agent
    .patch(`/api/admin/reports/${created.body.report.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'actioned' });
  assert.equal(resolved.status, 200);

  const stored = await Report.findById(created.body.report.id);
  assert.equal(stored.status, 'actioned');
});

test('un usuario normal no entra en la cola de reportes', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const res = await agent
    .get('/api/admin/reports')
    .set('Authorization', `Bearer ${ana.token}`);
  assert.ok(res.status === 403 || res.status === 401, `llegó ${res.status}`);
});
