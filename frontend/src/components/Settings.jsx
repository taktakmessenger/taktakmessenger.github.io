import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import PhoneLink from './PhoneLink';
import {
  isIos,
  isStandalone,
  subscribeToPush,
  unsubscribeFromPush,
} from '../services/push';

// Ajustes: lo que en TikTok vive dentro del perfil, no en la barra inferior.
// Cada cosa en su pantalla, en vez de apilar todo en una sola columna.
export default function Settings({ onBack, onNavigate }) {
  const { user, logout } = useAuth();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [showPhoneLink, setShowPhoneLink] = useState(false);

  // Estado del permiso de notificaciones. Se lee del navegador, que es quien
  // manda: no se guarda en el perfil porque el permiso es del dispositivo, no
  // de la cuenta.
  const [pushPermission, setPushPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [pushBusy, setPushBusy] = useState(false);

  async function enablePush() {
    setPushBusy(true);
    setError('');
    setNotice('');
    const result = await subscribeToPush();
    if (result.ok) {
      setPushPermission(Notification.permission);
      setNotice('Notificaciones activadas: las llamadas sonarán aunque la app esté cerrada');
    } else {
      const messages = {
        ios_needs_install:
          'En iPhone, añade TAK TAK a la pantalla de inicio (Compartir → Añadir a inicio) para recibir llamadas con la app cerrada',
        unsupported: 'Este navegador no admite notificaciones push',
        denied: 'Permiso denegado. Actívalo en los ajustes del navegador para este sitio',
        unavailable: 'Este servidor aún no tiene configurado el envío de notificaciones',
      };
      // `error` se reutiliza porque es lo que pinta el aviso rojo de la pantalla.
      setError(messages[result.reason] || 'No se pudieron activar las notificaciones');
    }
    setPushBusy(false);
  }

  async function disablePush() {
    setPushBusy(true);
    await unsubscribeFromPush();
    setPushPermission(Notification.permission);
    setNotice('Notificaciones desactivadas en este dispositivo');
    setPushBusy(false);
  }

  async function changePassword(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, password: next });
      setNotice('Contraseña actualizada');
      setCurrent('');
      setNext('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings">
      <div className="screen-head">
        <button type="button" className="btn-ghost" onClick={onBack} aria-label="Volver">
          ←
        </button>
        <h2>Configuración</h2>
      </div>

      <section className="settings-block">
        <h3>Cuenta</h3>
        <div className="settings-row">
          <span>Usuario</span>
          <strong>@{user?.username}</strong>
        </div>
        <div className="settings-row">
          <span>Email</span>
          <strong>{user?.email}</strong>
        </div>
        <div className="settings-row">
          <span>Teléfono</span>
          <strong>{user?.phoneVerified ? user.phone : 'Sin vincular'}</strong>
        </div>
        <div className="settings-row">
          <span>Verificación</span>
          <strong>{user?.profile?.isVerified ? 'Verificada' : 'No verificada'}</strong>
        </div>
        {/* Quien entró con correo o con Google no tiene teléfono. Sin esta
            opción no había forma de añadirlo, y una cuenta sin teléfono no se
            puede llamar por número ni aparece en las coincidencias. */}
        {!user?.phoneVerified && (
          <div className="settings-phone-link">
            {showPhoneLink ? (
              <PhoneLink onDone={() => setShowPhoneLink(false)} onSkip={() => setShowPhoneLink(false)} />
            ) : (
              <button
                type="button"
                className="btn-primary settings-push-btn"
                onClick={() => setShowPhoneLink(true)}
              >
                📱 Vincular teléfono
              </button>
            )}
          </div>
        )}
      </section>

      <section className="settings-block">
        <h3>Llamadas y notificaciones</h3>
        <p className="settings-hint">
          Con las notificaciones activadas, una llamada suena aunque tengas la app cerrada,
          como en WhatsApp. Si no, solo sonará con la app abierta.
        </p>
        {pushPermission === 'granted' ? (
          <div className="settings-row">
            <span>Notificaciones</span>
            <button type="button" className="settings-link" onClick={disablePush} disabled={pushBusy}>
              Desactivar en este dispositivo
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-primary settings-push-btn"
            onClick={enablePush}
            disabled={pushBusy || !user}
          >
            {pushBusy ? 'Activando…' : '🔔 Activar notificaciones'}
          </button>
        )}
        {isIos() && !isStandalone() && pushPermission !== 'granted' && (
          <p className="settings-hint">
            En iPhone los avisos con la app cerrada solo funcionan si añades TAK TAK a la
            pantalla de inicio: toca Compartir y luego "Añadir a inicio".
          </p>
        )}
      </section>

      <section className="settings-block">
        <h3>Dinero y seguridad</h3>
        <button type="button" className="settings-link" onClick={() => onNavigate('wallet')}>
          <span>💰 Monedero TTC</span>
          <span aria-hidden="true">›</span>
        </button>
        <button type="button" className="settings-link" onClick={() => onNavigate('verification')}>
          <span>🛡️ Verificar identidad</span>
          <span aria-hidden="true">›</span>
        </button>
        <button type="button" className="settings-link" onClick={() => onNavigate('health')}>
          <span>🔍 Salud de la cuenta</span>
          <span aria-hidden="true">›</span>
        </button>
        {user?.role === 'admin' && (
          <button type="button" className="settings-link" onClick={() => onNavigate('admin')}>
            <span>🛠️ Panel de administración</span>
            <span aria-hidden="true">›</span>
          </button>
        )}
      </section>

      <section className="settings-block">
        <h3>Cambiar contraseña</h3>
        <form className="settings-form" onSubmit={changePassword}>
          <input
            type="password"
            placeholder="Contraseña actual"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
          <input
            type="password"
            placeholder="Contraseña nueva"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
          <button type="submit" className="btn-primary" disabled={busy || !current || !next}>
            {busy ? 'Guardando…' : 'Actualizar contraseña'}
          </button>
        </form>
      </section>

      {notice && <p className="notice">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button type="button" className="btn-danger settings-logout" onClick={logout}>
        Cerrar sesión
      </button>
    </div>
  );
}
