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

test('el filtro de la marca la ancla abajo a la izquierda y lee de un fichero', () => {
  const filter = watermarkFilter('/fonts/A.ttf', '/tmp/brand.txt', ['@ana', 'TAK TAK'], 480, 854);
  assert.match(filter, /drawtext=/);
  assert.match(filter, /textfile=\/tmp\/brand\.txt/);
  assert.match(filter, /text_align=left/);
  assert.match(filter, /x=\d+/);
  assert.match(filter, /y=h-th-\d+/);
});

test('la placa es casi opaca para poder tapar la marca que traiga el vídeo', () => {
  // Una placa translúcida deja ver a través el logo ajeno, que es justo lo que
  // se quiere tapar.
  const filter = watermarkFilter('/fonts/A.ttf', '/tmp/brand.txt', ['@ana', 'TAK TAK'], 480, 854);
  const alpha = Number(filter.match(/boxcolor=0x[0-9a-f]+@([\d.]+)/i)[1]);
  assert.ok(alpha >= 0.9, `la opacidad ${alpha} deja ver la marca de debajo`);
});

test('un nombre de usuario largo encoge la letra en vez de salirse del cuadro', () => {
  const width = 480;
  const short = watermarkFilter('/f.ttf', '/t.txt', ['@ana', 'TAK TAK'], width, 854);
  const long = watermarkFilter('/f.ttf', '/t.txt', [`@${'x'.repeat(30)}`, 'TAK TAK'], width, 854);
  const sizeOf = (f) => Number(f.match(/fontsize=(\d+)/)[1]);
  assert.ok(sizeOf(long) < sizeOf(short), 'con un nombre largo la letra debe encoger');
  // El ancho estimado de la línea más larga cabe dentro del cuadro.
  const estimated = 31 * sizeOf(long) * 0.62;
  assert.ok(estimated <= width * 0.75, `la línea ocuparía ${Math.round(estimated)}px de ${width}`);
});

test('las opciones de limpieza borran los metadatos y la firma del muxer', () => {
  assert.deepEqual(CLEAN_METADATA_OPTIONS.slice(0, 2), ['-map_metadata', '-1']);
  assert.ok(CLEAN_METADATA_OPTIONS.includes('+bitexact'));
});
