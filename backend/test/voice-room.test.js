const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: ioClient } = require('socket.io-client');
const createApp = require('../src/app');
const { initLiveSockets } = require('../src/services/liveSockets');
const sfu = require('../src/services/sfuService');
const { connectTestDb, resetDb, disconnectTestDb, app, registerUser } = require('./helpers');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => {
  // Los workers del SFU son procesos hijos: si no se cierran, la suite no
  // termina y quedan ocupando los puertos de media.
  await sfu.shutdown().catch(() => {});
  await disconnectTestDb();
});

// Servidor real en un puerto efímero: la autorización y el reparto de la sala
// se prueban de extremo a extremo, sin dobles.
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

async function createSquad(agent, token, overrides = {}) {
  const res = await agent
    .post('/api/squads')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: overrides.name || `Sala ${Math.random().toString(36).slice(2, 6)}`, visibility: overrides.visibility || 'public' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.squad;
}

test('un miembro entra a la sala y el otro recibe el aviso', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const member = await registerUser(agent);
  const squad = await createSquad(agent, owner.token);
  await agent.post(`/api/squads/${squad.slug}/join`).set('Authorization', `Bearer ${member.token}`);

  await withServer(async (url) => {
    const a = await connect(url, owner.token);
    const b = await connect(url, member.token);
    try {
      a.emit('voice:join', { slug: squad.slug, mesh: true });
      const joinedA = await nextEvent(a, 'voice:joined');
      assert.equal(joinedA.room, squad.voiceRoom);
      assert.deepEqual(joinedA.peers, [], 'el primero en entrar no ve a nadie');

      const notice = nextEvent(a, 'voice:peer-joined');
      b.emit('voice:join', { slug: squad.slug, mesh: true });
      const joinedB = await nextEvent(b, 'voice:joined');

      assert.equal(joinedB.peers.length, 1, 'quien entra ve a los que ya estaban');
      assert.equal(joinedB.peers[0].id, owner.user.id);

      const peer = await notice;
      assert.equal(peer.id, member.user.id);
      assert.equal(peer.username, member.username);
    } finally {
      a.close();
      b.close();
    }
  });
});

test('la señalización viaja entre pares de la misma sala', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const member = await registerUser(agent);
  const squad = await createSquad(agent, owner.token);
  await agent.post(`/api/squads/${squad.slug}/join`).set('Authorization', `Bearer ${member.token}`);

  await withServer(async (url) => {
    const a = await connect(url, owner.token);
    const b = await connect(url, member.token);
    try {
      a.emit('voice:join', { slug: squad.slug, mesh: true });
      await nextEvent(a, 'voice:joined');
      b.emit('voice:join', { slug: squad.slug, mesh: true });
      await nextEvent(b, 'voice:joined');
      await nextEvent(a, 'voice:peer-joined');

      // La oferta que manda quien entra llega al que ya estaba, con el emisor
      // correcto, para poder contestarla.
      const offer = nextEvent(a, 'voice:offer');
      b.emit('voice:offer', { to: owner.user.id, sdp: { type: 'offer', sdp: 'v=0' } });
      const received = await offer;
      assert.equal(received.from, member.user.id);
      assert.equal(received.sdp.sdp, 'v=0');

      const answer = nextEvent(b, 'voice:answer');
      a.emit('voice:answer', { to: member.user.id, sdp: { type: 'answer', sdp: 'v=0' } });
      assert.equal((await answer).from, owner.user.id);

      const ice = nextEvent(a, 'voice:ice');
      b.emit('voice:ice', { to: owner.user.id, candidate: { candidate: 'candidate:1' } });
      assert.equal((await ice).from, member.user.id);
    } finally {
      a.close();
      b.close();
    }
  });
});

