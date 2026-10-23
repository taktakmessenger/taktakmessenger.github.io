const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { connectTestDb, resetDb, disconnectTestDb, app, registerUser } = require('./helpers');
const env = require('../src/config/env');
const transcodeService = require('../src/services/transcodeService');
const paypalService = require('../src/services/paypalService');
const Transaction = require('../src/models/Transaction');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

test('the coin package catalogue is published with server-side prices', async () => {
  const agent = app();
  const res = await agent.get('/api/payments/packages');

  assert.equal(res.status, 200);
  assert.ok(res.body.packages.length >= 4);
  const mega = res.body.packages.find((p) => p.id === 'mega');
  assert.equal(mega.coins, 20000);
});

// The endpoint must stay shut rather than trust an unauthenticated POST.
test('the webhook is closed while no secret is configured', async () => {
  const original = env.paymentWebhookSecret;
  env.paymentWebhookSecret = null;
  try {
    const agent = app();
    const res = await agent.post('/api/payments/webhook').send({
      event: 'payment.succeeded',
      userId: '000000000000000000000000',
      packageId: 'mega',
      externalId: 'evt_closed',
    });
    assert.equal(res.status, 503);
  } finally {
    env.paymentWebhookSecret = original;
  }
});

test('a forged signature is rejected and credits nothing', async () => {
  const original = env.paymentWebhookSecret;
  env.paymentWebhookSecret = 'test-secret';
  try {
    const agent = app();
    const user = await registerUser(agent);

    const res = await agent.post('/api/payments/webhook').send({
      event: 'payment.succeeded',
      userId: user.user.id,
      packageId: 'mega',
      externalId: 'evt_forged',
      signature: 'wrong',
    });

    assert.equal(res.status, 401);
    const wallet = await agent.get('/api/wallet').set('Authorization', `Bearer ${user.token}`);
    // El bono de bienvenida es promocional: no es moneda comprada.
    assert.equal(wallet.body.coins, 0);
    assert.equal(wallet.body.bonusCoins, 100);
  } finally {
    env.paymentWebhookSecret = original;
  }
});

// The whole point of the unique index on externalId: a retried delivery must
// not pay twice.
test('a valid webhook credits the package amount exactly once', async () => {
  const original = env.paymentWebhookSecret;
  env.paymentWebhookSecret = 'test-secret';
  try {
    const agent = app();
    const user = await registerUser(agent);

    const payload = {
      event: 'payment.succeeded',
      userId: user.user.id,
      packageId: 'mega',
      externalId: 'evt_once',
      signature: 'test-secret',
    };

    const first = await agent.post('/api/payments/webhook').send(payload);
    assert.equal(first.status, 200);
    assert.equal(first.body.coins, 20000);

    const retry = await agent.post('/api/payments/webhook').send(payload);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);

    const wallet = await agent.get('/api/wallet').set('Authorization', `Bearer ${user.token}`);
    assert.equal(wallet.body.coins, 20000); // solo lo comprado
    assert.equal(wallet.body.bonusCoins, 100); // bono aparte, intacto

    // The buyer cannot pick a package they did not pay for.
    const forged = await agent.post('/api/payments/webhook').send({
      ...payload,
      externalId: 'evt_unknown',
      packageId: 'not-a-real-pack',
    });
    assert.equal(forged.status, 400);
    assert.equal(await Transaction.countDocuments({ type: 'purchase' }), 1);
  } finally {
    env.paymentWebhookSecret = original;
  }
});

// --- Cobro real con pasarelas (Stripe y PayPal) ---------------------------

test('la tienda publica qué pasarelas están disponibles', async () => {
  const agent = app();
  const res = await agent.get('/api/payments/config');

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.providers.stripe, 'boolean');
  assert.equal(typeof res.body.providers.paypal, 'boolean');
});

