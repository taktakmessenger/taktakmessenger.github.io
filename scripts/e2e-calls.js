// Regresión de llamadas de voz y vídeo con dos navegadores reales.
//
// Comprueba que la negociación WebRTC completa (invite → accept → offer →
// answer → ICE) deja a ambos lados con el stream remoto sonando. Usa las
// cámaras y micrófonos falsos de Chromium, así que las pistas remotas existen
// aunque no haya hardware.
//
// Requisitos: `puppeteer-core` instalado (por ejemplo `npm i puppeteer-core` en
// el directorio desde el que se ejecuta) y Chromium del sistema.
//
// Uso: node scripts/e2e-calls.js
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

// Estado del elemento de audio remoto: es la prueba de que el audio del otro
// lado llegó de verdad (una pista viva en el MediaStream del srcObject).
async function remoteAudio(page) {
  return page.evaluate(() => {
    const a = document.querySelector('audio');
    const s = a && a.srcObject;
    return s ? { tracks: s.getAudioTracks().length, readyState: s.getAudioTracks()[0]?.readyState } : null;
  });
}

async function remoteVideo(page) {
  return page.evaluate(() => {
    const v = [...document.querySelectorAll('video')].find((x) => x.className.includes('call-remote'));
    const s = v && v.srcObject;
    return s ? { tracks: s.getVideoTracks().length, playing: !v.paused } : null;
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
  }, token, user);
  await page.reload({ waitUntil: 'domcontentloaded' });
  return page;
}

(async () => {
  // Cuentas. Se registran por API para no depender del rate limiter de UI.
  const aName = `alc${SUFFIX}`;
  const bName = `blc${SUFFIX}`;
  const a = (await api('/auth/register', { method: 'POST', body: { username: aName, email: `${aName}@e.com`, password: 'secret123' } })).data;
  const b = (await api('/auth/register', { method: 'POST', body: { username: bName, email: `${bName}@e.com`, password: 'secret123' } })).data;
  if (!a?.token || !b?.token) { bad('no se pudieron crear las cuentas de prueba'); process.exit(1); }
  ok('cuentas de prueba creadas');

  const conv = (await api('/messages/conversations', { method: 'POST', token: a.token, body: { userId: b.user.id } })).data;
  const convId = conv?.conversationId || conv?.conversation?.id || conv?.id;
  if (!convId) { bad(`no se pudo crear la conversación -> ${JSON.stringify(conv)}`); process.exit(1); }
  ok('conversación creada');

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 420, height: 860 },
  });

  const pageA = await newCtx(browser, a.token, a.user);
  const pageB = await newCtx(browser, b.token, b.user);

  async function openThread(page) {
    await clickByText(page, 'Mensajes');
    await page.waitForSelector('button.conversation-item', { timeout: 15000 });
    await page.click('button.conversation-item');
    await page.waitForSelector('.thread-call', { timeout: 10000 });
    // El interlocutor se carga en un efecto aparte; los botones se habilitan
    // cuando `peer` está listo.
    await page.waitForFunction(
      () => !document.querySelector('.thread-call button')?.disabled,
      { timeout: 10000 }
    ).catch(() => {});
  }

  try {
    await openThread(pageA);
    const canCall = await pageA.$('.thread-call button');
    if (!canCall) { bad('Alice no ve los botones de llamada en el hilo'); }
    else ok('Alice ve los botones de llamada');

    for (const [kind, icon, label] of [['audio', '📞', 'VOZ'], ['video', '🎥', 'VÍDEO']]) {
      console.log(`\n▸ Llamada de ${label}`);
      // Alice inicia.
      const started = await pageA.evaluate((ic) => {
        const btn = [...document.querySelectorAll('button')].find((e) => e.textContent.includes(ic));
        if (btn) { btn.click(); return true; }
        return false;
      }, icon);
      if (!started) { bad('Alice no pudo iniciar la llamada'); continue; }

      // Bob recibe la llamada entrante.
      try {
        await pageB.waitForFunction(() => /llamada entrante/i.test(document.body.innerText), { timeout: 12000 });
        ok('Bob recibe el aviso de llamada entrante');
      } catch {
        bad('Bob no recibió la llamada entrante');
        await pageA.evaluate(() => document.querySelector('.call-btn.end')?.click());
        await sleep(1500);
        continue;
      }
      await pageB.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((e) => e.textContent.includes('Aceptar'));
        if (btn) btn.click();
      });

      // Ambos deben llegar a estado activo (botón Colgar).
      try {
        await pageA.waitForFunction(() => document.body.innerText.includes('Colgar') || !!document.querySelector('.call-btn.end'), { timeout: 15000 });
        await pageB.waitForFunction(() => document.body.innerText.includes('Colgar') || !!document.querySelector('.call-btn.end'), { timeout: 15000 });
        ok('la llamada se establece en ambos lados');
      } catch {
        bad('la llamada no llegó a establecerse');
      }

      await sleep(3000);
      const ra = await remoteAudio(pageA);
      const rb = await remoteAudio(pageB);
      if (ra && ra.tracks > 0) ok(`Alice oye audio remoto (pistas=${ra.tracks}, ${ra.readyState})`);
      else bad(`Alice no tiene audio remoto -> ${JSON.stringify(ra)}`);
      if (rb && rb.tracks > 0) ok(`Bob oye audio remoto (pistas=${rb.tracks}, ${rb.readyState})`);
      else bad(`Bob no tiene audio remoto -> ${JSON.stringify(rb)}`);

      if (kind === 'video') {
        const va = await remoteVideo(pageA);
        const vb = await remoteVideo(pageB);
        if (va && va.tracks > 0) ok(`Alice ve vídeo remoto (pistas=${va.tracks}, playing=${va.playing})`);
        else bad(`Alice no tiene vídeo remoto -> ${JSON.stringify(va)}`);
        if (vb && vb.tracks > 0) ok(`Bob ve vídeo remoto (pistas=${vb.tracks}, playing=${vb.playing})`);
        else bad(`Bob no tiene vídeo remoto -> ${JSON.stringify(vb)}`);
      }

      // Colgar.
      await pageA.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((e) => e.textContent.includes('Colgar'));
        if (btn) btn.click();
      });
      // El aviso de fin viaja por el socket; damos margen y comprobamos.
      let closed = false;
      try {
        await pageB.waitForFunction(() => !document.querySelector('.call-btn'), { timeout: 8000 });
        closed = true;
      } catch { /* se reporta abajo */ }
      if (closed) ok('colgar cierra la llamada en el otro lado');
      else {
        const st = await pageB.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 160));
        bad(`la llamada sigue abierta tras colgar -> ${st}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} Llamadas: ${pass} ok, ${fail} fallos`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('Fallo del harness:', e); process.exit(1); });
