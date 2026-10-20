const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
} = require('./helpers');
const createApp = require('../src/app');
const { initLiveSockets } = require('../src/services/liveSockets');
const { io: ioClient } = require('socket.io-client');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// A real HTTP server with the sockets attached, on an ephemeral port, so the
// client and server negotiate exactly as they would in production.
async function startServer() {
  const server = createApp().listen(0);
  const io = initLiveSockets(server);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    url: `http://localhost:${port}`,
    async close() {
      io.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function connect(url, token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      forceNew: true,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

// Waits for one occurrence of `event`, failing the test instead of hanging.
function once(socket, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout esperando "${event}"`)),
      timeoutMs
    );
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function openConversation(agent, token, userId) {
  const res = await agent
    .post('/api/messages/conversations')
    .set('Authorization', `Bearer ${token}`)
    .send({ userId });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.conversationId;
}

test('a message sent over the socket reaches the other participant', async () => {
  const server = await startServer();
  try {
    const agent = app();
    const a = await registerUser(agent);
    const b = await registerUser(agent);
    const conversationId = await openConversation(agent, a.token, b.user.id);

    const socketA = await connect(server.url, a.token);
    const socketB = await connect(server.url, b.token);

    socketA.emit('chat:join', { conversationId });
    socketB.emit('chat:join', { conversationId });
    await new Promise((r) => setTimeout(r, 200));

    const delivered = once(socketB, 'chat:message');
    socketA.emit('chat:send', { conversationId, text: 'Hola por socket' });

    const message = await delivered;
    assert.equal(message.text, 'Hola por socket');
    assert.equal(message.sender.username, a.username);

    socketA.close();
    socketB.close();
  } finally {
    await server.close();
  }
});

test('the recipient is notified even without opening the thread', async () => {
  const server = await startServer();
  try {
    const agent = app();
    const a = await registerUser(agent);
    const b = await registerUser(agent);
    const conversationId = await openConversation(agent, a.token, b.user.id);

    const socketA = await connect(server.url, a.token);
    // B never joins the conversation room; the notification must still arrive.
    const socketB = await connect(server.url, b.token);

    const notified = once(socketB, 'chat:notify');
    socketA.emit('chat:send', { conversationId, text: 'Aviso' });

    const message = await notified;
    assert.equal(message.text, 'Aviso');

    socketA.close();
    socketB.close();
  } finally {
    await server.close();
  }
});

test('a message sent over REST reaches the other participant in real time', async () => {
  // Regression: the fan-out used to live only in the socket handler, so a
  // message posted through the API never reached an open tab until it polled.
  const server = await startServer();
  try {
    const agent = app();
    const a = await registerUser(agent);
    const b = await registerUser(agent);
    const conversationId = await openConversation(agent, a.token, b.user.id);

    const socketB = await connect(server.url, b.token);
    socketB.emit('chat:join', { conversationId });
    await new Promise((r) => setTimeout(r, 200));

    const delivered = once(socketB, 'chat:message');
    const notified = once(socketB, 'chat:notify');

    const res = await agent
      .post(`/api/messages/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ text: 'Hola por REST' });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const [message, notification] = await Promise.all([delivered, notified]);
    assert.equal(message.text, 'Hola por REST');
    assert.equal(String(message.conversation), String(conversationId));
    assert.equal(notification.text, 'Hola por REST');

    socketB.close();
  } finally {
    await server.close();
  }
});

test('a non-participant cannot join a conversation room', async () => {
  const server = await startServer();
  try {
    const agent = app();
    const a = await registerUser(agent);
    const b = await registerUser(agent);
    const stranger = await registerUser(agent);
    const conversationId = await openConversation(agent, a.token, b.user.id);

    const socketA = await connect(server.url, a.token);
    const socketStranger = await connect(server.url, stranger.token);

    socketA.emit('chat:join', { conversationId });
    socketStranger.emit('chat:join', { conversationId });
    await new Promise((r) => setTimeout(r, 200));

    let leaked = false;
    socketStranger.on('chat:message', () => {
      leaked = true;
    });

    socketA.emit('chat:send', { conversationId, text: 'Privado' });
    await new Promise((r) => setTimeout(r, 400));

    assert.equal(leaked, false, 'el intruso no debe recibir el mensaje');

    socketA.close();
    socketStranger.close();
  } finally {
    await server.close();
  }
});

