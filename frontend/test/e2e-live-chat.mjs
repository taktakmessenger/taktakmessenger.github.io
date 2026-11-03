// Prueba de extremo a extremo del directo con comentarios y regalos, con dos
// navegadores reales. Un usuario abre el directo de su TAK Creator (anfitrión)
// y otro entra como espectador; se comprueba que el comentario cruza, que el
// regalo mueve monedas de verdad y que el espectador no enciende cámara ni
// micrófono. No usa mocks: recorre el mismo camino que una persona.
//
// Uso:  node test/e2e-live-chat.mjs
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:13000';
const stamp = Date.now();

let failures = 0;
function check(label, condition, extra = '') {
  const mark = condition ? '✓' : '✗';
  if (!condition) failures += 1;
  console.log(`  ${mark} ${label}${extra ? ` — ${extra}` : ''}`);
}

async function dismissPrompts(page) {
  for (let i = 0; i < 12; i += 1) {
    const closed = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      let count = 0;
      for (const dialog of dialogs) {
        const button = [...dialog.querySelectorAll('button')].find((b) =>
          /ahora no|omitir|cerrar|no, gracias/i.test(b.textContent.trim())
        );
        if (button) {
          button.click();
          count += 1;
        }
      }
      return count;
    });
    await page.waitForTimeout(400);
    if (closed === 0 && (await page.locator('[role="dialog"]').count()) === 0) return;
  }
}

async function register(context, name) {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`    [pageerror ${name}] ${e.message}`));
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
  await dismissPrompts(page);
  return { page, user: data.user, username, token: data.token };
}

// Abre la pestaña de creators y el contenido de un squad concreto (el suyo).
async function openSquadFeed(me) {
  await me.page.getByRole('button', { name: 'TAK Live Creator' }).click();
  await me.page.waitForTimeout(800);
  await me.page.locator('.squad-card').first().getByRole('button', { name: 'Ver contenido' }).click();
  await me.page.waitForTimeout(600);
}

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

try {
  const ctxHost = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const ctxViewer = await browser.newContext({ permissions: ['microphone', 'camera'] });

  console.log('\n▸ Registro de anfitrión y espectador');
  const host = await register(ctxHost, 'host');
  const viewer = await register(ctxViewer, 'viewer');
  check('los dos entran en la app', Boolean(host.user?.id && viewer.user?.id));

  console.log('\n▸ El anfitrión crea un creator público y abre su directo');
  const squadRes = await fetch(`${BASE}/api/squads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}` },
    body: JSON.stringify({ name: `Directo ${stamp}`, visibility: 'public' }),
  });
  check('el creator se crea', squadRes.status === 201, `status=${squadRes.status}`);
  const squad = (await squadRes.json()).squad;

  await openSquadFeed(host);
  await host.page.getByRole('button', { name: '🎥 Entrar al directo' }).click();
  await host.page.waitForTimeout(2500);
  const hostLive = await host.page.locator('.live-stage').count();
  check('el directo del anfitrión se abre', hostLive === 1);
  check(
    'el panel de comentarios está visible',
    (await host.page.locator('.live-chat').count()) === 1
  );

  console.log('\n▸ El espectador entra con "Ver como espectador"');
  // El espectador no debe conceder permisos: se le revoca el permiso del
  // contexto para que, si la app intentara abrir la cámara, fallara.
  await ctxViewer.clearPermissions();
  await viewer.page.getByRole('button', { name: 'TAK Live Creator' }).click();
  await viewer.page.waitForTimeout(800);
  await viewer.page.locator('.squad-card').first().getByRole('button', { name: 'Ver contenido' }).click();
  await viewer.page.waitForTimeout(500);
  await viewer.page.getByRole('button', { name: '👀 Ver como espectador' }).click();
  await viewer.page.waitForTimeout(2500);

  const spectatorLabel = await viewer.page
    .locator('.live-stage-title small')
    .textContent()
    .catch(() => '');
  check('el espectador ve el directo', (await viewer.page.locator('.live-stage').count()) === 1);
  check('se muestra como espectador', /espectador/i.test(spectatorLabel || ''), spectatorLabel);
  check(
    'el espectador no tiene botones de cámara ni micro',
    (await viewer.page.locator('.live-ctrl').count()) === 2,
    'solo regalo y salir'
  );

  console.log('\n▸ Comentario del espectador → lo ve el anfitrión');
  const comment = `hola directo ${stamp}`;
  await viewer.page.locator('.live-chat-form input').fill(comment);
  await viewer.page.locator('.live-chat-send').click();
  await host.page.waitForTimeout(1200);
  const hostChatText = await host.page.locator('.live-chat-list').textContent();
  check('el comentario cruza la sala', hostChatText.includes(comment), hostChatText.trim().slice(-60));
  check('el comentario lleva el autor', hostChatText.includes(viewer.username));

  console.log('\n▸ Regalo del espectador → mueve monedas y anima');
  const before = await fetch(`${BASE}/api/wallet`, {
    headers: { Authorization: `Bearer ${viewer.token}` },
  }).then((r) => r.json());
  await viewer.page.getByRole('button', { name: 'Enviar un regalo' }).click();
  await viewer.page.waitForTimeout(600);
  const giftButtons = await viewer.page.locator('.live-gift-btn').count();
  check('se listan los regalos del catálogo', giftButtons > 0, `${giftButtons} regalos`);
  await viewer.page.locator('.live-gift-btn').first().click();
  await viewer.page.locator('.live-gifts-send').click();
  await host.page.waitForTimeout(1500);

  const after = await fetch(`${BASE}/api/wallet`, {
    headers: { Authorization: `Bearer ${viewer.token}` },
  }).then((r) => r.json());
  check(
    'al espectador le bajan las monedas',
    after.spendable < before.spendable,
    `${before.spendable} → ${after.spendable}`
  );
  const hostChatAfter = await host.page.locator('.live-chat-list').textContent();
  check('el anfitrión ve el regalo en el chat', /envió/i.test(hostChatAfter));
  check('el anfitrión ve la animación del regalo', (await host.page.locator('.live-gift-flash').count()) >= 1);

  console.log('\n▸ El anfitrión comenta y el espectador lo ve');
  // Se cierra el panel de regalos del espectador para volver a ver su chat.
  await viewer.page.getByRole('button', { name: 'Enviar un regalo' }).click();
  await viewer.page.waitForTimeout(400);
  const reply = `gracias ${stamp}`;
  await host.page.locator('.live-chat-form input').fill(reply);
  await host.page.locator('.live-chat-send').click();
  await viewer.page.waitForTimeout(1200);
  const viewerChatText = await viewer.page.locator('.live-chat-list').textContent();
  check('la respuesta vuelve al espectador', viewerChatText.includes(reply));

  console.log('\n▸ Salir del directo');
  await viewer.page.locator('.live-ctrl.end').click();
  await viewer.page.waitForTimeout(800);
  check('el espectador sale', (await viewer.page.locator('.live-stage').count()) === 0);
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? '✅' : '❌'} ${failures} fallo(s)`);
process.exit(failures === 0 ? 0 : 1);
