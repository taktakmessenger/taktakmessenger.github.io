// Los ayudantes de la marca de TAK TAK son funciones puras y se prueban aquí.
// El pipeline completo (ffmpeg de verdad, metadatos borrados y marca visible)
// se comprueba de extremo a extremo en scripts/e2e-video-hls.sh, porque los
// tests de la API no deben depender de que ffmpeg esté instalado.
const test = require('node:test');
const assert = require('node:assert/strict');
const { brandText, watermarkFilter, CLEAN_METADATA_OPTIONS } = require('../src/services/transcodeService');

test('la marca lleva el @usuario y el nombre TAK TAK', () => {
  assert.equal(brandText('ana'), '@ana\nTAK TAK\n');
});

test('sin usuario la marca sigue diciendo TAK TAK', () => {
  assert.equal(brandText(''), 'TAK TAK\n');
  assert.equal(brandText(null), 'TAK TAK\n');
});

test('un nombre con caracteres que romperían el filtro se sanea', () => {
  // Dos puntos, comas, porcentajes y comillas tienen significado dentro de una
  // cadena de filtros de ffmpeg; si se colaran, el comando fallaría.
  const out = brandText('a:b,c%d\'e f');
  assert.equal(out, '@abcdef\nTAK TAK\n');
  assert.ok(!out.includes(':'));
  assert.ok(!out.includes(','));
  assert.ok(!out.includes('%'));
});

test('un nombre desmesurado se recorta', () => {
  const out = brandText('x'.repeat(200));
  assert.equal(out.split('\n')[0], `@${'x'.repeat(40)}`);
});

test('el filtro de la marca centra el texto abajo y lee de un fichero', () => {
  const filter = watermarkFilter('/fonts/A.ttf', '/tmp/brand.txt', 854);
  assert.match(filter, /drawtext=/);
  assert.match(filter, /textfile=\/tmp\/brand\.txt/);
  assert.match(filter, /x=\(w-text_w\)\/2/);
  assert.match(filter, /y=h-th-/);
  // El tamaño escala con la altura para leerse igual en cualquier resolución.
  const small = watermarkFilter('/fonts/A.ttf', '/tmp/brand.txt', 480);
  assert.notEqual(filter, small);
});

test('las opciones de limpieza borran los metadatos y la firma del muxer', () => {
  assert.deepEqual(CLEAN_METADATA_OPTIONS.slice(0, 2), ['-map_metadata', '-1']);
  assert.ok(CLEAN_METADATA_OPTIONS.includes('+bitexact'));
});
