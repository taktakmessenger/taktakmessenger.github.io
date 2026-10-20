const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: ioClient } = require('socket.io-client');
const createApp = require('../src/app');
const { initLiveSockets } = require('../src/services/liveSockets');
const { connectTestDb, resetDb, disconnectTestDb, app, registerUser } = require('./helpers');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// A real HTTP server on an ephemeral port, so the socket path is exercised
// end to end instead of being mocked.
async function withServer(fn) {
  const server = http.createServer(createApp());
  initLiveSockets(server);
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function connect(url, token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { auth: { token }, transports: ['websocket'] });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function nextEvent(socket, name, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando ${name}`)), timeoutMs);
    socket.once(name, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

test('a viewer receives a message another viewer posted', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const listener = await registerUser(agent);

  await withServer(async (url) => {
    const a = await connect(url, sender.token);
    const b = await connect(url, listener.token);
    try {
      a.emit('live:join', { room: 'sala-1' });
      b.emit('live:join', { room: 'sala-1' });
      await nextEvent(a, 'live:joined');
      await nextEvent(b, 'live:joined');

      const received = nextEvent(b, 'live:message');
      a.emit('live:message', { room: 'sala-1', text: '¡Hola TAK TAK!' });

      const msg = await received;
      assert.equal(msg.text, '¡Hola TAK TAK!');
      assert.equal(msg.user, sender.username);
    } finally {
      a.close();
      b.close();
    }
  });
});

test('an anonymous socket cannot post messages', async () => {
  const agent = app();
  await registerUser(agent);

  await withServer(async (url) => {
    const anon = await connect(url, undefined);
    const listener = await connect(url, undefined);
    try {
      anon.emit('live:join', { room: 'sala-2' });
      listener.emit('live:join', { room: 'sala-2' });
      await nextEvent(anon, 'live:joined');
      await nextEvent(listener, 'live:joined');

      let leaked = false;
      listener.on('live:message', () => {
        leaked = true;
      });
      anon.emit('live:message', { room: 'sala-2', text: 'spam anónimo' });

      await new Promise((r) => setTimeout(r, 400));
      assert.equal(leaked, false, 'un socket sin sesión no debe poder publicar');
    } finally {
      anon.close();
      listener.close();
    }
  });
});

test('messages from one room do not leak into another', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const outsider = await registerUser(agent);

  await withServer(async (url) => {
    const a = await connect(url, sender.token);
    const b = await connect(url, outsider.token);
    try {
      a.emit('live:join', { room: 'sala-a' });
      b.emit('live:join', { room: 'sala-b' });
      await nextEvent(a, 'live:joined');
      await nextEvent(b, 'live:joined');

      let leaked = false;
      b.on('live:message', () => {
        leaked = true;
      });
      a.emit('live:message', { room: 'sala-a', text: 'solo para sala-a' });

      await new Promise((r) => setTimeout(r, 400));
      assert.equal(leaked, false, 'los mensajes no deben cruzar de sala');
    } finally {
      a.close();
      b.close();
    }
  });
});

test('a long message is truncated instead of relayed whole', async () => {
  const agent = app();
  const sender = await registerUser(agent);

  await withServer(async (url) => {
    const a = await connect(url, sender.token);
    const b = await connect(url, sender.token);
    try {
      a.emit('live:join', { room: 'sala-c' });
      b.emit('live:join', { room: 'sala-c' });
      await nextEvent(a, 'live:joined');
      await nextEvent(b, 'live:joined');

      const received = nextEvent(b, 'live:message');
      a.emit('live:message', { room: 'sala-c', text: 'x'.repeat(1000) });

      const msg = await received;
      assert.equal(msg.text.length, 200);
    } finally {
      a.close();
      b.close();
    }
  });
});
