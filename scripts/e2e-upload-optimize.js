// Verificación puntual del flujo de subida con aviso de optimización.
// No es parte de la suite: se ejecuta a mano mientras se desarrolla.
const path = require('node:path');
const { loadPuppeteer, ensureWebmFixture } = require('./lib/harness');

const puppeteer = loadPuppeteer();
const APP = process.env.APP || 'http://localhost:12000';
const API = process.env.API || 'http://localhost:4000/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fixture = ensureWebmFixture();

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ✗ ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

async function api(p, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

async function waitText(page, text, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const found = await page.evaluate((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), text);
    if (found) return true;
    await sleep(250);
  }
  return false;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const suffix = Date.now().toString(36).slice(-6);
  const user = { username: `opt_${suffix}`, email: `opt_${suffix}@example.com`, password: 'secret123' };

  // Registro por API y luego inyectamos el token: la UI de registro ya está
  // cubierta por e2e-ui.js; aquí interesa la pantalla de subida.
  const reg = await api('/auth/register', { method: 'POST', body: user });
  check(reg.status === 201, 'cuenta de prueba creada');

  await page.goto(APP, { waitUntil: 'networkidle2' });
  await page.evaluate((t, u) => {
    localStorage.setItem('taktak_token', t);
    localStorage.setItem('taktak_user', JSON.stringify(u));
  }, reg.data.token, reg.data.user);
  await page.reload({ waitUntil: 'networkidle2' });

  console.log('\n▸ Subida con aviso de optimización');
  await clickByText(page, 'Subir');
  await sleep(800);
  const fileInput = await page.$('input[type=file]');
  check(!!fileInput, 'hay selector de archivo');
  await fileInput.uploadFile(fixture);
  await sleep(600);

  await page.type('input[placeholder="Título"]', 'Prueba aviso optimización');
  await clickByText(page, 'Publicar');

  const sawOptimizing = await waitText(page, 'Optimizando tu vídeo', 15000);
  check(sawOptimizing, 'aparece el aviso "Optimizando tu vídeo…"');

  const sawReady = await waitText(page, '¡Listo!', 60000);
  check(sawReady, 'el aviso pasa a "¡Listo!" cuando termina la conversión');

  const detail = await page.evaluate(() => document.body.innerText.includes('se reproduce en todas partes'));
  check(detail, 'se explica que el vídeo ya se reproduce en todas partes');

  console.log('\n▸ Botón Reprocesar en el perfil (vídeo ya listo)');
  await clickByText(page, 'Ir al feed');
  await sleep(500);
  await clickByText(page, 'Perfil');
  await sleep(1500);
  const hasReprocessReady = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    return btns.some((b) => b.textContent.includes('Reprocesar'));
  });
  check(!hasReprocessReady, 'un vídeo ya optimizado NO muestra "Reprocesar"');
  const hasExport = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Exportar limpio'))
  );
  check(hasExport, 'el botón "Exportar limpio" sigue presente');

  console.log('\n▸ Botón Reprocesar en un vídeo sin HLS');
  // Un vídeo creado por JSON (sin fichero) nunca tiene hlsUrl: es el caso que
  // debe ofrecer Reprocesar.
  const created = await api('/videos', {
    token: reg.data.token,
    method: 'POST',
    body: { title: 'Sin HLS', videoUrl: 'https://cdn.example.com/x.mp4' },
  });
  check(created.status === 201, 'vídeo sin HLS creado');
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1000);
  await clickByText(page, 'Perfil');
  await sleep(1500);
  const hasReprocess = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Reprocesar'))
  );
  check(hasReprocess, 'un vídeo sin HLS SÍ muestra "Reprocesar"');

  await browser.close();
  console.log(`\n${fail === 0 ? '✅' : '❌'} Optimización: ${pass} ok, ${fail} fallos`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('fallo inesperado:', e);
  process.exit(1);
});
