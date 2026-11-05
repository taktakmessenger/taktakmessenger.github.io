const crypto = require('crypto');
const env = require('../config/env');
const { HttpError } = require('../utils/http');

/**
 * Integración con Didit, el proveedor de verificación de identidad.
 *
 * Didit hace el trabajo sensible (documento de identidad + selfie/liveness) en
 * su propia interfaz. Aquí solo se crea la sesión, se lee el veredicto y se
 * verifica que el webhook viene de Didit. El documento **nunca** pasa por este
 * servidor: se guarda el id de sesión y el estado.
 *
 * Se usa el flujo hospedado (hosted session), que es el recomendado por Didit:
 * `POST /v3/session/` devuelve una `url` a la que se manda al usuario.
 */

// Didit devuelve el estado con mayúsculas y espacios ("In Progress",
// "Awaiting User"…). Se traduce a los cuatro estados internos. Todo lo que no
// sea una aprobación o un rechazo claro queda en `pending`, que es lo seguro:
// una traducción optimista convertiría "In Review" en un acceso.
function mapStatus(raw) {
  const status = String(raw || '').toLowerCase();
  if (status === 'approved') return 'verified';
  if (['declined', 'expired', 'kyc expired', 'abandoned'].includes(status)) return 'rejected';
  return 'pending';
}

function isConfigured() {
  return Boolean(env.diditApiKey && env.diditWorkflowId);
}

function apiBase() {
  return String(env.diditApiBase).replace(/\/$/, '');
}

// El callback devuelve al usuario al panel de verificación con el id de sesión,
// para que la app pueda refrescar el estado nada más volver. Si `APP_URL` no
// está puesto (desarrollo), no se manda callback y Didit usa el del flujo.
function callbackUrl() {
  if (!env.appUrl) return undefined;
  return `${String(env.appUrl).replace(/\/$/, '')}/?view=verification`;
}

/**
 * Abre una sesión de verificación en Didit y devuelve `{ ref, redirectUrl }`.
 *
 * `vendor_data` lleva el id del usuario para poder reconocerlo luego; el
 * webhook lo devuelve tal cual.
 */
async function start({ userId, email }) {
  if (!isConfigured()) {
    throw new HttpError(503, 'La verificación de edad no está configurada en este servidor');
  }

  const body = {
    workflow_id: env.diditWorkflowId,
    vendor_data: String(userId),
  };
  const callback = callbackUrl();
  if (callback) body.callback = callback;
  if (email) body.contact_details = { email };

  let response;
  try {
    response = await fetch(`${apiBase()}/v3/session/`, {
      method: 'POST',
      headers: {
        'x-api-key': env.diditApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new HttpError(502, 'No se pudo contactar con el proveedor de verificación');
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.session_id || !data?.url) {
    throw new HttpError(502, 'El proveedor de verificación rechazó la solicitud');
  }

  return { ref: data.session_id, redirectUrl: data.url };
}

/**
 * Lee el veredicto de una sesión. Devuelve `{ status, method }`.
 *
 * Se consulta por el id de sesión guardado, nunca por algo que mande el
 * cliente: si el cliente eligiera qué sesión consultar, podría apuntar a una
 * aprobación ajena.
 */
async function poll({ ref }) {
  if (!isConfigured()) {
    throw new HttpError(503, 'La verificación de edad no está configurada en este servidor');
  }

  let response;
  try {
    response = await fetch(`${apiBase()}/v3/session/${encodeURIComponent(ref)}/decision/`, {
      headers: { 'x-api-key': env.diditApiKey },
    });
  } catch {
    throw new HttpError(502, 'No se pudo contactar con el proveedor de verificación');
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new HttpError(502, 'El proveedor de verificación no devolvió un veredicto');
  }

  return { status: mapStatus(data.status), method: 'document' };
}

// Reordena las claves de forma recursiva. Didit firma una versión "canónica"
// del JSON (claves ordenadas) y `JSON.stringify` respeta el orden de inserción,
// así que sin esto la firma no cuadra aunque el contenido sea idéntico.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

// Didit normaliza los flotantes a su forma corta antes de firmar (por ejemplo,
// `0.30000000000000004` -> `0.3`). JavaScript ya serializa los números con su
// forma más corta, así que aquí no hace falta tocarlos; el re-serializado del
// cuerpo parseado coincide con el canónico.
function canonicalize(parsed) {
  return JSON.stringify(sortKeys(parsed));
}

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifica la firma del webhook.
 *
 * Didit firma con HMAC-SHA256. Se prueban las dos cabeceras vigentes, en el
 * orden que recomienda su documentación:
 *
 *  1. `X-Signature-V2` sobre el JSON canónico (claves ordenadas).
 *  2. `X-Signature` sobre el cuerpo crudo tal cual llegó.
 *
 * En ambos casos se rechaza una petición con más de 5 minutos: sin eso, un
 * webhook capturado se podría reenviar para forzar el mismo efecto.
 */
function verifyWebhook({ rawBody, parsedBody, signatureV2, signature, timestamp }) {
  const secret = env.diditWebhookSecret;
  if (!secret) return false;

  const now = Math.floor(Date.now() / 1000);
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;

  const candidates = [];
  if (signatureV2 && parsedBody) {
    candidates.push(
      crypto.createHmac('sha256', secret).update(canonicalize(parsedBody), 'utf8').digest('hex')
    );
  }
  if (signature && rawBody) {
    const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    candidates.push(crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex'));
  }

  const provided = signatureV2 || signature;
  if (!provided) return false;
  return candidates.some((expected) => timingSafeEqualHex(expected, provided));
}

module.exports = {
  name: 'didit',
  isConfigured,
  start,
  poll,
  verifyWebhook,
  mapStatus,
};
