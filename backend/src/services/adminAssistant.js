const env = require('../config/env');
const User = require('../models/User');
const Video = require('../models/Video');
const Report = require('../models/Report');
const Transaction = require('../models/Transaction');
const Comment = require('../models/Comment');
const Post = require('../models/Post');
const PostComment = require('../models/PostComment');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const Listing = require('../models/Listing');
const ManualOrder = require('../models/ManualOrder');
const PaymentMethod = require('../models/PaymentMethod');
const Gift = require('../models/Gift');
const PokerEvent = require('../models/PokerEvent');
const Squad = require('../models/Squad');
const Sound = require('../models/Sound');
const WatchEvent = require('../models/WatchEvent');
const Verification = require('../models/Verification');
const NewsSource = require('../models/NewsSource');
const walletService = require('../services/walletService');
const manualPaymentService = require('../services/manualPaymentService');
const asistak = require('../services/asistakService');
const pokerEventService = require('../services/pokerEventService');
const assistantClient = require('./assistantClient');
const assistantThreadService = require('./assistantThreadService');

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

// Registro de colecciones que el asistente puede consultar en modo lectura.
//
// En vez de una herramienta por cada pantalla de la app (que multiplicaría el
// esquema de herramientas y dispararía el gasto de tokens por turno, que es lo
// que agotaba la cuota del proveedor), se expone una única herramienta
// `consultar_datos` que acepta el nombre de la colección. La lista es blanca:
// solo entran colecciones de lectura; nada de credenciales (`Verification`,
// `PaymentMethod`) ni del hilo interno del propio asistente.
//
// `campos` son los que se devuelven por defecto (proyección) para no volcar
// documentos enteros ni gastar contexto de más; `buscar` son los campos sobre
// los que actúa el texto libre.
const COLLECTIONS = {
  users: {
    model: () => User,
    campos: 'username email role wallet stats createdAt lastSeenAt phone emailVerified',
    buscar: ['username', 'email'],
    descripcion: 'Cuentas de la app: saldo (wallet), rol, estado y fechas.',
  },
  videos: {
    model: () => Video,
    campos: 'title creator views likes moderationStatus createdAt duration isLive tags',
    buscar: ['title', 'tags'],
    descripcion: 'Vídeos del feed: autor, vistas, me gusta y estado de moderación.',
  },
  transactions: {
    model: () => Transaction,
    campos: 'from to amount type ttcType status method details createdAt',
    buscar: ['type', 'details'],
    descripcion: 'Libro de movimientos de dinero: regalos, compras, retiros, conversiones, rake.',
  },
  reports: {
    model: () => Report,
    campos: 'reporter targetType targetId reason status details createdAt',
    buscar: ['reason', 'details'],
    descripcion: 'Reportes de usuarios sobre contenido o cuentas.',
  },
  comments: {
    model: () => Comment,
    campos: 'video author text likes createdAt deletedAt',
    buscar: ['text'],
    descripcion: 'Comentarios de los vídeos.',
  },
  posts: {
    model: () => Post,
    campos: 'kind author text likes comments visibility createdAt hiddenAt',
    buscar: ['text'],
    descripcion: 'Publicaciones de Facetak.',
  },
  postcomments: {
    model: () => PostComment,
    campos: 'post author text likes createdAt deletedAt',
    buscar: ['text'],
    descripcion: 'Comentarios de las publicaciones de Facetak.',
  },
  conversations: {
    model: () => Conversation,
    campos: 'type participants lastMessageAt lastMessagePreview unread',
    buscar: ['type'],
    descripcion: 'Conversaciones de WhaTaka (chats).',
  },
  messages: {
    model: () => Message,
    campos: 'kind conversation sender text status createdAt deletedAt',
    buscar: ['text'],
    descripcion: 'Mensajes de WhaTaka, incluidos los avisos de llamada.',
  },
  notifications: {
    model: () => Notification,
    campos: 'recipient actor type read createdAt amount giftName',
    buscar: ['type'],
    descripcion: 'Notificaciones enviadas a los usuarios.',
  },
  listings: {
    model: () => Listing,
    campos: 'seller title price category condition status views createdAt',
    buscar: ['title', 'category'],
    descripcion: 'Artículos del mercadillo.',
  },
  manualorders: {
    model: () => ManualOrder,
    campos: 'user coins priceUsd method reference status createdAt',
    buscar: ['reference', 'method'],
    descripcion: 'Órdenes de compra de monedas con pago manual (Zinli, etc.).',
  },
  gifts: {
    model: () => Gift,
    campos: 'name coinCost category isActive sortOrder',
    buscar: ['name', 'category'],
    descripcion: 'Catálogo de regalos y su coste en monedas.',
  },
  pokerevents: {
    model: () => PokerEvent,
    campos: 'title createdBy scheduledAt entryCost maxPlayers status prizePool',
    buscar: ['title'],
    descripcion: 'Torneos de POKERTAK.',
  },
  squads: {
    model: () => Squad,
    campos: 'name slug owner visibility members createdAt',
    buscar: ['name', 'slug'],
    descripcion: 'Salas/squads de la app.',
  },
  sounds: {
    model: () => Sound,
    campos: 'title artist usageCount createdBy createdAt',
    buscar: ['title', 'artist'],
    descripcion: 'Catálogo de sonidos.',
  },
  watchevents: {
    model: () => WatchEvent,
    campos: 'userId videoId watchDuration completed completionRate createdAt',
    buscar: [],
    descripcion: 'Eventos de visualización (analítica del feed).',
  },
  newssources: {
    model: () => NewsSource,
    campos: 'name domains status verifiedAt notes',
    buscar: ['name', 'domains'],
    descripcion: 'Fuentes de noticias verificadas.',
  },
};

