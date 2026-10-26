// Detección de idioma: la pieza que decide si un mensaje hay que traducirlo.
//
// Son funciones puras, así que se prueban directamente, sin base de datos ni
// servidor. El caso que importa es el real: alguien escribe una frase en su
// idioma y hay que saber en cuál está para no traducirle su propio idioma.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLanguage,
  languageName,
  sameLanguage,
  detectLanguage,
  isTranslatable,
  planTranslation,
  LANGUAGES,
} = require('../src/lib/language');

// --- Normalización de códigos ----------------------------------------------

test('normaliza variantes regionales a un código canónico', () => {
  assert.equal(normalizeLanguage('es'), 'es');
  assert.equal(normalizeLanguage('ES'), 'es');
  assert.equal(normalizeLanguage('es-ES'), 'es');
  assert.equal(normalizeLanguage('es_419'), 'es');
  assert.equal(normalizeLanguage('en-US'), 'en');
  assert.equal(normalizeLanguage('pt-BR'), 'pt');
  assert.equal(normalizeLanguage('  FR  '), 'fr');
});

test('el chino se normaliza a simplificado o tradicional, no a "zh"', () => {
  assert.equal(normalizeLanguage('zh'), 'zh-Hans');
  assert.equal(normalizeLanguage('zh-CN'), 'zh-Hans');
  assert.equal(normalizeLanguage('zh_CN'), 'zh-Hans');
  assert.equal(normalizeLanguage('zh-Hans'), 'zh-Hans');
  assert.equal(normalizeLanguage('zh-TW'), 'zh-Hant');
  assert.equal(normalizeLanguage('zh-HK'), 'zh-Hant');
  assert.equal(normalizeLanguage('zh-Hant'), 'zh-Hant');
});

test('reconoce códigos ISO antiguos', () => {
  assert.equal(normalizeLanguage('in'), 'id'); // indonesio
  assert.equal(normalizeLanguage('iw'), 'he'); // hebreo
  assert.equal(normalizeLanguage('mo'), 'ro'); // moldavo
});

test('un idioma desconocido o vacío devuelve null', () => {
  assert.equal(normalizeLanguage(''), null);
  assert.equal(normalizeLanguage(null), null);
  assert.equal(normalizeLanguage(undefined), null);
  assert.equal(normalizeLanguage(42), null);
  assert.equal(normalizeLanguage('klingon'), null);
});

test('languageName da el nombre en español del catálogo', () => {
  assert.equal(languageName('es'), 'Español');
  assert.equal(languageName('zh-Hans'), 'Chino simplificado');
  assert.equal(languageName('xx'), null);
});

test('el catálogo no tiene códigos repetidos', () => {
  const codes = LANGUAGES.map((l) => l.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const l of LANGUAGES) {
    assert.ok(l.nativeName, `${l.code} sin nombre nativo`);
    assert.equal(normalizeLanguage(l.code), l.code, `${l.code} no se normaliza a sí mismo`);
  }
});

test('sameLanguage compara idiomas, no cadenas', () => {
  assert.ok(sameLanguage('es', 'es-ES'));
  assert.ok(sameLanguage('ES', 'es'));
  assert.ok(sameLanguage('zh-CN', 'zh-Hans'));
  // Simplificado y tradicional son traducciones distintas entre sí.
  assert.ok(!sameLanguage('zh-Hans', 'zh-Hant'));
  assert.ok(!sameLanguage('es', 'en'));
  // Un código inválido nunca coincide, para no saltarse una traducción por error.
  assert.ok(!sameLanguage('es', 'klingon'));
});

// --- Detección ---------------------------------------------------------------

test('detecta español en frases reales', () => {
  const cases = [
    'Hola, ¿cómo estás?',
    '¿Puedes llamarme cuando puedas?',
    'Buenos días, tengo una pregunta sobre el pedido',
    'No entiendo lo que dices, ¿puedes repetir?',
  ];
  for (const text of cases) {
    const { language } = detectLanguage(text);
    assert.equal(language, 'es', `"${text}" se detectó como ${language}`);
  }
});

test('detecta inglés en frases reales', () => {
  const cases = [
    'Hello, how are you?',
    'Can you call me when you can?',
    'Good morning, I have a question about my order',
    'I do not understand what you are saying',
  ];
  for (const text of cases) {
    const { language } = detectLanguage(text);
    assert.equal(language, 'en', `"${text}" se detectó como ${language}`);
  }
});

test('detecta chino por su escritura, sin necesidad de palabras', () => {
  const simplified = detectLanguage('你好，你好吗？');
  assert.equal(simplified.language, 'zh-Hans');
  assert.equal(simplified.reason, 'script');

  const traditional = detectLanguage('你好，這是我說話的時候');
  assert.equal(traditional.language, 'zh-Hant');
  assert.equal(traditional.reason, 'script');
});

test('el japonés se distingue del chino por el kana', () => {
  // Kanji puro sería chino; con kana es japonés.
  assert.equal(detectLanguage('こんにちは').language, 'ja');
  assert.equal(detectLanguage('ありがとうございます').language, 'ja');
  assert.equal(detectLanguage('私は日本語を話します').language, 'ja');
});

test('el coreano se detecta por el hangul', () => {
  assert.equal(detectLanguage('안녕하세요').language, 'ko');
  assert.equal(detectLanguage('감사합니다').language, 'ko');
});

test('detecta ruso y ucraniano por la escritura cirílica', () => {
  assert.equal(detectLanguage('Привет, как дела?').language, 'ru');
  assert.equal(detectLanguage('Привіт, як справи?').language, 'uk');
});

