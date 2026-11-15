import api from '../api/client.js';
import { getToken } from './session.js';

// Guarda un blob con el nombre de archivo indicado. Centraliza el baile de
// `URL.createObjectURL` y su liberación, que antes estaba repetido.
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // El blob se libera en cuanto el navegador ha tomado el archivo; sin esto la
  // memoria del vídeo queda retenida mientras viva la pestaña.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Trae el fichero como blob. Se pide por `fileUrl`, que apunta a nuestra propia
// API, para que la descarga no dependa de que el bucket (R2) mande cabeceras
// CORS.
//
// La cabecera de sesión se añade solo a las rutas propias (`/...`): mandar el
// JWT a un dominio ajeno lo expondría sin necesidad.
async function fetchAsBlob(url) {
  const token = getToken();
  const sameOrigin = url.startsWith('/');
  const res = await fetch(url, {
    headers: sameOrigin && token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('No se pudo descargar el archivo del video');
  return res.blob();
}

// Descarga un video (propio o ajeno). El servidor autoriza la bajada y devuelve
// el descriptor con el nombre de archivo legible.
//
// El fichero se guarda a partir de un blob en lugar de apuntar el enlace directo
// a la URL del servidor: ese endpoint envía su propia cabecera
// `Content-Disposition` con el nombre interno del archivo, y el navegador le da
// prioridad sobre el atributo `download`. Con un blob no hay cabecera que
// compita y el archivo se guarda con el nombre que el usuario espera.
export async function downloadVideo(videoId) {
  const { data } = await api.get(`/videos/${videoId}/download`);
  const blob = await fetchAsBlob(data.fileUrl || data.downloadUrl);
  saveBlob(blob, data.filename);
  return data;
}

// Exportación limpia del propio vídeo: sin marca de agua ni logo. Es solo para
// el creador; el servidor lo comprueba.
export async function exportVideo(videoId) {
  const { data } = await api.get(`/videos/${videoId}/export`);
  const blob = await fetchAsBlob(data.fileUrl || data.downloadUrl);
  saveBlob(blob, data.filename);
  return data;
}