// Traduce el nombre que escribe el modelo a la clave del registro, tolerando
// singular/plural y mayúsculas ("usuario" → "users"). Sin esto, el modelo tendría
// que acertar el plural exacto y fallaría a menudo.
function resolveCollection(name) {
  const raw = String(name || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!raw) return null;
  if (COLLECTIONS[raw]) return { key: raw, def: COLLECTIONS[raw] };

  // Alias en singular que no salen de añadir/quitar la "s".
  const aliases = {
    usuario: 'users',
    user: 'users',
    video: 'videos',
    transaccion: 'transactions',
    transacciones: 'transactions',
    reporte: 'reports',
    reportes: 'reports',
    comentario: 'comments',
    comentarios: 'comments',
    mensaje: 'messages',
    mensajes: 'messages',
    conversacion: 'conversations',
    conversaciones: 'conversations',
    notificacion: 'notifications',
    notificaciones: 'notifications',
    publicacion: 'posts',
    publicaciones: 'posts',
    regalo: 'gifts',
    regalos: 'gifts',
    torneo: 'pokerevents',
    torneos: 'pokerevents',
    sala: 'squads',
    salas: 'squads',
    sonido: 'sounds',
    sonidos: 'sounds',
    orden: 'manualorders',
    ordenes: 'manualorders',
    compra: 'manualorders',
    compras: 'manualorders',
  };

  // Se prueban el nombre tal cual, en plural y en singular (quitando la "s" o
  // "es"), tanto contra el registro como contra los alias. Así "usuarios",
  // "usuario" y "users" caen todos en la misma colección.
  const variants = new Set([
    raw,
    `${raw}s`,
    raw.replace(/s$/, ''),
    raw.replace(/es$/, ''),
  ]);
  for (const v of variants) {
    if (COLLECTIONS[v]) return { key: v, def: COLLECTIONS[v] };
    if (aliases[v]) return { key: aliases[v], def: COLLECTIONS[aliases[v]] };
  }
  return null;
}

