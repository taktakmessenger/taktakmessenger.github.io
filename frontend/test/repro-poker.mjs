// Reproduce la mesa de POKERTAK con dos jugadores reales y saca capturas.
// Uso: node test/repro-poker.mjs
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const stamp = Date.now();
const OUT = '/tmp/ptak';

async function register(context, name) {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror ${name}] ${e.message}`));
  const username = `${name}_${stamp}`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@example.com`, password: 'clave12345' }),
  });
  if (!res.ok) throw new Error(`registro ${name}: ${res.status}`);
  const data = await res.json();
  await page.goto(BASE);
  await page.evaluate(([t, u]) => {
    localStorage.setItem('taktak_token', t);
    localStorage.setItem('taktak_user', JSON.stringify(u));
  }, [data.token, data.user]);
  await page.reload();
  await page.waitForTimeout(1500);
  return { page, user: data.user, username, token: data.token };
}

async function dismiss(page) {
  for (let i = 0; i < 8; i += 1) {
    const closed = await page.evaluate(() => {
      let n = 0;
      for (const d of document.querySelectorAll('[role="dialog"]')) {
        const b = [...d.querySelectorAll('button')].find((x) =>
          /ahora no|omitir|cerrar|no, gracias/i.test(x.textContent.trim()));
        if (b) { b.click(); n += 1; }
      }
      return n;
    });
    await page.waitForTimeout(300);
    if (closed === 0 && (await page.locator('[role="dialog"]').count()) === 0) return;
  }
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required'],
});
try {
  const ctxA = await browser.newContext({ permissions: ['microphone', 'camera'], viewport: { width: 412, height: 892 } });
  const ctxB = await browser.newContext({ permissions: ['microphone', 'camera'], viewport: { width: 412, height: 892 } });

  const host = await register(ctxA, 'phost');
  const guest = await register(ctxB, 'pguest');
  await dismiss(host.page);
  await dismiss(guest.page);

  const squadRes = await fetch(`${BASE}/api/squads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}` },
    body: JSON.stringify({ name: `Mesa ${stamp}`, visibility: 'public' }),
  });
  if (squadRes.status !== 201) throw new Error(`squad: ${squadRes.status}`);
  console.log('squad OK');

  // El anfitrión abre el directo.
  await host.page.getByRole('button', { name: 'TAK Live Creator' }).click();
  await host.page.waitForTimeout(800);
  await host.page.locator('.squad-card').first().getByRole('button', { name: 'Ver contenido' }).click();
  await host.page.waitForTimeout(600);
  await host.page.getByRole('button', { name: '🎥 Entrar al directo' }).click();
  await host.page.waitForTimeout(2500);
  console.log('host en directo:', await host.page.locator('.live-stage').count());

  // El invitado entra al directo también (para que haya dos caras).
  await guest.page.getByRole('button', { name: 'TAK Live Creator' }).click();
  await guest.page.waitForTimeout(800);
  await guest.page.locator('.squad-card').first().getByRole('button', { name: 'Ver contenido' }).click();
  await guest.page.waitForTimeout(600);
  await guest.page.getByRole('button', { name: '🎥 Entrar al directo' }).click();
  await guest.page.waitForTimeout(3000);
  console.log('guest en directo:', await guest.page.locator('.live-stage').count());

  // Barra inferior del directo: el botón de sala de juegos debe ir junto al micro.
  const foot = await host.page.$$eval('.live-stage-controls .live-ctrl', (els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), label: e.getAttribute('aria-label') || e.textContent.trim() };
  }));
  console.log('barra inferior:', JSON.stringify(foot));
  console.log('icono ases:', await host.page.locator('.live-ctrl-aces .ace-card').count());
  await host.page.screenshot({ path: `${OUT}-barra.png` });

  // Abrir la sala de juegos.
  await host.page.getByRole('button', { name: 'Sala de juegos' }).click();
  await host.page.waitForTimeout(2500);
  await host.page.screenshot({ path: `${OUT}-host-abierta.png`, fullPage: false });
  console.log('mesa host:', await host.page.locator('.ptak-overlay').count());
  console.log('asientos host:', await host.page.locator('.ptak-seat').count());
  console.log('caras host:', await host.page.locator('.ptak-face').count());
  console.log('botones head host:', await host.page.locator('.ptak-head-status .ptak-btn').count());

  // El menú de tres puntos debe quedar POR ENCIMA de la mesa (antes se veía
  // recortado por detrás).
  await host.page.getByRole('button', { name: 'Más opciones de la mesa' }).click();
  await host.page.waitForTimeout(400);
  const menuTop = await host.page.evaluate(() => {
    const menu = document.querySelector('.ptak-menu');
    if (!menu) return null;
    const r = menu.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { encima: menu.contains(top), z: getComputedStyle(menu).zIndex, visible: r.width > 0 && r.height > 0 };
  });
  console.log('menú sobre la mesa:', JSON.stringify(menuTop));
  await host.page.screenshot({ path: `${OUT}-menu.png` });
  await host.page.getByRole('button', { name: 'Más opciones de la mesa' }).click();
  await host.page.waitForTimeout(300);

  // Entrada: mínimo, control de subida y atajos.
  console.log('mínimo de entrada:', (await host.page.locator('.ptak-buyin-custom label').textContent().catch(() => '')).trim());
  console.log('atajos de entrada:', await host.page.locator('.ptak-buyin-quick .ptak-btn').count());
  const range = host.page.locator('.ptak-buyin-custom input[type=range]');
  if (await range.count()) {
    console.log('rango entrada:', await range.getAttribute('min'), '->', await range.getAttribute('max'));
    await range.fill('500');
    await host.page.waitForTimeout(300);
    console.log('importe subido:', (await host.page.locator('.ptak-buyin-custom label').textContent()).trim());
    await host.page.locator('.ptak-buyin-quick .ptak-btn').nth(1).click();
    await host.page.waitForTimeout(200);
    console.log('importe elegido (atajo):', (await host.page.locator('.ptak-buyin-custom label').textContent()).trim());
  }

  // Sentarse (botón de buy-in elegido).
  const sitBtn = host.page.locator('.ptak-buyin > .ptak-btn.primary');
  if (await sitBtn.count()) { await sitBtn.click(); await host.page.waitForTimeout(1500); }
  console.log('tras sentarse, asientos:', await host.page.locator('.ptak-seat').count());
  console.log('asientos ocupados:', await host.page.locator('.ptak-seat:not(.empty)').count());
  console.log('asientos libres:', await host.page.locator('.ptak-seat.empty').count());
  console.log('repartidor:', await host.page.locator('.ptak-dealer').count());

  // El invitado también se sienta.
  await guest.page.getByRole('button', { name: 'Sala de juegos' }).click();
  await guest.page.waitForTimeout(2000);
  const grange = guest.page.locator('.ptak-buyin-custom input[type=range]');
  if (await grange.count()) { await grange.fill('100'); await guest.page.waitForTimeout(200); }
  const gsit = guest.page.locator('.ptak-buyin > .ptak-btn.primary');
  if (await gsit.count()) { await gsit.click(); await guest.page.waitForTimeout(1800); }
  console.log('ocupados tras guest:', await host.page.locator('.ptak-seat:not(.empty)').count());

  // Asistak reparte.
  const dealBtn = host.page.locator('.ptak-deal .ptak-btn');
  console.log('botón repartir host:', await dealBtn.count());
  if (await dealBtn.count()) { await dealBtn.click(); await host.page.waitForTimeout(1800); }
  console.log('fase:', (await host.page.locator('.ptak-phase').textContent().catch(() => '')).trim());
  console.log('cartas de mesa:', await host.page.locator('.ptak-board .ptak-card').count());
  console.log('cartas en asientos:', await host.page.locator('.ptak-seat-cards .ptak-card').count());
  console.log('botón repartir guest (debe ser 0):', await guest.page.locator('.ptak-deal .ptak-btn').count());

  // Las tres acciones de siempre deben estar SIEMPRE en pantalla: retirarse,
  // igualar/pasar y subir (o all-in). Cuando no toca, apagadas, no ausentes.
  for (const [who, u] of [['host', host], ['guest', guest]]) {
    const btns = await u.page.locator('.ptak-actions .ptak-btn').allInnerTexts();
    console.log(`acciones ${who}:`, JSON.stringify(btns));
    if (btns.length !== 3) throw new Error(`${who}: se esperaban 3 acciones y hay ${btns.length}`);
  }
  const turnHasRaise = await host.page.locator('.ptak-actions .ptak-btn.raise').count()
    + await guest.page.locator('.ptak-actions .ptak-btn.raise').count();
  console.log('quien tiene el turno puede subir (1 esperado):', turnHasRaise);
  const waitingBtns = await guest.page.locator('.ptak-actions .ptak-btn').evaluateAll((els) => els.map((e) => e.disabled));
  console.log('acciones del que espera (todas apagadas):', JSON.stringify(waitingBtns));

  await host.page.screenshot({ path: `${OUT}-host-sentado.png`, fullPage: false });
  await host.page.screenshot({ path: `${OUT}-host-jugando.png`, fullPage: false });

  // Medir geometría del header (¿se solapan los botones?) y de la mesa.
  const metrics = await host.page.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const head = document.querySelector('.ptak-head');
    const status = document.querySelector('.ptak-head-status');
    const btns = [...document.querySelectorAll('.ptak-head-status .ptak-btn')].map(r);
    const chips = [...document.querySelectorAll('.ptak-head-status .ptak-phase, .ptak-head-status .ptak-pot')].map(r);
    const title = document.querySelector('.ptak-head-title');
    const felt = document.querySelector('.ptak-felt');
    const seats = [...document.querySelectorAll('.ptak-seat')].map((s) => ({ cls: s.className, box: r(s) }));
    const faces = [...document.querySelectorAll('.ptak-face')].map(r);
    return {
      head: head && r(head), title: title && r(title), status: status && r(status),
      btns, chips, felt: felt && r(felt), seats, faces,
      vw: window.innerWidth, vh: window.innerHeight,
    };
  });
  console.log('\nMÉTRICAS:', JSON.stringify(metrics, null, 1));

  // ¿Solapamiento entre botones del header?
  const all = [...metrics.btns, ...metrics.chips].sort((a, b) => a.x - b.x);
  let overlap = false;
  for (let i = 1; i < all.length; i += 1) {
    if (all[i].x < all[i - 1].x + all[i - 1].w) { overlap = true; console.log('SOLAPE entre', all[i - 1], all[i]); }
  }
  console.log('¿solape en header?', overlap);
} finally {
  await browser.close();
}
