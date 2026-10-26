const Video = require('../models/Video');
const User = require('../models/User');
const { fold, buildAccentInsensitiveRegex } = require('../lib/textSearch');

// Cuántos resultados de cada tipo caben en una página. Un número corto y fijo
// basta para una pantalla de búsqueda y evita que una consulta amplia (una
// letra suelta) traiga media base de datos.
const PAGE_SIZE = 20;

// Descubrimiento. Reúne en una sola pantalla las dos cosas que se buscan en
// TAK TAK: personas (@usuario o nombre) y vídeos (título, descripción o
// etiqueta). Antes no existía: al feed solo se llegaba deslizando, así que no
// había forma de encontrar a alguien concreto ni de volver a un vídeo visto.
//
// El orden es por relevancia aproximada, no por fecha: una coincidencia en el
// nombre pesa más que una en la biografía, y un vídeo con más interacción sube
// frente a uno abandonado. No es un motor de búsqueda, pero acierta en el caso
// normal de escribir algo concreto.

// Consulta de personas: por arroba exacta, nombre visible, usuario o biografía.
async function searchUsers(query, { limit = PAGE_SIZE } = {}) {
  const pattern = buildAccentInsensitiveRegex(query);
  if (!pattern) return [];

  const users = await User.find({
    $or: [
      { username: pattern },
      { 'profile.displayName': pattern },
      { 'profile.bio': pattern },
    ],
  })
    .select('username profile.displayName profile.avatar profile.bio profile.isVerified profile.isCreator profile.followers')
    .limit(limit);

  // Relevancia: coincidencia exacta en el usuario primero, luego el nombre
  // visible, y por último el resto (biografía). Los empates se rompen por
  // seguidores, que es la señal de que alguien es conocido.
  const needle = fold(query);
  return users
    .map((user) => ({ user, score: userScore(user, needle) }))
    .sort((a, b) => b.score - a.score)
    .map(({ user }) => ({
      id: user._id,
      username: user.username,
      displayName: user.profile?.displayName || null,
      avatar: user.profile?.avatar || null,
      bio: user.profile?.bio || null,
      isVerified: Boolean(user.profile?.isVerified),
      isCreator: Boolean(user.profile?.isCreator),
      followers: (user.profile?.followers || []).length,
    }));
}

// Puntuación de una persona, con el texto ya plegado a minúsculas y sin
// acentos, igual que la consulta. Así "cafe" y "café" puntúan lo mismo.
function userScore(user, needle) {
  const username = fold(user.username);
  const displayName = fold(user.profile?.displayName);
  let score = 0;
  if (username === needle) score += 1000;
  if (username.startsWith(needle)) score += 500;
  if (displayName.includes(needle)) score += 300;
  // Los seguidores son el desempate: dos "Juan" no valen lo mismo.
  return score + (user.profile?.followers?.length || 0);
}

// Consulta de vídeos: título, descripción o etiqueta. Solo lo que se puede ver:
// la moderación y el contenido para adultos se respetan igual que en el feed.
async function searchVideos(query, { limit = PAGE_SIZE, viewerId = null, canViewAdult = false } = {}) {
  const pattern = buildAccentInsensitiveRegex(query);
  if (!pattern) return [];

  const filter = {
    moderationStatus: 'approved',
    $or: [{ title: pattern }, { description: pattern }, { tags: pattern }],
  };
  // El contenido para adultos se oculta a quien no verificó su edad, igual que
  // en el feed. Se aplica aquí y no en la puntuación: una bonificación dejaría
  // el vídeo a la vista.
  if (!canViewAdult) filter.isNSFW = { $ne: true };

  const videos = await Video.find(filter)
    .sort({ likes: -1, views: -1, createdAt: -1 })
    .limit(limit)
    .populate('creator', 'username profile.displayName profile.avatar');

  // Un vídeo propio se puede encontrar aunque no pase el filtro de adultos,
  // pero eso ya lo cubre `canViewAdult`; aquí solo se descartan los rechazados.
  return videos.map((video) => ({
    id: video._id,
    title: video.title,
    description: video.description || null,
    thumbnailUrl: video.thumbnailUrl || null,
    videoUrl: video.videoUrl,
    hlsUrl: video.hlsUrl || null,
    duration: video.duration || null,
    views: video.views || 0,
    likes: video.likes || 0,
    tags: video.tags || [],
    creator: video.creator
      ? {
          id: video.creator._id,
          username: video.creator.username,
          displayName: video.creator.profile?.displayName || null,
          avatar: video.creator.profile?.avatar || null,
        }
      : null,
    createdAt: video.createdAt,
  }));
}

// Etiquetas que coinciden con lo escrito, con cuántos vídeos tiene cada una.
// Sirve para ofrecer "buscar por #etiqueta" sin que el usuario tenga que saberse
// las que existen.
async function searchTags(query, { limit = 8 } = {}) {
  const pattern = buildAccentInsensitiveRegex(query);
  if (!pattern) return [];

  const tags = await Video.aggregate([
    { $match: { moderationStatus: 'approved', tags: pattern } },
    { $unwind: '$tags' },
    { $match: { tags: pattern } },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: limit },
  ]);

  return tags.map((t) => ({ tag: t._id, count: t.count }));
}

// Búsqueda combinada. Devuelve las tres listas a la vez para que la pantalla se
// pinte de una sola petición en lugar de encadenar tres.
async function search(query, { viewerId = null, canViewAdult = false } = {}) {
  const clean = String(query || '').trim();
  if (!clean) {
    return { query: '', users: [], videos: [], tags: [] };
  }

  const [users, videos, tags] = await Promise.all([
    searchUsers(clean),
    searchVideos(clean, { viewerId, canViewAdult }),
    searchTags(clean),
  ]);

  return { query: clean, users, videos, tags };
}

module.exports = { search, searchUsers, searchVideos, searchTags, PAGE_SIZE };
