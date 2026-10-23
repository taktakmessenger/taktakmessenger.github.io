import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRegistration,
  validatePhoneRegistration,
  validatePassword,
  validateEmail,
  validateTerms,
  resendLabel,
  MIN_PASSWORD_LENGTH,
} from '../src/lib/authForm.js';

// Estas reglas no viajan al servidor: la API nunca recibe la confirmación de
// contraseña ni la casilla de términos. Si el navegador no las comprueba, nadie
// las comprueba, así que se prueban aquí de verdad (sin mocks ni DOM).

const valid = {
  username: 'ana',
  email: 'ana@example.com',
  password: 'secret123',
  confirm: 'secret123',
  accepted: true,
};

test('un formulario completo y correcto no da error', () => {
  assert.equal(validateRegistration(valid), null);
});

test('rechaza contraseñas que no coinciden', () => {
  const problem = validateRegistration({ ...valid, confirm: 'secret124' });
  assert.equal(problem, 'Las contraseñas no coinciden');
});

test('la comprobación de coincidencia distingue mayúsculas', () => {
  assert.ok(validateRegistration({ ...valid, confirm: 'Secret123' }));
});

test('rechaza el alta si no se aceptan los términos', () => {
  const problem = validateRegistration({ ...valid, accepted: false });
  assert.equal(problem, 'Debes aceptar los términos y la política de privacidad');
});

test('rechaza una contraseña corta', () => {
  const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
  const problem = validateRegistration({ ...valid, password: short, confirm: short });
  assert.match(problem, /al menos 6 caracteres/);
});

test('acepta una contraseña justo en el mínimo', () => {
  const exact = 'a'.repeat(MIN_PASSWORD_LENGTH);
  assert.equal(validateRegistration({ ...valid, password: exact, confirm: exact }), null);
});

test('rechaza un nombre de usuario demasiado corto', () => {
  assert.ok(validateRegistration({ ...valid, username: 'ab' }));
});

test('rechaza un nombre de usuario que solo son espacios', () => {
  assert.ok(validateRegistration({ ...valid, username: '   ' }));
});

test('rechaza un correo sin forma de correo', () => {
  assert.ok(validateRegistration({ ...valid, email: 'ana-arroba-ejemplo' }));
});

test('acepta un correo con subdominio y signo más', () => {
  assert.equal(validateEmail('ana+tag@correo.example.com'), null);
});

test('el orden de los avisos es estable: primero los datos, luego los términos', () => {
  // Faltando contraseña y términos a la vez, el usuario debe ver antes el
  // problema de la contraseña: mandarle a leer los términos cuando el alta
  // todavía no puede funcionar sería un rodeo.
  const problem = validateRegistration({ ...valid, confirm: 'otra', accepted: false });
  assert.equal(problem, 'Las contraseñas no coinciden');
});

// El alta por teléfono pide lo mismo salvo el correo. Si esta ruta no validara,
// se gastaría un SMS en un alta que no puede completarse.
test('el alta por teléfono no exige correo', () => {
  const { email, ...phone } = valid;
  assert.equal(validatePhoneRegistration(phone), null);
});

test('el alta por teléfono sí exige contraseñas coincidentes', () => {
  const { email, ...phone } = valid;
  assert.equal(
    validatePhoneRegistration({ ...phone, confirm: 'otra' }),
    'Las contraseñas no coinciden'
  );
});

test('el alta por teléfono exige aceptar los términos', () => {
  const { email, ...phone } = valid;
  assert.equal(
    validatePhoneRegistration({ ...phone, accepted: false }),
    'Debes aceptar los términos y la política de privacidad'
  );
});

test('validatePassword deja pasar un cambio de contraseña válido', () => {
  assert.equal(validatePassword('nueva123', 'nueva123'), null);
});

test('validateTerms acepta solo el valor verdadero', () => {
  assert.equal(validateTerms(true), null);
  assert.ok(validateTerms(false));
  assert.ok(validateTerms(undefined));
});

test('resendLabel cuenta la espera y luego vuelve al texto normal', () => {
  assert.equal(resendLabel(0), 'Reenviar código');
  assert.equal(resendLabel(30), 'Reenviar código en 30 s');
  assert.equal(resendLabel(1), 'Reenviar código en 1 s');
});
