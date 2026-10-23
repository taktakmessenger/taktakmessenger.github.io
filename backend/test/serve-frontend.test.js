// Sirve el frontend construido desde el mismo proceso que la API.
//
// El módulo lee PUBLIC_DIR al cargarse y no existe en el entorno de pruebas, así
// que cada caso monta un PUBLIC_DIR distinto en un proceso hijo. Se prueba con
// archivos de verdad en disco: un doble de `express.static` no diría nada sobre
// cabeceras, rangos ni el comodín, que es justo donde estaban los fallos.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BACKEND_DIR = path.join(__dirname, '..');

const INDEX_HTML = '<!doctype html><html lang="es"><div id="root"></div></html>';
const APP_JS = 'console.log("tak tak");';

function buildPublicDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taktak-public-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), INDEX_HTML);
  fs.writeFileSync(path.join(dir, 'sw.js'), 'self.addEventListener("install", () => {});');
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), APP_JS);
  return dir;
}

// Levanta la app en un puerto libre con PUBLIC_DIR apuntando al directorio dado
// y devuelve una función para pedir rutas. El proceso hijo es necesario porque
// `config/env` lee PUBLIC_DIR al importarse.
function startServer(publicDir) {
  const child = spawn(process.execPath, [path.join(__dirname, 'fixtures', 'serve.js')], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: '0',
      PUBLIC_DIR: publicDir,
      JWT_SECRET: 'test_secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const baseUrl = new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`arranque lento: ${output}`)), 20000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/LISTENING (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`el servidor salió con código ${code}: ${output}`));
    });
  });

  return { baseUrl, stop: () => child.kill('SIGKILL') };
}

async function withServer(publicDir, fn) {
  const { baseUrl, stop } = startServer(publicDir);
  try {
    await fn(await baseUrl);
  } finally {
    stop();
  }
}

test('sin PUBLIC_DIR la API sigue respondiendo y no sirve la web', async () => {
  // Es el caso del desarrollo y de las pruebas: nada de esto debe activarse.
  await withServer('', async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);

    const home = await fetch(`${baseUrl}/`);
    assert.equal(home.status, 404, 'sin frontend, la raíz no existe');
  });
});

test('sirve la página, los assets y el comodín del SPA', async () => {
  const dir = buildPublicDir();
  try {
    await withServer(dir, async (baseUrl) => {
      const home = await fetch(`${baseUrl}/`);
      assert.equal(home.status, 200);
      assert.match(home.headers.get('content-type'), /text\/html/);
      assert.match(await home.text(), /id="root"/);

      // Un enlace profundo no es un archivo en disco: debe devolver la app para
      // que el router del cliente lo resuelva.
      const deep = await fetch(`${baseUrl}/perfil/abc`);
      assert.equal(deep.status, 200);
      assert.match(await deep.text(), /id="root"/);

      const asset = await fetch(`${baseUrl}/assets/index-abc123.js`);
      assert.equal(asset.status, 200);
      assert.equal(await asset.text(), APP_JS);
      // El nombre lleva hash: el contenido no cambia nunca y se puede cachear.
      assert.match(asset.headers.get('cache-control'), /immutable/);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('lo que no es de la app devuelve 404 y no la página', async () => {
  const dir = buildPublicDir();
  try {
    await withServer(dir, async (baseUrl) => {
      // Una ruta de API que no existe tiene que seguir dando JSON. Si el comodín
      // la capturase, un cliente recibiría HTML con un 200.
      const api = await fetch(`${baseUrl}/api/no-existe`);
      assert.equal(api.status, 404);
      assert.match(api.headers.get('content-type'), /application\/json/);

      // Un vídeo borrado debe dar 404. Devolver la página con un 200 rompía el
      // reproductor, que intentaba interpretar HTML como vídeo.
      const upload = await fetch(`${baseUrl}/uploads/borrado.mp4`);
      assert.equal(upload.status, 404);

      // Un asset que no existe tampoco es una ruta del router.
      const missingAsset = await fetch(`${baseUrl}/assets/no-existe.js`);
      assert.equal(missingAsset.status, 404);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('el service worker y el index se revalidan en cada visita', async () => {
  const dir = buildPublicDir();
  try {
    await withServer(dir, async (baseUrl) => {
      // Un sw.js cacheado deja al navegador pegado a una versión vieja de la
      // app. express.static responde `public, max-age=0`, que obliga a
      // revalidar en cada visita: es la garantía que se busca.
      const sw = await fetch(`${baseUrl}/sw.js`);
      assert.equal(sw.status, 200);
      assert.match(sw.headers.get('cache-control'), /max-age=0/);

      // El index apunta a los assets con hash: cachearlo escondería el
      // despliegue siguiente.
      const home = await fetch(`${baseUrl}/`);
      assert.match(home.headers.get('cache-control'), /max-age=0/);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('un PUBLIC_DIR sin index.html no tumba la API', async () => {
  // Un build a medias no debe impedir que la API arranque: es preferible un
  // aviso en el log a un servicio caído.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taktak-empty-'));
  try {
    await withServer(dir, async (baseUrl) => {
      const health = await fetch(`${baseUrl}/health`);
      assert.equal(health.status, 200);
      const home = await fetch(`${baseUrl}/`);
      assert.equal(home.status, 404);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
