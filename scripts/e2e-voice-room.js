// Regresión de la sala de voz de un TAK Creator con navegadores reales.
//
// Comprueba que varios miembros del mismo creator entran en la sala, que el
// servidor los pone de acuerdo en el transporte (SFU si está disponible, malla
// si no) y que acaban oyéndose de verdad. Usa el micrófono falso de Chromium,
// así que la pista remota existe aunque no haya hardware.
//
// Con SFU se prueban tres participantes: es el caso que la malla no cubre bien
// y el motivo de haber montado el SFU. Si el servidor cae a malla, se prueban
// dos y se deja constancia del modo.
//
// Requisitos: `puppeteer-core` instalado y Chromium del sistema.
//
// Uso: node scripts/e2e-voice-room.js
const { loadPuppeteer } = require('./lib/harness');

const puppeteer = loadPuppeteer();

const APP = process.env.APP || 'http://localhost:12000';
const API = process.env.API || 'http://localhost:4000/api';
const SUFFIX = Date.now().toString(36).slice(-6);

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ✗ ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
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

// El modo de transporte que el servidor eligió para la sala, leído de la barra
// o de la cabecera del directo (la barra se oculta con la rejilla abierta).
async function roomMode(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.voice-mode') || document.querySelector('.live-stage-title small');
    if (!el) return null;
    return el.textContent.includes('grupo') ? 'sfu' : 'mesh';
  });
}

// Cuántos audios remotos vivos tiene la página.
async function remoteVoiceAudio(page) {
  return page.evaluate(() => {
    const audios = [...document.querySelectorAll('.voice-audio audio')];
    const withStream = audios.filter((a) => a.srcObject && a.srcObject.getAudioTracks().length > 0);
    return {
      count: audios.length,
      live: withStream.length,
      readyState: withStream[0]?.srcObject?.getAudioTracks()[0]?.readyState || null,
    };
  });
}

// Cuántas ventanas de vídeo del directo tienen imagen viva. Es la prueba de que
// el SFU (o la malla) está reenviando la cámara, no solo el micrófono.
async function liveVideoTiles(page) {
  return page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.live-tile')];
    const videos = [...document.querySelectorAll('.live-tile video')];
    const withStream = videos.filter(
      (v) => v.srcObject && v.srcObject.getVideoTracks().length > 0
    );
    return {
      tiles: tiles.length,
      host: tiles.filter((t) => t.classList.contains('host')).length,
      videos: videos.length,
      live: withStream.length,
    };
  });
}

// Minimiza la rejilla a la barra flotante, si está abierta.
async function minimizeStage(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('.live-stage-min');
    if (!btn) return false;
    btn.click();
    return true;
  });
}

async function newCtx(browser, token, user) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 420, height: 860 });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t, u) => {
    localStorage.setItem('taktak_token', t);
    localStorage.setItem('taktak_user', JSON.stringify(u));
    localStorage.setItem(`taktak_phone_prompt_${u.id || u._id}`, '1');
  }, token, user);
  await page.reload({ waitUntil: 'domcontentloaded' });
  return page;
}

