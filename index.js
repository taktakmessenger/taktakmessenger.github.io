require('dotenv').config();
const express = require('express');
const cors = require('cors');
const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { AdesGoldWallet, ADES_GOLD, QuantumCall } = require('adesgold-wallet');

const adesGoldWallet = new AdesGoldWallet();

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'taktak-super-secret-key-2026';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Uploads directory for local direct uploads fallback
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// S3 / MinIO Client
const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
  region: process.env.S3_REGION || 'us-east-1',
});

// Multer storage for direct uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `taktak_${Date.now()}_${Math.random().toString(36).substring(2, 9)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB max

// In-Memory Seed Data (Substitutable with Postgres/Knex in production)
const users = [
  { id: 'user_1', username: 'elena_creadora', name: 'Elena Gómez', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80', bio: 'Tech & Lifestyle | Shorts diarios 🚀' },
  { id: 'user_2', username: 'carlos_dev', name: 'Carlos Tech', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80', bio: 'Frontend Dev & IA entusiasta 💻' },
  { id: 'user_3', username: 'ai_studio', name: 'TakTak AI Studio', avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80', bio: 'Contenido generado con MoneyPrinterTurbo ⚡' },
];

let feed = [
  {
    id: 1,
    userId: 'user_1',
    user: {
      username: 'elena_creadora',
      name: 'Elena Gómez',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    },
    title: '¡Descubriendo nuevas vistas en la ciudad! 🌆✨ ¿Cuál es tu rincón favorito?',
    tags: ['#lifestyle', '#cityvibes', '#taktak', '#trend'],
    soundTitle: 'Elena Gómez — Original Urban Mix (Remix)',
    soundAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-young-woman-skater-performing-a-trick-41129-large.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1517649763962-0c623266ddc0?w=600&auto=format&fit=crop&q=80',
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    likes: 1420,
    likedBy: ['demo_user'],
    shares: 88,
    comments: [
      { id: 101, username: 'carlos_dev', text: '¡Increíble toma y fluidez! 🛹', createdAt: 'Hace 1 hora' },
      { id: 102, username: 'ana_dance', text: '¡Ese truco fue genial! 🔥', createdAt: 'Hace 30 min' },
    ],
  },
  {
    id: 2,
    userId: 'user_2',
    user: {
      username: 'carlos_dev',
      name: 'Carlos Tech',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    },
    title: 'Animaciones fluidas en la nueva UI de TakTak 🚀 ¡Full responsive y 60 FPS!',
    tags: ['#coding', '#webdev', '#react', '#javascript'],
    soundTitle: 'Carlos Tech — Synthwave Coding Beats',
    soundAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-man-working-on-his-laptop-308-large.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=600&auto=format&fit=crop&q=80',
    createdAt: new Date(Date.now() - 3600000 * 8).toISOString(),
    likes: 3840,
    likedBy: [],
    shares: 312,
    comments: [
      { id: 201, username: 'elena_creadora', text: '¡Qué buena interfaz oscura!', createdAt: 'Hace 3 horas' },
    ],
  },
  {
    id: 3,
    userId: 'user_3',
    user: {
      username: 'ai_studio',
      name: 'TakTak AI Studio',
      avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
    },
    title: '🤖 Vídeo generado automáticamente con IA mediante el adaptador MoneyPrinterTurbo',
    tags: ['#aivideo', '#moneyprinterturbo', '#generativeai', '#future'],
    soundTitle: 'Cybernetic Pulse — AI Soundscape V1',
    soundAvatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-futuristic-robot-with-artificial-intelligence-50796-large.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    likes: 8910,
    likedBy: [],
    shares: 1240,
    comments: [
      { id: 301, username: 'carlos_dev', text: '¡La síntesis de voz y el corte son instantáneos!', createdAt: 'Hace 5 horas' },
    ],
  },
];
let nextId = 4;

// Auth Middleware
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) {
    // Modo tolerante para prototipo: permitir usuario anónimo si no hay header
    req.user = { sub: 'demo_user', name: 'Usuario Demo', username: 'usuario_demo' };
    return next();
  }
  const token = auth.split(' ')[1];
  if (!token || token === 'demo' || token === 'demo-token') {
    req.user = { sub: 'demo_user', name: 'Usuario Demo', username: 'usuario_demo' };
    return next();
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    // Si el token es inválido o demo, fallback a usuario demo
    req.user = { sub: 'demo_user', name: 'Usuario Demo', username: 'usuario_demo' };
    next();
  }
}

// 1. Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'TakTak API',
    version: '0.2.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// 2. Auth Endpoints - Solo Wallet AdesGold (sin correo, sin teléfono)

app.post('/api/auth/register', async (req, res) => {
  try {
    const { walletAddress, username, pinCode } = req.body;
    if (!walletAddress || !username) {
      return res.status(400).json({ ok: false, error: 'walletAddress y username son requeridos' });
    }

    const existingUser = users.find(u => u.walletAddress === walletAddress);
    if (existingUser) {
      return res.status(409).json({ ok: false, error: 'Wallet ya registrada' });
    }

    const user = {
      sub: walletAddress,
      name: username,
      username,
      walletAddress,
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
    };

    users.push(user);
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
    res.json({ ok: true, token, user, message: 'Registro exitoso. Sin correo, sin teléfono.' });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { walletAddress, pinCode } = req.body;
    if (!walletAddress) {
      return res.status(400).json({ ok: false, error: 'walletAddress requerido' });
    }

    const user = users.find(u => u.walletAddress === walletAddress);
    if (!user) {
      const anonUser = {
        sub: walletAddress,
        name: 'Usuario Anónimo',
        username: 'anon_' + walletAddress.slice(0, 8),
        walletAddress,
        avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      };
      users.push(anonUser);
      const token = jwt.sign(anonUser, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ ok: true, token, user: anonUser, isNew: true });
    }

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
    res.json({ ok: true, token, user, isNew: false });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/auth/demo', (req, res) => {
  const walletAddress = 'demo_wallet_' + crypto.randomBytes(8).toString('hex');
  const user = {
    sub: walletAddress,
    name: 'Usuario Demo',
    username: 'demo_' + walletAddress.slice(0, 8),
    walletAddress,
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
  };
  users.push(user);
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
  res.json({ ok: true, token, user, message: 'Acceso demo sin datos personales' });
});

// 3. S3 Presigned URL for upload
app.post('/api/presign', authMiddleware, async (req, res) => {
  const { filename, contentType } = req.body;
  if (!filename) return res.status(400).json({ error: 'filename is required' });

  const cleanName = filename.replace(/\s+/g, '_');
  const key = `uploads/${Date.now()}_${cleanName}`;
  const bucket = process.env.S3_BUCKET || 'taktak-videos';

  const params = {
    Bucket: bucket,
    Key: key,
    Expires: 60 * 10, // 10 minutes
    ContentType: contentType || 'video/mp4',
  };

  try {
    const url = await s3.getSignedUrlPromise('putObject', params);
    return res.json({ url, key, bucket });
  } catch (err) {
    console.warn('Presign warning (MinIO may be offline, use direct fallback):', err.message);
    return res.json({
      url: `/api/upload-direct`,
      key,
      fallbackDirect: true,
      message: 'MinIO no accesible directamente en este puerto; use fallback multipart /api/upload-direct',
    });
  }
});

// 4. Direct Upload Fallback (Multipart form-data)
app.post('/api/upload-direct', authMiddleware, upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  const { title, tags, soundTitle } = req.body;
  const host = req.get('host');
  const protocol = req.protocol;
  const videoUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

  const parsedTags = tags ? tags.split(/[\s,]+/).filter(t => t.startsWith('#') || t.length > 0).map(t => t.startsWith('#') ? t : `#${t}`) : ['#taktak', '#short'];

  const newItem = {
    id: nextId++,
    userId: req.user.sub,
    user: {
      username: req.user.username || 'usuario_demo',
      name: req.user.name || 'Usuario Demo',
      avatar: req.user.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
    },
    title: title || 'Nuevo vídeo en TakTak',
    tags: parsedTags,
    soundTitle: soundTitle || `${req.user.name || 'Usuario'} — Sonido original`,
    soundAvatar: req.user.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
    videoUrl: videoUrl,
    thumbnailUrl: '',
    createdAt: new Date().toISOString(),
    likes: 0,
    likedBy: [],
    shares: 0,
    comments: [],
  };

  feed.unshift(newItem);
  res.json({ ok: true, item: newItem });
});

