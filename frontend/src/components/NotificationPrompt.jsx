import { useEffect, useState } from 'react';
import {
  isIos,
  isStandalone,
  pushSupported,
  subscribeToPush,
} from '../services/push';

// Aviso para activar las notificaciones.
//
// Sin esto, llamar a alguien que no tiene la app abierta termina en "no está
// disponible": el dispositivo no está suscrito, así que el servidor no tiene a
// quién despertar. Antes había que entrar a Ajustes y encontrar la opción, y en
// la práctica nadie lo hacía; el resultado era que las llamadas "no sonaban".
//
// Es descartable y se recuerda el descarte por cuenta, como el aviso del
// teléfono: quien no quiera avisos no debe verlo en cada arranque.
export default function NotificationPrompt({ user, onOpenSettings }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user) return;

    // Si el navegador ya concedió el permiso, no hay nada que pedir.
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') return;

    // En iPhone, sin la app añadida a la pantalla de inicio el push no existe:
    // mostrar el aviso solo confundiría. En ese caso lo explica Ajustes.
    if (isIos() && !isStandalone()) return;

    if (!pushSupported()) return;

    const seen = localStorage.getItem(`taktak_push_prompt_${user.id}`);
    if (!seen) setVisible(true);
  }, [user]);

  function dismiss() {
    if (user) localStorage.setItem(`taktak_push_prompt_${user.id}`, '1');
    setDismissed(true);
    setVisible(false);
  }

  async function enable() {
    setBusy(true);
    setNotice('');
    const result = await subscribeToPush();
    setBusy(false);
    if (result.ok) {
      setNotice('Listo: las llamadas sonarán aunque la app esté cerrada');
      setTimeout(dismiss, 1500);
      return;
    }
    if (result.reason === 'denied') {
      setNotice('Permiso denegado. Actívalo en los ajustes del navegador');
      return;
    }
    setNotice('No se pudieron activar. Prueba desde Ajustes');
  }

  if (!visible || dismissed) return null;

  return (
    <div className="notif-prompt" role="dialog" aria-label="Activar notificaciones de llamadas">
      <div className="notif-prompt-body">
        <span className="notif-prompt-icon" aria-hidden="true">🔔</span>
        <div>
          <strong>Activa las notificaciones para recibir llamadas</strong>
          <p>
            Sin ellas, una llamada solo suena con la app abierta. Actívalas y sonará
            aunque tengas TAK TAK cerrado, como WhatsApp.
          </p>
          {notice && <small className="notif-prompt-notice">{notice}</small>}
        </div>
      </div>
      <div className="notif-prompt-actions">
        <button type="button" className="btn-primary" onClick={enable} disabled={busy}>
          {busy ? 'Activando…' : 'Activar'}
        </button>
        <button type="button" className="btn-ghost" onClick={dismiss}>
          Ahora no
        </button>
        {onOpenSettings && (
          <button type="button" className="btn-ghost" onClick={onOpenSettings}>
            Ajustes
          </button>
        )}
      </div>
    </div>
  );
}
