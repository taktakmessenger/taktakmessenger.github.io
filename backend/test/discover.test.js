const test = require('node:test');
const assert = require('node:assert/strict');

// Guardas del buscador externo. Lo importante que se prueba aquí es la parte
// que protege al servidor: el descargador acepta direcciones que manda el
// usuario, así que un fallo en estas comprobaciones convierte la función en un
// túnel hacia la red interna (metadatos del proveedor, servicios privados).
//
// No se llama a las fuentes reales: lo que se prueba es el filtro, no internet.

process.env.NODE_ENV = 'test';
const svc = require('../src/services/discoverService');

test('parseUrl acepta http y https', () => {
  assert.equal(svc.parseUrl('https://example.com/a.mp3').hostname, 'example.com');
  assert.equal(svc.parseUrl('http://example.com/a.mp3').protocol, 'http:');
});

test('parseUrl rechaza esquemas que no son web', () => {
  for (const bad of ['file:///etc/passwd', 'ftp://example.com/x', 'data:text/plain,hola', 'no-es-una-url']) {
    assert.throws(() => svc.parseUrl(bad), /Enlace inválido|Solo se admiten/);
  }
});

test('parseUrl rechaza puertos que no son 80 ni 443', () => {
  assert.throws(() => svc.parseUrl('http://example.com:6379/'), /Puerto no permitido/);
});

test('las direcciones privadas se reconocen como tales', () => {
  const privadas = [
    '127.0.0.1',
    '10.0.0.5',
    '172.16.3.4',
    '192.168.1.10',
    '169.254.169.254', // metadatos de la nube
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fd00::1',
  ];
  for (const ip of privadas) {
    assert.equal(svc.isPrivateIp(ip), true, `${ip} debería ser privada`);
  }
});

test('las direcciones públicas no se marcan como privadas', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700::1111']) {
    assert.equal(svc.isPrivateIp(ip), false, `${ip} debería ser pública`);
  }
});

test('una dirección IPv4 mapeada en IPv6 hereda la comprobación', () => {
  assert.equal(svc.isPrivateIp('::ffff:127.0.0.1'), true);
  assert.equal(svc.isPrivateIp('::ffff:1.1.1.1'), false);
});

test('el buscador no devuelve nada sin término', async () => {
  const res = await svc.search('   ');
  assert.deepEqual(res, { music: [], videos: [] });
});

test('el proxy solo reconoce URLs que salieron de una búsqueda', () => {
  assert.equal(svc.isKnownMediaUrl('https://example.com/desconocido.mp3'), false);
  assert.equal(svc.isKnownMediaUrl(''), false);
});

test('importar una dirección privada se rechaza antes de descargar', async () => {
  await assert.rejects(
    () => svc.importFromUrl('http://169.254.169.254/latest/meta-data', { kind: 'music' }),
    /no apunta a internet/
  );
});

test('importar un esquema no web se rechaza', async () => {
  await assert.rejects(
    () => svc.importFromUrl('file:///etc/passwd', { kind: 'music' }),
    /Solo se admiten enlaces http o https/
  );
});
