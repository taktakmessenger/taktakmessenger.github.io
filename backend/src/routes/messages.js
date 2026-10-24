const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const multer = require('multer');
const { body, param, query } = require('express-validator');
const messages = require('../services/messageService');
const liveSockets = require('../services/liveSockets');
const env = require('../config/env');
const attachments = require('../lib/attachments');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

// Los adjuntos del chat viven en su propia subcarpeta de `uploads`. Separarlos
// de los vídeos del feed evita que un borrado o un listado de un tipo toque el
// otro, y deja claro de dónde sale cada archivo.
const CHAT_DIR = path.join(env.uploadsDir, 'chat');

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(CHAT_DIR, { recursive: true });
      cb(null, CHAT_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    // El nombre en disco es aleatorio; el original se guarda en el mensaje y es
    // el que se muestra. Así dos archivos con el mismo nombre no se pisan.
    cb(null, attachments.storedName(file.originalname));
  },
});

// El límite de multer es el mayor de los permitidos por tipo; el límite fino
// (imagen 10 MB, vídeo 50 MB…) lo aplica `validateAttachment` después, que es
// quien conoce el tipo ya clasificado.
const upload = multer({
  storage,
  limits: { fileSize: Math.max(...Object.values(attachments.MAX_BYTES)) },
});

// Every route here requires a session: messages are private by definition.
router.use(auth);

// Inbox: the caller's conversations, most recently active first.
router.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const conversations = await messages.listConversations(req.user.userId);
    res.json({ conversations });
  })
);

// Opens (or reopens) the direct conversation with another user.
router.post(
  '/conversations',
  [body('userId').isMongoId().withMessage('Usuario inválido')],
  validate,
  asyncHandler(async (req, res) => {
    const conversation = await messages.findOrCreateDirect(
      req.user.userId,
      req.body.userId
    );
    res.status(201).json({ conversationId: conversation._id });
  })
);

router.get(
  '/conversations/:id/messages',
  [
    param('id').isMongoId().withMessage('Conversación inválida'),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('before').optional().isISO8601(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const list = await messages.listMessages(req.params.id, req.user.userId, {
      limit: req.query.limit,
      before: req.query.before,
    });
    res.json({ messages: list });
  })
);

router.post(
  '/conversations/:id/messages',
  [
    param('id').isMongoId().withMessage('Conversación inválida'),
    // El texto es opcional: un mensaje puede ser solo un adjunto. Se valida
    // aquí la forma, y el servicio comprueba que hay algo que enviar (texto o
    // adjunto).
    body('text').optional().trim().isLength({ max: 2000 }).withMessage('Mensaje inválido'),
    body('attachment.kind').optional().isIn(['image', 'video', 'audio', 'file']),
    body('attachment.url').optional().isString().isLength({ max: 500 }),
    body('attachment.name').optional().isString().isLength({ max: 200 }),
    body('attachment.size').optional().isInt({ min: 0 }),
    body('attachment.durationSeconds').optional().isFloat({ min: 0 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { attachment } = req.body;

    // Un adjunto solo puede apuntar a un archivo que este servidor acaba de
    // aceptar. Sin esta comprobación, cualquiera podría publicar una URL
    // externa (o interna) como si fuera un adjunto suyo.
    if (attachment && !String(attachment.url || '').startsWith('/uploads/chat/')) {
      throw new HttpError(400, 'Adjunto inválido');
    }

    const result = await messages.sendMessage({
      conversationId: req.params.id,
      senderId: req.user.userId,
      text: req.body.text,
      attachment: attachment
        ? {
            kind: attachment.kind,
            url: attachment.url,
            name: attachment.name,
            size: attachment.size || 0,
            durationSeconds: attachment.durationSeconds || 0,
          }
        : null,
    });

    // The client posts over REST, so the fan-out has to happen here too.
    // Without it the recipient's open tab would only see the message on its
    // next poll, which defeats the point of having sockets.
    liveSockets.broadcastMessage(
      result.message,
      result.participants,
      req.user.userId
    );

    res.status(201).json(result);
  })
);

// Sube un archivo para adjuntarlo a un mensaje. Devuelve la referencia que
// luego se envía en el mensaje; no crea el mensaje por sí sola, para que el
// usuario pueda añadir un pie de foto antes de enviarlo.
router.post(
  '/attachments',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    let info;
    try {
      info = attachments.validateAttachment(req.file);
    } catch (err) {
      // El archivo ya está en disco: si no se acepta, no debe quedarse ahí.
      if (req.file?.path) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      throw new HttpError(400, err.message);
    }

    res.status(201).json({
      attachment: {
        kind: info.kind,
        // Se sirve desde `/uploads/chat/<fichero>`; el nombre visible es el
        // original ya limpio.
        url: `/uploads/chat/${path.basename(req.file.path)}`,
        name: attachments.safeName(req.file.originalname),
        size: req.file.size,
        durationSeconds: 0,
      },
    });
  })
);

