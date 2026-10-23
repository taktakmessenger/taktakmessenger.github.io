// Servidor mínimo para las pruebas del frontend estático.
//
// Monta la app real sin conectar a MongoDB: /health y los archivos estáticos no
// tocan la base, así que la prueba no necesita una instancia de mongo. Escucha
// en el puerto 0 (que el sistema elige uno libre) e imprime cuál quedó, porque
// si no el test no tendría forma de saber a dónde pedir.

const createApp = require('../../src/app');

const app = createApp();
const server = app.listen(0, '127.0.0.1', () => {
  console.log(`LISTENING ${server.address().port}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
