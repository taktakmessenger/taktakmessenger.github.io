import { useState, useEffect } from 'react';
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
  const [password, setPassword] = useState('');
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
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [newResetPassword, setNewResetPassword] = useState('');

  useEffect(() => {
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
  }, []);

  const handleIdentitySubmit = async () => {
    if (!phone.trim()) {
      toast.error('Ingresa tu teléfono o correo');
      return;
    }
    setIsLoading(true);
    setDebugOtp(null);
    
    const fullIdentifier = phone.includes('@') ? phone : (phone.startsWith('+') ? phone : countryCode + phone);
    
    try {
      // If password provided, try login-password first
      if (password.trim()) {
        try {
          const response = await authApi.loginWithPassword(fullIdentifier, password);
          const data = response?.data;
          if (data?.token && data?.user) {
            localStorage.setItem('taktak_token', data.token);
            login(data.user);
            toast.success(`¡Bienvenido de nuevo, ${data.user.username}!`);
            return;
          }
        } catch (err: unknown) {
          const error = err as { response?: { status: number, data?: { error: string } } };
          if (error.response?.status === 401 || error.response?.status === 404) {
            toast.error(error.response?.data?.error || 'Credenciales incorrectas');
            setIsLoading(false);
            return;
          }
          console.error("Password login error:", err);
        }
      }

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
      if (isResettingPassword) {
        if (newResetPassword.length < 6) {
          toast.error('La nueva contraseña debe tener al menos 6 caracteres');
          setIsLoading(false);
          return;
        }
        await authApi.resetPassword(fullIdentifier, otpCode, newResetPassword);
        toast.success('¡Contraseña restablecida! Ahora puedes iniciar sesión.');
        setStep('phone');
        setIsResettingPassword(false);
        setNewResetPassword('');
        return;
      }
      const response = await authApi.verify(fullIdentifier, otpCode);
      const { user, token } = response.data || {};
      
      if (!user) {
        throw new Error("Respuesta del servidor inválida.");
      }

      localStorage.setItem('taktak_token', token);
      
      if (!user.username || user.username.startsWith('pending_')) {
        setStep('profile');
      } else {
        login(user);
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
      await authApi.updateProfile({ 
        username, 
        dob, 
        legalAccepted: agreements.legal, 
        privacyAccepted: agreements.privacy 
      });
      
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

  const handleRecover = async (identifier: string, phrase: string, answer?: string) => {
    if (!identifier) {
      toast.error('Por favor ingresa tu identificador (teléfono o correo)');
      return;
    }
    setIsLoading(true);
    try {
      const fullIdentifier = identifier.includes('@') ? identifier : (identifier.startsWith('+') ? identifier : countryCode + identifier);
      const response = await authApi.recoverAccount({ 
        identifier: fullIdentifier, 
        recoveryPhrase: phrase, 
        securityAnswer: answer 
      });
      const { user, token } = response.data;
      localStorage.setItem('taktak_token', token);
      login(user); // user ya contiene la info de la cuenta
      toast.success(`¡Bienvenido de vuelta, ${user.username}!`);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error: string } } };
      toast.error(error.response?.data?.error || 'Frase o respuesta incorrecta');
    } finally {
      setIsLoading(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'recovery':
        return <RecoveryScreen 
          onBack={() => setStep('phone')} 
          onRecover={handleRecover}
          onSwitchToQuestion={() => setStep('recovery_question')}
          isLoading={isLoading}
        />;
      case 'recovery_question':
        return <RecoveryQuestionScreen
          onBack={() => setStep('recovery')}
          onRecover={handleRecover}
          isLoading={isLoading}
        />;
      case 'phone':
        return <PhoneScreen 
          phone={phone} 
          setPhone={setPhone}
          password={password}
          setPassword={setPassword}
          countryCode={countryCode}
          setCountryCode={setCountryCode}
          referredByCode={referredByCode}
          setReferredByCode={setReferredByCode}
          isLoading={isLoading}
          onContinue={handleIdentitySubmit}
          mode={mode === 'recovery' ? 'signup' : mode}
          setIsResettingPassword={setIsResettingPassword}
          setStep={setStep}
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
              isResettingPassword={isResettingPassword}
              newResetPassword={newResetPassword}
              setNewResetPassword={setNewResetPassword}
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

const RecoveryScreen = ({ onBack, onRecover, onSwitchToQuestion, isLoading }: { onBack: () => void, onRecover: (id: string, phrase: string) => void, onSwitchToQuestion: () => void, isLoading?: boolean }) => {
  const [identifier, setIdentifier] = useState('');
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

  return (
    <div className="flex flex-col h-screen bg-black text-white p-6 overflow-y-auto">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="p-2 hover:bg-zinc-800 rounded-full transition-colors"><ArrowLeft className="w-6 h-6" /></button>
        <h2 className="text-xl font-bold">Recuperar Cuenta</h2>
      </div>

      <div className="space-y-6 max-w-md mx-auto w-full">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-400">Teléfono o Correo</label>
          <Input 
            placeholder="Ej: +584121234567 o email@ejemplo.com"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className="bg-zinc-900 border-zinc-800 h-12"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-400">Frase de Recuperación (12 palabras)</label>
          <div className="grid grid-cols-3 gap-2" onPaste={handlePaste}>
            {recoveryWords.map((word, i) => (
              <Input
                key={i}
                placeholder={String(i + 1)}
                value={word}
                onChange={(e) => handleWordChange(i, e.target.value)}
                className="bg-zinc-900 border-zinc-800 h-10 text-center text-sm"
              />
            ))}
          </div>
        </div>

        <Button 
          className="w-full h-12 bg-yellow-600 hover:bg-yellow-500 text-black font-bold"
          onClick={() => onRecover(identifier, recoveryWords.join(' '))}
          disabled={isLoading || recoveryWords.some(w => !w) || !identifier}
        >
          {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Recuperar con Frase'}
        </Button>

        <div className="relative py-4">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-zinc-800"></div></div>
          <div className="relative flex justify-center text-xs uppercase"><span className="bg-black px-2 text-zinc-500">O usa tu pregunta</span></div>
        </div>

        <Button variant="outline" className="w-full border-zinc-800 text-zinc-400" onClick={onSwitchToQuestion}>
          Responder Pregunta de Seguridad
        </Button>
      </div>
    </div>
  );
};

const RecoveryQuestionScreen = ({ onBack, onRecover, isLoading }: { onBack: () => void, onRecover: (id: string, phrase: string, answer: string) => void, isLoading?: boolean }) => {
  const [phoneOrEmail, setPhoneOrEmail] = useState('');
  const [answer, setAnswer] = useState('');

  return (
    <div className="flex flex-col h-screen bg-black text-white p-8">
      <div className="flex items-center gap-4 mb-10">
        <button onClick={onBack} className="p-2 hover:bg-zinc-800 rounded-full transition-colors"><ArrowLeft className="w-6 h-6" /></button>
        <h2 className="text-xl font-bold uppercase tracking-tight">Pregunta de Seguridad</h2>
      </div>

      <div className="space-y-8 max-w-sm mx-auto w-full">
        <div className="space-y-3">
          <label className="text-xs font-black text-zinc-500 uppercase ml-1">Tu Identificador</label>
          <Input 
            placeholder="Teléfono o Correo"
            value={phoneOrEmail}
            onChange={(e) => setPhoneOrEmail(e.target.value)}
            className="bg-zinc-900/50 border-zinc-800 h-14 rounded-2xl text-lg placeholder:text-zinc-700"
          />
        </div>

        <div className="space-y-3">
          <label className="text-xs font-black text-zinc-500 uppercase ml-1">Tu Respuesta Secreta</label>
          <Input 
            type="password"
            placeholder="Escribe tu respuesta aquí"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            className="bg-zinc-900/50 border-zinc-800 h-14 rounded-2xl text-lg placeholder:text-zinc-700"
          />
        </div>

        <Button 
          disabled={!answer || !phoneOrEmail || isLoading}
          onClick={() => onRecover(phoneOrEmail, '', answer)}
          className="w-full h-14 bg-yellow-600 hover:bg-yellow-500 text-black font-black text-lg rounded-2xl shadow-[0_10px_30px_rgba(234,179,8,0.2)]"
        >
          {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Validar Respuesta'}
        </Button>
      </div>
    </div>
  );
};

const PhoneScreen = ({
  phone,
  setPhone,
  password,
  setPassword,
  countryCode,
  setCountryCode,
  referredByCode,
  setReferredByCode,
  isLoading,
  onContinue,
  mode,
  setIsResettingPassword,
  setStep
}: {
  phone: string;
  setPhone: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  countryCode: string;
  setCountryCode: (v: string) => void;
  referredByCode: string;
  setReferredByCode: (v: string) => void;
  isLoading: boolean;
  onContinue: () => void;
  mode: 'login' | 'signup';
  setIsResettingPassword: (v: boolean) => void;
  setStep: (v: AuthStep) => void;
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

      <div className="w-full max-w-md space-y-4 mb-8">
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

        <div className={cn(
          "flex items-center bg-zinc-900/30 border border-zinc-800/80 rounded-2xl backdrop-blur-xl transition-all focus-within:border-yellow-500/40 focus-within:ring-1 focus-within:ring-yellow-500/10",
          "h-16 px-1 shadow-[0_0_20px_rgba(0,0,0,0.5)]"
        )}>
          <div className="flex-1 flex items-center gap-3 px-4 h-full">
            <Shield className="w-5 h-5 text-zinc-600" />
            <Input 
              type="password"
              placeholder="Tu contraseña (opcional para OTP)"
              className="bg-transparent border-none focus:ring-0 text-white h-full p-0 text-lg placeholder:text-zinc-700"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>

        {mode === 'login' && (
          <div className="flex justify-center pt-1">
            <button 
              onClick={async () => {
                const fullIdentifier = phone.includes('@') ? phone : (phone.startsWith('+') ? phone : countryCode + phone);
                if (!phone.trim()) { toast.error('Ingresa tu teléfono o correo primero'); return; }
                try {
                  await authApi.login(fullIdentifier);
                  toast.success('Código de recuperación enviado.');
                  setIsResettingPassword(true);
                  setStep('otp');
                } catch (err: unknown) {
                  const error = err as { response?: { data?: { error?: string } } };
                  toast.error(error?.response?.data?.error || 'Error al enviar código');
                }
              }}
              className="text-zinc-500 hover:text-white text-xs transition-colors"
            >
              ¿Olvidaste tu contraseña? Restablecer por correo
            </button>
          </div>
        )}
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
  onBack,
  isResettingPassword,
  newResetPassword,
  setNewResetPassword
}: {
  otp: string[];
  isLoading: boolean;
  onOtpChange: (i: number, v: string) => void;
  onKeyDown: (i: number, e: React.KeyboardEvent) => void;
  onVerify: () => void;
  onResend: () => void;
  onBack: () => void;
  isResettingPassword?: boolean;
  newResetPassword?: string;
  setNewResetPassword?: (v: string) => void;
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

      {isResettingPassword && (
        <div className="w-full max-w-sm space-y-2 mb-8">
          <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider ml-1">Nueva Contraseña</label>
          <div className="relative">
            <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
            <Input 
              type="password"
              value={newResetPassword}
              onChange={e => setNewResetPassword && setNewResetPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              className="bg-zinc-900 border-zinc-800 h-14 text-white pl-10 focus:border-yellow-500/50 text-lg"
            />
          </div>
        </div>
      )}

      <div className="text-center mb-8">
        <p className="text-zinc-500 text-sm mb-2">¿No recibiste el código?</p>
        <button onClick={onResend} className="text-yellow-500 font-semibold hover:underline">
          Reenviar código
        </button>
      </div>

      <Button 
        className="w-full max-w-sm h-14 bg-yellow-600 hover:bg-yellow-700 text-black font-bold text-lg rounded-2xl shadow-[0_10px_30px_rgba(234,179,8,0.2)]"
        onClick={onVerify}
        disabled={isLoading}
      >
        {isLoading ? <RefreshCw className="w-6 h-6 animate-spin" /> : 'Verificar'}
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
  <div className="flex flex-col h-screen bg-zinc-950 text-white p-8 overflow-y-auto">
    <div className="flex items-center gap-4 mb-8">
      <div className="w-20 h-20 bg-zinc-900 border border-zinc-800 rounded-full flex items-center justify-center relative group overflow-hidden">
        <User className="w-10 h-10 text-zinc-700" />
      </div>
      <div>
        <h2 className="text-xl font-bold uppercase tracking-tight">Completa tu perfil</h2>
        <p className="text-zinc-500 text-xs italic">Tu identidad en la red TakTak</p>
      </div>
    </div>

    <div className="space-y-6 flex-1">
      <div className="space-y-2">
        <label htmlFor="username" className="text-xs font-black text-zinc-500 uppercase ml-1">Nombre de usuario</label>
        <Input 
          id="username"
          placeholder="@usuario"
          className="bg-zinc-900/50 border-zinc-800 h-14 rounded-2xl text-lg"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="dob" className="text-xs font-black text-zinc-500 uppercase ml-1">Fecha de nacimiento</label>
        <Input 
          id="dob"
          type="date"
          className="bg-zinc-900/50 border-zinc-800 h-14 rounded-2xl text-lg text-white"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
        />
      </div>

      <div className="space-y-4 pt-4">
        <label className="flex items-start gap-4 cursor-pointer group">
          <input 
            type="checkbox" 
            checked={agreements.legal}
            onChange={(e) => setAgreements({ ...agreements, legal: e.target.checked })}
            className="mt-1 w-6 h-6 rounded-lg border-zinc-800 bg-zinc-900 text-yellow-500 focus:ring-yellow-500 transition-all" 
          />
          <span className="text-xs text-zinc-400 group-hover:text-zinc-300 leading-tight">
            Acepto los Términos y Condiciones de uso de TakTak y confirmo que soy mayor de edad.
          </span>
        </label>

        <label className="flex items-start gap-4 cursor-pointer group">
          <input 
            type="checkbox" 
            checked={agreements.privacy}
            onChange={(e) => setAgreements({ ...agreements, privacy: e.target.checked })}
            className="mt-1 w-6 h-6 rounded-lg border-zinc-800 bg-zinc-900 text-yellow-500 focus:ring-yellow-500 transition-all" 
          />
          <span className="text-xs text-zinc-400 group-hover:text-zinc-300 leading-tight">
            He leído y acepto la Política de Privacidad y el manejo de mis datos de forma descentralizada.
          </span>
        </label>
      </div>
    </div>

    <div className="mt-8 space-y-4">
      <Button 
        className="w-full h-14 bg-yellow-600 hover:bg-yellow-700 text-black font-black text-lg rounded-2xl shadow-[0_10px_30px_rgba(234,179,8,0.2)]"
        onClick={onComplete}
        disabled={isLoading}
      >
        {isLoading ? <RefreshCw className="w-6 h-6 animate-spin" /> : 'Completar Perfil'}
      </Button>
      <Button variant="ghost" className="w-full text-zinc-600 hover:text-white" onClick={onBack}>
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
        <Shield className="w-10 h-10 text-yellow-500" />
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter">Seguridad P2P</h2>
          <p className="text-zinc-500 text-xs italic">Respalda tu cuenta de forma descentralizada</p>
        </div>
      </div>

      <div className="bg-zinc-900/50 border border-yellow-500/20 rounded-3xl p-6 mb-8 backdrop-blur-xl">
        <h3 className="text-yellow-500 font-black mb-2 flex items-center gap-2 uppercase text-sm">
          <span>⚠️</span> Frase de Recuperación
        </h3>
        <p className="text-[10px] text-zinc-500 mb-6 leading-relaxed">
          Copia estas 12 palabras en un lugar físico seguro. Si pierdes tu acceso y la frase, TakTak no podrá recuperar tus datos ni fondos.
        </p>
        
        <div className="grid grid-cols-2 gap-3 mb-6">
          {words.map((word, i) => (
            <div key={i} className="bg-black/40 border border-zinc-800 rounded-2xl p-3 flex items-center gap-3">
              <span className="text-[10px] text-zinc-700 font-black">{i + 1}</span>
              <span className="text-sm font-bold text-white tracking-tight">{word}</span>
            </div>
          ))}
        </div>

        <Button 
          variant="outline" 
          className={`w-full h-12 bg-zinc-900 border-zinc-800 rounded-2xl ${copied ? 'text-green-500 border-green-500/30' : 'text-zinc-400 hover:text-white'}`}
          onClick={handleCopy}
        >
          {copied ? '¡FRASE COPIADA!' : 'COPIAR AL PORTAPAPELES'}
        </Button>
      </div>

      <div className="space-y-6 mb-10">
        <h3 className="text-xs font-black text-zinc-500 uppercase ml-1 tracking-widest">Pregunta de Seguridad</h3>
        
        <div className="space-y-3">
          <label className="text-[10px] font-bold text-zinc-600 uppercase ml-1">Selecciona una pregunta</label>
          <select 
            className="w-full h-14 bg-zinc-900/50 border border-zinc-800 rounded-2xl px-4 text-sm text-white focus:outline-none focus:border-yellow-500/50 appearance-none"
            value={securityQuestion}
            onChange={(e) => setSecurityQuestion(e.target.value)}
          >
            <option>¿Cuál es el nombre de tu primera mascota?</option>
            <option>¿Cuál es la ciudad donde naciste?</option>
            <option>¿Cuál era el apodo de tu infancia?</option>
            <option>¿Nombre de tu escuela primaria?</option>
          </select>
        </div>

        <div className="space-y-3">
          <label className="text-[10px] font-bold text-zinc-600 uppercase ml-1">Tu Respuesta Secreta</label>
          <div className="relative">
            <Input 
              type={showAnswer ? "text" : "password"}
              placeholder="Tu respuesta secreta"
              className="bg-zinc-900/50 border border-zinc-800 h-14 rounded-2xl pr-14 text-white text-lg"
              value={securityAnswer}
              onChange={(e) => setSecurityAnswer(e.target.value)}
            />
            <button 
              className="absolute right-5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-white text-xl"
              onClick={() => setShowAnswer(!showAnswer)}
            >
              {showAnswer ? '🙈' : '👁️'}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-auto pb-4">
        <Button 
          className="w-full h-16 bg-yellow-600 hover:bg-yellow-700 text-black font-black text-xl rounded-2xl shadow-[0_15px_40px_rgba(234,179,8,0.3)]"
          onClick={onComplete}
          disabled={isLoading || securityAnswer.length < 2 || !copied}
        >
          {isLoading ? <RefreshCw className="w-8 h-8 animate-spin" /> : 'FINALIZAR REGISTRO'}
        </Button>
        {!copied && <p className="text-[10px] text-center text-red-500/70 mt-3 font-bold uppercase tracking-widest">Primero debes copiar tu frase de seguridad</p>}
      </div>
    </div>
  );
};
