import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import PhoneLink from './PhoneLink';
import { LANGUAGES, normalizeLanguage, languageNativeName } from '../lib/translate';
import { normalizeUser } from '../lib/user';
import {
  isIos,
  isStandalone,
  subscribeToPush,
  unsubscribeFromPush,
} from '../services/push';

// Ajustes: lo que en TikTok vive dentro del perfil, no en la barra inferior.
// Cada cosa en su pantalla, en vez de apilar todo en una sola columna.
export default function Settings({ onBack, onNavigate }) {
  const { user, logout, setUser } = useAuth();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [showPhoneLink, setShowPhoneLink] = useState(false);

  // Idioma propio y traducción automática. Se guardan en el perfil y no en el
  // dispositivo: quien usa la app en el móvil y en el ordenador espera el mismo
  // idioma en los dos.
  const [language, setLanguage] = useState(normalizeLanguage(user?.preferredLanguage) || '');
  const [autoTranslate, setAutoTranslate] = useState(Boolean(user?.autoTranslate));
  const [callCaptions, setCallCaptions] = useState(user?.callCaptions !== false);
  const [savingLanguage, setSavingLanguage] = useState(false);

  async function saveLanguage(nextLanguage, nextAuto, nextCaptions = callCaptions) {
    setSavingLanguage(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.patch('/users/me', {
        // Cadena vacía significa "el que tenga el navegador": se manda `null`
        // para no dejar el perfil con un idioma que no es ninguno.
        preferredLanguage: nextLanguage || null,
        autoTranslate: nextAuto,
        callCaptions: nextCaptions,
      });
      // El perfil se actualiza con lo que devolvió el servidor y no con lo que
      // se acaba de enviar: es el servidor quien normaliza el idioma, y si
      // rechaza un valor, la interfaz debe reflejar el que de verdad quedó.
      if (data?.user) {
        const me = normalizeUser(data.user);
        setUser(me);
        localStorage.setItem('taktak_user', JSON.stringify(me));
      }
      setNotice('Preferencias de idioma guardadas');
    } catch (err) {
      setError(err?.message || 'No se pudieron guardar las preferencias');
      // Se revierte lo que se acabó de elegir, para que el selector no muestre
      // un idioma que no se llegó a guardar.
      setLanguage(normalizeLanguage(user?.preferredLanguage) || '');
      setAutoTranslate(Boolean(user?.autoTranslate));
      setCallCaptions(user?.callCaptions !== false);
    } finally {
      setSavingLanguage(false);
    }
  }

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
        <h3>Idioma y traducción</h3>
        <p className="settings-hint">
          WhaTaka traduce los mensajes, las notas de voz y las llamadas a tu idioma. Si no
          eliges ninguno, se usa el del navegador.
        </p>

        <div className="settings-row">
          <span>Mi idioma</span>
          <select
            className="settings-select"
            value={language}
            disabled={savingLanguage || !user}
            onChange={(e) => {
              setLanguage(e.target.value);
              saveLanguage(e.target.value, autoTranslate);
            }}
            aria-label="Mi idioma"
          >
            <option value="">El del navegador</option>
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.nativeName}
                {lang.nativeName !== lang.name ? ` · ${lang.name}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-row">
          <span>Traducir los mensajes automáticamente</span>
          <button
            type="button"
            className={`settings-toggle ${autoTranslate ? 'on' : ''}`}
            onClick={() => {
              const nextValue = !autoTranslate;
              setAutoTranslate(nextValue);
              saveLanguage(language, nextValue);
            }}
            disabled={savingLanguage || !user}
            aria-pressed={autoTranslate}
          >
            {autoTranslate ? 'Activada' : 'Desactivada'}
          </button>
        </div>

        <div className="settings-row">
          <span>Subtítulos en las llamadas</span>
          <button
            type="button"
            className={`settings-toggle ${callCaptions ? 'on' : ''}`}
            onClick={() => {
              const nextValue = !callCaptions;
              setCallCaptions(nextValue);
              saveLanguage(language, autoTranslate, nextValue);
            }}
            disabled={savingLanguage || !user}
            aria-pressed={callCaptions}
          >
            {callCaptions ? 'Activados' : 'Desactivados'}
          </button>
        </div>

        {language && (
          <p className="settings-hint">
            Tus mensajes se traducirán a {languageNativeName(language)} en el chat.
          </p>
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
        <button type="button" className="settings-link" onClick={() => onNavigate('blocked')}>
          <span>🚫 Cuentas bloqueadas</span>
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
