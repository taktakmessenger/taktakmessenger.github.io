import { Device } from 'mediasoup-client';

// Cliente del SFU (mediasoup) para la sala de voz de un TAK Creator.
//
// El servidor reenvía el audio en lugar de dejar que cada cliente hable con
// todos los demás. Eso hace que el coste de subida sea constante: da igual que
// haya 3 personas o 300, cada uno sube un solo flujo. Es la diferencia entre
// una sala que aguanta un creator con su comunidad y una que se cae a las
// pocas decenas.
//
// Este módulo encapsula el baile de transportes y productores/consumidores para
// que el contexto de React solo tenga que llamar a métodos con nombre.

/**
 * Crea un cliente SFU ya conectado a la sala.
 *
 * @param {object} opts
 * @param {Function} opts.emitAck  Emite al socket y espera el acuse de recibo.
 * @param {MediaStream} opts.localStream  Micrófono local.
 * @param {object} opts.routerRtpCapabilities  Capacidades del router del servidor.
 * @param {object} opts.iceServers  Servidores ICE (STUN/TURN) ya resueltos.
 * @param {string} opts.userId  El id propio, para no suscribirse a uno mismo.
 * @param {Function} opts.onRemoteTrack  Se llama con (track, peerId, kind) por cada flujo remoto.
 */
export async function createSfuClient({
  emitAck,
  localStream,
  routerRtpCapabilities,
  iceServers,
  userId,
  onRemoteTrack,
}) {
  // El dispositivo negocia con el router del servidor. `load` lanza si el
  // navegador no soporta lo que el router ofrece, y ahí el contexto cae a malla.
  const device = new Device();
  await device.load({ routerRtpCapabilities });

  // Un transporte para enviar (nuestro micrófono) y otro para recibir (el audio
  // de los demás). Van separados porque el sentido de la conexión es distinto y
  // así se puede cerrar uno sin tocar el otro.
  const sendTransport = await device.createSendTransport(
    await transportParams('send')
  );

  const recvTransport = await device.createRecvTransport(
    await transportParams('recv')
  );

  async function transportParams(direction) {
    const response = await emitAck('voice:create-transport', { direction });
    if (!response?.ok) throw new Error(response?.error || 'No se pudo preparar el audio');
    return {
      id: response.id,
      iceParameters: response.iceParameters,
      iceCandidates: response.iceCandidates,
      dtlsParameters: response.dtlsParameters,
      iceServers,
    };
  }

  // Mediasoup-client pide conectar el transporte cuando ya tiene la oferta DTLS
  // lista; el servidor es quien la acepta.
  sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
    emitAck('voice:connect-transport', { transportId: sendTransport.id, dtlsParameters })
      .then((r) => (r?.ok ? callback() : errback(new Error(r?.error))))
      .catch(errback);
  });

  recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
    emitAck('voice:connect-transport', { transportId: recvTransport.id, dtlsParameters })
      .then((r) => (r?.ok ? callback() : errback(new Error(r?.error))))
      .catch(errback);
  });

  // Al publicar, el servidor crea el productor y avisa a los demás.
  sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
    emitAck('voice:produce', { transportId: sendTransport.id, kind, rtpParameters, appData })
      .then((r) => (r?.ok ? callback({ id: r.producerId }) : errback(new Error(r?.error))))
      .catch(errback);
  });

  // Publica cámara y micrófono. Se publica cada pista como su propio productor
  // para que quien entra pueda decidir qué consume: en un directo con veinte
  // invitados, suscribirse a todos los vídeos satura el móvil, así que el
  // cliente consume el vídeo de pocos (el del anfitrión siempre) y el audio de
  // todos. Con una sola pista no habría esa elección.
  const producers = [];
  for (const track of localStream.getTracks()) {
    // La cámara de un móvil puede venir a 1280x720 o más. Se pide al codificador
    // que arranque razonable para una ventana de rejilla; el SFU y el cliente
    // ajustan después con las capas.
    const options = { track };
    if (track.kind === 'video') {
      options.encodings = [{ maxBitrate: 900_000 }];
    }
    producers.push(await sendTransport.produce(options));
  }

  // Se guarda por productor para poder cerrarlos todos al salir.
  const consumers = new Map(); // producerId -> consumer

  async function consume(producerId, userId, kind) {
    const response = await emitAck('voice:consume', {
      transportId: recvTransport.id,
      producerId,
      rtpCapabilities: device.rtpCapabilities,
    });
    if (!response?.ok) return;

    const consumer = await recvTransport.consume({
      id: response.id,
      producerId: response.producerId,
      kind: response.kind,
      rtpParameters: response.rtpParameters,
    });

    consumers.set(producerId, consumer);
    consumer.on('transportclose', () => consumers.delete(producerId));

    // El `kind` viene del consumidor (fuente de verdad del servidor); el que
    // llegó por parámetro solo es un respaldo para cuando el cliente ya sabía
    // de antemano qué estaba pidiendo.
    onRemoteTrack?.(consumer.track, userId, consumer.kind || kind);
    // El consumidor nace pausado; se reanuda cuando el cliente ya tiene la
    // pista enganchada a un `<audio>` o un `<video>`.
    await emitAck('voice:resume-consumer', { consumerId: consumer.id });
  }

  return {
    device,
    producers,
    // Suscribirse al flujo de un participante. Idempotente: pedir dos veces el
    // mismo productor no duplica el consumidor.
    consume,
    async consumeExisting(list) {
      for (const { producerId, userId: owner, kind } of list) {
        if (String(owner) === String(userId)) continue;
        await consume(producerId, owner, kind).catch(() => {});
      }
    },
    close() {
      for (const consumer of consumers.values()) consumer.close();
      consumers.clear();
      producers.forEach((p) => p.close());
      sendTransport.close();
      recvTransport.close();
    },
  };
}
