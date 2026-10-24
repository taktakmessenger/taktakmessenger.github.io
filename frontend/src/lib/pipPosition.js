// Posición del cuadro pequeño donde te ves durante una videollamada. Se puede
// arrastrar a cualquier esquina, como en WhatsApp.
//
// Toda la aritmética vive aquí, fuera de React y sin DOM, para poder probarla
// con valores conocidos. El componente solo aplica el resultado.

// Separación mínima con el borde del área de llamada, para que el cuadro no
// quede pegado (ni se salga) al arrastrarlo a una esquina.
export const EDGE_GAP = 10;

// Posición por defecto: esquina inferior derecha, que es donde menos estorba
// sobre el vídeo del otro.
export const DEFAULT_POSITION = { x: null, y: null };

// Deja una posición dentro de los límites. Un cuadro más grande que el área no
// puede colocarse entero, así que se ancla al borde con la separación mínima en
// vez de salirse por el lado contrario.
export function clampPosition(x, y, area, box) {
  if (!area || !box) return { x: 0, y: 0 };

  const maxX = area.width - box.width - EDGE_GAP;
  const maxY = area.height - box.height - EDGE_GAP;

  return {
    x: Math.max(EDGE_GAP, Math.min(x, Math.max(EDGE_GAP, maxX))),
    y: Math.max(EDGE_GAP, Math.min(y, Math.max(EDGE_GAP, maxY))),
  };
}

// Convierte un desplazamiento del puntero en una posición nueva. Se parte
// siempre de la posición del arrastre anterior y no del punto donde se agarró
// el cuadro: así el cuadro no da un salto si se empieza a arrastrar por el
// borde en vez de por el centro.
export function dragTo(origin, startPointer, pointer, area, box) {
  const x = origin.x + (pointer.x - startPointer.x);
  const y = origin.y + (pointer.y - startPointer.y);
  return clampPosition(x, y, area, box);
}

// Posición de esquina concreta, para las transiciones sin arrastre.
export function cornerPosition(corner, area, box) {
  if (!area || !box) return { x: 0, y: 0 };
  const maxX = Math.max(EDGE_GAP, area.width - box.width - EDGE_GAP);
  const maxY = Math.max(EDGE_GAP, area.height - box.height - EDGE_GAP);

  switch (corner) {
    case 'top-left':
      return { x: EDGE_GAP, y: EDGE_GAP };
    case 'top-right':
      return { x: maxX, y: EDGE_GAP };
    case 'bottom-left':
      return { x: EDGE_GAP, y: maxY };
    case 'bottom-right':
    default:
      return { x: maxX, y: maxY };
  }
}

// Nombre de la esquina más cercana a una posición. Se guarda la esquina y no
// los píxeles: si el área cambia de tamaño (girar el móvil, redimensionar), una
// posición en píxeles deja de ser válida y el cuadro podría quedar fuera. La
// esquina, en cambio, siempre se puede recalcular.
export function cornerOf(position, area, box) {
  if (!area || !box) return 'bottom-right';

  const { x, y } = clampPosition(position.x, position.y, area, box);
  const centerX = x + box.width / 2;
  const centerY = y + box.height / 2;

  if (centerY < area.height / 2) {
    return centerX < area.width / 2 ? 'top-left' : 'top-right';
  }
  return centerX < area.width / 2 ? 'bottom-left' : 'bottom-right';
}
