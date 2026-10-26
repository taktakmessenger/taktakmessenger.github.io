// Lógica de traducción del cliente: elección de idioma, decisión de traducir y
// voz del sintetizador.
//
// Son funciones puras, así que se prueban sin navegador ni red. El caso que
// importa es el del enunciado: alguien escribe en español y el receptor chino
// tiene que leerlo (y oírlo) en chino.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANGUAGES,
  normalizeLanguage,
  languageName,
  languageNativeName,
  sameLanguage,
  resolveViewerLanguage,
  isTranslatable,
  guessLanguageByScript,
  shouldTranslate,
  translationCacheKey,
  speechLocale,
  pickVoice,
} from '../src/lib/translate.js';

// --- Normalización ----------------------------------------------------------

test('normaliza variantes al código del catálogo', () => {
  assert.equal(normalizeLanguage('es-ES'), 'es');
  assert.equal(normalizeLanguage('ES'), 'es');
  assert.equal(normalizeLanguage('pt_BR'), 'pt');
  assert.equal(normalizeLanguage('zh-CN'), 'zh-Hans');
  assert.equal(normalizeLanguage('zh-TW'), 'zh-Hant');
  assert.equal(normalizeLanguage('klingon'), null);
  assert.equal(normalizeLanguage(''), null);
  assert.equal(normalizeLanguage(null), null);
});

test('el catálogo se normaliza a sí mismo y tiene nombre nativo', () => {
  for (const l of LANGUAGES) {
    assert.equal(normalizeLanguage(l.code), l.code, `${l.code} no se normaliza a sí mismo`);
    assert.ok(l.nativeName, `${l.code} sin nombre nativo`);
  }
});

test('languageName y languageNativeName dan el nombre del catálogo', () => {
  assert.equal(languageName('zh-Hans'), 'Chino simplificado');
  assert.equal(languageNativeName('zh-Hans'), '简体中文');
  assert.equal(languageName('xx'), null);
});

test('sameLanguage no confunde simplificado con tradicional', () => {
  assert.ok(sameLanguage('es', 'es-ES'));
  assert.ok(sameLanguage('zh-CN', 'zh-Hans'));
  assert.ok(!sameLanguage('zh-Hans', 'zh-Hant'));
  assert.ok(!sameLanguage('es', 'en'));
});

// --- Idioma del que lee ------------------------------------------------------

test('sin preferencia se usa el idioma del navegador', () => {
  assert.equal(resolveViewerLanguage({ navigator: { language: 'zh-CN' } }), 'zh-Hans');
  assert.equal(resolveViewerLanguage({ navigator: { language: 'en-US' } }), 'en');
  assert.equal(resolveViewerLanguage({ navigator: { language: 'pt-BR' } }), 'pt');
});

test('la preferencia guardada gana sobre el navegador', () => {
  const lang = resolveViewerLanguage({
    preferred: 'zh-Hans',
    navigator: { language: 'es-ES' },
  });
  assert.equal(lang, 'zh-Hans');
});

test('se recorre la lista de idiomas del navegador hasta encontrar uno conocido', () => {
  const lang = resolveViewerLanguage({
    navigator: { languages: ['xx-YY', 'klingon', 'zh-TW'], language: 'xx' },
  });
  assert.equal(lang, 'zh-Hant');
});

test('sin nada reconocible se cae a español, el idioma de la app', () => {
  // Un navegador sin idiomas declarados: no hay ninguna pista que usar.
  assert.equal(resolveViewerLanguage({ navigator: {} }), 'es');
  // Y una preferencia guardada con un código inválido tampoco vale: se ignora y
  // se sigue con el navegador, en vez de quedarse con un idioma que no existe.
  assert.equal(resolveViewerLanguage({ preferred: 'klingon', navigator: { language: 'fr' } }), 'fr');
});

// --- Decisión de traducir ---------------------------------------------------

test('isTranslatable descarta lo que no es texto', () => {
  assert.ok(isTranslatable('Hola'));
  assert.ok(isTranslatable('你好'));
  assert.ok(!isTranslatable(''));
  assert.ok(!isTranslatable('ok'.slice(0, 1)));
  assert.ok(!isTranslatable('12'));
  assert.ok(!isTranslatable('😀'));
  assert.ok(!isTranslatable('https://taktak.app/x'));
  assert.ok(!isTranslatable('a@b.com'));
});

