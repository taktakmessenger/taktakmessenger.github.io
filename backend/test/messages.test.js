const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
} = require('./helpers');
const Conversation = require('../src/models/Conversation');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

async function openConversation(agent, token, userId) {
  const res = await agent
    .post('/api/messages/conversations')
    .set('Authorization', `Bearer ${token}`)
    .send({ userId });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.conversationId;
}

test('messaging requires a session', async () => {
  const agent = app();
  const res = await agent.get('/api/messages/conversations');
  assert.equal(res.status, 401);
});

test('opening a conversation with the same person twice reuses it', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const first = await openConversation(agent, a.token, b.user.id);
  const second = await openConversation(agent, a.token, b.user.id);

  assert.equal(first, second, 'both requests must resolve to one thread');
  assert.equal(await Conversation.countDocuments(), 1);
});

test('the thread is the same no matter who opens it', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const fromA = await openConversation(agent, a.token, b.user.id);
  const fromB = await openConversation(agent, b.token, a.user.id);

  assert.equal(fromA, fromB, 'the key must be order-independent');
});

test('you cannot open a conversation with yourself', async () => {
  const agent = app();
  const a = await registerUser(agent);

  const res = await agent
    .post('/api/messages/conversations')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ userId: a.user.id });

  assert.equal(res.status, 400);
});

test('a message is delivered to the other participant', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const sent = await agent
    .post(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${a.token}`)
    .send({ text: 'Hola TAK TAK' });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));

  const thread = await agent
    .get(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${b.token}`);

  assert.equal(thread.status, 200);
  assert.equal(thread.body.messages.length, 1);
  assert.equal(thread.body.messages[0].text, 'Hola TAK TAK');
  assert.equal(thread.body.messages[0].sender.username, a.username);
});

test('an outsider cannot read a conversation', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const stranger = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const res = await agent
    .get(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${stranger.token}`);

  // 404, not 403: the response must not confirm the conversation exists.
  assert.equal(res.status, 404);
});

test('an outsider cannot post into a conversation', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const stranger = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const res = await agent
    .post(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${stranger.token}`)
    .send({ text: 'No debería entrar' });

  assert.equal(res.status, 404);
});

test('an empty message is rejected', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const res = await agent
    .post(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${a.token}`)
    .send({ text: '   ' });

  assert.equal(res.status, 400);
});

test('unread counts rise for the recipient and reset on read', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  for (const text of ['uno', 'dos']) {
    await agent
      .post(`/api/messages/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ text });
  }

  const inboxForB = await agent
    .get('/api/messages/conversations')
    .set('Authorization', `Bearer ${b.token}`);
  assert.equal(inboxForB.body.conversations[0].unread, 2);

  // The sender never accumulates unread messages of their own thread.
  const inboxForA = await agent
    .get('/api/messages/conversations')
    .set('Authorization', `Bearer ${a.token}`);
  assert.equal(inboxForA.body.conversations[0].unread, 0);

  await agent
    .post(`/api/messages/conversations/${conversationId}/read`)
    .set('Authorization', `Bearer ${b.token}`);

  const afterRead = await agent
    .get('/api/messages/conversations')
    .set('Authorization', `Bearer ${b.token}`);
  assert.equal(afterRead.body.conversations[0].unread, 0);
});

test('the inbox shows the other participant, not yourself', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  await openConversation(agent, a.token, b.user.id);

  const inbox = await agent
    .get('/api/messages/conversations')
    .set('Authorization', `Bearer ${a.token}`);

  assert.equal(inbox.body.conversations.length, 1);
  assert.equal(inbox.body.conversations[0].with.length, 1);
  assert.equal(inbox.body.conversations[0].with[0].username, b.username);
});

// --- Recibos y presencia ---------------------------------------------------

