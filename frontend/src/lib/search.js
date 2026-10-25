// Búsqueda de texto que ignora acentos y mayúsculas.
//
// En un móvil nadie escribe "Caimán" ni "Perú": se escribe "caiman", "peru",
// "mexico". Comparar contra el nombre tal cual deja esos términos sin
// resultados, y el usuario concluye que "el selector de país no funciona".
export function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// ¿Coincide `haystack` con lo que se ha escrito en `query`? Un término vacío
// coincide con todo, para no filtrar nada mientras no se ha buscado.
export function matches(haystack, query) {
  const q = fold(query);
  if (!q) return true;
  return fold(haystack).includes(q);
}
