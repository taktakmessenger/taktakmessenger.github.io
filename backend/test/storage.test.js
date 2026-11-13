const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// El servicio de almacenamiento se prueba en modo local: sin las variables
// `R2_*`, `isConfigured()` es false y todo se comporta como antes. Las funciones
// puras (tipo de contenido, composición de URL) no necesitan red ni bucket.
process.env.NODE_ENV = 'test';
delete process.env.R2_ENDPOINT;
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
delete process.env.R2_BUCKET;
delete process.env.R2_PUBLIC_BASE_URL;

const storage = require('../src/services/storageService');

test('sin configuración de bucket, isConfigured es false', () => {
  assert.equal(storage.isConfigured(), false);
});

test('deduce el Content-Type por extensión, que es lo que hace reproducible el vídeo', () => {
  assert.equal(storage.contentTypeFor('v/480p/segment0.ts'), 'video/mp2t');
  assert.equal(storage.contentTypeFor('v/index.m3u8'), 'application/vnd.apple.mpegurl');
  assert.equal(storage.contentTypeFor('original.mp4'), 'video/mp4');
  assert.equal(storage.contentTypeFor('thumbnail.jpg'), 'image/jpeg');
  // Desconocido: genérico, nunca adivinado.
  assert.equal(storage.contentTypeFor('raro.xyz'), 'application/octet-stream');
});

test('publicUrl no duplica la barra ni arrastra las de la clave', () => {
  const env = require('../src/config/env');
  const saved = { ...env.r2 };
  env.r2.publicBaseUrl = 'https://pub-abc.r2.dev';
  try {
    assert.equal(storage.publicUrl('v/index.m3u8'), 'https://pub-abc.r2.dev/v/index.m3u8');
    assert.equal(storage.publicUrl('/v/index.m3u8'), 'https://pub-abc.r2.dev/v/index.m3u8');
  } finally {
    Object.assign(env.r2, saved);
  }
});

test('con las cinco variables puestas, el bucket queda configurado', () => {
  const env = require('../src/config/env');
  const saved = { ...env.r2 };
  Object.assign(env.r2, {
    endpoint: 'https://x.r2.cloudflarestorage.com',
    accessKeyId: 'a',
    secretAccessKey: 'b',
    bucket: 'taktak',
    publicBaseUrl: 'https://pub-abc.r2.dev',
  });
  try {
    assert.equal(storage.isConfigured(), true);
  } finally {
    Object.assign(env.r2, saved);
  }
  assert.equal(storage.isConfigured(), false);
});