async function sendText(agent, token, conversationId, text) {
  const res = await agent
    .post(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${token}`)
    .send({ text });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.message;
}

async function threadFor(agent, token, conversationId) {
  const res = await agent
    .get(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.messages;
}

test('a fresh message starts as "sent" for its sender', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const message = await sendText(agent, a.token, conversationId, 'hola');
  assert.equal(message.status, 'sent');

  // Y sigue en "sent" mientras el otro no lo abra: no se inventa la entrega.
  const thread = await threadFor(agent, a.token, conversationId);
  assert.equal(thread[0].status, 'sent');
});

test('reading the thread moves the sender\'s ticks to "read"', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const message = await sendText(agent, a.token, conversationId, '¿lo has visto?');

  const read = await agent
    .post(`/api/messages/conversations/${conversationId}/read`)
    .set('Authorization', `Bearer ${b.token}`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.readIds, [String(message.id)]);

  const thread = await threadFor(agent, a.token, conversationId);
  assert.equal(thread[0].status, 'read');
});

test('a user cannot mark the other side\'s messages as read for them', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  await sendText(agent, a.token, conversationId, 'sin leer');

  // A es el emisor: su propio POST de lectura no debe poner el tick azul en su
  // mensaje, porque nadie lo ha leído.
  const read = await agent
    .post(`/api/messages/conversations/${conversationId}/read`)
    .set('Authorization', `Bearer ${a.token}`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.readIds, []);

  const thread = await threadFor(agent, a.token, conversationId);
  assert.equal(thread[0].status, 'sent');
});

test('reading an empty thread reports no ids to acknowledge', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const read = await agent
    .post(`/api/messages/conversations/${conversationId}/read`)
    .set('Authorization', `Bearer ${b.token}`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.readIds, []);
});

test('presence lists the other participant with their last-seen time', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const res = await agent
    .get(`/api/messages/conversations/${conversationId}/presence`)
    .set('Authorization', `Bearer ${a.token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.peers.length, 1);
  assert.equal(res.body.peers[0].username, b.username);
  // Sin socket abierto nadie está en línea; el campo existe para que la
  // cabecera pueda pintarlo en cuanto llegue el evento.
  assert.equal(res.body.peers[0].online, false);
  assert.ok(res.body.peers[0].lastSeenAt);
});

test('an outsider cannot ask for the presence of a conversation', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const outsider = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const res = await agent
    .get(`/api/messages/conversations/${conversationId}/presence`)
    .set('Authorization', `Bearer ${outsider.token}`);
  assert.equal(res.status, 404);
});

test('a call is recorded in the thread and opens the conversation if needed', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  // No prior conversation: recording a call must create the thread.
  const res = await agent
    .post('/api/messages/calls')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ peerId: b.user.id, kind: 'video', status: 'answered', durationSeconds: 65 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.message.kind, 'call');
  assert.equal(res.body.message.call.kind, 'video');
  assert.equal(res.body.message.call.status, 'answered');
  assert.equal(res.body.message.call.durationSeconds, 65);

  const thread = await agent
    .get(`/api/messages/conversations/${res.body.conversationId}/messages`)
    .set('Authorization', `Bearer ${b.token}`);

  assert.equal(thread.body.messages.length, 1);
  assert.equal(thread.body.messages[0].kind, 'call');
  assert.equal(thread.body.messages[0].call.durationSeconds, 65);
});

test('a missed call shows a readable preview and bumps the unread badge', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  await agent
    .post('/api/messages/calls')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ peerId: b.user.id, status: 'missed' });

  const inbox = await agent
    .get('/api/messages/conversations')
    .set('Authorization', `Bearer ${b.token}`);

  assert.equal(inbox.body.conversations.length, 1);
  assert.equal(inbox.body.conversations[0].lastMessagePreview, 'Llamada perdida');
  assert.equal(inbox.body.conversations[0].unread, 1);
});

test('a duration is dropped for a call that was never answered', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const res = await agent
    .post('/api/messages/calls')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ peerId: b.user.id, status: 'declined', durationSeconds: 30 });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.message.call.durationSeconds, 0);
});

test('recording a call requires a session', async () => {
  const agent = app();
  const a = await registerUser(agent);

  const res = await agent.post('/api/messages/calls').send({ peerId: a.user.id, status: 'missed' });
  assert.equal(res.status, 401);
});

test('an unknown call status is rejected', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const res = await agent
    .post('/api/messages/calls')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ peerId: b.user.id, status: 'inventado' });

  assert.equal(res.status, 400);
});