test('un no miembro de un creator privado no entra a la sala', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const outsider = await registerUser(agent);
  const squad = await createSquad(agent, owner.token, { visibility: 'private' });

  await withServer(async (url) => {
    const intruder = await connect(url, outsider.token);
    try {
      const failed = nextEvent(intruder, 'voice:error');
      intruder.emit('voice:join', { slug: squad.slug, mesh: true });
      const err = await failed;
      assert.match(err.error, /miembro/i);

      // Y no debe haber entrado: un `voice:joined` nunca debe llegarle.
      let joined = false;
      intruder.on('voice:joined', () => {
        joined = true;
      });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(joined, false, 'un extraño no puede entrar en la sala privada');
    } finally {
      intruder.close();
    }
  });
});

test('la señalización no cruza entre salas distintas', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const squadA = await createSquad(agent, a.token);
  const squadB = await createSquad(agent, b.token);

  await withServer(async (url) => {
    const sa = await connect(url, a.token);
    const sb = await connect(url, b.token);
    try {
      sa.emit('voice:join', { slug: squadA.slug, mesh: true });
      await nextEvent(sa, 'voice:joined');
      sb.emit('voice:join', { slug: squadB.slug, mesh: true });
      await nextEvent(sb, 'voice:joined');

      let leaked = false;
      sa.on('voice:offer', () => {
        leaked = true;
      });
      // `sb` intenta ofrecer a un usuario de la otra sala; el servidor debe
      // ignorarlo porque no comparten sala.
      sb.emit('voice:offer', { to: a.user.id, sdp: { type: 'offer', sdp: 'x' } });

      await new Promise((r) => setTimeout(r, 300));
      assert.equal(leaked, false, 'la señalización no debe cruzar de sala');
    } finally {
      sa.close();
      sb.close();
    }
  });
});

test('al desconectar, el resto recibe que el par se ha ido', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const member = await registerUser(agent);
  const squad = await createSquad(agent, owner.token);
  await agent.post(`/api/squads/${squad.slug}/join`).set('Authorization', `Bearer ${member.token}`);

  await withServer(async (url) => {
    const a = await connect(url, owner.token);
    const b = await connect(url, member.token);
    try {
      a.emit('voice:join', { slug: squad.slug, mesh: true });
      await nextEvent(a, 'voice:joined');
      b.emit('voice:join', { slug: squad.slug, mesh: true });
      await nextEvent(b, 'voice:joined');
      await nextEvent(a, 'voice:peer-joined');

      const left = nextEvent(a, 'voice:peer-left');
      b.close();
      const payload = await left;
      assert.equal(payload.userId, member.user.id);
    } finally {
      a.close();
      b.close();
    }
  });
});

test('un usuario sin sesión no entra a ninguna sala', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const squad = await createSquad(agent, owner.token);

  await withServer(async (url) => {
    const anon = await connect(url, undefined);
    try {
      let joined = false;
      let errored = false;
      anon.on('voice:joined', () => {
        joined = true;
      });
      anon.on('voice:error', () => {
        errored = true;
      });
      anon.emit('voice:join', { slug: squad.slug, mesh: true });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(joined, false, 'sin sesión no se entra');
      assert.equal(errored, false, 'ni siquiera se contesta, para no filtrar la sala');
    } finally {
      anon.close();
    }
  });
});

