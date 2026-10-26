// Prueba de extremo a extremo de la rejilla de vídeos del perfil (estilo TikTok):
// que los vídeos salgan como miniaturas en rejilla, que al tocar una se abra el
// reproductor a pantalla completa y que se pueda cerrar. No comprueba píxeles,
// sino que existan las piezas y respondan.
const { loadPuppeteer } = require('./lib/harness');

const puppeteer = loadPuppeteer();
const APP = process.env.APP || 'http://localhost:12000';
const API = process.env.API || 'http://localhost:4000/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ✗ ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

async function api(p, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function clickByText(page, text) {
  const needle = text.toLowerCase();
  return page.evaluate((t) => {
    const els = [...document.querySelectorAll('button, a')];
    const norm = (e) => e.textContent.trim().toLowerCase();
    const el = els.find((e) => norm(e) === t) || els.find((e) => norm(e).includes(t));
    if (el) { el.click(); return true; }
    return false;
  }, needle);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const suffix = Date.now().toString(36).slice(-6);
  const user = { username: `grid_${suffix}`, email: `grid_${suffix}@example.com`, password: 'secret123' };

  const reg = await api('/auth/register', { method: 'POST', body: user });
  check(reg.status === 201, 'cuenta de prueba creada');

  // Tres vídeos por API: uno con miniatura y dos sin ella. El que no tiene
  // miniatura es el caso que antes dejaba la rejilla en blanco.
  const created = [];
  for (const n of [1, 2, 3]) {
    const r = await api('/videos', {
      token: reg.data.token,
      method: 'POST',
      body: {
        title: `Vídeo ${n}`,
        videoUrl: `https://cdn.example.com/v${n}.mp4`,
        thumbnailUrl: n === 1 ? 'https://cdn.example.com/thumb1.jpg' : undefined,
        views: n * 1000,
      },
    });
    created.push(r.status);
  }
  check(created.every((s) => s === 201), 'se publican tres vídeos de prueba');

  await page.goto(APP, { waitUntil: 'networkidle2' });
  await page.evaluate((t, u) => {
    localStorage.setItem('taktak_token', t);
    localStorage.setItem('taktak_user', JSON.stringify(u));
  }, reg.data.token, reg.data.user);
  await page.reload({ waitUntil: 'networkidle2' });

  console.log('\n▸ Rejilla del perfil');
  await clickByText(page, 'Perfil');
  await sleep(1500);

  const thumbs = await page.$$eval('.profile-thumb', (els) => els.length);
  check(thumbs === 3, `la rejilla muestra los tres vídeos (vio ${thumbs})`);

  const isGrid = await page.evaluate(() => {
    const grid = document.querySelector('.profile-grid');
    if (!grid) return false;
    return getComputedStyle(grid).display === 'grid';
  });
  check(isGrid, 'los vídeos se colocan en rejilla, no en lista');

  const usesFallback = await page.evaluate(
    () => !!document.querySelector('.profile-thumb .profile-thumb-fallback')
  );
  check(usesFallback, 'un vídeo sin miniatura usa el propio vídeo como cartel');

  // El valor abreviado ("1 mil") se cubre en los unitarios de `formatCount`.
  // Aquí basta con ver que la miniatura lleva su contador: llegar a 1000 vistas
  // por API exigiría mil peticiones.
  const counts = await page.$$eval('.profile-thumb-views', (els) => els.map((e) => e.textContent));
  check(
    counts.length === 3 && counts.every((c) => c.includes('▶')),
    `cada miniatura lleva su contador de vistas (${counts.join(' | ')})`
  );

  console.log('\n▸ Reproductor a pantalla completa');
  await page.evaluate(() => document.querySelector('.profile-thumb').click());
  await sleep(800);
  const opened = await page.evaluate(() => !!document.querySelector('.profile-player'));
  check(opened, 'tocar una miniatura abre el reproductor');

  const hasVideo = await page.evaluate(() => !!document.querySelector('.profile-player video'));
  check(hasVideo, 'el reproductor monta un elemento de vídeo');

  const hasSound = await page.evaluate(
    () => !!document.querySelector('button[aria-label="Activar sonido"]')
  );
  check(hasSound, 'el reproductor arranca en silencio y ofrece activar el sonido');

  const slides = await page.$$eval('.profile-player-slide', (els) => els.length);
  check(slides === 3, `se puede pasar entre los tres vídeos (vio ${slides})`);

  await page.evaluate(() => document.querySelector('.profile-player-close').click());
  await sleep(500);
  const closed = await page.evaluate(() => !document.querySelector('.profile-player'));
  check(closed, 'cerrar el reproductor vuelve a la rejilla');

  await browser.close();
  console.log(`\n${fail === 0 ? '✅' : '❌'} Rejilla del perfil: ${pass} ok, ${fail} fallos`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('fallo inesperado:', e);
  process.exit(1);
});
