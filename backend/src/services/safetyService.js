const mongoose = require('mongoose');
const User = require('../models/User');
const Report = require('../models/Report');
const Video = require('../models/Video');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const PostComment = require('../models/PostComment');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { HttpError } = require('../utils/http');

// Seguridad del usuario: bloquear a alguien y reportar contenido.
//
// Son dos caras del mismo problema. Bloquear es la defensa inmediata que el
// usuario se aplica a sí mismo: corta el contacto sin esperar a nadie. Reportar
// es la vía para que la plataforma actúe, porque el bloqueo no sirve de nada
// contra alguien que sigue publicando para todos.

// --- Bloqueo -------------------------------------------------------------

// Bloquea a otro usuario. Es idempotente: bloquear dos veces no es un error, y
// así un doble toque en la UI no rompe nada.
async function blockUser(userId, targetId) {
  if (String(userId) === String(targetId)) {
    throw new HttpError(400, 'No puedes bloquearte a ti mismo');
  }

  const target = await User.findById(targetId).select('username');
  if (!target) throw new HttpError(404, 'Usuario no encontrado');

  await User.updateOne({ _id: userId }, { $addToSet: { blockedUsers: targetId } });

  // Al bloquear, se deja de seguir y se retira el seguimiento del otro lado.
  // Sin esto, la lista de "siguiendo" seguiría mostrando a alguien bloqueado y
  // el feed intentaría traer sus vídeos, que ya no se pueden ver.
  await User.updateOne({ _id: userId }, { $pull: { 'profile.following': targetId } });
  await User.updateOne({ _id: targetId }, { $pull: { 'profile.followers': userId } });

  return { blocked: true };
}

async function unblockUser(userId, targetId) {
  await User.updateOne({ _id: userId }, { $pull: { blockedUsers: targetId } });
  return { blocked: false };
}

// Ids que este usuario ha bloqueado. Lo consume el feed para no traer sus
// vídeos, y el chat para rechazar el contacto.
async function getBlockedIds(userId) {
  if (!userId) return [];
  const user = await User.findById(userId).select('blockedUsers');
  return (user?.blockedUsers || []).map((id) => String(id));
}

// ¿Hay bloqueo entre los dos, en cualquier dirección? Para el chat y las
// llamadas da igual quién bloqueó a quién: el resultado es que no se hablan.
async function isBlockedBetween(a, b) {
  const [userA, userB] = await Promise.all([
    User.findById(a).select('blockedUsers'),
    User.findById(b).select('blockedUsers'),
  ]);
  const aBlocked = (userA?.blockedUsers || []).some((id) => String(id) === String(b));
  const bBlocked = (userB?.blockedUsers || []).some((id) => String(id) === String(a));
  return aBlocked || bBlocked;
}

// Lista de bloqueados, para la pantalla de gestión. Se devuelve la identidad
// pública, nunca el teléfono ni el email.
async function listBlocked(userId) {
  const user = await User.findById(userId)
    .select('blockedUsers')
    .populate('blockedUsers', 'username profile.displayName profile.avatar');
  return (user?.blockedUsers || []).map((u) => ({
    id: u._id,
    username: u.username,
    displayName: u.profile?.displayName || null,
    avatar: u.profile?.avatar || null,
  }));
}

// --- Reportes ------------------------------------------------------------

// Comprueba que el objeto reportado existe, para no llenar la cola de reportes
// contra ids inventados. Devuelve el dueño del contenido, que es un dato útil
// para la moderación (un mismo autor con muchos reportes es una señal).
const TARGET_MODELS = {
  video: Video,
  user: User,
  post: Post,
  comment: Comment,
  post_comment: PostComment,
  message: Message,
};

async function resolveTarget(targetType, targetId) {
  const Model = TARGET_MODELS[targetType];
  if (!Model) throw new HttpError(400, 'Tipo de reporte inválido');
  if (!mongoose.isValidObjectId(targetId)) {
    throw new HttpError(400, 'Contenido inválido');
  }

  const doc = await Model.findById(targetId).select(
    targetType === 'user' ? 'username' : 'creator author sender'
  );
  if (!doc) throw new HttpError(404, 'El contenido ya no existe');

  // Cada modelo nombra a su autor de una forma: `creator` en vídeo, `author` en
  // publicaciones y comentarios, `sender` en mensajes.
  const owner = doc.creator || doc.author || doc.sender || doc._id;
  return { doc, owner };
}

// Crea un reporte. Un segundo reporte de la misma persona sobre el mismo objeto
// no crea una fila nueva (el índice único lo impide): se actualiza el motivo y
// el estado vuelve a "open", para que la cola refleje lo último que se dijo.
async function createReport({ reporterId, targetType, targetId, reason, details = '' }) {
  const { owner } = await resolveTarget(targetType, targetId);

  // Reportarse a uno mismo no es un reporte, es un error de la interfaz (o un
  // intento de ensuciar la cola de moderación). Se corta aquí, en el servicio,
  // porque los diálogos de vídeo y de perfil comparten esta puerta.
  if (String(owner) === String(reporterId)) {
    throw new HttpError(400, 'No puedes reportar tu propio contenido');
  }

  const report = await Report.findOneAndUpdate(
    { reporter: reporterId, targetType, targetId },
    { reason, details, status: 'open' },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );

  return serializeReport(report);
}

// Un reporte se puede retirar: si alguien reportó por error, no tiene sentido
// obligarle a esperar a que un moderador lo descarte.
async function withdrawReport({ reporterId, reportId }) {
  const report = await Report.findOneAndDelete({ _id: reportId, reporter: reporterId });
  if (!report) throw new HttpError(404, 'Reporte no encontrado');
  return { withdrawn: true };
}

async function listMyReports(reporterId, { limit = 30 } = {}) {
  const reports = await Report.find({ reporter: reporterId })
    .sort({ createdAt: -1 })
    .limit(limit);
  return reports.map(serializeReport);
}

function serializeReport(report) {
  return {
    id: report._id,
    targetType: report.targetType,
    targetId: report.targetId,
    reason: report.reason,
    details: report.details,
    status: report.status,
    createdAt: report.createdAt,
  };
}

module.exports = {
  blockUser,
  unblockUser,
  getBlockedIds,
  isBlockedBetween,
  listBlocked,
  createReport,
  withdrawReport,
  listMyReports,
  resolveTarget,
};
