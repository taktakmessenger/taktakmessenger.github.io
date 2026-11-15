const env = require('../config/env');
const User = require('../models/User');
const assistantClient = require('./assistantClient');

// Asistak, el asistente administrativo de TAK TAK.
//
// Vive dentro de cada directo y de cada sala de juegos (POKERTAK) pendiente de
// quien falte al respeto. Cuando lo detecta, avisa en los comentarios con su
// propia voz y, si la persona reincide, le pone una suspensión temporal de
// `env.asistak.suspensionDays` días sin poder entrar a un directo ni a la mesa.
//
// Dos capas, a propósito:
//
//  - Un léxico local (rápido, gratis, sin red) que pilla las groserías e
//    insultos más comunes en español. Es el suelo: la moderación funciona aunque
//    no haya clave del asistente configurada.
//  - El modelo de lenguaje, cuando está configurado, para juzgar lo que el
//    léxico no ve (insultos disfrazados, ironía, faltas de respeto sin tacos).
//    Solo se usa como refuerzo: sin clave, la capa local decide sola.

const SEVERITY_NONE = 0;
const SEVERITY_WARN = 1;
const SEVERITY_HARD = 2;

// Espaciado mínimo entre dos juicios con IA del mismo usuario. El chat permite
// un comentario cada 700 ms, y mandar cada uno al modelo convertiría el chat en
// una factura. El léxico local sí corre siempre (es gratis): lo que se limita es
// solo la segunda opinión. 3 s deja vigilar una conversación normal sin gastar
// una llamada por línea.
const AI_MIN_INTERVAL_MS = 3000;
const lastAiCallByUser = new Map();

function isConfigured() {
  return assistantClient.isConfigured();
}

// Palabras y expresiones que no admiten duda. Se escriben con las variantes
// habituales de escritura (con y sin tilde, con `k`/`q`, con `@`) porque quien
// insulta no suele escribir bien. La lista es corta y deliberadamente obvia:
// las sutilezas las juzga el modelo.
const HARD_PATTERNS = [
  /\b(puta|puto|putas|putos)\b/i,
  /\b(hijo\s*de\s*puta|hdp|hijueputa|hijoputa)\b/i,
  /\b(maric[oó]n|marica|mariconazo)\b/i,
  /\b(cabr[oó]n|cabrona)\b/i,
  /\b(gilipollas|imb[eé]cil|idiota|est[uú]pido|est[uú]pida)\b/i,
  /\b(zorra|perra|cerda)\b/i,
  /\b(pendej[oa]|pendejada)\b/i,
  /\b(mierda|maldito|maldita)\b/i,
  /\b(chinga|chingada|verga|joder|coño)\b/i,
  /\b(vete\s*a\s*la\s*mierda|que\s*te\s*den)\b/i,
  /\b(mu[eé]rete|ojal[aá]\s*te\s*mu[eé]ras)\b/i,
  /\b(subnormal|retrasad[oa]|mongol[oa])\b/i,
];

// Faltas de respeto sin tacos: exigen una segunda palabra para no marcar frases
// inocentes ("eres tonto" sí, "no seas tonto, ven" también, y es aceptable
// pecar de prudente en un chat público).
const SOFT_PATTERNS = [
  /\b(eres|sos)\s+(un\s+)?(tonto|tonta|in[uú]til|basura|nada)\b/i,
  /\b(no\s+sirves|das\s+asco|me\s+das\s+asco|qu[eé]\s+asquito)\b/i,
  /\b(c[aá]llate|cierra\s+la\s+boca|ch[uú]pala)\b/i,
  /\b(l[aá]rgate|fuera\s+de\s+aqu[ií])\b/i,
];

// Normaliza para comparar: minúsculas y sin tildes, para que "PÚTA" o "putà"
// no se cuelen por la tilde.
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Juicio local. Devuelve la severidad más alta que encuentre.
 *
 * Se ejecuta sobre el texto normalizado y también sobre el original: los
 * patrones con tilde explícita necesitan el original, y los demás casan igual.
 */
