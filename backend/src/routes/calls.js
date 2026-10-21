const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const env = require('../config/env');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');
const User = require('../models/User');
const phoneService = require('../services/phoneService');
const voiceService = require('../services/voiceService');
const smsService = require('../services/smsService');

const router = express.Router();

// Marcar cuesta dinero real (red telefónica) o, como mínimo, molesta a alguien
// a las tres de la mañana. Lleva su propio límite, más estrecho que el general.
// En tests se salta: una suite legítima hace más peticiones que una persona.
const dialLimiter = env.isTest
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Demasiadas llamadas seguidas, espera un momento' },
    });

// El endpoint de TwiML lo llama Twilio, no el navegador, así que no puede ir
// con sesión. Se protege con la firma de Twilio (ver el handler).
//
// La URL que se firma es la configurada en la TwiML App (`APP_URL`), no la que
// reconstruyamos del `Host`: detrás de un proxy el protocolo y el host de la
// petición pueden no coincidir con la URL pública, y Twilio firma exactamente
// la que tiene configurada. Reconstruirla daría una firma que nunca valida.
function publicTwimlUrl() {
  return `${String(env.appUrl).replace(/\/$/, '')}/api/calls/twiml`;
}

// Configuración ICE para las llamadas WebRTC.
//
// Va con sesión a propósito: las credenciales de TURN permiten retransmitir
// tráfico por el servidor, así que no deben estar al alcance de cualquiera. Un
// visitante anónimo no puede llamar, luego no necesita esta lista.
//
// Se sirve desde el backend y no desde el bundle para poder rotar el TURN sin
// reconstruir el frontend y para que las credenciales caduquen por entorno.
router.get(
  '/ice',
  auth,
  asyncHandler(async (req, res) => {
    res.json({
      iceServers: env.iceServers,
      // Permite a la UI avisar de que las llamadas pueden cortarse fuera de la
      // red local cuando no hay TURN configurado.
      hasTurn: env.iceServers.some((server) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some((url) => typeof url === 'string' && url.startsWith('turn'));
      }),
    });
  })
);

// ---------------------------------------------------------------------------
// Llamadas a teléfonos que NO tienen TAK TAK (red telefónica)
// ---------------------------------------------------------------------------

// ¿Se puede llamar a un teléfono normal desde aquí? El marcador lo consulta
// para decidir si ofrece "llamar por teléfono" o el marcador nativo.
router.get(
  '/voice',
  auth,
  asyncHandler(async (req, res) => {
    res.json({
      available: voiceService.isConfigured(),
      // Lo que se le muestra a quien recibe la llamada. Se enmascara: es un
      // dato de la plataforma, no del usuario, pero tampoco hace falta entero.
      callerId: env.twilioVoiceFromNumber
        ? phoneService.maskPhone(env.twilioVoiceFromNumber)
        : null,
      costPerMinute: env.voiceCostPerMinute,
      tokenTtlSeconds: voiceService.TOKEN_TTL_SECONDS,
    });
  })
);

// Token de acceso del navegador para marcar por Twilio Voice. La identidad va
// atada al usuario autenticado, nunca al cuerpo de la petición: si el cliente
// eligiera la identidad, cualquiera podría llamar haciéndose pasar por otro.
router.post(
  '/token',
  auth,
  dialLimiter,
  asyncHandler(async (req, res) => {
    if (!voiceService.isConfigured()) {
      throw new HttpError(503, 'Las llamadas a teléfonos no están disponibles');
    }

    res.json({
      token: voiceService.createVoiceToken(req.user.userId),
      identity: String(req.user.userId),
      ttlSeconds: voiceService.TOKEN_TTL_SECONDS,
    });
  })
);

// TwiML que Twilio pide cuando el navegador marca. Decide a qué número se
// llama, así que sin la firma de Twilio cualquiera podría usar este endpoint
// para llamar a números de tarificación especial a nuestra costa.
//
// El `<Dial><Number>` conecta la pata del navegador (quien llama) con el
// teléfono marcado: eso es lo que hace sonar un teléfono normal sin que tenga
// la app. Twilio reenvía aquí el `To` que pidió el cliente al marcar.
router.post('/twiml', (req, res) => {
  const signature = req.get('X-Twilio-Signature');

  if (
    !voiceService.isValidTwilioSignature({
      signature,
      url: publicTwimlUrl(),
      params: req.body,
    })
  ) {
    return res.status(403).send('Firma inválida');
  }

  const to = req.body?.To;
  if (!to || typeof to !== 'string') {
    return res.status(400).send('Falta el número de destino');
  }

  res.type('text/xml').send(voiceService.dialTwiml(to));
});

// Invita por SMS a un número que no tiene la app. No se puede videollamar a
// quien no tiene dónde recibir la invitación, así que lo útil es mandarle el
// enlace para que la instale.
router.post(
  '/invite',
  auth,
  dialLimiter,
  [
    body('phone').trim().notEmpty().withMessage('Número de teléfono requerido'),
    body('message').optional().trim().isLength({ max: 160 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const e164 = phoneService.normalizePhone(req.body.phone, req.body.country);

    // Si ya tiene cuenta, invitarla no tiene sentido: para eso está llamarla.
    // Se comprueba con el número ya normalizado, así que no se filtra nada de
    // quien no está registrado más allá de "no existe", que es lo que el
    // usuario ya sabe.
    const existing = await User.findOne({ phone: e164 }).select('_id');
    if (existing) {
      throw new HttpError(409, 'Ese número ya tiene cuenta: puedes llamarle directamente');
    }

    const inviter = await User.findById(req.user.userId).select('username');
    const link = `${String(env.appUrl).replace(/\/$/, '')}/?invitado=${e164}`;
    const body_ =
      req.body.message?.trim() ||
      `@${inviter?.username || 'Alguien'} te invita a TAK TAK, la app de vídeo con llamadas. Únete: ${link}`;

    const { delivered, reason } = await smsService.sendSms({ to: e164, body: body_ });

    res.status(201).json({
      sent: true,
      delivered,
      reason,
      // Se devuelve el enlace para que, si no hay proveedor de SMS, el usuario
      // pueda copiarlo y compartirlo por otro medio en vez de quedarse a medias.
      inviteLink: link,
      to: phoneService.maskPhone(e164),
    });
  })
);

module.exports = router;