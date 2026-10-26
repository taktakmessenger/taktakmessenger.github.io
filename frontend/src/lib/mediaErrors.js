// Traduce el fallo de `getUserMedia` a algo que una persona pueda accionar.
//
// El navegador lanza un `DOMException` cuyo `message` viene en inglés y no
// ayuda ("Permission denied"), pero su `name` es estable y está en la spec. Ese
// es el que se mira. Sin esto, el usuario veía el texto crudo del navegador y no
// sabía que lo que tenía que hacer era conceder el permiso.
const MESSAGES = {
  NotAllowedError:
    'Permiso de cámara o micrófono denegado. Actívalo en los ajustes del navegador para este sitio y vuelve a intentarlo.',
  PermissionDeniedError:
    'Permiso de cámara o micrófono denegado. Actívalo en los ajustes del navegador para este sitio y vuelve a intentarlo.',
  NotFoundError: 'No se encontró ninguna cámara ni micrófono en este dispositivo.',
  DevicesNotFoundError: 'No se encontró ninguna cámara ni micrófono en este dispositivo.',
  NotReadableError:
    'La cámara o el micrófono están siendo usados por otra aplicación. Ciérrala y vuelve a intentarlo.',
  TrackStartError:
    'La cámara o el micrófono están siendo usados por otra aplicación. Ciérrala y vuelve a intentarlo.',
  OverconstrainedError: 'Este dispositivo no tiene la cámara que se pidió.',
  ConstraintNotSatisfiedError: 'Este dispositivo no tiene la cámara que se pidió.',
  SecurityError: 'El navegador bloqueó el acceso a la cámara y el micrófono.',
};

const GENERIC = 'No se pudo acceder a la cámara o al micrófono.';

// Se mira el `name` de la excepción, que es estable y está en la spec. El
// `message` del navegador viene en inglés y se descarta a propósito: mostrarlo
// tal cual fue justo el fallo ("Permission denied" sin decir qué hacer).
export function mediaErrorMessage(err) {
  return MESSAGES[err?.name] || GENERIC;
}
