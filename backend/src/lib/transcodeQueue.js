// Cola de un solo carril para trabajos pesados (la conversión de vídeo).
//
// El plan gratuito de Render da 512 MB y el contenedor se reinicia al pasarse
// (evento `oomKilled`). Con varias conversiones a la vez, o con una que se
// solape con la anterior, el proceso muere a mitad y el vídeo se queda
// `processing` para siempre, sin HLS ni miniatura: eso se ve como pantalla
// negra. Ejecutarlas de una en una pone un techo predecible a la memoria.
//
// En proceso y no como cola externa a propósito: una conversión tarda segundos
// o pocos minutos y el volumen es de unos pocos vídeos al día. Meter Redis o
// BullMQ por esto añadiría un servicio más que pagar y mantener.
function createSerialQueue(run) {
  const pending = [];
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending.length > 0) {
        const job = pending.shift();
        try {
          await run(job);
        } catch (err) {
          // Un trabajo que revienta no puede dejar la cola atascada: el resto
          // sigue. El propio runner se encarga de marcar ese vídeo como fallido.
          console.error('[queue] trabajo fallido:', err?.message || err);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    enqueue(job) {
      pending.push(job);
      return drain();
    },
    get pending() {
      return pending.length;
    },
    get running() {
      return running;
    },
  };
}

module.exports = { createSerialQueue };