// 5. Upload Complete (Notified after S3 PUT)
app.post('/api/upload-complete', authMiddleware, (req, res) => {
  const { key, title, tags, soundTitle, directUrl } = req.body;
  if (!key && !directUrl) return res.status(400).json({ error: 'key or directUrl required' });

  const bucket = process.env.S3_BUCKET || 'taktak-videos';
  const s3Endpoint = process.env.S3_ENDPOINT || 'http://localhost:9000';
  const videoUrl = directUrl || `${s3Endpoint}/${bucket}/${key}`;

  const parsedTags = tags ? (Array.isArray(tags) ? tags : tags.split(/[\s,]+/)) : ['#taktak'];

  const item = {
    id: nextId++,
    userId: req.user.sub,
    user: {
      username: req.user.username || 'usuario_demo',
      name: req.user.name || 'Usuario Demo',
      avatar: req.user.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
    },
    title: title || 'Mi vídeo TakTak',
    tags: parsedTags,
    soundTitle: soundTitle || `${req.user.name || 'Usuario'} — Sonido original`,
    soundAvatar: req.user.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
    videoUrl,
    videoKey: key,
    thumbnailUrl: '',
    createdAt: new Date().toISOString(),
    likes: 0,
    likedBy: [],
    shares: 0,
    comments: [],
  };

  feed.unshift(item);
  res.json({ ok: true, item });
});

