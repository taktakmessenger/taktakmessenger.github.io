// Prueba de extremo a extremo de Explorar y de la seguridad (reportar/bloquear)
// con un navegador real.
//
// Comprueba el recorrido completo de las dos funciones nuevas: que se puede
// encontrar a una persona por su nombre, que el bloqueo quita sus vídeos del
// feed al instante, y que un reporte llega a la cola del administrador.
//
// Requisitos: `puppeteer-core` y el Chromium del sistema.
//
// Uso: node scripts/e2e-explore-safety.js
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

// Cierra los avisos que aparecen al entrar (teléfono, notificaciones). Son
// modales que tapan la pantalla entera; sin cerrarlos, ningún clic llega.
async function dismissPrompts(page) {
  for (let i = 0; i < 12; i += 1) {
    const closed = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      let count = 0;
      for (const dialog of dialogs) {
        const button = [...dialog.querySelectorAll('button')].find((b) =>
          /ahora no|omitir|cerrar|no, gracias|más tarde/i.test(b.textContent.trim())
        );
        if (button) {
          button.click();
          count += 1;
        }
      }
      return count;
    });
    await sleep(400);
    if (closed === 0) return;
  }
}

async function clickByText(page, text) {
  const needle = text.toLowerCase();
  return page.evaluate((t) => {
    const els = [...document.querySelectorAll('button, a')];
    const norm = (e) => e.textContent.trim().toLowerCase();
    const el = els.find((e) => norm(e) === t) || els.find((e) => norm(e).includes(t));
    if (el) { el.click(); return true; }
    return false;
  }, needle);
}

async function waitText(page, text, timeout = 20000) {
  const needle = text.toLowerCase();
  await page.waitForFunction(
    (t) => document.body && document.body.innerText.toLowerCase().includes(t),
    { timeout },
    needle
  );
}

async function sawText(page, text, timeout = 20000) {
  try {
    await waitText(page, text, timeout);
    return true;
  } catch {
    return false;
  }
}

// Escribe en el buscador de Explorar. Se limpia antes para poder reutilizarlo:
// un `type` sobre un campo con texto concatena en vez de reemplazar.
async function typeSearch(page, term) {
  await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="Buscar en TAK TAK"]');
    if (el) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(250);
  const input = await page.$('input[aria-label="Buscar en TAK TAK"]');
  if (!input) return false;
  await input.type(term);
  return true;
}

