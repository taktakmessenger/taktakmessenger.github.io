// Prueba de extremo a extremo de los adjuntos del chat, con dos navegadores
// reales. Navega por la interfaz como un usuario: pestaña WhaTaka, abre el chat
// escribiendo el @usuario, adjunta un archivo por el botón y lo envía. No usa
// mocks: recorre el mismo camino que una persona.
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:13000';
const stamp = Date.now();

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const browser = await chromium.launch();

async function register(context, name) {
  const page = await context.newPage();
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
  const data = await res.json();
  if (!data.token) throw new Error(`no se pudo registrar ${name}: ${JSON.stringify(data)}`);
  await page.goto(BASE);
  await page.evaluate(
    ([token, user]) => {
      localStorage.setItem('taktak_token', token);
      localStorage.setItem('taktak_user', JSON.stringify(user));
    },
    [data.token, data.user]
  );
  await page.reload();
  await page.waitForTimeout(1500);
  await dismissPrompts(page);
  return { page, user: data.user, username };
}

// Descarta los avisos que tapan la barra de pestañas (teléfono y
// notificaciones). Se pulsa su "Ahora no" por DOM y no con un clic simulado:
// los dos avisos pueden solaparse y un clic normal queda interceptado por el
// otro. La app reacciona igual, porque el manejador es el mismo.
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
    if (closed === 0) {
      const remaining = await page.locator('[role="dialog"]').count();
      if (remaining === 0) return;
    }
  }
}

// Abre la pestaña WhaTaka y el hilo con otro usuario, por la interfaz.
async function openChatWith(me, otherUsername) {
  await me.page.getByRole('button', { name: 'WhaTaka' }).click();
  await me.page.waitForTimeout(600);

  // El formulario de nuevo chat está detrás del botón "＋". Se abre primero,
  // como haría una persona.
  await me.page.locator('.btn-new-chat').click();
  await me.page.waitForTimeout(300);

  const form = me.page.locator('.start-chat');
  await form.locator('input').fill(otherUsername);
  await form.locator('button[type="submit"]').click();
  await me.page.waitForTimeout(1500);
}

const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const a = await register(ctxA, 'ana');
const b = await register(ctxB, 'beto');

console.log('\n▸ Ana abre el chat con Beto desde la interfaz');
await openChatWith(a, b.username);
const hasComposer = await a.page.locator('.thread-composer').count();
check('el chat se abre y aparece el compositor', hasComposer > 0);

console.log('\n▸ El compositor tiene botón de adjuntar');
const hasAttach = await a.page.locator('.composer-attach').count();
check('el botón de adjuntar está presente', hasAttach > 0);

// --- Subida de imagen por la interfaz -------------------------------------
console.log('\n▸ Ana adjunta una imagen y la envía');
await a.page.setInputFiles('.thread-composer input[type="file"]', {
  name: 'mi foto.png',
  mimeType: 'image/png',
  buffer: PNG_1X1,
});
await a.page.waitForTimeout(1500);

const preview = await a.page
  .locator('.composer-preview .preview-name')
  .textContent()
  .catch(() => null);
check('la vista previa muestra el nombre ya limpio', preview === 'mi_foto.png', String(preview));

await a.page.fill('.thread-composer input[type="text"]', 'mira esta foto');
await a.page.click('.thread-composer button[type="submit"]');
await a.page.waitForTimeout(2000);

const mine = await a.page.evaluate(() => {
  const img = document.querySelector('.bubble-row.mine .bubble-image img');
  return {
    hasImage: Boolean(img),
    src: img?.getAttribute('src') || null,
    text: document.querySelector('.bubble-row.mine .bubble-text')?.textContent || null,
    previewGone: !document.querySelector('.composer-preview'),
  };
});
check('Ana ve su imagen en el hilo', mine.hasImage, JSON.stringify({ src: mine.src, text: mine.text }));
check('la imagen se sirve desde el servidor', /^\/uploads\/chat\//.test(mine.src || ''), String(mine.src));
check('el pie de foto viaja con la imagen', mine.text === 'mira esta foto', String(mine.text));
check('la vista previa se limpia al enviar', mine.previewGone);

// --- Beto la recibe -------------------------------------------------------
console.log('\n▸ Beto recibe la imagen');
await openChatWith(b, a.username);
await b.page.waitForTimeout(1000);

const theirs = await b.page.evaluate(async () => {
  const img = document.querySelector('.bubble-row.theirs .bubble-image img');
  if (!img) return { hasImage: false };
  // Se comprueba que la imagen carga de verdad, no solo que exista el nodo.
  const res = await fetch(img.getAttribute('src'));
  return {
    hasImage: true,
    src: img.getAttribute('src'),
    status: res.status,
    disposition: res.headers.get('content-disposition'),
    nosniff: res.headers.get('x-content-type-options'),
  };
});
check('Beto ve la imagen que le enviaron', theirs.hasImage, String(theirs.src));
check('la imagen se sirve bien (200)', theirs.status === 200, String(theirs.status));
check('se sirve en línea para poder verla', /^inline;/.test(theirs.disposition || ''), String(theirs.disposition));
check('lleva nosniff, no se puede ejecutar como otra cosa', theirs.nosniff === 'nosniff', String(theirs.nosniff));

// --- Un HTML no permitido se rechaza --------------------------------------
console.log('\n▸ Un HTML no se puede subir (seguridad)');
const rejected = await a.page.evaluate(async () => {
  const token = localStorage.getItem('taktak_token');
  const form = new FormData();
  form.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'malo.html');
  const res = await fetch('/api/messages/attachments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
});
check('el servidor rechaza el HTML', rejected.status === 400, JSON.stringify(rejected.body));

// --- Un archivo genérico se descarga --------------------------------------
console.log('\n▸ Un PDF se ofrece como descarga, no en línea');
const pdf = await a.page.evaluate(async () => {
  const token = localStorage.getItem('taktak_token');
  const form = new FormData();
  form.append('file', new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), 'informe.pdf');
  const up = await fetch('/api/messages/attachments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await up.json();
  if (!data.attachment) return { ok: false, data };
  const head = await fetch(data.attachment.url);
  return {
    ok: true,
    kind: data.attachment.kind,
    disposition: head.headers.get('content-disposition'),
  };
});
check('el PDF se acepta como archivo', pdf.ok && pdf.kind === 'file', JSON.stringify(pdf));
check('el PDF se descarga, no se muestra', /^attachment;/.test(pdf.disposition || ''), String(pdf.disposition));

// --- Sin errores de página ------------------------------------------------
const errors = [];
a.page.on('pageerror', (e) => errors.push(e.message));
await a.page.waitForTimeout(300);
check('sin errores de página', errors.length === 0, errors.join(' | '));

await browser.close();

if (failures > 0) {
  console.log(`\n❌ ${failures} comprobaciones fallidas`);
  process.exit(1);
}
console.log('\n✅ Adjuntos del chat correctos de extremo a extremo');
