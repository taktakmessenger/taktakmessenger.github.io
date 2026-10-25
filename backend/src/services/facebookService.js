const env = require('../config/env');
const { HttpError } = require('../utils/http');

// Facebook Login no firma un JWT como Google: el SDK del navegador entrega un
// token de acceso opaco. La única forma de saber si ese token es de verdad para
// nuestra app es preguntarle a Facebook, y eso es lo que hace `debug_token`.
// Sin este paso, cualquiera podría enviar el token de *otra* aplicación y
// entrar con la identidad de un tercero.
//
// La URL base se puede apuntar a un servidor falso en los tests, igual que
// Stripe y PayPal: así se ejercita el mismo código (petición, cabeceras,
// parseo) en vez de sustituir la función por un doble.
function graphBase() {
  return env.facebookGraphBase;
}

function isConfigured() {
  return Boolean(env.facebookAppId && env.facebookAppSecret);
}

// `access_token` con el formato `app_id|app_secret` es el "app access token":
// autoriza consultar la información del propio token, no a actuar como un
// usuario. Se manda en la URL y no en una cabecera porque es lo que espera el
// endpoint de depuración de Facebook.
function appAccessToken() {
  return `${env.facebookAppId}|${env.facebookAppSecret}`;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Verifica un token de acceso de Facebook y devuelve los datos del perfil.
 *
 * Cada comprobación importa:
 *
 *  - `debug_token` contra el app access token: confirma que el token es válido
 *    y que lo emitió Facebook, no un tercero.
 *  - `data.app_id` igual a nuestro App ID: es la comprobación que impide que un
 *    token de otra aplicación sirva para entrar aquí. Es el equivalente al
 *    `aud` de Google.
 *  - `data.is_valid`: un token caducado o revocado no vale.
 *  - `data.user_id` y el perfil: la identidad real, leída del Graph API y no
 *    del cliente (el navegador no decide quién eres).
 */
async function verifyFacebookAccessToken(userAccessToken) {
  if (!isConfigured()) {
    throw new HttpError(503, 'El inicio de sesión con Facebook no está configurado');
  }
  if (!userAccessToken || typeof userAccessToken !== 'string') {
    throw new HttpError(400, 'Token de Facebook requerido');
  }

  const debugUrl = new URL(`${graphBase()}/debug_token`);
  debugUrl.searchParams.set('input_token', userAccessToken);
  debugUrl.searchParams.set('access_token', appAccessToken());

  let debugRes;
  try {
    debugRes = await fetch(debugUrl);
  } catch {
    throw new HttpError(503, 'No se pudo verificar el token de Facebook');
  }
  const debug = await readJson(debugRes);
  const info = debug?.data;

  if (!debugRes.ok || !info) {
    throw new HttpError(401, 'Token de Facebook inválido');
  }
  if (info.is_valid !== true) {
    throw new HttpError(401, 'Token de Facebook inválido o caducado');
  }
  if (String(info.app_id) !== String(env.facebookAppId)) {
    throw new HttpError(401, 'Token de Facebook emitido para otra aplicación');
  }

  const userId = info.user_id;
  if (!userId) throw new HttpError(401, 'Token de Facebook sin usuario');

  // El perfil se lee del Graph API con el token del usuario. El correo solo
  // llega si la app tiene el permiso `email` y la persona lo autorizó, así que
  // su ausencia es normal y no un error.
  const meUrl = new URL(`${graphBase()}/me`);
  meUrl.searchParams.set('fields', 'id,name,email,picture.type(large)');
  meUrl.searchParams.set('access_token', userAccessToken);

  let profile = null;
  try {
    const meRes = await fetch(meUrl);
    profile = meRes.ok ? await readJson(meRes) : null;
  } catch {
    profile = null;
  }

  const email = profile?.email ? String(profile.email).toLowerCase() : null;

  return {
    facebookId: String(userId),
    email,
    // Facebook no expone un `email_verified` como Google: un correo devuelto
    // por el Graph API pertenece a una cuenta de Facebook ya verificada por
    // ellos. Aun así, el enlace con una cuenta existente exige que el correo
    // esté presente y se trata como verificado solo cuando viene informado.
    emailVerified: Boolean(email),
    name: profile?.name || null,
    picture: profile?.picture?.data?.url || null,
  };
}

module.exports = { verifyFacebookAccessToken, isConfigured };
