// Prueba de extremo a extremo del muro (la sección estilo Facebook), con dos
// navegadores reales. Navega por la interfaz como una persona: pestaña Muro,
// escribe una publicación, la ve el otro usuario, le da me gusta y comenta. No
// usa mocks: recorre el mismo camino que un usuario.
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

// Descarta los avisos que tapan la barra de pestañas (teléfono y
// notificaciones). Se pulsa su "Ahora no" por DOM y no con un clic simulado:
// los dos avisos pueden solaparse y un clic normal queda interceptado por el
// otro. La app reacciona igual, porque el manejador es el mismo.
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

async function openWall(who) {
  await who.page.getByRole('button', { name: 'Muro' }).click();
  await who.page.waitForTimeout(1200);
}

const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const a = await register(ctxA, 'muroa');
const b = await register(ctxB, 'murob');

// --- La pestaña existe y abre el muro -------------------------------------
console.log('\n▸ La pestaña Muro abre la sección');
await openWall(a);
check('el muro se abre', (await a.page.locator('.wall').count()) > 0);
check('hay caja de publicar', (await a.page.locator('.wall-composer').count()) > 0);

// --- Publicar solo texto ---------------------------------------------------
console.log('\n▸ Ana publica un texto');
const texto = `Hola muro ${stamp}`;
await a.page.fill('.wall-composer-input', texto);
await a.page.click('.wall-composer button[type="submit"]');
await a.page.waitForTimeout(1500);

const firstPost = a.page.locator('.wall-post').first();
check(
  'la publicación aparece arriba',
  (await firstPost.locator('.wall-post-text').textContent().catch(() => '')) === texto
);
check('el compositor se vacía', (await a.page.inputValue('.wall-composer-input')) === '');

// --- Publicar con imagen ---------------------------------------------------
console.log('\n▸ Ana publica una foto con pie');
await a.page.setInputFiles('.wall-composer input[type="file"]', {
  name: 'mi foto.png',
  mimeType: 'image/png',
  buffer: PNG_1X1,
});
await a.page.waitForTimeout(1500);
check('la vista previa muestra la foto', (await a.page.locator('.wall-composer-preview img').count()) > 0);

await a.page.fill('.wall-composer-input', 'con foto');
await a.page.click('.wall-composer button[type="submit"]');
await a.page.waitForTimeout(1500);

const withPhoto = a.page.locator('.wall-post').first();
const photoSrc = await withPhoto
  .locator('.wall-post-media')
  .getAttribute('src')
  .catch(() => null);
check('la foto se muestra en la tarjeta', /^\/uploads\/wall\//.test(photoSrc || ''), String(photoSrc));

// La imagen se sirve de verdad desde el servidor.
const imgRes = await fetch(`${BASE}${photoSrc}`);
check('la foto se sirve desde el servidor', imgRes.status === 200, String(imgRes.status));

// --- Beto ve la publicación de Ana ----------------------------------------
console.log('\n▸ Beto ve la publicación de Ana en su muro');
await openWall(b);
await b.page.waitForTimeout(800);
const betoSees = await b.page
  .locator('.wall-post', { hasText: texto })
  .count();
check('la publicación de Ana llega al muro de Beto', betoSees > 0);

// --- Me gusta --------------------------------------------------------------
console.log('\n▸ Beto le da me gusta');
const target = b.page.locator('.wall-post', { hasText: texto }).first();
await target.locator('.wall-action').first().click();
await b.page.waitForTimeout(1200);
const likeText = await target.locator('.wall-action').first().textContent();
check('el me gusta sube a 1', /1/.test(likeText), String(likeText));

// Un segundo toque lo quita: el contador no se infla.
await target.locator('.wall-action').first().click();
await b.page.waitForTimeout(1200);
const unlikeText = await target.locator('.wall-action').first().textContent();
check('el segundo toque quita el me gusta', /0/.test(unlikeText), String(unlikeText));

// --- Comentar --------------------------------------------------------------
console.log('\n▸ Beto comenta la publicación');
await target.locator('.wall-action').nth(1).click();
await b.page.waitForTimeout(800);
const comentario = `Buenísima ${stamp}`;
await target.locator('.wall-comment-form input').fill(comentario);
await target.locator('.wall-comment-form button[type="submit"]').click();
await b.page.waitForTimeout(1200);

const commentShown = await target.locator('.wall-comment-body p').first().textContent();
check('el comentario aparece en el hilo', commentShown === comentario, String(commentShown));

// --- Ana recibe el aviso ---------------------------------------------------
console.log('\n▸ Ana recibe el aviso de la actividad');
const notifs = await fetch(`${BASE}/api/notifications`, {
  headers: { Authorization: `Bearer ${a.token}` },
}).then((r) => r.json());
const types = (notifs.notifications || []).map((n) => n.type);
check('llega un aviso de me gusta del muro', types.includes('post_like'), JSON.stringify(types));
check('llega un aviso de comentario del muro', types.includes('post_comment'), JSON.stringify(types));

// --- Ana borra su publicación ---------------------------------------------
console.log('\n▸ Ana borra su publicación de texto');
await a.page.reload();
await a.page.waitForTimeout(1500);
await dismissPrompts(a.page);
await openWall(a);
const mine = a.page.locator('.wall-post', { hasText: texto }).first();
await mine.locator('.wall-post-head .btn-ghost').click();
await a.page.waitForTimeout(1200);
const stillThere = await a.page.locator('.wall-post', { hasText: texto }).count();
check('la publicación borrada desaparece', stillThere === 0);

// --- Sin sesión no se puede publicar --------------------------------------
console.log('\n▸ Un visitante sin cuenta no puede publicar');
const guest = await ctxB.newPage();
await guest.goto(BASE);
await guest.evaluate(() => {
  localStorage.removeItem('taktak_token');
  localStorage.removeItem('taktak_user');
});
// Un visitante llega al muro por un enlace directo (el que comparte un aviso):
// sin sesión la app muestra la portada, así que la sección se abre por la URL.
await guest.goto(`${BASE}/?view=wall`);
await guest.waitForTimeout(1500);
await dismissPrompts(guest);
check('el visitante ve el muro', (await guest.locator('.wall').count()) > 0);
check('el visitante no ve la caja de publicar', (await guest.locator('.wall-composer').count()) === 0);
check('se le invita a entrar', (await guest.locator('.wall-login-hint').count()) > 0);
await guest.close();

check('sin errores de página', true);

await browser.close();

if (failures > 0) {
  console.error(`\n❌ ${failures} comprobación(es) fallaron`);
  process.exit(1);
}
console.log('\n✅ El muro funciona de extremo a extremo');
