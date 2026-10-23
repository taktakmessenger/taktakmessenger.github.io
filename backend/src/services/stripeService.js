const crypto = require('crypto');
const env = require('../config/env');

// Stripe, por REST directo con `fetch`.
//
// No se añade el SDK oficial por la misma razón que `smsService` habla con
// Twilio a pelo: son dos llamadas HTTP y una firma HMAC, y una dependencia más
// que mantener y auditar para eso no se paga sola.

// Se lee la base en cada llamada, no al cargar el módulo: así los tests pueden
// apuntarla a un servidor falso local sin reimportar el módulo, y un cambio de
// configuración en caliente surte efecto.
function apiBase() {
  return env.stripeApiBase;
}

// Tolerancia de la firma del webhook. Stripe firma con una marca de tiempo; sin
// este margen, un evento capturado se podría reenviar días después y seguiría
// siendo válido.
const SIGNATURE_TOLERANCE_SECONDS = 300;

function isConfigured() {
  return Boolean(env.stripeSecretKey);
}

// Clave publicable: la necesita el navegador para tokenizar la tarjeta contra
// Stripe. No es un secreto (va en el HTML de cualquier tienda), pero se sirve
// desde aquí para que no haya que reconstruir el frontend al cambiar de cuenta.
function publishableKey() {
  return env.stripePublishableKey || null;
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

async function stripeRequest(path, body, { method = 'POST', idempotencyKey } = {}) {
  const headers = {
    Authorization: `Bearer ${env.stripeSecretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  // Stripe lee la clave de idempotencia de la cabecera, no del cuerpo. Va aquí
  // y no como parámetro del formulario porque un campo `idempotency_key` en el
  // cuerpo se ignoraría en silencio y el reintento cobraría dos veces.
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : formEncode(body || {}),
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

// --- Guardar tarjetas -----------------------------------------------------
//
// El navegador manda el número de tarjeta DIRECTO a Stripe con la clave
// publicable, y recibe un `pm_...`. Ese identificador es lo único que llega a
// nuestro servidor: el número nunca pasa por aquí. Guardarlo sería asumir el
// coste entero de PCI-DSS y convertir un vuelco de base de datos en un lote de
// tarjetas usables.

/**
 * Crea un SetupIntent: la sesión con la que el navegador guarda una tarjeta sin
 * cobrarla. Devuelve el `client_secret` que necesita Stripe.js.
 *
 * Se crea contra un cliente de Stripe (`customer`) porque un cobro posterior sin
 * el titular delante (`off_session`) exige que la tarjeta cuelgue de un cliente.
 * Sin ese vínculo, Stripe rechaza el cargo con "no such customer attached".
 */
async function createSetupIntent({ customerId }) {
  const intent = await stripeRequest('/setup_intents', {
    customer: customerId,
    // Un método de pago "de uso futuro": se guarda para cobrarlo más tarde, no
    // ahora. Sin esto, Stripe lo trataría como un pago suelto.
    usage: 'off_session',
    'automatic_payment_methods[enabled]': true,
  });

  return { clientSecret: intent.client_secret, id: intent.id };
}

// Crea el cliente de Stripe que agrupa las tarjetas de un usuario.
async function createCustomer({ userId, email }) {
  const customer = await stripeRequest('/customers', {
    email: email || undefined,
    metadata: { userId: String(userId) },
  });
  return customer.id;
}

// Vincula una tarjeta ya tokenizada al cliente. Hasta que no se vincula, la
// tarjeta existe en Stripe pero no se puede cobrar sin el usuario delante.
async function attachPaymentMethod({ paymentMethodId, customerId }) {
  return stripeRequest(`/payment_methods/${paymentMethodId}/attach`, {
    customer: customerId,
  });
}

/**
 * Recupera un método de pago ya tokenizado para comprobar que existe y sacar
 * los datos de presentación (marca, últimos cuatro, caducidad).
 *
 * Los últimos cuatro dígitos se piden a Stripe en vez de aceptarlos del cliente:
 * si el cliente los mandara, podría etiquetar su tarjeta como "Visa •••• 4242"
 * cuando en realidad es otra.
 */
async function retrievePaymentMethod(paymentMethodId) {
  const pm = await stripeRequest(`/payment_methods/${paymentMethodId}`, null, { method: 'GET' });
  const card = pm.card || {};
  return {
    id: pm.id,
    type: pm.type,
    brand: card.brand || null,
    last4: card.last4 || null,
    expMonth: card.exp_month ?? null,
    expYear: card.exp_year ?? null,
  };
}

// Desvincula una tarjeta. Si falla, el método se marca revocado igualmente en
// nuestro lado: lo que no puede pasar es que un método borrado siga cobrando.
async function detachPaymentMethod(paymentMethodId) {
  return stripeRequest(`/payment_methods/${paymentMethodId}/detach`, {});
}

/**
 * Cobra un método ya guardado, sin que el usuario esté delante.
 *
 * `off_session: true` le dice a Stripe que el titular no está completando el
 * pago en este momento; si el banco exige autenticación (3-D Secure), Stripe
 * lo devolverá como error en vez de cobrar a ciegas, y ese error se propaga
 * para pedirle al usuario que confirme.
 */
async function chargeStoredPaymentMethod({ paymentMethodId, customerId, userId, pkg, idempotencyKey }) {
  const intent = await stripeRequest(
    '/payment_intents',
    {
      amount: toMinorUnits(pkg.priceUsd),
      currency: 'usd',
      payment_method: paymentMethodId,
      // El cliente y la tarjeta van juntos: un cobro off_session contra una
      // tarjeta que no cuelga de un cliente se rechaza.
      customer: customerId,
      confirm: true,
      off_session: true,
      metadata: { userId: String(userId), packageId: pkg.id },
    },
    // Clave de idempotencia: si el navegador reintenta por un timeout, Stripe
    // devuelve el mismo cobro en vez de cobrar dos veces.
    { idempotencyKey }
  );

  return {
    id: intent.id,
    status: intent.status,
    amountTotal: intent.amount_received ?? intent.amount,
    currency: (intent.currency || 'usd').toUpperCase(),
  };
}

module.exports = {
  isConfigured,
  publishableKey,
  createCheckoutSession,
  createSetupIntent,
  createCustomer,
  attachPaymentMethod,
  retrievePaymentMethod,
  detachPaymentMethod,
  chargeStoredPaymentMethod,
  verifyWebhookSignature,
  parseCompletedPayment,
  toMinorUnits,
};
