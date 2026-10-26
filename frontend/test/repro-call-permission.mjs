// Reproduce el fallo reportado: al aceptar una videollamada con el permiso de
// cámara/micrófono denegado. Simula el NotAllowedError del navegador en el
// receptor y captura el texto exacto que ven las dos partes.
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:12000';
const stamp = Date.now();

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

async function dismissPrompts(page) {
  for (let i = 0; i < 12; i += 1) {
    const closed = await page.evaluate(() => {
      let n = 0;
      for (const d of document.querySelectorAll('[role="dialog"]')) {
        const b = [...d.querySelectorAll('button')].find((x) =>
          /ahora no|omitir|cerrar|no, gracias/i.test(x.textContent.trim())
        );
        if (b) { b.click(); n += 1; }
      }
      return n;
    });
    await page.waitForTimeout(300);
    if (closed === 0 && (await page.locator('[role="dialog"]').count()) === 0) return;
  }
}

async function register(context, name) {
  const page = await context.newPage();
  const username = `${name}_${stamp}`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@example.com`, password: 'clave12345' }),
  });
  const data = await res.json();
  await page.goto(BASE);
  await page.evaluate(
    ([t, u]) => {
      localStorage.setItem('taktak_token', t);
      localStorage.setItem('taktak_user', JSON.stringify(u));
    },
    [data.token, data.user]
  );
  await page.reload();
  await page.waitForTimeout(1200);
  await dismissPrompts(page);
  return { page, username };
}

async function openChatWith(me, other) {
  await me.page.getByRole('button', { name: 'WhaTaka' }).click();
  await me.page.waitForTimeout(600);
  await me.page.locator('.btn-new-chat').click();
  await me.page.waitForTimeout(300);
  const form = me.page.locator('.start-chat');
  await form.locator('input').fill(other);
  await form.locator('button[type="submit"]').click();
  await me.page.waitForTimeout(1500);
  await me.page
    .waitForFunction(() => !document.querySelector('.thread-call button')?.disabled, { timeout: 10000 })
    .catch(() => {});
}

const ctxA = await browser.newContext({ permissions: ['microphone', 'camera'] });
const ctxB = await browser.newContext({ permissions: ['microphone', 'camera'] });

const a = await register(ctxA, 'reproa');
const b = await register(ctxB, 'reprob');

// El receptor deniega el permiso: getUserMedia rechaza como el navegador real.
// Se instala como script de arranque y se recarga, para que la app corra ya con
// el permiso denegado (si se definiera después, la llamada ya habría usado la
// versión buena).
await b.page.addInitScript(() => {
  const deny = () =>
    Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    configurable: true,
    value: deny,
  });
});
await b.page.reload();
await b.page.waitForTimeout(1500);
await dismissPrompts(b.page);

console.log('\n▸ Ana abre el hilo con Beto y le videollama');
await openChatWith(a, b.username);
await a.page.getByRole('button', { name: 'Videollamada' }).click();
await a.page.waitForTimeout(2500);
console.log('  Ana ve:', await a.page.locator('.call-overlay .call-info span').textContent().catch(() => null));
console.log('  Beto ve:', await b.page.locator('.call-overlay .call-info span').textContent().catch(() => null));

console.log('\n▸ Beto pulsa Aceptar (con el permiso denegado)');
await b.page.locator('.call-btn.accept').click();
await a.page.waitForTimeout(2500);

const bOverlay = await b.page.locator('.call-overlay').count();
const bError = await b.page.locator('.call-overlay .call-info .error').textContent().catch(() => null);
const aError = await a.page.locator('.call-overlay .call-info .error').textContent().catch(() => null);
console.log('  overlay de Beto sigue:', bOverlay);
console.log('  error que ve Beto:', JSON.stringify(bError));
console.log('  error que ve Ana:', JSON.stringify(aError));

console.log('\n▸ Lo que queda en el historial del hilo (lo que ve Beto en el chat)');
await b.page.waitForTimeout(1000);
const entries = await b.page.locator('[class*="call"]').allTextContents().catch(() => []);
console.log('  entradas de llamada:', JSON.stringify(entries.slice(0, 8)));

await browser.close();

