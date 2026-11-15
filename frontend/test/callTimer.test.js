import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCallTimer } from '../src/lib/callTimer.js';

// El reloj de la llamada se lee como el de WhatsApp. Se prueban los bordes que
// de verdad importan: el arranque, el paso a minutos, la hora y los valores
// sucios que puede mandar el temporizador (negativos, decimales, nada).

test('segundos sueltos se muestran como m:ss', () => {
  assert.equal(formatCallTimer(0), '0:00');
  assert.equal(formatCallTimer(7), '0:07');
  assert.equal(formatCallTimer(59), '0:59');
});

test('al llegar al minuto se muestra m:ss con los segundos a dos cifras', () => {
  assert.equal(formatCallTimer(60), '1:00');
  assert.equal(formatCallTimer(83), '1:23');
  assert.equal(formatCallTimer(600), '10:00');
});

test('a partir de la hora se añade el tramo de horas', () => {
  assert.equal(formatCallTimer(3600), '1:00:00');
  assert.equal(formatCallTimer(3723), '1:02:03');
  assert.equal(formatCallTimer(86399), '23:59:59');
});

test('los decimales se truncan hacia abajo, no se redondean', () => {
  // Un reloj que redondea al alza saltaría de "0:01" a "0:02" antes de tiempo.
  assert.equal(formatCallTimer(1.9), '0:01');
  assert.equal(formatCallTimer(59.9), '0:59');
});

test('valores sucios caen a 0:00 en vez de romper el render', () => {
  assert.equal(formatCallTimer(-5), '0:00');
  assert.equal(formatCallTimer(undefined), '0:00');
  assert.equal(formatCallTimer(null), '0:00');
  assert.equal(formatCallTimer(NaN), '0:00');
  assert.equal(formatCallTimer('12'), '0:12');
});
