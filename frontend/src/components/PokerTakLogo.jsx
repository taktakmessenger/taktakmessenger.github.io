// Logo de POKERTAK: un trozo de queso con una semilla de mango dorada saliendo
// de dentro. Va en SVG para que se vea nítido en cualquier tamaño y para que la
// semilla pueda asomar por un corte del queso (por eso se dibuja después del
// queso y se recorta con el contorno del corte).
export default function PokerTakLogo({ size = 72, className = '' }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="POKERTAK: un trozo de queso con una semilla de mango dorada"
    >
      <defs>
        <linearGradient id="ptak-cheese" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd94a" />
          <stop offset="1" stopColor="#f0a91b" />
        </linearGradient>
        <linearGradient id="ptak-seed" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe98a" />
          <stop offset="0.45" stopColor="#f7c531" />
          <stop offset="1" stopColor="#c8860a" />
        </linearGradient>
        <radialGradient id="ptak-seed-shine" cx="0.35" cy="0.3" r="0.7">
          <stop offset="0" stopColor="#fffbe0" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fffbe0" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Trozo de queso: cuña con la punta arriba a la izquierda. */}
      <path
        d="M18 74 L20 40 L74 26 L84 60 Q84 74 70 76 Z"
        fill="url(#ptak-cheese)"
        stroke="#b9790a"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Agujeros del queso. */}
      <circle cx="34" cy="60" r="6" fill="#e0980f" opacity="0.75" />
      <circle cx="52" cy="66" r="4.5" fill="#e0980f" opacity="0.7" />
      <circle cx="64" cy="48" r="5" fill="#e0980f" opacity="0.7" />
      <circle cx="30" cy="46" r="3.5" fill="#e0980f" opacity="0.6" />

      {/* Corte por el que asoma la semilla. */}
      <path d="M40 52 Q52 40 66 34 L70 44 Q56 50 48 60 Z" fill="#8a5a06" opacity="0.35" />

      {/* Semilla de mango dorada saliendo del queso. */}
      <g transform="rotate(-22 58 34)">
        <ellipse cx="58" cy="32" rx="15" ry="20" fill="url(#ptak-seed)" stroke="#a86e08" strokeWidth="2.5" />
        <ellipse cx="52" cy="24" rx="6" ry="8" fill="url(#ptak-seed-shine)" />
      </g>

      {/* Brillo dorado alrededor de la semilla. */}
      <path d="M76 20 l2.4 5.6 5.6 2.4 -5.6 2.4 -2.4 5.6 -2.4 -5.6 -5.6 -2.4 5.6 -2.4 z" fill="#ffe98a" />
      <path d="M30 18 l1.6 3.6 3.6 1.6 -3.6 1.6 -1.6 3.6 -1.6 -3.6 -3.6 -1.6 3.6 -1.6 z" fill="#ffe98a" opacity="0.9" />
    </svg>
  );
}