(async () => {
  // --- Sembrar dos cuentas con un vídeo cada una ---------------------------
  const ana = await api('/auth/register', {
    method: 'POST',
    body: { username: `ana${SUFFIX}`, email: `ana${SUFFIX}@example.com`, password: 'secret123' },
  });
  const beto = await api('/auth/register', {
    method: 'POST',
    body: { username: `beto${SUFFIX}`, email: `beto${SUFFIX}@example.com`, password: 'secret123' },
  });
  if (!ana.data?.token || !beto.data?.token) {
    bad(`no se pudieron crear las cuentas -> ${JSON.stringify(ana.data)} ${JSON.stringify(beto.data)}`);
    process.exit(1);
  }

  const videoBytes = await require('node:fs').promises.readFile(ensureWebmFixture());
  async function upload(token, title) {
    const form = new FormData();
    form.append('video', new Blob([videoBytes], { type: 'video/webm' }), 'v.webm');
    form.append('title', title);
    form.append('tags', 'prueba');
    form.append('duration', '3');
    const res = await fetch(`${API}/videos/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) return null;
    const body = await res.json();
    // El endpoint envuelve el vídeo: `{ video: {...} }`.
    return body.video || body;
  }

  const anaVideo = await upload(ana.data.token, `Ana baila ${SUFFIX}`);
  const betoVideo = await upload(beto.data.token, `Beto canta ${SUFFIX}`);
  check(Boolean(anaVideo?._id && betoVideo?._id), 'los dos vídeos semilla se subieron');

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=420,860'],
    defaultViewport: { width: 420, height: 860 },
  });

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  try {
    // Entra como Ana.
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(
      ([token, user]) => {
        localStorage.setItem('taktak_token', token);
        localStorage.setItem('taktak_user', JSON.stringify(user));
      },
      [ana.data.token, ana.data.user]
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1500);
    await dismissPrompts(page);

    // --- Explorar -----------------------------------------------------------
    console.log('\n▸ Explorar');
    const hasTab = await clickByText(page, 'Explorar');
    check(hasTab, 'la pestaña Explorar existe en la barra');
    await sleep(800);

    check(Boolean(await page.$('input[aria-label="Buscar en TAK TAK"]')), 'la pantalla tiene su buscador');

    // Personas: por @usuario.
    await typeSearch(page, `beto${SUFFIX}`);
    check(await sawText(page, `@beto${SUFFIX}`, 15000), 'encuentra a la persona por su usuario');
    check(
      (await page.$$('.search-user')).length === 1,
      'la persona sale como resultado de tipo usuario'
    );

    // La búsqueda encuentra por título de vídeo.
    await typeSearch(page, 'Ana baila');
    check(await sawText(page, 'Ana baila', 15000), 'encuentra por título de vídeo');
    check(
      (await page.$$('.search-video')).length >= 1,
      'el vídeo sale como resultado de tipo vídeo'
    );

    // Pestañas: filtrar a "Personas" esconde los vídeos.
    await typeSearch(page, `beto${SUFFIX}`);
    await sleep(1200);
    await clickByText(page, 'Personas');
    await sleep(400);
    check(
      (await page.$$('.search-video')).length === 0 &&
        (await page.$$('.search-user')).length === 1,
      'la pestaña Personas deja solo personas'
    );

    // --- Reportar desde el buscador -----------------------------------------
    console.log('\n▸ Reportar');
    await page.evaluate(() => {
      const btn = document.querySelector('.search-user .btn-ghost.danger');
      if (btn) btn.click();
    });
    const dialogOpen = await sawText(page, 'Reportar', 8000);
    check(dialogOpen, 'el botón ⚑ abre el diálogo de reporte');
    if (dialogOpen) {
      await page.evaluate(() => {
        const radio = document.querySelector('input[name="report-reason"][value="spam"]');
        if (radio) radio.click();
      });
      await sleep(300);
      await clickByText(page, 'Enviar reporte');
      const thanks = await sawText(page, 'Gracias', 10000);
      check(thanks, 'el reporte se envía y se confirma');
      await clickByText(page, 'Cerrar');
      await sleep(500);

      const mine = await api('/safety/reports', { token: ana.data.token });
      check((mine.data?.reports || []).length >= 1, 'el reporte queda registrado en el servidor');
    }

    // --- Bloquear ------------------------------------------------------------
    console.log('\n▸ Bloquear');
    // Se abre el perfil público desde el resultado de búsqueda.
    await typeSearch(page, `beto${SUFFIX}`);
    await sleep(1200);
    await page.evaluate(() => {
      const btn = document.querySelector('.search-user-main');
      if (btn) btn.click();
    });
    // Se espera al selector propio del perfil: el texto `@beto` ya estaba en los
    // resultados de búsqueda, así que esperar por texto daba falso positivo.
    const opened = await page
      .waitForSelector('.public-profile-safety', { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    check(opened, 'se abre el perfil público del buscado');

    if (opened) {
      const clicked = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.public-profile-safety button')].find((b) =>
          /bloquear/i.test(b.textContent)
        );
        if (btn) { btn.click(); return true; }
        return false;
      });
      check(clicked, 'el perfil ofrece bloquear');

      if (clicked) {
        await sleep(600);
        await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]');
          const btn = dialog && [...dialog.querySelectorAll('button')].find((b) =>
            /^bloquear$/i.test(b.textContent.trim())
          );
          if (btn) btn.click();
        });
        await sleep(1200);
        const list = await api('/safety/blocked', { token: ana.data.token });
        check(
          (list.data?.blocked || []).some((u) => u.username === `beto${SUFFIX}`),
          'el bloqueo queda registrado en el servidor'
        );
      }
    }

    // --- El vídeo del bloqueado desaparece del feed -------------------------
    console.log('\n▸ El bloqueado desaparece del feed');
    await clickByText(page, 'Inicio');
    await sleep(2500);
    // Se comprueba por id contra la misma API que consume el feed, no por texto
    // en pantalla: la base de datos de desarrollo tiene vídeos de ejecuciones
    // anteriores de otros "beto" y el texto daría un falso positivo. Además el
    // feed pinta una tarjeta a la vez, así que el título puede no estar visible.
    const feed = await api('/feed/for-you?limit=50', { token: ana.data.token });
    const ids = (feed.data?.videos || []).map((v) => String(v._id));
    check(!ids.includes(String(betoVideo._id)), 'el vídeo del bloqueado ya no está en el feed');
    check(ids.includes(String(anaVideo._id)), 'los vídeos de los demás siguen ahí');

    // La pantalla del feed sigue funcionando tras el bloqueo.
    check(
      await page
        .waitForSelector('.reels, .centered', { timeout: 15000 })
        .then(() => true)
        .catch(() => false),
      'el feed se sigue pintando tras bloquear'
    );

    // --- La cola del administrador recibe el reporte ------------------------
    console.log('\n▸ Cola de moderación');
    const report = await api('/safety/reports', {
      method: 'POST',
      token: beto.data.token,
      body: {
        targetType: 'video',
        targetId: anaVideo._id,
        reason: 'harassment',
        details: 'prueba automática',
      },
    });
    check(report.status === 201, `un reporte por la API se acepta (${report.status})`);

    const mongoose = require('/workspace/project/backend/node_modules/mongoose');
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/taktak?replicaSet=rs0';
    await mongoose.connect(uri);
    const User = require('/workspace/project/backend/src/models/User');
    const { signToken } = require('/workspace/project/backend/src/utils/tokens');
    const adminUser = await User.findOneAndUpdate(
      { email: 'eliecerdepablos@gmail.com' },
      { $setOnInsert: { username: `admin${SUFFIX}`, password: 'x'.repeat(20), role: 'admin' } },
      { new: true, upsert: true }
    );
    const adminToken = signToken(adminUser);
    await mongoose.disconnect();

    const queue = await api('/admin/reports', { token: adminToken });
    const inQueue = (queue.data?.reports || []).some(
      (r) => String(r.targetId) === String(anaVideo._id)
    );
    check(inQueue, 'el reporte aparece en la cola del administrador');

    // La cola también se ve en el panel de administración del navegador, que es
    // lo que faltaba: antes el reporte llegaba a la base de datos y no a
    // ninguna pantalla.
    await page.evaluate(
      ([token, user]) => {
        localStorage.setItem('taktak_token', token);
        localStorage.setItem('taktak_user', JSON.stringify(user));
      },
      [adminToken, { ...adminUser.toObject(), id: String(adminUser._id) }]
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1500);
    await dismissPrompts(page);
    // El panel vive dentro de Ajustes: Perfil → engranaje → "Panel de administración".
    await clickByText(page, 'Perfil');
    await sleep(900);
    await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Configuración"]');
      if (btn) btn.click();
    });
    await sleep(700);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        /panel de administraci/i.test(b.textContent)
      );
      if (btn) btn.click();
    });
    const adminOpen = await page
      .waitForSelector('.admin', { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    check(adminOpen, 'el panel de administración abre');
    if (adminOpen) {
      const reportVisible = await sawText(page, 'Reportes (', 10000);
      check(reportVisible, 'la sección de Reportes se pinta en el panel');
    }

    // --- Errores de consola -------------------------------------------------
    console.log('\n▸ Consola del navegador');
    // `cdn.example.com` son vídeos de otros usuarios de la base de datos de
    // desarrollo con una URL de ejemplo; no son un fallo de esta función.
    const realErrors = errors.filter(
      (e) => !/ResizeObserver|HLS|play\(\) request|favicon|cdn\.example\.com|ERR_NAME_NOT_RESOLVED/i.test(e)
    );
    check(
      realErrors.length === 0,
      `sin errores de JS${realErrors.length ? ': ' + realErrors.slice(0, 3).join(' | ') : ''}`
    );
  } finally {
    await browser.close();
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} Explorar/Seguridad: ${pass} ok, ${fail} fallos`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('Fallo del harness:', err);
  process.exit(1);
});
