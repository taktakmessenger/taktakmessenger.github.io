// Utilidades compartidas por los harnesses de UI con navegador real.
//
// La idea es que los scripts de `scripts/e2e-*.js` funcionen sin depender de
// dónde se instaló `puppeteer-core` ni de que un vídeo de prueba ya exista.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Busca `puppeteer-core` en los sitios habituales: los node_modules del repo
// (backend y frontend ya traen dependencias) y el directorio actual.
function loadPuppeteer() {
  const roots = [
    path.join(__dirname, '..', 'frontend'),
    path.join(__dirname, '..', 'backend'),
    path.join(__dirname, '..'),
    process.cwd(),
  ];
  for (const root of roots) {
    try {
      return require(require.resolve('puppeteer-core', { paths: [root] }));
    } catch {
      /* prueba en el siguiente */
    }
  }
  console.error(
    'Falta puppeteer-core. Instálalo con:  npm i -D puppeteer-core\n' +
      '(no descarga navegador; usamos el Chromium del sistema en /usr/bin/chromium)'
  );
  process.exit(1);
}

// Genera un fixture WebM con ffmpeg si no existe. WebM a propósito: el Chromium
// de código abierto no trae el códec H.264, así que un mp4 no se reproduciría.
function ensureWebmFixture(file = path.join(__dirname, '..', '..', '.data', 'e2e-fixture.webm')) {
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    execFileSync('ffmpeg', [
      '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=15',
      '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-y', file,
    ], { stdio: 'ignore' });
  } catch {
    console.error('No se pudo generar el vídeo de prueba. Instala ffmpeg.');
    process.exit(1);
  }
  return file;
}

module.exports = { loadPuppeteer, ensureWebmFixture };
