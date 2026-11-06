require('dotenv').config();

const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';

// In production every secret must be supplied explicitly. Failing fast here is
// deliberate: silently falling back to a default signing key would let anyone
// forge tokens for a live deployment.
function requiredInProduction(name) {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return null;
}

// Revenue split for every gift. The creator keeps 60% and the platform 40%,
// versus the 30-50% creators get on TikTok. Both values must add up to 1.
function resolveShares() {
  const creatorShare = Number(process.env.CREATOR_SHARE ?? 0.6);
  const platformShare = Number(process.env.PLATFORM_SHARE ?? 1 - creatorShare);

  if (!Number.isFinite(creatorShare) || creatorShare <= 0 || creatorShare >= 1) {
    throw new Error('CREATOR_SHARE must be a fraction between 0 and 1');
  }
  // A mismatch here would silently create or destroy tokens, so it is fatal.
  if (Math.abs(creatorShare + platformShare - 1) > 1e-9) {
    throw new Error(
      `CREATOR_SHARE (${creatorShare}) and PLATFORM_SHARE (${platformShare}) must sum to 1`
    );
  }
  return { creatorShare, platformShare };
}

const shares = resolveShares();

// Valor de referencia de 1 TTC al retirar o convertir, en dólares. Es el techo
// de lo que la plataforma puede llegar a pagar por una moneda, así que fija el
// suelo de los precios de venta: si un paquete vende el TTC por debajo de esta
// cifra, cualquiera puede comprar, convertir a Diamantes y retirar más de lo que
// pagó. El NAV de la empresa (base del precio de la acción) se hundiría con el
// uso, y el agujero crecería con cada venta.
const ttcUsdRate = Number(process.env.TTC_USD_RATE ?? 0.01);
if (!Number.isFinite(ttcUsdRate) || ttcUsdRate <= 0) {
  throw new Error('TTC_USD_RATE must be a positive number');
}

