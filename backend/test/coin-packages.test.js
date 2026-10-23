const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');

// La guarda de margen vive en el arranque de la configuración, que se evalúa
// una sola vez por proceso. Para probar variantes de COIN_PACKAGES sin tocar el
// módulo ya cacheado, se carga la configuración en un proceso hijo.
const ENV_PATH = path.join(__dirname, '..', 'src', 'config', 'env.js');
const BACKEND_DIR = path.join(__dirname, '..');

function loadEnvWith(packages) {
  const script = `
    try {
      const env = require(${JSON.stringify(ENV_PATH)});
      process.stdout.write(JSON.stringify({ ok: true, packages: env.coinPackages }));
    } catch (err) {
      process.stdout.write(JSON.stringify({ ok: false, message: err.message }));
    }
  `;
  const childEnv = { ...process.env, JWT_SECRET: 'test-secret' };
  if (packages) childEnv.COIN_PACKAGES = JSON.stringify(packages);
  else delete childEnv.COIN_PACKAGES;

  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: BACKEND_DIR,
    env: childEnv,
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

// El caso que rompía el modelo: vender el TTC por debajo de lo que cuesta
// retirarlo. Con la tasa de retiro en $0,01, el suelo es $0,01.
test('un paquete por debajo del suelo de pago se rechaza al arrancar', () => {
  const res = loadEnvWith([{ id: 'barato', coins: 1000, priceUsd: 4.99 }]);
  assert.equal(res.ok, false);
  assert.match(res.message, /barato/);
  assert.match(res.message, /beneficio/);
});

test('un paquete justo en el suelo se acepta', () => {
  const res = loadEnvWith([{ id: 'limite', coins: 1000, priceUsd: 10.0 }]);
  assert.equal(res.ok, true);
  assert.equal(res.packages[0].id, 'limite');
});

// El caso que el suelo antiguo dejaba pasar: por encima del pago al creador
// ($0,006) pero por debajo del retiro ($0,01). Con la conversión C→R daría
// beneficio, así que ahora debe rechazarse.
test('un paquete por encima del pago al creador pero bajo el retiro se rechaza', () => {
  const res = loadEnvWith([{ id: 'trampa', coins: 20000, priceUsd: 169.99 }]);
  assert.equal(res.ok, false);
  assert.match(res.message, /trampa/);
});

test('el catálogo por defecto supera el suelo en todos sus paquetes', () => {
  const res = loadEnvWith(undefined);
  assert.equal(res.ok, true);
  assert.equal(res.packages.length, 4);
  // El suelo es ttcUsdRate = $0,01.
  for (const pkg of res.packages) {
    assert.ok(
      pkg.priceUsd / pkg.coins >= 0.01,
      `el paquete ${pkg.id} vende el TTC por debajo del suelo`
    );
  }
});

// La escalera de precios debe bajar con el tamaño: si un paquete grande costara
// más por moneda que uno pequeño, nadie compraría el grande y la escalera
// quedaría invertida.
test('el precio por TTC baja al subir de paquete', () => {
  const res = loadEnvWith(undefined);
  const perCoin = res.packages.map((p) => p.priceUsd / p.coins);
  for (let i = 1; i < perCoin.length; i += 1) {
    assert.ok(
      perCoin[i] < perCoin[i - 1],
      `el paquete ${res.packages[i].id} no es más barato por TTC que el anterior`
    );
  }
});
