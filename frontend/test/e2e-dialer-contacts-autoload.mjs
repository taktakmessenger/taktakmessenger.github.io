// Regresión de la carga automática de contactos en el marcador.
//
// El navegador no expone la agenda sin permiso, así que el flujo real es:
//   1. Primera vez: el usuario pulsa «Importar» y el navegador pide permiso.
//   2. A partir de ahí, la app recuerda el permiso y al abrir el marcador
//      vuelve a leer la agenda sola, sin que el usuario pulse nada.
//
// Esta prueba simula la agenda del teléfono (`navigator.contacts.select`) y
// comprueba los dos pasos, incluida la persistencia tras recargar.
//
// Uso: E2E_BASE_URL=http://127.0.0.1:12000 node test/e2e-dialer-contacts-autoload.mjs
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

// Instala una agenda falsa en la página. `select` devuelve los contactos que se
// le pasan, como haría el navegador tras conceder el permiso.
async function fakeAgenda(page, contacts) {
  await page.addInitScript((list) => {
    navigator.contacts = {
      select: async () => list,
    };
  }, contacts);
}

async function cerrarModales(page) {
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
}

async function abrirMarcador(page) {
  await page.getByRole('button', { name: 'WhaTaka' }).click();
  await page.waitForTimeout(1200);
  await page.locator('.whataka-tab', { hasText: 'Llamar' }).click();
  await page.waitForTimeout(1200);
}

(async () => {
  const user = await register(`auto${stamp}`);
  const agenda = [
    { name: ['Mamá'], tel: ['+34600111001'] },
    { name: ['Oficina'], tel: ['+34600222002', '+34600333003'] },
    { name: ['Sin número'], tel: [] },
  ];

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

  try {
    await fakeAgenda(page, agenda);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t, u) => {
      localStorage.setItem('taktak_token', t);
      localStorage.setItem('taktak_user', JSON.stringify(u));
    }, user.token, user.user);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    await cerrarModales(page);
    await abrirMarcador(page);

    console.log('\n▸ Primera vez: hace falta pulsar «Importar»');
    const botonInicial = (await page.locator('.dialer-contacts-head button').textContent())?.trim();
    check('el botón dice «Importar»', /importar/i.test(botonInicial), botonInicial);

    await page.locator('.dialer-contacts-head button').click();
    await page.waitForTimeout(800);
    let lista = await page.locator('.dialer-contact').allTextContents();
    check('trae los contactos con teléfono', lista.some((t) => t.includes('Mamá')), JSON.stringify(lista));
    check('una fila por teléfono', lista.filter((t) => t.includes('Oficina')).length === 2, JSON.stringify(lista));
    check('descarta el contacto sin número', !lista.some((t) => t.includes('Sin número')), JSON.stringify(lista));

    console.log('\n▸ Tras conceder el permiso, se carga sola');
    // Se recarga la app (simula volver a abrirla). La agenda debe aparecer sin
    // tocar el botón: es exactamente lo que se pidió.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    await cerrarModales(page);
    await abrirMarcador(page);
    await page.waitForTimeout(800);
    lista = await page.locator('.dialer-contact').allTextContents();
    check('la agenda aparece sin pulsar nada', lista.some((t) => t.includes('Mamá')), JSON.stringify(lista));
    const boton = (await page.locator('.dialer-contacts-head button').textContent())?.trim();
    check('el botón pasa a «Sincronizar»', /sincronizar/i.test(boton), boton);

    console.log('\n▸ La caché sobrevive sin la API de contactos');
    // Otra pestaña del MISMO contexto (comparte localStorage) pero SIN la
    // agenda simulada: debe seguir viendo lo cacheado, porque la app recordó lo
    // último que leyó.
    const page2 = await page.context().newPage();
    await page2.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page2.waitForTimeout(2200);
    await cerrarModales(page2);
    await abrirMarcador(page2);
    const cache = await page2.locator('.dialer-contact').allTextContents();
    check('los contactos salen de la caché', cache.some((t) => t.includes('Mamá')), JSON.stringify(cache));
    await page2.close();
  } finally {
    await browser.close();
  }

  console.log(`\n${failures === 0 ? '✅' : '❌'} Carga automática de contactos: ${failures} fallo(s)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FALLÓ:', e.message);
  process.exit(1);
});
