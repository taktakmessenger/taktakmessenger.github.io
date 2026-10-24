// Prueba real de una llamada entre dos usuarios, con dos navegadores y
// micrófono/cámara simulados. Comprueba lo que el usuario reporta: que el
// micrófono y el altavoz funcionan de verdad.
//
// Chromium puede generar un tono en el micrófono falso (`--use-fake-device-
// for-media-stream`) y, con `--use-fake-ui-for-media-stream`, conceder el
// permiso sin diálogo. Así se recorre el camino completo: getUserMedia,
// WebRTC, señalización por socket y reproducción del audio remoto.
//
// Uso:  node test/e2e-call.mjs
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:12000';
const stamp = Date.now();

let failures = 0;
function check(label, condition, extra = '') {
  const mark = condition ? '✓' : '✗';
  if (!condition) failures += 1;
  console.log(`  ${mark} ${label}${extra ? ` — ${extra}` : ''}`);
}

async function register(context, name) {
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

  const username = `${name}_${stamp}`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      email: `${username}@example.com`,
      password: 'clave12345',
    }),
  });
  if (!res.ok) throw new Error(`registro falló: ${res.status}`);
  const data = await res.json();

  await page.goto(BASE);
  await page.evaluate(
    ([token, user]) => {
      localStorage.setItem('taktak_token', token);
      localStorage.setItem('taktak_user', JSON.stringify(user));
    },
    [data.token, data.user]
  );
  await page.reload();
  await page.waitForTimeout(1200);
  return { page, user: data.user, logs };
}

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

