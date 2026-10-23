const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
} = require('./helpers');
const { startFakeProviders } = require('./fakeProviders');
const env = require('../src/config/env');
const PaymentMethod = require('../src/models/PaymentMethod');
const User = require('../src/models/User');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// Arranca el servidor falso y apunta las pasarelas a él durante el test.
// Devuelve un `restore` que hay que llamar siempre en un `finally`.
async function withProviders(behavior, fn) {
  const fake = await startFakeProviders(behavior);
  const original = {
    stripeSecretKey: env.stripeSecretKey,
    stripePublishableKey: env.stripePublishableKey,
    stripeApiBase: env.stripeApiBase,
    paypalClientId: env.paypalClientId,
    paypalClientSecret: env.paypalClientSecret,
    paypalApiBase: env.paypalApiBase,
  };

  env.stripeSecretKey = 'sk_test_fake';
  env.stripePublishableKey = 'pk_test_fake';
  env.stripeApiBase = fake.stripeUrl;
  env.paypalClientId = 'paypal_client_fake';
  env.paypalClientSecret = 'paypal_secret_fake';
  env.paypalApiBase = fake.paypalUrl;

  const paypal = require('../src/services/paypalService');
  paypal._resetTokenCache();

  try {
    return await fn(fake);
  } finally {
    env.stripeSecretKey = original.stripeSecretKey;
    env.stripePublishableKey = original.stripePublishableKey;
    env.stripeApiBase = original.stripeApiBase;
    env.paypalClientId = original.paypalClientId;
    env.paypalClientSecret = original.paypalClientSecret;
    env.paypalApiBase = original.paypalApiBase;
    paypal._resetTokenCache();
    await fake.close();
  }
}

// --- Alta de tarjeta ------------------------------------------------------

test('el alta de tarjeta devuelve un client_secret y la clave publicable', async () => {
  await withProviders({}, async () => {
    const agent = app();
    const user = await registerUser(agent);

    const res = await agent
      .post('/api/payments/methods/card/setup')
      .set('Authorization', `Bearer ${user.token}`);

    assert.equal(res.status, 201);
    assert.equal(res.body.provider, 'stripe');
    assert.ok(res.body.clientSecret, 'falta el client_secret');
    // El número de tarjeta lo necesita el navegador para hablar con Stripe; la
    // clave publicable no es un secreto, pero se sirve desde aquí para no
    // reconstruir el frontend al cambiar de cuenta.
    assert.equal(res.body.publishableKey, 'pk_test_fake');
  });
});