(async () => {
  const aName = `ava${SUFFIX}`;
  const bName = `bva${SUFFIX}`;
  const cName = `cva${SUFFIX}`;
  const a = (await api('/auth/register', { method: 'POST', body: { username: aName, email: `${aName}@e.com`, password: 'secret123' } })).data;
  const b = (await api('/auth/register', { method: 'POST', body: { username: bName, email: `${bName}@e.com`, password: 'secret123' } })).data;
  const c = (await api('/auth/register', { method: 'POST', body: { username: cName, email: `${cName}@e.com`, password: 'secret123' } })).data;
  if (!a?.token || !b?.token || !c?.token) { bad('no se pudieron crear las cuentas de prueba'); process.exit(1); }
  ok('cuentas de prueba creadas');

  // Alice crea un creator público; Bob y Carol se unen.
  const created = await api('/squads', {
    method: 'POST',
    token: a.token,
    body: { name: `Sala ${SUFFIX}`, visibility: 'public' },
  });
  const slug = created.data?.squad?.slug;
  if (!slug) { bad(`no se pudo crear el creator -> ${JSON.stringify(created.data)}`); process.exit(1); }
  const joined = await api(`/squads/${slug}/join`, { method: 'POST', token: b.token, body: {} });
  if (joined.status !== 200) { bad(`Bob no se pudo unir -> ${joined.status}`); process.exit(1); }
  const joinedC = await api(`/squads/${slug}/join`, { method: 'POST', token: c.token, body: {} });
  if (joinedC.status !== 200) { bad(`Carol no se pudo unir -> ${joinedC.status}`); process.exit(1); }
  ok('creator público creado y Bob y Carol se unen');

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 420, height: 860 },
  });

  const pageA = await newCtx(browser, a.token, a.user);
  const pageB = await newCtx(browser, b.token, b.user);
  const pageC = await newCtx(browser, c.token, c.user);

  // Abre el creator y despliega su feed para llegar a la sala de voz.
  //
  // Se espera a la tarjeta *del creator concreto*, no a la palabra "creator":
  // esa palabra ya está en la cabecera "TAK Creators", así que esperarla no
  // garantiza que la lista haya cargado y la búsqueda fallaba por carrera (Bob
  // llegaba antes que el fetch de /squads). El reintento cubre la carga lenta.
  async function openCreatorFeed(page, name) {
    await clickByText(page, 'Creators');
    try {
      await page.waitForFunction(
        (n) => [...document.querySelectorAll('li.squad-card')].some((c) =>
          c.textContent.toLowerCase().includes(n.toLowerCase())
        ),
        { timeout: 20000 },
        name
      );
    } catch {
      return false;
    }
    return page.evaluate((n) => {
      const card = [...document.querySelectorAll('li.squad-card')].find((c) =>
        c.textContent.toLowerCase().includes(n.toLowerCase())
      );
      if (!card) return false;
      const btn = [...card.querySelectorAll('button')].find((x) => /ver contenido/i.test(x.textContent));
      if (!btn) return false;
      btn.click();
      return true;
    }, name);
  }

  try {
    // Alice entra al directo desde el feed de su creator.
    const openedA = await openCreatorFeed(pageA, `Sala ${SUFFIX}`);
    if (openedA) ok('Alice abre el feed de su creator'); else bad('Alice no encontró su creator');

    await pageA.waitForSelector('.voice-room', { timeout: 10000 }).catch(() => {});
    const joinedA = await clickByText(pageA, 'Entrar al directo');
    if (joinedA) ok('Alice pulsa Entrar al directo'); else bad('no aparece el botón de entrar');

    // Al entrar, el directo se abre a pantalla completa (rejilla tipo TikTok).
    try {
      await pageA.waitForSelector('.live-stage', { timeout: 12000 });
      ok('el directo se abre a pantalla completa en Alice');
    } catch {
      bad('no se abre la rejilla del directo');
    }

    // Bob entra al mismo directo.
    const openedB = await openCreatorFeed(pageB, `Sala ${SUFFIX}`);
    if (openedB) ok('Bob abre el feed del creator'); else bad('Bob no encontró el creator');
    await pageB.waitForSelector('.voice-room', { timeout: 10000 }).catch(() => {});
    const joinedB = await clickByText(pageB, 'Entrar al directo');
    if (joinedB) ok('Bob pulsa Entrar al directo'); else bad('Bob no ve el botón de entrar');

    try {
      await pageB.waitForSelector('.live-stage', { timeout: 12000 });
      ok('el directo se abre a pantalla completa en Bob');
    } catch {
      bad('no se abre la rejilla del directo en Bob');
    }

    // El modo que el servidor eligió para la sala. Con SFU disponible debe ser
    // el de grupo; si no, se acepta la malla y se avisa.
    const mode = (await roomMode(pageA)) || (await roomMode(pageB));
    if (mode === 'sfu') ok('el servidor montó el directo por SFU (grupo)');
    else bad(`la sala cayó a malla (${mode}); se esperaba SFU en este entorno`);

    // Con SFU se añade un tercero: es el caso que justifica el SFU, porque la
    // malla obligaría a cada uno a subir dos flujos y a negociar tres enlaces.
    if (mode === 'sfu') {
      const openedC = await openCreatorFeed(pageC, `Sala ${SUFFIX}`);
      if (openedC) ok('Carol abre el feed del creator'); else bad('Carol no encontró el creator');
      await pageC.waitForSelector('.voice-room', { timeout: 10000 }).catch(() => {});
      const joinedC = await clickByText(pageC, 'Entrar al directo');
      if (joinedC) ok('Carol pulsa Entrar al directo'); else bad('Carol no ve el botón de entrar');
      await pageC.waitForSelector('.live-stage', { timeout: 12000 }).catch(() => {});
    }

    // Margen para que el SFU reparta los productores (o la malla negocie).
    await sleep(6000);

    const ra = await remoteVoiceAudio(pageA);
    const rb = await remoteVoiceAudio(pageB);
    if (ra.live > 0) ok(`Alice oye el audio del directo (pistas=${ra.live}, ${ra.readyState})`);
    else bad(`Alice no tiene audio remoto -> ${JSON.stringify(ra)}`);
    if (rb.live > 0) ok(`Bob oye el audio del directo (pistas=${rb.live}, ${rb.readyState})`);
    else bad(`Bob no tiene audio remoto -> ${JSON.stringify(rb)}`);

    // La prueba central de esta función: además del micrófono, se ve la cámara.
    // La ventana del anfitrión debe existir y ser distinta de las demás.
    const va = await liveVideoTiles(pageA);
    if (va.host === 1) ok('la ventana del anfitrión está marcada y es única');
    else bad(`se esperaba una ventana de anfitrión, hay ${va.host}`);
    if (va.live > 0) ok(`Alice ve vídeo del directo (ventanas=${va.tiles}, con imagen=${va.live})`);
    else bad(`Alice no ve ninguna cámara -> ${JSON.stringify(va)}`);

    const vb = await liveVideoTiles(pageB);
    if (vb.live > 0) ok(`Bob ve vídeo del directo (ventanas=${vb.tiles}, con imagen=${vb.live})`);
    else bad(`Bob no ve ninguna cámara -> ${JSON.stringify(vb)}`);

    if (mode === 'sfu') {
      // Carol entró la última: debe recibir los dos micrófonos que ya sonaban,
      // y los otros dos deben recibir el suyo. Es la prueba de que el SFU
      // reenvía a todos, no solo al primero.
      const rc = await remoteVoiceAudio(pageC);
      if (rc.live >= 2) ok(`Carol oye a los dos que ya estaban (pistas=${rc.live})`);
      else bad(`Carol no oye a todos -> ${JSON.stringify(rc)}`);
      if (ra.live >= 2 && rb.live >= 2) ok('Alice y Bob oyen al recién llegado');
      else bad(`no todos oyen al recién llegado -> A=${ra.live}, B=${rb.live}`);
      // Y Carol también ve a los demás en la rejilla.
      const vc = await liveVideoTiles(pageC);
      if (vc.live >= 1) ok(`Carol ve el vídeo del directo (con imagen=${vc.live})`);
      else bad(`Carol no ve ninguna cámara -> ${JSON.stringify(vc)}`);
    }

    // Minimizar deja la barra flotante: el directo sigue vivo y el audio con él.
    const minimized = await minimizeStage(pageA);
    if (minimized) ok('Alice minimiza el directo a la barra'); else bad('no aparece el botón de minimizar');
    await pageA.waitForSelector('.voice-bar', { timeout: 8000 }).catch(() => {});
    const stageGone = await pageA.evaluate(() => !document.querySelector('.live-stage'));
    if (stageGone) ok('la rejilla se cierra al minimizar'); else bad('la rejilla sigue abierta tras minimizar');

    // El audio debe sobrevivir a cambiar de pestaña: vive en un componente
    // siempre montado, así que el elemento no se desmonta. Es lo que permite
    // hablar mientras sigues en el feed.
    await clickByText(pageA, 'Inicio');
    await sleep(1500);
    const stillThere = await pageA.evaluate(() => !!document.querySelector('.voice-bar'));
    const afterTab = await remoteVoiceAudio(pageA);
    if (stillThere && afterTab.live > 0) ok('el audio sigue vivo al cambiar de pestaña');
    else bad(`el audio se perdió al cambiar de pestaña -> ${JSON.stringify(afterTab)}`);

    // Silenciar el micrófono se refleja en el icono local y se avisa a los demás.
    const muted = await pageA.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Silenciar micrófono"]');
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (muted) ok('Alice puede silenciar su micrófono'); else bad('no aparece el botón de silenciar');
    await sleep(800);
    // Bob sigue con la rejilla abierta, así que el silencio de Alice puede verse
    // como avatar atenuado en una barra o como icono en su ventana del directo.
    const peerMuted = await pageB.evaluate(() =>
      !!document.querySelector('.voice-avatar.muted, .live-tile-muted')
    );
    if (peerMuted) ok('Bob ve que Alice está silenciada'); else bad('Bob no ve el icono de silencio');

    // Salir del directo apaga la barra y desconecta al par.
    await pageA.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Salir del directo"]');
      if (btn) btn.click();
    });
    await sleep(1500);
    const goneA = await pageA.evaluate(() => !document.querySelector('.voice-bar'));
    if (goneA) ok('salir cierra la barra del directo en Alice'); else bad('la barra sigue tras salir');

    // Bob debe dejar de ver a Alice (Carol, si entró, sigue en el directo). Bob
    // sigue con la rejilla abierta, así que se mira la rejilla: la ventana de
    // Alice desaparece y su nombre ya no está en ninguna.
    let peerLeft = false;
    try {
      await pageB.waitForFunction(
        (name) =>
          ![...document.querySelectorAll('.live-tile')].some((t) =>
            (t.textContent || '').toLowerCase().includes(name.toLowerCase())
          ),
        { timeout: 8000 },
        aName
      );
      peerLeft = true;
    } catch { /* se reporta abajo */ }
    if (peerLeft) ok('Bob ve que Alice ha salido del directo'); else bad('Bob sigue viendo a Alice en el directo');
  } finally {
    await browser.close();
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} Directo del creator: ${pass} ok, ${fail} fallos`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('Fallo del harness:', e); process.exit(1); });