// 6. Feed Endpoint (Paginated & Filterable)
app.get('/api/feed', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const per = Math.min(50, Math.max(1, Number(req.query.per) || 10));
  const tag = req.query.tag;
  const userId = req.query.userId;

  let filtered = [...feed];

  if (tag) {
    filtered = filtered.filter(v => v.tags && v.tags.some(t => t.toLowerCase() === tag.toLowerCase()));
  }
  if (userId) {
    filtered = filtered.filter(v => v.userId === userId);
  }

  const start = (page - 1) * per;
  const slice = filtered.slice(start, start + per);

  res.json({
    data: slice,
    page,
    perPage: per,
    total: filtered.length,
    hasMore: start + per < filtered.length,
  });
});

// 7. Feed Compatibility Route (/feed)
app.get('/feed', (req, res) => {
  res.redirect(307, '/api/feed');
});

// 8. Interactions: Like Toggle
app.post('/api/interactions/like', authMiddleware, (req, res) => {
  const { id } = req.body;
  const videoId = Number(id);
  const item = feed.find(f => f.id === videoId);

  if (!item) return res.status(404).json({ error: 'Video not found' });

  const userId = req.user.sub;
  if (!item.likedBy) item.likedBy = [];

  const index = item.likedBy.indexOf(userId);
  let isLiked = false;

  if (index >= 0) {
    item.likedBy.splice(index, 1);
    item.likes = Math.max(0, (item.likes || 1) - 1);
    isLiked = false;
  } else {
    item.likedBy.push(userId);
    item.likes = (item.likes || 0) + 1;
    isLiked = true;
  }

  res.json({ ok: true, likes: item.likes, isLiked });
});

// 9. Interactions: Add Comment & List Comments
app.post('/api/interactions/comment', authMiddleware, (req, res) => {
  const { id, text } = req.body;
  const videoId = Number(id);
  const item = feed.find(f => f.id === videoId);

  if (!item) return res.status(404).json({ error: 'Video not found' });
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text required' });

  if (!item.comments) item.comments = [];

  const newComment = {
    id: Date.now(),
    username: req.user.username || 'usuario_demo',
    text: text.trim(),
    createdAt: 'Justo ahora',
  };

  item.comments.unshift(newComment);
  res.json({ ok: true, comment: newComment, totalComments: item.comments.length });
});

// 10. Interactions: Share
app.post('/api/interactions/share', (req, res) => {
  const { id } = req.body;
  const videoId = Number(id);
  const item = feed.find(f => f.id === videoId);

  if (!item) return res.status(404).json({ error: 'Video not found' });
  item.shares = (item.shares || 0) + 1;
  res.json({ ok: true, shares: item.shares });
});

