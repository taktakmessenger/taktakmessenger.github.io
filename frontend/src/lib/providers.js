// Carga la configuración del despliegue: la lista de países (para el selector
// de prefijos) y qué proveedores opcionales existen.
//
// Reintenta con espera creciente a propósito. Esta es la primera llamada de la
// sesión, y justo después de un reinicio el backend puede tardar unos segundos
// en responder. Con una sola intentona, un fallo de arranque dejaba el marcador
// sin códigos de área hasta recargar la página entera: la lista se pedía una
// vez, el error se tragaba y nadie volvía a intentarlo.
export const RETRY_DELAYS = [1000, 2000, 4000, 8000];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `request` es una función que devuelve una promesa de axios. Devuelve los datos
// de la respuesta, o lanza el último error si se agotan los reintentos.
// `shouldAbort` permite cortar la espera si el componente se desmonta: sin él,
// un reintento programado seguiría vivo tras salir de la pantalla.
export async function loadProviders(request, options = {}) {
  const { delays = RETRY_DELAYS, sleep = wait, shouldAbort } = options;
  let lastError;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    if (shouldAbort?.()) return undefined;
    try {
      const { data } = await request();
      return data;
    } catch (err) {
      lastError = err;
      if (attempt >= delays.length) break;
      await sleep(delays[attempt]);
    }
  }

  throw lastError;
}