// STUN público por defecto: descubre la dirección propia y basta para llamar
// dentro de la misma red. TURN es lo que permite cruzar NAT estricto, y se
// configura con TURN_URL (varias separadas por coma), TURN_USERNAME y
// TURN_CREDENTIAL.
//
// Se admite además ICE_SERVERS_JSON para configuraciones que no encajan en esas
// tres variables (varios TURN con credenciales distintas, por ejemplo). Tiene
// prioridad sobre las variables sueltas.
function resolveIceServers() {
  const defaultStun = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  if (process.env.ICE_SERVERS_JSON) {
    let parsed;
    try {
      parsed = JSON.parse(process.env.ICE_SERVERS_JSON);
    } catch {
      // Un JSON inválido dejaría las llamadas sin ICE y fallarían de forma
      // difícil de diagnosticar: es mejor no arrancar.
      throw new Error('ICE_SERVERS_JSON is not valid JSON');
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('ICE_SERVERS_JSON must be a non-empty array');
    }
    return parsed;
  }

  const turnUrls = (process.env.TURN_URL || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  if (turnUrls.length === 0) return defaultStun;

  // Un TURN sin credenciales no autentica y el servidor lo rechazará. Fallar
  // aquí, al arrancar, es más claro que una llamada que se queda "conectando".
  if (!process.env.TURN_USERNAME || !process.env.TURN_CREDENTIAL) {
    throw new Error(
      'TURN_URL is set but TURN_USERNAME or TURN_CREDENTIAL is missing'
    );
  }

  return [
    ...defaultStun,
    {
      urls: turnUrls,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    },
  ];
}

// Coin packages are defined server-side. The purchase webhook looks the amount
// up by id, so a forged request cannot mint coins it did not pay for.
//
// Prices must clear `ttcUsdRate` (the withdrawal rate), not just the creator
// payout: a coin that can be bought below what it is redeemed for is free money
// the moment a C→R conversion exists. The ladder therefore descends from
// $0,01398 to $0,01100 per TTC, always above the $0,01 floor, and never
// inverts (a bigger pack is always cheaper per coin).
const DEFAULT_COIN_PACKAGES = [
  { id: 'starter', coins: 500, priceUsd: 6.99 },
  { id: 'popular', coins: 1000, priceUsd: 12.99 },
  { id: 'value', coins: 5000, priceUsd: 59.99 },
  { id: 'mega', coins: 20000, priceUsd: 219.99 },
];

function resolveCoinPackages() {
  if (!process.env.COIN_PACKAGES) return assertPackagesCoverPayout(DEFAULT_COIN_PACKAGES);
  let parsed;
  try {
    parsed = JSON.parse(process.env.COIN_PACKAGES);
  } catch {
    throw new Error('COIN_PACKAGES must be valid JSON');
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('COIN_PACKAGES must be a non-empty array');
  }

  const seen = new Set();
  const packages = parsed.map((pkg) => {
    if (!pkg?.id || !Number.isFinite(pkg.coins) || pkg.coins <= 0) {
      throw new Error('Each coin package needs an id and a positive coin count');
    }
    if (!Number.isFinite(pkg.priceUsd) || pkg.priceUsd <= 0) {
      throw new Error(`Coin package "${pkg.id}" needs a positive priceUsd`);
    }
    if (seen.has(pkg.id)) throw new Error(`Duplicate coin package id: ${pkg.id}`);
    seen.add(pkg.id);
    return { id: pkg.id, coins: pkg.coins, priceUsd: pkg.priceUsd };
  });

  return assertPackagesCoverPayout(packages);
}

/**
 * Ningún paquete puede venderse por debajo del valor al que la moneda se
 * redime. El suelo es `ttcUsdRate` (la tasa de retiro), no
 * `creatorShare × ttcUsdRate`: el regalo solo paga el 60%, pero el retiro paga
 * el 100%, y es el retiro el que marca el techo de lo que la plataforma puede
 * desembolsar por una moneda.
 *
 * Con el suelo en el regalo (lo que se hacía antes), un paquete podía venderse
 * a $0,0085 — por encima del pago al creador pero por debajo del retiro. Mientras
 * no exista conversión Monedas→Diamantes la fuga está latente; en cuanto se
 * añada, comprar y retirar da beneficio y el NAV se hunde. Es un fallo de
 * configuración, no de operación, así que se detecta al arrancar.
 */
function assertPackagesCoverPayout(packages) {
  const payoutPerTtc = ttcUsdRate;
  for (const pkg of packages) {
    const salePerTtc = pkg.priceUsd / pkg.coins;
    if (salePerTtc < payoutPerTtc) {
      throw new Error(
        `El paquete "${pkg.id}" vende el TTC a $${salePerTtc.toFixed(6)}, por debajo de lo que ` +
          `se paga al retirar ($${payoutPerTtc.toFixed(6)}). Comprar y retirar daría beneficio.`
      );
    }
  }
  return packages;
}

/**
 * Métodos de cobro manual configurados.
 *
 * El operador declara, en `MANUAL_PAYMENT_METHODS`, dónde cobra y con qué
 * etiqueta. Es JSON para poder añadir un método sin tocar código:
 *
 *   [{"id":"paypal","label":"PayPal","link":"https://paypal.me/ejemplo",
 *     "details":"Paga con PayPal y pega el número de operación."}]
 *
 * `id` es lo que se guarda en la orden; `label` es lo que ve el usuario; `details`
 * son las instrucciones de pago que se le muestran y `link` es un enlace directo
 * a la página de pago (opcional) para que el usuario no tenga que buscar a quién
 * pagar. `payTo` es un dato de pago directo (correo, cuenta) que se muestra
 * además del enlace. Sin lista, la tienda no ofrece cobro manual y la única vía
 * son las pasarelas.
 */
function resolveManualPaymentMethods() {
  if (!process.env.MANUAL_PAYMENT_METHODS) return [];

  let parsed;
  try {
    parsed = JSON.parse(process.env.MANUAL_PAYMENT_METHODS);
  } catch {
    throw new Error('MANUAL_PAYMENT_METHODS must be valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('MANUAL_PAYMENT_METHODS must be an array');
  }

  const seen = new Set();
  return parsed.map((method) => {
    if (!method?.id || !method?.label) {
      throw new Error('Cada método manual necesita un id y un label');
    }
    if (seen.has(method.id)) {
      throw new Error(`Duplicate manual payment method id: ${method.id}`);
    }
    seen.add(method.id);
    return {
      id: String(method.id).slice(0, 40),
      label: String(method.label).slice(0, 60),
      details: method.details ? String(method.details).slice(0, 500) : '',
      link: resolvePaymentLink(method.link),
      // Dato de pago directo (un correo de Zinli, una cuenta…). Se muestra
      // junto al enlace para quien prefiere pagar sin abrir otra página.
      payTo: method.payTo ? String(method.payTo).trim().slice(0, 120) : '',
    };
  });
}

// Solo se aceptan enlaces http(s): un valor como `javascript:` acabaría siendo
// un botón ejecutable en la tienda, así que se descarta en el servidor y no se
// confía en que el front lo filtre.
function resolvePaymentLink(link) {
  if (!link) return '';
  const value = String(link).trim();
  if (!/^https?:\/\//i.test(value)) return '';
  return value.slice(0, 300);
}

// Porcentaje del programa de referidos. Fuera de [0,1) es un error de
// configuración, no una decisión: un 1 o más pagaría al invitador tanto o más de
// lo que el invitado compró, y el programa perdería dinero en cada venta.
function resolveReferralPercent() {
  const raw = process.env.REFERRAL_PERCENT ?? 0.1;
  const percent = Number(raw);
  if (!Number.isFinite(percent) || percent < 0 || percent >= 1) {
    throw new Error('REFERRAL_PERCENT must be a fraction between 0 and 1');
  }
  return percent;
}

const referralPercent = resolveReferralPercent();

/**
 * Retiros de Diamantes: los topes que protegen al usuario y a la casa.
 *
 * `min` es en Diamantes (1 Diamante = 1 TTC). Un mínimo de 100 Diamantes son
 * $1,00 con la tasa por defecto: por debajo, la comisión de la pasarela se come
 * el importe y el retiro no tiene sentido. `dailyCap` es el máximo de Diamantes
 * que una cuenta puede pedir en 24 h; frena tanto un error del usuario como el
 * vaciado de una cuenta robada, que es el riesgo real de dejar retiros sin tope.
 * `holdHours` es el tiempo que un retiro queda retenido antes de poder pagarse,
 * para dar margen a revertir un fraude detectado tarde.
 */
function resolveWithdrawals() {
  const min = Number(process.env.WITHDRAWAL_MIN ?? 100);
  const dailyCap = Number(process.env.WITHDRAWAL_DAILY_CAP ?? 10000);
  const holdHours = Number(process.env.WITHDRAWAL_HOLD_HOURS ?? 0);

  if (!Number.isFinite(min) || min <= 0) {
    throw new Error('WITHDRAWAL_MIN must be a positive number');
  }
  if (!Number.isFinite(dailyCap) || dailyCap < min) {
    throw new Error('WITHDRAWAL_DAILY_CAP must be a number >= WITHDRAWAL_MIN');
  }
  if (!Number.isFinite(holdHours) || holdHours < 0) {
    throw new Error('WITHDRAWAL_HOLD_HOURS must be zero or a positive number');
  }
  return { min, dailyCap, holdHours };
}

const withdrawals = resolveWithdrawals();

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  // Rate limiters are skipped in tests: a single test file issues far more
  // requests than a real user ever would, so throttling would fail the suite
  // rather than protect anything. Production behaviour is unaffected.
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/taktak',
  jwtSecret:
    requiredInProduction('JWT_SECRET') ||
    'dev-only-insecure-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // Access tokens are short-lived; the refresh token (below) is what carries a
  // long session. A leaked access token is useless within the hour.
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '1h',
  corsOrigin: process.env.CORS_ORIGIN || '*',

  // Feed ranking model. Weights are relative, not absolute: only their ratios
  // matter. They encode product intent (a share is worth more than a like),
  // which is why they are configuration rather than hard-coded.
  feedWeights: {
    like: Number(process.env.FEED_WEIGHT_LIKE ?? 3),
    comment: Number(process.env.FEED_WEIGHT_COMMENT ?? 4),
    share: Number(process.env.FEED_WEIGHT_SHARE ?? 6),
    gift: Number(process.env.FEED_WEIGHT_GIFT ?? 10),
    view: Number(process.env.FEED_WEIGHT_VIEW ?? 1),
    complete: Number(process.env.FEED_WEIGHT_COMPLETE ?? 2),
  },
  // Hours for a video's popularity to lose half its weight.
  feedHalfLifeHours: Number(process.env.FEED_HALF_LIFE_HOURS ?? 48),
  // Window during which a new, under-exposed video receives an exploration
  // boost, and how large that boost is (0.6 => up to +60%).
  feedColdStartHours: Number(process.env.FEED_COLD_START_HOURS ?? 6),
  feedExplorationBonus: Number(process.env.FEED_EXPLORATION_BONUS ?? 0.6),
  feedImpressionFloor: Number(process.env.FEED_IMPRESSION_FLOOR ?? 200),
  // Cap on how many videos one creator may occupy in a single page.
  feedMaxPerCreator: Number(process.env.FEED_MAX_PER_CREATOR ?? 2),
  // Size of the candidate pool fetched from Mongo before re-ranking.
  feedCandidatePool: Number(process.env.FEED_CANDIDATE_POOL ?? 300),

  // TTC economy split, expressed as a fraction of every gift.
  creatorShare: shares.creatorShare,
  platformShare: shares.platformShare,
  // Cuánto vale 1 TTC al retirar o convertir, en dólares. Junto con
  // `creatorShare` marca el suelo por debajo del cual ningún paquete puede
  // venderse (ver `assertPackagesCoverPayout`).
  ttcUsdRate,
  // Monedas de bienvenida que recibe una cuenta nueva. Son de regalo: se pueden
  // gastar en regalos, pero nunca convertirse en Diamantes retirables (ver
  // `sendGift`). Es lo que permite invitar sin abrir una vía de extracción de
  // dinero: por muchas cuentas que se creen, el regalo solo recircula monedas de
  // regalo.
  welcomeBonusCoins: Number(process.env.WELCOME_BONUS_COINS ?? 100),

  // Cuántos Diamantes da cada Moneda pagada al convertir. Solo el administrador
  // puede convertir (ver `convertCoinsToDiamonds` y la ruta admin), así que la
  // tasa por defecto es 1 a 1. Se deja configurable por si el dueño quiere
  // aplicar un descuento al canje.
  coinToDiamondRate: Number(process.env.COIN_TO_DIAMOND_RATE ?? 1),

  // Programa de referidos: quien invita cobra un porcentaje de lo que su
  // invitado compre, en monedas de regalo.
  //
  // El 10% del importe comprado es el porcentaje pedido. Se paga sobre lo que el
  // invitado pagó, no sobre las monedas que recibió: un 10% de lo comprado es
  // dinero que la plataforma ya ingresó, así que es un descuento sobre margen y
  // no una promesa pagada con dinero que no existe.
  //
  // Se abona SIEMPRE en monedas de regalo (`bonusC`): se gastan en la app
  // (regalos, torneos) pero nunca se convierten en Diamantes retirables. Así el
  // programa crece por dentro sin abrir una vía de extracción: si se pagara en
  // monedas pagadas, invitar a cuentas que compren sería una forma de fabricar
  // dinero canjeable.
  referral: {
    // 0 lo desactiva por completo (no se paga ningún premio).
    percent: referralPercent,
    // Longitud del código de invitación. 8 caracteres del alfabeto sin letras
    // ambiguas bastan de sobra: el código no es un secreto (se comparte), solo
    // tiene que ser único y fácil de leer por teléfono.
    codeLength: Number(process.env.REFERRAL_CODE_LENGTH ?? 8),
  },

  withdrawals: {
    // Mínimo por solicitud, en Diamantes. Por debajo, la comisión del proveedor
    // de pago se come el importe.
    min: withdrawals.min,
    // Tope por cuenta en 24 h, en Diamantes. Frena el vaciado de una cuenta
    // comprometida y los errores de dedo.
    dailyCap: withdrawals.dailyCap,
    // Horas que un retiro queda retenido antes de poder marcarse como pagado.
    holdHours: withdrawals.holdHours,
    // 1 Diamante = `ttcUsdRate` dólares. Se expone para que la UI pueda enseñar
    // el equivalente en dinero sin duplicar la tasa.
    usdRate: ttcUsdRate,
  },

  maxVideoBytes: Number(process.env.MAX_VIDEO_BYTES ?? 50 * 1024 * 1024),

  // POKERTAK: sala privada de póker de cada usuario, dentro del directo.
  //
  // Es un juego con monedas de la app, no dinero real. La casa (el
  // administrador) se queda `pokerRake` de cada bote jugado, en el tipo de
  // moneda con que se pagó: la parte de monedas pagadas es ingreso real y la de
  // monedas de regalo vuelve al circuito de regalo, igual que en los regalos.
  poker: {
    // Comisión de la casa: 1% de cada bote, igual en todas las manos, hasta que
    // se cierre el directo o la sala de juegos.
    rake: Number(process.env.POKER_RAKE ?? 0.01),
    // Asientos de la mesa. Nueve, como la mesa en vivo: caben todos los que
    // suelen entrar a un directo y la mesa sigue leyéndose en un móvil.
    maxSeats: Number(process.env.POKER_MAX_SEATS ?? 9),
    smallBlind: Number(process.env.POKER_SMALL_BLIND ?? 5),
    bigBlind: Number(process.env.POKER_BIG_BLIND ?? 10),
    // Entrada mínima y máxima, en monedas de la app. La mínima (10) es accesible
    // para cualquiera, incluso con el bono de bienvenida (100): nadie se queda
    // fuera de la mesa por no poder pagar. Dentro de ese rango, cada jugador
    // elige cuánto pone.
    minBuyIn: Number(process.env.POKER_MIN_BUYIN ?? 10),
    maxBuyIn: Number(process.env.POKER_MAX_BUYIN ?? 20000),
    // Tarifa de la casa en un torneo: se cobra una vez sobre todo lo recaudado,
    // no por mano. El reparto por defecto (40/30/20) y esta tarifa (10%) suman
    // el 100%: lo que no va a un puesto es lo que se queda la casa.
    eventRake: Number(process.env.POKER_EVENT_RAKE ?? 0.1),
  },

  // Where uploaded originals and their HLS renditions are written. Served
  // read-only at /uploads.
  uploadsDir: process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'),
  // Almacenamiento externo compatible con S3 (Cloudflare R2). Con esto activo,
  // los ficheros subidos se copian a un bucket y se sirven desde su URL pública,
  // en vez de quedarse en el disco efímero del contenedor. Render borra ese disco
  // en cada despliegue o reinicio, así que sin esto los vídeos desaparecen.
  //
  // Vacío = modo local (desarrollo y tests), exactamente como antes.
  r2: {
    endpoint: process.env.R2_ENDPOINT || null,
    accessKeyId: process.env.R2_ACCESS_KEY_ID || null,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || null,
    bucket: process.env.R2_BUCKET || null,
    // Base pública del bucket (https://pub-xxxx.r2.dev o el dominio propio). Sin
    // barra final. Es lo que se antepone a la clave para formar la URL servible.
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '') || null,
    // Región del proveedor S3. Cloudflare R2 no usa regiones reales y exige
    // `auto`; Backblaze B2 sí (p. ej. `us-west-004`) y hay que copiarla del
    // endpoint que da su panel.
    region: process.env.R2_REGION || 'auto',
    // Algunos proveedores (B2 entre ellos) necesitan que el bucket vaya en la
    // ruta (`/bucket/clave`) y no en el subdominio.
    forcePathStyle: process.env.R2_FORCE_PATH_STYLE === 'true',
  },
  // Built frontend to serve from the same process. Empty means "API only", so
  // the development setup and the test suite are unaffected.
  publicDir: process.env.PUBLIC_DIR || null,
  // Master switch for transcoding. Tests and small deployments leave it off so
  // they do not depend on a system ffmpeg binary.
  transcodeEnabled: process.env.TRANSCODE_ENABLED === 'true',
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',

  // Coin packages sold for real money. Prices are the source of truth for the
  // purchase webhook: the client never sends the amount it expects to pay.
  coinPackages: resolveCoinPackages(),

  // Shared secret for the payment webhook. Without it the endpoint stays
  // closed rather than trusting an unauthenticated POST.
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || null,

  // Pasarelas de cobro. Cada una se activa sola si están sus claves; si no,
  // la tienda enseña el paquete pero no deja pagar, en vez de aceptar un cobro
  // que nunca se va a procesar.
  //
  // Stripe cubre tarjeta (y Apple/Google Pay si se activan en el panel). La
  // clave secreta vive solo en el servidor: el navegador nunca la ve, y la
  // sesión de pago se crea aquí, no en el cliente.
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || null,
  // Clave publicable (`pk_...`). La usa el navegador para tokenizar la tarjeta
  // contra Stripe; el número nunca pasa por nuestro servidor.
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
  // Base de la API de Stripe. Configurable para poder apuntar los tests a un
  // servidor local y ejercitar las rutas reales sin tocar la red de Stripe.
  stripeApiBase: process.env.STRIPE_API_BASE || 'https://api.stripe.com/v1',
  // Firma del webhook. Es lo único que impide que cualquiera con la URL se
  // invente un "pago completado" y se regale monedas.
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || null,

  // PayPal. `paypalApiBase` cambia entre sandbox y producción, que es la
  // diferencia entre cobrar de verdad y no cobrar nada.
  paypalClientId: process.env.PAYPAL_CLIENT_ID || null,
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET || null,
  // Identificador del webhook en PayPal. Sin él no se puede verificar la firma,
  // así que el webhook se cierra.
  paypalWebhookId: process.env.PAYPAL_WEBHOOK_ID || null,
  // Interruptor operativo. Con `PAYPAL_ENABLED=false` PayPal queda bloqueado en
  // toda la app —pasarela, alta de cuenta y retiros— sin borrar ninguna clave:
  // al volver a `true` se reactiva tal cual. Sirve para apagar PayPal por una
  // incidencia sin desplegar código. Por defecto activo.
  paypalEnabled: process.env.PAYPAL_ENABLED !== 'false',
  paypalApiBase:
    process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com',
  paypalCurrency: (process.env.PAYPAL_CURRENCY || 'USD').toUpperCase(),

  // Cobro manual. No depende de ninguna pasarela ni de webhooks: el usuario
  // paga por fuera (Zinli, pago móvil, transferencia…) y un administrador
  // aprueba la orden, que entonces acredita las monedas. Es la vía que funciona
  // sin cuenta de empresa y sin mantener nada encendido.
  //
  // Va apagado por defecto: sin métodos configurados la tienda no ofrece nada
  // manual, para no prometer un cobro que nadie va a revisar.
  manualPaymentMethods: resolveManualPaymentMethods(),

  // Asistente de revisión de pagos manuales.
  //
  // Lee cada orden pendiente y propone aprobar o rechazar con una razón, para
  // que el administrador no tenga que abrir cada comprobante a mano. Sin clave
  // queda apagado y el panel funciona igual, solo que sin la sugerencia.
  //
  // La API es compatible con OpenAI (sirve OpenAI, Groq, OpenRouter…): solo
  // cambia `ASSISTANT_API_BASE` y `ASSISTANT_MODEL`.
  assistantApiKey: process.env.ASSISTANT_API_KEY || null,
  // Claves de respaldo, separadas por comas. Si la principal falla (caducada,
  // límite agotado, proveedor caído), el asistente prueba estas en orden antes
  // de rendirse. Se listan de la más a la menos preferida.
  assistantFallbackApiKeys: (process.env.ASSISTANT_API_KEY_FALLBACK || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean),
  assistantApiBase: (process.env.ASSISTANT_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  assistantModel: process.env.ASSISTANT_MODEL || 'gpt-4o-mini',
  // Aprobación automática. Apagada por defecto y a propósito: aprobar es
  // entregar monedas, y el criterio del asistente no es una prueba de pago.
  // Encendida, solo aprueba sola si el asistente está muy seguro (umbral) y el
  // importe no supera `manualAutoApproveMaxUsd`.
  manualAutoApprove: process.env.MANUAL_AUTO_APPROVE === 'true',
  manualAutoApproveMinConfidence: Number(process.env.MANUAL_AUTO_APPROVE_MIN_CONFIDENCE ?? 0.9),
  manualAutoApproveMaxUsd: Number(process.env.MANUAL_AUTO_APPROVE_MAX_USD ?? 15),

  // Asistak: moderación de directos y de la sala de juegos.
  //
  // Vigila los comentarios del directo y de POKERTAK. Avisa en el propio hilo y,
  // si el usuario reincide, le pone una suspensión temporal sin acceso a
  // directos ni a la mesa. Va encendido por defecto porque es la defensa que se
  // pidió; se puede apagar con ASISTAK_ENABLED=false.
  asistak: {
    enabled: process.env.ASISTAK_ENABLED !== 'false',
    // Días que dura la suspensión.
    suspensionDays: Number(process.env.ASISTAK_SUSPENSION_DAYS ?? 3),
    // Avisos antes de suspender. Con 2, el primer comentario solo avisa y el
    // segundo ya suspende: un desliz no expulsa, insistir sí.
    warnBeforeSuspend: Number(process.env.ASISTAK_WARN_BEFORE_SUSPEND ?? 2),
  },

  // CORS origin used for the Socket.IO handshake, which does not go through
  // the Express CORS middleware.
  socketCorsOrigin: process.env.CORS_ORIGIN || '*',

  // Public base URL of the app. Reset links in emails must be absolute, and
  // building them from the request Host header would let an attacker point a
  // victim's reset link at their own domain.
  appUrl: process.env.APP_URL || 'http://localhost:12000',

  // One-time codes, shared by email verification, phone verification and
  // password reset. The code is stored hashed, so these bounds limit how long
  // an intercepted code stays useful and how many guesses it survives.
  otpLength: Number(process.env.OTP_LENGTH ?? 6),
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES ?? 10),
  otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
  // Minimum gap between two codes for the same target, to stop an attacker
  // using the endpoint as a free SMS cannon.
  otpResendSeconds: Number(process.env.OTP_RESEND_SECONDS ?? 60),

  // SMS delivery. Without a provider the code is logged instead of sent, which
  // is what makes local development possible — but production refuses to start
  // silently pretending to send.
  smsProvider: process.env.SMS_PROVIDER || null,
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || null,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || null,
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER || null,

  // Llamadas a teléfonos que no tienen la app (PSTN). Twilio Voice marca el
  // número de verdad; sin proveedor, el marcador cae al marcador nativo del
  // teléfono (`tel:`), que no cuesta nada y funciona en móvil.
  //
  // El número emisor puede ser distinto del de SMS: Twilio factura aparte la
  // voz y los mensajes, y muchos despliegues compran un número solo para voz.
  // Si no se indica uno, se reutiliza el de SMS para no obligar a configurar
  // dos variables cuando una basta.
  voiceProvider: process.env.VOICE_PROVIDER || (process.env.SMS_PROVIDER ? 'twilio' : null),
  twilioVoiceFromNumber:
    process.env.TWILIO_VOICE_FROM || process.env.TWILIO_FROM_NUMBER || null,
  // Credenciales del cliente de voz. Twilio separa el "auth token" (que firma
  // la API) de las API Keys (que firman los tokens de acceso del navegador):
  // una API Key se puede revocar sin cambiar el auth token de toda la cuenta.
  twilioApiKey: process.env.TWILIO_API_KEY || null,
  twilioApiSecret: process.env.TWILIO_API_SECRET || null,
  // TwiML App que apunta a nuestro endpoint de TwiML. Twilio la exige en los
  // tokens de voz para saber qué URL pedir cuando el navegador marca.
  twilioTwimlAppSid: process.env.TWILIO_TWIML_APP_SID || null,
  // Precio en TTC-R de un minuto de llamada PSTN. Las llamadas a números que no
  // tienen la app salen por la red telefónica y cuestan dinero real, así que se
  // cobran del saldo retirable. A 0 quedan gratuitas (útil para pruebas).
  voiceCostPerMinute: Number(process.env.VOICE_COST_PER_MINUTE ?? 0),

  // SMTP for verification and password-reset mail.
  smtpHost: process.env.SMTP_HOST || null,
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER || null,
  smtpPass: process.env.SMTP_PASS || null,
  mailFrom: process.env.MAIL_FROM || 'TAK TAK <no-reply@taktak.app>',

  // Google sign-in. The client id is the audience the ID token must be issued
  // for; without it the endpoint stays closed rather than accepting any token.
  googleClientId: process.env.GOOGLE_CLIENT_ID || null,

  // Facebook Login. La app id es pública (va en el SDK del navegador) y el
  // secreto es lo que permite verificar que el token es nuestro. Hacen falta
  // los dos: sin secreto no se puede depurar el token, y sin app id no hay nada
  // que comparar, así que el endpoint queda cerrado en lugar de aceptar
  // cualquier token.
  facebookAppId: process.env.FACEBOOK_APP_ID || null,
  facebookAppSecret: process.env.FACEBOOK_APP_SECRET || null,
  // El Graph API se apunta a un servidor falso en los tests, igual que Stripe.
  facebookGraphBase: process.env.FACEBOOK_GRAPH_BASE || 'https://graph.facebook.com/v19.0',

  // Age verification provider. Unset means "no provider configured": in
  // production that blocks adult content outright (fail closed), in
  // development it selects the local dev provider so the flow can be exercised.
  // A vendor integration adds its name here and its credentials alongside.
  ageProvider: process.env.AGE_PROVIDER || null,
  // Minimum age for adult content, configurable per market.
  adultAge: Number(process.env.ADULT_AGE ?? 18),

  // Didit (proveedor de verificación de identidad). El documento y la selfie
  // los trata Didit: aquí solo se guarda el id de sesión y el veredicto.
  //
  //  - `diditApiKey` autentica las llamadas salientes (cabecera `x-api-key`).
  //  - `diditWorkflowId` es el flujo configurado en la consola de Didit (define
  //    qué comprobaciones se hacen).
  //  - `diditWebhookSecret` verifica que el webhook viene de Didit de verdad.
  //  - `diditApiBase` es configurable para poder apuntar los tests a un
  //    servidor falso, igual que Stripe y PayPal.
  diditApiKey: process.env.DIDIT_API_KEY || null,
  diditWorkflowId: process.env.DIDIT_WORKFLOW_ID || null,
  diditWebhookSecret: process.env.DIDIT_WEBHOOK_SECRET || null,
  diditApiBase: process.env.DIDIT_API_BASE || 'https://verification.didit.me',
  // Solo para la app de sandbox de Didit: fuerza el desenlace de cada sesión
  // (`approve`, `decline_...`, `review_...`) sin escribir un documento real.
  // Vacío en producción. Ver https://docs.didit.me/integration/sandbox-testing
  diditSandboxScenario: process.env.DIDIT_SANDBOX_SCENARIO || null,

  // Refresh tokens are separate from access tokens so a stolen access token
  // cannot be used to mint new ones. The secret is derived from the JWT secret
  // unless one is supplied.
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  refreshTokenSecret:
    process.env.REFRESH_TOKEN_SECRET ||
    `${requiredInProduction('JWT_SECRET') || 'dev-only-insecure-secret-change-me'}:refresh`,

  // Servidores ICE para las llamadas WebRTC. Se sirven al cliente por
  // `/api/calls/ice` en lugar de incrustarlos en el bundle: así se puede añadir
  // o rotar un TURN sin reconstruir el frontend, y las credenciales de TURN
  // (que caducan) no quedan fijas en un fichero estático.
  //
  // Sin TURN configurado, las llamadas funcionan en la misma red pero se cortan
  // detrás de NAT estricto, que es el caso de la mayoría de redes móviles y
  // corporativas. Por eso el TURN no es opcional para un despliegue real.
  iceServers: resolveIceServers(),

  // ------------------------------------------------------------------
  // SFU (mediasoup) para las salas de voz de los TAK Creators
  // ------------------------------------------------------------------
  //
  // La malla WebRTC (cada participante conectado con cada uno de los demás)
  // sirve para grupos pequeños, pero el ancho de banda de subida crece con el
  // número de personas: con 20 en una sala, cada móvil tendría que subir 19
  // flujos. El SFU rompe esa relación: cada cliente sube UN flujo y el servidor
  // lo reenvía a quien lo pida. Es lo que permite salas de cientos.
  //
  // Si mediasoup no está instalado (o el worker no se descargó), el servicio se
  // desactiva solo y las salas siguen funcionando en malla. Degradar es mejor
  // que romper: la sala pequeña sigue siendo útil.
  sfuEnabled: process.env.SFU_ENABLED !== 'false',
  // IP que el SFU anuncia a los navegadores para que le manden el media. En
  // local vale 127.0.0.1; en producción TIENE que ser la IP pública (o la del
  // balanceador), o los clientes no podrán conectarse. Es el error número uno
  // al desplegar un SFU.
  sfuAnnouncedAddress: process.env.SFU_ANNOUNCED_IP || '127.0.0.1',
  // IP en la que el worker escucha. 0.0.0.0 para aceptar por cualquier
  // interfaz.
  sfuListenIp: process.env.SFU_LISTEN_IP || '0.0.0.0',
  // Rango de puertos UDP/TCP que el SFU abre para el media. Hay que abrirlo en
  // el cortafuegos del despliegue.
  sfuRtcMinPort: Number(process.env.SFU_RTC_MIN_PORT ?? 40000),
  sfuRtcMaxPort: Number(process.env.SFU_RTC_MAX_PORT ?? 40200),
  // Número de workers. 0 = uno por CPU (hasta un tope). Cada worker es un
  // proceso independiente, así que uno que se cae no tumba la app.
  sfuWorkerCount: Number(process.env.SFU_WORKERS ?? 0),
  // Tope de participantes por sala. 0 = sin tope. Existe para que una sala no
  // pueda agotar los puertos del rango de arriba.
  sfuMaxParticipants: Number(process.env.SFU_MAX_PARTICIPANTS ?? 0),
  // Aforo del directo de un TAK Creator, sin contar al anfitrión. Es lo que pide
  // la idea: el creador más hasta quince invitados publicando cámara (los
  // espectadores no ocupan plaza: entran a mirar y comentar sin tope). Se aplica
  // en cualquier modo (SFU o malla), porque es un límite de producto y no de
  // infraestructura: una rejilla de más de dieciséis ventanas no se ve en un
  // móvil.
  liveGuestLimit: Number(process.env.LIVE_GUEST_LIMIT ?? 15),

  // ------------------------------------------------------------------
  // Traducción de WhaTaka
  // ------------------------------------------------------------------
  //
  // Es lo que permite que dos personas que no comparten idioma hablen por el
  // chat, por nota de voz y por llamada, cada una en el suyo. El proveedor es
  // conmutable y opcional, igual que Stripe o PayPal:
  //
  //   TRANSLATE_PROVIDER=deepl|google|libretranslate|mymemory|local|auto
  //
  // `auto` (el valor por defecto) usa el primero que tenga clave y cae a
  // MyMemory, que no necesita ninguna. MyMemory es peor que DeepL o Google,
  // pero traduce de verdad: sin él, la app recién instalada no podría traducir
  // nada y la función estrella de WhaTaka no se podría ni ver.
  translateProvider: process.env.TRANSLATE_PROVIDER || 'auto',
  translateApiKey: process.env.TRANSLATE_API_KEY || null,
  // Base de la API, configurable para poder apuntar los tests a un servidor
  // falso y para LibreTranslate, que se autoaloja.
  translateApiBase: process.env.TRANSLATE_API_BASE || null,
  // Apaga el proveedor sin clave. Quien no quiera mandar los mensajes a un
  // servicio gratuito de terceros lo pone en `false` y la app solo traduce si
  // hay un proveedor propio configurado. En una app de mensajería, mandar las
  // conversaciones a un tercero es una decisión que debe poder tomarse.
  translateKeyless: process.env.TRANSLATE_KEYLESS !== 'false',
  // Correo de contacto para subir la cuota anónima de MyMemory. Opcional.
  translateContactEmail: process.env.TRANSLATE_CONTACT_EMAIL || null,

  // Voz para la traducción en vivo de las llamadas. La traducción de audio
  // necesita reconocer la voz (STT) y volver a sintetizarla (TTS); sin estos
  // proveedores, la llamada traducida se apoya en las APIs del navegador, que
  // van en el dispositivo y no cuestan nada.
  //
  // `TRANSLATE_VOICE_MODE` decide dónde se hace el trabajo:
  //   'browser' (por defecto): STT y TTS en el dispositivo, solo el texto pasa
  //      por el servidor. Es lo que funciona hoy y no requiere claves.
  //   'server': STT y TTS en el servidor, para cuando se contrate un proveedor.
  translateVoiceMode: process.env.TRANSLATE_VOICE_MODE || 'browser',
  sttProvider: process.env.STT_PROVIDER || null,
  sttApiKey: process.env.STT_API_KEY || null,
  ttsProvider: process.env.TTS_PROVIDER || null,
  ttsApiKey: process.env.TTS_API_KEY || null,

  // Web Push: notificaciones que despiertan la app aunque esté cerrada. Es lo
  // que hace que una llamada suene como en WhatsApp cuando el otro no tiene la
  // app abierta.
  //
  // El par VAPID identifica al servidor ante los servicios de push
  // (FCM/APNs/Mozilla). Sin él no se puede enviar nada; con él, tampoco hace
  // falta ninguna cuenta externa: las claves se generan una vez con
  // `npm run push:keys` y se pegan aquí.
  //
  // La privada NO debe ir al repositorio: quien la tenga puede enviar
  // notificaciones en nombre de la app a todos sus usuarios.
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || null,
  // Contacto del responsable, que los servicios de push usan para avisar de
  // abuso. Exigen `mailto:` o una URL.
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@taktak.app',
};

module.exports = env;
