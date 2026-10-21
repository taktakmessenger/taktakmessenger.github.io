const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Llamadas a teléfonos que NO tienen TAK TAK (red telefónica, PSTN).
 *
 * Hay dos caminos y conviene tener claro por qué existen los dos:
 *
 *  - Con proveedor de voz (Twilio), el navegador se registra como cliente de
 *    Twilio con un token de acceso y Twilio puentea el audio hacia el número
 *    marcado. El teléfono suena con su marcador normal, sin instalar nada.
 *  - Sin proveedor, el cliente cae al marcador nativo del sistema (`tel:`), que
 *    en un móvil abre la app de teléfono. No cuesta nada y no depende de nadie.
 *
 * Un número sin la app no puede recibir una videollamada WebRTC: no hay dónde
 * entregarle la invitación. Eso no se puede arreglar con código, igual que no
 * se puede videollamar por WhatsApp a quien no tiene WhatsApp. Lo que sí se
 * puede es llamarle por teléfono o invitarle a instalarla.
 */

const TOKEN_TTL_SECONDS = 3600;

function isConfigured() {
  return Boolean(
    env.voiceProvider &&
      env.twilioAccountSid &&
      env.twilioAuthToken &&
      env.twilioVoiceFromNumber &&
      env.twilioApiKey &&
      env.twilioApiSecret &&
      env.twilioTwimlAppSid
  );
}

/**
 * Token de acceso de Twilio Voice, para que el navegador pueda marcar.
 *
 * Se firma a mano con `jsonwebtoken` (que ya está en el proyecto) en lugar de
 * añadir el SDK de Twilio solo para esto: el token es un JWT HS256 con una
 * forma fija, y el SDK entero pesaría más que las diez líneas que ocupa.
 *
 * La identidad es el id del usuario: Twilio la usa para saber quién llama y
 * para poder colgar sus llamadas por API si hiciera falta.
 */
function createVoiceToken(identity) {
  if (!isConfigured()) {
    throw new Error('La voz no está configurada');
  }

  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      jti: `${identity}-${now}`,
      iss: env.twilioApiKey,
      sub: env.twilioAccountSid,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
      grants: {
        identity: String(identity),
        voice: {
          outgoing: { application_sid: env.twilioTwimlAppSid },
        },
      },
    },
    env.twilioApiSecret,
    {
      algorithm: 'HS256',
      // Twilio exige este `cty` para distinguir sus tokens de cualquier otro
      // JWT. Sin él, el SDK los rechaza con un error poco descriptivo.
      header: { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' },
    }
  );
}

/**
 * TwiML que conecta la llamada entrante del navegador con el número marcado.
 *
 * El `callerId` es el número de Twilio: es lo que ve la persona al descolgar.
 * Si se dejara vacío, muchos operadores rechazan la llamada por no tener
 * identificador de origen.
 */
function dialTwiml(to, { record = false } = {}) {
  const escaped = String(to).replace(/[<>&"']/g, '');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `  <Dial callerId="${env.twilioVoiceFromNumber}"${record ? ' record="record-from-answer"' : ''}>`,
    `    <Number>${escaped}</Number>`,
    '  </Dial>',
    '</Response>',
  ].join('\n');
}

/**
 * Valida la firma `X-Twilio-Signature`.
 *
 * El endpoint de TwiML decide a qué número se marca, así que sin esta
 * comprobación cualquiera podría usarlo para llamar a números de tarificación
 * especial a costa de nuestra cuenta. Twilio firma cada petición con el auth
 * token; se recalcula y se compara en tiempo constante.
 */
function isValidTwilioSignature({ signature, url, params }) {
  if (!env.twilioAuthToken || !signature) return false;

  // Twilio concatena la URL y los parámetros ordenados por clave, y firma el
  // resultado en HMAC-SHA1 con el auth token.
  const payload =
    url +
    Object.keys(params || {})
      .sort()
      .map((key) => `${key}${params[key]}`)
      .join('');

  const expected = crypto
    .createHmac('sha1', env.twilioAuthToken)
    .update(Buffer.from(payload, 'utf8'))
    .digest('base64');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  // timingSafeEqual exige la misma longitud; si difieren, ya no coinciden.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  isConfigured,
  createVoiceToken,
  dialTwiml,
  isValidTwilioSignature,
  TOKEN_TTL_SECONDS,
};
