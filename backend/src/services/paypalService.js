const env = require('../config/env');

// PayPal, por REST directo (Orders v2) con `fetch`.
//
// PayPal no firma con HMAC: manda cinco cabeceras con una firma RSA y hay que
// preguntarle a él si son suyas. Es un viaje de ida y vuelta por cada webhook,
// pero es la vía simple y la que PayPal documenta como preferida; verificar la
// firma por nuestra cuenta exigiría descargar y cachear su certificado.

let cachedToken = null;

function isConfigured() {
  return Boolean(env.paypalClientId && env.paypalClientSecret);
}

// El webhook necesita además su propio id para poder verificar. Sin él, el
// endpoint se cierra aunque el cobro esté configurado.
function canVerifyWebhooks() {
  return isConfigured() && Boolean(env.paypalWebhookId);
}

async function request(path, { method = 'GET', body, token, idempotencyKey } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  // PayPal usa la cabecera estándar de idempotencia. Un reintento del navegador
  // tras un timeout devuelve la misma orden en vez de cobrar dos veces.
  if (idempotencyKey) headers['PayPal-Request-Id'] = idempotencyKey;

  const response = await fetch(`${env.paypalApiBase}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }

  if (!response.ok) {
    // Se registra el detalle para depurar, pero no se devuelve al cliente: el
    // cuerpo de error de PayPal puede incluir datos de la cuenta.
    console.error('[PAYPAL] Error', response.status, text.slice(0, 400));
    const err = new Error('No se pudo completar la operación con PayPal');
    err.status = response.status;
    throw err;
  }

  return parsed;
}

// Token de aplicación, con caché. PayPal lo emite para ~9 horas; pedir uno
// nuevo en cada petición sería un viaje extra por cada cobro.
async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const credentials = Buffer.from(
    `${env.paypalClientId}:${env.paypalClientSecret}`
  ).toString('base64');

  const response = await fetch(`${env.paypalApiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const text = await response.text();
  if (!response.ok) {
    console.error('[PAYPAL] No se pudo obtener el token', response.status, text.slice(0, 300));
    throw new Error('PayPal no está disponible en este momento');
  }

  const data = JSON.parse(text);
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return cachedToken.value;
}

/**
 * Crea una orden de pago.
 *
 * Igual que en Stripe, el importe sale del catálogo del servidor. `custom_id`
 * es lo que PayPal devuelve en el webhook, y es donde viaja el usuario: sin él
 * el evento llegaría sin saber a quién acreditar.
 */
async function createOrder({ userId, pkg, returnUrl, cancelUrl }) {
  const token = await getAccessToken();

  const order = await request('/v2/checkout/orders', {
    method: 'POST',
    token,
    body: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          // `custom_id` es el único campo que PayPal devuelve tal cual en el
          // webhook de captura. Lleva usuario y paquete juntos para que el
          // evento se pueda acreditar sin adivinar nada; PayPal admite hasta
          // 127 caracteres y esto no llega ni a la mitad.
          custom_id: `${userId}|${pkg.id}`,
          description: `${pkg.coins} monedas TAK TAK (${pkg.id})`,
          amount: {
            currency_code: env.paypalCurrency,
            // PayPal exige dos decimales como cadena. `toFixed` es justo eso.
            value: Number(pkg.priceUsd).toFixed(2),
          },
        },
      ],
      application_context: {
        brand_name: 'TAK TAK',
        user_action: 'PAY_NOW',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    },
  });

  // La URL de aprobación es donde hay que mandar al usuario. El id de la orden
  // no basta: hay que buscar el enlace con `rel: approve`.
  const approve = (order.links || []).find((l) => l.rel === 'approve');
  if (!approve) throw new Error('PayPal no devolvió una URL de pago');

  return { id: order.id, url: approve.href };
}

// Captura una orden ya aprobada por el usuario. Es el paso que mueve el dinero.
async function captureOrder(orderId) {
  const token = await getAccessToken();
  return request(`/v2/checkout/orders/${orderId}/capture`, { method: 'POST', token });
}

// --- Guardar la cuenta de PayPal (vault) ----------------------------------
//
// PayPal no permite "guardar una tarjeta" al estilo de Stripe: lo que se guarda
// es la aprobación del usuario sobre su cuenta, y con ella un `vault_id` con el
// que se puede cobrar después sin volver a pasar por su pantalla.
//
// Ese id es un secreto de cobro: quien lo tenga puede cobrar a esa cuenta. Por
// eso vive en `providerRef`, que nunca sale del servidor.

/**
 * Crea una orden con intención de guardar el método de pago.
 *
 * `vault` le dice a PayPal que además de cobrar (o en vez de cobrar) queremos
 * el identificador reutilizable. Se guarda en la misma orden del cobro para que
 * el usuario apruebe una sola vez.
 */
