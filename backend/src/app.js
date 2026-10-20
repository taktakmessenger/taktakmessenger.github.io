const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');

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
  app.use(express.json({ limit: '1mb' }));
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
    res.json({
      status: 'OK',
      service: 'TAK TAK API',
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

  // Uploaded originals and their HLS renditions. Read-only.
  app.use('/uploads', express.static(env.uploadsDir, { index: false, dotfiles: 'deny' }));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