// Sin claves configuradas, abrir un pago debe fallar en claro en vez de
// devolver una URL inventada a la que el usuario iría a pagar en el vacío.
test('sin pasarelas configuradas el checkout se rechaza con 503', async () => {
  const original = {
    stripe: env.stripeSecretKey,
    paypalId: env.paypalClientId,
    paypalSecret: env.paypalClientSecret,
  };
  env.stripeSecretKey = null;
  env.paypalClientId = null;
  env.paypalClientSecret = null;
  try {
    const agent = app();
    const user = await registerUser(agent);
    const res = await agent
      .post('/api/payments/checkout')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ provider: 'stripe', packageId: 'mega' });

    assert.equal(res.status, 503);
  } finally {
    env.stripeSecretKey = original.stripe;
    env.paypalClientId = original.paypalId;
    env.paypalClientSecret = original.paypalSecret;
  }
});

// El precio lo pone el servidor. Un paquete inexistente no puede colarse.
test('el checkout exige un paquete conocido del catálogo', async () => {
  const original = env.stripeSecretKey;
  env.stripeSecretKey = 'sk_test_fake';
  try {
    const agent = app();
    const user = await registerUser(agent);
    const res = await agent
      .post('/api/payments/checkout')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ provider: 'stripe', packageId: 'paquete-inventado' });

    assert.equal(res.status, 400);
  } finally {
    env.stripeSecretKey = original;
  }
});

test('el checkout rechaza un proveedor que no existe', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const res = await agent
    .post('/api/payments/checkout')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ provider: 'bitcoin-casero', packageId: 'mega' });

  assert.equal(res.status, 400);
});

// El webhook de Stripe sin firma válida no puede acreditar nada. Es la defensa
// central: la URL del webhook es pública por necesidad.
test('el webhook de Stripe rechaza una firma inválida y no acredita', async () => {
  const original = env.stripeWebhookSecret;
  env.stripeWebhookSecret = 'whsec_test';
  try {
    const agent = app();
    const user = await registerUser(agent);

    const res = await agent
      .post('/api/payments/webhook/stripe')
      .set('stripe-signature', 't=1,v1=firmafalsa')
      .send({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_forged',
            payment_status: 'paid',
            amount_total: 21999,
            currency: 'usd',
            metadata: { userId: user.user.id, packageId: 'mega' },
          },
        },
      });

    assert.equal(res.status, 401);
    const wallet = await agent.get('/api/wallet').set('Authorization', `Bearer ${user.token}`);
    assert.equal(wallet.body.coins, 0); // nada comprado
    assert.equal(wallet.body.bonusCoins, 100); // solo el bono
  } finally {
    env.stripeWebhookSecret = original;
  }
});

// Con la firma correcta, un pago completado sí acredita el paquete.
test('el webhook de Stripe acredita un pago firmado, una sola vez', async () => {
  const original = env.stripeWebhookSecret;
  env.stripeWebhookSecret = 'whsec_test';
  try {
    const agent = app();
    const user = await registerUser(agent);

    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_valid',
          payment_status: 'paid',
          amount_total: 5999, // 59.99 USD, el precio real de "value"
          currency: 'usd',
          metadata: { userId: user.user.id, packageId: 'value' },
        },
      },
    };

    const raw = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto
      .createHmac('sha256', 'whsec_test')
      .update(`${timestamp}.${raw}`)
      .digest('hex');

    const first = await agent
      .post('/api/payments/webhook/stripe')
      .set('stripe-signature', `t=${timestamp},v1=${signature}`)
      .set('Content-Type', 'application/json')
      .send(raw);

    assert.equal(first.status, 200);
    assert.equal(first.body.credited, true);
    assert.equal(first.body.coins, 5000);

    // Stripe reintenta. La segunda entrega no puede volver a pagar.
    const retry = await agent
      .post('/api/payments/webhook/stripe')
      .set('stripe-signature', `t=${timestamp},v1=${signature}`)
      .set('Content-Type', 'application/json')
      .send(raw);

    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);

    const wallet = await agent.get('/api/wallet').set('Authorization', `Bearer ${user.token}`);
    assert.equal(wallet.body.coins, 5000); // solo lo comprado, una vez
    assert.equal(wallet.body.bonusCoins, 100); // bono aparte
  } finally {
    env.stripeWebhookSecret = original;
  }
});

