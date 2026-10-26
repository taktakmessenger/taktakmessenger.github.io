// Búsqueda de texto tolerante a acentos, para Mongo.
//
// En un móvil nadie escribe "Caimán" ni "café": se escribe "caiman", "cafe".
// Comparar con `$regex` contra el texto tal cual deja esas búsquedas sin
// resultados y el usuario concluye que "la búsqueda no funciona".
//
// La solución es construir una expresión regular en la que cada letra admita
// sus variantes acentuadas. Es el equivalente en Mongo de `fold()` en el
// frontend (`lib/search.js`): se normaliza lo que se escribe y se ensancha el
// patrón para que también case con lo que se guardó con tilde.

// Variantes acentuadas de cada letra, sin la letra base. Se agrupan por el
// carácter ya plegado, así que `fold()` convierte "café" en "cafe" y esta tabla
// devuelve las tildes que hay que volver a admitir en el patrón.
const ACCENTS = {
  a: 'aàáâãäå',
  c: 'cç',
  e: 'eèéêë',
  i: 'iìíîï',
  n: 'nñ',
  o: 'oòóôõö',
  u: 'uùúûü',
  y: 'yýÿ',
};

// Longitud máxima de una consulta. Un patrón muy largo no aporta precisión y
// encarece la búsqueda; se recorta en vez de rechazar, para que pegar de más no
// rompa la pantalla.
const MAX_QUERY = 60;

// Quita los acentos y baja a minúsculas. Igual que en el frontend: dos
// implementaciones de la misma regla se desincronizarían, pero no hay forma de
// compartir código entre el servidor y el navegador aquí.
function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Escapa los caracteres que tendrían significado dentro de una expresión
// regular. Sin esto, buscar "c++" o "a.b" lanzaría un error de sintaxis o
// buscaría algo distinto de lo escrito.
function escapeRegex(char) {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

/**
 * Construye una expresión regular que casa con `query` ignorando acentos y
 * mayúsculas. Devuelve `null` si la consulta queda vacía, para que el llamador
 * pueda saltarse la búsqueda en lugar de hacer coincidir todo.
 */
function buildAccentInsensitiveRegex(query) {
  const folded = fold(query).slice(0, MAX_QUERY);
  if (!folded) return null;

  // Cada carácter se convierte en su propia clase, con la letra y sus tildes.
  // Los que no son letras (espacios, números, signos) se escapan tal cual.
  const pattern = [...folded]
    .map((char) => {
      const variants = ACCENTS[char];
      if (!variants) return escapeRegex(char);
      return `[${variants}]`;
    })
    // Los espacios pueden ser uno o varios: "hola  mundo" casa con "hola mundo".
    .join('')
    .replace(/ /g, '\\s+');

  return new RegExp(pattern, 'i');
}

module.exports = { fold, buildAccentInsensitiveRegex, MAX_QUERY };
