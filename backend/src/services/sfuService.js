const os = require('os');
const env = require('../config/env');

// Un SFU (Selective Forwarding Unit) para las salas de voz de los TAK Creators.
//
// El problema que resuelve: en una malla, cada participante sube un flujo por
// cada uno de los demás. Con N personas, cada cliente sube N-1 flujos, así que
// el ancho de banda de subida (el recurso escaso en un móvil) crece en línea con
// el tamaño de la sala. Con 20 personas eso son 19 flujos subiendo; con 100, 99.
// Inviable.
//
// Con un SFU cada cliente sube UN flujo y el servidor lo reenvía a quien lo
// pida. El coste de subida pasa a ser constante, y el servidor es el único que
// paga el crecimiento. Eso es lo que permite salas de cientos.
//
// Mediasoup parte el trabajo en dos procesos: el worker (C++, en
// `node_modules/mediasoup/worker/out/Release/mediasoup-worker`) hace el trabajo
// pesado de red y códecs, y este módulo (Node) lo orquesta. Cada worker es
// independiente: si uno muere, solo caen sus salas.
//
// Este servicio se ocupa SOLO de la parte de medios. La autorización (quién
// puede entrar a una sala) vive en `liveSockets.js`, que es quien llama aquí.

// Códecs que el router anuncia a los navegadores. Opus para voz (48 kHz,
// estéreo; el navegador baja a mono si quiere) y VP8 para el vídeo del directo.
//
// VP8 va primero entre los de vídeo a propósito: es el que todo navegador sabe
// codificar por software, así que un móvil modesto puede publicar su cámara sin
// depender de un codificador por hardware. H.264 sería más eficiente en algunos
// equipos, pero no está en todas partes.
const MEDIA_CODECS = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
    parameters: {
      // Sin esto, Opus negocia un bitrate por defecto alto que gasta datos de
      // móvil sin mejorar la voz. 32 kbps es de sobra para habla.
      'sprop-stereo': 1,
      useinbandfec: 1, // corrección de errores integrada: menos cortes
    },
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      // Bitrate de arranque del directo. El cliente puede pedir más o menos con
      // `setMaxSpatialLayer`/`setPreferredLayers`; esto es solo el punto de
      // partida para que la primera imagen no salga borrosa ni sature la red.
      'x-google-start-bitrate': 800,
    },
  },
];

let mediasoup = null;
try {
  // require perezoso: si mediasoup no está instalado, el módulo sigue cargando
  // y las salas caen a malla. No es un error fatal, es una degradación.
  mediasoup = require('mediasoup');
} catch {
  mediasoup = null;
}

// Estado en memoria. Una sala de voz es efímera: si el proceso cae, no hay
// media que conservar, solo participantes que vuelven a entrar. Persistirlo
// añadiría complejidad sin ningún beneficio.
const workers = [];
const rooms = new Map(); // roomName -> Room

let nextWorker = 0;
let starting = null; // promesa de arranque en curso, para no arrancar dos veces

class Room {
  constructor(name) {
    this.name = name;
    this.router = null;
    this.transports = new Map(); // transportId -> WebRtcTransport
    this.producers = new Map(); // producerId -> { producer, userId }
    this.consumers = new Map(); // consumerId -> consumer
    // Un participante puede tener varias pestañas. Se cuenta por userId, igual
    // que la presencia, para no expulsar a alguien al cerrar una pestaña.
    this.userSockets = new Map(); // userId -> Set(socketId)
  }

  userCount() {
    return this.userSockets.size;
  }

  addUser(userId, socketId) {
    const id = String(userId);
    if (!this.userSockets.has(id)) this.userSockets.set(id, new Set());
    this.userSockets.get(id).add(socketId);
  }

  // Devuelve true si era el último socket del usuario en la sala.
  removeUser(userId, socketId) {
    const id = String(userId);
    const set = this.userSockets.get(id);
    if (!set) return false;
    set.delete(socketId);
    if (set.size === 0) {
      this.userSockets.delete(id);
      return true;
    }
    return false;
  }

  hasUser(userId) {
    return this.userSockets.has(String(userId));
  }

