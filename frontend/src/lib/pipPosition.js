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

// Esquina más cercana a una posición libre. Al soltar el cuadro se pega a una
// esquina, que es el comportamiento de WhatsApp: el vídeo queda siempre
// alineado y no flotando en mitad de la pantalla.
export function nearestCorner(position, area, box) {
  if (!area || !box) return { x: 0, y: 0 };

  const { x, y } = clampPosition(position.x, position.y, area, box);
  const maxX = area.width - box.width - EDGE_GAP;
  const maxY = area.height - box.height - EDGE_GAP;

  // Se decide por el centro del cuadro, no por su esquina: un cuadro casi tan
  // ancho como el área no se movería si solo se mirase el borde izquierdo.
  const centerX = x + box.width / 2;
  const centerY = y + box.height / 2;

  return {
    x: centerX < area.width / 2 ? EDGE_GAP : Math.max(EDGE_GAP, maxX),
    y: centerY < area.height / 2 ? EDGE_GAP : Math.max(EDGE_GAP, maxY),
  };
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
