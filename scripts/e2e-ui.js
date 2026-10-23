// Prueba de UI de extremo a extremo con un navegador real (Chromium del
// sistema). Recorre los flujos que un usuario ve de verdad: registro, feed,
// like, comentario, wallet, regalo, creators, salud y perfil.
//
// Requisitos: `puppeteer-core` instalado y Chromium del sistema. El vídeo de
// prueba se genera solo con ffmpeg si falta.
//
// Uso: node scripts/e2e-ui.js
const { loadPuppeteer, ensureWebmFixture } = require('./lib/harness');

const puppeteer = loadPuppeteer();

const APP = process.env.APP || 'http://localhost:12000';
const API = process.env.API || 'http://localhost:4000/api';
const SUFFIX = Date.now().toString(36).slice(-5);

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

// Pulsa el primer elemento pulsable cuyo texto contenga el indicado.
async function clickByText(page, text) {
  const needle = text.toLowerCase();
  return page.evaluate((t) => {
    const els = [...document.querySelectorAll('button, a')];
    const norm = (e) => e.textContent.trim().toLowerCase();
    // Coincidencia exacta primero: "Crear" no debe casar con "Crear squad".
    const el = els.find((e) => norm(e) === t) || els.find((e) => norm(e).includes(t));
    if (el) { el.click(); return true; }
    return false;
  }, needle);
}

async function waitText(page, text, timeout = 20000) {
  // Case-insensitive: muchas etiquetas se muestran en mayúsculas por CSS y
  // `innerText` devuelve el texto ya transformado.
  const needle = text.toLowerCase();
  await page.waitForFunction(
    (t) => document.body && document.body.innerText.toLowerCase().includes(t),
    { timeout },
    needle
  );
}

// Igual que `waitText`, pero devuelve si apareció en vez de lanzar. Para las
// comprobaciones que se registran con `check`: si no apareciera, hay que seguir
// con el resto de la prueba y reportar el fallo, no abortar la ejecución.
async function sawText(page, text, timeout = 20000) {
  try {
    await waitText(page, text, timeout);
    return true;
  } catch {
    return false;
  }
}

// Diagnóstico: cuando una espera falla, deja ver qué había en pantalla.
async function dump(page, label) {
  const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400)).catch(() => '');
  console.log(`    [diagnóstico ${label}] ${txt}`);
}

async function gotoApp(page) {
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Sin sesión, la app abre en la portada de acceso. El feed es la vista de
  // invitado, así que hay que entrar por "Explorar sin cuenta".
  const guest = await page.$('xpath/.//button[contains(., "Explorar sin cuenta")]');
  if (guest) {
    await guest.click();
    await sleep(300);
  }

  // El feed monta cuando al menos un reel existe (o el aviso de vacío).
  await page.waitForFunction(
    () => document.querySelector('video.reel-video') || /no hay videos|cargando videos/i.test(document.body.innerText),
    { timeout: 25000 }
  ).catch(() => {});
}