// 11. AI Video Generator Adapter (MoneyPrinterTurbo / Pixelle adapter)
app.post('/api/ai/generate', authMiddleware, async (req, res) => {
  const { prompt, style, duration } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

  // Simulación del ciclo de generación con MoneyPrinterTurbo
  // En producción, esto invoca al worker Python/Docker y devuelve el stream HLS/MP4
  const generatedId = nextId++;
  const aiSamples = [
    'https://assets.mixkit.co/videos/preview/mixkit-futuristic-robot-with-artificial-intelligence-50796-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-hands-holding-a-smartphone-with-a-green-screen-40742-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-neon-lights-in-the-streets-of-a-night-city-43180-large.mp4',
  ];
  const chosenVideo = aiSamples[Math.floor(Math.random() * aiSamples.length)];

  const aiVideo = {
    id: generatedId,
    userId: 'user_3',
    user: {
      username: 'ai_studio',
      name: 'TakTak AI Studio',
      avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
    },
    title: `✨ AI: "${prompt.slice(0, 70)}${prompt.length > 70 ? '...' : ''}"`,
    tags: ['#aigenerated', '#moneyprinterturbo', '#short', '#taktak'],
    soundTitle: 'AI Generated Voiceover & Cyber Ambient',
    soundAvatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
    videoUrl: chosenVideo,
    thumbnailUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
    createdAt: new Date().toISOString(),
    likes: 1,
    likedBy: [req.user.sub],
    shares: 0,
    comments: [
      { id: Date.now(), username: 'ai_studio', text: '¡Vídeo sintetizado con MoneyPrinterTurbo v2!', createdAt: 'Justo ahora' },
    ],
  };

  feed.unshift(aiVideo);
  res.json({
    ok: true,
    message: 'Vídeo generado con éxito por el adaptador de IA',
    video: aiVideo,
  });
});

// ========== AdesGold Wallet Endpoints ==========

