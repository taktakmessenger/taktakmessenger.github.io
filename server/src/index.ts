import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import morgan from 'morgan';
import compression from 'compression';
import AWS from 'aws-sdk';
import { createServer } from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Connectivity & Security (KEEPING INTACT)
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Config S3 / MinIO
const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
  region: process.env.S3_REGION || 'us-east-1',
});

// Simple Persistence Logic (Using MongoDB)
const VideoSchema = new mongoose.Schema({
  id: Number,
  user: String,
  title: String,
  videoKey: String,
  createdAt: { type: Date, default: Date.now },
  likes: { type: Number, default: 0 },
});
const VideoModel = mongoose.model('Video_Simple', VideoSchema);

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
app.get('/health', (req, res) => res.json({ ok: true, status: 'Sistema Real Activo' }));

// Presigned URL for upload
app.post('/api/presign', authMiddleware, async (req, res) => {
  const { filename, contentType } = req.body;
  if (!filename) return res.status(400).json({ error: 'Nombre de archivo requerido' });

  const key = `uploads/${Date.now()}_${filename}`;
  const params = {
    Bucket: process.env.S3_BUCKET || 'taktak-videos',
    Key: key,
    Expires: 60 * 5,
    ContentType: contentType || 'application/octet-stream',
  };
  try {
    const url = await s3.getSignedUrlPromise('putObject', params);
    return res.json({ url, key });
  } catch (err) {
    console.error('Error en presign:', err);
    return res.status(500).json({ error: 'Fallo al generar URL firmada' });
  }
});

// Notify upload complete
app.post('/api/upload-complete', authMiddleware, async (req: any, res) => {
  const { key, title } = req.body;
  if (!key) return res.status(400).json({ error: 'Key requerida' });
  
  try {
    const lastVideo = await VideoModel.findOne().sort({ id: -1 });
    const nextId = (lastVideo?.id || 0) + 1;

    const item = new VideoModel({
      id: nextId,
      user: req.user?.sub || req.user?.email || 'anon',
      title: title || '',
      videoKey: key,
      likes: 0,
    });
    await item.save();
    res.json({ ok: true, item });
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar video' });
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

    const data = videos.map(v => ({
      id: v.id,
      title: v.title,
      videoUrl: `${process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT}/${process.env.S3_BUCKET || 'taktak-videos'}/${v.videoKey}`,
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

// Static Files & SPA
const distPath = path.join(__dirname, '../../dist');
app.use(express.static(distPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.includes('.')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

// Start Server
const PORT = process.env.PORT || 3000;
const startServer = async () => {
  try {
    if (process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('✅ Conectado a MongoDB (Persistencia Real)');
    }
    httpServer.listen(PORT, () => {
      console.log(`🚀 TakTak Real Backend corriendo en puerto ${PORT}`);
      console.log(`📱 Cliente configurado para: ${process.env.CLIENT_URL}`);
    });
  } catch (err) {
    console.error('❌ FALLO CRÍTICO:', err);
    process.exit(1);
  }
};

startServer();

export { app };
