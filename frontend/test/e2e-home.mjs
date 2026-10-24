// Prueba de extremo a extremo de Inicio: las dos caras en un mismo sitio.
// Comprueba que el feed de vídeos y las publicaciones del muro conviven bajo el
// selector "Vídeos / Publicaciones", que al pasar a Publicaciones el vídeo se
// pausa (no se queda sonando por detrás) y que al volver sigue donde estaba.
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:13000';
const stamp = Date.now();

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const browser = await chromium.launch();

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

const ctx = await browser.newContext();
const page = await ctx.newPage();
const username = `home_${stamp}`;
const res = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, email: `${username}@example.com`, password: 'clave12345' }),
});
const data = await res.json();
if (!data.token) throw new Error(`no se pudo registrar: ${JSON.stringify(data)}`);
await page.goto(BASE);
await page.evaluate(
  ([token, user]) => {
    localStorage.setItem('taktak_token', token);
    localStorage.setItem('taktak_user', JSON.stringify(user));
  },
  [data.token, data.user]
);
await page.reload();
await page.waitForTimeout(1800);
await dismissPrompts(page);

// --- El selector existe y arranca en Vídeos --------------------------------
console.log('\n▸ Inicio abre con el selector y la pestaña de vídeos');
check('el selector Vídeos/Publicaciones está', (await page.locator('.home-switch').count()) > 0);
const videoTab = page.locator('.home-switch-btn', { hasText: 'Vídeos' });
const postsTab = page.locator('.home-switch-btn', { hasText: 'Publicaciones' });
check('arranca en Vídeos', (await videoTab.getAttribute('aria-selected')) === 'true');
check('el feed de vídeos está a la vista', (await page.locator('.reels').count()) > 0);
check('el muro no se ve todavía', (await page.locator('.wall').count()) === 0);

// --- Pasar a Publicaciones -------------------------------------------------
console.log('\n▸ Se pasa a Publicaciones');
await postsTab.click();
await page.waitForTimeout(1200);
check('la pestaña queda marcada', (await postsTab.getAttribute('aria-selected')) === 'true');
check('aparece el muro', (await page.locator('.wall').count()) > 0);
check('hay caja de publicar', (await page.locator('.wall-composer').count()) > 0);
check('no se repite la cabecera grande del muro', (await page.locator('.wall-header').count()) === 0);

// Pausar y reanudar solo se puede comprobar si hay un vídeo que suene. Si el
// feed está vacío (base recién creada) se avisa y se sigue: el resto de la
// prueba no depende de ello.
const hayVideo = (await page.locator('.reels video').count()) > 0;
if (hayVideo) {
  // El vídeo que sonaba tiene que estar en pausa: si no, seguiría oyéndose por
  // detrás mientras se leen las publicaciones.
  const paused = await page.evaluate(() => {
    const v = document.querySelector('.reels video');
    return v ? v.paused : null;
  });
  check('el vídeo se pausa al pasar a Publicaciones', paused === true, String(paused));
} else {
  console.log('  · sin vídeos en el feed: se omite la comprobación de pausa');
}

// --- Publicar desde Inicio -------------------------------------------------
console.log('\n▸ Se publica desde Inicio sin salir de la pantalla');
const texto = `Publico desde Inicio ${stamp}`;
await page.fill('.wall-composer-input', texto);
await page.click('.wall-composer button[type="submit"]');
await page.waitForTimeout(1500);
const published = await page
  .locator('.wall-post', { hasText: texto })
  .count();
check('la publicación aparece en el muro de Inicio', published > 0);

// --- Volver a Vídeos -------------------------------------------------------
console.log('\n▸ Se vuelve a Vídeos');
await videoTab.click();
await page.waitForTimeout(1200);
check('vuelve a verse el feed', (await page.locator('.reels').count()) > 0);
if (hayVideo) {
  const resumed = await page.evaluate(() => {
    const v = document.querySelector('.reels video');
    return v ? !v.paused : null;
  });
  check('el vídeo se reanuda al volver', resumed === true, String(resumed));
}

// --- El muro sigue en su pestaña -------------------------------------------
console.log('\n▸ La pestaña Muro de la barra sigue existiendo');
check('hay pestaña Muro en la barra', (await page.getByRole('button', { name: 'Muro' }).count()) > 0);

await browser.close();

if (failures > 0) {
  console.error(`\n❌ ${failures} comprobación(es) fallaron`);
  process.exit(1);
}
console.log('\n✅ Inicio reúne vídeos y publicaciones correctamente');