test('an anonymous socket cannot send messages', async () => {
  const server = await startServer();
  try {
    const agent = app();
    const a = await registerUser(agent);
    const b = await registerUser(agent);
    const conversationId = await openConversation(agent, a.token, b.user.id);

    const socketA = await connect(server.url, a.token);
    const anon = await connect(server.url, null);

    socketA.emit('chat:join', { conversationId });
    await new Promise((r) => setTimeout(r, 200));

    let leaked = false;
    socketA.on('chat:message', () => {
      leaked = true;
    });

    anon.emit('chat:send', { conversationId, text: 'Soy anónimo' });
    await new Promise((r) => setTimeout(r, 400));

    assert.equal(leaked, false);

    socketA.close();
    anon.close();
  } finally {
    await server.close();
  }
});

test('a call invite reaches the callee and reports it as reachable', async () => {
  const server = await startServer();
  try {
    const agent = app();
    const a = await registerUser(agent);
    const b = await registerUser(agent);

    const socketA = await connect(server.url, a.token);
    const socketB = await connect(server.url, b.token);
    await new Promise((r) => setTimeout(r, 200));

    const incoming = once(socketB, 'call:incoming');
    const ringing = once(socketA, 'call:ringing');

    socketA.emit('call:invite', { to: b.user.id, kind: 'video' });

    const [invite, ring] = await Promise.all([incoming, ringing]);
    assert.equal(invite.kind, 'video');
    assert.equal(invite.from.username, a.username);
    assert.equal(ring.reachable, true);

    socketA.close();
    socketB.close();
  } finally {
    await server.close();
  }
});

test('calling someone offline is reported as unreachable', async () => {
  const server = await startServer();
  try {
    const agent = app();
    const a = await registerUser(agent);
    const b = await registerUser(agent);

    const socketA = await connect(server.url, a.token);
    await new Promise((r) => setTimeout(r, 200));

    const ringing = once(socketA, 'call:ringing');
    socketA.emit('call:invite', { to: b.user.id, kind: 'audio' });

    const ring = await ringing;
    assert.equal(ring.reachable, false);

    socketA.close();
  } finally {
    await server.close();
  }
});

test('WebRTC negotiation payloads are relayed to the intended peer only', async () => {
  const server = await startServer();
  try {
    const agent = app();
    const a = await registerUser(agent);
    const b = await registerUser(agent);
    const c = await registerUser(agent);

    const socketA = await connect(server.url, a.token);
    const socketB = await connect(server.url, b.token);
    const socketC = await connect(server.url, c.token);
    await new Promise((r) => setTimeout(r, 200));

    let cSaw = false;
    socketC.on('call:offer', () => {
      cSaw = true;
    });

    const offer = once(socketB, 'call:offer');
    socketA.emit('call:offer', { to: b.user.id, sdp: { type: 'offer', sdp: 'v=0' } });

    const received = await offer;
    assert.equal(received.from, a.user.id);
    assert.equal(received.sdp.sdp, 'v=0');

    await new Promise((r) => setTimeout(r, 200));
    assert.equal(cSaw, false, 'un tercero no debe ver la negociación');

    socketA.close();
    socketB.close();
    socketC.close();
  } finally {
    await server.close();
  }
});

test('a call can be accepted, rejected and ended', async () => {
  const server = await startServer();
  try {
    const agent = app();
    const a = await registerUser(agent);
    const b = await registerUser(agent);

    const socketA = await connect(server.url, a.token);
    const socketB = await connect(server.url, b.token);
    await new Promise((r) => setTimeout(r, 200));

    const accepted = once(socketA, 'call:accepted');
    socketB.emit('call:accept', { to: a.user.id });
    assert.equal((await accepted).from, b.user.id);

    const rejected = once(socketA, 'call:rejected');
    socketB.emit('call:reject', { to: a.user.id, reason: 'ocupado' });
    assert.equal((await rejected).reason, 'ocupado');

    const ended = once(socketA, 'call:ended');
    socketB.emit('call:end', { to: a.user.id });
    assert.equal((await ended).from, b.user.id);

    socketA.close();
    socketB.close();
  } finally {
    await server.close();
  }
});
