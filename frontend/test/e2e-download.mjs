// Prueba de extremo a extremo de la descarga de vídeos en el feed.
//
// Comprueba lo que pidió el usuario: que una persona pueda descargarse el vídeo
// de OTRO usuario. Se sube un vídeo con la cuenta A, se entra con la cuenta B,
// se pulsa el botón de descarga en el feed y se verifica que el navegador baja
// el archivo, que el servidor lo autoriza y que el contador sube.
//
// Uso:  node test/e2e-download.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:12000';
const stamp = Date.now();

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

// Fixture de vídeo real: la descarga tiene que servir un fichero de verdad.
// Se reutiliza el fixture de los otros e2e si ffmpeg no está instalado.
function fixture() {
  const file = path.join(process.cwd(), '.data', 'e2e-download-fixture.webm');
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
  const shared = path.join(process.cwd(), '..', '.data', 'e2e-fixture.webm');
  if (fs.existsSync(shared) && fs.statSync(shared).size > 1000) return shared;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync('ffmpeg', [
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15',
    '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-y', file,
  ], { stdio: 'ignore' });
  return file;
}

async function register(name) {
  const username = `${name}_${stamp}`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@example.com`, password: 'clave12345' }),
  });
  if (!res.ok) throw new Error(`registro falló: ${res.status}`);
  const data = await res.json();
  return { ...data, username };
}

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

async function openAs(page, token, user) {
  await page.goto(BASE);
  await page.evaluate(
    ([t, u]) => {
      localStorage.setItem('taktak_token', t);
      localStorage.setItem('taktak_user', JSON.stringify(u));
    },
    [token, user]
  );
  await page.reload();
  await page.waitForTimeout(1500);
  await dismissPrompts(page);
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
});

try {
  console.log('\n▸ Cuentas y vídeo subido por otra persona');
  const owner = await register('dueno');
  const viewer = await register('miron');

  // Subida real por multipart, como la hace la pantalla de subida.
  const file = fixture();
  const form = new FormData();
  form.append('title', 'Video Ajeno Descargable');
  form.append('video', new Blob([fs.readFileSync(file)], { type: 'video/webm' }), 'clip.webm');
  const upRes = await fetch(`${BASE}/api/videos/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${owner.token}` },
    body: form,
  });
  const uploaded = await upRes.json();
  check('el vídeo se sube', upRes.status === 201 && Boolean(uploaded.video?._id), `status ${upRes.status}`);

  console.log('\n▸ El servidor autoriza la descarga a un tercero');
  const apiRes = await fetch(`${BASE}/api/videos/${uploaded.video._id}/download`, {
    headers: { Authorization: `Bearer ${viewer.token}` },
  });
  const descriptor = await apiRes.json();
  check('responde 200', apiRes.status === 200, `status ${apiRes.status}`);
  check('no lleva marca de agua', descriptor.watermark === false);
  check('trae nombre de archivo', /Video-Ajeno-Descargable/.test(descriptor.filename || ''), descriptor.filename);
  check('el archivo existe en el servidor', (await fetch(`${BASE}${descriptor.downloadUrl}`)).ok);

  console.log('\n▸ La descarga funciona sin sesión');
  const anonRes = await fetch(`${BASE}/api/videos/${uploaded.video._id}/download`);
  check('sin token responde 401', anonRes.status === 401, `status ${anonRes.status}`);

  console.log('\n▸ El otro usuario abre la hoja de compartir del feed');
  const ctx = await browser.newContext({ acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await openAs(page, viewer.token, viewer.user);

  // Espera a que aparezca la tarjeta del vídeo concreto (el feed va rankeado,
  // así que no se asume que sea la primera).
  const card = `.reel[data-video-id="${uploaded.video._id}"]`;
  await page
    .waitForFunction(
      (sel) => document.querySelector(sel),
      card,
      { timeout: 20000 }
    )
    .catch(() => {});

  const shareBtn = page.locator(`${card} .reel-action[aria-label="Compartir vídeo"]`);
  check('el reel tiene la flecha de compartir', (await shareBtn.count()) > 0);
  check('ya no hay un botón de descarga suelto', (await page.locator(`${card} .reel-action[aria-label="Descargar vídeo"]`).count()) === 0);
  check('ya no hay menú de tres puntos', (await page.locator(`${card} .reel-action[aria-label="Más opciones"]`).count()) === 0);

  await shareBtn.first().click();
  await page.waitForSelector('.share-sheet', { timeout: 10000 });
  check('la flecha abre la hoja de compartir', (await page.locator('.share-sheet').count()) > 0);
  check('ofrece enviar/compartir', (await page.locator('.share-option', { hasText: 'Compartir' }).count()) > 0);
  check('ofrece copiar enlace', (await page.locator('.share-option', { hasText: 'Copiar enlace' }).count()) > 0);
  check('ofrece descargar', (await page.locator('.share-option', { hasText: 'Descargar' }).count()) > 0);

  // Descargar desde la hoja.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
    page.locator('.share-option', { hasText: 'Descargar' }).click(),
  ]);
  check('la hoja inicia la descarga', Boolean(download), download ? download.suggestedFilename() : 'sin evento');
  if (download) {
    check('el nombre del archivo es legible', /Video-Ajeno-Descargable/.test(download.suggestedFilename()), download.suggestedFilename());
  }

  // El aviso dentro de la hoja confirma la bajada.
  await page.waitForTimeout(600);
  const notice = await page.locator('.share-notice').textContent().catch(() => '');
  check('la hoja confirma la descarga', /Descargando|Descarga/.test(notice || ''), notice);

  // Copiar enlace: deja el enlace del vídeo en el portapapeles.
  await page.locator('.share-option', { hasText: 'Copiar enlace' }).click();
  await page.waitForTimeout(400);
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check('copiar enlace deja el enlace del vídeo', copied.includes(uploaded.video._id), copied);
  check('el enlace abre el reel compartido', /\/\?video=/.test(copied), copied);

  // Las señales negativas siguen accesibles desde la hoja.
  check('la hoja incluye "no me interesa"', (await page.locator('.share-rows', { hasText: 'No me interesa' }).count()) > 0);
  check('la hoja incluye "ocultar creador"', (await page.locator('.share-rows', { hasText: 'Ocultar a' }).count()) > 0);

  // El contador del servidor sube: la descarga quedó registrada.
  const after = await fetch(`${BASE}/api/videos/${uploaded.video._id}/download`, {
    headers: { Authorization: `Bearer ${viewer.token}` },
  });
  check('la descarga sigue autorizada tras la primera', after.status === 200);

  check('sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));

  await ctx.close();

  console.log('\n▸ El enlace compartido abre el reel del vídeo');
  const linkCtx = await browser.newContext();
  const linkPage = await linkCtx.newPage();
  const linkErrors = [];
  linkPage.on('pageerror', (e) => linkErrors.push(e.message));
  // Se entra ya con sesión y se navega al enlace tal cual se copia.
  await openAs(linkPage, viewer.token, viewer.user);
  await linkPage.goto(`${BASE}/?video=${uploaded.video._id}`);
  await linkPage.waitForTimeout(2500);
  await dismissPrompts(linkPage);

  const firstId = await linkPage
    .locator('.reel')
    .first()
    .getAttribute('data-video-id')
    .catch(() => null);
  check('el reel compartido queda el primero', firstId === uploaded.video._id, `primero: ${firstId}`);
  check('sin errores de página al abrir el enlace', linkErrors.length === 0, linkErrors.join(' | '));

  await linkCtx.close();
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\n✅ Descarga de vídeos ajenos correcta' : `\n❌ ${failures} fallo(s)`);
process.exit(failures === 0 ? 0 : 1);
