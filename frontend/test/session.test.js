import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  refreshSession,
  clearSession,
  getToken,
  hasRefreshToken,
  saveSession,
  tokenExpiry,
  onSessionChange,
} from '../src/lib/session.js';

// localStorage no existe en node; el código bajo prueba es el real y solo lo usa
// como almacén. Se instala un sustituto en memoria.
function installLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

// Servidor real que se comporta como /api/auth/refresh: éxito con tokens
// nuevos, 401 con un refresco caducado, y 500 cuando el servidor está de mal
// humor. Sin dobles: se ejerce el `fetch` de verdad contra un servidor de verdad.
function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => handler(req, res, body));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// El módulo llama a `/api/auth/refresh` (ruta relativa). En node no hay origen,
// así que se intercepta `fetch` para dirigirlo al servidor de prueba. Se
// conserva la llamada real de red; solo se reescribe el prefijo.
function pointFetchAt(port) {
  const realFetch = global.fetch;
  global.fetch = (url, options) =>
    realFetch(String(url).replace('/api/auth/refresh', `http://127.0.0.1:${port}/refresh`), options);
  return () => { global.fetch = realFetch; };
}

function jwtWithExp(expSeconds) {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `header.${payload}.sig`;
}

test('renueva la sesión y guarda el token y el refresco nuevos', async () => {
  installLocalStorage({ taktak_token: 'viejo', taktak_refresh: 'refresco-1' });
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token: 'nuevo', refreshToken: 'refresco-2', user: { id: 'u1' } }));
  });
  const restore = pointFetchAt(server.address().port);

  const token = await refreshSession();

  assert.equal(token, 'nuevo');
  assert.equal(getToken(), 'nuevo');
  assert.equal(localStorage.getItem('taktak_refresh'), 'refresco-2');
  assert.equal(JSON.parse(localStorage.getItem('taktak_user')).id, 'u1');

  restore();
  server.close();
});

test('avisa a los suscriptores cuando la sesión cambia', async () => {
  installLocalStorage({ taktak_token: 'viejo', taktak_refresh: 'r' });
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token: 'nuevo' }));
  });
  const restore = pointFetchAt(server.address().port);

  const vistos = [];
  const off = onSessionChange((t) => vistos.push(t));
  await refreshSession();

  assert.deepEqual(vistos, ['nuevo']);
  off();

  restore();
  server.close();
});

test('sin refresco no se llama al servidor y devuelve null', async () => {
  installLocalStorage({ taktak_token: 'viejo' });
  let llamado = false;
  const restore = pointFetchAt(0);
  const realFetch = global.fetch;
  global.fetch = (...args) => { llamado = true; return realFetch(...args); };

  const token = await refreshSession();

  assert.equal(token, null);
  assert.equal(llamado, false);

  restore();
});

test('un 401 del refresco es definitivo: null (hay que volver a entrar)', async () => {
  installLocalStorage({ taktak_token: 'viejo', taktak_refresh: 'caducado' });
  const server = await startServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Token de refresco inválido o expirado' }));
  });
  const restore = pointFetchAt(server.address().port);

  const token = await refreshSession();

  assert.equal(token, null);

  restore();
  server.close();
});

test('un 500 no cierra la sesión: es pasajero (undefined)', async () => {
  installLocalStorage({ taktak_token: 'viejo', taktak_refresh: 'r' });
  const server = await startServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'boom' }));
  });
  const restore = pointFetchAt(server.address().port);

  const token = await refreshSession();

  // Distinto de null: el refresco puede seguir valiendo, solo falló el intento.
  assert.equal(token, undefined);
  assert.equal(getToken(), 'viejo');

  restore();
  server.close();
});

test('un corte de red no cierra la sesión: es pasajero (undefined)', async () => {
  installLocalStorage({ taktak_token: 'viejo', taktak_refresh: 'r' });
  const realFetch = global.fetch;
  global.fetch = () => Promise.reject(new Error('red caída'));

  const token = await refreshSession();

  assert.equal(token, undefined);
  assert.equal(getToken(), 'viejo');

  global.fetch = realFetch;
});

test('varias renovaciones a la vez comparten una sola petición', async () => {
  installLocalStorage({ taktak_token: 'viejo', taktak_refresh: 'r' });
  let peticiones = 0;
  const server = await startServer((req, res) => {
    peticiones += 1;
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token: 'nuevo' }));
    }, 50);
  });
  const restore = pointFetchAt(server.address().port);

  const [a, b, c] = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);

  assert.equal(peticiones, 1);
  assert.deepEqual([a, b, c], ['nuevo', 'nuevo', 'nuevo']);

  restore();
  server.close();
});

test('clearSession borra el token, el usuario y el refresco', () => {
  installLocalStorage({ taktak_token: 't', taktak_user: '{}', taktak_refresh: 'r' });

  clearSession();

  assert.equal(getToken(), null);
  assert.equal(localStorage.getItem('taktak_user'), null);
  assert.equal(hasRefreshToken(), false);
});

test('saveSession guarda la sesión y avisa a los suscriptores', () => {
  installLocalStorage();
  const vistos = [];
  const off = onSessionChange((t) => vistos.push(t));

  saveSession({ token: 'nuevo', user: { id: 'u1' }, refreshToken: 'r1' });

  assert.equal(getToken(), 'nuevo');
  assert.equal(JSON.parse(localStorage.getItem('taktak_user')).id, 'u1');
  assert.equal(hasRefreshToken(), true);
  assert.deepEqual(vistos, ['nuevo']);
  off();
});

test('tokenExpiry lee el vencimiento del JWT', () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(tokenExpiry(jwtWithExp(exp)), exp * 1000);
});

test('tokenExpiry devuelve null si el token no es legible', () => {
  assert.equal(tokenExpiry('no-es-un-jwt'), null);
  assert.equal(tokenExpiry(''), null);
  assert.equal(tokenExpiry(null), null);
});
