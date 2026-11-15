const test = require('node:test');
const assert = require('node:assert/strict');
const { createSerialQueue } = require('../src/lib/transcodeQueue');

// La propiedad que importa para no reventar la memoria del plan gratuito: nunca
// hay dos trabajos a la vez, aunque se encolen de golpe.
test('la cola ejecuta los trabajos de uno en uno', async () => {
  let concurrent = 0;
  let maxConcurrent = 0;
  const done = [];
  const queue = createSerialQueue(async (job) => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r) => setTimeout(r, 20));
    done.push(job);
    concurrent -= 1;
  });

  await Promise.all([queue.enqueue(1), queue.enqueue(2), queue.enqueue(3)]);

  assert.equal(maxConcurrent, 1, 'no puede haber dos trabajos simultáneos');
  assert.deepEqual(done, [1, 2, 3], 'se respeta el orden de llegada');
});

test('un trabajo que falla no bloquea a los siguientes', async () => {
  const done = [];
  const queue = createSerialQueue(async (job) => {
    if (job === 2) throw new Error('boom');
    done.push(job);
  });

  await queue.enqueue(1);
  await queue.enqueue(2);
  await queue.enqueue(3);

  assert.deepEqual(done, [1, 3]);
  assert.equal(queue.running, false);
  assert.equal(queue.pending, 0);
});