(async () => {
  // --- Sembrar un vídeo para que el feed no esté vacío ----------------------
  const seed = await api('/auth/register', {
    method: 'POST',
    body: { username: `seed${SUFFIX}`, email: `seed${SUFFIX}@example.com`, password: 'secret123' },
  });
  const seedToken = seed.data.token;
  if (!seedToken) {
    bad(`no se pudo crear la cuenta semilla -> ${JSON.stringify(seed.data)}`);
    process.exit(1);
  }
  // Vídeo real generado con ffmpeg: uno de bytes falsos no se reproduce y la
  // prueba de "está reproduciéndose" fallaría por el fixture, no por la app.
  // WebM porque el Chromium de código abierto no trae el códec H.264.
  const videoBytes = await require('node:fs').promises.readFile(ensureWebmFixture());
  const form = new FormData();
  form.append('video', new Blob([videoBytes], { type: 'video/webm' }), 'v.webm');
  form.append('title', 'Video sembrado');
  form.append('tags', 'baile');
  form.append('duration', '3');
  const up = await fetch(`${API}/videos/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${seedToken}` },
    body: form,
  });
  const upBody = await up.json().catch(() => null);
  if (up.ok) ok('vídeo sembrado para el feed');
  else bad(`vídeo sembrado para el feed -> ${JSON.stringify(upBody)}`);

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--window-size=420,860',
    ],
    defaultViewport: { width: 420, height: 860 },
  });

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  try {
    // --- Feed anónimo -------------------------------------------------------
    console.log('\n▸ Feed (anónimo)');
    await gotoApp(page);
    let feedOk = false;
    try {
      await waitText(page, 'Video sembrado', 20000);
      ok('el feed carga y muestra el vídeo sembrado');
      feedOk = true;
    } catch {
      bad('el feed no muestra el vídeo sembrado');
      await dump(page, 'feed');
    }

    // El vídeo debe tener fuente cargada (no solo estar en el DOM). Un reel con
    // HLS se sirve por MediaSource, así que `src` puede estar vacío aunque haya
    // imagen; la señal fiable es que el elemento tenga datos listos. Se espera un
    // poco porque el manifiesto HLS se carga después del primer render.
    let playing = null;
    for (let i = 0; i < 12; i += 1) {
      playing = await page.evaluate(() => {
        const v = document.querySelector('video.reel-video');
        return v ? { paused: v.paused, src: !!v.src, ready: v.readyState, muted: v.muted, currentTime: v.currentTime } : null;
      });
      if (playing && (playing.src || playing.ready > 0)) break;
      await sleep(500);
    }
    check(playing && (playing.src || playing.ready > 0), 'el reel tiene una fuente de vídeo');
    // El autoplay con sonido lo bloquea el navegador; el reel va silenciado a
    // propósito, así que debe arrancar solo. Si no, esperamos y reintentamos.
    if (playing && playing.paused) {
      await page.evaluate(() => document.querySelector('video.reel-video')?.play().catch(() => {}));
      await sleep(1500);
    }
    const playing2 = await page.evaluate(() => {
      const v = document.querySelector('video.reel-video');
      return v ? { paused: v.paused, currentTime: v.currentTime, ready: v.readyState } : null;
    });
    check(playing2 && playing2.paused === false, `el reel se reproduce (ready=${playing2?.ready}, t=${playing2?.currentTime?.toFixed(2)})`);

    // --- Registro -----------------------------------------------------------
    console.log('\n▸ Registro desde la UI');
    const user = `ui${SUFFIX}`;
    // Ir a "Perfil" (protegido) lleva al formulario de acceso.
    await clickByText(page, 'Perfil');
    await waitText(page, 'Iniciar sesión', 10000);
    await clickByText(page, 'Regístrate');
    await page.waitForSelector('input[placeholder="Nombre de usuario"]', { timeout: 12000 });
    await page.type('input[placeholder="Nombre de usuario"]', user);
    await page.type('input[placeholder="Correo"]', `${user}@example.com`);
    await page.type('input[placeholder="Contraseña (mínimo 6 caracteres)"]', 'secret123');
    await page.type('input[placeholder="Repite la contraseña"]', 'secret123');
    // La casilla de términos es obligatoria en el alta.
    await page.click('.terms-check input[type=checkbox]');
    await clickByText(page, 'Registrarme');

    // El alta termina en la pantalla de verificación de correo (la cuenta ya
    // funciona). Aquí no hay proveedor de correo, así que se sale con "Lo
    // verificaré más tarde"; lo que importa es que la sesión quede abierta.
    const onVerify = await sawText(page, 'Verifica tu correo', 15000);
    check(onVerify, 'tras el alta se pide verificar el correo');
    const devCode = await page.evaluate(() => {
      const el = document.querySelector('.dev-code-value');
      return el ? el.textContent.trim() : null;
    });
    check(devCode && /^\d{6}$/.test(devCode), 'sin proveedor de correo se muestra el código de verificación');
    await clickByText(page, 'Lo verificaré más tarde');
    await sleep(1500);

    const sess = await page.evaluate(() => ({
      token: !!localStorage.getItem('taktak_token'),
      user: localStorage.getItem('taktak_user') || '',
    }));
    check(sess.token, 'el registro guarda el token de sesión');
    check(sess.user.includes(user), 'el registro guarda el usuario en la sesión');

    // La sesión debe verse en la app: el perfil muestra el propio arroba.
    await clickByText(page, 'Perfil');
    const profileShowsUser = await sawText(page, '@' + user, 10000);
    check(profileShowsUser, 'el perfil muestra la cuenta recién creada');

    // --- Like y comentario --------------------------------------------------
    console.log('\n▸ Like y comentario');
    await clickByText(page, 'Inicio');
    await waitText(page, 'Video sembrado', 15000);
    const likeBefore = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button.reel-action')].find((x) => x.querySelector('small'));
      return b ? b.querySelector('small').textContent : null;
    });
    // Pulsar el botón de like (primer reel-action con corazón).
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button.reel-action')].find((x) => x.textContent.includes('❤'));
      if (b) b.click();
    });
    await sleep(1500);
    const likeAfter = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button.reel-action')].find((x) => x.textContent.includes('❤'));
      return b ? b.querySelector('small').textContent : null;
    });
    check(Number(likeAfter) === Number(likeBefore) + 1, `el like sube el contador (${likeBefore}→${likeAfter})`);

    // Abrir comentarios.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button.reel-action')].find((x) => x.textContent.includes('💬'));
      if (b) b.click();
    });
    await waitText(page, 'Comentarios', 10000);
    ok('se abre el panel de comentarios');
    await page.waitForSelector('input[aria-label="Escribe un comentario"], textarea[aria-label="Escribe un comentario"]', { timeout: 8000 }).catch(() => {});
    const commentText = `comentario-ui-${SUFFIX}`;
    const wrote = await page.evaluate((t) => {
      const el = document.querySelector('input[aria-label="Escribe un comentario"], textarea[aria-label="Escribe un comentario"]');
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
      setter.call(el, t);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, commentText);
    if (wrote) {
      await page.evaluate(() => {
        const form = document.querySelector('form');
        const el = document.querySelector('input[aria-label="Escribe un comentario"], textarea[aria-label="Escribe un comentario"]');
        if (el && el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await sleep(2000);
      const shown = await page.evaluate((t) => document.body.innerText.includes(t), commentText);
      check(shown, 'el comentario aparece publicado');
    } else {
      bad('no se encontró el campo de comentario');
    }
    await clickByText(page, 'Cerrar').catch(() => {});

    // --- Wallet y regalo ----------------------------------------------------
    // El monedero ya no es una pestaña de la barra: vive dentro del perfil, tras
    // el engranaje de configuración, que es donde lo pone TikTok.
    console.log('\n▸ Wallet');
    await clickByText(page, 'Cerrar').catch(() => {});
    await sleep(500);
    await clickByText(page, 'Perfil');
    await sleep(600);
    const openedSettings = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Configuración"]');
      if (btn) { btn.click(); return true; }
      return false;
    });
    check(openedSettings, 'se abre la configuración desde el perfil');
    await sleep(500);
    const clickedWallet = await clickByText(page, 'Monedero');
    check(clickedWallet, 'se encuentra el acceso al Monedero');
    try {
      await waitText(page, 'Monedas', 15000);
      ok('la wallet carga con saldos');
    } catch {
      bad('la wallet no carga');
      await dump(page, 'wallet');
    }
    const hasBalances = await page.evaluate(() => /100/.test(document.body.innerText));
    check(hasBalances, 'el saldo inicial de 100 monedas se muestra');

    // Enviar un regalo de verdad a la cuenta semilla y comprobar que la moneda
    // sale del saldo y que la UI lo confirma.
    await clickByText(page, 'Enviar regalo');
    try {
      await page.waitForSelector('input[placeholder="@usuario"]', { timeout: 8000 });
      await page.type('input[placeholder="@usuario"]', `seed${SUFFIX}`);
      await page.type('input[placeholder="Monto en Monedas"]', '10');
      await clickByText(page, 'Enviar');
      await waitText(page, 'Regalo enviado', 12000);
      ok('el regalo se envía y la UI lo confirma');
    } catch (e) {
      bad(`no se pudo enviar el regalo -> ${e.message}`);
      await dump(page, 'gift');
    }
    // El saldo debe haber bajado de 100 a 90 (el regalo eran 10 monedas).
    await sleep(1200);
    const afterGift = await page.evaluate(() => document.body.innerText);
    check(/90/.test(afterGift), 'el saldo baja tras enviar el regalo (100→90)');

    // --- TAK Creators -------------------------------------------------------
    console.log('\n▸ TAK Creators');
    await clickByText(page, 'Creators');
    await waitText(page, 'creator', 15000);
    ok('la vista de creators carga');
    const squadName = `Creator UI ${SUFFIX}`;
    // El formulario está plegado tras el botón "Crear creator".
    await clickByText(page, 'Crear creator');
    await sleep(500);
    const hasForm = await page.$('input[placeholder="Nombre del creator"]');
    if (hasForm) {
      await page.type('input[placeholder="Nombre del creator"]', squadName);
      await clickByText(page, 'Crear');
      await sleep(2500);
      const created = await page.evaluate((t) => document.body.innerText.includes(t), squadName);
      check(created, 'el creator creado aparece en la lista');
    } else {
      bad('no se encontró el formulario de creación de creator');
    }

    // --- Salud de cuenta ----------------------------------------------------
    // También cuelga de la configuración, igual que el monedero.
    console.log('\n▸ Salud de cuenta');
    await clickByText(page, 'Perfil');
    await sleep(600);
    await page.evaluate(() => document.querySelector('button[aria-label="Configuración"]')?.click());
    await sleep(500);
    await clickByText(page, 'Salud de la cuenta');
    await waitText(page, 'Visibilidad', 15000).then(
      () => ok('el panel de salud carga y muestra la visibilidad'),
      () => bad('el panel de salud no carga')
    );

    // --- Perfil -------------------------------------------------------------
    console.log('\n▸ Perfil');
    await clickByText(page, 'Perfil');
    await waitText(page, 'Seguidores', 15000).then(
      () => ok('el perfil carga con sus métricas'),
      () => bad('el perfil no carga')
    );

    // --- Errores de consola -------------------------------------------------
    console.log('\n▸ Consola del navegador');
    const realErrors = errors.filter((e) => !/ResizeObserver|HLS|play\(\) request/i.test(e));
    check(realErrors.length === 0, `sin errores de JS en las vistas${realErrors.length ? ': ' + realErrors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} UI: ${pass} ok, ${fail} fallos`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('Fallo del harness:', err);
  process.exit(1);
});
