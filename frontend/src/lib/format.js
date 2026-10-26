// Formato compacto de contadores, como en TikTok: "1,2 mil", "3,4 M".
//
// Se usa en la rejilla del perfil, donde una cifra larga ("12345") rompería la
// línea de la miniatura. Se redondea a una cifra decimal y se quita el ",0"
// sobrante para que "1200" quede como "1,2 mil" y "2000" como "2 mil".
export function formatCount(value) {
  const n = Number(value) || 0;
  if (n < 1000) return String(n);

  const units = [
    { limit: 1e9, suffix: ' MM' },
    { limit: 1e6, suffix: ' M' },
    { limit: 1e3, suffix: ' mil' },
  ];

  for (const { limit, suffix } of units) {
    if (n >= limit) {
      const scaled = n / limit;
      // Bajo 10 se muestra un decimal (1,2 mil); a partir de ahí, entero (12 mil).
      const text = scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, '') : String(Math.round(scaled));
      return `${text.replace('.', ',')}${suffix}`;
    }
  }

  return String(n);
}
