const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
} = require('./helpers');
const Message = require('../src/models/Message');

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

async function send(agent, token, conversationId, payload) {
  return agent
    .post(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${token}`)
    .send(payload);
}

test('una ubicación se guarda y se devuelve con sus coordenadas', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const sent = await send(agent, a.token, conversationId, {
    rich: { type: 'location', lat: 19.4326, lng: -99.1332, placeName: 'Zócalo' },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.message.kind, 'location');
  assert.equal(sent.body.message.rich.type, 'location');
  assert.equal(sent.body.message.rich.lat, 19.4326);
  assert.equal(sent.body.message.rich.placeName, 'Zócalo');

  const thread = await agent
    .get(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${b.token}`);
  assert.equal(thread.body.messages[0].rich.type, 'location');
});

test('una ubicación con coordenadas imposibles se rechaza', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const res = await send(agent, a.token, conversationId, {
    rich: { type: 'location', lat: 500, lng: 0 },
  });
  assert.equal(res.status, 400);
});

test('un contacto se guarda con nombre y teléfono', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const sent = await send(agent, a.token, conversationId, {
    rich: { type: 'contact', name: 'Marta Ruiz', phone: '+34 600 123 456' },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.message.kind, 'contact');
  assert.equal(sent.body.message.rich.name, 'Marta Ruiz');
  assert.equal(sent.body.message.rich.phone, '+34 600 123 456');
});

test('una encuesta nace sin votos y se puede votar', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const sent = await send(agent, a.token, conversationId, {
    rich: { type: 'poll', question: '¿Cenamos el viernes?', options: ['Sí', 'No', 'Quizá'] },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const pollId = sent.body.message.id;
  assert.deepEqual(sent.body.message.rich.totals, [0, 0, 0]);

  const voted = await agent
    .post(`/api/messages/conversations/${conversationId}/messages/${pollId}/vote`)
    .set('Authorization', `Bearer ${b.token}`)
    .send({ optionIndex: 0 });
  assert.equal(voted.status, 200, JSON.stringify(voted.body));
  assert.deepEqual(voted.body.message.rich.totals, [1, 0, 0]);
  assert.equal(voted.body.message.rich.votes[0][0], b.user.id);
});

test('votar dos veces la misma opción retira el voto', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const sent = await send(agent, a.token, conversationId, {
    rich: { type: 'poll', question: '¿Sí o no?', options: ['Sí', 'No'] },
  });
  const pollId = sent.body.message.id;
  const vote = (token) =>
    agent
      .post(`/api/messages/conversations/${conversationId}/messages/${pollId}/vote`)
      .set('Authorization', `Bearer ${token}`)
      .send({ optionIndex: 1 });

  await vote(b.token);
  const second = await vote(b.token);
  assert.deepEqual(second.body.message.rich.totals, [0, 0]);
});

test('en una encuesta de respuesta única, votar otra opción mueve el voto', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const sent = await send(agent, a.token, conversationId, {
    rich: { type: 'poll', question: '¿Cuál?', options: ['A', 'B'] },
  });
  const pollId = sent.body.message.id;
  const vote = (index) =>
    agent
      .post(`/api/messages/conversations/${conversationId}/messages/${pollId}/vote`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ optionIndex: index });

  await vote(0);
  const moved = await vote(1);
  assert.deepEqual(moved.body.message.rich.totals, [0, 1]);
});

test('una encuesta con menos de dos opciones se rechaza', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const res = await send(agent, a.token, conversationId, {
    rich: { type: 'poll', question: '¿Solo una?', options: ['Única'] },
  });
  assert.equal(res.status, 400);
});

test('un evento necesita título y fecha', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const missingDate = await send(agent, a.token, conversationId, {
    rich: { type: 'event', title: 'Cumpleaños' },
  });
  assert.equal(missingDate.status, 400);

  const ok = await send(agent, a.token, conversationId, {
    rich: {
      type: 'event',
      title: 'Cumpleaños de Ana',
      startsAt: '2026-12-24T20:00:00.000Z',
      location: 'Casa de Ana',
    },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.message.kind, 'event');
  assert.equal(ok.body.message.rich.title, 'Cumpleaños de Ana');
});

test('un voto no puede salirse de las opciones', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const sent = await send(agent, a.token, conversationId, {
    rich: { type: 'poll', question: '¿?', options: ['Sí', 'No'] },
  });
  const pollId = sent.body.message.id;

  const res = await agent
    .post(`/api/messages/conversations/${conversationId}/messages/${pollId}/vote`)
    .set('Authorization', `Bearer ${b.token}`)
    .send({ optionIndex: 9 });
  assert.equal(res.status, 400);
});

test('un extraño no puede votar en una encuesta ajena', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const stranger = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const sent = await send(agent, a.token, conversationId, {
    rich: { type: 'poll', question: '¿?', options: ['Sí', 'No'] },
  });
  const pollId = sent.body.message.id;

  const res = await agent
    .post(`/api/messages/conversations/${conversationId}/messages/${pollId}/vote`)
    .set('Authorization', `Bearer ${stranger.token}`)
    .send({ optionIndex: 0 });
  assert.equal(res.status, 404);
});

test('la vista previa del inbox describe el contenido rico', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  await send(agent, a.token, conversationId, {
    rich: { type: 'contact', name: 'Luis', phone: '+34 600 000 000' },
  });

  const inbox = await agent
    .get('/api/messages/conversations')
    .set('Authorization', `Bearer ${b.token}`);
  const row = inbox.body.conversations.find((c) => String(c.id) === String(conversationId));
  assert.match(row.lastMessagePreview, /Contacto: Luis/);
});

test('el mensaje rico se guarda con el kind del tipo, no como texto', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  await send(agent, a.token, conversationId, {
    rich: { type: 'location', lat: 1, lng: 2 },
  });

  const stored = await Message.findOne({ conversation: conversationId });
  assert.equal(stored.kind, 'location');
  assert.equal(stored.rich.type, 'location');
});
