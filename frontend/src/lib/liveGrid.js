// Disposición de la rejilla del directo de un TAK Creator.
//
// Es la parte "de cálculo" del directo, separada del componente para poder
// probarla sin navegador: dado un número de participantes, ¿cuántas columnas
// tiene la rejilla? ¿Quién va primero? ¿Cuánto ocupa el anfitrión?

// Columnas de la rejilla de invitados según cuántos hay.
//
// La regla es la misma que usa TikTok: el vídeo del anfitrión ocupa la parte de
// arriba y los invitados se reparten debajo en una rejilla que se adapta. Con
// pocos invitados se usan pocas columnas para que cada ventana sea grande; a
// partir de cierto número se añade una columna, hasta un tope, porque a partir
// de ahí las ventanas serían más pequeñas que un pulgar y no se distinguiría la
// cara.
//
// Devuelve el número de columnas (1..4).
export function guestColumns(count) {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

// Cuántas filas necesita la rejilla para `count` invitados con `columns`
// columnas. Se usa para decidir la altura de cada ventana.
export function guestRows(count, columns = guestColumns(count)) {
  if (count <= 0) return 0;
  return Math.ceil(count / columns);
}

// Orden de las ventanas del directo: primero el anfitrión, después el resto.
//
// El anfitrión va primero porque es la ventana grande; el orden de los demás es
// estable (por id) para que no salten de sitio cuando alguien entra o sale y
// React vuelve a pintar la lista.
export function orderParticipants(participants, hostId) {
  const host = String(hostId ?? '');
  const hostEntry = participants.find((p) => String(p.id) === host) || null;
  const others = participants
    .filter((p) => String(p.id) !== host)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { host: hostEntry, guests: others };
}

// ¿Está el directo lleno? El anfitrión no cuenta para el aforo, así que se
// compara el número de invitados con el límite. Un límite no numérico o 0 se
// interpreta como "sin tope".
export function isLiveFull(guestCount, guestLimit) {
  const limit = Number(guestLimit);
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return guestCount >= limit;
}
