// Regresión: al reiniciar la app, la petición de países falla mientras el
// backend arranca, y el marcador se quedaba sin códigos de área hasta recargar.
//
// El marcador pide la lista una sola vez al montar; antes, si esa llamada
// fallaba, el error se tragaba y no se reintentaba. Aquí se intercepta
// /api/auth/providers para que falle durante los primeros 8 s (como un 502 del
// proxy mientras levanta el backend) y se comprueba que el marcador se recupera
// solo, sin recargar, gracias a los reintentos con espera creciente.
const { loadPuppeteer } = require('./lib/harness');
const puppeteer = loadPuppeteer();

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:12000';
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
  const user = await registrar(`area${stamp}`);

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium', headless: 'new', protocolTimeout: 40000,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
  });
  const page = await browser.newPage();

  // El fallo de arranque: mientras el backend levanta, TODA llamada a
  // providers falla (como un 502 del proxy). Pasados 8 s el backend ya responde,
  // pero el marcador ya montó dentro de la ventana de fallo. Si no reintenta,
  // se queda sin códigos de área aunque el servidor esté sano.
  const failUntil = Date.now() + 8000;
  let providerCalls = 0;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('/api/auth/providers')) {
      providerCalls += 1;
      if (Date.now() < failUntil) {
        // Como un 502 del proxy mientras el backend arranca.
        return req.respond({ status: 502, contentType: 'text/html', body: '<html>Bad Gateway</html>' });
      }
    }
    req.continue();
  });

  // La sesión se inyecta ANTES de que corra ningún script, así que hay una
  // sola carga y una sola llamada a /providers. Con un reload de por medio, la
  // segunda carga enmascararía el fallo y el sondeo no probaría nada.
  await page.evaluateOnNewDocument((t, u) => {
    localStorage.setItem('taktak_token', t);
    localStorage.setItem('taktak_user', JSON.stringify(u));
  }, user.token, user.user);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await sleep(3500);

  // Descartar avisos y entrar al marcador.
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('[role="dialog"], .modal')) {
      const b = [...d.querySelectorAll('button')].find((x) => /ahora no|omitir|despu[eé]s/i.test(x.textContent));
      if (b) b.click();
    }
  });
  await sleep(600);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /WhaTaka/i.test(x.textContent))?.click());
  await sleep(1200);
  await page.evaluate(() => [...document.querySelectorAll('.whataka-tab')].find((x) => /Llamar/i.test(x.textContent))?.click());
  await sleep(1200);

  const dial = await page.evaluate(() => document.querySelector('.dialer-dial')?.textContent?.trim());
  await page.evaluate(() => document.querySelector('.dialer-country-btn')?.click());

  // Se espera a que el selector se pueble: los reintentos van a 1, 2, 4 y 8 s,
  // así que medir a los pocos segundos daría un falso negativo.
  let items = 0;
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000);
    items = await page.evaluate(() => document.querySelectorAll('.dialer-picker-item').length);
    if (items > 200) break;
  }
  const dialAfter = await page.evaluate(() => document.querySelector('.dialer-dial')?.textContent?.trim());

  console.log(`  llamadas a /providers: ${providerCalls}`);
  console.log(`  texto del botón de país al entrar: "${dial}"`);
  console.log(`  texto del botón de país tras reintentar: "${dialAfter}"`);
  console.log(`  países en el selector: ${items}`);

  await browser.close();
  const ok = items > 200;
  console.log(`\n${ok ? '✅' : '❌'} códigos de área tras un fallo de arranque`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALLÓ:', e.message); process.exit(1); });
