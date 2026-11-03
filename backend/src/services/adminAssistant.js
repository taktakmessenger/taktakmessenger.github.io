const env = require('../config/env');
const User = require('../models/User');
const Video = require('../models/Video');
const Report = require('../models/Report');
const Transaction = require('../models/Transaction');
const walletService = require('../services/walletService');
const manualPaymentService = require('../services/manualPaymentService');
const assistantClient = require('./assistantClient');

// Asistente conversacional del administrador.
//
// A diferencia del asistente de pagos (que solo propone), este ejecuta acciones
// reales a petición del administrador: consultar cuentas, aprobar vídeos,
// acreditar monedas o resolver reportes. Por eso vive detrás de `requireAdmin`
// y nunca se expone a cuentas normales: es una herramienta del dueño, no una
// función pública.
//
// El modelo no toca la base de datos directamente. Se le dan "herramientas"
// (function calling) y él pide llamarlas; este módulo las ejecuta y le devuelve
// el resultado. Toda acción queda así en un único sitio auditable, y el modelo
// no puede inventarse un dato ni una operación que no exista.

const MAX_TOOL_ROUNDS = 6;

function isConfigured() {
  return assistantClient.isConfigured();
}

/* ------------------------------------------------------------------ */
/* Herramientas                                                        */
/* ------------------------------------------------------------------ */

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'buscar_usuario',
      description:
        'Busca cuentas por nombre de usuario o correo (coincidencia parcial). Devuelve id, usuario, correo, rol, saldo y estado.',
      parameters: {
        type: 'object',
        properties: {
          termino: { type: 'string', description: 'Texto a buscar en usuario o correo' },
        },
        required: ['termino'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'estadisticas',
      description:
        'Resumen del estado del sistema: usuarios, vídeos, pendientes, transacciones e ingresos.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'videos_pendientes',
      description: 'Lista los vídeos en espera de moderación, con id, autor y título.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'aprobar_video',
      description: 'Aprueba un vídeo pendiente para que se publique. Requiere el id del vídeo.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'id del vídeo' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rechazar_video',
      description: 'Rechaza un vídeo pendiente. Requiere el id del vídeo y un motivo.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          motivo: { type: 'string', description: 'Motivo del rechazo' },
        },
        required: ['id', 'motivo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reportes_abiertos',
      description:
        'Lista los reportes de usuarios sin resolver, con id, tipo, motivo y objeto reportado.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resolver_reporte',
      description: 'Marca un reporte como atendido (actioned) o descartado (dismissed), con una nota.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          decision: { type: 'string', enum: ['actioned', 'dismissed'] },
          nota: { type: 'string' },
        },
        required: ['id', 'decision'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'acreditar_monedas',
      description:
        'Suma monedas al saldo de un usuario como ajuste manual (bonusC por defecto). Requiere id de usuario y cantidad. Queda registrado en el libro de transacciones.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'id del usuario' },
          cantidad: { type: 'number', description: 'Monedas a sumar (negativa para restar)' },
          bucket: { type: 'string', enum: ['bonusC', 'ttcC', 'ttcR'] },
        },
        required: ['id', 'cantidad'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pagos_pendientes',
      description: 'Lista las órdenes de pago manual pendientes de revisión.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'revisar_pagos',
      description: 'Pide al asistente de pagos una sugerencia para cada orden manual pendiente.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const SYSTEM_PROMPT = `Eres el asistente interno de TAK TAK, una app de vídeos con monedas TTC.
Hablas SOLO con el administrador (el dueño de la app). Puedes consultar datos y ejecutar acciones reales mediante las herramientas disponibles.

Cómo trabajar:
- Cuando el administrador pida algo, usa las herramientas que necesites antes de responder. No inventes datos: si no lo has consultado, dilo.
- Si una acción es irreversible o mueve dinero (acreditar monedas, aprobar/rechazar vídeos, resolver reportes), confirma en tu respuesta qué has hecho exactamente y con qué ids.
- Si la petición es ambigua o falta un dato (por ejemplo el id), pregunta en vez de adivinar.
- Responde en español, breve y claro, en texto normal (no JSON).

Los ids son cadenas largas de MongoDB. Cuando el administrador se refiera a "ese usuario" o "ese vídeo", busca primero para obtener el id correcto.`;

/* ------------------------------------------------------------------ */
/* Ejecución de herramientas                                           */
/* ------------------------------------------------------------------ */

async function runTool(name, args) {
  switch (name) {
    case 'buscar_usuario': {
      const term = String(args.termino || '').trim();
      if (!term) return { error: 'Falta el término de búsqueda' };
      const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const users = await User.find({ $or: [{ username: rx }, { email: rx }] })
        .limit(10)
        .select('username email role wallet phone emailVerified');
      return {
        usuarios: users.map((u) => ({
          id: u._id.toString(),
          username: u.username,
          email: u.email,
          role: u.role,
          saldo: u.wallet,
          telefono: u.phone || null,
          emailVerificado: Boolean(u.emailVerified),
        })),
      };
    }

    case 'estadisticas': {
      const [users, videos, pendingVideos, transactions, earnings] = await Promise.all([
        User.countDocuments(),
        Video.countDocuments(),
        Video.countDocuments({ moderationStatus: 'pending' }),
        Transaction.countDocuments(),
        walletService.getPlatformEarnings(),
      ]);
      return {
        usuarios: users,
        videos,
        videosPendientes: pendingVideos,
        transacciones: transactions,
        ingresosPlataforma: earnings.total,
        regalosProcesados: earnings.gifts,
      };
    }

    case 'videos_pendientes': {
      const videos = await Video.find({ moderationStatus: 'pending' })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('creator', 'username')
        .select('title createdAt');
      return {
        videos: videos.map((v) => ({
          id: v._id.toString(),
          titulo: v.title || '(sin título)',
          autor: v.creator?.username || 'desconocido',
          creado: v.createdAt,
        })),
      };
    }

    case 'aprobar_video': {
      const video = await Video.findByIdAndUpdate(
        args.id,
        { moderationStatus: 'approved', moderatedAt: new Date(), moderatedBy: args.adminId },
        { new: true }
      );
      if (!video) return { error: 'Vídeo no encontrado' };
      return { ok: true, id: video._id.toString(), estado: video.moderationStatus };
    }

    case 'rechazar_video': {
      const video = await Video.findByIdAndUpdate(
        args.id,
        {
          moderationStatus: 'rejected',
          moderationNote: String(args.motivo || '').slice(0, 300),
          moderatedAt: new Date(),
          moderatedBy: args.adminId,
        },
        { new: true }
      );
      if (!video) return { error: 'Vídeo no encontrado' };
      return { ok: true, id: video._id.toString(), estado: video.moderationStatus };
    }

    case 'reportes_abiertos': {
      const reports = await Report.find({ status: 'open' }).sort({ createdAt: -1 }).limit(20);
      return {
        reportes: reports.map((r) => ({
          id: r._id.toString(),
          tipo: r.targetType,
          motivo: r.reason,
          detalles: r.details || null,
          objetoId: r.targetId?.toString(),
        })),
      };
    }

    case 'resolver_reporte': {
      if (!['actioned', 'dismissed'].includes(args.decision)) {
        return { error: 'Decisión inválida: usa actioned o dismissed' };
      }
      const report = await Report.findByIdAndUpdate(
        args.id,
        {
          status: args.decision,
          resolutionNote: String(args.nota || '').slice(0, 500),
          reviewedBy: args.adminId,
          reviewedAt: new Date(),
        },
        { new: true }
      );
      if (!report) return { error: 'Reporte no encontrado' };
      return { ok: true, id: report._id.toString(), estado: report.status };
    }

    case 'acreditar_monedas': {
      const bucket = ['bonusC', 'ttcC', 'ttcR'].includes(args.bucket) ? args.bucket : 'bonusC';
      const amount = Number(args.cantidad);
      if (!Number.isFinite(amount) || amount === 0) {
        return { error: 'Cantidad inválida' };
      }
      const user = await User.findByIdAndUpdate(
        args.id,
        { $inc: { [`wallet.${bucket}`]: amount } },
        { new: true }
      );
      if (!user) return { error: 'Usuario no encontrado' };
      await Transaction.create({
        from: args.adminId,
        to: user._id,
        amount: Math.abs(amount),
        type: 'bonus',
        ttcType: bucket === 'ttcR' ? 'ttcR' : 'ttcC',
        details: `Ajuste del asistente de admin (${bucket})`,
      });
      return { ok: true, usuario: user.username, saldo: user.wallet };
    }

    case 'pagos_pendientes': {
      const orders = await manualPaymentService.listOrders({ status: 'pending' });
      return {
        ordenes: orders.slice(0, 20).map((o) => ({
          id: o._id.toString(),
          usuario: o.user?.username || 'desconocido',
          monedas: o.coins,
          precioUsd: o.priceUsd,
          metodo: o.method,
          referencia: o.reference,
        })),
      };
    }

    case 'revisar_pagos': {
      const result = await manualPaymentService.reviewPending({ limit: 20 });
      return { configurado: result.configured, revisadas: result.reviewed.length };
    }

    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}

/* ------------------------------------------------------------------ */
/* Bucle de conversación                                               */
/* ------------------------------------------------------------------ */

/**
 * Envía un mensaje del administrador al asistente y devuelve la respuesta.
 *
 * Mantiene el bucle de function calling: el modelo pide herramientas, se
 * ejecutan aquí, se le devuelven los resultados y vuelve a decidir, hasta que
 * contesta en texto o se agota `MAX_TOOL_ROUNDS` (que corta un bucle infinito
 * si el modelo se atasca pidiendo la misma herramienta).
 */
async function chat({ messages, adminId }) {
  if (!isConfigured()) {
    throw new Error('El asistente no está configurado (falta ASSISTANT_API_KEY)');
  }

  const conversation = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 4000),
    })),
  ];

  const executed = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const data = await assistantClient.callAssistant({
      body: {
        model: env.assistantModel,
        temperature: 0,
        messages: conversation,
        tools: TOOLS,
      },
      timeoutMs: 30000,
      log: '[ASISTENTE]',
    });

    const message = data.choices?.[0]?.message;
    if (!message) throw new Error('El asistente no devolvió respuesta');

    const toolCalls = message.tool_calls || [];
    if (!toolCalls.length) {
      return { reply: message.content || '(sin respuesta)', executed };
    }

    conversation.push(message);

    for (const call of toolCalls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      args.adminId = adminId;
      // eslint-disable-next-line no-await-in-loop
      const result = await runTool(call.function.name, args);
      executed.push({ tool: call.function.name, args, result });
      conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    reply:
      'He necesitado demasiados pasos para completar eso. Prueba a pedírmelo en pasos más pequeños.',
    executed,
  };
}

module.exports = { isConfigured, chat, runTool, TOOLS };
