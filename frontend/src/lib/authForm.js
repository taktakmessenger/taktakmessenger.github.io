// Reglas del formulario de alta que no viajan al servidor.
//
// La confirmación de contraseña y la aceptación de términos solo existen en el
// navegador: la API nunca las recibe, así que si no se comprueban aquí no se
// comprueban en ningún sitio. Viven en su propio módulo, separadas del
// componente, para poder probarlas sin montar React.
//
// Los formularios de alta llevan `noValidate` a propósito. Con la validación
// nativa, el navegador muestra sus propios avisos (en el idioma del navegador y
// con otro estilo) y deja sin usar estos mensajes; además bloquearía el envío
// antes de poder comprobar la confirmación de contraseña. Aquí se comprueba
// todo, en español y en un orden fijo.

export const MIN_PASSWORD_LENGTH = 6;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUsername(username) {
  if (!username || username.trim().length < 3) {
    return 'El nombre de usuario debe tener al menos 3 caracteres';
  }
  return null;
}

export function validateEmail(email) {
  if (!email || !EMAIL_PATTERN.test(email)) {
    return 'Escribe un correo válido';
  }
  return null;
}

export function validatePassword(password, confirm) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`;
  }
  if (password !== confirm) {
    return 'Las contraseñas no coinciden';
  }
  return null;
}

export function validateTerms(accepted) {
  return accepted ? null : 'Debes aceptar los términos y la política de privacidad';
}

/**
 * Alta con correo. Devuelve el primer problema, o null si el formulario está
 * bien. Se devuelve el mensaje y no un booleano porque el usuario necesita
 * saber qué corregir, y el orden importa: los datos van antes que los términos.
 */
export function validateRegistration({ username, email, password, confirm, accepted }) {
  return (
    validateUsername(username) ||
    validateEmail(email) ||
    validatePassword(password, confirm) ||
    validateTerms(accepted)
  );
}

/**
 * Alta con teléfono: no hay correo que comprobar, el resto es igual.
 */
export function validatePhoneRegistration({ username, password, confirm, accepted }) {
  return (
    validateUsername(username) || validatePassword(password, confirm) || validateTerms(accepted)
  );
}

/**
 * Texto del botón de reenvío. Un solo sitio decide cómo se ve la espera, para
 * que el correo y el SMS no acaben diciendo cosas distintas.
 */
export function resendLabel(seconds) {
  return seconds > 0 ? `Reenviar código en ${seconds} s` : 'Reenviar código';
}
