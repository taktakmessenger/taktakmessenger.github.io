// Detección de idioma y normalización de códigos, para WhaTaka.
//
// Es la pieza que decide si un mensaje hay que traducirlo y a qué idioma. Vive
// en el servidor y no en el navegador porque el resultado se guarda con el
// mensaje: si cada cliente detectara por su cuenta, dos personas podrían ver
// "español" y "portugués" para la misma frase.
//
// No es un detector estadístico: es un conjunto de reglas sobre el alfabeto y
// las palabras más frecuentes. Acierta en el caso que importa (una frase escrita
// por una persona en su idioma) y se equivoca de forma predecible en frases muy
// cortas ("ok", "sí"), donde no hay información suficiente para acertar. Por eso
// `detectLanguage` devuelve también una confianza: quien la use puede decidir no
// traducir cuando es baja en vez de arriesgar una traducción absurda.

// Idiomas que la app ofrece en el selector y que el detector reconoce. El código
// es el canónico (el que se guarda y se manda a los proveedores); `nativeName`
// es lo que se enseña en el selector, en el propio idioma, porque quien busca su
// idioma lo busca escrito como lo escribe él.
const LANGUAGES = [
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

// Idioma por defecto cuando no se puede detectar nada. No es una apuesta
// arbitraria: es el idioma de la app, así que en el peor caso la traducción sale
// igual que el texto.
const FALLBACK = 'es';

// Variantes que llegan de otras fuentes (un `navigator.language`, un código ISO
// antiguo, un `zh_CN` con guion bajo) y su equivalente canónico. Sin esta tabla,
// `zh-CN` y `zh-Hans` se tratarían como idiomas distintos y el traductor
// traduciría al chino simplificado para quien ya escribe simplificado.
const ALIASES = {
  zh: 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  'zh-hans': 'zh-Hans',
  'zh-hans-cn': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
  'zh-mo': 'zh-Hant',
  'zh-hant': 'zh-Hant',
  in: 'id', // código ISO 639 antiguo del indonesio
  iw: 'he', // código antiguo del hebreo
  jw: 'jv',
  mo: 'ro',
  no: 'nb',
  nb: 'nb',
  nn: 'nb',
  fil: 'tl',
};

// Códigos que reconocemos pero no ofrecemos en el selector; se normalizan al
// idioma con el que se entienden mejor para no perder la información.
const EXTRA_BASE = { nb: 'no', jv: 'id' };

/**
 * Normaliza cualquier variante a un código canónico.
 * `es-ES`, `es_419`, `ES` → `es`. `zh_CN` → `zh-Hans`. Desconocido → `null`.
 */
function normalizeLanguage(value) {
  if (!value || typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase().replace(/_/g, '-');
  if (!clean) return null;

  if (ALIASES[clean]) return ALIASES[clean];

  const base = clean.split('-')[0];
  if (CODES.has(clean)) return clean;
  if (BY_BASE.has(base)) return BY_BASE.get(base);
  if (ALIASES[base]) return ALIASES[base];
  if (EXTRA_BASE[base]) return EXTRA_BASE[base];

  // Un código válido con región pero sin variante propia (`pt-BR`, `en-US`)
  // cae a su base, que es lo que entiende el proveedor de traducción.
  return null;
}

function languageName(code) {
  const found = LANGUAGES.find((l) => l.code === code);
  return found ? found.name : null;
}

// ¿Los dos códigos son el mismo idioma a efectos de traducción? El chino
// simplificado y el tradicional comparten base: traducir de uno a otro cambia
// los caracteres, así que si la persona escribió en el que pidió, no se traduce.
// Se comparan por base completa (`zh-Hans` vs `zh-Hant` son distintos) porque
// pasar de uno a otro sí es una traducción real.
function sameLanguage(a, b) {
  const na = normalizeLanguage(a);
  const nb = normalizeLanguage(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Misma base latina/sin escritura propia: `es` y `es` ya coinciden arriba.
  // Solo se consideran iguales las variantes que comparten base sin diferir en
  // la escritura (chino es el único caso que difiere).
  const baseA = na.split('-')[0];
  const baseB = nb.split('-')[0];
  return baseA === baseB && baseA !== 'zh';
}

// --- Detección por alfabeto -------------------------------------------------
//
// Los idiomas con escritura propia se identifican por el rango de sus
// caracteres: si aparece hangul es coreano, si aparece kana es japonés. Es mucho
// más fiable que cualquier heurística sobre palabras, así que se comprueba
// primero y, si acierta, no se sigue mirando.

function scriptScores(text) {
  const scores = {
    han: 0, kana: 0, hangul: 0, cyrillic: 0, arabic: 0, hebrew: 0,
    devanagari: 0, bengali: 0, thai: 0, greek: 0, latin: 0, other: 0,
  };
  for (const char of text) {
    const code = char.codePointAt(0);
    if (/\p{Script=Han}/u.test(char)) scores.han += 1;
    else if (/[\u3040-\u30ff]/u.test(char)) scores.kana += 1;
    else if (/[\uac00-\ud7af\u1100-\u11ff]/u.test(char)) scores.hangul += 1;
    else if (/[\u0400-\u04ff]/u.test(char)) scores.cyrillic += 1;
    else if (/[\u0600-\u06ff\u0750-\u077f]/u.test(char)) scores.arabic += 1;
    else if (/[\u0590-\u05ff]/u.test(char)) scores.hebrew += 1;
    else if (/[\u0900-\u097f]/u.test(char)) scores.devanagari += 1;
    else if (/[\u0980-\u09ff]/u.test(char)) scores.bengali += 1;
    else if (/[\u0e00-\u0e7f]/u.test(char)) scores.thai += 1;
    else if (/[\u0370-\u03ff\u1f00-\u1fff]/u.test(char)) scores.greek += 1;
    else if (/[a-zà-öø-ÿ]/i.test(char)) scores.latin += 1;
    else if (code > 127) scores.other += 1;
  }
  return scores;
}

// Palabras muy frecuentes por idioma. Son las que más discriminan en una frase
// corta: "de", "que", "el" frente a "the", "and" frente a "que", "não". Se
// guardan plegadas (sin tildes, en minúsculas) porque el texto se pliega antes
// de comparar.
const STOPWORDS = {
  es: ['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'que', 'y', 'en', 'no', 'por', 'con', 'para', 'es', 'esta', 'como', 'pero', 'muy', 'mas', 'hola', 'gracias', 'buenos', 'dias', 'tengo', 'quiero', 'puedes', 'donde', 'cuando', 'porque', 'soy', 'eres', 'nosotros', 'usted', 'vosotros'],
  en: ['the', 'and', 'of', 'to', 'is', 'in', 'that', 'it', 'for', 'on', 'with', 'you', 'this', 'are', 'be', 'have', 'not', 'hello', 'thanks', 'please', 'what', 'where', 'when', 'because', 'how', 'there', 'from', 'your', 'i'],
  pt: ['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'que', 'e', 'em', 'nao', 'por', 'com', 'para', 'voce', 'ola', 'obrigado', 'obrigada', 'muito', 'esta', 'sou', 'como', 'onde', 'quando', 'porque', 'tambem'],
  fr: ['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'que', 'et', 'en', 'ne', 'pas', 'pour', 'avec', 'vous', 'est', 'ce', 'bonjour', 'merci', 'comment', 'ou', 'quand', 'parce', 'je', 'nous', 'tres'],
  it: ['il', 'lo', 'la', 'gli', 'le', 'un', 'una', 'di', 'del', 'che', 'e', 'in', 'non', 'per', 'con', 'ciao', 'grazie', 'come', 'dove', 'quando', 'perche', 'sono', 'sei', 'molto', 'anche'],
  de: ['der', 'die', 'das', 'ein', 'eine', 'und', 'von', 'zu', 'ist', 'in', 'nicht', 'mit', 'fur', 'sie', 'ich', 'hallo', 'danke', 'wie', 'wo', 'wann', 'weil', 'bin', 'bist', 'sehr', 'auch', 'aber'],
  nl: ['de', 'het', 'een', 'van', 'en', 'is', 'in', 'niet', 'met', 'voor', 'ik', 'hallo', 'dank', 'hoe', 'waar', 'wanneer', 'omdat', 'ben', 'bent', 'heel', 'ook', 'maar'],
  ro: ['si', 'de', 'la', 'un', 'o', 'care', 'in', 'nu', 'pentru', 'cu', 'este', 'salut', 'multumesc', 'cum', 'unde', 'cand', 'pentru', 'sunt', 'esti', 'foarte'],
  tr: ['ve', 'bir', 'bu', 'de', 'da', 'icin', 'ile', 'ne', 'var', 'yok', 'merhaba', 'tesekkur', 'nasil', 'nerede', 'neden', 'ben', 'sen', 'cok', 'ama'],
  id: ['yang', 'dan', 'di', 'ke', 'dari', 'ini', 'itu', 'tidak', 'untuk', 'dengan', 'halo', 'terima', 'kasih', 'apa', 'bagaimana', 'kapan', 'saya', 'kamu', 'sangat'],
  tl: ['ang', 'ng', 'sa', 'na', 'ay', 'at', 'mga', 'hindi', 'para', 'ako', 'ikaw', 'kumusta', 'salamat', 'saan', 'kailan', 'bakit', 'sobrang'],
  vi: ['va', 'la', 'cua', 'khong', 'cho', 'voi', 'xin', 'chao', 'cam', 'on', 'the', 'nao', 'dau', 'khi', 'toi', 'ban', 'rat'],
  sw: ['na', 'ya', 'wa', 'kwa', 'ni', 'hii', 'habari', 'asante', 'nini', 'vipi', 'wapi', 'lini', 'mimi', 'wewe', 'sana'],
  sv: ['och', 'att', 'det', 'en', 'ett', 'ar', 'som', 'for', 'med', 'jag', 'hej', 'tack', 'hur', 'var', 'nar', 'darfor', 'ar', 'mycket'],
};

// Letras y combinaciones que delatan un idioma latino concreto. Un solo
// carácter distintivo pesa más que una palabra frecuente, porque "ñ" o "ã" no
// aparecen casi nunca por casualidad en otro idioma.
const DISTINCTIVE = [
  { code: 'es', chars: ['ñ', '¿', '¡'], words: [] },
  { code: 'pt', chars: ['ã', 'õ', 'ç'], words: [] },
  { code: 'fr', chars: ['ç', 'œ', 'ê', 'ë'], words: ['cest', 'quil', 'jai', 'être'] },
  { code: 'de', chars: ['ß'], words: [] },
  { code: 'ro', chars: ['ă', 'ș', 'ț', 'â'], words: [] },
  { code: 'tr', chars: ['ğ', 'ş', 'ı'], words: [] },
  { code: 'vi', chars: ['đ', 'ơ', 'ư'], words: [] },
  { code: 'sv', chars: ['å', 'ä', 'ö'], words: [] },
  { code: 'pl', chars: ['ł', 'ą', 'ę', 'ż', 'ź', 'ć', 'ś'], words: [] },
];

function fold(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function words(text) {
  // Las palabras de una sola letra ("y", "e", "a") no discriminan y ensucian el
  // recuento; se descartan salvo que sean la única señal disponible.
  return fold(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Detecta el idioma de un texto.
 *
 * Devuelve `{ language, confidence, reason }`. `confidence` va de 0 a 1: por
 * debajo de 0,35 conviene no traducir, porque la señal es demasiado débil.
 */
function detectLanguage(text, { hint = null } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return { language: null, confidence: 0, reason: 'empty' };

  const letters = (raw.match(/\p{L}/gu) || []).length;
  if (letters === 0) return { language: null, confidence: 0, reason: 'no-letters' };

  const scripts = scriptScores(raw);

  // --- Escrituras propias: la señal más fuerte que hay ---
  if (scripts.hangul > 0) {
    return { language: 'ko', confidence: 0.95, reason: 'script' };
  }
  if (scripts.kana > 0) {
    // El japonés usa kanji además de kana; el kana es lo que lo distingue del
    // chino, que solo tiene han.
    return { language: 'ja', confidence: 0.95, reason: 'script' };
  }
  if (scripts.han > 0) {
    // Solo han: chino. Simplificado o tradicional se decide por los caracteres
    // que solo existen en una de las dos formas; si no aparece ninguno de los
    // dos conjuntos, se asume simplificado, que es lo mayoritario.
    const traditional = /[繁體與國學說話這來時對開關門馬車鳥魚龍風]/u.test(raw);
    const simplified = /[简与国学说话这来时对开关门马车鸟鱼龙风]/u.test(raw);
    if (traditional && !simplified) {
      return { language: 'zh-Hant', confidence: 0.85, reason: 'script' };
    }
    if (simplified && !traditional) {
      return { language: 'zh-Hans', confidence: 0.85, reason: 'script' };
    }
    return { language: 'zh-Hans', confidence: 0.7, reason: 'script' };
  }
  if (scripts.cyrillic > scripts.latin && scripts.cyrillic > 0) {
    // Ucraniano se distingue por letras que el ruso no usa (і, ї, є, ґ).
    const uk = /[іїєґ]/i.test(raw);
    return { language: uk ? 'uk' : 'ru', confidence: uk ? 0.9 : 0.8, reason: 'script' };
  }
  if (scripts.hebrew > 0) return { language: 'he', confidence: 0.9, reason: 'script' };
  if (scripts.greek > 0) return { language: 'el', confidence: 0.9, reason: 'script' };
  if (scripts.thai > 0) return { language: 'th', confidence: 0.9, reason: 'script' };
  if (scripts.devanagari > 0) return { language: 'hi', confidence: 0.9, reason: 'script' };
  if (scripts.bengali > 0) return { language: 'bn', confidence: 0.9, reason: 'script' };
  if (scripts.arabic > 0) {
    // Árabe, persa y urdu comparten alfabeto. Se distinguen por letras propias:
    // el persa tiene پ چ ژ گ y el urdu además ٹ ڈ ڑ ں ھ ے.
    if (/[ٹڈڑںھےۓ]/u.test(raw)) return { language: 'ur', confidence: 0.85, reason: 'script' };
    if (/[پچژگ]/u.test(raw)) return { language: 'fa', confidence: 0.75, reason: 'script' };
    return { language: 'ar', confidence: 0.8, reason: 'script' };
  }

  // --- Escritura latina: palabras frecuentes y letras distintivas ---
  const list = words(raw);
  const lower = fold(raw);

  const scores = new Map();
  for (const [code, stop] of Object.entries(STOPWORDS)) {
    let hits = 0;
    for (const word of list) {
      if (stop.includes(word)) hits += 1;
    }
    if (hits > 0) scores.set(code, hits * 2);
  }

  for (const { code, chars } of DISTINCTIVE) {
    let hits = 0;
    for (const char of chars) {
      if (lower.includes(char)) hits += 1;
    }
    if (hits > 0) scores.set(code, (scores.get(code) || 0) + hits * 3);
  }

  if (scores.size === 0) {
    // Sin ninguna pista. Si el llamador sabe qué idioma se esperaba, esa es la
    // mejor apuesta: es el caso de un mensaje corto ("ok", "👍") en un hilo
    // entre dos personas cuyo idioma ya se conoce.
    const normalizedHint = normalizeLanguage(hint);
    if (normalizedHint) {
      return { language: normalizedHint, confidence: 0.3, reason: 'hint' };
    }
    return { language: null, confidence: 0, reason: 'unknown' };
  }

  const [best, bestScore] = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  const total = [...scores.values()].reduce((sum, n) => sum + n, 0);
  const share = bestScore / total;

  // La confianza combina dos cosas: cuánta señal hay en total (una frase larga
  // vale más que una palabra) y cuánto destaca el ganador sobre el resto. Una
  // sola palabra que solo aparece en un idioma es poca señal aunque gane por
  // goleada.
  const volume = Math.min(1, list.length / 6);
  const margin = Math.min(1, share * 1.4);
  const confidence = Number((0.35 + 0.65 * volume * margin).toFixed(2));

  return { language: best, confidence, reason: 'words' };
}

// ¿Merece la pena traducir este texto? Se descartan los que no son texto real:
// emoticonos, cifras, URLs, y las frases tan cortas que la traducción aporta
// menos que el riesgo de equivocarse.
function isTranslatable(text) {
  const raw = String(text ?? '').trim();
  if (raw.length < 2) return false;
  const letters = (raw.match(/\p{L}/gu) || []).length;
  if (letters < 2) return false;
  // Una URL o un correo no se traducen.
  if (/^https?:\/\/\S+$/i.test(raw)) return false;
  if (/^\S+@\S+\.\S+$/.test(raw)) return false;
  return true;
}

/**
 * Decide qué hacer con un texto de cara a traducirlo.
 *
 * Devuelve `{ source, target, needed, confidence, reason }`. `needed` es lo que
 * consulta el llamador: si es `false`, se sirve el texto original sin gastar una
 * llamada al proveedor.
 */
function planTranslation({ text, target, hint = null }) {
  const normalizedTarget = normalizeLanguage(target);
  if (!normalizedTarget) {
    return { source: null, target: null, needed: false, confidence: 0, reason: 'no-target' };
  }
  if (!isTranslatable(text)) {
    return { source: null, target: normalizedTarget, needed: false, confidence: 0, reason: 'not-translatable' };
  }

  const detected = detectLanguage(text, { hint });
  if (!detected.language) {
    return { source: null, target: normalizedTarget, needed: false, confidence: 0, reason: detected.reason };
  }

  if (sameLanguage(detected.language, normalizedTarget)) {
    return {
      source: detected.language,
      target: normalizedTarget,
      needed: false,
      confidence: detected.confidence,
      reason: 'same-language',
    };
  }

  return {
    source: detected.language,
    target: normalizedTarget,
    needed: true,
    confidence: detected.confidence,
    reason: detected.reason,
  };
}

module.exports = {
  LANGUAGES,
  FALLBACK,
  normalizeLanguage,
  languageName,
  sameLanguage,
  detectLanguage,
  isTranslatable,
  planTranslation,
  fold,
};
