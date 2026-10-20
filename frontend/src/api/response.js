// Helpers del cliente de la API. Se mantienen libres de globales del navegador
// y de `import.meta` para poder probarlos con node a secas.

// Mensaje que ve el usuario cuando una respuesta no es JSON. La API de TAK TAK
// siempre responde JSON, así que un cuerpo HTML significa que la petición nunca
// llegó a la API: un alojamiento estático sirvió el index.html de la SPA, o un
// proxy devolvió su propia página de error. Se rechaza antes de que el
// componente lea campos de ese cuerpo, que es lo que producía
// "Unexpected token '<', '<!DOCTYPE' … is not valid JSON" (parseo estricto) o
// un "Cannot read properties of undefined" sin pista del problema real.
export const NOT_JSON_MESSAGE =
  'No se pudo conectar con el servicio de TAK TAK. Comprueba tu conexión e inténtalo de nuevo.';

export const NO_RESPONSE_MESSAGE =
  'No hay conexión con el servidor de TAK TAK. Comprueba tu red e inténtalo de nuevo.';

export function isJsonResponse(response) {
  const contentType = response?.headers?.['content-type'] || '';
  return String(contentType).toLowerCase().includes('json');
}

// Un JSON escalar (número, cadena, null) no sirve: todos los llamadores leen
// campos con nombre.
export function isJsonPayload(data) {
  return data !== null && typeof data === 'object';
}

// Traduce un fallo de axios a un texto comprensible, sin filtrar detalles
// técnicos ni el cuerpo crudo de la respuesta.
export function messageFromError(error) {
  const response = error?.response;

  if (response) {
    if (!isJsonResponse(response) || !isJsonPayload(response.data)) {
      return NOT_JSON_MESSAGE;
    }
    const serverMessage = response.data.error;
    if (typeof serverMessage === 'string' && serverMessage) return serverMessage;
    return `Error del servidor (${response.status})`;
  }

  // Sin respuesta: red caída, CORS o el servicio no escucha.
  if (error?.request) return NO_RESPONSE_MESSAGE;
  return error?.message || 'Error de conexión';
}
