// Tiempo de llamada en formato de reloj, como el de WhatsApp: "0:07", "1:23"
// o "1:02:03" a partir de la hora. Se aísla aquí, fuera de React y sin reloj
// real, para poder probarlo con valores conocidos y para que la pantalla de
// llamada solo tenga que pintar el resultado.
export function formatCallTimer(totalSeconds) {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n) => String(n).padStart(2, '0');

  if (hours > 0) return `${hours}:${two(minutes)}:${two(seconds)}`;
  return `${minutes}:${two(seconds)}`;
}
