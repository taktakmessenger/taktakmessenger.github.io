const env = require('../config/env');

// Cliente único del asistente (el del administrador y el de pagos).
//
// Habla con cualquier API compatible con OpenAI y admite varias claves: la
// principal y las de respaldo de `ASSISTANT_API_KEY_FALLBACK`. Se usan en orden
// y, si una falla por clave o por proveedor, se pasa a la siguiente. Así una
// clave caducada o un proveedor caído no tumban al asistente mientras haya otra
// que funcione.

// Un 401/403/429 o un 5xx no son culpa de la petición, sino de la clave o del
// proveedor: tiene sentido probar la siguiente clave. Un 400 es una petición mal
// formada y daría lo mismo con cualquier clave, así que se corta ahí.
const RETRYABLE_STATUS = new Set([401, 403, 408, 429, 500, 502, 503, 504]);

function apiKeys() {
  return [env.assistantApiKey, ...env.assistantFallbackApiKeys].filter(Boolean);
}

function isConfigured() {
  return apiKeys().length > 0;
}

/**
 * Envía un cuerpo a `/chat/completions` y devuelve la respuesta ya parseada.
 *
 * Recorre las claves disponibles y lanza si todas fallan. `log` se usa para
 * dejar rastro en el servidor de qué clave falló, sin imprimir la clave.
 *
 * Un 429 (cuota agotada) no es un fallo definitivo: el límite es por minuto, así
 * que se reintenta la misma clave tras esperar lo que pida `Retry-After` (o un
 * respaldo corto) antes de pasar a la siguiente. Sin esto, un pico de uso dejaba
 * al administrador sin asistente aunque el límite se liberase segundos después.
 */
async function callAssistant({ body, timeoutMs = 30000, log = '[ASISTENTE]', maxRateLimitRetries = 2 }) {
  const keys = apiKeys();
  if (!keys.length) {
    throw new Error('El asistente no está configurado (falta ASSISTANT_API_KEY)');
  }

  let lastError = null;

  for (let i = 0; i < keys.length; i += 1) {
    const last = i === keys.length - 1;
    const label = i === 0 ? 'principal' : `respaldo ${i}`;

    for (let attempt = 0; attempt <= maxRateLimitRetries; attempt += 1) {
      let response;
      try {
        // eslint-disable-next-line no-await-in-loop
        response = await fetch(`${env.assistantApiBase}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${keys[i]}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // Timeout o red caída: no es culpa de la petición, se prueba la siguiente.
        lastError = error;
        if (last) throw error;
        console.warn(`${log} la clave ${label} no respondió (${error.message}); pruebo la siguiente`);
        break;
      }

      if (response.ok) return response.json();

      const detail = await response.text().catch(() => '');
      const error = new Error(
        `El proveedor del asistente respondió ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`
      );
      error.status = response.status;

      // 429: esperar lo que indique el proveedor (segundos) y reintentar la
      // misma clave. Se acota a 25 s para no dejar la petición colgada.
      if (response.status === 429 && attempt < maxRateLimitRetries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 25000)
          : 3000 * (attempt + 1);
        console.warn(`${log} la clave ${label} está limitada (429); espero ${waitMs} ms y reintento`);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, waitMs));
        lastError = error;
        continue;
      }

      if (!RETRYABLE_STATUS.has(response.status) || last) throw error;

      lastError = error;
      console.warn(`${log} la clave ${label} falló (${response.status}); pruebo la siguiente`);
      break;
    }
  }

  throw lastError || new Error('El asistente no respondió');
}

module.exports = { isConfigured, callAssistant };
