import test from 'node:test';
import assert from 'node:assert/strict';
import api from '../src/api/client.js';
import { downloadVideo } from '../src/lib/download.js';

// El helper toca el DOM y la red, que no existen en Node. Se instalan dobles
// mínimos: un `document` que registra el clic del enlace, un `URL` de mentira y
// un `fetch` que devuelve el archivo. Lo que se prueba es la lógica del helper
// (que pide el blob, que usa el nombre que da el servidor y que no deja que la
// cabecera del `/uploads` imponga el nombre interno), no el navegador.
// El camino real, con servidor y descarga de verdad, lo cubre
// `test/e2e-download.mjs`.
function installDom() {
  const clicks = [];
  global.document = {
    createElement() {
      return {
        href: '',
        download: '',
        click() {
          clicks.push({ href: this.href, download: this.download });
        },
        remove() {},
      };
    },
    body: { appendChild() {} },
  };
  global.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} };
  return clicks;
}

function stubApi(descriptor) {
  const original = api.get;
  const calls = [];
  api.get = async (path) => {
    calls.push(path);
    return { data: descriptor };
  };
  return {
    calls,
    restore: () => {
      api.get = original;
    },
  };
}

test('downloadVideo pide el descriptor y baja el archivo con el nombre legible', async () => {
  const clicks = installDom();
  const fetched = [];
  global.fetch = async (url) => {
    fetched.push(url);
    return { ok: true, blob: async () => ({ size: 123 }) };
  };

  const descriptor = {
    downloadUrl: '/uploads/abc.mp4',
    filename: 'Baile-de-Verano-123.mp4',
    watermark: false,
  };
  const stub = stubApi(descriptor);

  try {
    const data = await downloadVideo('vid-1');

    assert.equal(data.filename, 'Baile-de-Verano-123.mp4');
    assert.deepEqual(stub.calls, ['/videos/vid-1/download'], 'pide el descriptor al endpoint');
    assert.deepEqual(fetched, ['/uploads/abc.mp4'], 'baja el archivo desde la URL indicada');
    assert.equal(clicks.length, 1, 'dispara un clic');
    assert.equal(clicks[0].download, 'Baile-de-Verano-123.mp4', 'usa el nombre legible');
    assert.equal(clicks[0].href, 'blob:fake', 'usa un blob, no la URL con cabecera');
  } finally {
    stub.restore();
  }
});

test('downloadVideo falla en claro si el archivo no está disponible', async () => {
  installDom();
  global.fetch = async () => ({ ok: false, status: 404 });
  const stub = stubApi({ downloadUrl: '/uploads/missing.mp4', filename: 'x.mp4' });

  try {
    await assert.rejects(() => downloadVideo('vid-2'), /No se pudo descargar/);
  } finally {
    stub.restore();
  }
});
