// Animaciones táctiles de los iconos: la app "responde" al dedo.
//
// Cada icono tiene su gesto y todos los botones tienen, al menos, un hundido
// corto. Se hace con clases de CSS (ver `premium.css`): aquí solo se decide
// QUÉ se anima y CUÁNDO, sin tocar el marcado de cada pantalla. Hay dos
// disparadores:
//   1. Tocar cualquier botón de la app (una sola escucha global, abajo).
//   2. Un evento (llega un mensaje, suena una llamada…) vía `pulseIcon`.
//
// Se respeta a quien pide menos movimiento: con `prefers-reduced-motion` no se
// anima nada.

const ICON_FX = {
  '🔔': 'tak-fx-swing',   // campana: se menea de lado a lado
  '🔎': 'tak-fx-tiptoe',  // lupa: entra de puntillas
  '🔍': 'tak-fx-tiptoe',
  '💬': 'tak-fx-wiggle',  // mensaje: se retuerce
  '✉️': 'tak-fx-wiggle',
  '📞': 'tak-fx-ring',    // teléfono: suena
  '📱': 'tak-fx-ring',
  '📰': 'tak-fx-flip',    // periódico: se voltea
  '👥': 'tak-fx-jiggle',  // grupo: se menear
  '👤': 'tak-fx-nod',     // perfil: asiente
  '🏠': 'tak-fx-pop',     // casa: rebota
  '＋': 'tak-fx-pop',     // subir: brota
  '➕': 'tak-fx-pop',
  '🪙': 'tak-fx-coin',    // moneda: gira
  '💰': 'tak-fx-coin',
  '👑': 'tak-fx-pop',
  '🏆': 'tak-fx-pop',
};

const DEFAULT_FX = 'tak-fx-tap';
const ICON_KEYS = Object.keys(ICON_FX);
const ANIM_CLASSES = [DEFAULT_FX, ...new Set(Object.values(ICON_FX))];

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Reinicia una animación: sin quitar la clase y forzar un reflujo, tocar dos
// veces seguidas no vuelve a animar (el navegador ve la clase ya puesta).
function restart(el, cls) {
  if (!el) return;
  for (const c of ANIM_CLASSES) el.classList.remove(c);
  // Los iconos son <span> en línea: sin esto la transformación no se aplica.
  if (getComputedStyle(el).display === 'inline') el.style.display = 'inline-block';
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

// Busca, dentro de un botón, el nodo que ES un icono (su texto es exactamente
// un emoji del catálogo). Devuelve null si el botón no lleva icono.
function findIconNode(btn) {
  const walk = (node) => {
    for (const child of node.children) {
      if (ICON_KEYS.includes(child.textContent.trim())) return child;
      const deeper = walk(child);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(btn);
}

// Todos los nodos de la página cuyo texto es ese icono (para animar el icono
// aunque el evento venga de otra pantalla).
function nodesForIcon(icon) {
  const found = [];
  const all = document.querySelectorAll('span, i, b, em, button, a');
  for (const el of all) {
    if (el.childElementCount === 0 && el.textContent.trim() === icon) found.push(el);
  }
  return found;
}

// Animación por evento: llega un mensaje (💬), suena una llamada (📞)…
export function pulseIcon(icon) {
  if (typeof document === 'undefined' || prefersReducedMotion()) return;
  const cls = ICON_FX[icon] || DEFAULT_FX;
  for (const el of nodesForIcon(icon)) restart(el, cls);
}

let installedDoc = null;

// Una sola escucha para toda la app: al pulsar, se anima el icono del botón (o
// el botón entero si no lleva icono). Así funciona también en los botones que
// se añadan en el futuro, sin tener que tocar cada componente.
//
// Se recuerda en qué documento se instaló: si el documento cambia (remontaje,
// recarga en caliente) se vuelve a registrar en vez de no hacer nada.
export function installTapFx() {
  if (typeof document === 'undefined' || installedDoc === document) return undefined;
  installedDoc = document;

  const onDown = (event) => {
    if (prefersReducedMotion()) return;
    const btn = event.target.closest('button, [role="button"], a[href], .ptak-btn');
    if (!btn) return;
    const icon = findIconNode(btn);
    if (icon) restart(icon, ICON_FX[icon.textContent.trim()] || DEFAULT_FX);
    else restart(btn, DEFAULT_FX);
  };

  document.addEventListener('pointerdown', onDown, { passive: true });
  return () => {
    document.removeEventListener('pointerdown', onDown);
    installedDoc = null;
  };
}
