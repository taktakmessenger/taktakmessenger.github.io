import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';

// Ajustes: lo que en TikTok vive dentro del perfil, no en la barra inferior.
// Cada cosa en su pantalla, en vez de apilar todo en una sola columna.
export default function Settings({ onBack, onNavigate }) {
  const { user, logout } = useAuth();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

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
          <span>Verificación</span>
          <strong>{user?.profile?.isVerified ? 'Verificada' : 'No verificada'}</strong>
        </div>
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