test('guardar una tarjeta lee la marca y los últimos dígitos de Stripe, no del cliente', async () => {
  await withProviders({}, async () => {
    const agent = app();
    const user = await registerUser(agent);

    const res = await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${user.token}`)
      // El cliente manda datos falsos a propósito: si el servidor los copiara,
      // la lista mostraría "Visa 0000" sobre una tarjeta que es otra cosa.
      .send({ paymentMethodId: 'pm_card_visa', brand: 'visa', last4: '0000' });

    assert.equal(res.status, 201);
    assert.equal(res.body.method.last4, '4242');
    assert.equal(res.body.method.brand, 'visa');
    assert.equal(res.body.method.expMonth, 12);
    assert.equal(res.body.method.kind, 'card');
    // El identificador de cobro nunca se expone.
    assert.equal(res.body.method.providerRef, undefined);
  });
});

test('la tarjeta guardada queda predeterminada sin que el usuario lo pida', async () => {
  await withProviders({}, async () => {
    const agent = app();
    const user = await registerUser(agent);

    await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ paymentMethodId: 'pm_card_visa' });

    const list = await agent
      .get('/api/payments/methods')
      .set('Authorization', `Bearer ${user.token}`);

    assert.equal(list.body.methods.length, 1);
    assert.equal(list.body.methods[0].isDefault, true);
  });
});

test('guardar la misma tarjeta dos veces no la duplica', async () => {
  await withProviders({}, async () => {
    const agent = app();
    const user = await registerUser(agent);

    for (let i = 0; i < 2; i += 1) {
      await agent
        .post('/api/payments/methods/card')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ paymentMethodId: 'pm_card_visa' });
    }

    const list = await agent
      .get('/api/payments/methods')
      .set('Authorization', `Bearer ${user.token}`);

    assert.equal(list.body.methods.length, 1);
    assert.equal(await PaymentMethod.countDocuments({}), 1);
  });
});

test('una tarjeta que Stripe no conoce se rechaza', async () => {
  await withProviders({}, async () => {
    const agent = app();
    const user = await registerUser(agent);

    const res = await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ paymentMethodId: 'pm_no_existe' });

    // El error del proveedor se traduce, no se reenvía su cuerpo.
    assert.ok(res.status >= 400);
    assert.equal(await PaymentMethod.countDocuments({}), 0);
  });
});

test('un identificador de tarjeta con forma rara se rechaza antes de llamar a Stripe', async () => {
  await withProviders({}, async (fake) => {
    const agent = app();
    const user = await registerUser(agent);

    const res = await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ paymentMethodId: 'no-es-un-pm' });

    assert.equal(res.status, 400);
    // Ni siquiera se llamó al proveedor.
    assert.equal(fake.calls.stripe.length, 0);
  });
});

// --- PayPal ---------------------------------------------------------------

test('vincular PayPal devuelve la URL de aprobación', async () => {
  await withProviders({}, async (fake) => {
    const agent = app();
    const user = await registerUser(agent);

    const res = await agent
      .post('/api/payments/methods/paypal/link')
      .set('Authorization', `Bearer ${user.token}`);

    assert.equal(res.status, 201);
    assert.equal(res.body.id, 'ORDER-VAULT-1');
    assert.ok(res.body.url.includes('approve'));

    // El alta tiene que pedir el vault; sin él PayPal no devuelve nada
    // reutilizable y el "método guardado" no serviría para cobrar.
    const vaultCall = fake.calls.paypal.find((c) => c.body.includes('store_in_vault'));
    assert.ok(vaultCall, 'no se pidió el vault a PayPal');
  });
});

test('confirmar PayPal guarda la cuenta con su correo', async () => {
  await withProviders({}, async () => {
    const agent = app();
    const user = await registerUser(agent);

    const res = await agent
      .post('/api/payments/methods/paypal/confirm')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ orderId: 'ORDER-VAULT-1' });

    assert.equal(res.status, 201);
    assert.equal(res.body.method.provider, 'paypal');
    assert.equal(res.body.method.kind, 'paypal');
    assert.equal(res.body.method.email, 'pagador@example.com');
    assert.equal(res.body.method.isDefault, true);
    // El vault_id es un secreto de cobro: no se expone.
    assert.equal(res.body.method.providerRef, undefined);
  });
});

test('si PayPal no devuelve vault, no se guarda un método muerto', async () => {
  await withProviders({ captureWithoutVault: true }, async () => {
    const agent = app();
    const user = await registerUser(agent);

    const res = await agent
      .post('/api/payments/methods/paypal/confirm')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ orderId: 'ORDER-VAULT-1' });

    assert.equal(res.status, 400);
    assert.equal(await PaymentMethod.countDocuments({}), 0);
  });
});

// --- Propiedad y borrado --------------------------------------------------

test('un usuario no ve ni puede borrar el método de otro', async () => {
  await withProviders({}, async () => {
    const agent = app();
    const owner = await registerUser(agent);
    const intruder = await registerUser(agent);

    const created = await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ paymentMethodId: 'pm_card_visa' });
    const methodId = created.body.method.id;

    // La lista del intruso está vacía: los métodos se filtran por dueño.
    const list = await agent
      .get('/api/payments/methods')
      .set('Authorization', `Bearer ${intruder.token}`);
    assert.equal(list.body.methods.length, 0);

    // Conocer el id no basta para borrarlo.
    const del = await agent
      .delete(`/api/payments/methods/${methodId}`)
      .set('Authorization', `Bearer ${intruder.token}`);
    assert.equal(del.status, 404);

    // Y sigue vivo para su dueño.
    assert.equal(await PaymentMethod.countDocuments({ revoked: false }), 1);
  });
});

test('borrar un método lo revoca y desvincula del proveedor', async () => {
  await withProviders({}, async (fake) => {
    const agent = app();
    const user = await registerUser(agent);

    const created = await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ paymentMethodId: 'pm_card_visa' });

    const del = await agent
      .delete(`/api/payments/methods/${created.body.method.id}`)
      .set('Authorization', `Bearer ${user.token}`);

    assert.equal(del.status, 200);
    assert.ok(fake.calls.stripe.some((c) => c.url.endsWith('/detach')));

    const list = await agent
      .get('/api/payments/methods')
      .set('Authorization', `Bearer ${user.token}`);
    assert.equal(list.body.methods.length, 0);
  });
});

test('aunque el proveedor falle al desvincular, el método deja de poder cobrarse', async () => {
  await withProviders({ detachFails: true }, async () => {
    const agent = app();
    const user = await registerUser(agent);

    const created = await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ paymentMethodId: 'pm_card_visa' });

    const del = await agent
      .delete(`/api/payments/methods/${created.body.method.id}`)
      .set('Authorization', `Bearer ${user.token}`);

    // La baja se acepta igual: lo que no puede quedar es una tarjeta viva.
    assert.equal(del.status, 200);
    assert.equal(await PaymentMethod.countDocuments({ revoked: false }), 0);

    // Y ya no se puede cobrar con ella.
    const pay = await agent
      .post(`/api/payments/methods/${created.body.method.id}/pay`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ packageId: 'mega' });
    assert.equal(pay.status, 404);
  });
});

test('borrar el predeterminado promociona el siguiente', async () => {
  await withProviders({}, async () => {
    const agent = app();
    const user = await registerUser(agent);

    const first = await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ paymentMethodId: 'pm_card_visa' });
    await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ paymentMethodId: 'pm_card_mastercard' });

    await agent
      .delete(`/api/payments/methods/${first.body.method.id}`)
      .set('Authorization', `Bearer ${user.token}`);

    const list = await agent
      .get('/api/payments/methods')
      .set('Authorization', `Bearer ${user.token}`);
    assert.equal(list.body.methods.length, 1);
    assert.equal(list.body.methods[0].isDefault, true);
  });
});

test('marcar otro método como predeterminado quita el anterior', async () => {
  await withProviders({}, async () => {
    const agent = app();
    const user = await registerUser(agent);

    const first = await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ paymentMethodId: 'pm_card_visa' });
    const second = await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ paymentMethodId: 'pm_card_mastercard' });

    const res = await agent
      .post(`/api/payments/methods/${second.body.method.id}/default`)
      .set('Authorization', `Bearer ${user.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.method.isDefault, true);

    const defaults = await PaymentMethod.countDocuments({ isDefault: true });
    assert.equal(defaults, 1, 'solo puede haber un predeterminado');
    assert.equal(
      (await PaymentMethod.findById(first.body.method.id)).isDefault,
      false
    );
  });
});

