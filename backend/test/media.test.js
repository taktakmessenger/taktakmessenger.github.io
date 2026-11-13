const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { Readable } = require('stream');

// Se fija antes de requerir `env` para que el modelo sepa cuál es la base
// pública del bucket y pueda reescribir las URLs.
process.env.NODE_ENV = 'test';
process.env.R2_PUBLIC_BASE_URL = 'https://pub-test.r2.dev';

const storageService = require('../src/services/storageService');
const mediaRoutes = require('../src/routes/media');
const Video = require('../src/models/Video');

function buildApp() {
  const app = express();
  app.use('/media', mediaRoutes);
  // Manejador de errores mínimo, equivalente al real: responde con el status
  // que trae el HttpError.
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

test('el modelo reescribe la escalera HLS al proxy del propio dominio', () => {
  const video = new Video({
    title: 'prueba',
    videoUrl: 'https://pub-test.r2.dev/original.mp4',
    hlsUrl: 'https://pub-test.r2.dev/abc/index.m3u8',
    thumbnailUrl: 'https://pub-test.r2.dev/abc/thumbnail.jpg',
  });
  const json = video.toJSON();
  // El HLS pasa por el proxy (hls.js lo pide por XHR y necesita mismo origen).
  assert.equal(json.hlsUrl, '/media/abc/index.m3u8');
  // El original y la miniatura los carga el navegador directamente, así que se
  // dejan en el bucket: pedirlos al proxy perdería los rangos HTTP.
  assert.equal(json.videoUrl, 'https://pub-test.r2.dev/original.mp4');
  assert.equal(json.thumbnailUrl, 'https://pub-test.r2.dev/abc/thumbnail.jpg');
});

test('el modelo no toca una URL que no es del bucket', () => {
  const video = new Video({
    title: 'local',
    videoUrl: '/uploads/otro.mp4',
    hlsUrl: '/uploads/otro/index.m3u8',
  });
  assert.equal(video.toJSON().hlsUrl, '/uploads/otro/index.m3u8');
  assert.equal(video.toJSON().videoUrl, '/uploads/otro.mp4');
});

test('el proxy devuelve 404 si el almacenamiento externo no está configurado', async () => {
  const original = storageService.isConfigured;
  storageService.isConfigured = () => false;
  const res = await request(buildApp()).get('/media/abc/index.m3u8');
  storageService.isConfigured = original;
  assert.equal(res.status, 404);
});

test('el proxy sirve un segmento del bucket desde el propio dominio', async () => {
  const originalConfigured = storageService.isConfigured;
  const originalStream = storageService.getObjectStream;
  storageService.isConfigured = () => true;
  storageService.getObjectStream = async () => ({
    ContentLength: 5,
    Body: Readable.from(Buffer.from('hello')),
  });

  const res = await request(buildApp()).get('/media/abc/480p/segment_000.ts');

  storageService.isConfigured = originalConfigured;
  storageService.getObjectStream = originalStream;

  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'video/mp2t');
  assert.equal(res.body.toString(), 'hello');
});

test('el proxy rechaza una extensión fuera de la lista', async () => {
  const original = storageService.isConfigured;
  storageService.isConfigured = () => true;
  const res = await request(buildApp()).get('/media/secret.html');
  storageService.isConfigured = original;
  assert.equal(res.status, 400);
});

test('el proxy rechaza el salto de directorio', async () => {
  const original = storageService.isConfigured;
  storageService.isConfigured = () => true;
  const res = await request(buildApp()).get('/media/%2e%2e/secret.mp4');
  storageService.isConfigured = original;
  assert.equal(res.status, 400);
});