// Wallet: Create Master Wallet (cuenta madre)
app.post('/api/wallet/create', (req, res) => {
  const { username, pinCode } = req.body;
  try {
    const wallet = adesGoldWallet.createMasterWallet(username, pinCode || crypto.randomInt(0, 1000000).toString().padStart(6, '0'));
    const { pinCodeHash, ...safeWallet } = wallet;
    res.json({
      ok: true,
      wallet: safeWallet,
      message: 'Cuenta madre creada. 30% de tokens asignados a cuentas madre, 70% a ecosistema',
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Wallet: Authenticate
app.post('/api/wallet/authenticate', (req, res) => {
  const { seedPhrase, pinCode } = req.body;
  try {
    const wallet = adesGoldWallet.authenticate(seedPhrase, pinCode);
    if (!wallet) {
      return res.status(401).json({ ok: false, error: 'Autenticación fallida: PIN o frases incorrectas' });
    }
    const { pinCodeHash, ...safeWallet } = wallet;
    res.json({ ok: true, wallet: safeWallet });
  } catch (err) {
    res.status(401).json({ ok: false, error: err.message });
  }
});

// Wallet: Get balance
app.get('/api/wallet/balance/:address', (req, res) => {
  const address = req.params.address;
  const balance = adesGoldWallet.getBalance(address);
  const distribution = adesGoldWallet.getTokenDistribution();
  res.json({
    address,
    balance: balance.toString(),
    denom: ADES_GOLD.DENOM,
    distribution,
  });
});

// Wallet: Swap / Exchange
app.post('/api/wallet/swap', async (req, res) => {
  try {
    const tx = await adesGoldWallet.swap(req.body.sender, req.body.fromDenom, req.body.toDenom, req.body.amount);
    res.json({ ok: true, transaction: tx });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Wallet: Buy ADG
app.post('/api/wallet/buy', async (req, res) => {
  try {
    const tx = await adesGoldWallet.buy(req.body.buyer, req.body.amount, req.body.paymentDenom);
    res.json({ ok: true, transaction: tx });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Wallet: Sell ADG
app.post('/api/wallet/sell', async (req, res) => {
  try {
    const tx = await adesGoldWallet.sell(req.body.seller, req.body.amount, req.body.targetDenom);
    res.json({ ok: true, transaction: tx });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Wallet: Send
app.post('/api/wallet/send', async (req, res) => {
  try {
    const tx = await adesGoldWallet.send(req.body.sender, req.body.recipient, req.body.amount, req.body.denom || ADES_GOLD.DENOM);
    res.json({ ok: true, transaction: tx });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Wallet: Receive
app.post('/api/wallet/receive', async (req, res) => {
  try {
    const tx = await adesGoldWallet.receive(req.body.sender, req.body.receiver, req.body.amount, req.body.denom || ADES_GOLD.DENOM);
    res.json({ ok: true, transaction: tx });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Wallet: Mine AdesGold
app.post('/api/wallet/mine', (req, res) => {
  const { minerAddress } = req.body;
  try {
    const result = adesGoldWallet.mineBlock(minerAddress);
    if (!result) {
      return res.status(200).json({ ok: true, message: 'Minado no exitoso (PoW no alcanzado)' });
    }
    res.json({ ok: true, result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Wallet: Transaction history
app.get('/api/wallet/transactions/:address', (req, res) => {
  const address = req.params.address;
  const txs = adesGoldWallet.getTransactions(address);
  res.json({ transactions: txs });
});

// Wallet: Exchange statistics
app.get('/api/wallet/stats', (req, res) => {
  const stats = adesGoldWallet.getExchangeStats();
  res.json(stats);
});

// Wallet: Token distribution
app.get('/api/wallet/distribution', (req, res) => {
  const distribution = adesGoldWallet.getTokenDistribution();
  res.json(distribution);
});

// Wallet: Master wallets list
app.get('/api/wallet/master-wallets', (req, res) => {
  const wallets = adesGoldWallet.getAllMasterWallets();
  res.json({ wallets, count: wallets.length });
});

// Wallet: Mining stats
app.get('/api/wallet/mining-stats', (req, res) => {
  res.json({
    totalBlocksMined: adesGoldWallet.getTotalBlocksMined(),
    totalMinted: adesGoldWallet.totalMinted(),
    totalSupply: ADES_GOLD.TOTAL_SUPPLY,
    rewardPerBlock: ADES_GOLD.INITIAL_REWARD_PER_BLOCK,
    miningRewardShare: ADES_GOLD.MINING_REWARD_SHARE,
    treasuryRewardShare: ADES_GOLD.TREASURY_REWARD_SHARE,
    masterWalletAddress: adesGoldWallet.getMasterWalletAddress(),
  });
});

// ========== QuantumCall Endpoints ==========

app.post('/api/call/initiate', authMiddleware, (req, res) => {
  try {
    const { calleeAddress, type, transport } = req.body;
    const callerAddress = req.user.walletAddress || req.user.sub;
    if (!callerAddress || !calleeAddress) {
      return res.status(400).json({ ok: false, error: 'callerAddress y calleeAddress requeridos' });
    }
    const quantumCall = new QuantumCall();
    quantumCall.bindWallet(callerAddress);
    const session = quantumCall.initiateCall(calleeAddress, type, transport);
    if (!session) {
      return res.status(400).json({ ok: false, error: 'No se pudo iniciar la llamada' });
    }
    res.json({ ok: true, session });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/call/answer', authMiddleware, (req, res) => {
  try {
    const { callId } = req.body;
    const calleeAddress = req.user.walletAddress || req.user.sub;
    const quantumCall = new QuantumCall();
    quantumCall.bindWallet(calleeAddress);
    const session = quantumCall.answerCall(callId);
    if (!session) {
      return res.status(400).json({ ok: false, error: 'No se pudo responder la llamada' });
    }
    res.json({ ok: true, session });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/call/end', authMiddleware, (req, res) => {
  try {
    const { callId } = req.body;
    const quantumCall = new QuantumCall();
    const session = quantumCall.endCall(callId);
    if (!session) {
      return res.status(400).json({ ok: false, error: 'No se pudo finalizar la llamada' });
    }
    res.json({ ok: true, session });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/call/history', authMiddleware, (req, res) => {
  try {
    const quantumCall = new QuantumCall();
    const history = quantumCall.getCallHistory();
    res.json({ calls: history });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/call/security', authMiddleware, (req, res) => {
  try {
    const quantumCall = new QuantumCall();
    const security = quantumCall.getSecurityStatus();
    res.json(security);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 TakTak API corriendo en puerto ${PORT}`);
  console.log(`📡 S3 Endpoint: ${process.env.S3_ENDPOINT || 'http://localhost:9000'}`);
  console.log(`🎬 Seed videos cargados: ${feed.length}`);
  console.log(`=========================================`);
});
