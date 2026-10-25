import { useEffect, useState } from 'react';
import { useSocket } from '../contexts/SocketContext';

// Aviso de "señal". Cuando la conexión en vivo se cae, la app antes se quedaba
// muda: los mensajes dejaban de llegar y las llamadas no entraban sin que nada
// lo dijera. Aquí se anuncia en pantalla, y como el socket reintenta y renueva
// el token solo, el aviso se retira en cuanto vuelve.
//
// Se retrasa un momento antes de aparecer: un corte de un par de segundos (un
// cambio de red, el móvil despertando) es normal y avisar por él sería ruido.
const GRACE_MS = 3000;

export default function ConnectionBanner() {
  const { connected } = useSocket();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (connected) {
      setVisible(false);
      return undefined;
    }
    const timer = setTimeout(() => setVisible(true), GRACE_MS);
    return () => clearTimeout(timer);
  }, [connected]);

  if (!visible) return null;

  return (
    <div className="connection-banner" role="status" aria-live="polite">
      <span className="connection-dot" aria-hidden="true" />
      Sin conexión. Reconectando…
    </div>
  );
}
