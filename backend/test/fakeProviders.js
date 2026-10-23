// Servidor falso de Stripe y PayPal para los tests.
//
// Se levanta un HTTP real en localhost y se apunta `stripeApiBase` /
// `paypalApiBase` a él. Así las rutas ejercitan el mismo código que en
// producción (form-encode, cabeceras, parseo de la respuesta) en vez de
// sustituir las funciones por dobles, que es donde se cuelan los fallos de
// integración: un doble nunca se queja de que falte la cabecera de idempotencia.
const http = require('http');

// Tarjetas que el falso conoce. Los datos de presentación salen de aquí, no del
// cliente, igual que en Stripe real.
const CARDS = {
  pm_card_visa: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
  pm_card_mastercard: { brand: 'mastercard', last4: '4444', exp_month: 5, exp_year: 2029 },
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Arranca el servidor falso.
 *
 * `behavior` permite forzar respuestas concretas por ruta:
 *   behavior.setupIntentStatus, behavior.chargeStatus, behavior.chargeError,
 *   behavior.detachFails
 */
async function startFakeProviders(behavior = {}) {
  const calls = { stripe: [], paypal: [] };
  let paypalTokenIssued = 0;

  const server = http.createServer(async (req, res) => {
    const url = req.url || '';
    const body = await readBody(req);

    // --- PayPal ---
    if (url.startsWith('/v1/oauth2/token')) {
      paypalTokenIssued += 1;
      return json(res, 200, { access_token: 'fake-token', expires_in: 3600 });
    }

    if (url === '/v2/checkout/orders' && req.method === 'POST') {
      calls.paypal.push({ url, body, headers: req.headers });
      // Alta de método (vault) frente a cobro contra un vault_id.
      const isVault = body.includes('store_in_vault');
      if (isVault) {
        return json(res, 201, {
          id: 'ORDER-VAULT-1',
          status: 'CREATED',
          links: [{ rel: 'approve', href: 'https://fake.paypal/approve/ORDER-VAULT-1' }],
        });
      }
      return json(res, 201, { id: 'ORDER-CHARGE-1', status: 'COMPLETED' });
    }

    if (url.startsWith('/v2/checkout/orders/') && url.endsWith('/capture')) {
      calls.paypal.push({ url, body, headers: req.headers });
      if (behavior.captureWithoutVault) {
        return json(res, 201, { id: 'ORDER-VAULT-1', status: 'COMPLETED' });
      }
      return json(res, 201, {
        id: 'ORDER-VAULT-1',
        status: 'COMPLETED',
        payer: { email_address: 'pagador@example.com' },
        payment_source: {
          paypal: {
            email_address: 'pagador@example.com',
            attributes: { vault: { id: 'VAULT-ABC-123' } },
          },
        },
      });
    }

    // --- Stripe ---
    calls.stripe.push({ url, body, headers: req.headers });

    if (url === '/customers') {
      return json(res, 200, { id: 'cus_fake_1' });
    }

    if (url === '/setup_intents') {
      const status = behavior.setupIntentStatus || 'requires_payment_method';
      return json(res, 200, { id: 'seti_fake_1', client_secret: 'seti_fake_1_secret', status });
    }

    if (url.startsWith('/payment_methods/pm_') && url.endsWith('/attach')) {
      return json(res, 200, { id: url.split('/')[2] });
    }

    if (url.startsWith('/payment_methods/pm_') && url.endsWith('/detach')) {
      if (behavior.detachFails) {
        return json(res, 500, { error: { message: 'boom' } });
      }
      return json(res, 200, { id: url.split('/')[2] });
    }

    if (url.startsWith('/payment_methods/pm_')) {
      const id = url.split('/')[2];
      const card = CARDS[id];
      if (!card) return json(res, 404, { error: { message: 'No such payment method' } });
      return json(res, 200, { id, type: 'card', card });
    }

    if (url === '/payment_intents') {
      if (behavior.chargeError) {
        return json(res, 402, { error: { message: behavior.chargeError } });
      }
      const status = behavior.chargeStatus || 'succeeded';
      return json(res, 200, {
        id: 'pi_fake_1',
        status,
        amount: 21999,
        amount_received: status === 'succeeded' ? 21999 : 0,
        currency: 'usd',
      });
    }

    return json(res, 404, { error: { message: `ruta no simulada: ${url}` } });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stripeUrl: `http://127.0.0.1:${port}`,
    paypalUrl: `http://127.0.0.1:${port}`,
    calls,
    get paypalTokenCalls() {
      return paypalTokenIssued;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { startFakeProviders, CARDS };
