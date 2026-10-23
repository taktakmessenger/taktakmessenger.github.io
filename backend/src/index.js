const createApp = require('./app');
const db = require('./config/db');
const env = require('./config/env');
const { seedGifts } = require('./services/giftService');
const { initLiveSockets } = require('./services/liveSockets');
const sfu = require('./services/sfuService');

async function main() {
  const app = createApp();

  // El puerto se abre antes de tener base de datos, a propósito. El health check
  // del despliegue mide que el proceso esté en pie, y Mongo puede ser un servicio
  // externo que todavía no acepta conexiones. Conectar primero y morir si falla
  // dejaba el despliegue caído en bucle y sin puerto que comprobar; así la API
  // arranca, responde y se conecta sola en cuanto el servidor aparezca.
  const server = app.listen(env.port, () => {
    console.log(`🚀 TAK TAK API corriendo en puerto ${env.port}`);
  });

  // Live chat/gift transport. Uses the same HTTP server and port.
  initLiveSockets(server);
  console.log('📡 Sockets en vivo activos');

  db.connectWithRetry({
    onError: (error, attempt) =>
      console.warn(
        `[db] sin conexión (intento ${attempt}): ${error.message}. Reintento en 5 s`
      ),
  })
    .then(async (connected) => {
      if (!connected) return;
      console.log('✅ Conectado a MongoDB');

      // The gift catalogue is required for server-side pricing; without it every
      // gift sent by name would be rejected.
      const seeded = await seedGifts();
      if (seeded > 0) console.log(`🎁 Catálogo de regalos: ${seeded} nuevos`);
    })
    .catch((err) => console.error('[db] fallo al preparar la base de datos:', err.message));

  // El SFU se arranca en segundo plano, sin bloquear el servidor: si tarda (o
  // falla), la API ya está sirviendo y las salas de voz caen a malla hasta que
  // esté listo. Bloquear aquí retrasaría el arranque por una función opcional.
  sfu.ensureStarted().catch(() => {});

  const shutdown = async (signal) => {
    console.log(`\n${signal} recibido, cerrando...`);
    // Cierra los workers del SFU (procesos hijos) antes de salir, para no
    // dejarlos huérfanos ocupando los puertos de media.
    await sfu.shutdown().catch(() => {});
    server.close(async () => {
      await db.disconnect();
      process.exit(0);
    });
    // Do not hang forever if connections refuse to drain.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fallo al iniciar TAK TAK API:', err);
  process.exit(1);
});