async function createVaultOrder({ userId, returnUrl, cancelUrl }) {
  const token = await getAccessToken();

  const order = await request('/v2/checkout/orders', {
    method: 'POST',
    token,
    body: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          custom_id: `${userId}|vault`,
          description: 'Guardar cuenta de PayPal en TAK TAK',
          amount: {
            currency_code: env.paypalCurrency,
            value: '0.00',
          },
          // El bloque que pide el token de cobro reutilizable.
          payment_instruction: {
            disbursement_mode: 'INSTANT',
          },
        },
      ],
      payment_source: {
        paypal: {
          attributes: {
            vault: { store_in_vault: 'ON_SUCCESS', usage_type: 'MERCHANT' },
          },
          experience_context: {
            brand_name: 'TAK TAK',
            user_action: 'CONTINUE',
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    },
  });

  const approve = (order.links || []).find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  if (!approve) throw new Error('PayPal no devolvió una URL de aprobación');

  return { id: order.id, url: approve.href };
}

/**
 * Saca el `vault_id` de una orden ya aprobada.
 *
 * PayPal devuelve el identificador en sitios distintos según cómo se completó
 * la orden, así que se buscan todos los caminos conocidos antes de rendirse.
 * Sin `vault_id` no hay nada que guardar, y es mejor fallar en claro que
 * guardar un método que luego no puede cobrar.
 */
function extractVaultId(order) {
  const unit = order?.purchase_units?.[0];

  return (
    order?.payment_source?.paypal?.attributes?.vault?.id ||
    unit?.payment_instruction?.payee_pricing_tier_id ||
    unit?.payments?.captures?.[0]?.payment_source?.paypal?.attributes?.vault?.id ||
    null
  );
}

// Trae el correo del pagador, que es lo que se enseña en la lista de métodos
// para que el usuario reconozca su cuenta.
function extractPayerEmail(order) {
  return order?.payment_source?.paypal?.email_address || order?.payer?.email_address || null;
}

/**
 * Cobra usando un `vault_id` guardado, sin que el usuario esté delante.
 *
 * Igual que en Stripe: el importe sale del catálogo del servidor, nunca de lo
 * que diga el cliente.
 */
async function chargeStoredVault({ vaultId, userId, pkg, idempotencyKey }) {
  const token = await getAccessToken();

  const order = await request(
    '/v2/checkout/orders',
    {
      method: 'POST',
      token,
      body: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            custom_id: `${userId}|${pkg.id}`,
            description: `${pkg.coins} monedas TAK TAK (${pkg.id})`,
            amount: {
              currency_code: env.paypalCurrency,
              value: Number(pkg.priceUsd).toFixed(2),
            },
          },
        ],
        payment_source: {
          paypal: {
            // Cobro contra la aprobación guardada: el titular no está delante.
            vault_id: vaultId,
          },
        },
      },
    },
    idempotencyKey
  );

  return { id: order.id, status: order.status };
}

/**
 * Le pregunta a PayPal si un webhook es auténtico.
 *
 * Se reconstruye el payload con las cinco cabeceras de firma y el cuerpo tal
 * cual llegó. PayPal responde `verification_status: 'SUCCESS'` o `'FAILURE'`.
 */
async function verifyWebhookSignature({ headers, rawBody }) {
  if (!canVerifyWebhooks()) return false;

  const token = await getAccessToken();
  const result = await request('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    token,
    body: {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: env.paypalWebhookId,
      webhook_event: JSON.parse(rawBody.toString('utf8')),
    },
  });

  return result.verification_status === 'SUCCESS';
}

/**
 * Traduce un evento de PayPal a la compra que representa.
 *
 * `CHECKOUT.ORDER.APPROVED` y `PAYMENT.CAPTURE.COMPLETED` llegan en momentos
 * distintos: el primero cuando el usuario aprueba, el segundo cuando el dinero
 * está cobrado. Solo el segundo acredita monedas.
 */
function parseCompletedPayment(event) {
  if (event?.event_type !== 'PAYMENT.CAPTURE.COMPLETED') return null;
  const capture = event.resource;
  if (!capture) return null;

  // El `custom_id` viaja en el purchase_unit, no en la captura: hay que
  // rebuscarlo en el recurso que PayPal manda.
  const unit = capture.purchase_units?.[0];
  const custom = unit?.custom_id || capture.custom_id || '';
  const [userId, packageId] = String(custom).split('|');

  const amount = capture.amount || {};

  return {
    externalId: `paypal:${capture.id}`,
    userId: userId || null,
    packageId: packageId || null,
    amountPaidMinor: Math.round(Number(amount.value) * 100),
    currency: (amount.currency_code || env.paypalCurrency).toUpperCase(),
    orderId: capture.supplementary_data?.related_ids?.order_id || null,
  };
}

// Solo para los tests: deja limpia la caché del token entre casos.
function _resetTokenCache() {
  cachedToken = null;
}

module.exports = {
  isConfigured,
  canVerifyWebhooks,
  createOrder,
  captureOrder,
  createVaultOrder,
  extractVaultId,
  extractPayerEmail,
  chargeStoredVault,
  verifyWebhookSignature,
  parseCompletedPayment,
  _resetTokenCache,
};
