const test = require('node:test');
const assert = require('node:assert/strict');
const {
  kindOfExtension,
  safeName,
  storedName,
  attachmentDisposition,
  validateAttachment,
} = require('../src/lib/attachments');

test('clasifica las extensiones por tipo', () => {
  assert.equal(kindOfExtension('.jpg'), 'image');
  assert.equal(kindOfExtension('.PNG'), 'image');
  assert.equal(kindOfExtension('.mp4'), 'video');
  assert.equal(kindOfExtension('.mp3'), 'audio');
  assert.equal(kindOfExtension('.pdf'), 'file');
});

test('rechaza las extensiones que el navegador ejecuta', () => {
  // Un .html o un .svg servidos desde el mismo dominio que la app permitirían
  // ejecutar script en la sesión de quien los abre.
  for (const ext of ['.html', '.svg', '.js', '.xml', '.htm']) {
    assert.equal(kindOfExtension(ext), null, `${ext} no debe aceptarse`);
  }
});

test('una extensión desconocida no se acepta', () => {
  assert.equal(kindOfExtension('.rar'), null);
  assert.equal(kindOfExtension(''), null);
  assert.equal(kindOfExtension(null), null);
});

test('el nombre se limpia de rutas y caracteres peligrosos', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('/etc/shadow'), 'shadow');
  assert.equal(safeName('foto normal.jpg'), 'foto_normal.jpg');
  // Las comillas y los saltos de línea romperían la cabecera de descarga.
  assert.equal(safeName('a"b.txt'), 'a_b.txt');
  assert.equal(safeName('a\nb.txt'), 'ab.txt');
});

test('el nombre conserva acentos y eñe', () => {
  // Borrarlos dejaría el nombre irreconocible para quien recibe el archivo.
  assert.equal(safeName('añó.pdf'), 'añó.pdf');
  assert.equal(safeName('presupuesto año 2026.xlsx'), 'presupuesto_año_2026.xlsx');
});

test('un nombre que solo tiene puntos no se queda vacío', () => {
  assert.equal(safeName('..'), '_');
  assert.equal(safeName(''), 'archivo');
  assert.equal(safeName(null), 'archivo');
});

test('el nombre en disco es único y conserva la extensión', () => {
  const a = storedName('foto.JPG');
  const b = storedName('foto.JPG');
  assert.notEqual(a, b, 'dos subidas del mismo nombre no deben chocar');
  assert.ok(a.endsWith('.jpg'), `debe conservar la extensión: ${a}`);
});

test('la cabecera de descarga marca en línea solo lo seguro', () => {
  assert.match(attachmentDisposition('image', 'a.png'), /^inline;/);
  assert.match(attachmentDisposition('video', 'a.mp4'), /^inline;/);
  assert.match(attachmentDisposition('audio', 'a.mp3'), /^inline;/);
  // Un PDF o un ZIP se descargan, no se muestran.
  assert.match(attachmentDisposition('file', 'a.pdf'), /^attachment;/);
});

test('la cabecera de descarga neutraliza comillas y acentos', () => {
  const header = attachmentDisposition('file', 'in"forme\x01.pdf');
  assert.ok(!header.includes('"informe'), 'las comillas deben ir escapadas o limpias');
  // El nombre UTF-8 va codificado para no romper la cabecera.
  const accented = attachmentDisposition('file', 'añó.pdf');
  assert.match(accented, /filename\*=UTF-8''a%C3%B1%C3%B3\.pdf/);
});

test('validateAttachment acepta un archivo permitido', () => {
  const result = validateAttachment({ originalname: 'foto.png', size: 1024 });
  assert.equal(result.kind, 'image');
  assert.equal(result.ext, '.png');
});

test('validateAttachment rechaza un HTML por seguridad', () => {
  assert.throws(
    () => validateAttachment({ originalname: 'malo.html', size: 10 }),
    /no está permitido por seguridad/
  );
});

test('validateAttachment rechaza un tipo no soportado', () => {
  assert.throws(
    () => validateAttachment({ originalname: 'cosa.rar', size: 10 }),
    /no soportado/
  );
});

test('validateAttachment aplica el límite de cada tipo', () => {
  // 11 MB: pasa para un vídeo, no para una imagen.
  const grande = { originalname: 'x.png', size: 11 * 1024 * 1024 };
  assert.throws(() => validateAttachment(grande), /máximo de 10 MB/);

  const video = { originalname: 'x.mp4', size: 11 * 1024 * 1024 };
  assert.equal(validateAttachment(video).kind, 'video');
});

test('validateAttachment sin archivo falla en claro', () => {
  assert.throws(() => validateAttachment(null), /No se recibió ningún archivo/);
});
