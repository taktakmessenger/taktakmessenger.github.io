import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDGE_GAP,
  clampPosition,
  dragTo,
  nearestCorner,
  cornerPosition,
} from '../src/lib/pipPosition.js';

// Área de llamada de 400x600 y cuadro de 120x160, como en un móvil estrecho.
const AREA = { width: 400, height: 600 };
const BOX = { width: 120, height: 160 };

test('una posición dentro de los límites se respeta', () => {
  assert.deepEqual(clampPosition(100, 200, AREA, BOX), { x: 100, y: 200 });
});

test('no se puede salir por arriba ni por la izquierda', () => {
  assert.deepEqual(clampPosition(-50, -80, AREA, BOX), { x: EDGE_GAP, y: EDGE_GAP });
});

test('no se puede salir por abajo ni por la derecha', () => {
  const { x, y } = clampPosition(9999, 9999, AREA, BOX);
  assert.equal(x, AREA.width - BOX.width - EDGE_GAP);
  assert.equal(y, AREA.height - BOX.height - EDGE_GAP);
});

test('un cuadro más grande que el área se ancla al borde, no se sale', () => {
  const grande = { width: 900, height: 900 };
  assert.deepEqual(clampPosition(10, 10, AREA, grande), { x: EDGE_GAP, y: EDGE_GAP });
});

test('sin área o sin cuadro no se lanza', () => {
  assert.deepEqual(clampPosition(5, 5, null, BOX), { x: 0, y: 0 });
  assert.deepEqual(clampPosition(5, 5, AREA, null), { x: 0, y: 0 });
});

test('arrastrar mueve el cuadro con el puntero', () => {
  const origen = { x: 200, y: 300 };
  const inicio = { x: 210, y: 310 };
  const fin = { x: 250, y: 350 };
  assert.deepEqual(dragTo(origen, inicio, fin, AREA, BOX), { x: 240, y: 340 });
});

test('arrastrar fuera del área deja el cuadro dentro', () => {
  const origen = { x: 200, y: 300 };
  const inicio = { x: 200, y: 300 };
  const fin = { x: 5000, y: 5000 };
  const pos = dragTo(origen, inicio, fin, AREA, BOX);
  assert.equal(pos.x, AREA.width - BOX.width - EDGE_GAP);
  assert.equal(pos.y, AREA.height - BOX.height - EDGE_GAP);
});

test('al soltar arriba a la izquierda se pega a esa esquina', () => {
  assert.deepEqual(nearestCorner({ x: 40, y: 60 }, AREA, BOX), {
    x: EDGE_GAP,
    y: EDGE_GAP,
  });
});

test('al soltar abajo a la derecha se pega a esa esquina', () => {
  assert.deepEqual(nearestCorner({ x: 320, y: 480 }, AREA, BOX), {
    x: AREA.width - BOX.width - EDGE_GAP,
    y: AREA.height - BOX.height - EDGE_GAP,
  });
});

test('una posición sin arrastrar también se pega a la esquina más cercana', () => {
  // Centro exacto: el desempate es hacia la esquina inferior derecha.
  assert.deepEqual(nearestCorner({ x: 140, y: 220 }, AREA, BOX), {
    x: AREA.width - BOX.width - EDGE_GAP,
    y: AREA.height - BOX.height - EDGE_GAP,
  });
});

test('cornerPosition devuelve cada esquina', () => {
  const maxX = AREA.width - BOX.width - EDGE_GAP;
  const maxY = AREA.height - BOX.height - EDGE_GAP;
  assert.deepEqual(cornerPosition('top-left', AREA, BOX), { x: EDGE_GAP, y: EDGE_GAP });
  assert.deepEqual(cornerPosition('top-right', AREA, BOX), { x: maxX, y: EDGE_GAP });
  assert.deepEqual(cornerPosition('bottom-left', AREA, BOX), { x: EDGE_GAP, y: maxY });
  assert.deepEqual(cornerPosition('bottom-right', AREA, BOX), { x: maxX, y: maxY });
  assert.deepEqual(cornerPosition('desconocida', AREA, BOX), { x: maxX, y: maxY });
});
