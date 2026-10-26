// Traducción en el cliente: qué idioma se habla, qué hay que traducir y cómo se
// guarda la elección de cada persona.
//
// La detección "de verdad" la hace el servidor (que es quien tiene el catálogo y
// el proveedor), pero hay dos decisiones que tienen que resolverse en el
// navegador antes de molestar al servidor:
//
//   1. En qué idioma quiere leer y oír esta persona. Sale de lo que eligió en
//      Ajustes; si no eligió nada, del idioma del navegador, que es la mejor
//      suposición disponible sin preguntar.
//   2. Si un texto merece la pena traducirse. Un "ok", un "👍" o una URL no se
//      traducen: gastar una llamada de pago en eso, además de inútil, es lento.
//
// Todo lo de este archivo es lógica pura, para poder probarlo sin navegador ni
// red. Lo que sí llama a la API vive en `translate.js`.

// Idiomas del selector. Es la misma lista que la del servidor, duplicada a
// propósito: el selector tiene que pintarse al instante, sin esperar a una
// petición, y si se quedara corta el servidor seguiría aceptando el código (la
// validación de verdad está allí). El orden es el de uso esperado.
export const LANGUAGES = [
  { code: 'es', name: 'Español', nativeName: 'Español' },
  { code: 'en', name: 'Inglés', nativeName: 'English' },
  { code: 'zh-Hans', name: 'Chino simplificado', nativeName: '简体中文' },
  { code: 'zh-Hant', name: 'Chino tradicional', nativeName: '繁體中文' },
  { code: 'pt', name: 'Portugués', nativeName: 'Português' },
  { code: 'fr', name: 'Francés', nativeName: 'Français' },
  { code: 'de', name: 'Alemán', nativeName: 'Deutsch' },
  { code: 'it', name: 'Italiano', nativeName: 'Italiano' },
  { code: 'ru', name: 'Ruso', nativeName: 'Русский' },
  { code: 'ar', name: 'Árabe', nativeName: 'العربية' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'bn', name: 'Bengalí', nativeName: 'বাংলা' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
  { code: 'fa', name: 'Persa', nativeName: 'فارسی' },
  { code: 'he', name: 'Hebreo', nativeName: 'עברית' },
  { code: 'ja', name: 'Japonés', nativeName: '日本語' },
  { code: 'ko', name: 'Coreano', nativeName: '한국어' },
  { code: 'vi', name: 'Vietnamita', nativeName: 'Tiếng Việt' },
  { code: 'th', name: 'Tailandés', nativeName: 'ไทย' },
  { code: 'id', name: 'Indonesio', nativeName: 'Bahasa Indonesia' },
  { code: 'tr', name: 'Turco', nativeName: 'Türkçe' },
  { code: 'pl', name: 'Polaco', nativeName: 'Polski' },
  { code: 'nl', name: 'Neerlandés', nativeName: 'Nederlands' },
  { code: 'el', name: 'Griego', nativeName: 'Ελληνικά' },
  { code: 'sv', name: 'Sueco', nativeName: 'Svenska' },
  { code: 'uk', name: 'Ucraniano', nativeName: 'Українська' },
  { code: 'ro', name: 'Rumano', nativeName: 'Română' },
  { code: 'sw', name: 'Suajili', nativeName: 'Kiswahili' },
  { code: 'tl', name: 'Tagalo', nativeName: 'Tagalog' },
];

const CODES = new Set(LANGUAGES.map((l) => l.code));
const BY_BASE = new Map(LANGUAGES.map((l) => [l.code.split('-')[0], l.code]));

const ALIASES = {
  zh: 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  'zh-hans': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
  'zh-mo': 'zh-Hant',
  'zh-hant': 'zh-Hant',
  in: 'id',
  iw: 'he',
  fil: 'tl',
};

/**
 * Normaliza cualquier variante a un código del catálogo.
 * `es-ES` → `es`, `zh_CN` → `zh-Hans`, desconocido → `null`.
 */
export function normalizeLanguage(value) {
  if (!value || typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase().replace(/_/g, '-');
  if (!clean) return null;
  if (ALIASES[clean]) return ALIASES[clean];
  const base = clean.split('-')[0];
  if (CODES.has(clean)) return clean;
  if (BY_BASE.has(base)) return BY_BASE.get(base);
  if (ALIASES[base]) return ALIASES[base];
  return null;
}

export function languageName(code) {
  const found = LANGUAGES.find((l) => l.code === code);
  return found ? found.name : null;
}

export function languageNativeName(code) {
  const found = LANGUAGES.find((l) => l.code === code);
  return found ? found.nativeName : null;
}

// ¿Los dos códigos son el mismo idioma para traducir? El chino simplificado y
// el tradicional NO lo son: pasar de uno a otro cambia los caracteres y es una
// traducción real.
export function sameLanguage(a, b) {
  const na = normalizeLanguage(a);
  const nb = normalizeLanguage(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const baseA = na.split('-')[0];
  const baseB = nb.split('-')[0];
  return baseA === baseB && baseA !== 'zh';
}

/**
 * Idioma en el que esta persona quiere leer. El orden es: lo que eligió, lo que
 * dice el navegador, y español como último recurso (el idioma de la app).
 *
 * Se lee de `navigator.languages` y no solo de `navigator.language` porque un
 * navegador puede declarar varios en orden de preferencia, y el primero puede
 * ser uno que no tenemos.
 */
export function resolveViewerLanguage({ preferred = null, navigator = globalThis.navigator } = {}) {
  const chosen = normalizeLanguage(preferred);
  if (chosen) return chosen;

  const candidates = [
    ...(Array.isArray(navigator?.languages) ? navigator.languages : []),
    navigator?.language,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const normalized = normalizeLanguage(candidate);
    if (normalized) return normalized;
  }
  return 'es';
}

// Un texto que no merece una traducción. Se descartan los que no son texto real
// (emoticonos, cifras, enlaces) y los tan cortos que traducirlos aporta menos
// que el riesgo de equivocarse: "ok" traducido a cualquier idioma sigue siendo
// "ok" para quien lo lee.
export function isTranslatable(text) {
  const raw = String(text ?? '').trim();
  if (raw.length < 2) return false;
  const letters = (raw.match(/\p{L}/gu) || []).length;
  if (letters < 2) return false;
  if (/^https?:\/\/\S+$/i.test(raw)) return false;
  if (/^\S+@\S+\.\S+$/.test(raw)) return false;
  return true;
}

/**
 * Detección aproximada en el cliente, solo por alfabeto. No pretende acertar el
 * idioma: sirve para dos cosas baratas y útiles antes de llamar al servidor:
 *
 *   - no pedir traducción cuando el texto ya está en el idioma del destinatario
 *     (un hispanohablante escribiendo a otro hispanohablante),
 *   - elegir la voz correcta al sintetizar una llamada, que es una decisión del
 *     navegador y no puede esperar a una petición.
 *
 * La detección fina (palabras, confianza) la hace el servidor.
 */
export function guessLanguageByScript(text) {
  const raw = String(text ?? '');
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(raw)) return 'ko';
  if (/[\u3040-\u30ff]/.test(raw)) return 'ja';
  if (/[\u4e00-\u9fff]/.test(raw)) {
    // Tradicional si aparecen caracteres que solo existen en esa forma.
    if (/[繁體與國學說話這來時對開關門馬車鳥魚龍風]/.test(raw)) return 'zh-Hant';
    return 'zh-Hans';
  }
  if (/[\u0400-\u04ff]/.test(raw)) return /[іїєґ]/i.test(raw) ? 'uk' : 'ru';
  if (/[\u0600-\u06ff]/.test(raw)) return 'ar';
  if (/[\u0590-\u05ff]/.test(raw)) return 'he';
  if (/[\u0e00-\u0e7f]/.test(raw)) return 'th';
  if (/[\u0900-\u097f]/.test(raw)) return 'hi';
  if (/[\u0980-\u09ff]/.test(raw)) return 'bn';
  if (/[\u0370-\u03ff\u1f00-\u1fff]/.test(raw)) return 'el';
  // Sin escritura propia no se puede saber; el servidor lo decide con palabras.
  return null;
}

/**
 * ¿Hay que traducir este texto para quien lo va a leer?
 *
 * Es la comprobación que evita gastar traducciones: si el texto ya está en el
 * idioma del destinatario no se pide nada. Devuelve `{ needed, source, target,
 * reason }`.
 */
export function shouldTranslate({ text, target, hint = null }) {
  const normalizedTarget = normalizeLanguage(target);
  if (!normalizedTarget) return { needed: false, source: null, target: null, reason: 'no-target' };
  if (!isTranslatable(text)) {
    return { needed: false, source: null, target: normalizedTarget, reason: 'not-translatable' };
  }

  const guessed = guessLanguageByScript(text);
  if (!guessed) {
    // Escritura latina: no se puede decidir aquí sin arriesgar. Se deja que lo
    // decida el servidor, que tiene las palabras frecuentes.
    return { needed: true, source: null, target: normalizedTarget, reason: 'unknown-script' };
  }

  if (sameLanguage(guessed, normalizedTarget)) {
    return { needed: false, source: guessed, target: normalizedTarget, reason: 'same-language' };
  }

  return { needed: true, source: guessed, target: normalizedTarget, reason: 'script' };
}

// Clave de la caché de traducciones en el navegador. Incluye destino porque la
// misma frase se traduce distinto según a dónde vaya.
export function translationCacheKey({ text, target }) {
  return `${normalizeLanguage(target) || '?'}::${String(text ?? '')}`;
}

// Voz del sintetizador que corresponde a un idioma. `SpeechSynthesis` elige por
// el prefijo del código (`zh-CN`, `es-ES`), y para el chino hay que distinguir
// simplificado (CN) de tradicional (TW) o lee con el acento equivocado.
export function speechLocale(language) {
  const code = normalizeLanguage(language);
  if (!code) return null;
  const map = {
    'zh-Hans': 'zh-CN',
    'zh-Hant': 'zh-TW',
    es: 'es-ES',
    en: 'en-US',
    pt: 'pt-BR',
    fr: 'fr-FR',
    de: 'de-DE',
    it: 'it-IT',
    ru: 'ru-RU',
    ar: 'ar-SA',
    hi: 'hi-IN',
    bn: 'bn-IN',
    ur: 'ur-PK',
    fa: 'fa-IR',
    he: 'he-IL',
    ja: 'ja-JP',
    ko: 'ko-KR',
    vi: 'vi-VN',
    th: 'th-TH',
    id: 'id-ID',
    tr: 'tr-TR',
    pl: 'pl-PL',
    nl: 'nl-NL',
    el: 'el-GR',
    sv: 'sv-SE',
    uk: 'uk-UA',
    ro: 'ro-RO',
    sw: 'sw-KE',
    tl: 'fil-PH',
  };
  return map[code] || code.split('-')[0];
}

/**
 * Elige la mejor voz disponible para un idioma.
 *
 * `getVoices()` puede devolver una lista vacía la primera vez (el navegador la
 * carga en segundo plano), y las voces de un idioma pueden no existir. En ese
 * caso devuelve `null` y quien llama decide qué hacer: es mejor no sintetizar
 * que sintetizar en un idioma que nadie entiende.
 */
export function pickVoice(voices, language) {
  const locale = speechLocale(language);
  if (!locale || !Array.isArray(voices) || voices.length === 0) return null;

  const base = locale.split('-')[0].toLowerCase();
  const exact = locale.toLowerCase();

  // Prioridad: coincidencia exacta de región, luego mismo idioma, luego mismo
  // idioma base (para el chino, `zh` sirve si no hay `zh-CN`).
  return (
    voices.find((v) => String(v.lang || '').toLowerCase().replace('_', '-') === exact) ||
    voices.find((v) => String(v.lang || '').toLowerCase().replace('_', '-').startsWith(base)) ||
    null
  );
}
