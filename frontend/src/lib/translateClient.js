// Cliente de traducción del navegador.
//
// Envuelve la API con dos cosas que un chat necesita y que, si no están, se
// notan de inmediato:
//
//   - una caché por conversación, para que subir y bajar por el hilo no vuelva a
//     pedir la misma traducción;
//   - deduplicación de peticiones en vuelo, para que dos burbujas con el mismo
//     texto (o dos toques rápidos en el mismo botón) compartan una sola llamada.
//
// Es lo que evita que el límite de peticiones por minuto del servidor salte con
// un hilo normal, que es el fallo que se ve cuando alguien abre un chat de veinte
// mensajes y pulsa "traducir" en todos.

import api from '../api/client.js';
import { normalizeLanguage, translationCacheKey, shouldTranslate } from './translate.js';

// Traducciones ya pedidas en esta sesión. El valor es la respuesta del servidor
// (`{ text, source, target, translated }`). Se pierde al recargar, que es lo
// correcto: es una caché de conveniencia, no un almacén.
const cache = new Map();

// Peticiones en vuelo, por clave. Un segundo consumidor de la misma clave espera
// a la primera en lugar de lanzar otra.
const inFlight = new Map();

export function clearTranslationCache() {
  cache.clear();
  inFlight.clear();
}

export function cachedTranslation({ text, target }) {
  return cache.get(translationCacheKey({ text, target })) || null;
}

/**
 * Traduce un texto al idioma de destino.
 *
 * Devuelve siempre un objeto con la misma forma que la API:
 * `{ text, source, target, translated, error }`. Nunca lanza: un fallo de red o
 * de cuota no debe romper el chat, y la interfaz distingue "no hacía falta
 * traducir" (`translated: false` sin error) de "no se pudo" (`error`).
 */
export async function translateText({ text, to, hint = null, force = false }) {
  const target = normalizeLanguage(to);
  if (!target) return { text, source: null, target: null, translated: false, error: 'Idioma no soportado' };

  const body = String(text ?? '');

  // Si no hace falta traducir, se responde sin llamar al servidor. `force` lo
  // salta: el usuario puede querer ver la traducción aunque el texto parezca ya
  // estar en su idioma (por ejemplo, una frase latina corta).
  if (!force) {
    const decision = shouldTranslate({ text: body, target, hint });
    if (!decision.needed) {
      return {
        text: body,
        source: decision.source,
        target,
        translated: false,
        reason: decision.reason,
        error: null,
      };
    }
  }

  const key = translationCacheKey({ text: body, target });
  const cached = cache.get(key);
  if (cached) return cached;

  if (inFlight.has(key)) return inFlight.get(key);

  const request = api
    .post('/translate', { text: body, to: target, hint })
    .then(({ data }) => {
      const result = {
        text: data?.text ?? body,
        source: data?.source ?? null,
        target: data?.target ?? target,
        translated: Boolean(data?.translated),
        provider: data?.provider ?? null,
        error: null,
      };
      // Solo se cachea lo que el servidor tradujo de verdad. Guardar el original
      // haría que, al configurar un proveedor, se siguiera mostrando el original
      // "traducido" durante toda la sesión.
      if (result.translated) cache.set(key, result);
      return result;
    })
    .catch((err) => ({
      text: body,
      source: null,
      target,
      translated: false,
      error: err?.message || 'No se pudo traducir',
    }))
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

/**
 * Traduce varios textos de una vez. Se usa al abrir un hilo con la traducción
 * automática encendida: una sola petición para los últimos mensajes en lugar de
 * una por burbuja.
 *
 * Los textos que no hacen falta traducir se resuelven en local y no se mandan.
 */
export async function translateBatch({ texts, to, hint = null }) {
  const target = normalizeLanguage(to);
  if (!target) return [];

  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t ?? ''));

  // Se resuelve primero lo que ya está en caché o no necesita traducción, y solo
  // lo demás viaja al servidor.
  const results = new Array(list.length).fill(null);
  const pending = [];

  list.forEach((text, index) => {
    const decision = shouldTranslate({ text, target, hint });
    if (!decision.needed) {
      results[index] = {
        text,
        source: decision.source,
        target,
        translated: false,
        reason: decision.reason,
        error: null,
      };
      return;
    }
    const key = translationCacheKey({ text, target });
    const cached = cache.get(key);
    if (cached) {
      results[index] = cached;
      return;
    }
    pending.push({ index, text, key });
  });

  if (pending.length === 0) return results;

  try {
    const { data } = await api.post('/translate/batch', {
      texts: pending.map((p) => p.text),
      to: target,
      hint,
    });

    const translations = Array.isArray(data?.translations) ? data.translations : [];
    pending.forEach((item, i) => {
      const raw = translations[i];
      const result = {
        text: raw?.text ?? item.text,
        source: raw?.source ?? null,
        target: raw?.target ?? target,
        translated: Boolean(raw?.translated),
        error: null,
      };
      if (result.translated) cache.set(item.key, result);
      results[item.index] = result;
    });
  } catch (err) {
    // El lote falló: se rellenan los pendientes con el original y el error, sin
    // dejar huecos `null` en el resultado.
    const message = err?.message || 'No se pudo traducir';
    for (const item of pending) {
      results[item.index] = {
        text: item.text,
        source: null,
        target,
        translated: false,
        error: message,
      };
    }
  }

  return results;
}

/**
 * Idiomas disponibles según el servidor, con el aviso de si hay proveedor real.
 * Si la petición falla, se devuelve `null` y la interfaz usa su propia lista: el
 * selector no puede quedarse vacío porque el servidor no conteste.
 */
export async function fetchLanguages() {
  try {
    const { data } = await api.get('/translate/languages');
    return {
      languages: Array.isArray(data?.languages) ? data.languages : [],
      configured: Boolean(data?.configured),
    };
  } catch {
    return null;
  }
}
