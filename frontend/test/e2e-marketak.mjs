// Prueba de extremo a extremo de Marketak, el mercado de segunda mano dentro de
// Facetak. Dos navegadores reales: Ana publica un anuncio y Beto lo encuentra,
// lo abre y escribe al vendedor. No usa mocks: recorre el mismo camino que una
// persona.
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:13000';
const stamp = Date.now();

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const browser = await chromium.launch();

// Descarta los avisos que tapan la interfaz (teléfono y notificaciones).
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
    if (closed === 0) {
      const remaining = await page.locator('[role="dialog"]').count();
      if (remaining === 0) return;
    }
  }
}

async function register(context, name) {
  const page = await context.newPage();
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
  const data = await res.json();
  if (!data.token) throw new Error(`no se pudo registrar ${name}: ${JSON.stringify(data)}`);
  await page.goto(BASE);
  await page.evaluate(
    ([token, user]) => {
      localStorage.setItem('taktak_token', token);
      localStorage.setItem('taktak_user', JSON.stringify(user));
    },
    [data.token, data.user]
  );
  await page.reload();
  await page.waitForTimeout(1500);
  await dismissPrompts(page);
  return { page, user: data.user, username, token: data.token };
}

async function openMarketak(who) {
  await who.page.getByRole('button', { name: 'Facetak' }).click();
  await who.page.waitForTimeout(1000);
  await who.page.getByRole('tab', { name: /Marketak/ }).click();
  await who.page.waitForTimeout(800);
}

const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const a = await register(ctxA, 'marketa');
const b = await register(ctxB, 'marketb');

// --- La pestaña existe -----------------------------------------------------
console.log('\n▸ Marketak está dentro de Facetak');
await openMarketak(a);
check('la sección Marketak se abre', (await a.page.locator('.market').count()) > 0);
check('hay buscador', (await a.page.locator('.market-search').count()) > 0);

// --- Publicar un anuncio con foto -----------------------------------------
console.log('\n▸ Ana publica un anuncio con foto');
const titulo = `Bici de prueba ${stamp}`;
await a.page.getByRole('button', { name: /Vender/ }).click();
await a.page.waitForTimeout(600);
await a.page.fill('.market-form input[type="text"]', titulo);
await a.page.fill('.market-form textarea', 'Bicicleta en buen estado, apenas usada');
await a.page.fill('.market-form input[type="number"]', '450');
await a.page.selectOption('.market-form select', 'vehiculos');
await a.page.setInputFiles('.market-form input[type="file"]', {
  name: 'bici.png',
  mimeType: 'image/png',
  buffer: PNG_1X1,
});
await a.page.waitForTimeout(1500);
check('la foto entra en la vista previa', (await a.page.locator('.market-photo img').count()) > 0);

await a.page.getByRole('button', { name: 'Publicar anuncio' }).click();
await a.page.waitForTimeout(1500);

const card = a.page.locator('.market-card', { hasText: titulo }).first();
check('el anuncio aparece en la cuadrícula', (await card.count()) > 0);
check(
  'el precio se muestra en TTC',
  /TTC/.test((await card.locator('.market-card-price').textContent().catch(() => '')) || '')
);

// La foto se sirve de verdad desde el servidor.
const coverSrc = await card.locator('.market-card-media img').getAttribute('src').catch(() => null);
check('la foto es de Marketak', /^\/uploads\/market\//.test(coverSrc || ''), String(coverSrc));
if (coverSrc) {
  const imgRes = await fetch(`${BASE}${coverSrc}`);
  check('la foto se sirve desde el servidor', imgRes.status === 200, String(imgRes.status));
}

// --- Beto encuentra el anuncio --------------------------------------------
console.log('\n▸ Beto busca el anuncio en su Marketak');
await openMarketak(b);
await b.page.fill('.market-search', `Bici de prueba ${stamp}`);
await b.page.waitForTimeout(1500);
const found = b.page.locator('.market-card', { hasText: titulo }).first();
check('el anuncio de Ana llega al Marketak de Beto', (await found.count()) > 0);

// --- Beto abre el detalle y escribe al vendedor ---------------------------
console.log('\n▸ Beto abre el anuncio y escribe al vendedor');
await found.click();
await b.page.waitForTimeout(1200);
check('se abre el detalle', (await b.page.locator('.market-sheet').count()) > 0);
check(
  'el detalle trae el precio en TTC',
  /TTC/.test((await b.page.locator('.market-detail-price').textContent().catch(() => '')) || '')
);

await b.page.getByRole('button', { name: /Escribir al vendedor/ }).click();
await b.page.waitForTimeout(1500);
check('se abre WhaTaka con el vendedor', (await b.page.locator('.thread-composer').count()) > 0);
check(
  'el destinatario es Ana',
  (await b.page.locator(`text=@${a.username}`).count()) > 0,
  `@${a.username}`
);

// --- El vendedor marca como vendido ---------------------------------------
console.log('\n▸ Ana marca el anuncio como vendido');
await a.page.reload();
await a.page.waitForTimeout(1500);
await dismissPrompts(a.page);
await openMarketak(a);
const mine = a.page.locator('.market-card', { hasText: titulo }).first();
await mine.click();
await a.page.waitForTimeout(1000);
await a.page.getByRole('button', { name: /Marcar como vendido/ }).click();
await a.page.waitForTimeout(1200);
check('el anuncio queda marcado como vendido', (await a.page.locator('.market-sold-tag').count()) > 0);

await browser.close();

if (failures > 0) {
  console.error(`\n❌ ${failures} comprobación(es) fallaron`);
  process.exit(1);
}
console.log('\n✅ Marketak funciona de extremo a extremo');
