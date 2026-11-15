import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Fuegos artificiales de la casa: un estallido de chispas que sale del punto
// exacto donde se toca (o del centro de la mesa al ganar una mano). Se pintan
// en una capa fija por encima de todo y desaparecen solos.
//
// Todo el movimiento es CSS (ver `premium.css`): aquí solo se decide dónde y
// cuándo estalla. Así se ve fluido incluso en un móvil modesto.

const SPARKS = 20;

let seq = 0;

// Estado de los estallidos vivos. `fire` es estable para poder usarlo dentro de
// un `useEffect` sin volver a suscribirse en cada render.
export function useFireworks() {
  const [bursts, setBursts] = useState([]);
  const timers = useRef(new Set());

  const fire = useCallback((x, y, hue) => {
    const id = (seq += 1);
    setBursts((prev) => [
      ...prev,
      { id, x, y, hue: hue == null ? Math.round(Math.random() * 360) : hue },
    ]);
    const t = setTimeout(() => {
      setBursts((prev) => prev.filter((b) => b.id !== id));
      timers.current.delete(t);
    }, 1400);
    timers.current.add(t);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
      pending.clear();
    };
  }, []);

  return { bursts, fire };
}

// Lanza varios estallidos alrededor de un punto, para celebraciones grandes.
// La lógica vive en `lib/fireworks.js` para poder probarla sin React.
export { celebrate } from '../lib/fireworks';

export default function Fireworks({ bursts }) {
  if (typeof document === 'undefined' || !bursts || bursts.length === 0) return null;
  return createPortal(
    <div className="tak-fw-layer" aria-hidden="true">
      {bursts.map((b) => (
        <span
          key={b.id}
          className="tak-fw"
          style={{ left: `${b.x}px`, top: `${b.y}px`, '--fw-hue': b.hue }}
        >
          <i className="tak-fw-flash" />
          <i className="tak-fw-ring" />
          {Array.from({ length: SPARKS }).map((_, i) => (
            <i
              key={i}
              className="tak-fw-spark"
              style={{
                '--fw-angle': `${(i * 360) / SPARKS + (b.id % 5) * 7}deg`,
                '--fw-dist': `${64 + ((i * 41) % 58)}px`,
                '--fw-delay': `${(i % 5) * 35}ms`,
              }}
            />
          ))}
        </span>
      ))}
    </div>,
    document.body,
  );
}
