import test from 'node:test';
import assert from 'node:assert/strict';
import { saveCardWithStripe, _resetStripeCache } from '../src/services/stripe.js';

// El cliente de Stripe se construye a mano en cada caso. No es un doble de la
// función que se prueba —esa es la de verdad—, sino un sustituto de la librería
// de Stripe, que en Node no se puede descargar. Lo que se ejercita es la lógica
// propia: validar el formulario, traducir el error y sacar el identificador.

function fakeElements({ submitError = null } = {}) {
  return {
    submitted: false,
    async submit() {
      this.submitted = true;
      return { error: submitError };
    },
  };
}

function fakeStripe({ error = null, paymentMethod = 'pm_123', asObject = false } = {}) {
  return {
    lastCall: null,
    async confirmSetup(args) {
      this.lastCall = args;
      return {
        error,
        setupIntent: { payment_method: asObject ? { id: paymentMethod } : paymentMethod },
      };
    },
  };
}

test('saveCardWithStripe confirma el SetupIntent y devuelve el id de la tarjeta', async () => {
  const elements = fakeElements();
  const stripe = fakeStripe();

  const id = await saveCardWithStripe({
    stripe,
    clientSecret: 'seti_secret',
    elements,
  });

  assert.equal(id, 'pm_123');
  assert.equal(elements.submitted, true, 'no se validó el formulario');
  assert.equal(stripe.lastCall.clientSecret, 'seti_secret');
  // Sin esto Stripe puede sacar al usuario de la app aunque no haga falta.
  assert.equal(stripe.lastCall.redirect, 'if_required');
});

test('saveCardWithStripe acepta el método expandido como objeto', async () => {
  const id = await saveCardWithStripe({
    stripe: fakeStripe({ asObject: true }),
    clientSecret: 'seti_secret',
    elements: fakeElements(),
  });

  assert.equal(id, 'pm_123');
});

test('si el formulario no valida, no se llama a confirmSetup', async () => {
  const stripe = fakeStripe();
  await assert.rejects(
    () =>
      saveCardWithStripe({
        stripe,
        clientSecret: 'seti_secret',
        elements: fakeElements({ submitError: { message: 'Número incompleto' } }),
      }),
    /Número incompleto/
  );

  assert.equal(stripe.lastCall, null, 'se confirmó un formulario inválido');
});

test('un error de Stripe se propaga con su mensaje', async () => {
  await assert.rejects(
    () =>
      saveCardWithStripe({
        stripe: fakeStripe({ error: { message: 'Tarjeta rechazada' } }),
        clientSecret: 'seti_secret',
        elements: fakeElements(),
      }),
    /Tarjeta rechazada/
  );
});

test('si Stripe no devuelve método, se falla en claro', async () => {
  await assert.rejects(
    () =>
      saveCardWithStripe({
        stripe: fakeStripe({ paymentMethod: null }),
        clientSecret: 'seti_secret',
        elements: fakeElements(),
      }),
    /no devolvió la tarjeta guardada/
  );
});

test('sin cliente de Stripe se falla antes de tocar el formulario', async () => {
  const elements = fakeElements();
  await assert.rejects(
    () => saveCardWithStripe({ stripe: null, clientSecret: 'x', elements }),
    /Stripe no está disponible/
  );
  assert.equal(elements.submitted, false);
});

// `_resetStripeCache` existe para que los tests no arrastren estado entre casos.
test('la caché de Stripe.js se puede limpiar', () => {
  _resetStripeCache();
  assert.ok(true);
});
