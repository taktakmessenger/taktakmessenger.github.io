import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import { loadProviders } from '../lib/providers';

// A six-digit code field, the same shape as the one in AuthForm. Duplicated on
// purpose rather than exported from there: AuthForm is one screen's worth of
// flow and importing from it would drag Google's loader and half the sign-up
// state into Settings. It is small and self-contained.
function CodeInput({ value, onChange, disabled }) {
  return (
    <input
      className="code-input"
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      placeholder="——————"
      aria-label="Código de 6 dígitos"
      required
    />
  );
}

function CountrySelect({ countries, value, onChange }) {
  return (
    <select value={value} onChange={onChange} aria-label="País" className="country-select">
      {countries.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name} ({c.dialCode})
        </option>
      ))}
    </select>
  );
}

/**
 * Vincular un número de teléfono a una cuenta que ya existe.
 *
 * Sirve para quien se registró por correo (o con Google): hasta ahora no había
 * forma de añadir el teléfono desde la app, y sin teléfono la cuenta no se puede
 * llamar por número ni aparece en las coincidencias de contactos.
 *
 * Es el mismo flujo en dos pasos del registro por teléfono (pedir código,
 * verificar), pero autenticado: el número se adjunta a la cuenta de la sesión.
 */
export default function PhoneLink({ onDone, onSkip, skipLabel = 'Ahora no', autoFocusTitle }) {
  const { startPhoneLink, verifyPhoneLink } = useAuth();

  const [step, setStep] = useState('phone'); // 'phone' | 'code'
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('MX');
  const [countries, setCountries] = useState([]);
  const [code, setCode] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // El código solo lo devuelve la API cuando el SMS no pudo salir (sin
  // proveedor, desarrollo). Se muestra para que el flujo sea usable.
  const [devCode, setDevCode] = useState('');

  // La lista de países viene de la misma fuente que el registro, para que el
  // selector cubra el mundo entero y no una tabla mantenida a mano. Con
  // reintentos: si el backend aún arranca, un solo intento dejaba el selector
  // vacío hasta recargar.
  useEffect(() => {
    let cancelled = false;
    loadProviders(() => api.get('/auth/providers', { params: { locale: 'es' } }), {
      shouldAbort: () => cancelled,
    })
      .then((data) => {
        if (!cancelled && data) setCountries(data.countries || []);
      })
      .catch(() => {
        if (!cancelled) setCountries([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Arranca el selector en el país del navegador cuando se puede deducir.
  useEffect(() => {
    if (!countries.length) return;
    const guess = navigator.language?.split('-')[1]?.toUpperCase();
    if (guess && countries.some((c) => c.code === guess)) setCountry(guess);
  }, [countries]);

  async function run(action) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const handleStart = (e) => {
    e.preventDefault();
    run(async () => {
      setNotice('');
      setDevCode('');
      const data = await startPhoneLink({ phone, country });

      if (data.alreadyLinked) {
        setNotice('Ese número ya está vinculado a tu cuenta');
        onDone?.();
        return;
      }

      setMaskedPhone(data.phone);
      setStep('code');
      if (data.delivered === false) {
        setNotice(
          'El envío de SMS no está configurado en este servidor. Usa el código que aparece abajo.'
        );
        if (data.code) setDevCode(data.code);
      }
    });
  };

  const handleVerify = (e) => {
    e.preventDefault();
    run(async () => {
      await verifyPhoneLink({ phone, country, code });
      setNotice('Teléfono vinculado. Ya pueden llamarte a este número desde el marcador.');
      onDone?.();
    });
  };

  return (
    <div className="phone-link">
      {autoFocusTitle && <h3 className="phone-link-title">{autoFocusTitle}</h3>}

      {step === 'phone' && (
        <form className="settings-form" onSubmit={handleStart}>
          <p className="settings-hint">
            Añade tu número para que puedan encontrarte y llamarte desde el marcador de
            TAK TAK. Te enviaremos un SMS con un código para confirmarlo.
          </p>
          <CountrySelect
            countries={countries}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          />
          <input
            type="tel"
            placeholder="Número de teléfono"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            required
          />
          {notice && <p className="notice" role="status">{notice}</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy || !phone}>
            {busy ? 'Enviando…' : 'Enviar código'}
          </button>
          {onSkip && (
            <button type="button" className="btn-link" onClick={onSkip}>
              {skipLabel}
            </button>
          )}
        </form>
      )}

      {step === 'code' && (
        <form className="settings-form" onSubmit={handleVerify}>
          <p className="hint">Enviamos un código a {maskedPhone || 'tu teléfono'}.</p>
          {notice && <p className="notice" role="status">{notice}</p>}
          {devCode && (
            <div className="dev-code" role="status">
              <span className="dev-code-label">
                Sin proveedor de envío (solo desarrollo). Tu código:
              </span>
              <button type="button" className="dev-code-value" onClick={() => setCode(devCode)}>
                {devCode}
              </button>
            </div>
          )}
          <CodeInput value={code} onChange={setCode} disabled={busy} />
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy || code.length !== 6}>
            {busy ? 'Verificando…' : 'Verificar y vincular'}
          </button>
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              setStep('phone');
              setCode('');
              setNotice('');
              setDevCode('');
            }}
          >
            Usar otro número
          </button>
        </form>
      )}
    </div>
  );
}
