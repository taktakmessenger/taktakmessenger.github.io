const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
} = require('./helpers');
const createApp = require('../src/app');
const { initLiveSockets } = require('../src/services/liveSockets');
const { io: ioClient } = require('socket.io-client');
const PushSubscription = require('../src/models/PushSubscription');
const pushService = require('../src/services/pushService');
const env = require('../src/config/env');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// El entorno de test no define claves VAPID, así que el envío está apagado. Eso
// es lo que se comprueba: que un despliegue sin claves lo dice en lugar de
// aceptar suscripciones que nunca recibirán nada.
//
// Las claves se fijan aquí y no se heredan del `.env`: un desarrollador que sí
// las tenga configuradas para probar en local haría que estas pruebas dijeran
// cosas distintas que en CI, que es la peor clase de test.
function withVapidKeys(keys, fn) {
  const before = { pub: env.vapidPublicKey, priv: env.vapidPrivateKey };
  env.vapidPublicKey = keys?.publicKey ?? null;
  env.vapidPrivateKey = keys?.privateKey ?? null;
  // `finally` con `await` a propósito: si se restauraran las claves nada más
  // llamar a `fn`, se repondrían antes de que la petición HTTP las leyera y el
  // test no probaría nada.
  return (async () => {
    try {
      return await fn();
    } finally {
      env.vapidPublicKey = before.pub;
      env.vapidPrivateKey = before.priv;
    }
  })();
}

const SUBSCRIPTION = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'BExamplePublicKey', auth: 'exampleAuthSecret' },
};

test('push config requires a session', async () => {
  const agent = app();
  const res = await agent.get('/api/push/config');
  assert.equal(res.status, 401);
});

test('push config reports unavailable without VAPID keys', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  await withVapidKeys(null, async () => {
    const res = await agent.get('/api/push/config').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.available, false);
    assert.equal(res.body.publicKey, null);
  });
});

test('push config exposes the public key, never the private one', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  await withVapidKeys({ publicKey: 'PUBLIC_TEST_KEY', privateKey: 'PRIVATE_TEST_KEY' }, async () => {
    const res = await agent.get('/api/push/config').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.available, true);
    assert.equal(res.body.publicKey, 'PUBLIC_TEST_KEY');
    // La privada es un secreto: si saliera en la respuesta, cualquiera podría
    // enviar notificaciones en nombre de la app.
    assert.equal(JSON.stringify(res.body).includes('PRIVATE_TEST_KEY'), false);
  });
});

test('a subscription is accepted and stored for the signed-in user', async () => {
  const agent = app();
  const { token, user } = await registerUser(agent);

  const res = await agent
    .post('/api/push/subscribe')
    .set('Authorization', `Bearer ${token}`)
    .send({ subscription: SUBSCRIPTION });

  assert.equal(res.status, 201, JSON.stringify(res.body));

  const stored = await PushSubscription.findOne({ endpoint: SUBSCRIPTION.endpoint });
  assert.ok(stored, 'la suscripción debería guardarse');
  assert.equal(String(stored.user), String(user.id || user._id));
});

test('subscribing twice with the same endpoint updates instead of duplicating', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  await agent
    .post('/api/push/subscribe')
    .set('Authorization', `Bearer ${token}`)
    .send({ subscription: SUBSCRIPTION });
  await agent
    .post('/api/push/subscribe')
    .set('Authorization', `Bearer ${token}`)
    .send({ subscription: SUBSCRIPTION });

  // El endpoint es único en el mundo: si el mismo navegador se suscribe otra
  // vez, debe actualizarse la fila, no acumular basura.
  const count = await PushSubscription.countDocuments({ endpoint: SUBSCRIPTION.endpoint });
  assert.equal(count, 1);
});

test('an incomplete subscription is rejected', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  const res = await agent
    .post('/api/push/subscribe')
    .set('Authorization', `Bearer ${token}`)
    .send({ subscription: { endpoint: SUBSCRIPTION.endpoint, keys: {} } });

  assert.equal(res.status, 400);
});

test('unsubscribing removes only the caller own device', async () => {
  const agent = app();
  const { token: tokenA } = await registerUser(agent, { username: 'pusha' });
  const { token: tokenB } = await registerUser(agent, { username: 'pushb' });

  await agent
    .post('/api/push/subscribe')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ subscription: SUBSCRIPTION });
  await agent
    .post('/api/push/subscribe')
    .set('Authorization', `Bearer ${tokenB}`)
    .send({
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/other',
        keys: SUBSCRIPTION.keys,
      },
    });

  const res = await agent
    .post('/api/push/unsubscribe')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ endpoint: SUBSCRIPTION.endpoint });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await PushSubscription.countDocuments({ endpoint: SUBSCRIPTION.endpoint }), 0);
  // La del otro usuario sigue ahí: desuscribir no puede tocar dispositivos ajenos.
  assert.equal(
    await PushSubscription.countDocuments({ endpoint: 'https://fcm.googleapis.com/fcm/send/other' }),
    1
  );
});

test('a user cannot unsubscribe a device that belongs to someone else', async () => {
  const agent = app();
  const { token: tokenA } = await registerUser(agent, { username: 'pushc' });
  const { token: tokenB } = await registerUser(agent, { username: 'pushd' });

  await agent
    .post('/api/push/subscribe')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ subscription: SUBSCRIPTION });

  // B conoce el endpoint de A y lo intenta borrar: no debe poder.
  await agent
    .post('/api/push/unsubscribe')
    .set('Authorization', `Bearer ${tokenB}`)
    .send({ endpoint: SUBSCRIPTION.endpoint });

  assert.equal(await PushSubscription.countDocuments({ endpoint: SUBSCRIPTION.endpoint }), 1);
});
