import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCount } from '../src/lib/format.js';
import { attachVideoSource } from '../src/lib/video.js';

test('formatCount deja los números pequeños tal cual', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(7), '7');
  assert.equal(formatCount(999), '999');
});

test('formatCount abrevia miles con una cifra decimal', () => {
  assert.equal(formatCount(1000), '1 mil');
  assert.equal(formatCount(1200), '1,2 mil');
  assert.equal(formatCount(12345), '12 mil');
  assert.equal(formatCount(1500000), '1,5 M');
  assert.equal(formatCount(2000000), '2 M');
});

test('formatCount tolera valores vacíos o basura', () => {
  assert.equal(formatCount(undefined), '0');
  assert.equal(formatCount(null), '0');
  assert.equal(formatCount('no es un número'), '0');
  assert.equal(formatCount('1500'), '1,5 mil');
});

test('attachVideoSource reproduce un fichero suelto directamente', () => {
  const el = { src: '', canPlayType: () => '' };
  const detach = attachVideoSource(el, { videoUrl: '/uploads/v.mp4' });
  assert.equal(el.src, '/uploads/v.mp4');
  // Sin hls.js no hay nada que destruir, pero la limpieza existe igual.
  assert.equal(typeof detach, 'function');
  assert.doesNotThrow(() => detach());
});

test('attachVideoSource prefiere la escalera HLS al original', async () => {
  const el = { src: '/uploads/original.mp4', canPlayType: () => '' };
  const detach = attachVideoSource(el, {
    videoUrl: '/uploads/original.mp4',
    hlsUrl: '/uploads/hls/master.m3u8',
  });
  // Hasta que hls.js se cargue (import dinámico), el original sigue puesto: si
  // se borrara antes, el vídeo parpadearía a negro.
  assert.equal(el.src, '/uploads/original.mp4');
  assert.equal(typeof detach, 'function');
  assert.doesNotThrow(() => detach());
});

test('attachVideoSource no falla sin elemento ni vídeo', () => {
  assert.equal(typeof attachVideoSource(null, { videoUrl: '/x.mp4' }), 'function');
  assert.equal(typeof attachVideoSource({}, null), 'function');
  assert.doesNotThrow(() => attachVideoSource(null, null)());
});
