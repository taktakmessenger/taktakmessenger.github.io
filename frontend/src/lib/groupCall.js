// Reglas de a quién se puede invitar a una llamada grupal. Viven aquí, fuera
// del contexto, para poder probarlas sin navegador: son el filtro que evita
// invitarse a uno mismo, repetir a alguien o pasarse del tope.

// Tope de la llamada grupal. El mismo número lo aplica el servidor; aquí sirve
// para no dejar elegir a más gente de la que cabe.
export const GROUP_CALL_MAX = 4;

/**
 * Normaliza la lista de invitados de una llamada grupal.
 *
 * - Quita a quien llama (no se invita a sí mismo).
 * - Quita repetidos: invitar dos veces a la misma persona no ocupa dos plazas.
 * - Quita valores vacíos.
 * - Recorta a `max - 1`, porque quien llama ocupa una de las plazas.
 *
 * Acepta tanto ids sueltos como objetos `{ id }` / `{ _id }`, que es como llegan
 * las personas desde la API.
 */
export function normalizeInvitees(people, selfId, max = GROUP_CALL_MAX) {
  const self = String(selfId ?? '');
  const ids = (people || [])
    .map((p) => String(p?.id || p?._id || p || ''))
    .filter((id) => id && id !== self);
  return [...new Set(ids)].slice(0, Math.max(0, max - 1));
}