test('detecta árabe, persa y urdu por sus letras propias', () => {
  assert.equal(detectLanguage('مرحبا كيف حالك').language, 'ar');
  assert.equal(detectLanguage('سلام، حال شما چطور است').language, 'fa');
  assert.equal(detectLanguage('آپ کیسے ہیں').language, 'ur');
});

test('detecta otros alfabetos', () => {
  assert.equal(detectLanguage('שלום מה שלומך').language, 'he');
  assert.equal(detectLanguage('Γεια σου τι κάνεις').language, 'el');
  assert.equal(detectLanguage('สวัสดีสบายดีไหม').language, 'th');
  assert.equal(detectLanguage('नमस्ते आप कैसे हैं').language, 'hi');
  assert.equal(detectLanguage('আপনি কেমন আছেন').language, 'bn');
});

test('detecta portugués, francés, alemán e italiano', () => {
  assert.equal(detectLanguage('Olá, você está bem? Obrigado pela ajuda').language, 'pt');
  assert.equal(detectLanguage('Bonjour, comment allez-vous? Merci beaucoup').language, 'fr');
  assert.equal(detectLanguage('Hallo, wie geht es dir? Danke für die Hilfe').language, 'de');
  assert.equal(detectLanguage('Ciao, come stai? Grazie per il messaggio').language, 'it');
});

test('el turco y el vietnamita se detectan por sus letras', () => {
  assert.equal(detectLanguage('Merhaba, nasılsın? Teşekkür ederim').language, 'tr');
  assert.equal(detectLanguage('Xin chào, bạn có khỏe không? Cảm ơn').language, 'vi');
});

test('un texto vacío o sin letras no tiene idioma', () => {
  assert.equal(detectLanguage('').language, null);
  assert.equal(detectLanguage('   ').language, null);
  assert.equal(detectLanguage('12345').language, null);
  assert.equal(detectLanguage('👍👍👍').language, null);
});

test('la confianza es baja en un texto muy corto y alta en una frase', () => {
  const short = detectLanguage('hola');
  const long = detectLanguage('Hola, buenos días, quería preguntarte una cosa sobre el pedido');
  assert.ok(short.confidence < long.confidence, 'la frase larga debe dar más confianza');
  assert.ok(long.confidence > 0.5);
});

test('con poca señal se usa el idioma esperado como pista', () => {
  // "ok" no tiene señal suficiente. Si el hilo es entre dos personas cuyo idioma
  // se conoce, esa es la mejor apuesta, pero con confianza baja para que no se
  // dispare una traducción a ciegas.
  const withHint = detectLanguage('ok', { hint: 'zh-Hans' });
  assert.equal(withHint.language, 'zh-Hans');
  assert.equal(withHint.reason, 'hint');
  assert.ok(withHint.confidence <= 0.35);

  // Sin pista, no se inventa nada.
  assert.equal(detectLanguage('ok').language, null);
});

// --- Plan de traducción ------------------------------------------------------

test('isTranslatable descarta lo que no es texto', () => {
  assert.ok(isTranslatable('Hola'));
  assert.ok(isTranslatable('你好'));
  assert.ok(!isTranslatable(''));
  assert.ok(!isTranslatable(' '));
  assert.ok(!isTranslatable('a'));
  assert.ok(!isTranslatable('12'));
  assert.ok(!isTranslatable('😀'));
  assert.ok(!isTranslatable('https://taktak.app/algo'));
  assert.ok(!isTranslatable('alguien@example.com'));
});

test('no se traduce cuando el texto ya está en el idioma del destinatario', () => {
  const plan = planTranslation({ text: 'Hola, ¿cómo estás?', target: 'es' });
  assert.equal(plan.needed, false);
  assert.equal(plan.reason, 'same-language');
  assert.equal(plan.source, 'es');
});

test('se traduce cuando los idiomas difieren', () => {
  const plan = planTranslation({ text: 'Hola, ¿cómo estás?', target: 'zh-Hans' });
  assert.equal(plan.needed, true);
  assert.equal(plan.source, 'es');
  assert.equal(plan.target, 'zh-Hans');
});

test('el caso del enunciado: español a chino', () => {
  const plan = planTranslation({ text: '¿Puedes llamarme mañana?', target: 'zh-CN' });
  assert.equal(plan.needed, true);
  assert.equal(plan.source, 'es');
  assert.equal(plan.target, 'zh-Hans', 'zh-CN debe normalizarse a zh-Hans');
});

test('el caso inverso: chino a español', () => {
  const plan = planTranslation({ text: '你好，你好吗？', target: 'es' });
  assert.equal(plan.needed, true);
  assert.equal(plan.source, 'zh-Hans');
  assert.equal(plan.target, 'es');
});

test('no se traduce lo que no es texto, aunque los idiomas difieran', () => {
  const plan = planTranslation({ text: '👍', target: 'zh-Hans' });
  assert.equal(plan.needed, false);
  assert.equal(plan.reason, 'not-translatable');
});

test('un destino no soportado no produce plan', () => {
  const plan = planTranslation({ text: 'Hola', target: 'klingon' });
  assert.equal(plan.needed, false);
  assert.equal(plan.reason, 'no-target');
  assert.equal(plan.target, null);
});

test('el plan lleva la confianza de la detección', () => {
  const plan = planTranslation({ text: 'Buenos días, tengo una pregunta', target: 'en' });
  assert.ok(plan.confidence > 0.5, 'una frase clara debe dar confianza alta');
  const weak = planTranslation({ text: 'ok', target: 'en' });
  assert.ok(weak.confidence <= 0.35);
});
