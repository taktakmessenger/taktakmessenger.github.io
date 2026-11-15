// La mezcla de música en los vídeos. El filtro de ffmpeg es una función pura,
// así que se prueba aquí sin depender de que ffmpeg esté instalado; el pipeline
// completo (música audible en el HLS) se comprueba en scripts/e2e-video-hls.sh.
const test = require('node:test');
const assert = require('node:assert/strict');
const { musicMixFilter, resolveMusicUrl, fetchRemoteAudio } = require('../src/services/transcodeService');
const { DEFAULT_SOUNDS } = require('../src/services/soundCatalog');

test('el filtro mezcla el audio original con la música', () => {
  const filter = musicMixFilter();
  assert.match(filter, /\[0:a\]/);
  assert.match(filter, /\[1:a\]/);
  assert.match(filter, /amix=inputs=2/);
  // Sin normalize=0, amix divide cada fuente y la mezcla sale más floja.
  assert.match(filter, /normalize=0/);
  // La música se corta a la duración del vídeo, no al revés.
  assert.match(filter, /duration=first/);
});

test('la música baja de volumen y la voz del vídeo no', () => {
  const filter = musicMixFilter();
  assert.match(filter, /\[0:a\]volume=1\.0/);
  assert.match(filter, /\[1:a\]volume=0\.5/);
});

test('sin música no hay URL que resolver', async () => {
  assert.equal(await resolveMusicUrl(null), null);
  assert.equal(await resolveMusicUrl({}), null);
  assert.equal(await resolveMusicUrl({ sound: null }), null);
});

test('una pista ya poblada devuelve su URL sin consultar la base', async () => {
  const url = await resolveMusicUrl({ sound: { audioUrl: 'https://cdn.example.com/a.mp3' } });
  assert.equal(url, 'https://cdn.example.com/a.mp3');
});

test('el catálogo son pistas CC0 con URL de audio', () => {
  assert.ok(DEFAULT_SOUNDS.length >= 4, 'debe haber varias pistas para elegir');
  for (const sound of DEFAULT_SOUNDS) {
    assert.ok(sound.title, 'cada pista necesita título');
    assert.ok(sound.artist, 'cada pista necesita artista');
    assert.match(sound.audioUrl, /^https:\/\/upload\.wikimedia\.org\//);
  }
  const titles = DEFAULT_SOUNDS.map((s) => s.title);
  assert.equal(new Set(titles).size, titles.length, 'los títulos no se repiten');
});

test('una URL de audio inválida no rompe la descarga', async () => {
  const result = await fetchRemoteAudio('https://invalid.invalid/nope.mp3', '/tmp/taktak-test');
  assert.equal(result, null);
});