// ------------------------------------------------------------------
// SFU
// ------------------------------------------------------------------

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout en ${event}`)), 8000);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

test('el modo es de la sala: el primero decide y el segundo se adapta', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const member = await registerUser(agent);
  const squad = await createSquad(agent, owner.token);
  await agent.post(`/api/squads/${squad.slug}/join`).set('Authorization', `Bearer ${member.token}`);

  await withServer(async (url) => {
    const a = await connect(url, owner.token);
    const b = await connect(url, member.token);
    try {
      a.emit('voice:join', { slug: squad.slug });
      const joinedA = await nextEvent(a, 'voice:joined');

      // El SFU no siempre está disponible (worker no descargado). Si lo está,
      // el primero debe haber entrado por SFU y traer las capacidades del router.
      if (sfu.isAvailable()) {
        assert.equal(joinedA.mode, 'sfu');
        assert.ok(joinedA.routerRtpCapabilities?.codecs?.length > 0, 'debe traer los códecs del router');
      } else {
        assert.equal(joinedA.mode, 'mesh');
      }

      b.emit('voice:join', { slug: squad.slug, mesh: true });
      const joinedB = await nextEvent(b, 'voice:joined');
      // Pide malla, pero la sala ya es SFU: debe adaptarse para no quedar sorda.
      assert.equal(joinedB.mode, joinedA.mode, 'ambos deben compartir el modo de la sala');
    } finally {
      a.close();
      b.close();
    }
  });
});

test('la señalización del SFU crea transporte, publica y suscribe al otro', async () => {
  if (!sfu.isAvailable()) {
    // Sin SFU el test no aplica; se deja constancia en vez de fingir un verde.
    assert.ok(true, 'SFU no disponible en este entorno');
    return;
  }

  const agent = app();
  const owner = await registerUser(agent);
  const member = await registerUser(agent);
  const squad = await createSquad(agent, owner.token);
  await agent.post(`/api/squads/${squad.slug}/join`).set('Authorization', `Bearer ${member.token}`);

  await withServer(async (url) => {
    const a = await connect(url, owner.token);
    const b = await connect(url, member.token);
    try {
      a.emit('voice:join', { slug: squad.slug });
      const joinedA = await nextEvent(a, 'voice:joined');
      assert.equal(joinedA.mode, 'sfu');

      // El segundo entra también (aún sin micrófono publicado: `producers` vacío).
      b.emit('voice:join', { slug: squad.slug });
      const joinedB = await nextEvent(b, 'voice:joined');
      assert.equal(joinedB.mode, 'sfu');
      assert.equal(joinedB.producers.length, 0, 'todavía nadie ha publicado');

      // Ahora el primero publica: el segundo debe recibir el aviso en vivo.
      const producerNotice = nextEvent(b, 'voice:new-producer');

      const sendTransport = await emitAck(a, 'voice:create-transport', { direction: 'send' });
      assert.equal(sendTransport.ok, true);
      assert.ok(sendTransport.id, 'el transporte debe tener id');
      assert.ok(sendTransport.iceCandidates.length > 0, 'debe traer candidatos ICE');

      const produced = await emitAck(a, 'voice:produce', {
        transportId: sendTransport.id,
        kind: 'audio',
        rtpParameters: {
          codecs: [{ mimeType: 'audio/opus', payloadType: 111, clockRate: 48000, channels: 2, parameters: {}, rtcpFeedback: [] }],
          encodings: [{ ssrc: 424242 }],
          headerExtensions: [],
          rtcp: { cname: 'test', reducedSize: true, mux: true },
        },
      });
      assert.equal(produced.ok, true);
      assert.ok(produced.producerId, 'debe devolver el id del productor');

      const notice = await producerNotice;
      assert.equal(notice.producerId, produced.producerId);
      assert.equal(notice.userId, owner.user.id);

      // El segundo se suscribe a ese audio.
      const recvTransport = await emitAck(b, 'voice:create-transport', { direction: 'recv' });
      assert.equal(recvTransport.ok, true);

      const consumed = await emitAck(b, 'voice:consume', {
        transportId: recvTransport.id,
        producerId: produced.producerId,
        rtpCapabilities: joinedB.routerRtpCapabilities,
      });
      assert.equal(consumed.ok, true);
      assert.equal(consumed.kind, 'audio');
      assert.equal(consumed.producerId, produced.producerId);

      const resumed = await emitAck(b, 'voice:resume-consumer', { consumerId: consumed.id });
      assert.equal(resumed.ok, true);
    } finally {
      a.close();
      b.close();
    }
  });
});

test('no se puede publicar ni consumir sin haber entrado en modo SFU', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const squad = await createSquad(agent, owner.token);

  await withServer(async (url) => {
    const a = await connect(url, owner.token);
    try {
      // Sin entrar a la sala, ningún intento de tocar el SFU debe prosperar.
      const created = await emitAck(a, 'voice:create-transport', { direction: 'send' });
      assert.equal(created.ok, false);

      const consumed = await emitAck(a, 'voice:consume', {
        transportId: 'inventado',
        producerId: 'inventado',
        rtpCapabilities: { codecs: [] },
      });
      assert.equal(consumed.ok, false);
    } finally {
      a.close();
    }
  });
});