try {
  const ctxA = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const ctxB = await browser.newContext({ permissions: ['microphone', 'camera'] });

  console.log('\n▸ Registro de los dos participantes');
  const a = await register(ctxA, 'ana');
  const b = await register(ctxB, 'beto');
  check('los dos entran en la app', Boolean(a.user?.id && b.user?.id));

  console.log('\n▸ getUserMedia concede micrófono y cámara');
  const media = await a.page.evaluate(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      const audio = stream.getAudioTracks();
      const video = stream.getVideoTracks();
      const result = {
        ok: true,
        audio: audio.length,
        video: video.length,
        audioEnabled: audio[0]?.enabled,
        label: audio[0]?.label || '',
      };
      stream.getTracks().forEach((t) => t.stop());
      return result;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  check('se obtiene una pista de audio', media.ok && media.audio === 1, JSON.stringify(media));
  check('la pista de audio está activa', media.audioEnabled === true);
  check('se obtiene una pista de vídeo', media.ok && media.video === 1);

  console.log('\n▸ El audio se mide de verdad (no es un stream vacío)');
  // Un stream puede existir y no llevar sonido. Aquí se comprueba con un
  // analizador de audio que llegan muestras con energía, que es lo que de
  // verdad significa "el micrófono funciona".
  const energy = await a.page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let max = 0;
    for (let i = 0; i < 25; i += 1) {
      await new Promise((r) => setTimeout(r, 40));
      analyser.getFloatTimeDomainData(data);
      for (const v of data) max = Math.max(max, Math.abs(v));
    }
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
    return max;
  });
  check('el micrófono capta señal (RMS > 0)', energy > 0, `pico=${energy.toFixed(4)}`);

  console.log('\n▸ La app lista las salidas de audio');
  const outputs = await a.page.evaluate(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audiooutput').length;
  });
  check('hay al menos una salida de audio', outputs >= 1, `${outputs} salidas`);

  console.log('\n▸ Llamada completa entre los dos');
  // Ana llama a Beto desde la interfaz real de la app.
  await a.page.evaluate(async (peerId) => {
    // Se usa el mismo camino que la interfaz: el botón de llamar de un perfil.
    const btn = document.querySelector(`[data-call-user="${peerId}"]`);
    if (btn) btn.click();
  }, b.user.id);

  // Si no hay botón accesible (el otro usuario no está en pantalla), se llama
  // por el contexto expuesto en la app.
  const started = await a.page.evaluate(async (peerId) => {
    if (window.__taktakCall?.startCall) {
      // Videollamada: es el único caso en que existe el cuadro propio que se
      // arrastra, y así se comprueba también la pista de vídeo de extremo a
      // extremo.
      await window.__taktakCall.startCall({ id: peerId, username: 'beto' }, 'video');
      return true;
    }
    return false;
  }, b.user.id);
  check('la llamada se inicia', started);

  await a.page.waitForTimeout(2500);
  const stateA = await a.page.evaluate(() =>
    window.__taktakCall ? { status: window.__taktakCall.status } : null
  );
  const stateB = await b.page.evaluate(() =>
    window.__taktakCall ? { status: window.__taktakCall.status } : null
  );
  check('Ana está llamando', stateA?.status === 'ringing', JSON.stringify(stateA));
  check('A Beto le suena', stateB?.status === 'incoming', JSON.stringify(stateB));

  console.log('\n▸ Beto acepta y se comprueba el audio remoto');
  await b.page.evaluate(async () => {
    await window.__taktakCall?.acceptCall?.();
  });
  await a.page.waitForTimeout(4000);

  const after = await Promise.all([
    a.page.evaluate(() => window.__taktakCall?.status),
    b.page.evaluate(() => window.__taktakCall?.status),
  ]);
  check('los dos quedan en llamada', after[0] === 'active' && after[1] === 'active', after.join(' / '));

  // El audio remoto tiene que estar sonando de verdad: el elemento <audio> con
  // el stream del otro, y con muestras que llegan.
  const remote = await a.page.evaluate(async () => {
    const el = document.querySelector('audio[autoplay]');
    if (!el || !el.srcObject) return { ok: false, reason: 'sin elemento de audio remoto' };
    const tracks = el.srcObject.getAudioTracks();
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(el.srcObject);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let max = 0;
    for (let i = 0; i < 25; i += 1) {
      await new Promise((r) => setTimeout(r, 40));
      analyser.getFloatTimeDomainData(data);
      for (const v of data) max = Math.max(max, Math.abs(v));
    }
    ctx.close();
    return { ok: true, tracks: tracks.length, paused: el.paused, energy: max };
  });
  check('hay pista de audio remota', remote.ok && remote.tracks >= 1, JSON.stringify(remote));
  check('el audio remoto no está en pausa', remote.ok && remote.paused === false);
  check('el audio remoto lleva señal (se oye)', remote.ok && remote.energy > 0, `pico=${(remote.energy || 0).toFixed(4)}`);

  console.log('\n▸ El cuadro propio arranca abajo a la derecha y es arrastrable');
  const drag = await a.page.evaluate(async () => {
    const box = document.querySelector('.call-local');
    const stage = document.querySelector('.call-stage');
    if (!box || !stage) return { ok: false, reason: 'sin cuadro propio' };

    const r = (el) => el.getBoundingClientRect();
    const before = r(box);
    const area = r(stage);

    // Arranca pegado a la esquina inferior derecha del área.
    const startsBottomRight =
      Math.abs(area.right - before.right - 10) < 3 &&
      Math.abs(area.bottom - before.bottom - 10) < 3;

    // Se arrastra hasta bien entrada la mitad izquierda, no solo un poco: si se
    // suelta cerca del centro, el cuadro se pega a la derecha otra vez y la
    // comprobación no probaría nada.
    const fire = (type, x, y) =>
      box.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        })
      );
    const toX = area.left + 30;
    const toY = area.top + 30;
    fire('pointerdown', before.left + 20, before.top + 20);
    fire('pointermove', toX, toY);
    fire('pointerup', toX, toY);
    await new Promise((res) => setTimeout(res, 400));

    const after = r(box);
    return {
      ok: true,
      startsBottomRight,
      snappedTopLeft: Math.abs(after.left - area.left - 10) < 3 && Math.abs(after.top - area.top - 10) < 3,
      moved: Math.abs(after.left - before.left) > 50 && Math.abs(after.top - before.top) > 50,
      before: { x: Math.round(before.left), y: Math.round(before.top) },
      after: { x: Math.round(after.left), y: Math.round(after.top) },
    };
  });
  check('arranca en la esquina inferior derecha', drag.ok && drag.startsBottomRight, JSON.stringify(drag.before));
  check('se mueve al arrastrarlo', drag.ok && drag.moved, JSON.stringify(drag.after));
  check('al soltar se pega a la esquina más cercana', drag.ok && drag.snappedTopLeft, JSON.stringify(drag.after));

  console.log('\n▸ Colgar deja la llamada cerrada');
  await a.page.evaluate(() => window.__taktakCall?.hangUp?.());
  await a.page.waitForTimeout(1500);
  const ended = await a.page.evaluate(() => window.__taktakCall?.status);
  check('Ana queda fuera de la llamada', ended === 'idle', String(ended));

  const errors = [...a.logs, ...b.logs].filter(
    (l) =>
      /pageerror|error:/i.test(l) &&
      !/favicon|404/i.test(l) &&
      // Chromium avisa de que `navigator.vibrate` está bloqueado sin un toque
      // real. Es informativo y esperado en una prueba automática, que nunca
      // toca la pantalla: no indica ningún fallo de la app.
      !/Blocked call to navigator.vibrate/i.test(l)
  );
  check('sin errores de página', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  failures += 1;
  console.error('\n✗ La prueba falló:', err.message);
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\n✅ Llamada correcta de extremo a extremo\n' : `\n❌ ${failures} comprobaciones fallidas\n`);
process.exit(failures === 0 ? 0 : 1);
