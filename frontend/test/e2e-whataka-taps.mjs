// Regresión de WhaTaka: los avisos flotantes no deben robar el toque a los
// controles del chat ni del marcador.
//
// El fallo original era invisible desde la API: el aviso "Activa las
// notificaciones" es una tarjeta anclada abajo y se dibujaba sobre el
// compositor, el botón de llamar y la lista de países. El toque lo recibía el
// aviso, así que "Enviar" parecía muerto y el selector de país "no abría".
// Nada de eso da error de consola: solo deja de responder.
//
// Aquí se comprueba con `elementFromPoint`, que es lo mismo que hace el
// navegador para repartir el toque. Es determinista y no depende de esperas.
//
// Uso: E2E_BASE_URL=http://127.0.0.1:12000 node test/e2e-whataka-taps.mjs
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:12000';
const stamp = Date.now();

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function register(username) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@e.com`, password: 'secret123' }),
  });
  const data = await res.json().catch(() => null);
  if (!data?.token) {
    // Lo más habitual aquí no es un fallo de la app: `authLimiter` corta el
    // registro a 20 por IP cada 15 minutos. Reiniciar el backend lo limpia.
    throw new Error(`no se pudo registrar ${username}: HTTP ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

// ¿El elemento del selector recibiría el toque en su centro?
async function receivesTap(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { found: true, clickable: false, reason: 'sin tamaño' };
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const mine = el === top || el.contains(top);
    const describe = (n) =>
      n ? `${n.tagName.toLowerCase()}${n.className ? '.' + String(n.className).split(' ').join('.') : ''}` : 'null';
    return { found: true, clickable: mine, coveredBy: mine ? null : describe(top) };
  }, selector);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

try {
  const a = await register(`tap_a_${stamp}`);
  const b = await register(`tap_b_${stamp}`);
  await fetch(`${BASE}/api/messages/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` },
    body: JSON.stringify({ userId: b.user.id }),
  });

  await page.goto(BASE);
  await page.evaluate(([token, user]) => {
    localStorage.setItem('taktak_token', token);
    localStorage.setItem('taktak_user', JSON.stringify(user));
  }, [a.token, a.user]);
  await page.reload();
  await page.waitForTimeout(1500);

  // Se descarta el aviso del teléfono (ese sí es un modal real), pero se deja
  // a propósito el aviso de notificaciones: es el que causaba el bloqueo.
  await page.evaluate(() => {
    [...document.querySelectorAll('.modal button')]
      .find((b) => /ahora no/i.test(b.textContent))
      ?.click();
  });
  await page.waitForTimeout(500);

  console.log('\n▸ Aviso de notificaciones (sobre el feed)');
  // `pointer-events: none` deja pasar el toque, pero no debe dejar inertes los
  // botones del propio aviso: si no, el usuario no puede activar nada.
  const promptVisible = await page.locator('.notif-prompt').count();
  check('el aviso se ofrece al entrar', promptVisible === 1);
  if (promptVisible) {
    const activate = await receivesTap(page, '.notif-prompt-actions .btn-primary');
    check('el botón Activar del aviso recibe el toque', activate.found && activate.clickable, activate.coveredBy || '');
    const later = await receivesTap(page, '.notif-prompt-actions .btn-ghost');
    check('el botón Ahora no del aviso recibe el toque', later.found && later.clickable, later.coveredBy || '');
  }
  // A propósito NO se descarta el aviso todavía: así el resto del recorrido
  // (chat y marcador) se hace con el aviso presente, que es como aparecía el
  // fallo. Se cierra al final, comprobando que su botón responde de verdad.

  console.log('\n▸ Chat (WhaTaka)');
  await page.getByRole('button', { name: 'WhaTaka' }).click();
  await page.waitForTimeout(900);
  await page.locator('button.conversation-item').first().click();
  await page.waitForTimeout(1500);

  const composer = await receivesTap(page, '.thread-composer input[type="text"]');
  check('el campo de mensaje recibe el toque', composer.found && composer.clickable, composer.coveredBy || '');
  const send = await receivesTap(page, '.thread-composer button[type="submit"]');
  check('el botón Enviar recibe el toque', send.found && send.clickable, send.coveredBy || '');

  // Y de verdad se envía, no solo es clicable.
  await page.fill('.thread-composer input[type="text"]', 'prueba de regresión');
  await page.click('.thread-composer button[type="submit"]');
  await page.waitForTimeout(2000);
  const sent = await page.evaluate(() =>
    [...document.querySelectorAll('.bubble-row.mine .bubble')].some((x) =>
      x.textContent.includes('prueba de regresión')
    )
  );
  check('el mensaje se envía y aparece en el hilo', sent);

  console.log('\n▸ Marcador');
  await page.evaluate(() => document.querySelector('.thread-header .btn-ghost')?.click());
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Llamar/ }).click();
  await page.waitForTimeout(900);

  const country = await receivesTap(page, '.dialer-country-btn');
  check('el botón de país recibe el toque', country.found && country.clickable, country.coveredBy || '');
  const dial = await receivesTap(page, '.dialer-call');
  check('el botón de llamar recibe el toque', dial.found && dial.clickable, dial.coveredBy || '');

  // El selector de país abre y se puede elegir otro prefijo.
  await page.click('.dialer-country-btn');
  await page.waitForTimeout(500);
  const items = await page.locator('.dialer-picker-item').count();
  check(`el selector de país abre con ${items} países`, items > 200);
  await page.fill('.dialer-picker-search', 'España');
  await page.waitForTimeout(400);
  await page.locator('.dialer-picker-item').first().click();
  await page.waitForTimeout(400);
  const dialCode = await page.locator('.dialer-dial').textContent();
  check(`elegir España fija el prefijo +34 (quedó ${dialCode})`, dialCode === '+34');

  // El aviso de notificaciones no debe dibujarse sobre WhaTaka.
  const promptInMessages = await page.locator('.notif-prompt').count();
  check('el aviso de notificaciones no se dibuja en WhaTaka', promptInMessages === 0);

  console.log('\n▸ El aviso sigue vivo y responde');
  // Se vuelve al feed: el aviso reaparece y se cierra con un clic real. Si
  // `pointer-events: none` hubiese dejado inertes sus botones, esto no pasaría.
  await page.getByRole('button', { name: 'Inicio' }).click();
  await page.waitForTimeout(700);
  await page.click('.notif-prompt-actions .btn-ghost');
  await page.waitForTimeout(400);
  check('el botón Ahora no del aviso responde y lo cierra', (await page.locator('.notif-prompt').count()) === 0);
} finally {
  await browser.close();
}
console.log(`\n${failures === 0 ? '✅' : '❌'} Toques de WhaTaka: ${failures} fallo(s)`);
process.exit(failures === 0 ? 0 : 1);
