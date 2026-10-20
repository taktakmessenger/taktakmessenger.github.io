import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import axios from 'axios';
import { onResponse, onResponseError } from '../src/api/client.js';
import { NOT_JSON_MESSAGE, NO_RESPONSE_MESSAGE } from '../src/api/response.js';

// The interceptors run in the browser and touch localStorage. Node has no such
// global, so it is provided here as a plain in-memory stand-in for the
// environment — the code under test (the interceptors) is the real one.
function installLocalStorage() {
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

// A real server that reproduces the failure modes seen in the app: a static
// host answering the SPA shell as HTML with 200, a JSON API, and a JSON error.
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><body><div id="root"></div></body></html>');
      } else if (req.url === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ videos: [{ _id: 'v1' }] }));
      } else if (req.url === '/error') {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Token de autenticación requerido' }));
      } else if (req.url === '/text-error') {
        // A proxy answering its own HTML error page instead of JSON.
        res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body>502 Bad Gateway</body></html>');
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Recurso no encontrado' }));
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function makeClient(baseURL) {
  const client = axios.create({ baseURL });
  client.interceptors.response.use(onResponse, onResponseError);
  return client;
}

test('una respuesta HTML no se entrega como datos y da un mensaje comprensible', async () => {
  installLocalStorage();
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = makeClient(base);

  await assert.rejects(
    () => api.get('/html'),
    (err) => {
      assert.equal(err.message, NOT_JSON_MESSAGE);
      assert.ok(!err.message.includes('DOCTYPE'), 'no debe filtrar el cuerpo crudo');
      assert.ok(!err.message.includes('Unexpected token'), 'no debe filtrar el error de parseo');
      return true;
    }
  );

  server.close();
});

test('una respuesta JSON se entrega intacta', async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = makeClient(base);

  const { data } = await api.get('/json');
  assert.equal(data.videos[0]._id, 'v1');

  server.close();
});

test('un error JSON conserva el mensaje del servidor', async () => {
  installLocalStorage();
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = makeClient(base);

  await assert.rejects(
    () => api.get('/error'),
    (err) => {
      assert.equal(err.message, 'Token de autenticación requerido');
      return true;
    }
  );

  server.close();
});

test('un error 401 borra la sesión guardada', async () => {
  installLocalStorage();
  localStorage.setItem('taktak_token', 'viejo');
  localStorage.setItem('taktak_user', '{}');

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = makeClient(base);

  await assert.rejects(() => api.get('/error'));

  assert.equal(localStorage.getItem('taktak_token'), null);
  assert.equal(localStorage.getItem('taktak_user'), null);

  server.close();
});

test('un error HTML del proxy no se confunde con un JSON válido', async () => {
  installLocalStorage();
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = makeClient(base);

  await assert.rejects(
    () => api.get('/text-error'),
    (err) => {
      assert.equal(err.message, NOT_JSON_MESSAGE);
      return true;
    }
  );

  server.close();
});

test('sin respuesta se informa de falta de conexión', async () => {
  installLocalStorage();
  // Puerto cerrado: la petición nunca llega a un servidor.
  const api = makeClient('http://127.0.0.1:1');

  await assert.rejects(
    () => api.get('/json'),
    (err) => {
      assert.equal(err.message, NO_RESPONSE_MESSAGE);
      return true;
    }
  );
});
