// Regresión del caso reportado: videollamada a una cuenta registrada CON
// CORREO (sin teléfono), con las dos personas conectadas.
//
// Antes el marcador solo resolvía números (/users/lookup-phone), y una cuenta
// de correo no tiene teléfono: nunca se encontraba y la videollamada quedaba
// inalcanzable desde ahí, aunque la otra persona sí pudiera recibirla. Ahora el
// marcador acepta @usuario y llama por cuenta, que es como funcionan las
// llamadas WebRTC.
//
// Uso: E2E_BASE_URL=http://127.0.0.1:12000 node test/e2e-call-email-account.mjs
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:12000';
const stamp = Date.now().toString(36).slice(-6);

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
  if (!data?.token) throw new Error(`no se pudo registrar ${username}: HTTP ${res.status}`);
  return data;
}

// Abre la app con una sesión ya iniciada y descarta el modal del teléfono, que
// bloquea a las cuentas nuevas.
async function openApp(browser, user) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t, u) => {
    localStorage.setItem('taktak_token', t);
    localStorage.setItem('taktak_user', JSON.stringify(u));
  }, user.token, user.user);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  for (let i = 0; i < 4; i += 1) {
    const closed = await page.evaluate(() => {
      let n = 0;
      for (const d of document.querySelectorAll('[role="dialog"], .modal')) {
        const b = [...d.querySelectorAll('button')].find((x) => /ahora no|omitir|despu[eé]s|m[aá]s tarde/i.test(x.textContent));
        if (b) { b.click(); n += 1; }
      }
      return n;
    });
    if (!closed) break;
    await page.waitForTimeout(600);
  }
  return page;
}

(async () => {
  const caller = await register(`cal${stamp}`);
  const daughter = await register(`hij${stamp}`);

  const perfil = await fetch(`${BASE}/api/users/${daughter.user.username}`).then((r) => r.json());
  console.log(`  @${perfil.user.username} registrada con correo — teléfono: ${perfil.user.phone ?? '(ninguno)'}`);

  // Chromium sin cámara real: se le dan dispositivos falsos para que
  // getUserMedia funcione y la llamada llegue a establecerse.
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  try {
    const pageHija = await openApp(browser, daughter);
    await pageHija.context().grantPermissions(['microphone', 'camera'], { origin: BASE });
    const pageYo = await openApp(browser, caller);
    await pageYo.context().grantPermissions(['microphone', 'camera'], { origin: BASE });
    await pageYo.waitForTimeout(2000);

    console.log('\n▸ Videollamada desde el marcador buscando por @usuario');
    await pageYo.getByRole('button', { name: 'WhaTaka' }).click();
    await pageYo.waitForTimeout(1500);
    await pageYo.locator('.whataka-tab', { hasText: 'Llamar' }).click();
    await pageYo.waitForTimeout(1500);

    await pageYo.locator('.dialer-number').fill(`@${daughter.user.username}`);
    await pageYo.waitForTimeout(400);
    await pageYo.locator('.dialer-kind-btn', { hasText: 'Vídeo' }).click();
    await pageYo.waitForTimeout(300);
    await pageYo.locator('.dialer-call').click();
    await pageYo.waitForTimeout(4000);

    const resuelto = await pageYo.locator('.dialer-resolved').textContent().catch(() => '');
    check('reconoce la cuenta de correo', resuelto.includes(daughter.user.username), `quedó ${resuelto}`);

    const miEstado = await pageYo.evaluate(() => ({
      overlay: Boolean(document.querySelector('.call-overlay')),
      // `.call-local` es mi propia cámara: solo se dibuja en videollamada.
      camaraPropia: Boolean(document.querySelector('.call-local')),
      toast: document.querySelector('.call-toast')?.textContent?.trim() || null,
    }));
    check('se abre la pantalla de videollamada', miEstado.overlay, JSON.stringify(miEstado));
    check('es de vídeo, no de voz', miEstado.camaraPropia, JSON.stringify(miEstado));

    // Y a la otra persona le suena: la llamada llega de verdad.
    const suena = await pageHija.evaluate(() => ({
      overlay: Boolean(document.querySelector('.call-overlay')),
      texto: document.querySelector('.call-overlay')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) || null,
    }));
    check('a la otra persona le entra la llamada', suena.overlay, JSON.stringify(suena));

    if (suena.overlay) {
      await pageHija.evaluate(() => {
        const b = [...document.querySelectorAll('.call-overlay button')].find((x) =>
          /aceptar|responder|📞/i.test(x.textContent + x.getAttribute('aria-label')));
        b?.click();
      });
      await pageYo.waitForTimeout(4000);
      const activa = await pageYo.evaluate(() => ({
        overlay: Boolean(document.querySelector('.call-overlay')),
        videoRemoto: Boolean(document.querySelector('.call-remote')),
        toast: document.querySelector('.call-toast')?.textContent?.trim() || null,
      }));
      check('la videollamada queda en curso', activa.overlay && !activa.toast, JSON.stringify(activa));
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${failures === 0 ? '✅' : '❌'} Videollamada a cuenta de correo: ${failures} fallo(s)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FALLÓ:', e.message);
  process.exit(1);
});
