// Logo de POKERTAK: un trozo de queso con una semilla de mango dorada saliendo
// de dentro, y dos cartas (as de picas y rey de corazones) delante, como una
// mano repartida. Va en SVG para que se vea nítido en cualquier tamaño.
//
// `playing` levanta las cartas y enciende el destello dorado un instante. Lo
// dispara el botón que abre el juego (la pestaña de la barra inferior), no el
// propio logo: así el gesto vive en el botón, que es lo que se toca.
export default function PokerTakLogo({ size = 72, className = '', playing = false }) {
  const svg = (
    <svg
      className={`ptak-logo-svg${playing ? ' playing' : ''}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="POKERTAK: un trozo de queso con una semilla de mango dorada y dos cartas"
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
        <linearGradient id="ptak-card-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e8ecff" />
        </linearGradient>
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

      {/* Las dos cartas de la casa, abanicadas delante del queso: as de picas y
          rey de corazones. `playing` las levanta cuando se abre el juego. */}
      <g className="ptak-logo-cards">
        <g transform="rotate(-16 40 78)">
          <rect x="26" y="56" width="24" height="34" rx="3.5" fill="url(#ptak-card-face)" stroke="#b9c2e6" strokeWidth="1.4" />
          <text x="31" y="69" fontFamily="Outfit, sans-serif" fontWeight="800" fontSize="12" fill="#1a2030">A</text>
          <text x="31" y="80" fontFamily="sans-serif" fontSize="10" fill="#1a2030">♠</text>
        </g>
        <g transform="rotate(14 62 78)">
          <rect x="50" y="56" width="24" height="34" rx="3.5" fill="url(#ptak-card-face)" stroke="#e6b9c2" strokeWidth="1.4" />
          <text x="55" y="69" fontFamily="Outfit, sans-serif" fontWeight="800" fontSize="12" fill="#d81f4a">K</text>
          <text x="55" y="80" fontFamily="sans-serif" fontSize="10" fill="#d81f4a">♥</text>
        </g>
      </g>
    </svg>
  );

  return svg;
}
