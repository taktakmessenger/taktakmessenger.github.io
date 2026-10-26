import test from 'node:test';
import assert from 'node:assert/strict';
import {
  videoShareUrl,
  shareMessage,
  copyToClipboard,
  shareWithSystem,
} from '../src/lib/share.js';

// El helper no toca la red ni el DOM real: se le inyectan el origen, el
// portapapeles y el documento, así que se prueba la lógica de verdad (armado
// del enlace, texto, respaldo de copiado) sin navegador.

const video = {
  _id: 'abc123',
  title: 'Baile de verano',
  creator: { username: 'ana' },
};

test('el enlace apunta a la portada con el id del vídeo', () => {
  assert.equal(
    videoShareUrl('abc123', 'https://tak.example'),
    'https://tak.example/?video=abc123'
  );
});

test('el enlace escapa el id por si trae caracteres raros', () => {
  assert.equal(
    videoShareUrl('a b&c', 'https://tak.example'),
    'https://tak.example/?video=a%20b%26c'
  );
});

test('el texto del mensaje nombra al autor y trae el enlace', () => {
  const text = shareMessage(video, 'https://tak.example');
  assert.match(text, /Baile de verano/);
  assert.match(text, /@ana/);
  assert.match(text, /https:\/\/tak\.example\/\?video=abc123/);
});

test('sin título el mensaje sigue siendo claro', () => {
  const text = shareMessage({ _id: 'x', creator: { username: 'ana' } }, 'https://tak.example');
  assert.match(text, /@ana/);
  assert.match(text, /\/\?video=x/);
});

test('copiar usa el portapapeles cuando está disponible', async () => {
  const written = [];
  const nav = { clipboard: { writeText: async (t) => written.push(t) } };
  const ok = await copyToClipboard('hola', nav, {});
  assert.equal(ok, true);
  assert.deepEqual(written, ['hola']);
});

test('si el portapapeles falla, se usa el respaldo con execCommand', async () => {
  const nav = {
    clipboard: {
      writeText: async () => {
        throw new Error('permiso denegado');
      },
    },
  };
  let selected = '';
  const doc = {
    createElement: () => ({
      value: '',
      style: {},
      setAttribute() {},
      select() {
        selected = 'sí';
      },
    }),
    body: { appendChild() {} },
    execCommand: () => true,
  };
  const ok = await copyToClipboard('texto', nav, doc);
  assert.equal(ok, true);
  assert.equal(selected, 'sí');
});

test('sin portapapeles ni respaldo, copiar informa del fallo', async () => {
  const doc = {
    createElement: () => ({
      style: {},
      setAttribute() {},
      select() {},
      remove() {},
    }),
    body: { appendChild() {} },
    execCommand: () => false,
  };
  const ok = await copyToClipboard('texto', {}, doc);
  assert.equal(ok, false);
});

test('compartir con el sistema usa la Web Share API', async () => {
  const shared = [];
  const nav = { share: async (payload) => shared.push(payload) };
  const ok = await shareWithSystem(video, nav);
  assert.equal(ok, true);
  assert.equal(shared.length, 1);
  assert.match(shared[0].text, /@ana/);
});

test('cancelar el diálogo del sistema no se trata como fallo', async () => {
  const nav = {
    share: async () => {
      const err = new Error('cancelado');
      err.name = 'AbortError';
      throw err;
    },
  };
  assert.equal(await shareWithSystem(video, nav), true);
});

test('sin Web Share API se informa para caer en copiar enlace', async () => {
  assert.equal(await shareWithSystem(video, {}), false);
});
