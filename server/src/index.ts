import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import morgan from 'morgan';
import compression from 'compression';
import multer from 'multer';
import { createServer } from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Create uploads directory if it doesn't exist
const UPLOADS_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Connectivity & Security
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true
}));
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Multer Config for Local Storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Persistence Logic (MongoDB)
const VideoSchema = new mongoose.Schema({
  id: Number,
  user: String,
  title: String,
  filename: String,
  createdAt: { type: Date, default: Date.now },
  likes: { type: Number, default: 0 },
});
const VideoModel = mongoose.model('Video_Real', VideoSchema);

// Auth Middleware
function authMiddleware(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Falta autorización' });
  const token = auth.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'taktak-secure-production-key-change-me');
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token inválido' });
  }
}

// Routes
app.get('/health', (req, res) => res.json({ ok: true, status: 'Sistema VPS Real Activo' }));

// Local Video Upload Route
app.post('/api/upload', authMiddleware, upload.single('video'), async (req: any, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
  
  try {
    const lastVideo = await VideoModel.findOne().sort({ id: -1 });
    const nextId = (lastVideo?.id || 0) + 1;

    const item = new VideoModel({
      id: nextId,
      user: req.user?.sub || req.user?.email || 'anon',
      title: req.body.title || req.file.originalname,
      filename: req.file.filename,
      likes: 0,
    });
    await item.save();
    res.json({ ok: true, item });
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar video en DB' });
  }
});

// Feed endpoint
app.get('/api/feed', async (req, res) => {
  const page = Number(req.query.page || 1);
  const per = Number(req.query.per || 10);
  const skip = (page - 1) * per;

  try {
    const videos = await VideoModel.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(per);

    // Dynamic URL generation for Local Storage
    const baseUrl = process.env.BASE_URL || `http://${req.headers.host}`;
    const data = videos.map(v => ({
      id: v.id,
      title: v.title,
      videoUrl: `${baseUrl}/uploads/${v.filename}`,
      createdAt: v.createdAt,
      likes: v.likes,
    }));
    res.json({ data, page });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener feed' });
  }
});

// Like interaction
app.post('/api/interactions/like', authMiddleware, async (req, res) => {
  const { id } = req.body;
  try {
    const item = await VideoModel.findOneAndUpdate({ id }, { $inc: { likes: 1 } }, { new: true });
    if (!item) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true, likes: item.likes });
  } catch (err) {
    res.status(500).json({ error: 'Error al interactuar' });
  }
});

// Static Folders
app.use('/uploads', express.static(UPLOADS_DIR));
const distPath = path.join(__dirname, '../../dist');
app.use(express.static(distPath));

// Catch-all SPA
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.includes('.')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

// Start Server
const PORT = process.env.PORT || 3000;
const startServer = async () => {
  try {
    if (process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('✅ Conectado a MongoDB (Persistencia VPS)');
    }
    httpServer.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`🚀 TakTak VPS Real Backend corriendo en puerto ${PORT}`);
    });
  } catch (err) {
    console.error('❌ FALLO CRÍTICO:', err);
    process.exit(1);
  }
};

startServer();

export { app };
