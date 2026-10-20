const env = require('../config/env');

function notFound(req, res) {
  res.status(404).json({ error: 'Recurso no encontrado' });
}

// Terminal error handler. Client errors keep their status; anything else is
// logged and reported as a generic 500 so internals never leak to callers.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;

  // Multer reports upload problems through its own error codes, which carry no
  // status. Without this a file over the limit would surface as a 500.
  if (err.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    err.message = 'El archivo supera el tamaño máximo permitido';
  } else if (err.code?.startsWith('LIMIT_')) {
    status = 400;
  }

  if (status >= 500) {
    console.error('[error]', err.stack || err.message);
  }

  // Only errors deliberately raised by our own code carry a message meant for
  // the caller. An unexpected exception keeps the generic text so internals
  // (stack, driver messages, query shapes) never reach the client.
  const body = { error: status >= 500 && !err.expose ? 'Algo salió mal!' : err.message };
  if (!env.isProduction && status >= 500 && !err.expose) {
    body.stack = err.stack;
  }

  res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
