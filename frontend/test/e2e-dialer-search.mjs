// Regresión de los tres fallos reportados en el marcador y el chat:
//
//  1. Buscar un país SIN TILDE ("caiman", "peru", "mexico") no encontraba nada.
//     El filtro comparaba el nombre tal cual, así que quien escribe como se
//     escribe en un móvil se quedaba sin resultados y parecía que el selector
//     de código de área no funcionaba.
//  2. El selector de país no se podía cerrar sin elegir uno: ni tocando fuera
//     ni con Escape. Quien lo abría por error se quedaba con él encima.
//  3. "Importar" contactos no lleva a ninguna parte en los navegadores que no
//     exponen la agenda (escritorio, iOS). Debe haber una vía manual.
//
// Uso: E2E_BASE_URL=http://127.0.0.1:12000 node test/e2e-dialer-search.mjs
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
  if (!data?.token) throw new Error(`no se pudo registrar ${username}: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// Escribe en el buscador de países como lo haría una persona y devuelve los
// resultados visibles.
async function buscar(page, term) {
  await page.evaluate((t) => {
    const inp = document.querySelector('.dialer-picker-search');
    if (!inp) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, t);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, term);
  await page.waitForTimeout(500);
  return page.locator('.dialer-picker-item').allTextContents();
}

const abrirPicker = (page) =>
  page.evaluate(() => {
    if (!document.querySelector('.dialer-picker')) document.querySelector('.dialer-country-btn')?.click();
  });

(async () => {
  const user = await register(`dlr${stamp}`);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t, u) => {
      localStorage.setItem('taktak_token', t);
      localStorage.setItem('taktak_user', JSON.stringify(u));
    }, user.token, user.user);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // El modal del teléfono es bloqueante para una cuenta nueva.
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

    await page.getByRole('button', { name: 'WhaTaka' }).click();
    await page.waitForTimeout(1500);
    await page.locator('.whataka-tab', { hasText: 'Llamar' }).click();
    await page.waitForTimeout(1500);

    console.log('\n▸ Buscar país sin tilde (el fallo reportado)');
    const casos = [
      ['caiman', 'Caimán'],
      ['peru', 'Perú'],
      ['mexico', 'México'],
      ['espana', 'España'],
      ['turquia', 'Turquía'],
    ];
    for (const [termino, esperado] of casos) {
      await abrirPicker(page);
      await page.waitForTimeout(300);
      const items = await buscar(page, termino);
      check(`"${termino}" encuentra ${esperado}`, items.some((t) => t.includes(esperado)), JSON.stringify(items.slice(0, 2)));
    }

    const porPrefijo = await buscar(page, '+34');
    check('"+34" encuentra España', porPrefijo.some((t) => t.includes('España')), JSON.stringify(porPrefijo));

    console.log('\n▸ Cerrar el selector sin elegir país');
    await buscar(page, '');
    await page.mouse.click(20, 120);
    await page.waitForTimeout(600);
    check('tocar fuera cierra el selector', (await page.locator('.dialer-picker').count()) === 0);

    await abrirPicker(page);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    check('Escape cierra el selector', (await page.locator('.dialer-picker').count()) === 0);

    console.log('\n▸ Elegir un país deja su prefijo');
    await abrirPicker(page);
    await page.waitForTimeout(400);
    await buscar(page, 'caiman');
    await page.locator('.dialer-picker-item').first().click();
    await page.waitForTimeout(600);
    const prefijo = (await page.locator('.dialer-dial').textContent())?.trim();
    check('elegir Caimán fija +1', prefijo === '+1', `quedó ${prefijo}`);

    console.log('\n▸ Llamar a una cuenta registrada CON CORREO (sin teléfono)');
    // Es el caso reportado: una cuenta de correo no tiene teléfono, así que la
    // búsqueda por número nunca la encuentra. Se busca por @usuario.
    const soloCorreo = await register(`mail${stamp}`);
    await page.locator('.dialer-number').fill(`@${soloCorreo.user.username}`);
    await page.waitForTimeout(400);
    await page.locator('.dialer-call').click();
    await page.waitForTimeout(2500);
    const resuelto = await page.locator('.dialer-resolved').textContent().catch(() => '');
    check(
      'el marcador reconoce la cuenta de correo',
      resuelto.includes(soloCorreo.user.username),
      `quedó ${resuelto}`
    );
    const estadoLlamada = await page.locator('.dialer-status').textContent();
    check('confirma que está en TAK TAK', /TAK TAK/i.test(estadoLlamada), estadoLlamada);

    console.log('\n▸ Contactos: alta manual cuando no hay agenda');
    const hayApi = await page.evaluate(() => typeof navigator.contacts?.select !== 'undefined');
    console.log(`  (navigator.contacts disponible: ${hayApi})`);
    await page.locator('.dialer-contact-add input').nth(0).fill('Prueba');
    await page.locator('.dialer-contact-add input').nth(1).fill('+34600111222');
    await page.locator('.dialer-contact-add button[type="submit"]').click();
    await page.waitForTimeout(700);
    const lista = await page.locator('.dialer-contact').allTextContents();
    check('el contacto se añade a la lista', lista.some((t) => t.includes('Prueba')), JSON.stringify(lista));

    await page.locator('.dialer-contact').first().click();
    await page.waitForTimeout(500);
    const marcado = await page.locator('.dialer-number').inputValue();
    check('pulsar el contacto lo pone en el marcador', marcado === '+34600111222', `quedó ${marcado}`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'WhaTaka' }).click();
    await page.waitForTimeout(1500);
    await page.locator('.whataka-tab', { hasText: 'Llamar' }).click();
    await page.waitForTimeout(1500);
    const trasRecargar = await page.locator('.dialer-contact').count();
    check('el contacto persiste al recargar', trasRecargar >= 1, `quedaron ${trasRecargar}`);
  } finally {
    await browser.close();
  }

  console.log(`\n${failures === 0 ? '✅' : '❌'} Marcador y contactos: ${failures} fallo(s)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FALLÓ:', e.message);
  process.exit(1);
});