  // Los productores de un usuario (normalmente uno: su micrófono).
  producersOf(userId) {
    const id = String(userId);
    return [...this.producers.values()].filter((entry) => entry.userId === id);
  }
}

function pickWorker() {
  // Reparto por turnos entre los workers vivos. Busca el siguiente que siga
  // vivo, para no asignar una sala a un worker que acaba de morir.
  for (let i = 0; i < workers.length; i += 1) {
    const worker = workers[(nextWorker + i) % workers.length];
    if (worker && !worker.closed) {
      nextWorker = (nextWorker + i + 1) % workers.length;
      return worker;
    }
  }
  return null;
}

function workerCount() {
  if (env.sfuWorkerCount > 0) return env.sfuWorkerCount;
  // Uno por CPU, con tope de 4: más allá de eso el cuello de botella deja de
  // ser la CPU y se abre un proceso de más que solo consume memoria.
  return Math.max(1, Math.min(os.cpus().length, 4));
}

async function ensureStarted() {
  if (!mediasoup || !env.sfuEnabled) return false;
  if (workers.length > 0) return true;
  // Una sola promesa de arranque compartida: dos salas que entran a la vez no
  // deben crear dos juegos de workers.
  if (starting) return starting;

  starting = (async () => {
    try {
      const count = workerCount();
      for (let i = 0; i < count; i += 1) {
        const worker = await mediasoup.createWorker({
          logLevel: 'warn',
          rtcMinPort: env.sfuRtcMinPort,
          rtcMaxPort: env.sfuRtcMaxPort,
        });
        // Un worker que muere (segfault, OOM) no debe llevarse la app por
        // delante. Se quita de la lista y se avisa; las salas que alojaba se
        // reconstruirán solas cuando alguien vuelva a entrar.
        worker.on('died', () => {
          const index = workers.indexOf(worker);
          if (index !== -1) workers.splice(index, 1);
          console.error(`⚠️  mediasoup worker ${worker.pid} ha muerto; queda(n) ${workers.length}`);
        });
        workers.push(worker);
      }
      console.log(`🔊 SFU listo: ${workers.length} worker(s), puertos ${env.sfuRtcMinPort}-${env.sfuRtcMaxPort}`);
      return true;
    } catch (error) {
      console.error('⚠️  No se pudo arrancar el SFU; las salas usarán malla:', error.message);
      workers.length = 0;
      return false;
    } finally {
      starting = null;
    }
  })();

  return starting;
}

function isAvailable() {
  return !!mediasoup && env.sfuEnabled;
}

async function getOrCreateRoom(roomName) {
  if (!(await ensureStarted())) return null;

  const existing = rooms.get(roomName);
  if (existing) return existing;

  const worker = pickWorker();
  if (!worker) return null;

  const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
  const room = new Room(roomName);
  room.router = router;
  rooms.set(roomName, room);
  return room;
}

function getRoom(roomName) {
  return rooms.get(roomName) || null;
}

async function createWebRtcTransport(room, socketId) {
  // Se anuncian UDP y TCP. UDP es preferible (menos latencia, sin cabeceras de
  // retransmisión), pero algunos cortafuegos corporativos bloquean UDP y sin
  // TCP la conexión no se establece. `preferUdp` intenta UDP primero.
  const listenInfos = [
    {
      protocol: 'udp',
      ip: env.sfuListenIp,
      announcedAddress: env.sfuAnnouncedAddress,
    },
    {
      protocol: 'tcp',
      ip: env.sfuListenIp,
      announcedAddress: env.sfuAnnouncedAddress,
    },
  ];

  const transport = await room.router.createWebRtcTransport({
    listenInfos,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    // El socket dueño, para poder cerrar todo lo suyo al desconectar sin
    // recorrer el mapa buscando coincidencias por otra vía.
    appData: { socketId },
    // Límites de bitrate por transporte. Sin ellos un cliente malicioso (o un
    // bug) puede inundar la red. 1,5 Mbps sobra para voz.
    initialAvailableOutgoingBitrate: 500_000,
  });

  room.transports.set(transport.id, transport);

  // Si el transporte se cierra (por un fallo de red), se quita del mapa para no
  // dejar referencias muertas.
  transport.on('dtlsstatechange', (state) => {
    if (state === 'closed') {
      room.transports.delete(transport.id);
      transport.close();
    }
  });

  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
}

