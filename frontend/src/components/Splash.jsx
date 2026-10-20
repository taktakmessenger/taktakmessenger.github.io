import { useEffect, useState } from 'react';

// Pantalla de bienvenida de TAK TAK. Es lo primero que se ve al abrir la app,
// así que cumple dos funciones: presentar la marca y tapar el hueco mientras
// AuthContext comprueba si la sesión guardada sigue siendo válida.
//
// El temporizador es un mínimo, no una espera fija: si la sesión tarda más, el
// splash se queda; si ya está lista, desaparece en cuanto se cumple el mínimo.
export default function Splash({ minDuration = 1100 }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setHidden(true), minDuration);
    return () => clearTimeout(timer);
  }, [minDuration]);

  return (
    <div className={`splash ${hidden ? 'splash--hidden' : ''}`} aria-hidden={hidden}>
      <div className="splash-glow" />

      <div className="splash-logo">
        <svg viewBox="0 0 64 64" width="92" height="92" role="img" aria-label="TAK TAK">
          <defs>
            <linearGradient id="splash-mark" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ff2d8d" />
              <stop offset="55%" stopColor="#b04bfb" />
              <stop offset="100%" stopColor="#00f7d4" />
            </linearGradient>
          </defs>
          <g fill="url(#splash-mark)">
            <rect x="12" y="19" width="18" height="4.6" rx="2.3" />
            <rect x="18.7" y="19" width="4.6" height="26" rx="2.3" />
            <rect x="34" y="19" width="18" height="4.6" rx="2.3" />
            <rect x="40.7" y="19" width="4.6" height="26" rx="2.3" />
          </g>
        </svg>
      </div>

      <h1 className="splash-word">TAK TAK</h1>
      <p className="splash-tagline">Crea, regala, gana</p>

      <div className="splash-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
