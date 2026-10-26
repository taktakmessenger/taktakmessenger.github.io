const test = require('node:test');
const assert = require('node:assert/strict');
const { isAcceptedVideo } = require('../src/lib/videoUpload');

// El filtro de subida decide por MIME y, cuando este es genérico o no viene,
// por la extensión. Antes solo miraba el MIME y rechazaba vídeos válidos (3GP
// de Android, o cualquier archivo cuyo navegador mandara octet-stream).

test('acepta los MIME de vídeo habituales', () => {
  assert.equal(isAcceptedVideo({ mimetype: 'video/mp4', originalname: 'a.mp4' }), true);
  assert.equal(isAcceptedVideo({ mimetype: 'video/quicktime', originalname: 'a.mov' }), true);
  assert.equal(isAcceptedVideo({ mimetype: 'video/webm', originalname: 'a.webm' }), true);
  assert.equal(isAcceptedVideo({ mimetype: 'video/x-matroska', originalname: 'a.mkv' }), true);
});

test('acepta el 3GP que graban los Android', () => {
  assert.equal(isAcceptedVideo({ mimetype: 'video/3gpp', originalname: 'v.3gp' }), true);
  assert.equal(isAcceptedVideo({ mimetype: 'video/3gpp2', originalname: 'v.3g2' }), true);
});

test('con MIME genérico decide por la extensión', () => {
  assert.equal(
    isAcceptedVideo({ mimetype: 'application/octet-stream', originalname: 'clip.mp4' }),
    true
  );
  assert.equal(isAcceptedVideo({ mimetype: 'application/octet-stream', originalname: 'v.3gp' }), true);
  // Genérico pero sin extensión de vídeo: se rechaza.
  assert.equal(
    isAcceptedVideo({ mimetype: 'application/octet-stream', originalname: 'notas.txt' }),
    false
  );
});

test('sin MIME decide por la extensión', () => {
  assert.equal(isAcceptedVideo({ originalname: 'grabacion.mov' }), true);
  assert.equal(isAcceptedVideo({ mimetype: '', originalname: 'grabacion.mov' }), true);
  assert.equal(isAcceptedVideo({ mimetype: '', originalname: 'grabacion.pdf' }), false);
});

test('rechaza lo que no es vídeo aunque tenga MIME de vídeo falso', () => {
  assert.equal(isAcceptedVideo({ mimetype: 'image/png', originalname: 'foto.png' }), false);
  assert.equal(isAcceptedVideo({ mimetype: 'text/plain', originalname: 'notas.mp4' }), false);
  assert.equal(isAcceptedVideo({ mimetype: 'application/pdf', originalname: 'doc.pdf' }), false);
});

test('no explota sin datos', () => {
  assert.equal(isAcceptedVideo({}), false);
  assert.equal(isAcceptedVideo(), false);
});
