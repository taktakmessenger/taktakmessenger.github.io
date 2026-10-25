import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import { loadProviders } from '../lib/providers';
import { validateRegistration, validatePhoneRegistration, resendLabel, MIN_PASSWORD_LENGTH } from '../lib/authForm';

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

// Campo de contraseña con botón para mostrar u ocultar.
//
// Escribir una contraseña a ciegas en el teclado de un móvil es de donde salen
// la mayoría de los registros fallidos, así que el botón forma parte del campo
// y no es un añadido. `aria-pressed` informa del estado al lector de pantalla y
// `type="button"` evita que envíe el formulario.
function PasswordField({ value, onChange, placeholder, autoComplete, disabled, name }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-field">
      <input
        type={visible ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-label={placeholder}
        name={name}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        {visible ? '🙈' : '👁️'}
      </button>
    </div>
  );
}

// El símbolo de la marca, el mismo dibujo que el splash y el favicon. El id del
// degradado es propio para que no choque con el del splash si coinciden.
function BrandMark({ size = 64 }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="TAK TAK">
      <defs>
        <linearGradient id="auth-brand-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff2d8d" />
          <stop offset="55%" stopColor="#b04bfb" />
          <stop offset="100%" stopColor="#00f7d4" />
        </linearGradient>
      </defs>
      <g fill="url(#auth-brand-mark)">
        <rect x="12" y="19" width="18" height="4.6" rx="2.3" />
        <rect x="18.7" y="19" width="4.6" height="26" rx="2.3" />
        <rect x="34" y="19" width="18" height="4.6" rx="2.3" />
        <rect x="40.7" y="19" width="4.6" height="26" rx="2.3" />
      </g>
    </svg>
  );
}

// Cuánto hay que esperar antes de poder pedir otro código. El servidor también
// limita los envíos; esto evita que el usuario pulse diez veces seguidas y se
// coma el límite sin entender por qué.
const RESEND_SECONDS = 30;

// Casilla de términos. Los enlaces son botones y no `<a href="#">`: un enlace
// vacío no lleva a ninguna parte y es justo lo que hay que evitar.
//
// Sin `required`: el navegador mostraría su propio aviso, en el idioma del
// navegador y con otro estilo, y dejaría sin usar el mensaje en español de
// validateRegistration. La casilla se comprueba ahí, como el resto del alta.
function TermsCheck({ accepted, onChange, onOpen }) {
  return (
    <label className="terms-check">
      <input
        type="checkbox"
        checked={accepted}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        Acepto los{' '}
        <button type="button" className="btn-link inline" onClick={() => onOpen('terms')}>
          términos
        </button>{' '}
        y la{' '}
        <button type="button" className="btn-link inline" onClick={() => onOpen('privacy')}>
          política de privacidad
        </button>
        .
      </span>
    </label>
  );
}

