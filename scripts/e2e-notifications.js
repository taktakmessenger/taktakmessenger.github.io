// Verificación puntual del aviso de notificaciones y del tono de llamada.
// Se ejecuta a mano mientras se desarrolla; no es parte de la suite.
const { loadPuppeteer } = require('./lib/harness');

const puppeteer = loadPuppeteer();
const APP = process.env.APP || 'http://localhost:12000';
const API = process.env.API || 'http://localhost:4000/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ✗ ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

async function api(p, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 420, height: 860 });

  const suffix = Date.now().toString(36).slice(-6);
  const user = { username: `ntf_${suffix}`, email: `ntf_${suffix}@example.com`, password: 'secret123' };
  const reg = await api('/auth/register', { method: 'POST', body: user });
  check(reg.status === 201, 'cuenta de prueba creada');

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t, u) => {
    localStorage.setItem('taktak_token', t);
    localStorage.setItem('taktak_user', JSON.stringify(u));
  }, reg.data.token, reg.data.user);
  // Sin permiso concedido: es el estado de un dispositivo nuevo.
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);

  console.log('\n▸ Aviso de notificaciones');
  const hasPrompt = await page.evaluate(() => !!document.querySelector('.notif-prompt'));
  check(hasPrompt, 'aparece el aviso "Activa las notificaciones"');

  const hasWhatsappText = await page.evaluate(() =>
    document.querySelector('.notif-prompt')?.innerText.includes('como WhatsApp')
  );
  check(hasWhatsappText, 'explica que sonará aunque la app esté cerrada');

  // Con el permiso ya concedido (simula que el usuario lo aceptó), el aviso no
  // debe volver a molestar: ya no hay nada que pedir.
  await ctx.overridePermissions(APP, ['notifications']);
  await page.evaluate((u) => localStorage.removeItem(`taktak_push_prompt_${u.id}`), reg.data.user);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  const promptGone = await page.evaluate(() => !document.querySelector('.notif-prompt'));
  check(promptGone, 'con el permiso ya concedido no se muestra el aviso');

  // Y la suscripción real debe llegar al servidor. Chromium headless no tiene
  // servicio push (no hay FCM), así que en este entorno `subscribe` falla con
  // "permission denied" aunque el permiso esté concedido. Eso es una limitación
  // del navegador de prueba, no de la app: se reporta como omitido para no dar
  // un falso negativo. El camino de servidor lo cubre backend/test/push-calls.
  const subscribed = await page.evaluate(async () => {
    try {
      const mod = await import('/src/services/push.js');
      const r = await mod.subscribeToPush();
      return { ...r, headless: /HeadlessChrome/.test(navigator.userAgent) };
    } catch (e) {
      return { ok: false, reason: `excepción: ${e.message}` };
    }
  });
  if (subscribed?.ok) {
    ok('la suscripción push se completa con permiso concedido');
  } else if (subscribed?.headless) {
    console.log('  ⚠ suscripción omitida: Chromium headless no tiene servicio push');
  } else {
    bad(`la suscripción push falló: ${JSON.stringify(subscribed)}`);
  }

  await browser.close();
  console.log(`\n${fail === 0 ? '✅' : '❌'} Notificaciones: ${pass} ok, ${fail} fallos`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('fallo inesperado:', e);
  process.exit(1);
});
