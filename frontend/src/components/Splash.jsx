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

          {/* Semilla de mango dorada saliendo del queso. Forma de mango: punta
              arriba (donde iría el tallo), cuerpo redondeado y asimétrico, más
              lleno por el lado derecho. Antes era una elipse y parecía un huevo. */}
          <g transform="rotate(-22 58 34)">
            <path
              d="M57 11 C 66 12 73 19 75 30 C 76 40 72 50 63 55 C 54 58 46 52 44 41 C 42 31 46 18 57 11 Z"
              fill="url(#splash-seed)"
              stroke="#a86e08"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            {/* Brillo del lomo izquierdo. */}
            <path
              d="M50 21 C 55 17 62 19 65 26 C 59 21 53 21 50 24 Z"
              fill="#fffbe0"
              opacity="0.75"
            />
            {/* Sombra del cachete derecho, para dar volumen de mango. */}
            <path
              d="M69 33 C 72 42 68 51 61 54 C 68 48 70 40 69 33 Z"
              fill="#a86e08"
              opacity="0.22"
            />
            {/* Rabito del mango. */}
            <path
              d="M56 11 C 56 8 57 6 59 5"
              fill="none"
              stroke="#8a5a06"
              strokeWidth="2"
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
