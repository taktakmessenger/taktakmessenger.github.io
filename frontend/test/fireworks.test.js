// La celebración lanza varios estallidos repartidos en círculo alrededor del
// punto de origen. `fire` es una función, así que se prueba con una falsa que
// apunta lo que se le pide, sin navegador ni React de por medio.

import test from 'node:test';
import assert from 'node:assert/strict';
import { celebrate } from '../src/lib/fireworks.js';

test('celebrate reparte los estallidos alrededor del punto', async () => {
  const calls = [];
  const fire = (x, y, hue) => calls.push({ x, y, hue });

  celebrate(fire, 200, 300, [10, 20, 30, 40]);

  // Los estallidos van escalonados, así que hay que dejar pasar el último.
  await new Promise((resolve) => setTimeout(resolve, 600));

  assert.equal(calls.length, 4, 'deberían salir cuatro estallidos');
  // Cada uno en su ángulo: el primero a la derecha, el segundo abajo, etc.
  assert.ok(calls[0].x > 200, 'el primero cae a la derecha del origen');
  assert.equal(calls[0].y, 300);
  assert.deepEqual(calls.map((c) => c.hue), [10, 20, 30, 40]);
  // Todos salen cerca del origen, no por toda la pantalla.
  for (const c of calls) {
    assert.ok(Math.abs(c.x - 200) <= 100, 'no se aleja demasiado en horizontal');
    assert.ok(Math.abs(c.y - 300) <= 70, 'no se aleja demasiado en vertical');
  }
});

test('celebrate sin colores usa la paleta de la casa', async () => {
  const hues = [];
  celebrate((x, y, hue) => hues.push(hue), 0, 0);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.deepEqual(hues, [45, 285, 325, 170]);
});