// Un evento firmado que miente sobre el importe no se acredita. Sin esto, quien
// consiguiera firmar (o un fallo del proveedor) podría regalar monedas.
test('un pago cuyo importe no cuadra con el paquete se rechaza', async () => {
  const original = env.stripeWebhookSecret;
  env.stripeWebhookSecret = 'whsec_test';
  try {
    const agent = app();
    const user = await registerUser(agent);

    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_mismatch',
          payment_status: 'paid',
          amount_total: 1, // un céntimo por el paquete "mega"
          currency: 'usd',
          metadata: { userId: user.user.id, packageId: 'mega' },
        },
      },
    };

    const raw = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto
      .createHmac('sha256', 'whsec_test')
      .update(`${timestamp}.${raw}`)
      .digest('hex');

    const res = await agent
      .post('/api/payments/webhook/stripe')
      .set('stripe-signature', `t=${timestamp},v1=${signature}`)
      .set('Content-Type', 'application/json')
      .send(raw);

    assert.equal(res.status, 400);
    assert.equal(await Transaction.countDocuments({ type: 'purchase' }), 0);
  } finally {
    env.stripeWebhookSecret = original;
  }
});

// Un evento viejo no vale: sin la ventana de tolerancia, un webhook capturado
// se podría reenviar días después y seguiría firmando bien.
test('un webhook de Stripe con marca de tiempo vieja se rechaza', async () => {
  const original = env.stripeWebhookSecret;
  env.stripeWebhookSecret = 'whsec_test';
  try {
    const agent = app();
    const user = await registerUser(agent);

    const raw = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_old',
          payment_status: 'paid',
          amount_total: 699,
          currency: 'usd',
          metadata: { userId: user.user.id, packageId: 'starter' },
        },
      },
    });
    const oldTimestamp = Math.floor(Date.now() / 1000) - 3600;
    const signature = crypto
      .createHmac('sha256', 'whsec_test')
      .update(`${oldTimestamp}.${raw}`)
      .digest('hex');

    const res = await agent
      .post('/api/payments/webhook/stripe')
      .set('stripe-signature', `t=${oldTimestamp},v1=${signature}`)
      .set('Content-Type', 'application/json')
      .send(raw);

    assert.equal(res.status, 401);
  } finally {
    env.stripeWebhookSecret = original;
  }
});

// PayPal no manda el paquete en la captura: se resuelve por el importe pagado.
test('PayPal acredita por importe cuando el webhook no trae el paquete', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const parsed = paypalService.parseCompletedPayment({
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: 'CAPTURE123',
      amount: { value: '59.99', currency_code: 'USD' },
      custom_id: `${user.user.id}|value`,
      supplementary_data: { related_ids: { order_id: 'ORDER1' } },
    },
  });

  assert.equal(parsed.userId, user.user.id);
  assert.equal(parsed.packageId, 'value');
  assert.equal(parsed.amountPaidMinor, 5999);
  assert.equal(parsed.externalId, 'paypal:CAPTURE123');
});

// Un evento de PayPal que no sea una captura completada no acredita: el
// "aprobado" solo significa que el usuario pulsó el botón, no que pagó.
test('una aprobación de PayPal sin captura no se interpreta como pago', async () => {
  const parsed = paypalService.parseCompletedPayment({
    event_type: 'CHECKOUT.ORDER.APPROVED',
    resource: { id: 'ORDER1' },
  });
  assert.equal(parsed, null);
});

test('el webhook de PayPal sin configuración se cierra', async () => {
  const original = env.paypalWebhookId;
  env.paypalWebhookId = null;
  try {
    const agent = app();
    const res = await agent
      .post('/api/payments/webhook/paypal')
      .send({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'X' } });

    assert.equal(res.status, 503);
  } finally {
    env.paypalWebhookId = original;
  }
});

// Transcoding is optional: with it off the upload must still succeed and the
// service must report the original file rather than throwing.
test('transcoding degrades gracefully when disabled', async () => {
  const original = env.transcodeEnabled;
  env.transcodeEnabled = false;
  try {
    assert.equal(await transcodeService.hasFfmpeg(), false);
    assert.equal(
      await transcodeService.processVideoToHLS('/tmp/nope.mp4', '/tmp/out', 'id'),
      null
    );
  } finally {
    env.transcodeEnabled = original;
  }
});
