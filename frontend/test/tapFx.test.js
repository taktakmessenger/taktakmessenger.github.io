// Las animaciones táctiles se apoyan en el DOM, y la suite de este proyecto no
// trae un navegador simulado. En vez de meter jsdom solo para esto, se monta un
// DOM falso mínimo —el trozo que usa `tapFx`— y se prueba la lógica de verdad:
// qué nodo se anima, con qué clase, y que se respeta "menos movimiento".

import test from 'node:test';
import assert from 'node:assert/strict';

// --- DOM falso mínimo -------------------------------------------------------
function makeElement(tag, text = '') {
  const el = {
    tagName: tag.toUpperCase(),
    text,
    children: [],
    parentElement: null,
    style: {},
    offsetWidth: 0,
    _listeners: {},
    _classes: new Set(),
    get textContent() {
      return this.children.length
        ? this.children.map((c) => c.textContent).join('')
        : this.text;
    },
    classList: null,
    addEventListener(type, fn, opts) {
      (this._listeners[type] ||= []).push({ fn, opts });
    },
    dispatch(type) {
      for (const { fn, opts } of this._listeners[type] || []) {
        fn({ type });
        if (opts && opts.once) this._listeners[type] = [];
      }
    },
    closest(selector) {
      const tags = selector.split(',').map((s) => s.trim().toUpperCase());
      let node = this;
      while (node) {
        if (tags.includes(node.tagName)) return node;
        node = node.parentElement;
      }
      return null;
    },
    append(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
  };
  el.classList = {
    add: (c) => el._classes.add(c),
    remove: (c) => el._classes.delete(c),
    contains: (c) => el._classes.has(c),
  };
  return el;
}

function installFakeDom({ reducedMotion = false } = {}) {
  const registry = [];
  const document = {
    addEventListener: (type, fn, opts) => {
      (document._listeners[type] ||= []).push({ fn, opts });
    },
    _listeners: {},
    dispatch(type, event) {
      for (const { fn } of document._listeners[type] || []) fn(event);
    },
    querySelectorAll: () => registry,
  };
  const win = { matchMedia: () => ({ matches: reducedMotion }) };
  globalThis.document = document;
  globalThis.window = win;
  globalThis.getComputedStyle = (el) => ({ display: el.style.display || 'inline' });
  return { registry, document, win };
}

function teardown() {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.getComputedStyle;
}

test('al pulsar la campana, el icono se menea', async () => {
  const { registry, document } = installFakeDom();
  const tapFx = await import('../src/lib/tapFx.js');
  tapFx.installTapFx();

  const btn = makeElement('button');
  const bell = btn.append(makeElement('span', '🔔'));
  registry.push(btn, bell);

  document.dispatch('pointerdown', { target: bell });
  assert.ok(bell._classes.has('tak-fx-swing'), 'la campana debería menearse');
  assert.ok(!btn._classes.has('tak-fx-tap'), 'el botón entero no se anima si hay icono');

  teardown();
});

test('al pulsar la lupa, va de puntillas', async () => {
  const { registry, document } = installFakeDom();
  const tapFx = await import('../src/lib/tapFx.js');
  tapFx.installTapFx();

  const btn = makeElement('button');
  const glass = btn.append(makeElement('span', '🔎'));
  registry.push(btn, glass);

  document.dispatch('pointerdown', { target: glass });
  assert.ok(glass._classes.has('tak-fx-tiptoe'));

  teardown();
});

test('un botón sin icono se anima entero', async () => {
  const { registry, document } = installFakeDom();
  const tapFx = await import('../src/lib/tapFx.js');
  tapFx.installTapFx();

  const btn = makeElement('button', 'Enviar');
  registry.push(btn);

  document.dispatch('pointerdown', { target: btn });
  assert.ok(btn._classes.has('tak-fx-tap'));

  teardown();
});

test('con "menos movimiento" no se anima nada', async () => {
  const { registry, document } = installFakeDom({ reducedMotion: true });
  const tapFx = await import('../src/lib/tapFx.js');
  tapFx.installTapFx();

  const btn = makeElement('button');
  const bell = btn.append(makeElement('span', '🔔'));
  registry.push(btn, bell);

  document.dispatch('pointerdown', { target: bell });
  assert.equal(bell._classes.size, 0, 'no debería animarse');

  teardown();
});

test('la animación se reinicia al terminar, para poder repetirla', async () => {
  const { registry, document } = installFakeDom();
  const tapFx = await import('../src/lib/tapFx.js');
  tapFx.installTapFx();

  const btn = makeElement('button');
  const bell = btn.append(makeElement('span', '🔔'));
  registry.push(btn, bell);

  document.dispatch('pointerdown', { target: bell });
  assert.ok(bell._classes.has('tak-fx-swing'));

  // El navegador avisa de que la animación acabó: la clase se retira y una
  // segunda pulsación puede volver a animar.
  bell.dispatch('animationend');
  assert.ok(!bell._classes.has('tak-fx-swing'), 'la clase debería retirarse al acabar');

  document.dispatch('pointerdown', { target: bell });
  assert.ok(bell._classes.has('tak-fx-swing'), 'debería poder repetirse');

  teardown();
});
