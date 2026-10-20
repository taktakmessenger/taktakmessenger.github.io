import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';

// Loads Google Identity Services once, on demand. Doing it lazily keeps a
// third-party script off the page for deployments that have no Google client
// id configured, and avoids blocking the initial render.
let gsiPromise = null;
function loadGoogleScript() {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('No se pudo cargar Google'));
    document.head.appendChild(script);
  });
  return gsiPromise;
}

function GoogleButton({ clientId, onCredential }) {
  const holder = useRef(null);

  useEffect(() => {
    if (!clientId || !holder.current) return undefined;
    let cancelled = false;

    loadGoogleScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id || !holder.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => onCredential(response.credential),
        });
        window.google.accounts.id.renderButton(holder.current, {
          theme: 'outline',
          size: 'large',
          width: 280,
          text: 'continue_with',
          locale: 'es',
        });
      })
      .catch(() => {
        // The email and phone tabs still work, so a blocked Google script is
        // not worth surfacing as an error.
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, onCredential]);

  if (!clientId) return null;
  return <div className="google-button" ref={holder} />;
}

// A six-digit code field.
//
// A single visible input, not six separate ones and not a hidden input behind
// decorative boxes. Both alternatives break something that matters:
//
//  - six inputs break paste, password managers and SMS autofill, which fill the
//    field in one go;
//  - an `opacity: 0` input behind boxes is dropped from the accessibility tree
//    by Chrome, so screen readers and automation cannot reach it at all.
//
// Wide letter-spacing on one real input gives the boxed look while keeping the
// field fully usable.
function CodeInput({ value, onChange, disabled }) {
  return (
    <input
      className="code-input"
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      // `pattern` keeps mobile keyboards numeric without blocking paste.
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

// Shown only when the API returned the code because no provider could deliver
// the message (development). Tapping it fills the field, so the user does not
// have to transcribe six digits from the screen.
function DevCodeBox({ code, onUse }) {
  if (!code) return null;
  return (
    <div className="dev-code" role="status">
      <span className="dev-code-label">
        Sin proveedor de envío (solo desarrollo). Tu código:
      </span>
      <button type="button" className="dev-code-value" onClick={() => onUse(code)}>
        {code}
      </button>
    </div>
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

export default function AuthForm({ onDone }) {
  const {
    login,
    register,
    loginWithGoogle,
    startPhoneSignup,
    verifyPhoneSignup,
    forgotPassword,
    resetPassword,
  } = useAuth();

  // view: 'login' | 'register' | 'phone' | 'forgot' | 'reset'
  const [view, setView] = useState('login');
  const [tab, setTab] = useState('email'); // login/register: email or phone

  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [identifier, setIdentifier] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('MX');
  const [countries, setCountries] = useState([]);
  const [providers, setProviders] = useState({ google: false, googleClientId: null, sms: false });
  const [code, setCode] = useState('');

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [maskedPhone, setMaskedPhone] = useState('');
  // The code is only returned by the API when the message could not be sent
  // (no SMTP/SMS provider, development). Shown on screen so the flow is
  // usable; in production the field is always absent.
  const [devCode, setDevCode] = useState('');

  // Which optional providers this deployment actually has, so buttons that
  // would only fail are hidden.
  useEffect(() => {
    api
      // The UI is Spanish-only, so the country names are requested in Spanish
      // rather than in the browser's language: a Spanish screen listing
      // "Germany" and "United States" is worse than useless.
      .get('/auth/providers', { params: { locale: 'es' } })
      .then(({ data }) => {
        setCountries(data.countries || []);
        setProviders(data);
      })
      .catch(() => setCountries([]));
  }, []);

  // Default the picker to the browser's locale when we can infer it, instead
  // of always starting on Mexico.
  useEffect(() => {
    if (!countries.length) return;
    const guess = navigator.language?.split('-')[1]?.toUpperCase();
    if (guess && countries.some((c) => c.code === guess)) setCountry(guess);
  }, [countries]);

  const reset = useCallback((next) => {
    setError('');
    setNotice('');
    setCode('');
    setDevCode('');
    setBusy(false);
    setView(next);
  }, []);

  // Switching provider keeps the current view. Calling reset() here would drag
  // a user who is registering back to the login view, leaving the register
  // form's phone tab blank.
  const switchTab = useCallback((next) => {
    setError('');
    setNotice('');
    setCode('');
    setDevCode('');
    setBusy(false);
    setTab(next);
  }, []);

  function update(field) {
    return (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

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

  const handleEmailLogin = (e) => {
    e.preventDefault();
    run(async () => {
      await login(identifier, form.password);
      onDone?.();
    });
  };

  const handleRegister = (e) => {
    e.preventDefault();
    run(async () => {
      const data = await register(form.username, form.email, form.password);

      // The account is created and the session is live, but the verification
      // mail could not be sent (no SMTP). Staying on screen is what lets the
      // user read the code; navigating away would hide it forever.
      if (data?.verificationSent === false && data.verificationCode) {
        setNotice('Cuenta creada. El envío de correo no está configurado en este servidor.');
        setDevCode(data.verificationCode);
        return;
      }

      onDone?.();
    });
  };

  const handlePhoneStart = (e) => {
    e.preventDefault();
    run(async () => {
      // A stale "ya tiene cuenta" notice from a previous attempt would sit next
      // to a fresh result and contradict it.
      setNotice('');
      setDevCode('');
      // In the register view the user picks their own name and password; in the
      // login view the backend reuses the existing account, so both are omitted.
      const data = await startPhoneSignup({
        phone,
        country,
        username: view === 'register' ? form.username : undefined,
        password: view === 'register' ? form.password : undefined,
      });

      // The number already has a verified account, so no code was sent: the
      // backend short-circuits to a sign-in. Asking for a code here would leave
      // the user staring at an empty box forever.
      if (data.existingAccount) {
        setNotice(
          'Ese número ya tiene cuenta. Ve a "Iniciar sesión" y entra con tu teléfono y contraseña.'
        );
        return;
      }

      setMaskedPhone(data.phone);
      setView('phone-code');
      // A deployment without an SMS provider must say so, instead of showing a
      // "check your phone" screen for a message that will never arrive.
      if (data.delivered === false) {
        setNotice(
          'El envío de SMS no está configurado en este servidor. Usa el código que aparece abajo.'
        );
        if (data.code) setDevCode(data.code);
      }
    });
  };

  const handlePhoneVerify = (e) => {
    e.preventDefault();
    run(async () => {
      await verifyPhoneSignup({ phone, country, code });
      onDone?.();
    });
  };

  const handleForgot = (e) => {
    e.preventDefault();
    run(async () => {
      const data = await forgotPassword(form.email);
      setView('reset');
      if (data?.delivered === false) {
        setNotice('El envío de correo no está configurado. Usa el código que aparece abajo.');
        if (data.code) setDevCode(data.code);
      } else {
        setNotice('Si el correo está registrado, recibirás un código de 6 dígitos.');
      }
    });
  };

  const handleReset = (e) => {
    e.preventDefault();
    run(async () => {
      await resetPassword({ email: form.email, code, password: form.password });
      onDone?.();
    });
  };

  const handleGoogle = useCallback(
    (credential) => {
      run(async () => {
        await loginWithGoogle(credential);
        onDone?.();
      });
    },
    [loginWithGoogle, onDone]
  );

  const showGoogle = providers.google && providers.googleClientId;

  return (
    <div className="auth-card">
      <h2>
        {view === 'login' && 'Iniciar sesión'}
        {view === 'register' && 'Crear cuenta'}
        {view === 'phone-code' && 'Verifica tu teléfono'}
        {view === 'forgot' && 'Recuperar contraseña'}
        {view === 'reset' && 'Nueva contraseña'}
      </h2>

      {(view === 'login' || view === 'register') && (
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'email'}
            className={tab === 'email' ? 'active' : ''}
            onClick={() => switchTab('email')}
          >
            Correo
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'phone'}
            className={tab === 'phone' ? 'active' : ''}
            onClick={() => switchTab('phone')}
          >
            Teléfono
          </button>
        </div>
      )}

      {/* ---------------- Email ---------------- */}
      {view === 'login' && tab === 'email' && (
        <form onSubmit={handleEmailLogin}>
          <input
            type="text"
            placeholder="Correo o teléfono"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            required
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={form.password}
            onChange={update('password')}
            autoComplete="current-password"
            required
          />
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Procesando…' : 'Entrar'}
          </button>
          <button type="button" className="btn-link" onClick={() => reset('forgot')}>
            ¿Olvidaste tu contraseña?
          </button>
        </form>
      )}

      {view === 'register' && tab === 'email' && (
        <form onSubmit={handleRegister}>
          <input
            type="text"
            placeholder="Nombre de usuario"
            value={form.username}
            onChange={update('username')}
            required
            minLength={3}
          />
          <input
            type="email"
            placeholder="Correo"
            value={form.email}
            onChange={update('email')}
            autoComplete="email"
            required
          />
          <input
            type="password"
            placeholder="Contraseña (mínimo 6 caracteres)"
            value={form.password}
            onChange={update('password')}
            autoComplete="new-password"
            required
            minLength={6}
          />
          {notice && <p className="notice" role="status">{notice}</p>}
          <DevCodeBox code={devCode} onUse={setCode} />
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Procesando…' : 'Registrarme'}
          </button>
        </form>
      )}

      {/* ---------------- Phone ---------------- */}
      {(view === 'login' || view === 'register') && tab === 'phone' && (
        <form onSubmit={handlePhoneStart}>
          {view === 'register' && (
            <>
              <input
                type="text"
                placeholder="Nombre de usuario"
                value={form.username}
                onChange={update('username')}
                required
                minLength={3}
              />
              <input
                type="password"
                placeholder="Contraseña (mínimo 6 caracteres)"
                value={form.password}
                onChange={update('password')}
                autoComplete="new-password"
                required
              />
            </>
          )}
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
          <p className="hint">
            Te enviaremos un SMS con un código de 6 dígitos para verificar el número.
            Si ya tienes cuenta con ese teléfono, entra desde la pestaña de inicio de
            sesión con tu teléfono y contraseña. Funciona con números de cualquier país.
          </p>
          {notice && <p className="notice" role="status">{notice}</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar código'}
          </button>
        </form>
      )}

      {view === 'phone-code' && (
        <form onSubmit={handlePhoneVerify}>
          <p className="hint">Enviamos un código a {maskedPhone || 'tu teléfono'}.</p>
          {notice && <p className="notice" role="status">{notice}</p>}
          <DevCodeBox code={devCode} onUse={setCode} />
          <CodeInput value={code} onChange={setCode} disabled={busy} />
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy || code.length !== 6}>
            {busy ? 'Verificando…' : 'Verificar y entrar'}
          </button>
          <button type="button" className="btn-link" onClick={() => reset('login')}>
            Usar otro número
          </button>
        </form>
      )}

      {/* ---------------- Password recovery ---------------- */}
      {view === 'forgot' && (
        <form onSubmit={handleForgot}>
          <input
            type="email"
            placeholder="Tu correo"
            value={form.email}
            onChange={update('email')}
            autoComplete="email"
            required
          />
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar código'}
          </button>
          <button type="button" className="btn-link" onClick={() => reset('login')}>
            Volver
          </button>
        </form>
      )}

      {view === 'reset' && (
        <form onSubmit={handleReset}>
          {notice && <p className="notice" role="status">{notice}</p>}
          <DevCodeBox code={devCode} onUse={setCode} />
          <CodeInput value={code} onChange={setCode} disabled={busy} />
          <input
            type="password"
            placeholder="Nueva contraseña"
            value={form.password}
            onChange={update('password')}
            autoComplete="new-password"
            required
            minLength={6}
          />
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy || code.length !== 6}>
            {busy ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </form>
      )}

      {/* ---------------- Google ---------------- */}
      {showGoogle && (view === 'login' || view === 'register') && (
        <>
          <div className="auth-divider"><span>o</span></div>
          <GoogleButton clientId={providers.googleClientId} onCredential={handleGoogle} />
        </>
      )}

      {(view === 'login' || view === 'register') && (
        <button
          type="button"
          className="btn-link"
          onClick={() => {
            reset(view === 'login' ? 'register' : 'login');
            setTab('email');
          }}
        >
          {view === 'login'
            ? '¿No tienes cuenta? Regístrate'
            : '¿Ya tienes cuenta? Inicia sesión'}
        </button>
      )}
    </div>
  );
}