function localSeverity(text) {
  const raw = String(text || '');
  const flat = normalize(raw);
  for (const rx of HARD_PATTERNS) {
    if (rx.test(raw) || rx.test(flat)) return SEVERITY_HARD;
  }
  for (const rx of SOFT_PATTERNS) {
    if (rx.test(raw) || rx.test(flat)) return SEVERITY_WARN;
  }
  return SEVERITY_NONE;
}

const SYSTEM_PROMPT = `Eres Asistak, el asistente administrativo de TAK TAK, una app de vídeo con directos y una sala de juegos de póker.
Recibes UN comentario escrito por un usuario en un directo o en la sala de juegos. Tu trabajo es decidir si falta al respeto.

Cuenta como falta de respeto: insultos, groserías dirigidas a alguien, amenazas, acoso, discriminación (por raza, sexo, religión, orientación), desprecio personal.
NO cuenta: críticas al juego o a la app, bromas sin destinatario, hablar de estrategia, quejarse de haber perdido, un taco sin dirigir a nadie ("vaya mierda de mano" es queja, no insulto a una persona).
Ante la duda razonable, no lo marques.

Responde SOLO con un objeto JSON, sin texto alrededor:
{"ofensa":true|false,"severidad":0|1|2,"motivo":"..."}
severidad 0 = nada, 1 = falta leve (aviso), 2 = insulto grave (aviso serio o suspensión).`;

/**
 * Pide al modelo un segundo juicio. Devuelve null si no hay clave o si el
 * proveedor falla: la moderación nunca depende de que la IA conteste.
 */
async function aiJudge(text, userId) {
  if (!isConfigured()) return null;
  // Sin usuario no hay a quién limitar; con usuario, se respeta el espaciado.
  if (userId != null) {
    const key = String(userId);
    const last = lastAiCallByUser.get(key) || 0;
    if (Date.now() - last < AI_MIN_INTERVAL_MS) return null;
    lastAiCallByUser.set(key, Date.now());
  }
  try {
    const data = await assistantClient.callAssistant({
      body: {
        model: env.assistantModel,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: String(text || '').slice(0, 500) },
        ],
      },
      timeoutMs: 12000,
      log: '[ASISTAK]',
    });
    const content = data.choices?.[0]?.message?.content || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const severidad = [0, 1, 2].includes(parsed.severidad) ? parsed.severidad : 0;
    return {
      ofensa: Boolean(parsed.ofensa),
      severidad: parsed.ofensa ? Math.max(1, severidad) : 0,
      motivo: String(parsed.motivo || '').slice(0, 300),
    };
  } catch (error) {
    console.warn(`[ASISTAK] Sin juicio del modelo: ${error.message}`);
    return null;
  }
}

/**
 * Evalúa un comentario y devuelve el veredicto.
 *
 * El léxico local es la base; el modelo solo puede subir la severidad, nunca
 * bajarla a cero cuando el léxico ya encontró un insulto claro. Así una IA
 * despistada no deja pasar una grosería evidente, pero sí puede reconocer una
 * falta de respeto que las palabras clave no ven.
 */
async function assess(text, userId) {
  const local = localSeverity(text);
  const ai = await aiJudge(text, userId);
  const severity = Math.max(local, ai?.severidad || 0);
  if (severity === SEVERITY_NONE) {
    return { offense: false, severity: SEVERITY_NONE, reason: '' };
  }
  return {
    offense: true,
    severity,
    reason: ai?.motivo || 'Falta de respeto en el comentario',
  };
}

// El aviso que Asistak deja en los comentarios. Es literalmente su voz: el
// usuario lo ve en el hilo, no en un correo ni en una pantalla aparte.
function warningText(username, severity) {
  const cabecera =
    severity >= SEVERITY_HARD
      ? 'Soy Asistak, el asistente administrativo. Esta es una advertencia seria.'
      : 'Soy Asistak, el asistente administrativo. Te doy una advertencia.';
  return (
    `${cabecera} @${username}, estoy aquí para dar una advertencia o sanciones ` +
    'si sigues faltando al respeto a esta plataforma y a los usuarios.'
  );
}

function suspensionText(username, days) {
  return (
    `@${username} ha sido suspendido ${days} días por Asistak: no podrá entrar a ` +
    'directos ni a la sala de juegos de POKERTAK durante ese tiempo.'
  );
}