test('el alfabeto identifica las escrituras con signos propios', () => {
  assert.equal(guessLanguageByScript('你好，你好吗？'), 'zh-Hans');
  assert.equal(guessLanguageByScript('你好，這是我說話的時候'), 'zh-Hant');
  assert.equal(guessLanguageByScript('こんにちは'), 'ja');
  assert.equal(guessLanguageByScript('안녕하세요'), 'ko');
  assert.equal(guessLanguageByScript('Привет'), 'ru');
  assert.equal(guessLanguageByScript('Привіт'), 'uk');
  assert.equal(guessLanguageByScript('مرحبا'), 'ar');
  assert.equal(guessLanguageByScript('Γεια σου'), 'el');
  // El latino no se puede decidir por escritura.
  assert.equal(guessLanguageByScript('Hola'), null);
});

test('el caso del enunciado: el español no se traduce para el español', () => {
  const decision = shouldTranslate({ text: 'Hola, ¿cómo estás?', target: 'es' });
  // La escritura latina no decide sola, así que se delega al servidor. Lo que
  // importa es que NO se descarta por error.
  assert.equal(decision.needed, true);
  assert.equal(decision.reason, 'unknown-script');
});

test('el caso del enunciado: el chino no se traduce para el chino', () => {
  const decision = shouldTranslate({ text: '你好，你好吗？', target: 'zh-Hans' });
  assert.equal(decision.needed, false);
  assert.equal(decision.reason, 'same-language');
});

test('el caso del enunciado: el chino sí se traduce para el español', () => {
  const decision = shouldTranslate({ text: '你好，你好吗？', target: 'es' });
  assert.equal(decision.needed, true);
  assert.equal(decision.source, 'zh-Hans');
  assert.equal(decision.target, 'es');
});

test('el simplificado se traduce al tradicional (son idiomas distintos)', () => {
  const decision = shouldTranslate({ text: '你好，你好吗？', target: 'zh-Hant' });
  assert.equal(decision.needed, true);
});

test('un emoticono no se manda a traducir', () => {
  const decision = shouldTranslate({ text: '👍', target: 'zh-Hans' });
  assert.equal(decision.needed, false);
  assert.equal(decision.reason, 'not-translatable');
});

test('un destino no soportado no produce decisión', () => {
  const decision = shouldTranslate({ text: 'Hola', target: 'klingon' });
  assert.equal(decision.needed, false);
  assert.equal(decision.reason, 'no-target');
});

test('la clave de caché distingue el idioma de destino', () => {
  const en = translationCacheKey({ text: 'Hola', target: 'en' });
  const zh = translationCacheKey({ text: 'Hola', target: 'zh-Hans' });
  assert.notEqual(en, zh);
  // Y normaliza, para que 'zh-CN' y 'zh-Hans' compartan entrada.
  assert.equal(zh, translationCacheKey({ text: 'Hola', target: 'zh-CN' }));
});

// --- Voz del sintetizador ---------------------------------------------------

test('speechLocale traduce el código al que espera el navegador', () => {
  assert.equal(speechLocale('zh-Hans'), 'zh-CN');
  assert.equal(speechLocale('zh-Hant'), 'zh-TW');
  assert.equal(speechLocale('es'), 'es-ES');
  assert.equal(speechLocale('en-US'), 'en-US');
  assert.equal(speechLocale('pt'), 'pt-BR');
  assert.equal(speechLocale('klingon'), null);
});

test('pickVoice prefiere la coincidencia exacta de región', () => {
  const voices = [
    { lang: 'zh-TW', name: 'Taiwanés' },
    { lang: 'zh-CN', name: 'Mandarín' },
    { lang: 'en-US', name: 'Inglés' },
  ];
  assert.equal(pickVoice(voices, 'zh-Hans').name, 'Mandarín');
  assert.equal(pickVoice(voices, 'zh-Hant').name, 'Taiwanés');
});

test('pickVoice cae al idioma base si no hay región exacta', () => {
  const voices = [{ lang: 'es-MX', name: 'Español MX' }];
  assert.equal(pickVoice(voices, 'es').name, 'Español MX');
});

test('pickVoice devuelve null si no hay voz para ese idioma', () => {
  const voices = [{ lang: 'en-US', name: 'Inglés' }];
  assert.equal(pickVoice(voices, 'zh-Hans'), null);
  assert.equal(pickVoice([], 'zh-Hans'), null);
  assert.equal(pickVoice(undefined, 'zh-Hans'), null);
});

test('pickVoice normaliza el guion bajo de las voces del sistema', () => {
  // Algunos navegadores devuelven `zh_CN` con guion bajo.
  const voices = [{ lang: 'zh_CN', name: 'Mandarín' }];
  assert.equal(pickVoice(voices, 'zh-Hans').name, 'Mandarín');
});
