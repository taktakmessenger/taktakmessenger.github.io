// Catálogo de repiques de llamada.
//
// Cada tono se describe con datos, no con código: un patrón de pitidos (Web
// Audio) y un patrón de vibración. Así se añade un repique nuevo sin tocar el
// motor de sonido, y la pantalla de Ajustes puede listarlos y previsualizarlos
// todos con la misma pieza.
//
// Se generan con osciladores en vez de con ficheros `.mp3` a propósito: no hay
// que descargar nada, suenan al instante y no dependen de que un fichero esté
// en la ruta correcta. El precio es que son tonos sintéticos, no melodías
// grabadas.

export const DEFAULT_RINGTONE_ID = 'clasico';

// Cada entrada: `pattern` en segundos (offset, frecuencia en Hz, duración),
// `periodMs` es cada cuánto se repite el patrón, y `vibration` el patrón de la
// Vibration API (Android; en iOS y escritorio se ignora).
export const RINGTONES = [
  {
    id: 'clasico',
    name: 'Clásico',
    pattern: [
      { offset: 0, frequency: 660, duration: 0.35 },
      { offset: 0.45, frequency: 880, duration: 0.35 },
    ],
    periodMs: 2000,
    vibration: [400, 200, 400, 200],
  },
  {
    id: 'campana',
    name: 'Campana',
    pattern: [
      { offset: 0, frequency: 880, duration: 0.25 },
      { offset: 0.3, frequency: 1174, duration: 0.25 },
      { offset: 0.6, frequency: 1567, duration: 0.4 },
    ],
    periodMs: 2400,
    vibration: [300, 150, 300, 150, 500],
  },
  {
    id: 'digital',
    name: 'Digital',
    pattern: [
      { offset: 0, frequency: 1200, duration: 0.12 },
      { offset: 0.18, frequency: 1200, duration: 0.12 },
      { offset: 0.36, frequency: 1600, duration: 0.12 },
    ],
    periodMs: 1500,
    vibration: [150, 100, 150, 100, 150],
  },
  {
    id: 'suave',
    name: 'Suave',
    pattern: [
      { offset: 0, frequency: 523, duration: 0.5, gain: 0.06 },
      { offset: 0.6, frequency: 659, duration: 0.6, gain: 0.06 },
    ],
    periodMs: 2800,
    vibration: [500, 400],
  },
  {
    id: 'urgente',
    name: 'Urgente',
    pattern: [
      { offset: 0, frequency: 1000, duration: 0.15 },
      { offset: 0.2, frequency: 1000, duration: 0.15 },
      { offset: 0.4, frequency: 1000, duration: 0.15 },
      { offset: 0.6, frequency: 1000, duration: 0.15 },
    ],
    periodMs: 1400,
    vibration: [200, 80, 200, 80, 200, 80, 200],
  },
];

// Busca un repique por id. Si el id no existe (ajuste viejo, dato corrupto) cae
// al clásico en vez de dejar la llamada en silencio: un repique que no suena es
// peor que un repique distinto.
export function findRingtone(id) {
  return RINGTONES.find((r) => r.id === id) || RINGTONES.find((r) => r.id === DEFAULT_RINGTONE_ID);
}

export function isKnownRingtone(id) {
  return RINGTONES.some((r) => r.id === id);
}