// El modelo rellena con `null` los parámetros opcionales que no usa, y el
// validador de esquema del proveedor rechaza `null` donde espera un `string`.
// Marcando los opcionales como nullables, una petición por lo demás válida no
// se cae con un 400 por un campo que el modelo decidió dejar vacío.
function nullableOptionals(tools) {
  for (const tool of tools) {
    const params = tool.function?.parameters;
    if (!params?.properties) continue;
    const required = new Set(params.required || []);
    for (const [name, schema] of Object.entries(params.properties)) {
      if (required.has(name)) continue;
      if (typeof schema.type === 'string') schema.type = [schema.type, 'null'];
      if (Array.isArray(schema.enum) && !schema.enum.includes(null)) schema.enum.push(null);
    }
  }
  return tools;
}

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
      name: 'consultar_datos',
      description:
        'Consulta cualquier colección de la app en modo lectura (usuarios, vídeos, transacciones, mensajes, chats, publicaciones, comentarios, reportes, notificaciones, mercadillo, órdenes de compra, regalos, torneos, salas, sonidos, fuentes de noticias…). Úsala para responder cualquier pregunta sobre datos que no cubra otra herramienta. `buscar` hace coincidencia parcial en los campos de texto; `filtro` es un objeto JSON de igualdades exactas.',
      parameters: {
        type: 'object',
        properties: {
          coleccion: {
            type: 'string',
            description:
              'Nombre de la colección (singular o plural). Ej: users, videos, transactions, messages, posts, comments, reports, manualorders, pokerevents, squads, gifts, listings, notifications.',
          },
          buscar: { type: 'string', description: 'Texto a buscar (parcial) en los campos de texto de la colección. Opcional.' },
          filtro: {
            type: 'string',
            description:
              'Filtros exactos en JSON, p. ej. {"status":"pending"} o {"role":"admin"}. Opcional.',
          },
          campos: {
            type: 'string',
            description: 'Campos a devolver separados por coma. Si se omite, se usan los campos por defecto de esa colección.',
          },
          limite: { type: 'number', description: 'Máximo de documentos (por defecto 20, tope 100).' },
          orden: {
            type: 'string',
            enum: ['reciente', 'antiguo'],
            description: 'Orden por fecha de creación. Por defecto reciente.',
          },
        },
        required: ['coleccion'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'esquema_app',
      description:
        'Devuelve la lista de colecciones consultables y los campos de cada una. Úsala cuando no sepas en qué colección o campo está un dato.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'convertir_monedas_a_diamantes',
      description:
        'Convierte Monedas de la cuenta del administrador en Diamantes retirables (1 a 1 por defecto). Solo funciona sobre la cuenta del propio administrador. Requiere la cantidad de Monedas.',
      parameters: {
        type: 'object',
        properties: {
          cantidad: { type: 'number', description: 'Monedas a convertir en Diamantes' },
        },
        required: ['cantidad'],
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
  {
    type: 'function',
    function: {
      name: 'listar_pagos',
      description:
        'Lista órdenes de compra de monedas (pagadas o pendientes) con usuario, monedas, precio, método y referencia. Sin filtros devuelve las 20 más recientes. Úsala para saber quién compró monedas y con qué detalle.',
      parameters: {
        type: 'object',
        properties: {
          estado: {
            type: 'string',
            enum: ['pending', 'approved', 'rejected'],
            description: 'Filtra por estado de la orden. Opcional.',
          },
          metodo: { type: 'string', description: 'Filtra por método de pago (p. ej. zinli). Opcional.' },
          desde: { type: 'string', description: 'Fecha ISO; solo órdenes desde ese momento. Opcional.' },
          hasta: { type: 'string', description: 'Fecha ISO; solo órdenes hasta ese momento. Opcional.' },
          limite: { type: 'number', description: 'Máximo de órdenes a devolver (por defecto 20, tope 100).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resumen_compras',
      description:
        'Totales de compra de monedas: número de órdenes, monedas vendidas, importe en USD y la lista de quiénes compraron (ordenada por lo que gastaron). Acepta rango de fechas.',
      parameters: {
        type: 'object',
        properties: {
          estado: {
            type: 'string',
            enum: ['pending', 'approved', 'rejected'],
            description: 'Cuenta solo las órdenes en ese estado. Opcional.',
          },
          desde: { type: 'string', description: 'Fecha ISO de inicio. Opcional.' },
          hasta: { type: 'string', description: 'Fecha ISO de fin. Opcional.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'aprobar_pago',
      description:
        'Aprueba una orden de compra y acredita las monedas al usuario. Solo cuando el pago se ha comprobado por fuera. Requiere el id de la orden. Aprobar dos veces no duplica el abono.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'id de la orden de pago' },
          nota: { type: 'string', description: 'Nota interna sobre por qué se aprueba. Opcional.' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rechazar_pago',
      description:
        'Rechaza una orden de compra pendiente (no acredita monedas). Úsala cuando el pago no aparece o la referencia no cuadra. Requiere el id y un motivo.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'id de la orden de pago' },
          motivo: { type: 'string', description: 'Motivo del rechazo' },
        },
        required: ['id', 'motivo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_retiros',
      description:
        'Lista solicitudes de retiro de Diamantes con usuario, monto, método y datos de cobro. Sin filtros devuelve las pendientes.',
      parameters: {
        type: 'object',
        properties: {
          estado: {
            type: 'string',
            enum: ['pending', 'completed', 'rejected'],
            description: 'Estado de la solicitud (por defecto pending). Opcional.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pagar_retiro',
      description:
        'Marca una solicitud de retiro como pagada, después de enviar el dinero por fuera (PayPal, Zelle…). No mueve saldo: los Diamantes ya se descontaron al solicitarla. Requiere el id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'id de la solicitud de retiro' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rechazar_retiro',
      description:
        'Rechaza una solicitud de retiro y devuelve los Diamantes al usuario. Requiere el id y un motivo.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'id de la solicitud de retiro' },
          motivo: { type: 'string', description: 'Motivo del rechazo' },
        },
        required: ['id', 'motivo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suspender_usuario',
      description:
        'Suspende a un usuario unos días sin poder entrar a directos ni a la sala de juegos de POKERTAK. Requiere el id del usuario y un motivo.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'id del usuario' },
          dias: { type: 'number', description: 'Días de suspensión (por defecto 3)' },
          motivo: { type: 'string', description: 'Motivo de la suspensión' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'levantar_suspension',
      description: 'Quita la suspensión de un usuario para que pueda volver a los directos y a POKERTAK.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'id del usuario' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'organizar_torneo_poker',
      description:
        'Organiza un torneo de POKERTAK: un evento con día, hora, aforo (2 a 9 jugadores), coste de entrada y reparto de premios. No cobra nada al crearlo: el jugador paga la entrada al inscribirse. Por defecto reparte 40% al 1º, 30% al 2º y 20% al 3º, y la casa se queda el 10% de lo recaudado.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Nombre del torneo' },
          sala: { type: 'string', description: 'slug de la sala (squad) donde se juega' },
          fecha: {
            type: 'string',
            description: 'Fecha y hora de comienzo en formato ISO 8601, p. ej. 2026-11-10T21:00:00Z',
          },
          entrada: { type: 'number', description: 'Coste de la entrada en monedas, por jugador' },
          jugadores: { type: 'number', description: 'Aforo del torneo (2 a 9)' },
          reparto: {
            type: 'array',
            items: { type: 'number' },
            description:
              'Parte de lo recaudado para cada puesto, de primero a último (p. ej. [0.4, 0.3, 0.2]). Opcional: por defecto 40/30/20.',
          },
          tarifa: {
            type: 'number',
            description: 'Parte que se queda la casa, 0 a 1. Opcional: por defecto 0.1 (10%).',
          },
        },
        required: ['titulo', 'sala', 'fecha', 'entrada', 'jugadores'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_torneos_poker',
      description: 'Lista los torneos de POKERTAK con su estado, inscritos y lo que se repartiría.',
      parameters: {
        type: 'object',
        properties: {
          estado: {
            type: 'string',
            enum: ['scheduled', 'running', 'finished', 'cancelled'],
            description: 'Filtra por estado. Opcional.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cerrar_torneo_poker',
      description:
        'Termina un torneo en juego y paga los premios. Pasa el ranking por orden de puesto (primero el ganador); si no lo pasas, se usa el orden de inscripción.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'id del torneo' },
          ranking: {
            type: 'array',
            items: { type: 'string' },
            description: 'ids de usuario en orden de puesto, del primero al último. Opcional.',
          },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_torneo_poker',
      description:
        'Cancela un torneo y devuelve la entrada a todos los inscritos, cada uno en el mismo tipo de moneda con que pagó.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'id del torneo' },
          motivo: { type: 'string', description: 'Motivo de la cancelación' },
        },
        required: ['id'],
      },
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

Los ids son cadenas largas de MongoDB. Cuando el administrador se refiera a "ese usuario" o "ese vídeo", busca primero para obtener el id correcto.

Compras de monedas (pagos):
- Para saber QUIÉN compró monedas y con qué detalle usa "listar_pagos". Acepta estado (pending/approved/rejected), método, rango de fechas (desde/hasta en ISO) y límite.
- Para totales (cuántas órdenes, cuántas monedas, cuánto en USD y quiénes compraron) usa "resumen_compras". Es la herramienta correcta para "cuántos usuarios han comprado" o "cuánto se vendió este mes"; NO hace falta un resumen general.
- "pagos_pendientes" solo lista lo que está sin revisar; para el historial completo usa "listar_pagos".
- Aprobar un pago ("aprobar_pago") acredita monedas de verdad: hazlo solo si el administrador confirma que el pago llegó. Aprobar dos veces no duplica el abono (da error). Rechazar ("rechazar_pago") no acredita nada.
- Cuando el administrador no dé fechas, no las inventes: responde con el total acumulado y ofrece filtrar por fechas.

Monedas y Diamantes:
- Monedas (TTC) se gastan en la app (regalos, torneos). Diamantes son el saldo retirable.
- El administrador SÍ puede convertir sus Monedas en Diamantes: usa "convertir_monedas_a_diamantes" con la cantidad. La tasa por defecto es 1 Moneda = 1 Diamante. Solo funciona sobre la cuenta del administrador.
- Si te preguntan si las monedas se pueden convertir en Diamantes, la respuesta es que sí: el administrador puede hacerlo con "convertir_monedas_a_diamantes" (1 a 1 por defecto), y las monedas de regalo (bonusC) no son convertibles, solo las Monedas compradas (ttcC).

Consultar cualquier dato de la app:
- Tienes acceso de lectura a toda la app. Para preguntas que no cubra una herramienta específica, usa "consultar_datos" indicando la colección (usuarios, vídeos, transacciones, mensajes, conversaciones, publicaciones, comentarios, reportes, notificaciones, mercadillo, órdenes de compra, regalos, torneos, salas, sonidos, fuentes de noticias…).
- Si no sabes en qué colección o campo está un dato, llama antes a "esquema_app" y te devuelve la lista de colecciones y sus campos.
- Usa "buscar" para texto libre y "filtro" (JSON) para igualdades exactas. Nunca inventes datos: si la consulta no devuelve nada, dilo.

Retiros de Diamantes:
- "listar_retiros" muestra las solicitudes (por defecto las pendientes) con usuario, monto, método y datos de cobro.
- "pagar_retiro" solo marca la solicitud como pagada, después de que el administrador envíe el dinero por fuera; no mueve saldo.
- "rechazar_retiro" devuelve los Diamantes al usuario.

Torneos de POKERTAK:
- Para organizar uno usa "organizar_torneo_poker". Necesitas título, sala, fecha y hora (ISO 8601), entrada en monedas y aforo (2 a 9). Si el administrador no dice el reparto, se usa 40% al 1º, 30% al 2º y 20% al 3º, y la casa se queda el 10% de lo recaudado; eso es lo mismo que hace PokerStars en sus mesas de 9 jugadores (50/30/20 cuando solo paga el bote entero, 40/30/20 aquí porque el 10% es la tarifa).
- Antes de crearlo, confirma en tu respuesta el día, la hora, la entrada, el aforo y el reparto, y di cuánto se llevaría cada puesto con el aforo completo.
- Para terminar uno usa "cerrar_torneo_poker"; si el administrador no da el ranking, se usa el orden de inscripción.
- Para suspenderlo usa "cancelar_torneo_poker", que devuelve las entradas a todos.`;

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

    case 'listar_pagos': {
      const orders = await manualPaymentService.listOrders({
        status: args.estado,
        method: args.metodo,
        from: args.desde,
        to: args.hasta,
        limit: Math.min(Number(args.limite) || 20, 100),
      });
      return {
        ordenes: orders.map((o) => ({
          id: o._id.toString(),
          usuario: o.user?.username || 'desconocido',
          email: o.user?.email || null,
          monedas: o.coins,
          precioUsd: o.priceUsd,
          metodo: o.method,
          referencia: o.reference,
          estado: o.status,
          fecha: o.createdAt,
        })),
      };
    }

    case 'resumen_compras': {
      return manualPaymentService.purchaseSummary({
        status: args.estado,
        from: args.desde,
        to: args.hasta,
      });
    }

    case 'aprobar_pago': {
      try {
        const result = await manualPaymentService.approveOrder({
          orderId: args.id,
          adminId: args.adminId,
          note: args.nota ? String(args.nota).slice(0, 300) : undefined,
        });
        return {
          ok: true,
          monedas: result.coins,
          acreditadas: result.credited,
          usuario: result.order?.user?.username || undefined,
        };
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'rechazar_pago': {
      try {
        const order = await manualPaymentService.rejectOrder({
          orderId: args.id,
          adminId: args.adminId,
          reason: String(args.motivo || '').slice(0, 300),
        });
        return { ok: true, estado: order.status, monedas: order.coins };
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'listar_retiros': {
      const withdrawals = await walletService.listWithdrawals({
        status: args.estado || 'pending',
      });
      return {
        retiros: withdrawals.map((w) => ({
          id: w.id,
          usuario: w.user?.username || 'desconocido',
          diamantes: w.amount,
          metodo: w.method,
          datosCobro: w.details,
          estado: w.status,
          fecha: w.createdAt,
        })),
      };
    }

    case 'pagar_retiro': {
      try {
        const result = await walletService.payWithdrawal({
          transactionId: args.id,
          adminId: args.adminId,
        });
        return { ok: true, estado: result.status, diamantes: result.amount };
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'rechazar_retiro': {
      try {
        const result = await walletService.rejectWithdrawal({
          transactionId: args.id,
          adminId: args.adminId,
          reason: String(args.motivo || '').slice(0, 300),
        });
        return { ok: true, estado: result.status, diamantesDevueltos: result.amount };
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'suspender_usuario': {
      const days = Number.isFinite(Number(args.dias)) && Number(args.dias) > 0 ? Number(args.dias) : 3;
      const result = await asistak.suspendUser({
        userId: args.id,
        days,
        reason: args.motivo,
        by: 'admin',
      });
      if (!result) return { error: 'Usuario no encontrado' };
      return { ok: true, usuario: result.username, dias: result.days, hasta: result.until };
    }

    case 'levantar_suspension': {
      await asistak.liftSuspension(args.id);
      return { ok: true };
    }

    case 'organizar_torneo_poker': {
      try {
        const event = await pokerEventService.createEvent({
          title: args.titulo,
          adminId: args.adminId,
          squadSlug: args.sala,
          scheduledAt: args.fecha,
          entryCost: args.entrada,
          maxPlayers: args.jugadores,
          rakeRate: args.tarifa,
          split: args.reparto,
        });
        return { ok: true, torneo: pokerEventService.publicEvent(event) };
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'listar_torneos_poker': {
      const events = await pokerEventService.listEvents({ status: args.estado, limit: 20 });
      return {
        torneos: events.map((e) => ({
          id: e.id,
          titulo: e.title,
          fecha: e.scheduledAt,
          estado: e.status,
          entrada: e.entryCost,
          inscritos: e.seatsTaken,
          aforo: e.maxPlayers,
          reparto: e.split,
          tarifa: e.rakeRate,
          botePrevisto: e.projectedPrizePool,
          premiosPrevistos: e.projectedPlaces,
        })),
      };
    }

    case 'cerrar_torneo_poker': {
      try {
        const result = await pokerEventService.finishEvent({
          eventId: args.id,
          ranking: args.ranking,
        });
        return {
          ok: true,
          yaCerrado: result.already,
          ganadores: result.event.results.map((r) => ({
            puesto: r.place,
            usuario: r.username,
            premio: r.amount,
          })),
          bote: result.event.prizePool,
          casa: result.event.houseCut,
        };
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'cancelar_torneo_poker': {
      try {
        const result = await pokerEventService.cancelEvent({
          eventId: args.id,
          reason: args.motivo,
        });
        return { ok: true, yaCancelado: result.already, devueltos: result.refunded?.length || 0 };
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'esquema_app': {
      return {
        colecciones: Object.entries(COLLECTIONS).map(([key, def]) => ({
          coleccion: key,
          descripcion: def.descripcion,
          campos: def.campos.split(' '),
        })),
      };
    }

    case 'consultar_datos': {
      const resolved = resolveCollection(args.coleccion);
      if (!resolved) {
        return {
          error: `Colección desconocida: ${args.coleccion}`,
          disponibles: Object.keys(COLLECTIONS),
        };
      }
      const { key, def } = resolved;

      // Filtro: solo igualdades sobre valores escalares. Se descartan objetos y
      // arrays (que podrían colar operadores como `$where`) y las claves que
      // empiezan por `$`, para que el modelo no pueda ejecutar nada raro.
      let filtro = {};
      if (args.filtro) {
        let parsed = args.filtro;
        if (typeof parsed === 'string') {
          try {
            parsed = JSON.parse(parsed);
          } catch {
            return { error: 'El filtro no es JSON válido' };
          }
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            if (k.startsWith('$')) continue;
            if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
              filtro[k] = v;
            }
          }
        }
      }

      // Texto libre: OR de coincidencias parciales sobre los campos de texto
      // declarados para esa colección. Se escapa el término para que no se
      // interprete como expresión regular.
      const term = String(args.buscar || '').trim();
      if (term && def.buscar.length) {
        const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filtro = { $and: [filtro, { $or: def.buscar.map((f) => ({ [f]: rx })) }] };
      }

      // Campos: los que pida el modelo, siempre en modo inclusivo y excluyendo
      // lo que empiece por `$`. Si no pide, la proyección por defecto.
      let projection = def.campos;
      if (typeof args.campos === 'string' && args.campos.trim()) {
        const wanted = args.campos
          .split(',')
          .map((c) => c.trim())
          .filter((c) => c && !c.startsWith('$'));
        if (wanted.length) projection = wanted.join(' ');
      }

      const limit = Math.min(Math.max(Number(args.limite) || 20, 1), 100);
      const sort = args.orden === 'antiguo' ? 1 : -1;

      const Model = def.model();
      const docs = await Model.find(filtro)
        .select(projection)
        .sort({ createdAt: sort })
        .limit(limit)
        .lean();
      const total = await Model.countDocuments(filtro);

      return {
        coleccion: key,
        total,
        devueltos: docs.length,
        documentos: docs.map((d) => ({ ...d, _id: d._id?.toString?.() ?? d._id })),
      };
    }

    case 'convertir_monedas_a_diamantes': {
      try {
        const result = await walletService.convertCoinsToDiamonds({
          userId: args.adminId,
          coins: args.cantidad,
          rate: env.coinToDiamondRate,
        });
        return {
          ok: true,
          monedasConvertidas: result.coins,
          diamantes: result.diamonds,
          saldo: result.wallet,
        };
      } catch (err) {
        return { error: err.message };
      }
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
 *
 * El historial ya no lo manda el cliente: se lee de la base por administrador,
 * así la conversación sobrevive a recargas y cambios de dispositivo. `message`
 * es solo el turno nuevo del usuario.
 */
async function chat({ message, adminId }) {
  if (!isConfigured()) {
    throw new Error('El asistente no está configurado (falta ASSISTANT_API_KEY)');
  }

  // Hilo previo (sin el mensaje nuevo) para reconstruir el contexto.
  const history = await assistantThreadService.load(adminId);

  // El límite del proveedor es por tokens por minuto, y el esquema de
  // herramientas más el prompt ya gastan una parte fija en cada vuelta. Mandar
  // 40 turnos de hasta 4000 caracteres disparaba el 429: se recorta el contexto
  // a los últimos turnos y a una longitud útil. La conversación completa sigue
  // guardada; solo se manda al modelo lo reciente.
  const CONTEXT_TURNS = 12;
  const CONTEXT_CHARS = 1500;
  const recent = history.slice(-CONTEXT_TURNS);

  const conversation = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...recent.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, CONTEXT_CHARS),
    })),
    { role: 'user', content: String(message || '').slice(0, 4000) },
  ];

  const executed = [];
  let reply = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const data = await assistantClient.callAssistant({
      body: {
        model: env.assistantModel,
        temperature: 0,
        messages: conversation,
        tools: TOOLS,
        // Acota la respuesta: sin tope, el modelo puede gastar cientos de
        // tokens en texto que no aporta y agotar antes la cuota.
        max_tokens: 700,
      },
      timeoutMs: 30000,
      log: '[ASISTENTE]',
    });

    const responseMessage = data.choices?.[0]?.message;
    if (!responseMessage) throw new Error('El asistente no devolvió respuesta');

    const toolCalls = responseMessage.tool_calls || [];
    if (!toolCalls.length) {
      reply = responseMessage.content || '(sin respuesta)';
      break;
    }

    conversation.push(responseMessage);

    for (const call of toolCalls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      // El modelo manda `null` en los opcionales que no usa. Se descartan para
      // que cada herramienta aplique su valor por defecto: un `null` colado en
      // la tarifa del póker se leería como 0 (sin comisión) en vez de 10%.
      for (const key of Object.keys(args)) {
        if (args[key] === null) delete args[key];
      }
      args.adminId = adminId;
      // eslint-disable-next-line no-await-in-loop
      const result = await runTool(call.function.name, args);
      executed.push({ tool: call.function.name, args, result });
      conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        // Un resultado grande (p. ej. 100 documentos) se reenvía al modelo en
        // cada vuelta y cuenta para el límite. Se recorta para que una consulta
        // amplia no deje sin cuota el resto de la conversación.
        content: JSON.stringify(result).slice(0, 6000),
      });
    }
  }

  if (reply === null) {
    reply =
      'He necesitado demasiados pasos para completar eso. Prueba a pedírmelo en pasos más pequeños.';
  }

  // Se guardan solo los turnos de texto: el usuario y la respuesta final. Las
  // llamadas a herramientas son andamiaje de esta petición, no conversación.
  await assistantThreadService.append(adminId, [
    { role: 'user', content: message },
    { role: 'assistant', content: reply },
  ]);

  return { reply, executed };
}

module.exports = { isConfigured, chat, runTool, TOOLS: nullableOptionals(TOOLS) };
