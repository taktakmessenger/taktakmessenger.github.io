// Traducción en vivo de las llamadas de WhaTaka: que se ofrezca cuando hace
// falta y que no aparezca cuando no.
//
// Lo que se comprueba es lo que ve el usuario: que al recibir una llamada de
// alguien que habla otro idioma le salga el aviso para traducir, y que si los
// dos hablan el mismo no le salga nada. El idioma se fija por la API, que es
// como lo pone la cuenta, y la llamada se inicia por la interfaz, igual que una
// persona. Así la prueba vale para el build que se despliega y no para un
// atajo que solo existe en desarrollo.
//
// Uso:  node test/e2e-call-translate.mjs
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

// Registra una cuenta, le fija el idioma por la API y entra en la app. El
// idioma es lo único que decide si la app ofrece traducir, así que se fija
// antes de abrir el hilo.
async function register(context, name, language) {
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

  const username = `${name}_${stamp}`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      email: `${username}@example.com`,
      password: 'clave12345',
    }),
  });
  if (!res.ok) throw new Error(`registro falló: ${res.status}`);
  const data = await res.json();

  await fetch(`${BASE}/api/users/me`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.token}`,
    },
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

// Espera a que la llamada llegue a estar activa en las dos pantallas.
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
  console.log('\n▸ Dos idiomas distintos: español y chino');
  // Cada caso necesita sus propias cuentas y su propio contexto: una llamada
  // deja el hilo abierto y reutilizarlo mezclaría los dos escenarios.
  {
    const ctxA = await browser.newContext({ permissions: ['microphone', 'camera'] });
    const ctxB = await browser.newContext({ permissions: ['microphone', 'camera'] });
    const a = await register(ctxA, 'esp', 'es');
    const b = await register(ctxB, 'chi', 'zh-Hans');

    await openChatWith(a, b.username);
    await a.page.getByRole('button', { name: 'Llamada de voz' }).click();
    await a.page.waitForTimeout(2500);

    // El aviso solo tiene sentido una vez contestada: durante el timbrado no
    // hay voz que traducir. Se acepta y se mira entonces.
    await b.page.locator('.call-btn.accept').click();
    await waitActive(a.page);
    await waitActive(b.page);

    const promptB = await b.page.locator('.call-translate-prompt').count();
    const promptA = await a.page.locator('.call-translate-prompt').count();
    const textB = await b.page
      .locator('.call-translate-prompt span')
      .textContent()
      .catch(() => null);

    check('al chino le sale el aviso de traducir', promptB === 1, `prompt=${promptB}`);
    check('al español también le sale el aviso', promptA === 1, `prompt=${promptA}`);
    check('el aviso dice que habla otro idioma', /otro idioma/i.test(textB || ''), String(textB));

    // Y el botón del panel sigue estando, que es la otra forma de encenderla.
    const translateButtons = await b.page.locator('.call-actions .call-btn').count();
    check('la llamada tiene sus controles', translateButtons >= 3, `${translateButtons} botones`);

    await a.page.locator('.call-btn.end').click();
    await a.page.waitForTimeout(1000);

    const errA = a.logs.filter((l) => l.startsWith('pageerror') || l.startsWith('error:'));
    const errB = b.logs.filter((l) => l.startsWith('pageerror') || l.startsWith('error:'));
    check('sin errores de página', errA.length === 0 && errB.length === 0, [...errA, ...errB].join(' | '));

    await ctxA.close();
    await ctxB.close();
  }

  console.log('\n▸ Mismo idioma: español con español');
  {
    const ctxA = await browser.newContext({ permissions: ['microphone', 'camera'] });
    const ctxB = await browser.newContext({ permissions: ['microphone', 'camera'] });
    const a = await register(ctxA, 'esp1', 'es');
    const b = await register(ctxB, 'esp2', 'es');

    await openChatWith(a, b.username);
    await a.page.getByRole('button', { name: 'Llamada de voz' }).click();
    await a.page.waitForTimeout(2500);
    await b.page.locator('.call-btn.accept').click();
    await waitActive(a.page);
    await waitActive(b.page);

    const promptB = await b.page.locator('.call-translate-prompt').count();
    const promptA = await a.page.locator('.call-translate-prompt').count();

    // Ofrecer traducir entre dos personas que hablan lo mismo sería ruido, y
    // además haría dudar de que la app sepa de verdad qué idioma habla cada uno.
    check('no se ofrece traducir entre dos que hablan español', promptB === 0 && promptA === 0);

    await a.page.locator('.call-btn.end').click();
    await a.page.waitForTimeout(1000);
    await ctxA.close();
    await ctxB.close();
  }
} finally {
  await browser.close();
}

console.log(
  failures === 0
    ? '\n✅ La traducción de llamadas se ofrece cuando hace falta y solo entonces'
    : `\n❌ ${failures} comprobación(es) fallida(s)`
);
process.exit(failures === 0 ? 0 : 1);