// --- Cobro con un método guardado ----------------------------------------

test('cobrar con una tarjeta guardada lanza el cargo y no acredita monedas', async () => {
  await withProviders({}, async (fake) => {
    const agent = app();
    const user = await registerUser(agent);

    const created = await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ paymentMethodId: 'pm_card_visa' });

    const pay = await agent
      .post(`/api/payments/methods/${created.body.method.id}/pay`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ packageId: 'mega' });

    assert.equal(pay.status, 201);
    assert.equal(pay.body.provider, 'stripe');
    assert.equal(pay.body.status, 'succeeded');

    // El importe sale del catálogo del servidor, no del cliente.
    const intentCall = fake.calls.stripe.find((c) => c.url === '/payment_intents');
    assert.ok(intentCall.body.includes('amount=21999'), 'el importe no es el del paquete');

    // Las monedas las acredita el webhook, no esta respuesta. Acreditar aquí
    // dejaría monedas regaladas si el banco rechaza el cargo después.
    const wallet = await agent
      .get('/api/wallet')
      .set('Authorization', `Bearer ${user.token}`);
    assert.equal(wallet.body.coins, 0);
  });
});

test('el cobro guardado manda una clave de idempotencia', async () => {
  await withProviders({}, async (fake) => {
    const agent = app();
    const user = await registerUser(agent);

    const created = await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ paymentMethodId: 'pm_card_visa' });

    await agent
      .post(`/api/payments/methods/${created.body.method.id}/pay`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ packageId: 'mega' });

    const intentCall = fake.calls.stripe.find((c) => c.url === '/payment_intents');
    // Sin esta cabecera, un doble clic cobra dos veces.
    assert.ok(intentCall.headers['idempotency-key'], 'falta la clave de idempotencia');
  });
});

test('un cobro que el banco no aprueba no se da por bueno', async () => {
  await withProviders({ chargeStatus: 'requires_action' }, async () => {
    const agent = app();
    const user = await registerUser(agent);

    const created = await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ paymentMethodId: 'pm_card_visa' });

    const pay = await agent
      .post(`/api/payments/methods/${created.body.method.id}/pay`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ packageId: 'mega' });

    // 402: hay que confirmar el pago. Devolver 201 haría creer al usuario que
    // ya pagó.
    assert.equal(pay.status, 402);
  });
});

