// El mismo usuario llega con `_id` desde /users/me y con `id` desde el resto de
// la API (login, registro). Sin normalizar, `user.id` es `undefined` y se rompen
// cosas que sí parecen funcionar: no se distingue tu propia ventana en el
// directo, la copia optimista de un mensaje se duplica, o los avisos de una vez
// por cuenta se repiten en cada visita.
//
// Se normaliza en el único punto por el que entra el usuario (AuthContext) para
// no tener que acordarse de leer `_id ?? id` en cada componente.

// El id de una persona, venga como `_id` o como `id`.
export function userId(person) {
  return person?._id ?? person?.id ?? null;
}

// Devuelve el usuario con `id` siempre presente (y `_id` conservado, que otras
// partes de la app aún leen).
export function normalizeUser(person) {
  if (!person) return person;
  const id = userId(person);
  return id == null ? person : { ...person, id: String(id) };
}
