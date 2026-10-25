// Regresión: la "señal" que se caía al caducar el token.
//
// Antes, el token de acceso duraba una hora y el refresco se guardaba pero nunca
// se canjeaba. Al caducar, las peticiones daban 401, el interceptor borraba la
// sesión y el socket rechazaba el handshake con "Token inválido" reintentando en
// vano para siempre. La app quedaba "sin señal" hasta volver a entrar.
//
// Aquí se comprueba, con un navegador real, que con un token CADUCADO y un
// refresco válido la app se recupera sola: renueva la sesión y el socket vuelve.
const { loadPuppeteer } = require('./lib/harness');
const puppeteer = loadPuppeteer();
const path = require('node:path');

const jwt = require(require.resolve('jsonwebtoken', {
  paths: [path.join(__dirname, '..', 'backend')],
}));

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:12000';
const SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function registrar(nombre) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: nombre, email: `${nombre}@e.com`, password: 'secret123' }),
  });
  return res.json();
}

(async () => {
  const stamp = Date.now().toString(36).slice(-6);
  const user = await registrar(`sig${stamp}`);

  // Token caducado hace una hora, con el mismo secreto: el servidor lo rechaza
  // por vencido, no por firma. Es exactamente el estado de una sesión abierta
  // desde hace días.
  const caducado = jwt.sign(
    { userId: user.user.id, username: user.user.username },
    SECRET,
    { expiresIn: '-1h' }
  );

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    protocolTimeout: 90000,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t, u, r) => {
    localStorage.setItem('taktak_token', t);
    localStorage.setItem('taktak_user', JSON.stringify(u));
    localStorage.setItem('taktak_refresh', r);
  }, caducado, user.user, user.refreshToken);

  // El socket va por WebSocket, y un WebSocket no genera eventos `response`
  // HTTP: hay que mirar los fotogramas por CDP. El servidor manda un fotograma
  // que empieza por "40" cuando el namespace conecta (sesión aceptada) y un "44"
  // (connect_error) cuando rechaza el token.
  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');
  let wsCreados = 0;
  let namespaceConectado = 0;
  let rechazos = 0;
  cdp.on('Network.webSocketCreated', (e) => {
    if (e.url.includes('/socket.io/')) wsCreados += 1;
  });
  cdp.on('Network.webSocketFrameReceived', (e) => {
    const d = e.response.payloadData || '';
    if (d.startsWith('40')) namespaceConectado += 1;
    if (d.startsWith('44') || /inv[aá]lido/i.test(d)) rechazos += 1;
  });

  let tokenRenovado = false;
  page.on('response', (res) => {
    if (res.url().includes('/api/auth/refresh') && res.status() === 200) tokenRenovado = true;
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // Se espera a que la app se recupere sola: el token se renueva y el socket
  // vuelve a conectar con él. Sin el arreglo, el socket nunca reconecta.
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000);
    if (tokenRenovado && namespaceConectado > 0) break;
  }

  const tokenFinal = await page.evaluate(() => localStorage.getItem('taktak_token'));
  await browser.close();

  console.log(`  renovó el token: ${tokenRenovado}`);
  console.log(`  sockets abiertos: ${wsCreados}`);
  console.log(`  namespace conectado (sesión aceptada): ${namespaceConectado}`);
  console.log(`  rechazos por token inválido: ${rechazos}`);
  console.log(`  token en almacén cambió: ${tokenFinal !== caducado}`);

  const ok = tokenRenovado && namespaceConectado > 0 && tokenFinal !== caducado;
  console.log(`\n${ok ? '✅' : '❌'} la señal se recupera sola con el token caducado`);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('FALLÓ:', e.message);
  process.exit(1);
});