test('no se puede cobrar con el método de otra persona', async () => {
  await withProviders({}, async () => {
    const agent = app();
    const owner = await registerUser(agent);
    const intruder = await registerUser(agent);

    const created = await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ paymentMethodId: 'pm_card_visa' });

    const pay = await agent
      .post(`/api/payments/methods/${created.body.method.id}/pay`)
      .set('Authorization', `Bearer ${intruder.token}`)
      .send({ packageId: 'mega' });

    assert.equal(pay.status, 404);
  });
});

test('cobrar con PayPal guardado usa el vault y no vuelve a pedir aprobación', async () => {
  await withProviders({}, async (fake) => {
    const agent = app();
    const user = await registerUser(agent);

    const linked = await agent
      .post('/api/payments/methods/paypal/confirm')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ orderId: 'ORDER-VAULT-1' });

    const pay = await agent
      .post(`/api/payments/methods/${linked.body.method.id}/pay`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ packageId: 'starter' });

    assert.equal(pay.status, 201);
    assert.equal(pay.body.provider, 'paypal');

    // El cobro tiene que llevar el vault_id: sin él PayPal cobraría a quien
    // esté mirando la pantalla, no a la cuenta guardada.
    const charge = fake.calls.paypal.find((c) => c.body.includes('VAULT-ABC-123'));
    assert.ok(charge, 'el cobro no usó el vault');
  });
});

// --- Aislamiento entre usuarios y seguridad ------------------------------

test('el cliente de Stripe se crea una sola vez por usuario', async () => {
  await withProviders({}, async (fake) => {
    const agent = app();
    const user = await registerUser(agent);

    await agent
      .post('/api/payments/methods/card/setup')
      .set('Authorization', `Bearer ${user.token}`);
    await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ paymentMethodId: 'pm_card_visa' });

    const customerCalls = fake.calls.stripe.filter((c) => c.url === '/customers');
    assert.equal(customerCalls.length, 1, 'se creó más de un cliente');

    const stored = await User.findById(user.user.id).select('+paymentRefs.stripeCustomerId');
    assert.equal(stored.paymentRefs.stripeCustomerId, 'cus_fake_1');
  });
});

test('los métodos de pago exigen sesión', async () => {
  const agent = app();
  assert.equal((await agent.get('/api/payments/methods')).status, 401);
  assert.equal((await agent.post('/api/payments/methods/card/setup')).status, 401);
  assert.equal(
    (await agent.post('/api/payments/methods/000000000000000000000000/pay')).status,
    401
  );
});

test('sin claves de Stripe, el alta de tarjeta se rechaza en claro', async () => {
  const original = env.stripeSecretKey;
  env.stripeSecretKey = null;
  try {
    const agent = app();
    const user = await registerUser(agent);
    const res = await agent
      .post('/api/payments/methods/card/setup')
      .set('Authorization', `Bearer ${user.token}`);
    assert.equal(res.status, 503);
  } finally {
    env.stripeSecretKey = original;
  }
});

test('el servicio expone las pasarelas disponibles junto a la lista', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const res = await agent
    .get('/api/payments/methods')
    .set('Authorization', `Bearer ${user.token}`);

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.providers.stripe, 'boolean');
  assert.equal(typeof res.body.providers.paypal, 'boolean');
});

// La clave publicable la necesita el navegador para tokenizar la tarjeta. No es
// un secreto, pero tiene que salir de aquí y no de una variable de compilación
// del frontend, o cambiar de cuenta de Stripe obligaría a reconstruir la app.
test('la config publica la clave publicable de Stripe', async () => {
  const original = env.stripePublishableKey;
  env.stripePublishableKey = 'pk_test_publica';
  try {
    const agent = app();
    const res = await agent.get('/api/payments/config');
    assert.equal(res.body.publishableKey, 'pk_test_publica');
  } finally {
    env.stripePublishableKey = original;
  }
});

// El identificador de cobro del proveedor es un secreto: con él se puede cobrar.
// No puede salir en ninguna respuesta.
test('el providerRef nunca se expone en la API', async () => {
  await withProviders({}, async () => {
    const agent = app();
    const user = await registerUser(agent);

    await agent
      .post('/api/payments/methods/card')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ paymentMethodId: 'pm_card_visa' });

    const list = await agent
      .get('/api/payments/methods')
      .set('Authorization', `Bearer ${user.token}`);

    const serialized = JSON.stringify(list.body);
    assert.ok(!serialized.includes('pm_card_visa'), 'el providerRef salió en la lista');
    assert.ok(!serialized.includes('providerRef'));
  });
});
