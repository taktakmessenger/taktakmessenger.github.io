import { loadStripe } from '@stripe/stripe-js';

// Carga perezosa de Stripe.js.
//
// Stripe.js se descarga de los servidores de Stripe y solo hace falta cuando el
// usuario va a guardar una tarjeta. Cargarlo al arrancar la app añadiría una
// petición a un tercero en cada visita, incluso para quien nunca va a pagar.
let stripePromise = null;

// Un solo Stripe.js por clave publicable. Si el usuario cambia de cuenta (otra
// clave) se recarga; si es la misma, se reutiliza la instancia.
let loadedKey = null;

export function getStripe(publishableKey) {
  if (!publishableKey) {
    return Promise.reject(new Error('Falta la clave de Stripe'));
  }
  if (!stripePromise || loadedKey !== publishableKey) {
    loadedKey = publishableKey;
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
}

// Solo para los tests: deja limpia la caché entre casos.
export function _resetStripeCache() {
  stripePromise = null;
  loadedKey = null;
}

/**
 * Guarda una tarjeta sin cobrarla.
 *
 * El número viaja del formulario DIRECTO a Stripe con la clave publicable; a
 * nuestro servidor solo llega el `pm_...`. Por eso esta función vive en el
 * navegador y el backend nunca ve la tarjeta.
 *
 * El cliente de Stripe se recibe como parámetro en vez de cargarse aquí dentro:
 * así la lógica (validar el formulario, confirmar, sacar el id) se puede probar
 * con un cliente real de mentira, sin tener que simular la descarga de Stripe.js.
 *
 * `elements.submit()` es obligatorio antes de confirmar: si no, Stripe rechaza
 * la confirmación porque el formulario aún no está validado.
 */
export async function saveCardWithStripe({ stripe, clientSecret, elements }) {
  if (!stripe) throw new Error('Stripe no está disponible');

  const { error: submitError } = await elements.submit();
  if (submitError) {
    throw new Error(submitError.message || 'Revisa los datos de la tarjeta');
  }

  const { error, setupIntent } = await stripe.confirmSetup({
    elements,
    clientSecret,
    // Sin `redirect: 'if_required'`, Stripe puede llevar al usuario a una página
    // externa incluso cuando no hace falta. Aquí la tarjeta se confirma en la
    // misma pantalla, y solo se redirige si el banco lo exige.
    redirect: 'if_required',
  });

  if (error) {
    throw new Error(error.message || 'No se pudo guardar la tarjeta');
  }

  // Stripe devuelve el método como id suelto o como objeto expandido según la
  // versión de la API; se aceptan las dos formas.
  const paymentMethodId = setupIntent?.payment_method;
  if (!paymentMethodId) {
    throw new Error('Stripe no devolvió la tarjeta guardada');
  }

  return typeof paymentMethodId === 'string' ? paymentMethodId : paymentMethodId.id;
}
