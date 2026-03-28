import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Mail, Shield, RefreshCw, ArrowLeft, Key
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { authApi } from '@/services/api';
import { useStore } from '@/store/useStore';
import { CountryPicker } from './CountryPicker';

interface LandingPageProps {
  onEnterApp: () => void;
  onAuth: (mode: 'login' | 'signup' | 'recovery') => void;
}

type FormMode = 'main' | 'otp' | 'profile' | 'security' | 'recovery';

export const LandingPage = ({ onEnterApp }: LandingPageProps) => {
  const [formMode, setFormMode] = useState<FormMode>('main');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [countryCode, setCountryCode] = useState('+58');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [dob, setDob] = useState('');
  const [agreements, setAgreements] = useState({ legal: false, privacy: false });
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState('¿Cuál es el nombre de tu primera mascota?');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [debugOtp, setDebugOtp] = useState<string | null>(null);
  const [referredByCode, setReferredByCode] = useState(() => {
    return new URLSearchParams(window.location.search).get('ref') || '';
  });
  const [recoveryWords, setRecoveryWords] = useState<string[]>(new Array(12).fill(''));
  const [recoveryIdentifier, setRecoveryIdentifier] = useState('');

  const { login } = useStore();

  useEffect(() => {
    const locale = navigator.language.toLowerCase();
    const map: Record<string, string> = {
      'es-ve': '+58', 'es-co': '+57', 'es-es': '+34', 'es-ar': '+54',
      'es-mx': '+52', 'es-cl': '+56', 'es-pe': '+51', 'en-us': '+1', 'en-gb': '+44',
    };
    for (const [key, code] of Object.entries(map)) {
      if (locale.includes(key)) { setCountryCode(code); break; }
    }
  }, []);

  const getFullIdentifier = () => {
    if (email.includes('@')) return email;
    return countryCode + phone;
  };

  // --- AUTH HANDLERS ---

  const handleSubmitIdentity = async () => {
    const identifier = getFullIdentifier();
    if (!phone.trim() && !email.trim()) {
      toast.error('Ingresa tu correo o teléfono'); return;
    }
    setIsLoading(true);
    try {
      // If password provided, try login-password first
      if (password.trim()) {
        try {
          const response = await authApi.loginWithPassword(identifier, password);
          const data = response?.data;
          if (data?.token && data?.user) {
            localStorage.setItem('taktak_token', data.token);
            login(data.user);
            toast.success(`¡Bienvenido, ${data.user.username}!`);
            onEnterApp();
            return;
          }
        } catch (err: unknown) {
          const error = err as { response?: { status: number, data?: { error: string } } };
          // If it's a 401 (Wrong Password), stop and show error
          if (error.response?.status === 401 || error.response?.status === 404) {
             toast.error(error.response?.data?.error || 'Credenciales incorrectas');
             setIsLoading(false);
             return;
          }
          // For other errors, we can let it fall back or show error
          console.error("Password login error:", err);
        }
      }

      // Fallback to OTP flow
      const response = await authApi.login(identifier);
      const data = response?.data;
      if (data?.debugOtp) setDebugOtp(data.debugOtp);
      toast.success('Código enviado. Revisa tu teléfono o correo.');
      setFormMode('otp');
    } catch {
      // If login fails (and no password was tried or it failed), try register
      try {
        const response = await authApi.register({
          phone: identifier,
          username: identifier.replace(/[^a-z0-9]/g, '').slice(0, 15),
          email: email || undefined,
          dob: '2000-01-01',
          legalAccepted: true,
          privacyAccepted: true,
          referredByCode: referredByCode || undefined,
        });
        const data = response?.data;
        if (data?.token) localStorage.setItem('taktak_token', data.token);
        if (data?.debugOtp) setDebugOtp(data.debugOtp);
        toast.success('¡Cuenta creada! Código enviado.');
        setFormMode('otp');
      } catch (err: unknown) {
        const error = err as { response?: { data?: { error?: string } } };
        toast.error(error?.response?.data?.error || 'Error de conexión con el servidor');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    const code = otp.join('');
    if (code.length < 6) { toast.error('Código incompleto'); return; }
    const identifier = getFullIdentifier();
    setIsLoading(true);
    try {
      const response = await authApi.verify(identifier, code);
      const data = response?.data;
      if (!data) { toast.error('Respuesta inválida'); return; }
      if (data.token) localStorage.setItem('taktak_token', data.token);
      if (data.needsProfile) {
        const wordList = ['sol','luna','estrella','mar','montaña','rio','viento','fuego','tierra','bosque','flor','nieve','camino','viaje','tiempo','vida','sueño','amor','paz','luz','cielo','nube','lluvia','dia','noche','alma','corazon','mente','fuerza','valor','esperanza','verdad','destino','mundo','universo','espacio','voz','canto','palabra','silencio','oro','plata','bronce','hierro','cristal','piedra','hoja','arbol','raiz','semilla'];
        setRecoveryPhrase(Array.from({ length: 12 }, () => wordList[Math.floor(Math.random() * wordList.length)]).join(' '));
        setFormMode('profile');
      } else if (data.user) {
        login(data.user);
        toast.success(`¡Bienvenido, ${data.user.username}!`);
        onEnterApp();
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error?.response?.data?.error || 'Código incorrecto');
    } finally { setIsLoading(false); }
  };

  const handleProfileComplete = async () => {
    if (!username.trim() || !dob) { toast.error('Completa tu perfil'); return; }
    if (!agreements.legal || !agreements.privacy) { toast.error('Acepta los términos'); return; }
    setIsLoading(true);
    try {
      await authApi.updateProfile({ username, dob, legalAccepted: agreements.legal, privacyAccepted: agreements.privacy });
      setFormMode('security');
    } catch { toast.error('Error al guardar perfil'); }
    finally { setIsLoading(false); }
  };

  const handleSecurityComplete = async () => {
    if (!securityAnswer.trim()) { toast.error('Necesitas la respuesta de seguridad'); return; }
    setIsLoading(true);
    try {
      await authApi.setupSecurity({ securityQuestion, securityAnswer, recoveryPhrase });
      const { data } = await authApi.getMe();
      login(data.user);
      toast.success('¡Cuenta creada con éxito!');
      onEnterApp();
    } catch { toast.error('Error al guardar seguridad'); }
    finally { setIsLoading(false); }
  };

  const handleRecover = async () => {
    if (!recoveryIdentifier) { toast.error('Ingresa tu identificador'); return; }
    if (recoveryWords.some(w => !w)) { toast.error('Completa las 12 palabras'); return; }
    setIsLoading(true);
    try {
      const id = recoveryIdentifier.includes('@') ? recoveryIdentifier : (recoveryIdentifier.startsWith('+') ? recoveryIdentifier : countryCode + recoveryIdentifier);
      const response = await authApi.recoverAccount({ identifier: id, recoveryPhrase: recoveryWords.join(' ') });
      const { user, token } = response.data;
      localStorage.setItem('taktak_token', token);
      login(user);
      toast.success(`¡Bienvenido de vuelta, ${user.username}!`);
      onEnterApp();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error?.response?.data?.error || 'Frase incorrecta');
    } finally { setIsLoading(false); }
  };

  const handleOTPChange = (index: number, value: string) => {
    if (value.length > 1) value = value[0];
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    if (value && index < 5) document.getElementById(`landing-otp-${index + 1}`)?.focus();
  };

  const handleRecoveryPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const words = e.clipboardData.getData('text').split(/\s+/).slice(0, 12);
    if (words.length > 0) {
      const nw = [...recoveryWords];
      words.forEach((w, i) => { if (i < 12) nw[i] = w.toLowerCase().trim(); });
      setRecoveryWords(nw);
    }
  };

  // --- RENDER ---

  const renderForm = () => {
    switch (formMode) {
      case 'main':
        return (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-sm px-6 space-y-4">
            {/* CORREO */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Correo electrónico</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
                <Input 
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  className="bg-zinc-900/80 border-zinc-800 h-13 text-white pl-10 focus:border-yellow-500/50 text-base"
                />
              </div>
            </div>

            {/* SEPARADOR */}
            <div className="flex items-center gap-3 text-zinc-600 text-[10px] font-bold uppercase">
              <div className="h-px bg-zinc-800 flex-1" /> o con teléfono <div className="h-px bg-zinc-800 flex-1" />
            </div>

            {/* TELÉFONO */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Número de teléfono</label>
              <div className="flex gap-2">
                <CountryPicker value={countryCode} onChange={setCountryCode} />
                <Input 
                  value={phone}
                  onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                  placeholder="Número"
                  className="bg-zinc-900/80 border-zinc-800 h-13 text-white flex-1 focus:border-yellow-500/50 text-base"
                />
              </div>
            </div>

            {/* CONTRASEÑA (OPCIONAL PARA ENTRADA DIRECTA) */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Contraseña (opcional para OTP)</label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
                <Input 
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Tu contraseña"
                  className="bg-zinc-900/80 border-zinc-800 h-13 text-white pl-10 focus:border-yellow-500/50 text-base"
                />
              </div>
            </div>

            {/* CÓDIGO INVITADO */}
            <Input 
              value={referredByCode}
              onChange={e => setReferredByCode(e.target.value)}
              placeholder="Código de invitado (opcional)"
              className="bg-zinc-900/30 border-zinc-800 h-9 text-zinc-500 text-center text-xs"
            />

            {/* BOTÓN PRINCIPAL */}
            <Button 
              onClick={handleSubmitIdentity}
              disabled={isLoading || (!phone.trim() && !email.trim())}
              className="w-full h-14 bg-yellow-600 hover:bg-yellow-500 text-black rounded-xl font-black text-lg transition-all active:scale-95 shadow-[0_10px_30px_rgba(234,179,8,0.25)]"
            >
              {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Entrar / Crear Cuenta'}
            </Button>

            {/* RECUPERAR */}
            <button onClick={() => setFormMode('recovery')} className="w-full text-zinc-500 hover:text-yellow-500 text-[11px] transition-colors pt-1 flex items-center justify-center gap-1.5">
              <Key className="w-3 h-3" /> ¿Perdiste tu cuenta? Recuperar con 12 palabras
            </button>
          </motion.div>
        );

      case 'otp':
        return (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-sm px-6 space-y-4 flex flex-col items-center">
            <h2 className="text-xl font-black text-white">Verificar Código</h2>
            <p className="text-zinc-500 text-sm text-center">Ingresa el código de 6 dígitos</p>
            {debugOtp && (
              <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-lg p-3 w-full text-center">
                <p className="text-yellow-500 text-xs font-bold">🔑 OTP DE DEPURACIÓN</p>
                <p className="text-yellow-400 text-2xl font-black tracking-[0.3em]">{debugOtp}</p>
              </div>
            )}
            <div className="flex gap-2">
              {otp.map((digit, i) => (
                <input key={i} id={`landing-otp-${i}`} type="text" maxLength={1} value={digit}
                  onChange={e => handleOTPChange(i, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Backspace' && !otp[i] && i > 0) document.getElementById(`landing-otp-${i-1}`)?.focus(); }}
                  className="w-12 h-14 bg-zinc-900 border border-zinc-800 rounded-lg text-center text-2xl font-bold text-yellow-500 focus:border-yellow-500 focus:outline-none"
                />
              ))}
            </div>
            <Button onClick={handleVerifyOTP} disabled={isLoading} className="w-full h-14 bg-yellow-600 hover:bg-yellow-500 text-black rounded-xl font-black text-lg">
              {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Verificar'}
            </Button>
            <button onClick={() => { setFormMode('main'); setOtp(['','','','','','']); setDebugOtp(null); }} className="text-zinc-500 text-xs hover:text-white">Volver</button>
          </motion.div>
        );

      case 'profile':
        return (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-sm px-6 space-y-4">
            <h2 className="text-xl font-black text-white">Completa tu perfil</h2>
            <Input value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="@usuario" className="bg-zinc-900 border-zinc-800 h-12 text-white" />
            <Input type="date" value={dob} onChange={e => setDob(e.target.value)} className="bg-zinc-900 border-zinc-800 h-12 text-white" />
            <label className="flex items-start gap-3 text-sm text-zinc-400"><input type="checkbox" checked={agreements.legal} onChange={e => setAgreements({...agreements, legal: e.target.checked})} className="mt-1 w-4 h-4" /> Acepto términos y condiciones</label>
            <label className="flex items-start gap-3 text-sm text-zinc-400"><input type="checkbox" checked={agreements.privacy} onChange={e => setAgreements({...agreements, privacy: e.target.checked})} className="mt-1 w-4 h-4" /> Acepto política de privacidad P2P</label>
            <Button onClick={handleProfileComplete} disabled={isLoading} className="w-full h-14 bg-yellow-600 hover:bg-yellow-500 text-black rounded-xl font-black text-lg">
              {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Continuar'}
            </Button>
          </motion.div>
        );

      case 'security':
        return (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-sm px-6 space-y-4">
            <div className="flex items-center gap-2">
              <Shield className="w-6 h-6 text-cyan-400" />
              <h2 className="text-xl font-black text-white">Seguridad Web3</h2>
            </div>
            <div className="bg-zinc-900 border border-red-500/30 rounded-xl p-3">
              <h3 className="text-red-400 font-bold text-sm mb-2">⚠️ Frase de Recuperación</h3>
              <p className="text-[10px] text-zinc-500 mb-3">Copia estas 12 palabras. Si las pierdes, perderás acceso.</p>
              <div className="grid grid-cols-3 gap-1.5 mb-3">
                {recoveryPhrase.split(' ').map((word, i) => (
                  <div key={i} className="bg-black/50 border border-zinc-800 rounded p-1.5 text-center">
                    <span className="text-[8px] text-zinc-600">{i+1}</span>
                    <span className="text-xs text-cyan-50 block">{word}</span>
                  </div>
                ))}
              </div>
              <Button variant="outline" className="w-full text-xs bg-zinc-800 border-zinc-700 text-zinc-300" onClick={() => { navigator.clipboard.writeText(recoveryPhrase); toast.success('¡Copiado!'); }}>
                Copiar al portapapeles
              </Button>
            </div>
            <select className="w-full h-10 bg-zinc-900 border border-zinc-800 rounded-md px-3 text-sm text-white" value={securityQuestion} onChange={e => setSecurityQuestion(e.target.value)}>
              <option>¿Cuál es el nombre de tu primera mascota?</option>
              <option>¿Cuál es la ciudad donde naciste?</option>
              <option>¿Cuál era el apodo de tu infancia?</option>
            </select>
            <Input type="password" value={securityAnswer} onChange={e => setSecurityAnswer(e.target.value)} placeholder="Tu respuesta secreta" className="bg-zinc-900 border-zinc-800 h-12 text-white" />
            <Button onClick={handleSecurityComplete} disabled={isLoading || !securityAnswer.trim()} className="w-full h-14 bg-cyan-600 hover:bg-cyan-700 text-white font-black text-lg rounded-xl">
              {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Finalizar y Entrar'}
            </Button>
          </motion.div>
        );

      case 'recovery':
        return (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-sm px-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-white">Recuperar Cuenta</h2>
              <button onClick={() => setFormMode('main')} className="text-zinc-500 hover:text-white text-sm flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Volver</button>
            </div>
            <Input value={recoveryIdentifier} onChange={e => setRecoveryIdentifier(e.target.value)} placeholder="Correo o teléfono" className="bg-zinc-900/50 border-zinc-800 h-12 text-white" />
            <div className="grid grid-cols-2 gap-2" onPaste={handleRecoveryPaste}>
              {recoveryWords.map((word, i) => (
                <div key={i} className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-zinc-600 font-bold">{i+1}</span>
                  <Input value={word} onChange={e => { const nw = [...recoveryWords]; nw[i] = e.target.value.toLowerCase().trim(); setRecoveryWords(nw); }} className="bg-zinc-900/50 border-zinc-800 h-10 pl-7 text-sm" placeholder="..." />
                </div>
              ))}
            </div>
            <Button onClick={handleRecover} disabled={isLoading || recoveryWords.some(w => !w) || !recoveryIdentifier} className="w-full h-14 bg-yellow-600 hover:bg-yellow-500 text-black font-black text-lg rounded-xl">
              {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Validar y Restaurar'}
            </Button>
          </motion.div>
        );
    }
  };

  return (
    <div className="flex flex-col items-center min-h-screen bg-black overflow-y-auto pb-20 scrollbar-hide">
      <div className="w-full max-w-4xl px-4 pt-10 flex flex-col items-center">
        {/* Logo */}
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.8 }} className="relative mb-3">
          <img src="/taktak-logo.jpeg" alt="TakTak Logo" className="w-20 h-20 object-cover rounded-2xl" />
        </motion.div>

        {/* Title */}
        <motion.h1 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="text-2xl md:text-3xl font-black mb-1 text-white text-center">
          <span className="text-yellow-500">TakTak</span>
        </motion.h1>
        <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }} className="text-xs text-zinc-500 mb-6 text-center">
          Red social de video descentralizada P2P
        </motion.p>

        {/* FORMULARIO DIRECTO */}
        <AnimatePresence mode="wait">
          <motion.div key={formMode} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full flex justify-center mb-8">
            {renderForm()}
          </motion.div>
        </AnimatePresence>

        {/* Features - solo en pantalla principal */}
        {formMode === 'main' && (
          <div className="grid grid-cols-3 gap-3 w-full max-w-sm mb-10 px-6">
            <div className="bg-zinc-900/50 p-3 rounded-xl border border-zinc-800 text-center">
              <h3 className="text-yellow-500 font-black text-sm">P2P</h3>
              <p className="text-zinc-500 text-[10px]">Descentralizado</p>
            </div>
            <div className="bg-zinc-900/50 p-3 rounded-xl border border-zinc-800 text-center">
              <h3 className="text-yellow-500 font-black text-sm">TTC</h3>
              <p className="text-zinc-500 text-[10px]">Tak Tak Coins</p>
            </div>
            <div className="bg-zinc-900/50 p-3 rounded-xl border border-zinc-800 text-center">
              <h3 className="text-yellow-500 font-black text-sm">18+</h3>
              <p className="text-zinc-500 text-[10px]">Sin censura</p>
            </div>
          </div>
        )}

        {/* Pepa del Queso */}
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.6 }} className="flex flex-col items-center mt-4 mb-16 text-center pointer-events-none">
          <div className="relative">
            {[...Array(8)].map((_, i) => (
              <motion.div key={i} className="absolute w-1 h-1 bg-yellow-400 rounded-full blur-[0.5px] z-10"
                animate={{ y: [-20, -100], x: [0, (i % 2 === 0 ? 50 : -50)], opacity: [0, 0.8, 0], scale: [0, 1.5, 0] }}
                transition={{ duration: 4 + i % 3, repeat: Infinity, delay: i * 0.4, ease: "linear" }}
                style={{ left: `${40 + (i * 5) % 20}%`, bottom: '30%' }}
              />
            ))}
            <img src="/pepa.png" alt="Pepa del Queso" className="w-44 h-44 object-cover rounded-3xl border-2 border-yellow-500/20 shadow-[0_20px_60px_rgba(234,179,8,0.2)] transform -rotate-3 hover:rotate-0 transition-transform duration-700" />
            <div className="absolute -bottom-3 -right-3 bg-yellow-500 text-black font-black px-4 py-1 rounded-full text-[8px] shadow-2xl border-2 border-black tracking-tighter ring-4 ring-black/50">PREMIUM P2P</div>
          </div>
          <div className="mt-6">
            <p className="text-yellow-500 font-extrabold text-lg italic tracking-[0.3em] uppercase leading-none opacity-80">Somos la</p>
            <h2 className="text-3xl font-black text-white italic tracking-tighter mt-1 drop-shadow-lg scale-y-110">PEPA DEL QUESO</h2>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
