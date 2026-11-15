const Sound = require('../models/Sound');

// Catálogo de música para los vídeos, al estilo de TikTok: el creador elige una
// pista y el vídeo se publica con esa música mezclada.
//
// Todas las pistas son de dominio público (CC0) y se sirven desde Wikimedia
// Commons, que es un origen estable y no pide clave. Se enlaza la URL original
// en vez de copiar el audio al repositorio: son ficheros de varios megas y el
// bucket de medios ya se encarga de los que sube la gente.
//
// El campo `source` no se guarda en el modelo `Sound` (que ya existía para los
// sonidos que se extraen de los vídeos): aquí se usa solo para sembrar. Se
// identifica cada pista por el título, así que volver a arrancar no duplica.
const DEFAULT_SOUNDS = [
  {
    title: 'Sweet You',
    artist: 'Loyalty Freak Music',
    audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/b0/Loyalty_Freak_Music_-_01_-_Sweet_You.ogg',
  },
  {
    title: 'Sunglasses',
    artist: 'Loyalty Freak Music',
    audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/c/cc/Loyalty_Freak_Music_-_01_-_Sunglasses.ogg',
  },
  {
    title: 'Coexistenz',
    artist: 'Loyalty Freak Music',
    audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/d/d4/Loyalty_Freak_Music_-_01_-_Coexistenz.ogg',
  },
  {
    title: 'Everyone',
    artist: 'Loyalty Freak Music',
    audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/63/Loyalty_Freak_Music_-_06_-_Everyone.ogg',
  },
  {
    title: 'Shoepop',
    artist: 'Loyalty Freak Music',
    audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/04/Loyalty_Freak_Music_-_09_-_Shoepop.ogg',
  },
  {
    title: 'Hangover',
    artist: 'Loyalty Freak Music',
    audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/ed/Loyalty_Freak_Music_-_10_-_Hangover.ogg',
  },
];

// Siembra idempotente: `$setOnInsert` por título, así una pista ya existente no
// se pisa (podría tener usos contados) y solo se añaden las que falten.
async function seedSounds() {
  const ops = DEFAULT_SOUNDS.map((sound) => ({
    updateOne: {
      filter: { title: sound.title },
      update: { $setOnInsert: sound },
      upsert: true,
    },
  }));

  const result = await Sound.bulkWrite(ops, { ordered: false });
  return result.upsertedCount || 0;
}

module.exports = { seedSounds, DEFAULT_SOUNDS };
