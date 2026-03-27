import { useState } from 'react';
import {
  ArrowLeft, MessageCircle, Shield,
  RefreshCw, User, Check, Mail
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { PrivacyPolicy } from './PrivacyPolicy';
import { TermsOfService } from './TermsOfService';
import { authApi } from '@/services/api';
import { CountryPicker } from './CountryPicker';
import { cn } from '@/lib/utils';

type AuthStep = 'phone' | 'otp' | 'profile' | 'security' | 'privacy' | 'terms' | 'recovery' | 'recovery_question';

export const AuthView = ({ mode = 'signup' }: { mode?: 'login' | 'signup' | 'recovery' }) => {
  const [step, setStep] = useState<AuthStep>(mode === 'recovery' ? 'recovery' : 'phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [dob, setDob] = useState('');
  const [agreements, setAgreements] = useState({ legal: false, privacy: false });
  const [recoveryPhrase, setRecoveryPhrase] = useState<string>('');
  const [securityQuestion, setSecurityQuestion] = useState('¿Cuál es el nombre de tu primera mascota?');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [referredByCode, setReferredByCode] = useState(() => {
    return new URLSearchParams(window.location.search).get('ref') || '';
  });
  
  const { login } = useStore();
  const [countryCode, setCountryCode] = useState('+58');

  const [debugOtp, setDebugOtp] = useState<string | null>(null);

  useState(() => {
    // Basic auto-detection based on browser locale
    const locale = navigator.language.toLowerCase();
    const countryMapping: Record<string, string> = {
      'es-ve': '+58',
      'es-co': '+57',
      'es-es': '+34',
      'es-ar': '+54',
      'es-mx': '+52',
      'es-cl': '+56',
      'es-pe': '+51',
      'en-us': '+1',
      'en-gb': '+44',
    };
    
    for (const [key, code] of Object.entries(countryMapping)) {
      if (locale.includes(key)) {
        setCountryCode(code);
        break;
      }
    }
  });

  const handleIdentitySubmit = async () => {
    if (!phone.trim()) {
      toast.error('Ingresa tu teléfono o correo');
      return;
    }
    setIsLoading(true);
    setDebugOtp(null);
    
    const fullIdentifier = phone.includes('@') ? phone : (phone.startsWith('+') ? phone : countryCode + phone);
    
    try {
      const res = await authApi.login(fullIdentifier).catch(() => {
        if (fullIdentifier.includes('@')) {
          return authApi.register({ 
            phone: 'temp_' + Date.now(),
            email: fullIdentifier,
            username: 'user_' + Math.random().toString(36).substring(7),
            dob: '2000-01-01',
            legalAccepted: true, 
            privacyAccepted: true,
            referredByCode
          });
        }
        return authApi.register({ 
          phone: fullIdentifier, 
          username: 'pending_' + Date.now(),
          dob: '2000-01-01',
          legalAccepted: true, 
          privacyAccepted: true,
          referredByCode
        });
      });
      
      if (res.data.debugOtp) {
        setDebugOtp(res.data.debugOtp);
      }
      
      setStep('otp');
      toast.success(`Código enviado a ${fullIdentifier}`);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error: string } } };
      toast.error(error.response?.data?.error || 'Error al enviar código');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    const otpCode = otp.join('');
    if (otpCode.length < 6) {
      toast.error('Ingresa el código completo');
      return;
    }
    setIsLoading(true);
    const fullIdentifier = phone.includes('@') ? phone : (phone.startsWith('+') ? phone : countryCode + phone);
    try {
      const response = await authApi.verify(fullIdentifier, otpCode);
      const { user, token } = response.data || {};
      
      if (!user) {
        throw new Error("Respuesta del servidor inválida.");
      }

      localStorage.setItem('taktak_token', token);
      
      if (!user.username || user.username.startsWith('pending_')) {
        setStep('profile');
      } else {
        login(user); // Fixed: user now contains economic properties from backend OR defaults in store
        toast.success(`¡Bienvenido de nuevo, ${user.username}!`);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error: string } } };
      toast.error(error.response?.data?.error || 'Código incorrecto o expirado');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteProfile = async () => {
    if (!username.trim()) {
      toast.error('Ingresa un nombre de usuario');
      return;
    }
    if (!dob) {
      toast.error('Selecciona tu fecha de nacimiento');
      return;
    }
    if (!agreements.legal || !agreements.privacy) {
      toast.error('Debes aceptar los términos y políticas');
      return;
    }

    setIsLoading(true);
    try {
      // First update the profile in the backend
      await authApi.updateProfile({ 
        username, 
        dob, 
        legalAccepted: agreements.legal, 
        privacyAccepted: agreements.privacy 
      });
      
      // Generate 12 random words for the recovery phrase immediately
      const wordList = ['sol', 'luna', 'estrella', 'mar', 'montaña', 'rio', 'viento', 'fuego', 'tierra', 'bosque', 'flor', 'nieve', 'camino', 'viaje', 'tiempo', 'vida', 'sueño', 'amor', 'paz', 'luz', 'cielo', 'nube', 'lluvia', 'dia', 'noche', 'alma', 'corazon', 'mente', 'fuerza', 'valor', 'esperanza', 'verdad', 'destino', 'mundo', 'universo', 'espacio', 'voz', 'canto', 'palabra', 'silencio', 'oro', 'plata', 'bronce', 'hierro', 'cristal', 'piedra', 'hoja', 'arbol', 'raiz', 'semilla'];
      const phrase = Array.from({ length: 12 }, () => wordList[Math.floor(Math.random() * wordList.length)]).join(' ');
      setRecoveryPhrase(phrase);
      
      setStep('security');
      toast.success('Perfil actualizado. Configura tu seguridad.');
    } catch {
      toast.error('Error al actualizar perfil');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteSecurity = async () => {
    if (!securityQuestion || !securityAnswer.trim()) {
      toast.error('Debes establecer una pregunta y respuesta de seguridad');
      return;
    }

    setIsLoading(true);
    try {
      await authApi.setupSecurity({
        securityQuestion,
        securityAnswer,
        recoveryPhrase
      });

      // Get full updated user
      const { data } = await authApi.getMe();
      
      login(data.user);
      toast.success('¡Registro y seguridad completados con éxito!');
    } catch {
      toast.error('Error al guardar seguridad');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOTP = () => {
    toast.success(`Nuevo código enviado al +${phone}`);
  };

  const handleOTPChange = (index: number, value: string) => {
    if (value.length > 1) value = value[0];
    if (!/^\d*$/.test(value)) return;
    
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (value && index < 5) {
      const nextInput = document.getElementById(`otp-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      const prevInput = document.getElementById(`otp-${index - 1}`);
      prevInput?.focus();
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'recovery':
        return <RecoveryScreen 
          onBack={() => setStep('phone')} 
          onComplete={() => setStep('profile')}
          onSwitchToQuestion={() => setStep('recovery_question')}
        />;
      case 'recovery_question':
        return <RecoveryQuestionScreen
          onBack={() => setStep('recovery')}
          onComplete={() => setStep('profile')}
        />;
      case 'phone':
        return <PhoneScreen 
          phone={phone} 
          setPhone={setPhone}
          countryCode={countryCode}
          setCountryCode={setCountryCode}
          referredByCode={referredByCode}
          setReferredByCode={setReferredByCode}
          isLoading={isLoading}
          onContinue={handleIdentitySubmit}
          mode={mode === 'recovery' ? 'signup' : mode}
        />;
      case 'otp':
        return (
          <div className="relative">
            {debugOtp && (
              <div className="absolute top-0 left-0 right-0 bg-yellow-500/20 border border-yellow-500/50 p-2 text-center text-[10px] text-yellow-500 font-bold z-50 rounded-b-xl backdrop-blur-md">
                MODO ADMIN (OTP): {debugOtp}
              </div>
            )}
            <OTPScreen 
              otp={otp}
              isLoading={isLoading}
              onOtpChange={handleOTPChange}
              onKeyDown={handleKeyDown}
              onVerify={handleVerifyOTP}
              onResend={handleResendOTP}
              onBack={() => setStep('phone')}
            />
          </div>
        );
      case 'profile':
        return <ProfileScreen 
          username={username}
          setUsername={setUsername}
          dob={dob}
          setDob={setDob}
          agreements={agreements}
          setAgreements={setAgreements}
          isLoading={isLoading}
          onComplete={handleCompleteProfile}
          onBack={() => setStep('otp')}
        />;
      case 'security':
        return <SecurityScreen 
          recoveryPhrase={recoveryPhrase}
          securityQuestion={securityQuestion}
          setSecurityQuestion={setSecurityQuestion}
          securityAnswer={securityAnswer}
          setSecurityAnswer={setSecurityAnswer}
          isLoading={isLoading}
          onComplete={handleCompleteSecurity}
        />;
      case 'terms':
        return <TermsOfService onBack={() => setStep('phone')} />;
      case 'privacy':
        return <PrivacyPolicy onBack={() => setStep('phone')} />;
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      {renderStep()}
    </div>
  );
};

// Removed WelcomeScreen as it's replaced by the premium LandingPage

// Removed WelcomeScreen as it's replaced by the premium LandingPage

const RecoveryScreen = ({ onBack, onComplete, onSwitchToQuestion }: { onBack: () => void, onComplete: () => void, onSwitchToQuestion: () => void }) => {
  const [recoveryWords, setRecoveryWords] = useState<string[]>(new Array(12).fill(''));

  const handleWordChange = (index: number, value: string) => {
    const newWords = [...recoveryWords];
    newWords[index] = value.toLowerCase().trim();
    setRecoveryWords(newWords);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const words = text.split(/\s+/).slice(0, 12);
    if (words.length > 0) {
      const newWords = [...recoveryWords];
      words.forEach((w, i) => { if (i < 12) newWords[i] = w.toLowerCase().trim(); });
      setRecoveryWords(newWords);
    }
  };

  const isComplete = recoveryWords.every((w: string) => w.length > 0);

  return (
    <div className="flex flex-col h-screen bg-black text-white p-6 overflow-y-auto pb-32">
      <button 
        onClick={onBack} 
        aria-label="Volver"
        className="self-start mb-6 text-zinc-500 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      <div className="flex flex-col items-center mb-8">
        <div className="w-20 h-20 mb-6 p-4 bg-zinc-900 rounded-3xl border border-zinc-800 ring-4 ring-yellow-500/10">
           <Shield className="w-full h-full text-yellow-500" />
        </div>
        <h1 className="text-2xl font-black text-white mb-2 uppercase tracking-tighter">Recuperar Cuenta</h1>
        <p className="text-zinc-500 text-center text-sm italic">Ingresa tus 12 palabras clave para restaurar tu identidad</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-10" onPaste={handlePaste}>
        {recoveryWords.map((word: string, i: number) => (
          <div key={i} className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-zinc-600 font-bold">{i + 1}</span>
            <Input 
              value={word}
              onChange={(e) => handleWordChange(i, e.target.value)}
              className="bg-zinc-900/50 border-zinc-800 h-11 pl-8 text-sm focus:border-yellow-500/50"
              placeholder="..."
            />
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <Button 
          disabled={!isComplete}
          onClick={onComplete}
          className="w-full h-14 bg-yellow-600 hover:bg-yellow-500 text-black font-black text-lg rounded-2xl shadow-[0_10px_30px_rgba(234,179,8,0.2)]"
        >
          Validar y Restaurar
        </Button>

        <button 
          onClick={onSwitchToQuestion}
          className="w-full text-zinc-500 hover:text-yellow-500 text-xs font-bold transition-colors py-2"
        >
          ¿No tienes las palabras? Usar Pregunta de Seguridad
        </button>
      </div>
    </div>
  );
};

const RecoveryQuestionScreen = ({ onBack, onComplete }: { onBack: () => void, onComplete: () => void }) => {
  const [phoneOrEmail, setPhoneOrEmail] = useState('');
  const [answer, setAnswer] = useState('');

  return (
    <div className="flex flex-col h-screen bg-black text-white p-6 overflow-y-auto">
      <button onClick={onBack} aria-label="Volver" className="self-start mb-6 text-zinc-500 hover:text-white transition-colors">
        <ArrowLeft className="w-5 h-5" />
      </button>

      <div className="flex flex-col items-center mb-10">
        <div className="w-20 h-20 mb-6 p-4 bg-zinc-900 rounded-3xl border border-zinc-800">
           <RefreshCw className="w-full h-full text-yellow-500" />
        </div>
        <h1 className="text-2xl font-black text-white mb-2 uppercase tracking-tighter">Pregunta Secreta</h1>
        <p className="text-zinc-500 text-center text-sm italic">Responde tu pregunta para recuperar acceso</p>
      </div>

      <div className="space-y-6 mb-10">
        <div className="space-y-2">
          <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Identificador</label>
          <Input 
            value={phoneOrEmail} 
            onChange={e => setPhoneOrEmail(e.target.value)}
            placeholder="Teléfono o Correo" 
            className="bg-zinc-900 border-zinc-800 h-14"
          />
        </div>
        
        <div className="space-y-2">
          <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Tu Respuesta</label>
          <Input 
            type="password"
            value={answer} 
            onChange={e => setAnswer(e.target.value)}
            placeholder="Ingresa tu palabra secreta" 
            className="bg-zinc-900 border-zinc-800 h-14 text-yellow-500"
          />
        </div>
      </div>

      <Button 
        disabled={!answer || !phoneOrEmail}
        onClick={onComplete}
        className="w-full h-14 bg-yellow-600 hover:bg-yellow-500 text-black font-black text-lg rounded-2xl shadow-[0_10px_30px_rgba(234,179,8,0.2)]"
      >
        Validar Respuesta
      </Button>
    </div>
  );
};

const PhoneScreen = ({
  phone,
  setPhone,
  countryCode,
  setCountryCode,
  referredByCode,
  setReferredByCode,
  isLoading,
  onContinue,
  mode
}: {
  phone: string;
  setPhone: (v: string) => void;
  countryCode: string;
  setCountryCode: (v: string) => void;
  referredByCode: string;
  setReferredByCode: (v: string) => void;
  isLoading: boolean;
  onContinue: () => void;
  mode: 'login' | 'signup';
}) => (
  <div className="flex flex-col h-screen bg-black text-white">
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="p-4 mb-4">
        <img src="/taktak-logo.jpeg" alt="Logo" className="w-24 h-24 object-contain" />
      </div>

      <h1 className="text-2xl font-black text-white mb-2 uppercase tracking-tighter">
        {mode === 'login' ? 'Ingresar a TakTak' : 'Crear Tu Cuenta'}
      </h1>
      <p className="text-zinc-500 text-center mb-10 text-sm italic">
        {mode === 'login' ? 'Bienvenido de vuelta, ingresa tu número o correo' : 'Únete a la red P2P más grande'}
      </p>

      <div className="w-full max-w-md mb-8">
        <div className={cn(
          "flex items-center bg-zinc-900/30 border border-zinc-800/80 rounded-2xl backdrop-blur-xl transition-all focus-within:border-yellow-500/40 focus-within:ring-1 focus-within:ring-yellow-500/10",
          "h-16 px-1 shadow-[0_0_20px_rgba(0,0,0,0.5)]"
        )}>
          {!phone.includes('@') && (
            <div className="flex items-center">
              <CountryPicker 
                value={countryCode} 
                onChange={setCountryCode} 
                className="border-none bg-transparent hover:bg-zinc-800/20 w-[100px] h-14"
              />
              <div className="w-px h-8 bg-zinc-800/50 mx-1" /> {/* Vertical divider */}
            </div>
          )}
          
          <div className="flex-1 flex items-center gap-3 px-3 h-full">
            {phone.includes('@') && <Mail className="w-5 h-5 text-zinc-600" />}
            <Input 
              type="text"
              placeholder={phone.includes('@') ? "Correo electrónico" : "Número de teléfono"}
              className="bg-transparent border-none focus:ring-0 text-white h-full p-0 text-lg placeholder:text-zinc-700"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
      </div>

      {mode === 'signup' && (
        <div className="w-full max-w-md mb-8">
          <Input 
            type="text"
            placeholder="Código de Invitado (Opcional)"
            className="bg-zinc-900/30 border-zinc-800 focus:border-yellow-500/50 text-zinc-400 h-10 text-center rounded-xl"
            value={referredByCode}
            onChange={(e) => setReferredByCode(e.target.value)}
          />
        </div>
      )}

      <Button 
        className="w-full max-w-md h-14 bg-yellow-600 hover:bg-yellow-500 text-black font-black text-lg rounded-2xl shadow-[0_4px_20px_rgba(234,179,8,0.2)] transition-all active:scale-95"
        onClick={onContinue}
        disabled={isLoading}
      >
        {isLoading ? <RefreshCw className="w-6 h-6 animate-spin" /> : 'Siguiente'}
      </Button>
      
      <p className="mt-8 text-[10px] text-zinc-600 text-center px-10 max-w-sm">
        Al hacer clic en Siguiente, aceptas nuestros Términos y Política de Privacidad P2P.
      </p>
    </div>
  </div>
);

const OTPScreen = ({
  otp,
  isLoading,
  onOtpChange,
  onKeyDown,
  onVerify,
  onResend,
  onBack
}: {
  otp: string[];
  isLoading: boolean;
  onOtpChange: (i: number, v: string) => void;
  onKeyDown: (i: number, e: React.KeyboardEvent) => void;
  onVerify: () => void;
  onResend: () => void;
  onBack: () => void;
}) => (
  <div className="flex flex-col h-screen bg-zinc-950 text-white">
    <div className="p-4">
      <button 
        onClick={onBack} 
        className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
        aria-label="Volver"
      >
        <ArrowLeft className="w-5 h-5 text-white" />
      </button>
    </div>

    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mb-6">
        <MessageCircle className="w-8 h-8 text-green-500" />
      </div>

      <h1 className="text-2xl font-bold text-white mb-2">Verificar código</h1>
      <p className="text-zinc-400 text-center mb-8">
        Ingresa el código de 6 dígitos enviado
      </p>

      <div className="flex gap-2 mb-8">
        {otp.map((digit, i) => (
          <input
            key={i}
            id={`otp-${i}`}
            type="text"
            maxLength={1}
            value={digit}
            onChange={(e) => onOtpChange(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            aria-label={`Dígito ${i + 1}`}
            className="w-12 h-14 bg-zinc-900 border border-zinc-800 rounded-lg text-center text-2xl font-bold text-yellow-500 focus:border-yellow-500 focus:outline-none"
          />
        ))}
      </div>

      <div className="text-center mb-8">
        <p className="text-zinc-500 text-sm mb-2">¿No recibiste el código?</p>
        <button onClick={onResend} className="text-yellow-500 font-semibold hover:underline">
          Reenviar código
        </button>
      </div>

      <Button 
        className="w-full max-w-sm h-12 bg-yellow-600 hover:bg-yellow-700 text-black font-bold"
        onClick={onVerify}
        disabled={isLoading}
      >
        {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Verificar'}
      </Button>
    </div>
  </div>
);

const ProfileScreen = ({
  username,
  setUsername,
  dob,
  setDob,
  agreements,
  setAgreements,
  isLoading,
  onComplete,
  onBack
}: {
  username: string;
  setUsername: (v: string) => void;
  dob: string;
  setDob: (v: string) => void;
  agreements: { legal: boolean, privacy: boolean };
  setAgreements: (v: { legal: boolean, privacy: boolean }) => void;
  isLoading: boolean;
  onComplete: () => void;
  onBack: () => void;
}) => (
  <div className="flex flex-col h-screen bg-zinc-950 text-white p-8">
    <div className="flex items-center gap-4 mb-8">
      <div className="w-20 h-20 bg-zinc-900 border border-zinc-800 rounded-full flex items-center justify-center relative group overflow-hidden">
        <User className="w-10 h-10 text-zinc-700" />
      </div>
      <div>
        <h2 className="text-xl font-bold">Completa tu perfil</h2>
        <p className="text-zinc-500 text-sm italic">Tu identidad en TakTak</p>
      </div>
    </div>

    <div className="space-y-6 flex-1">
      <div className="space-y-2">
        <label htmlFor="username" className="text-sm font-medium text-zinc-400 ml-1">Nombre de usuario</label>
        <Input 
          id="username"
          placeholder="@usuario"
          aria-label="Nombre de usuario"
          className="bg-zinc-900 border-zinc-800 h-12"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="dob" className="text-sm font-medium text-zinc-400 ml-1">Fecha de nacimiento</label>
        <Input 
          id="dob"
          type="date"
          aria-label="Fecha de nacimiento"
          className="bg-zinc-900 border-zinc-800 h-12"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
        />
      </div>

      <div className="space-y-4 pt-4">
        <label className="flex items-start gap-3 cursor-pointer group">
          <input 
            type="checkbox" 
            checked={agreements.legal}
            onChange={(e) => setAgreements({ ...agreements, legal: e.target.checked })}
            className="mt-1 w-5 h-5 rounded border-zinc-800 bg-zinc-900 text-yellow-500 focus:ring-yellow-500" 
          />
          <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">
            Acepto los términos y condiciones de uso de TakTak.
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer group">
          <input 
            type="checkbox" 
            checked={agreements.privacy}
            onChange={(e) => setAgreements({ ...agreements, privacy: e.target.checked })}
            className="mt-1 w-5 h-5 rounded border-zinc-800 bg-zinc-900 text-yellow-500 focus:ring-yellow-500" 
          />
          <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">
            He leído y acepto la política de privacidad de datos P2P.
          </span>
        </label>
      </div>
    </div>

    <div className="mt-8 space-y-3">
      <Button 
        className="w-full h-12 bg-yellow-600 hover:bg-yellow-700 text-black font-bold"
        onClick={onComplete}
        disabled={isLoading}
      >
        {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <><Check className="w-4 h-4 mr-2" /> Completar</>}
      </Button>
      <Button variant="ghost" className="w-full text-zinc-500" onClick={onBack}>
        Volver
      </Button>
    </div>
  </div>
);

const SecurityScreen = ({
  recoveryPhrase,
  securityQuestion,
  setSecurityQuestion,
  securityAnswer,
  setSecurityAnswer,
  isLoading,
  onComplete
}: {
  recoveryPhrase: string;
  securityQuestion: string;
  setSecurityQuestion: (v: string) => void;
  securityAnswer: string;
  setSecurityAnswer: (v: string) => void;
  isLoading: boolean;
  onComplete: () => void;
}) => {
  const words = recoveryPhrase.split(' ');
  const [copied, setCopied] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(recoveryPhrase);
    setCopied(true);
    toast.success('¡Frase de recuperación copiada!');
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="flex flex-col h-screen bg-black text-white p-6 overflow-y-auto">
      <div className="flex items-center gap-3 mb-6">
        <Shield className="w-8 h-8 text-cyan-400" />
        <div>
          <h2 className="text-xl font-bold">Seguridad Web3</h2>
          <p className="text-zinc-500 text-sm">Respalda tu cuenta de forma descentralizada</p>
        </div>
      </div>

      <div className="bg-zinc-900 border border-red-500/30 rounded-xl p-4 mb-6">
        <h3 className="text-red-400 font-bold mb-2 flex items-center gap-2">
          <span>⚠️</span> Frase de Recuperación (12 Palabras)
        </h3>
        <p className="text-xs text-zinc-400 mb-4">
          Copia estas 12 palabras en un papel seguro. Si las pierdes y estás inactivo, perderás tus fondos. No las compartas con nadie.
        </p>
        
        <div className="grid grid-cols-3 gap-2 mb-4">
          {words.map((word, i) => (
            <div key={i} className="bg-black/50 border border-zinc-800 rounded p-2 text-center flex flex-col">
              <span className="text-[9px] text-zinc-600 font-mono">{i + 1}</span>
              <span className="text-sm font-semibold text-cyan-50">{word}</span>
            </div>
          ))}
        </div>

        <Button 
          variant="outline" 
          className={`w-full bg-zinc-800 border-zinc-700 ${copied ? 'text-green-400 border-green-500/50' : 'text-zinc-300'}`}
          onClick={handleCopy}
        >
          {copied ? '¡Copiado!' : 'Copiar al portapapeles'}
        </Button>
      </div>

      <div className="space-y-4 mb-8">
        <h3 className="text-sm font-bold text-zinc-300">Pregunta de Seguridad</h3>
        
        <div className="space-y-2">
          <label className="text-xs text-zinc-500">Selecciona o escribe una pregunta</label>
          <select 
            aria-label="Pregunta de seguridad"
            className="w-full h-12 bg-zinc-900 border border-zinc-800 rounded-md px-3 text-sm text-white focus:outline-none focus:border-cyan-500"
            value={securityQuestion}
            onChange={(e) => setSecurityQuestion(e.target.value)}
          >
            <option>¿Cuál es el nombre de tu primera mascota?</option>
            <option>¿Cuál es la ciudad donde naciste?</option>
            <option>¿Cuál era el apodo de tu infancia?</option>
            <option>Otra (personalizada...)</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-zinc-500">Respuesta</label>
          <div className="relative">
            <Input 
              type={showAnswer ? "text" : "password"}
              placeholder="Tu respuesta secreta"
              className="bg-zinc-900 border-zinc-800 h-12 pr-12 text-white"
              value={securityAnswer}
              onChange={(e) => setSecurityAnswer(e.target.value)}
            />
            <button 
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
              onClick={() => setShowAnswer(!showAnswer)}
            >
              {showAnswer ? '🙈' : '👁️'}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-auto pb-4">
        <Button 
          className="w-full h-12 bg-cyan-600 hover:bg-cyan-700 font-bold"
          onClick={onComplete}
          disabled={isLoading || securityAnswer.length < 2 || !copied}
        >
          {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Finalizar y Entrar'}
        </Button>
        {!copied && <p className="text-[10px] text-center text-red-400 mt-2">Debes copiar la frase antes de continuar</p>}
      </div>
    </div>
  );
};