/**
 * Aplica el veredicto a un usuario: cuenta el aviso y, si reincide, lo
 * suspende.
 *
 * La escalada es por reincidencia: el primer aviso solo avisa; a partir de
 * `env.asistak.warnBeforeSuspend` avisos, cae la suspensión. Así una palabra
 * suelta no expulsa a nadie, pero insistir sí tiene consecuencia.
 */
async function applyVerdict({ userId, severity }) {
  const user = await User.findById(userId).select('username moderation');
  if (!user) return { action: 'none' };

  const warnings = (user.moderation?.warnings || 0) + 1;
  const days = env.asistak.suspensionDays;
  const shouldSuspend = warnings >= env.asistak.warnBeforeSuspend;

  const update = {
    'moderation.warnings': warnings,
    'moderation.lastWarningAt': new Date(),
  };

  if (shouldSuspend) {
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    update['moderation.suspendedUntil'] = until;
    update['moderation.suspensionReason'] = `Falta de respeto reiterada en un directo o sala de juegos (${warnings} avisos)`;
    update['moderation.suspendedBy'] = 'asistak';
  }

  await User.updateOne({ _id: userId }, { $set: update });

  return {
    action: shouldSuspend ? 'suspend' : 'warn',
    username: user.username,
    warnings,
    severity,
    suspendedUntil: shouldSuspend ? update['moderation.suspendedUntil'] : null,
  };
}

/**
 * Punto de entrada para la moderación automática de un comentario.
 *
 * Devuelve el veredicto aplicado (o `{ action: 'none' }`). No lanza: un fallo
 * del asistente no puede tumbar el chat, que tiene que seguir funcionando.
 */
async function moderateComment({ userId, text }) {
  try {
    const verdict = await assess(text, userId);
    if (!verdict.offense) return { action: 'none' };
    const applied = await applyVerdict({ userId, severity: verdict.severity });
    return { ...applied, reason: verdict.reason };
  } catch (error) {
    console.warn(`[ASISTAK] No se pudo moderar: ${error.message}`);
    return { action: 'none' };
  }
}

/**
 * Suspensión manual, para el panel de administración y para el asistente de
 * admin. `days` por defecto son los de Asistak.
 */
async function suspendUser({ userId, days = env.asistak.suspensionDays, reason = '', by = 'admin' }) {
  const until = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000);
  const user = await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        'moderation.suspendedUntil': until,
        'moderation.suspensionReason': String(reason || '').slice(0, 300),
        'moderation.suspendedBy': by,
      },
    },
    { new: true }
  ).select('username moderation');
  if (!user) return null;
  return { username: user.username, until, days: Number(days) };
}

async function liftSuspension(userId) {
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        'moderation.suspendedUntil': null,
        'moderation.suspensionReason': null,
        'moderation.suspendedBy': null,
      },
    }
  );
  return { lifted: true };
}

/**
 * ¿Puede este usuario entrar a un directo o a la sala de juegos?
 *
 * Devuelve `{ allowed, until, reason }`. Se consulta en cada entrada (socket de
 * voz y mesa de póker) para que la suspensión valga en el servidor y no solo en
 * la UI, que el usuario puede saltarse.
 */
async function checkAccess(userId) {
  if (!userId) return { allowed: false, reason: 'Sin sesión' };
  const user = await User.findById(userId).select('moderation');
  if (!user) return { allowed: false, reason: 'Usuario no encontrado' };
  if (user.isSuspended()) {
    return {
      allowed: false,
      until: user.moderation.suspendedUntil,
      reason: `Estás suspendido por Asistak hasta ${new Date(user.moderation.suspendedUntil).toISOString().slice(0, 10)}`,
    };
  }
  return { allowed: true };
}

module.exports = {
  isConfigured,
  assess,
  moderateComment,
  applyVerdict,
  suspendUser,
  liftSuspension,
  checkAccess,
  warningText,
  suspensionText,
  localSeverity,
  _severity: { NONE: SEVERITY_NONE, WARN: SEVERITY_WARN, HARD: SEVERITY_HARD },
};
