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
const postRoutes = require('./routes/posts');
const listingRoutes = require('./routes/listings');
const { notFound, errorHandler } = require('./middleware/errorHandler');

// Built as a factory so tests can mount the app without starting a listener.
function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  // CSP a medida. La de helmet por defecto trae `default-src 'self'` sin
  // excepciones, y eso rompe dos cosas que la app sí necesita:
  //
  //  - `media-src`: hls.js no reproduce HLS con un `<video src="...m3u8">`, sino
  //    que descarga los segmentos y los sirve a través de un Blob. Con
  //    `default-src 'self'` el navegador bloquea `blob:` y **ningún vídeo
  //    transcodificado se ve**. Es el fallo más caro de esta lista porque el
  //    feed entero es vídeo.
  //  - `script-src`: Stripe y el botón de Google cargan sus scripts desde sus
  //    dominios; sin ellos no hay compra de monedas ni alta con Google.
  //
  // El resto se queda tan cerrado como lo deja helmet: nada de `unsafe-eval`,
  // `object-src 'none'` y `frame-ancestors 'self'`. Los datos (`data:`) solo se
  // permiten para imágenes y fuentes, no para scripts.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          objectSrc: ["'none'"],
          // hls.js adjunta los segmentos por Blob, y las previews de subida son
          // object URLs del propio archivo elegido.
          mediaSrc: ["'self'", 'blob:', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'https:', 'data:'],
          styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
          scriptSrc: ["'self'", 'https://js.stripe.com', 'https://accounts.google.com', 'https://connect.facebook.net'],
          scriptSrcAttr: ["'none'"],
          // Stripe monta sus campos en un iframe propio.
          frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
          connectSrc: [
            "'self'",
            'https://api.stripe.com',
            'https://accounts.google.com',
            // El SDK de Facebook valida la sesión y abre el diálogo de
            // autorización contra estos dos hosts; sin ellos el botón falla en
            // el navegador aunque el backend esté bien.
            'https://graph.facebook.com',
            'https://www.facebook.com',
            'wss:',
          ],
          workerSrc: ["'self'", 'blob:'],
          upgradeInsecureRequests: [],
        },
      },
    })
  );
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
  app.use('/api/posts', postRoutes);
  app.use('/api/listings', listingRoutes);

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
