import api from '../api/client.js';

// Descarga un video (propio o ajeno). El servidor autoriza la bajada y devuelve
// el descriptor con el nombre de archivo legible.
//
// El fichero se pide como blob en lugar de apuntar el enlace directo al
// `/uploads/...`: ese endpoint estático envía su propia cabecera
// `Content-Disposition` con el nombre interno del archivo, y el navegador le da
// prioridad sobre el atributo `download`. Con un blob no hay cabecera que
// compita y el archivo se guarda con el nombre que el usuario espera.
//
// Devuelve el descriptor (con `filename`) para que la pantalla pueda avisar de
// qué se descargó.
export async function downloadVideo(videoId) {
  const { data } = await api.get(`/videos/${videoId}/download`);

  // El fichero vive en `/uploads/...`, fuera de `/api`, así que se pide con
  // `fetch` al mismo origen en vez de con el cliente axios (que prefija `/api`).
  const res = await fetch(data.downloadUrl);
  if (!res.ok) throw new Error('No se pudo descargar el archivo del video');
  const blob = await res.blob();

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = data.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // El blob se libera en cuanto el navegador ha tomado el archivo; sin esto la
  // memoria del vídeo queda retenida mientras viva la pestaña.
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  return data;
}
