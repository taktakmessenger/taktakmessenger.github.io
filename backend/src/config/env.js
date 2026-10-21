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

// Revenue split for every gift. The creator keeps 75% and the platform 25%,
// versus the 30-50% creators get on TikTok. Both values must add up to 1.
function resolveShares() {
  const creatorShare = Number(process.env.CREATOR_SHARE ?? 0.75);
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
const DEFAULT_COIN_PACKAGES = [
  { id: 'starter', coins: 70, priceUsd: 0.99 },
  { id: 'popular', coins: 350, priceUsd: 4.99 },
  { id: 'value', coins: 1400, priceUsd: 19.99 },
  { id: 'mega', coins: 7000, priceUsd: 99.99 },
];

function resolveCoinPackages() {
  if (!process.env.COIN_PACKAGES) return DEFAULT_COIN_PACKAGES;

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
  return parsed.map((pkg) => {
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
}

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
  maxVideoBytes: Number(process.env.MAX_VIDEO_BYTES ?? 50 * 1024 * 1024),

  // Where uploaded originals and their HLS renditions are written. Served
  // read-only at /uploads.
  uploadsDir: process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'),
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

  // Age verification provider. Unset means "no provider configured": in
  // production that blocks adult content outright (fail closed), in
  // development it selects the local dev provider so the flow can be exercised.
  // A vendor integration adds its name here and its credentials alongside.
  ageProvider: process.env.AGE_PROVIDER || null,
  // Minimum age for adult content, configurable per market.
  adultAge: Number(process.env.ADULT_AGE ?? 18),

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
