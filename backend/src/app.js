const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const db = require('./config/db');
const serveFrontend = require('./middleware/serveFrontend');
const attachmentKinds = require('./lib/attachments');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const videoRoutes = require('./routes/video');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');
const squadRoutes = require('./routes/squads');
const healthRoutes = require('./routes/health');
const feedRoutes = require('./routes/feed');
const analyticsRoutes = require('./routes/analytics');
const giftRoutes = require('./routes/gifts');
const soundRoutes = require('./routes/sounds');
const paymentRoutes = require('./routes/payments');
const messageRoutes = require('./routes/messages');
const verificationRoutes = require('./routes/verification');
const commentRoutes = require('./routes/comments');
const callRoutes = require('./routes/calls');
const pushRoutes = require('./routes/push');
const notificationRoutes = require('./routes/notifications');
const { notFound, errorHandler } = require('./middleware/errorHandler');

// Built as a factory so tests can mount the app without starting a listener.
function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin }));
  app.use(compression());
  if (env.nodeEnv !== 'test') {
    app.use(morgan('combined'));
  }
  app.use(express.json({
    limit: '1mb',
    // Stripe firma el cuerpo CRUDO del webhook. Si se verifica la firma contra
    // el objeto ya parseado y reserializado, los espacios y el orden de las
    // claves cambian y la firma no cuadra jamás. Guardar el búfer aquí, en el
    // único punto por el que pasa el cuerpo, evita tener que reordenar el
    // middleware o montar un parser aparte solo para esa ruta.
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }));
  app.use(express.urlencoded({ extended: true }));

  // Baseline limiter for the whole API; auth and money routes add stricter
  // limits of their own. Skipped in tests, where a suite legitimately issues
  // far more requests than a real client would.
  if (!env.isTest) {
    app.use(
      '/api',
      rateLimit({
        windowMs: 60 * 1000,
        max: 300,
        standardHeaders: true,
        legacyHeaders: false,
      })
    );
  }

  app.get('/health', (req, res) => {
    // El proceso está en pie (por eso responde 200), pero el estado de la base
    // de datos se informa aparte: así un despliegue puede distinguir "la API no
    // arrancó" de "la API está bien pero aún no encuentra Mongo".
    res.json({
      status: 'OK',
      service: 'TAK TAK API',
      db: db.isConnected() ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/videos', videoRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/squads', squadRoutes);
  app.use('/api/health', healthRoutes);
  app.use('/api/feed', feedRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/gifts', giftRoutes);
  app.use('/api/sounds', soundRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/verification', verificationRoutes);
  app.use('/api/comments', commentRoutes);
  app.use('/api/calls', callRoutes);
  app.use('/api/push', pushRoutes);
  app.use('/api/notifications', notificationRoutes);

  // Uploaded originals and their HLS renditions. Read-only.
  //
  // `setHeaders` refuerza dos cosas en cada respuesta. `nosniff` impide que el
  // navegador adivine el tipo por el contenido: sin él, un archivo con
  // extensión inofensiva pero contenido HTML se ejecutaría. `Content-Disposition`
  // separa lo que se puede mostrar en línea (imagen, vídeo, audio) de lo que se
  // descarga, y de paso neutraliza el nombre para que no rompa la cabecera.
  app.use(
    '/uploads',
    express.static(env.uploadsDir, {
      index: false,
      dotfiles: 'deny',
      setHeaders: (res, filePath) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const ext = path.extname(filePath).toLowerCase();
        const kind = attachmentKinds.kindOfExtension(ext);
        // Los segmentos de HLS no son adjuntos del chat y deben poder
        // reproducirse: se sirven en línea siempre.
        const isStream = ['.m3u8', '.ts', '.m4s'].includes(ext);
        if (isStream) {
          res.setHeader('Content-Disposition', 'inline');
          return;
        }
        res.setHeader(
          'Content-Disposition',
          attachmentKinds.attachmentDisposition(kind || 'file', path.basename(filePath))
        );
      },
    })
  );

  // El frontend construido, cuando va en este mismo proceso. Se monta después
  // de las rutas de la API para no pisarlas, y antes del 404.
  serveFrontend(app);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
