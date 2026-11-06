import { useEffect } from 'react';

// Pantalla de bienvenida de TAK TAK. Es lo primero que se ve al abrir la app:
// presenta la marca (el queso con la semilla de mango dorada) y tapa el hueco
// mientras AuthContext comprueba si la sesión guardada sigue siendo válida.
//
// Quien manda en el tiempo es App: aquí solo se pinta y se aplica el fundido
// cuando `fading` llega en true, para que no se vaya antes de que la sesión
// esté lista. El mismo dibujo existe también en el HTML (ver index.html), que
// se ve al instante y evita el destello blanco del primer pintado; aquí se
// retira ese duplicado en cuanto React monta.
export default function Splash({ fading = false }) {
  useEffect(() => {
    document.getElementById('boot-splash')?.remove();
  }, []);

  return (
    <div className={`splash ${fading ? 'splash--hidden' : ''}`} aria-hidden={fading}>
      <div className="splash-glow" />

      <div className="splash-logo">
        <svg
          viewBox="0 0 100 100"
          width="132"
          height="132"
          role="img"
          aria-label="TAK TAK: un trozo de queso con una semilla de mango dorada"
        >
          <defs>
            <linearGradient id="splash-cheese" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffd94a" />
              <stop offset="1" stopColor="#f0a91b" />
            </linearGradient>
            <linearGradient id="splash-seed" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffe98a" />
              <stop offset="0.45" stopColor="#f7c531" />
              <stop offset="1" stopColor="#c8860a" />
            </linearGradient>
            <radialGradient id="splash-seed-shine" cx="0.35" cy="0.3" r="0.7">
              <stop offset="0" stopColor="#fffbe0" stopOpacity="0.95" />
              <stop offset="1" stopColor="#fffbe0" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Trozo de queso: cuña con la punta arriba a la izquierda. */}
          <path
            d="M18 74 L20 40 L74 26 L84 60 Q84 74 70 76 Z"
            fill="url(#splash-cheese)"
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

          {/* Semilla de mango dorada saliendo del queso. Forma de mango:
              alargada y curvada, con la punta abajo a la izquierda, como el
              emoji 🥭. Antes era una elipse y parecía un huevo. */}
          <g transform="rotate(-22 58 34) translate(58 34) scale(0.66) translate(-58 -34)">
            <path
              d="M66 8 C 80 14 87 31 81 48 C 75 65 57 75 39 71 C 31 69 28 61 33 52 C 40 40 52 34 57 22 C 60 15 62 11 66 8 Z"
              fill="url(#splash-seed)"
              stroke="#a86e08"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            {/* Brillo del lomo izquierdo. */}
            <ellipse
              cx="52"
              cy="27"
              rx="5"
              ry="9"
              transform="rotate(-28 52 27)"
              fill="url(#splash-seed-shine)"
            />
            {/* Rabito del mango. */}
            <path
              d="M66 9 C 67 5 70 3 73 2"
              fill="none"
              stroke="#8a5a06"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </g>

          {/* Brillo dorado alrededor de la semilla. */}
          <path d="M76 20 l2.4 5.6 5.6 2.4 -5.6 2.4 -2.4 5.6 -2.4 -5.6 -5.6 -2.4 5.6 -2.4 z" fill="#ffe98a" />
          <path d="M30 18 l1.6 3.6 3.6 1.6 -3.6 1.6 -1.6 3.6 -1.6 -3.6 -3.6 -1.6 3.6 -1.6 z" fill="#ffe98a" opacity="0.9" />
        </svg>
      </div>

      <h1 className="splash-word">TAK TAK</h1>
      <p className="splash-tagline">Somos la PEPA DEL QUESO</p>

      <div className="splash-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
