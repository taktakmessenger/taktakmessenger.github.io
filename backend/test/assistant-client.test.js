const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const env = require('../src/config/env');
const assistantClient = require('../src/services/assistantClient');

// Se prueba contra un servidor HTTP real: lo que importa es que el cliente
// reintente de verdad al recibir un 401/429, no que llamemos a una función
// interna. El servidor responde según la clave del header Authorization.
function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const key = (req.headers.authorization || '').replace('Bearer ', '');
        handler(key, res, body);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function withEnv({ key, fallback, base }) {
  const original = {
    key: env.assistantApiKey,
    fallback: env.assistantFallbackApiKeys,
    base: env.assistantApiBase,
  };
  env.assistantApiKey = key;
  env.assistantFallbackApiKeys = fallback;
  env.assistantApiBase = base;
  return () => {
    env.assistantApiKey = original.key;
    env.assistantFallbackApiKeys = original.fallback;
    env.assistantApiBase = original.base;
  };
}

const okBody = JSON.stringify({ choices: [{ message: { content: 'hola' } }] });

test('usa la clave principal cuando funciona', async () => {
  const seen = [];
  const server = await startServer((key, res) => {
    seen.push(key);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(okBody);
  });
  const restore = withEnv({ key: 'buena', fallback: ['respaldo'], base: `http://127.0.0.1:${server.address().port}` });
  try {
    const data = await assistantClient.callAssistant({ body: { model: 'x', messages: [] } });
    assert.equal(data.choices[0].message.content, 'hola');
    assert.deepEqual(seen, ['buena']);
  } finally {
    restore();
    server.close();
  }
});

test('si la principal falla con 401 usa la de respaldo', async () => {
  const seen = [];
  const server = await startServer((key, res) => {
    seen.push(key);
    if (key === 'caducada') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"invalid api key"}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(okBody);
  });
  const restore = withEnv({ key: 'caducada', fallback: ['buena'], base: `http://127.0.0.1:${server.address().port}` });
  try {
    const data = await assistantClient.callAssistant({ body: { model: 'x', messages: [] } });
    assert.equal(data.choices[0].message.content, 'hola');
    assert.deepEqual(seen, ['caducada', 'buena']);
  } finally {
    restore();
    server.close();
  }
});

test('reintenta también con 429 (límite agotado)', async () => {
  const seen = [];
  const server = await startServer((key, res) => {
    seen.push(key);
    if (key === 'limitada') {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end('{"error":"rate limited"}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(okBody);
  });
  const restore = withEnv({ key: 'limitada', fallback: ['buena'], base: `http://127.0.0.1:${server.address().port}` });
  try {
    await assistantClient.callAssistant({ body: { model: 'x', messages: [] } });
    assert.deepEqual(seen, ['limitada', 'buena']);
  } finally {
    restore();
    server.close();
  }
});

test('un 400 no reintenta: daría igual con cualquier clave', async () => {
  const seen = [];
  const server = await startServer((key, res) => {
    seen.push(key);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end('{"error":"bad request"}');
  });
  const restore = withEnv({ key: 'cualquiera', fallback: ['otra'], base: `http://127.0.0.1:${server.address().port}` });
  try {
    await assert.rejects(
      () => assistantClient.callAssistant({ body: { model: 'x', messages: [] } }),
      /400/
    );
    assert.deepEqual(seen, ['cualquiera']);
  } finally {
    restore();
    server.close();
  }
});

test('si todas las claves fallan, lanza', async () => {
  const server = await startServer((key, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":"invalid"}');
  });
  const restore = withEnv({ key: 'mala1', fallback: ['mala2'], base: `http://127.0.0.1:${server.address().port}` });
  try {
    await assert.rejects(
      () => assistantClient.callAssistant({ body: { model: 'x', messages: [] } }),
      /401/
    );
  } finally {
    restore();
    server.close();
  }
});

test('isConfigured es cierto si hay principal o respaldo', () => {
  const restore = withEnv({ key: null, fallback: ['respaldo'], base: 'http://x' });
  try {
    assert.equal(assistantClient.isConfigured(), true);
  } finally {
    restore();
  }
  const restore2 = withEnv({ key: null, fallback: [], base: 'http://x' });
  try {
    assert.equal(assistantClient.isConfigured(), false);
  } finally {
    restore2();
  }
});
