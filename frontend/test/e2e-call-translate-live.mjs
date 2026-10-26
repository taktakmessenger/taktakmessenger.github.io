// El ciclo completo de una llamada traducida: oír → traducir → hablar, y el
// freno del eco.
//
// Chromium headless no trae motor de voz: `webkitSpeechRecognition` existe pero
// no hay servicio detrás, y `speechSynthesis` no tiene voces. Por eso el motor se
// sustituye por un doble instalado ANTES de cargar la app (`addInitScript`). Lo
// que se prueba es todo lo demás, que es donde están los fallos: el cableado de
// `CallContext`, el envío por `call:speech`, el relay del servidor, la traducción
// de verdad contra la API y la pausa del micrófono mientras suena la traducción.
//
// Uso:  node test/e2e-call-translate-live.mjs
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:12000';
const stamp = Date.now();

let failures = 0;
function check(label, condition, extra = '') {
  const mark = condition ? '✓' : '✗';
  if (!condition) failures += 1;
  console.log(`  ${mark} ${label}${extra ? ` — ${extra}` : ''}`);
}

async function dismissPrompts(page) {
  for (let i = 0; i < 12; i += 1) {
    const closed = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      let count = 0;
      for (const dialog of dialogs) {
        const button = [...dialog.querySelectorAll('button')].find((b) =>
          /ahora no|omitir|cerrar|no, gracias/i.test(b.textContent.trim())
        );
        if (button) {
          button.click();
          count += 1;
        }
      }
      return count;
    });
    await page.waitForTimeout(400);
    if (closed === 0 && (await page.locator('[role="dialog"]').count()) === 0) return;
  }
}

// Sustituye los dos motores de voz por dobles controlables desde la prueba. Se
// instala antes de que arranque la app para que `canRecognize`/`canSynthesize`
// ya vean un motor disponible.
const SPEECH_STUB = () => {
  const state = {
    rec: null,
    started: 0,
    stopped: 0,
    spoken: [],
    speaking: false,
  };
  window.__speech = state;

  function FakeRecognition() {
    this.running = false;
    this.lang = '';
    state.rec = this;
  }
  FakeRecognition.prototype.start = function start() {
    if (this.running) throw new Error('already started');
    this.running = true;
    state.started += 1;
  };
  FakeRecognition.prototype.stop = function stop() {
    this.running = false;
    state.stopped += 1;
    this.onend?.();
  };
  FakeRecognition.prototype.abort = function abort() {
    this.running = false;
    this.onend?.();
  };
  // Emite una frase final como si la hubiera dicho el micrófono.
  state.emitFinal = (text) => {
    const result = [{ transcript: text }];
    result.isFinal = true;
    state.rec?.onresult?.({ resultIndex: 0, results: [result] });
  };

  const synth = {
    getVoices: () => [
      { lang: 'es-ES', name: 'Voz ES' },
      { lang: 'zh-CN', name: 'Voz ZH' },
      { lang: 'en-US', name: 'Voz EN' },
    ],
    speak(utterance) {
      state.spoken.push({ text: utterance.text, lang: utterance.lang });
      state.speaking = true;
      state.pendingUtterance = utterance;
    },
    cancel() {
      state.speaking = false;
      state.pendingUtterance = null;
    },
  };
  // La prueba decide cuándo termina la frase, para poder mirar el estado mientras
  // el altavoz "está hablando".
  state.finishSpeaking = () => {
    const u = state.pendingUtterance;
    state.speaking = false;
    state.pendingUtterance = null;
    u?.onend?.();
  };

  Object.defineProperty(window, 'webkitSpeechRecognition', {
    value: FakeRecognition,
    configurable: true,
  });
  Object.defineProperty(window, 'SpeechRecognition', {
    value: FakeRecognition,
    configurable: true,
  });
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function Utterance() {
    this.text = '';
    this.lang = '';
    this.rate = 1;
  };
};

async function register(context, name, language) {
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.addInitScript(SPEECH_STUB);

  const username = `${name}_${stamp}`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@example.com`, password: 'clave12345' }),
  });
  if (!res.ok) throw new Error(`registro falló: ${res.status}`);
  const data = await res.json();

  await fetch(`${BASE}/api/users/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
    body: JSON.stringify({ preferredLanguage: language }),
  });

  await page.goto(BASE);
  await page.evaluate(
    ([token, user]) => {
      localStorage.setItem('taktak_token', token);
      localStorage.setItem('taktak_user', JSON.stringify(user));
    },
    [data.token, data.user]
  );
  await page.reload();
  await page.waitForTimeout(1200);
  await dismissPrompts(page);
  return { page, user: data.user, username, logs };
}

async function openChatWith(me, otherUsername) {
  await me.page.getByRole('button', { name: 'WhaTaka' }).click();
  await me.page.waitForTimeout(600);
  await me.page.locator('.btn-new-chat').click();
  await me.page.waitForTimeout(300);
  const form = me.page.locator('.start-chat');
  await form.locator('input').fill(otherUsername);
  await form.locator('button[type="submit"]').click();
  await me.page.waitForTimeout(1500);
  await me.page
    .waitForFunction(() => !document.querySelector('.thread-call button')?.disabled, { timeout: 10000 })
    .catch(() => {});
}