router.post(
  '/conversations/:id/read',
  [param('id').isMongoId().withMessage('Conversación inválida')],
  validate,
  asyncHandler(async (req, res) => {
    const result = await messages.markRead(req.params.id, req.user.userId);

    // El emisor puede estar mirando el hilo por REST sin socket: se le avisa
    // igualmente por su sala personal para que sus ticks cambien a azul.
    if (result.readIds?.length) {
      const participants = await messages.participantsOf(req.params.id);
      for (const participant of participants) {
        if (String(participant) === String(req.user.userId)) continue;
        liveSockets.getIo()?.to(`user:${participant}`).emit('chat:read', {
          conversationId: String(req.params.id),
          by: String(req.user.userId),
          ids: result.readIds,
        });
      }
    }

    res.json(result);
  })
);

// Presencia de los participantes de un hilo, para que la cabecera pueda mostrar
// "en línea" o "última vez…" nada más abrirlo, sin esperar a un evento.
router.get(
  '/conversations/:id/presence',
  [param('id').isMongoId().withMessage('Conversación inválida')],
  validate,
  asyncHandler(async (req, res) => {
    const peers = await messages.presenceOf(req.params.id, req.user.userId);
    // "En línea" lo sabe el socket (conexiones abiertas), no la base de datos.
    const withLive = peers.map((p) => ({
      ...p,
      online: liveSockets.isOnline(p.userId),
    }));
    res.json({ peers: withLive });
  })
);

// Deja constancia de una llamada en el hilo con la otra persona, como hace
// WhatsApp. Se identifica por `peerId` y no por conversación porque la llamada
// se lanza desde el chat y puede no existir hilo previo: se crea aquí.
//
// El servidor no decide el resultado por su cuenta: el cliente que participó en
// la llamada lo reporta. Es un registro de historial, no una fuente de verdad
// para facturación, por eso no hay nada que un cliente no pudiera ya falsear
// escribiendo el mensaje a mano.
router.post(
  '/calls',
  [
    body('peerId').isMongoId().withMessage('Usuario inválido'),
    body('kind').optional().isIn(['audio', 'video']).withMessage('Tipo de llamada inválido'),
    body('status')
      .isIn(['answered', 'missed', 'declined', 'cancelled', 'unreachable'])
      .withMessage('Estado de llamada inválido'),
    body('durationSeconds').optional().isInt({ min: 0, max: 86400 }).withMessage('Duración inválida'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const conversation = await messages.findOrCreateDirect(
      req.user.userId,
      req.body.peerId
    );

    const result = await messages.recordCall({
      conversationId: conversation._id,
      senderId: req.user.userId,
      kind: req.body.kind || 'audio',
      status: req.body.status,
      durationSeconds: req.body.durationSeconds || 0,
    });

    // Igual que un mensaje: la otra persona debe ver la llamada en el hilo sin
    // recargar, y recibir el aviso si no lo tiene abierto.
    liveSockets.broadcastMessage(result.message, result.participants, req.user.userId);

    res.status(201).json(result);
  })
);

module.exports = router;