export default function AuthForm({ onDone, onGuest, initialView = 'welcome' }) {
  const {
    login,
    register,
    verifyEmail,
    resendVerification,
    loginWithGoogle,
    startPhoneSignup,
    verifyPhoneSignup,
    forgotPassword,
    resetPassword,
  } = useAuth();

  // view: 'welcome' | 'login' | 'register' | 'phone-code' | 'forgot' | 'reset'
  //     | 'verify-email' | 'terms' | 'privacy'
  const [view, setView] = useState(initialView);
  const [tab, setTab] = useState('email'); // login/register: email or phone

  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [identifier, setIdentifier] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('MX');
  const [countries, setCountries] = useState([]);
  const [providers, setProviders] = useState({ google: false, googleClientId: null, sms: false });
  const [code, setCode] = useState('');
  const [accepted, setAccepted] = useState(false);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [maskedPhone, setMaskedPhone] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  // Los datos de un alta por teléfono se guardan al pedir el código: al
  // reenviar desde la pantalla del código ya no se sabe si era alta o entrada.
  const [phoneSignup, setPhoneSignup] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  // The code is only returned by the API when the message could not be sent
  // (no SMTP/SMS provider, development). Shown on screen so the flow is
  // usable; in production the field is always absent.
  const [devCode, setDevCode] = useState('');

  // Which optional providers this deployment actually has, so buttons that
  // would only fail are hidden. Con reintentos: es la primera llamada de la
  // sesión y, tras un reinicio, el backend puede tardar en responder.
  useEffect(() => {
    let cancelled = false;
    loadProviders(
      // The UI is Spanish-only, so the country names are requested in Spanish
      // rather than in the browser's language: a Spanish screen listing
      // "Germany" and "United States" is worse than useless.
      () => api.get('/auth/providers', { params: { locale: 'es' } }),
      { shouldAbort: () => cancelled }
    )
      .then((data) => {
        if (cancelled || !data) return;
        setCountries(data.countries || []);
        setProviders(data);
      })
      .catch(() => {
        if (!cancelled) setCountries([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Default the picker to the browser's locale when we can infer it, instead
  // of always starting on Mexico.
  useEffect(() => {
    if (!countries.length) return;
    const guess = navigator.language?.split('-')[1]?.toUpperCase();
    if (guess && countries.some((c) => c.code === guess)) setCountry(guess);
  }, [countries]);

  // Cuenta atrás del reenvío. Un temporizador que se limpia al desmontar, no un
  // `setInterval` que siga vivo cuando el formulario ya no está en pantalla.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

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
    if (!identifier.trim()) {
      setError('Escribe tu correo o tu teléfono');
      return;
    }
    if (!form.password) {
      setError('Escribe tu contraseña');
      return;
    }
    run(async () => {
      await login(identifier, form.password);
      onDone?.();
    });
  };

  const handleRegister = (e) => {
    e.preventDefault();

    // Las reglas viven en lib/authForm.js para poder probarlas sin montar el
    // componente. La confirmación de contraseña y los términos no viajan a la
    // API: si no se comprueban aquí, no se comprueban en ningún sitio.
    const problem = validateRegistration({
      username: form.username,
      email: form.email,
      password: form.password,
      confirm: form.confirm,
      accepted,
    });
    if (problem) {
      setError(problem);
      return;
    }

    run(async () => {
      const data = await register(form.username, form.email, form.password);

      setPendingEmail(form.email);
      setCooldown(RESEND_SECONDS);

      // The account is created and the session is live, but the verification
      // mail could not be sent (no SMTP). Staying on the code screen is what
      // lets the user read it; navigating away would hide it forever.
      if (data?.verificationSent === false && data.verificationCode) {
        setNotice('Cuenta creada. El envío de correo no está configurado en este servidor.');
        setDevCode(data.verificationCode);
      } else {
        setNotice('Cuenta creada. Te enviamos un código a tu correo para verificarla.');
      }

      setView('verify-email');
    });
  };

  const handleVerifyEmail = (e) => {
    e.preventDefault();
    run(async () => {
      await verifyEmail({ email: pendingEmail, code });
      onDone?.();
    });
  };

  const handleResendEmail = () =>
    run(async () => {
      const data = await resendVerification(pendingEmail);
      setCooldown(RESEND_SECONDS);
      setCode('');
      if (data?.delivered === false) {
        setNotice('El envío de correo no está configurado en este servidor.');
        if (data.code) setDevCode(data.code);
      } else {
        setNotice('Te enviamos otro código. Puede tardar un minuto en llegar.');
      }
    });

  const handlePhoneStart = (e) => {
    e.preventDefault();

    // El alta por teléfono pide los mismos datos que la de correo (sin correo),
    // así que se valida igual antes de gastar un SMS.
    if (view === 'register') {
      const problem = validatePhoneRegistration({
        username: form.username,
        password: form.password,
        confirm: form.confirm,
        accepted,
      });
      if (problem) {
        setError(problem);
        return;
      }
    }
    if (!phone.trim()) {
      setError('Escribe tu número de teléfono');
      return;
    }
    // En la entrada el teléfono va con contraseña: es lo que permite resolver
    // la cuenta sin depender de un SMS.
    if (view === 'login' && !form.password) {
      setError('Escribe tu contraseña');
      return;
    }

    run(async () => {
      // A stale "ya tiene cuenta" notice from a previous attempt would sit next
      // to a fresh result and contradict it.
      setNotice('');
      setDevCode('');

      // Entrar con teléfono NO puede pasar por el alta. A una cuenta ya
      // existente el alta le responde "ya tiene cuenta" sin mandar código, así
      // que el usuario pulsaba "Enviar código" una y otra vez sin llegar nunca
      // a un sitio donde escribir el código: un bucle sin salida. La entrada
      // se resuelve con teléfono y contraseña, que es lo que sí inicia sesión.
      if (view === 'login') {
        await login(phone, form.password, country);
        onDone?.();
        return;
      }

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
        // Se cambia a la entrada con el número ya puesto: decir "ve a Iniciar
        // sesión" obligaba a rehacer el camino a mano, y quien no supiera qué
        // contraseña eligió se quedaba sin salida.
        setNotice('Ese número ya tiene cuenta. Entra con tu contraseña para continuar.');
        setView('login');
        setTab('phone');
        return;
      }

      // Se guardan para poder reenviar desde la pantalla del código: allí ya no
      // se sabe si el usuario venía de un alta y perdería nombre y contraseña.
      setPhoneSignup(
        view === 'register' ? { username: form.username, password: form.password } : null
      );
      setMaskedPhone(data.phone);
      setCooldown(RESEND_SECONDS);
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

  // Reenviar el SMS. Se repite la llamada de "pedir código" con los mismos
  // datos guardados, porque el backend no distingue un reenvío de una petición
  // nueva y así no hace falta un endpoint aparte.
  const handleResendPhone = () =>
    run(async () => {
      const data = await startPhoneSignup({
        phone,
        country,
        username: phoneSignup?.username,
        password: phoneSignup?.password,
      });
      setCooldown(RESEND_SECONDS);
      setCode('');
      setDevCode('');
      if (data.delivered === false) {
        setNotice('El envío de SMS no está configurado en este servidor.');
        if (data.code) setDevCode(data.code);
      } else {
        setNotice('Te enviamos otro código por SMS.');
      }
    });

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

  /* ---------------- Portada ---------------- */

  // La pantalla de acceso. Es lo primero que ve quien no tiene sesión, así que
  // repite la marca del splash y ofrece las tres vías de entrada a la vista, en
  // lugar de esconderlas tras una pestaña.
  if (view === 'welcome') {
    return (
      <div className="auth-landing">
        <div className="auth-landing-glow" aria-hidden="true" />

        <div className="auth-landing-inner">
          <div className="auth-landing-brand">
            <div className="auth-landing-logo">
              <BrandMark size={92} />
            </div>
            <h1 className="auth-landing-word">TAK TAK</h1>
            <p className="auth-landing-tagline">
              Videos cortos en vertical, mensajes y llamadas
            </p>
          </div>

          <div className="auth-landing-actions">
            {showGoogle ? (
              <div className="auth-landing-google">
                <GoogleButton clientId={providers.googleClientId} onCredential={handleGoogle} />
              </div>
            ) : (
              <button type="button" className="btn-provider" disabled>
                <span aria-hidden="true">🔎</span> Continuar con Google
                <small>No configurado en este servidor</small>
              </button>
            )}

            <button
              type="button"
              className="btn-provider"
              onClick={() => {
                reset('register');
                setTab('email');
              }}
            >
              <span aria-hidden="true">✉️</span> Registrarse o iniciar sesión con correo
            </button>

            <button
              type="button"
              className="btn-provider"
              onClick={() => {
                reset('register');
                setTab('phone');
              }}
            >
              <span aria-hidden="true">📱</span> Registrarse o iniciar sesión con teléfono
            </button>
          </div>

          <div className="auth-landing-links">
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                reset('login');
                setTab('email');
              }}
            >
              ¿Ya tienes cuenta? Inicia sesión
            </button>

            {onGuest && (
              <button type="button" className="btn-link" onClick={onGuest}>
                Explorar sin cuenta
              </button>
            )}
          </div>

          <p className="auth-landing-legal">
            Al continuar aceptas los{' '}
            <button type="button" className="btn-link inline" onClick={() => setView('terms')}>
              términos
            </button>{' '}
            y la{' '}
            <button type="button" className="btn-link inline" onClick={() => setView('privacy')}>
              política de privacidad
            </button>
            .
          </p>
        </div>
      </div>
    );
  }

  /* ---------------- Términos y privacidad ---------------- */

  // Páginas reales dentro de la app. El texto es provisional y así se dice en
  // pantalla: presentarlo como definitivo sin revisión legal sería peor que no
  // tenerlo.
  if (view === 'terms' || view === 'privacy') {
    const isTerms = view === 'terms';
    return (
      <div className="auth-card">
        <h2>{isTerms ? 'Términos de uso' : 'Política de privacidad'}</h2>
        <p className="hint">Texto provisional. Pendiente de revisión legal antes de publicar.</p>
        {isTerms ? (
          <div className="legal-body">
            <p>
              TAK TAK es una plataforma de vídeo corto. Al crear una cuenta te comprometes a
              publicar contenido propio o con derechos suficientes, y a no usar la plataforma
              para acosar, suplantar ni difundir contenido ilegal.
            </p>
            <p>
              Las monedas TTC-C se compran y se gastan en regalos dentro de la app. Los
              diamantes TTC-R que recibe un creador son retirables. Las monedas ya enviadas
              como regalo no son reembolsables.
            </p>
            <p>
              Podemos retirar contenido o suspender cuentas que incumplan estas condiciones.
            </p>
          </div>
        ) : (
          <div className="legal-body">
            <p>
              Guardamos el nombre de usuario, el correo o el teléfono que uses para entrar, y la
              fecha de creación de la cuenta. Las contraseñas se almacenan cifradas y nunca se
              muestran.
            </p>
            <p>
              El teléfono se usa para que puedan llamarte y encontrarte dentro de TAK TAK. No
              vendemos tus datos a terceros.
            </p>
            <p>
              Puedes pedir la eliminación de tu cuenta y de tus datos desde los ajustes de la
              aplicación.
            </p>
          </div>
        )}
        <button type="button" className="btn-secondary" onClick={() => reset('register')}>
          Volver
        </button>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <button type="button" className="btn-link auth-back" onClick={() => reset('welcome')}>
        ← Volver
      </button>

      <h2>
        {view === 'login' && 'Iniciar sesión'}
        {view === 'register' && 'Crear cuenta'}
        {view === 'phone-code' && 'Verifica tu teléfono'}
        {view === 'verify-email' && 'Verifica tu correo'}
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
          />
          <PasswordField
            value={form.password}
            onChange={update('password')}
            placeholder="Contraseña"
            autoComplete="current-password"
            disabled={busy}
            name="password"
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
        <form onSubmit={handleRegister} noValidate>
          <input
            type="text"
            placeholder="Nombre de usuario"
            value={form.username}
            onChange={update('username')}
          />
          <input
            type="email"
            placeholder="Correo"
            value={form.email}
            onChange={update('email')}
            autoComplete="email"
          />
          <PasswordField
            value={form.password}
            onChange={update('password')}
            placeholder={`Contraseña (mínimo ${MIN_PASSWORD_LENGTH} caracteres)`}
            autoComplete="new-password"
            disabled={busy}
            name="new-password"
          />
          <PasswordField
            value={form.confirm}
            onChange={update('confirm')}
            placeholder="Repite la contraseña"
            autoComplete="new-password"
            disabled={busy}
            name="confirm-password"
          />

          <TermsCheck accepted={accepted} onChange={setAccepted} onOpen={setView} />

          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Procesando…' : 'Registrarme'}
          </button>
        </form>
      )}

      {/* ---------------- Phone ---------------- */}
      {(view === 'login' || view === 'register') && tab === 'phone' && (
        <form onSubmit={handlePhoneStart} noValidate>
          {view === 'register' && (
            <>
              <input
                type="text"
                placeholder="Nombre de usuario"
                value={form.username}
                onChange={update('username')}
              />
              <PasswordField
                value={form.password}
                onChange={update('password')}
                placeholder={`Contraseña (mínimo ${MIN_PASSWORD_LENGTH} caracteres)`}
                autoComplete="new-password"
                disabled={busy}
                name="phone-password"
              />
              <PasswordField
                value={form.confirm}
                onChange={update('confirm')}
                placeholder="Repite la contraseña"
                autoComplete="new-password"
                disabled={busy}
                name="phone-confirm-password"
              />
              <TermsCheck accepted={accepted} onChange={setAccepted} onOpen={setView} />
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
          />
          {/* En la entrada hace falta la contraseña: el teléfono solo no
              resuelve la cuenta, y sin ella el botón solo repetía el aviso de
              "ya tiene cuenta" sin llevar a ninguna parte. */}
          {view === 'login' && (
            <PasswordField
              value={form.password}
              onChange={update('password')}
              placeholder="Contraseña"
              autoComplete="current-password"
              disabled={busy}
              name="phone-login-password"
            />
          )}
          <p className="hint">
            {view === 'login'
              ? 'Entra con tu número y tu contraseña. Si no la recuerdas, usa "¿Olvidaste tu contraseña?".'
              : 'Te enviaremos un SMS con un código de 6 dígitos para verificar el número. Si ya tienes cuenta con ese teléfono, entra desde la pestaña de inicio de sesión con tu teléfono y contraseña. Funciona con números de cualquier país.'}
          </p>
          {notice && <p className="notice" role="status">{notice}</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Enviando…' : view === 'login' ? 'Entrar' : 'Enviar código'}
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
          <button
            type="button"
            className="btn-link"
            onClick={handleResendPhone}
            disabled={busy || cooldown > 0}
          >
            {resendLabel(cooldown)}
          </button>
          <button type="button" className="btn-link" onClick={() => reset('login')}>
            Corregir el número
          </button>
        </form>
      )}

      {/* ---------------- Verificación de correo ---------------- */}
      {view === 'verify-email' && (
        <form onSubmit={handleVerifyEmail}>
          <p className="hint">
            Enviamos un código de 6 dígitos a {pendingEmail || 'tu correo'}. Tu cuenta ya
            funciona; verificarla es lo que confirma que el correo es tuyo.
          </p>
          {notice && <p className="notice" role="status">{notice}</p>}
          <DevCodeBox code={devCode} onUse={setCode} />
          <CodeInput value={code} onChange={setCode} disabled={busy} />
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy || code.length !== 6}>
            {busy ? 'Verificando…' : 'Verificar correo'}
          </button>
          <button
            type="button"
            className="btn-link"
            onClick={handleResendEmail}
            disabled={busy || cooldown > 0}
          >
            {resendLabel(cooldown)}
          </button>
          <button type="button" className="btn-link" onClick={() => onDone?.()}>
            Lo verificaré más tarde
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
          <PasswordField
            value={form.password}
            onChange={update('password')}
            placeholder="Nueva contraseña"
            autoComplete="new-password"
            disabled={busy}
            name="reset-password"
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
