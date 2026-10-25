// Regresión de la mensajería estilo WhatsApp con dos navegadores reales.
//
// Comprueba lo que no se ve desde la API: que el estado del interlocutor
// (en línea / última vez), el aviso de "escribiendo…" y los ticks de
// enviado/entregado/leído se pintan y cambian en vivo entre dos sesiones.
//
// Requisitos: `puppeteer-core` instalado y Chromium del sistema.
// Uso: node scripts/e2e-messaging.js
const { loadPuppeteer } = require('./lib/harness');

const puppeteer = loadPuppeteer();

const APP = process.env.APP || 'http://localhost:12000';
const API = process.env.API || 'http://localhost:4000/api';
const SUFFIX = Date.now().toString(36).slice(-6);

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ✗ ${m}`); };
const check = (cond, m) => (cond ? ok(m) : bad(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function clickByText(page, text) {
  const needle = text.toLowerCase();
  return page.evaluate((t) => {
    const els = [...document.querySelectorAll('button, a')];
    const norm = (e) =>
      `${e.textContent.trim()} ${e.getAttribute('aria-label') || ''}`.toLowerCase();
    const el = els.find((e) => norm(e).trim() === t) || els.find((e) => norm(e).includes(t));
    if (el) { el.click(); return true; }
    return false;
  }, needle);
}

async function newCtx(browser, token, user) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 420, height: 860 });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t, u) => {
    localStorage.setItem('taktak_token', t);
    localStorage.setItem('taktak_user', JSON.stringify(u));
  }, token, user);
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Una cuenta recién creada recibe el modal "¿Añades tu teléfono?", que es
  // bloqueante de verdad. Se descarta como haría una persona; si no, el clic
  // sobre la bandeja no llegaría nunca al chat.
  await sleep(1500);
  await page.evaluate(() => {
    [...document.querySelectorAll('.modal button')]
      .find((b) => /ahora no/i.test(b.textContent))
      ?.click();
  });
  await sleep(400);
  return page;
}

// Abre el primer chat de la bandeja y espera a que el hilo esté montado.
async function openThread(page) {
  await clickByText(page, 'WhaTaka');
  await page.waitForSelector('button.conversation-item', { timeout: 20000 });
  await page.click('button.conversation-item');
  await page.waitForSelector('.thread-composer input[type="text"]', { timeout: 15000 });
  await sleep(800);
}

// Texto del estado bajo el nombre en la cabecera del hilo.
async function peerStatus(page) {
  return page.evaluate(() => document.querySelector('.thread-peer-id small')?.textContent || '');
}

// Ticks del último mensaje propio (los que ve quien escribe).
async function lastTicks(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('.bubble-row.mine .ticks')];
    const el = rows[rows.length - 1];
    if (!el) return null;
    return { text: el.textContent, read: el.classList.contains('read') };
  });
}

(async () => {
  const aName = `amg${SUFFIX}`;
  const bName = `bmg${SUFFIX}`;
  const a = (await api('/auth/register', { method: 'POST', body: { username: aName, email: `${aName}@e.com`, password: 'secret123' } })).data;
  const b = (await api('/auth/register', { method: 'POST', body: { username: bName, email: `${bName}@e.com`, password: 'secret123' } })).data;
  if (!a?.token || !b?.token) { bad('no se pudieron crear las cuentas de prueba'); process.exit(1); }

  const conv = (await api('/messages/conversations', { method: 'POST', token: a.token, body: { userId: b.user.id } })).data;
  const convId = conv?.conversationId;
  if (!convId) { bad('no se pudo crear la conversación'); process.exit(1); }
  ok('cuentas y conversación creadas');

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 420, height: 860 },
  });

  const pageA = await newCtx(browser, a.token, a.user);
  const pageB = await newCtx(browser, b.token, b.user);
  const errors = [];
  pageA.on('pageerror', (e) => errors.push(`A: ${e.message}`));
  pageB.on('pageerror', (e) => errors.push(`B: ${e.message}`));

  try {
    // --- Bandeja ---------------------------------------------------------
    console.log('\n▸ Bandeja de entrada');
    await clickByText(pageA, 'WhaTaka');
    await pageA.waitForSelector('button.conversation-item', { timeout: 20000 });
    ok('la bandeja carga la conversación');
    const hasSearch = await pageA.$('.inbox-search');
    check(Boolean(hasSearch), 'la bandeja tiene buscador de chats');
    const hasNew = await pageA.$('.btn-new-chat');
    check(Boolean(hasNew), 'la bandeja tiene botón de nuevo chat');

    // --- Hilo y presencia ------------------------------------------------
    console.log('\n▸ Hilo y presencia');
    await openThread(pageA);
    await openThread(pageB);
    ok('los dos hilos se abren');

    // B está conectado (tiene un socket abierto), así que A debe verlo en línea.
    await pageA.waitForFunction(
      () => /en línea/i.test(document.querySelector('.thread-peer-id small')?.textContent || ''),
      { timeout: 15000 }
    ).then(() => ok('A ve a B "en línea"'))
      .catch(async () => bad(`A no ve a B en línea (ve "${await peerStatus(pageA)}")`));

    // --- Escribiendo… ----------------------------------------------------
    console.log('\n▸ Aviso de "escribiendo…"');
    await pageB.click('.thread-composer input[type="text"]');
    await pageB.type('.thread-composer input[type="text"]', 'te escribo algo');
    try {
      await pageA.waitForFunction(
        () => /escribiendo/i.test(document.querySelector('.thread-peer-id small')?.textContent || ''),
        { timeout: 12000 }
      );
      ok('A ve "escribiendo…" mientras B teclea');
    } catch {
      bad('A no vio el aviso de escritura');
    }
    const typingBubble = await pageA.$('.typing-bubble');
    check(Boolean(typingBubble), 'aparece la burbuja de puntos suspensivos');

    // --- Envío y ticks ---------------------------------------------------
    console.log('\n▸ Envío y recibos');
    await pageB.click('.thread-composer button[type="submit"]');
    await pageA.waitForFunction(
      () => [...document.querySelectorAll('.bubble')].some((b) => b.textContent.includes('te escribo algo')),
      { timeout: 12000 }
    ).then(() => ok('el mensaje de B llega a A en vivo'))
      .catch(() => bad('el mensaje de B no llegó a A'));

    // B escribe; sus ticks deben pasar por enviado/entregado y acabar en leído
    // cuando A tenga el hilo abierto (lo tiene, así que se marca leído solo).
    await pageA.click('.thread-composer input[type="text"]');
    await pageA.type('.thread-composer input[type="text"]', 'recibido, hablamos');
    await pageA.click('.thread-composer button[type="submit"]');

    await pageB.waitForFunction(
      () => {
        const rows = [...document.querySelectorAll('.bubble-row.mine .ticks')];
        return rows.length > 0;
      },
      { timeout: 12000 }
    ).then(() => ok('el emisor ve los ticks de su mensaje'))
      .catch(() => bad('el emisor no ve ticks'));

    // A tiene el hilo abierto, así que el mensaje de B se marca leído y los
    // ticks de B deben ponerse en azul (clase `read`).
    try {
      await pageB.waitForFunction(
        () => {
          const rows = [...document.querySelectorAll('.bubble-row.mine .ticks')];
          return rows.length > 0 && rows[rows.length - 1].classList.contains('read');
        },
        { timeout: 15000 }
      );
      ok('los ticks pasan a "leído" (✓✓ turquesa)');
    } catch {
      const t = await lastTicks(pageB);
      bad(`los ticks no llegaron a leído (${JSON.stringify(t)})`);
    }

    // --- Separadores de día ----------------------------------------------
    const daySep = await pageA.$('.day-sep');
    check(Boolean(daySep), 'el hilo muestra separador de día');

    // --- Bandeja: no leídos ----------------------------------------------
    console.log('\n▸ Contador de no leídos');
    // B vuelve a la bandeja primero; con el hilo abierto, un mensaje nuevo se
    // marca leído al instante y no debería dejar badge.
    await clickByText(pageB, 'Volver');
    await sleep(1200);
    // Ahora A escribe: B ya no mira el hilo, así que debe contar como no leído.
    await pageA.type('.thread-composer input[type="text"]', 'otro mensaje');
    await pageA.click('.thread-composer button[type="submit"]');
    await sleep(1800);
    const badge = await pageB.$('.conversation-item .badge');
    check(Boolean(badge), 'la bandeja de B muestra el contador de no leídos');
    const unreadRow = await pageB.$('.conversation-item.unread');
    check(Boolean(unreadRow), 'el chat sin leer se resalta en la bandeja');
  } finally {
    if (errors.length) {
      console.log('\n▸ Errores de consola');
      errors.forEach((e) => bad(e));
    }
  }

  await browser.close();

  console.log(`\n${fail === 0 ? '✅' : '❌'} Mensajería: ${pass} ok, ${fail} fallos`);
  process.exit(fail === 0 ? 0 : 1);
})();
