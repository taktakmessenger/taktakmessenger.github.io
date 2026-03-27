import { useState } from 'react';
import {
  ArrowLeft, Smartphone, MessageCircle, Shield, Lock,
  RefreshCw, User, Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { PrivacyPolicy } from './PrivacyPolicy';
import { TermsOfService } from './TermsOfService';
import { authApi } from '@/services/api';

type AuthStep = 'welcome' | 'phone' | 'otp' | 'profile' | 'security' | 'privacy' | 'terms';

export const AuthView = ({ initialStep = 'welcome' }: { initialStep?: AuthStep }) => {
  const [step, setStep] = useState<AuthStep>(initialStep);
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

  const handleSendOTP = async () => {
    if (phone.length < 10) {
      toast.error('Ingresa un número válido');
      return;
    }
    setIsLoading(true);
    try {
      await authApi.login(phone).catch(() => authApi.register({ 
        phone, 
        username: 'pending_' + Date.now(),
        dob: '2000-01-01',
        legalAccepted: true, 
        privacyAccepted: true,
        referredByCode
      }));
      
      setStep('otp');
      toast.success(`Código enviado al +58 ${phone}`);
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
    try {
      const response = await authApi.verify(phone, otpCode);
      const { user, token } = response.data;
      
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
      case 'welcome':
        return <WelcomeScreen 
          onPhone={() => setStep('phone')} 
          onTerms={() => setStep('terms')}
          onPrivacy={() => setStep('privacy')}
        />;
      case 'phone':
        return <PhoneScreen 
          phone={phone} 
          setPhone={setPhone}
          referredByCode={referredByCode}
          setReferredByCode={setReferredByCode}
          isLoading={isLoading}
          onContinue={handleSendOTP}
          onBack={() => setStep('welcome')}
        />;
      case 'otp':
        return <OTPScreen 
          otp={otp}
          isLoading={isLoading}
          onOtpChange={handleOTPChange}
          onKeyDown={handleKeyDown}
          onVerify={handleVerifyOTP}
          onResend={handleResendOTP}
          onBack={() => setStep('phone')}
        />;
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
        return <TermsOfService onBack={() => setStep('welcome')} />;
      case 'privacy':
        return <PrivacyPolicy onBack={() => setStep('welcome')} />;
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

const WelcomeScreen = ({ onPhone, onTerms, onPrivacy }: { onPhone: () => void, onTerms: () => void, onPrivacy: () => void }) => (
  <div className="flex flex-col items-center justify-center h-screen p-8 text-center bg-zinc-950">
    <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-yellow-600 via-yellow-500 to-amber-400 flex items-center justify-center text-4xl font-black text-black mb-8 shadow-[0_0_30px_rgba(234,179,8,0.3)]">
      T
    </div>
    
    <h1 className="text-4xl font-black text-white mb-2 tracking-tighter">TakTak</h1>
    <p className="text-zinc-400 mb-12">P2P Video Network & Economy</p>

    <div className="w-full space-y-3 max-w-sm mb-12">
      <button 
        className="w-full flex items-center gap-3 p-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:bg-zinc-800 transition-all font-medium text-white group"
        onClick={() => {}}
        aria-label="Continuar con WhatsApp"
      >
        <MessageCircle className="w-6 h-6 text-green-500 group-hover:scale-110 transition-transform" />
        <span className="flex-1 text-left">Continuar con WhatsApp</span>
        <Check className="w-4 h-4 text-zinc-500" />
      </button>

      <button 
        className="w-full flex items-center gap-3 p-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:bg-zinc-800 transition-all font-medium text-white group"
        onClick={() => {}}
        aria-label="Continuar con Google"
      >
        <Shield className="w-6 h-6 text-blue-500 group-hover:scale-110 transition-transform" />
        <span className="flex-1 text-left">Continuar con Google</span>
      </button>

      <button 
        className="w-full flex items-center gap-3 p-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:bg-zinc-800 transition-all font-medium text-white group outline-none focus:ring-2 focus:ring-yellow-500"
        onClick={onPhone}
        aria-label="Usar teléfono o correo"
      >
        <Smartphone className="w-6 h-6 text-yellow-500 group-hover:scale-110 transition-transform" />
        <span className="flex-1 text-left">Usar teléfono / Correo</span>
      </button>
    </div>

    <div className="space-y-4 max-w-xs mx-auto">
      <div className="flex items-center gap-2 p-3 bg-zinc-900/50 rounded-lg border border-yellow-500/20">
        <Lock className="w-5 h-5 text-yellow-500" />
        <p className="text-[10px] text-zinc-400 text-left leading-tight">
          Tu cuenta está protegida por encriptación P2P y seguridad biométrica avanzada.
        </p>
      </div>

      <p className="text-[10px] text-zinc-600 leading-relaxed">
        Al continuar, aceptas nuestros{' '}
        <button onClick={onTerms} className="text-zinc-400 hover:underline">Términos de servicio</button> y confirmas que has leído nuestra{' '}
        <button onClick={onPrivacy} className="text-zinc-400 hover:underline">Política de privacidad</button>.
      </p>
    </div>
    
    <div className="mt-12">
      <Button variant="ghost" className="text-zinc-500 hover:text-white">
        Ingresar como invitado
      </Button>
    </div>
  </div>
);

const PhoneScreen = ({
  phone,
  setPhone,
  referredByCode,
  setReferredByCode,
  isLoading,
  onContinue,
  onBack
}: {
  phone: string;
  setPhone: (v: string) => void;
  referredByCode: string;
  setReferredByCode: (v: string) => void;
  isLoading: boolean;
  onContinue: () => void;
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
      <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mb-6">
        <Smartphone className="w-8 h-8 text-yellow-500" />
      </div>

      <h1 className="text-2xl font-bold text-white mb-2">Ingresa tu número</h1>
      <p className="text-zinc-400 text-center mb-8">
        Te enviaremos un código de verificación SMS
      </p>

      <div className="flex items-center gap-2 mb-4 p-3 bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-sm">
        <span className="text-2xl">🇻🇪</span>
        <span className="text-white">+58</span>
        <span className="text-zinc-500">|</span>
        <span className="text-zinc-400">Venezuela</span>
      </div>

      <div className="w-full max-w-sm mb-4">
        <Input 
          type="tel"
          placeholder="Número de teléfono"
          aria-label="Número de teléfono"
          className="bg-zinc-900 border-zinc-800 focus:border-yellow-500 text-white h-12 text-lg text-center tracking-widest"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      <div className="w-full max-w-sm mb-6">
        <Input 
          type="text"
          placeholder="Código de Invitado (Opcional)"
          aria-label="Código de Invitado"
          className="bg-zinc-900 border-zinc-800 focus:border-yellow-500 text-zinc-400 h-12 text-center"
          value={referredByCode}
          onChange={(e) => setReferredByCode(e.target.value)}
        />
      </div>

      <Button 
        className="w-full max-w-sm h-12 bg-yellow-600 hover:bg-yellow-700 text-black font-bold"
        onClick={onContinue}
        disabled={isLoading}
      >
        {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Siguiente'}
      </Button>
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

