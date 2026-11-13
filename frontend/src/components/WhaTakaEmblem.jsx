import { useId } from 'react';

// Emblema de WhaTaka: un mango púrpura dentro de un disco, con el morado de la
// marca. Se dibuja como SVG y no con el emoji 🥭 a propósito: el emoji cambia
// de forma en cada sistema operativo y aquí es la marca de la sección, así que
// tiene que verse igual en todas partes y poder acompañar al texto sin
// desalinearse. `size` controla el diámetro en píxeles.
//
// Los identificadores de los degradados se derivan de `useId` para que dos
// instancias en la misma pantalla (la cabecera del chat y la barra de la
// llamada) no compartan definición: con el mismo `id`, la segunda heredaría el
// degradado de la primera.
export default function WhaTakaEmblem({ size = 28, title = 'WhaTaka' }) {
  const uid = useId().replace(/:/g, '');
  const bg = `wt-bg-${uid}`;
  const fruit = `wt-fruit-${uid}`;
  const shine = `wt-shine-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label={title}
      focusable="false"
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b04bfb" />
          <stop offset="1" stopColor="#5b2c6f" />
        </linearGradient>
        <linearGradient id={fruit} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6b3ff" />
          <stop offset="0.5" stopColor="#c05cff" />
          <stop offset="1" stopColor="#7b2cbf" />
        </linearGradient>
        <radialGradient id={shine} cx="0.35" cy="0.3" r="0.7">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="24" cy="24" r="23" fill={`url(#${bg})`} />

      {/* Cuerpo del mango: alargado y curvado, con la punta abajo a la
          izquierda, como el emoji 🥭 pero en morado. */}
      <g transform="rotate(-16 24 26)">
        <path
          d="M31 8 C 40 13 44 24 40 33 C 36 42 26 47 17 44 C 12 42 11 37 14 32 C 18 25 25 21 28 15 C 29 12 30 10 31 8 Z"
          fill={`url(#${fruit})`}
          stroke="#4a235a"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <ellipse
          cx="21"
          cy="20"
          rx="2.6"
          ry="4.6"
          transform="rotate(-28 21 20)"
          fill={`url(#${shine})`}
        />
        {/* Rabito del mango. */}
        <path
          d="M31 9 C 32 6 34 4.5 36 4"
          fill="none"
          stroke="#4a235a"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </g>

      {/* Hoja, para que se lea como fruta y no como un óvalo. */}
      <path d="M33 6 C 37 3 42 3 44 6 C 41 9 36 9 33 6 Z" fill="#7be0a0" opacity="0.92" />
    </svg>
  );
}
