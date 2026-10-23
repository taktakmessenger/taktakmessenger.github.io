const crypto = require('crypto');
const env = require('../config/env');

// Stripe, por REST directo con `fetch`.
//
// No se añade el SDK oficial por la misma razón que `smsService` habla con
// Twilio a pelo: son dos llamadas HTTP y una firma HMAC, y una dependencia más
// que mantener y auditar para eso no se paga sola.

const STRIPE_API = 'https://api.stripe.com/v1';

// Tolerancia de la firma del webhook. Stripe firma con una marca de tiempo; sin
// este margen, un evento capturado se podría reenviar días después y seguiría
// siendo válido.
const SIGNATURE_TOLERANCE_SECONDS = 300;

function isConfigured() {
  return Boolean(env.stripeSecretKey);
}

// Los precios van en la moneda con su unidad mínima: Stripe cobra en céntimos,
// así que 4.99 son 499. Convertir aquí, en un solo sitio, evita el clásico
// cobro de 499 dólares por un paquete de 4.99.
function toMinorUnits(usd) {
  return Math.round(Number(usd) * 100);
}

function formEncode(params, prefix = '') {
  const pairs = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object' && !Array.isArray(value)) {
      pairs.push(formEncode(value, name));
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item !== null && typeof item === 'object') {
          pairs.push(formEncode(item, `${name}[${index}]`));
        } else {
          pairs.push(`${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(item)}`);
        }
      });
    } else {
      pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
    }
  }
  return pairs.filter(Boolean).join('&');
}

async function stripeRequest(path, body) {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formEncode(body),
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }

  if (!response.ok) {
    // El cuerpo de error de Stripe puede traer detalles de la cuenta. Se
    // registra para depurar, pero no se reenvía al cliente.
    console.error('[STRIPE] Error', response.status, text.slice(0, 400));
    throw new Error('No se pudo iniciar el pago con tarjeta');
  }

  return parsed;
}

/**
 * Crea una sesión de pago alojada por Stripe.
 *
 * El importe y el usuario viajan como datos fijados aquí, no como algo que el
 * cliente pueda elegir: `packageId` se resuelve contra el catálogo del servidor
 * y `userId` sale del token. El navegador solo recibe la URL a la que ir.
 */
async function createCheckoutSession({ userId, pkg, successUrl, cancelUrl }) {
  const session = await stripeRequest('/checkout/sessions', {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: String(userId),
    // El metadata es lo que vuelve en el webhook. Es la única forma de saber a
    // quién acreditar cuando llega el evento: el webhook no lleva sesión.
    metadata: {
      userId: String(userId),
      packageId: pkg.id,
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: toMinorUnits(pkg.priceUsd),
          product_data: {
            name: `${pkg.coins} monedas TAK TAK`,
            description: `Paquete ${pkg.id}`,
          },
        },
      },
    ],
  });

  return { id: session.id, url: session.url };
}

/**
 * Comprueba la firma del webhook contra el cuerpo CRUDO.
 *
 * Tiene que ser el cuerpo sin parsear: si se firma el objeto reserializado, los
 * espacios y el orden de las claves cambian y la firma no cuadra nunca. De ahí
 * que `app.js` guarde `req.rawBody`.
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!env.stripeWebhookSecret) return false;
  if (!rawBody || !signatureHeader) return false;

  const parts = String(signatureHeader)
    .split(',')
    .reduce((acc, part) => {
      const [key, value] = part.split('=');
      if (key && value) acc[key.trim()] = value.trim();
      return acc;
    }, {});

  const timestamp = parts.t;
  const provided = parts.v1;
  if (!timestamp || !provided) return false;

  // Rechaza eventos viejos: sin esto, un webhook capturado se puede reenviar
  // más tarde y seguiría validando.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = crypto
    .createHmac('sha256', env.stripeWebhookSecret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Traduce un evento de Stripe a la compra que representa.
 *
 * Devuelve null para cualquier evento que no sea un pago completado, para que
 * el llamador no tenga que conocer el catálogo de eventos de Stripe.
 */
function parseCompletedPayment(event) {
  if (event?.type !== 'checkout.session.completed') return null;
  const session = event.data?.object;
  if (!session) return null;

  // Una sesión puede completarse sin que el dinero esté cobrado (por ejemplo,
  // con métodos de pago asíncronos). Solo se acredita si Stripe dice que está
  // pagada.
  if (session.payment_status && session.payment_status !== 'paid') return null;

  return {
    externalId: `stripe:${session.id}`,
    userId: session.metadata?.userId || session.client_reference_id,
    packageId: session.metadata?.packageId,
    // Importe real cobrado, en la unidad mínima. Se usa para verificar contra
    // el precio del catálogo antes de acreditar.
    amountPaidMinor: session.amount_total,
    currency: (session.currency || 'usd').toUpperCase(),
  };
}

module.exports = {
  isConfigured,
  createCheckoutSession,
  verifyWebhookSignature,
  parseCompletedPayment,
  toMinorUnits,
};