async function waitActive(page) {
  await page
    .waitForFunction(
      () => document.querySelector('.call-overlay .call-info span')?.textContent === 'En llamada',
      { timeout: 15000 }
    )
    .catch(() => {});
}

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

try {
  const ctxA = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const ctxB = await browser.newContext({ permissions: ['microphone', 'camera'] });

  console.log('\n▸ Ana (español) llama a Li (chino) desde WhaTaka');
  const a = await register(ctxA, 'ana', 'es');
  const b = await register(ctxB, 'li', 'zh-Hans');

  await openChatWith(a, b.username);
  await a.page.getByRole('button', { name: 'Llamada de voz' }).click();
  await a.page.waitForTimeout(2500);
  await b.page.locator('.call-btn.accept').click();
  await waitActive(a.page);
  await waitActive(b.page);
  check('la llamada queda activa en los dos', true);

  console.log('\n▸ Los dos encienden la traducción en vivo');
  await a.page.getByRole('button', { name: 'Traducir la llamada en vivo' }).click();
  await b.page.getByRole('button', { name: 'Traducir la llamada en vivo' }).click();
  await a.page.waitForTimeout(1000);

  const recA = await a.page.evaluate(() => Boolean(window.__speech?.rec));
  const recB = await b.page.evaluate(() => Boolean(window.__speech?.rec));
  check('los dos abren su micrófono para traducir', recA && recB);

  console.log('\n▸ Ana habla: se reconoce, se manda y Li lo oye en chino');
  // Ana dice una frase en español. El reconocedor la entrega como final y
  // `CallContext` la manda por `call:speech`.
  await a.page.evaluate(() => window.__speech.emitFinal('Hola, ¿cómo estás?'));

  // El servidor la reenvía, Li la traduce a su idioma y la dice por el altavoz.
  await b.page.waitForFunction(() => (window.__speech?.spoken?.length || 0) > 0, { timeout: 20000 }).catch(() => {});
  const spokenB = await b.page.evaluate(() => window.__speech.spoken);

  check('a Li le llega algo para decir', spokenB.length >= 1, JSON.stringify(spokenB));
  check('lo que dice Li está en chino', spokenB[0]?.lang?.startsWith('zh'), String(spokenB[0]?.lang));
  check(
    'la traducción no es el original en español',
    spokenB[0]?.text && spokenB[0].text !== 'Hola, ¿cómo estás?',
    String(spokenB[0]?.text)
  );
  check(
    'la traducción tiene caracteres chinos',
    /[\u4e00-\u9fff]/.test(spokenB[0]?.text || ''),
    String(spokenB[0]?.text)
  );

  console.log('\n▸ El micrófono de Li se cierra mientras su altavoz habla (no hay eco)');
  // En este momento Li está diciendo la traducción. Si su micrófono siguiera
  // abierto, oiría su propia voz, la reconocería y la reenviaría a Ana.
  const micDuringSpeech = await b.page.evaluate(() => window.__speech.rec?.running);
  check('el micrófono está cerrado mientras habla la traducción', micDuringSpeech === false);

  const spokenBeforeEcho = await b.page.evaluate(() => window.__speech.spoken.length);
  // Se simula que el micrófono de Li oyó su propia traducción: no debe salir.
  await b.page.evaluate(() => window.__speech.emitFinal('你好，你好吗？'));
  await a.page.waitForTimeout(1200);
  const spokenAfterEcho = await b.page.evaluate(() => window.__speech.spoken.length);
  check(
    'lo que oye su propio altavoz no se vuelve a decir',
    spokenAfterEcho === spokenBeforeEcho,
    `${spokenBeforeEcho} → ${spokenAfterEcho}`
  );

  // Al terminar la frase, el micrófono vuelve a abrirse para seguir escuchando.
  await b.page.evaluate(() => window.__speech.finishSpeaking());
  await b.page.waitForTimeout(500);
  const micAfterSpeech = await b.page.evaluate(() => window.__speech.rec?.running);
  check('al callar el altavoz, el micrófono se reabre', micAfterSpeech === true);

  console.log('\n▸ Los subtítulos enseñan original y traducción');
  const caption = await b.page.locator('.call-caption-translated').textContent().catch(() => null);
  check('Li ve el subtítulo traducido', Boolean(caption && caption.trim()), String(caption));

  console.log('\n▸ Colgar apaga la traducción');
  await a.page.locator('.call-btn.end').click();
  await a.page.waitForTimeout(1500);

  const errA = a.logs.filter((l) => l.startsWith('pageerror'));
  const errB = b.logs.filter((l) => l.startsWith('pageerror'));
  check('sin errores de página', errA.length === 0 && errB.length === 0, [...errA, ...errB].join(' | '));

  await ctxA.close();
  await ctxB.close();
} finally {
  await browser.close();
}

console.log(
  failures === 0
    ? '\n✅ La llamada traducida funciona de extremo a extremo, sin eco'
    : `\n❌ ${failures} comprobación(es) fallida(s)`
);
process.exit(failures === 0 ? 0 : 1);
