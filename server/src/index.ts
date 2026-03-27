import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import messageRoutes from './routes/messages.js';
import chatRoutes from './routes/chats.js';
import callRoutes from './routes/calls.js';
import adminRoutes from './routes/admin.js';
import paymentRoutes from './routes/payments.js';
import videoRoutes from './routes/videos.js';
import reportRoutes from './routes/reports.js';

import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { connectDB } from './config/database.js';
import { setupSocketHandlers } from './services/socket.js';
import { TrackerService } from './services/p2pTracker.js';
import { miningService } from './services/mining.js';
import { startP2PNode } from './p2p/node.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST']
  }
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Permitir que el túnel cargue recursos sin restricciones de CSP por ahora
}));
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: { error: 'Demasiadas solicitudes, intenta más tarde' }
});
app.use('/api', limiter);

// RPC Security: Whitelisting & JWT (Industrial Grade)
const ALLOWED_RPC_IPS = ['127.0.0.1', '::1']; // Agrega IPs de servidores TakTak aquí
const rpcSecurity = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const clientIp = req.ip || req.socket.remoteAddress || '';
  const isLocal = ALLOWED_RPC_IPS.some(ip => clientIp.includes(ip));
  
  // Si no es local, requerir JWT TakTak de Grado Industrial
  if (!isLocal) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Acceso RPC denegado: Se requiere JWT Taktaknew' });
    }
    // Verificación interna de JWT para el ecosistema
    try {
      jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'taktak-secret-key');
    } catch (err) {
      return res.status(401).json({ error: 'Token RPC inválido' });
    }
  }
  next();
};

app.use('/rpc', rpcSecurity);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Compression
app.use(compression());

// Logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    distPath: path.join(__dirname, '../../dist')
  });
});

// Serve Static Files (Production)
const distPath = path.join(__dirname, '../../dist');
app.use(express.static(distPath));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/reports', reportRoutes);

// Static files for uploads
app.use('/uploads', express.static('uploads'));

// Static downloads route
app.use('/api/downloads', express.static('public/downloads'));

// Catch-all for SPA
app.get('*', (req, res, next) => {
  // If it's an /api or /rpc route, or looks like a file (has an extension), don't serve index.html
  if (
    req.path.startsWith('/api') || 
    req.path.startsWith('/rpc') || 
    req.path.includes('.')
  ) {
    return next();
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

// Error handling
app.use(notFound);
app.use(errorHandler);

// Socket.io setup
setupSocketHandlers(io);

// Start server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    // Connect to MongoDB
    if (process.env.MONGODB_URI) {
      await connectDB();
      console.log('✅ Conectado a MongoDB');
      
      // Initialize Genesis Supply for TakTak Coin
      await miningService.initializeGenesis();
    } else {
      console.log('⚠️ MongoDB no configurado, modo offline');
    }

    httpServer.listen(PORT, async () => {
      new TrackerService(httpServer);
      
      // Initialize TakTak P2P Node
      try {
        await startP2PNode();
      } catch (err) {
        console.error('Error starting TakTak P2P Node:', err);
      }

      console.log(`
🚀 Servidor Taktaknew corriendo en puerto ${PORT}
📱 Environment: ${process.env.NODE_ENV || 'development'}
🔐 Encriptación: E2E activa
🛰️ P2P Tracker: Activo
🚀 Ciclo de Minado: Iniciado (10 min)
      `);

      // Start Reward Cycle Interval (Every 10 minutes)
      setInterval(() => {
        miningService.runRewardCycle(1000).catch(err => console.error('Mining Cycle Error:', err));
      }, 10 * 60 * 1000);
    });
  } catch (error) {
    console.error('❌ Error al iniciar servidor:', error);
    process.exit(1);
  }
};

startServer();

export { app, io };