async function connectTransport(room, transportId, dtlsParameters) {
  const transport = room.transports.get(transportId);
  if (!transport) throw new Error('Transporte no encontrado');
  await transport.connect({ dtlsParameters });
}

async function produce(room, transportId, userId, { kind, rtpParameters, appData }) {
  const transport = room.transports.get(transportId);
  if (!transport) throw new Error('Transporte no encontrado');

  const producer = await transport.produce({
    kind,
    rtpParameters,
    appData: { ...(appData || {}), userId: String(userId) },
  });

  room.producers.set(producer.id, { producer, userId: String(userId) });

  producer.on('transportclose', () => {
    room.producers.delete(producer.id);
  });

  return { id: producer.id };
}

async function consume(room, transportId, { producerId, rtpCapabilities }) {
  const transport = room.transports.get(transportId);
  if (!transport) throw new Error('Transporte no encontrado');

  if (!room.producers.has(producerId)) throw new Error('Productor no encontrado');

  // Si el router no puede reenviar ese productor a esas capacidades, `consume`
  // fallaría con un error opaco. Comprobarlo antes da un mensaje claro.
  if (!room.router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error('El consumidor no puede recibir ese audio');
  }

  const consumer = await transport.consume({
    producerId,
    rtpCapabilities,
    // Nace pausado: el cliente lo reanuda cuando ya tiene el `<audio>`
    // enganchado, para no perder los primeros milisegundos.
    paused: true,
  });

  room.consumers.set(consumer.id, consumer);

  consumer.on('transportclose', () => {
    room.consumers.delete(consumer.id);
  });
  consumer.on('producerclose', () => {
    room.consumers.delete(consumer.id);
  });

  return {
    id: consumer.id,
    producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
  };
}

async function resumeConsumer(room, consumerId) {
  const consumer = room.consumers.get(consumerId);
  if (!consumer) return;
  await consumer.resume();
}

// Cierra la conexión de un socket concreto: sus productores y sus transportes.
// Se llama al salir de la sala y al desconectar.
function closeSocket(room, socketId) {
  if (!room) return;
  for (const [id, transport] of room.transports) {
    if (transport.appData?.socketId === socketId) {
      transport.close();
      room.transports.delete(id);
    }
  }
}

async function removeParticipant(roomName, userId, socketId) {
  const room = rooms.get(roomName);
  if (!room) return;

  closeSocket(room, socketId);
  room.removeUser(userId, socketId);

  // Sin usuarios, la sala entera se destruye: mantener un router vivo para nadie
  // es memoria (y puertos) desperdiciados.
  if (room.userCount() === 0) {
    room.router.close();
    rooms.delete(roomName);
  }
}

// Cuántas personas hay ahora mismo en una sala (contando pestañas de más como
// una). Lo usa `liveSockets` para decidir si avisa del aforo.
function participantCount(roomName) {
  const room = rooms.get(roomName);
  return room ? room.userCount() : 0;
}

// Los flujos vivos de una sala, con su dueño y su tipo. Se le entrega a quien
// entra para que sepa a qué suscribirse sin esperar a que los demás vuelvan a
// producir. El `kind` ('audio' o 'video') es lo que permite al cliente pintar el
// micrófono y la cámara en sitios distintos: la voz va a un `<audio>` y la
// imagen a un `<video>`.
function listProducers(roomName) {
  const room = rooms.get(roomName);
  if (!room) return [];
  return [...room.producers.values()].map(({ producer, userId }) => ({
    producerId: producer.id,
    userId,
    kind: producer.kind,
  }));
}

async function shutdown() {
  for (const room of rooms.values()) room.router.close();
  rooms.clear();
  for (const worker of workers) worker.close();
  workers.length = 0;
}

module.exports = {
  isAvailable,
  ensureStarted,
  getOrCreateRoom,
  getRoom,
  createWebRtcTransport,
  connectTransport,
  produce,
  consume,
  resumeConsumer,
  removeParticipant,
  participantCount,
  listProducers,
  shutdown,
  MEDIA_CODECS,
};
