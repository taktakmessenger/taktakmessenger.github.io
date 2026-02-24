import { useState } from 'react';
import {
  ArrowLeft, Smartphone, MessageCircle, Shield, Lock,
  Eye, EyeOff, Send, Check, RefreshCw, User, Phone
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStore, ADMIN_ACCOUNTS } from '@/store/useStore';
import { toast } from 'sonner';

type AuthStep = 'welcome' | 'phone' | 'otp' | 'profile' | 'security';

export const AuthView = () => {
  const [step, setStep] = useState<AuthStep>('welcome');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  const [username, setUsername] = useState('');
  
  const { login } = useStore();

  const isAdminEmail = (e: string) => ADMIN_ACCOUNTS.includes(e.toLowerCase());

  const handleSendOTP = () => {
    if (phone.length < 10) {
      toast.error('Ingresa un número válido');
      return;
    }
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setStep('otp');
      toast.success(`Código enviado al +${phone}`);
    }, 1500);
  };

  const handleVerifyOTP = () => {
    const otpCode = otp.join('');
    if (otpCode.length < 6) {
      toast.error('Ingresa el código completo');
      return;
    }
    if (otpCode !== '123456') {
      toast.error('Código incorrecto. Usa 123456 para prueba');
      return;
    }
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setStep('profile');
    }, 1000);
  };

  const handleCompleteProfile = () => {
    if (!username.trim()) {
      toast.error('Ingresa un nombre de usuario');
      return;
    }
    setIsLoading(true);
    setTimeout(() => {
      const isOwner = isAdminEmail(email);
      const user = {
        id: Date.now().toString(),
        username: username,
        email: email,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
        phone: phone,
        followers: 0,
        following: 0,
        likes: 0,
        bio: '',
        isVerified: true,
        isAdmin: isOwner,
        isOwner: isOwner
      };
      login(user);
      setIsLoading(false);
      if (isOwner) {
        toast.success('¡Bienvenido Administrador! 👑');
      } else {
        toast.success('¡Bienvenido a TakTak Messenger!');
      }
    }, 1000);
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

  switch (step) {
    case 'welcome':
      return <WelcomeScreen onStart={() => setStep('phone')} />;
    case 'phone':
      return (
        <PhoneScreen
          phone={phone}
          setPhone={setPhone}
          email={email}
          setEmail={setEmail}
          showPhone={showPhone}
          setShowPhone={setShowPhone}
          isLoading={isLoading}
          onContinue={handleSendOTP}
          onBack={() => setStep('welcome')}
        />
      );
    case 'otp':
      return (
        <OTPScreen
          phone={phone}
          otp={otp}
          isLoading={isLoading}
          onChange={handleOTPChange}
          onKeyDown={handleKeyDown}
          onVerify={handleVerifyOTP}
          onResend={handleResendOTP}
          onBack={() => setStep('phone')}
        />
      );
    case 'profile':
      return (
        <ProfileScreen
          username={username}
          setUsername={setUsername}
          isLoading={isLoading}
          onComplete={handleCompleteProfile}
        />
      );
    default:
      return null;
  }
};

const WelcomeScreen = ({ onStart }: { onStart: () => void }) => (
  <div className="flex flex-col h-screen bg-[#0a0a0a]">
    {/* Header */}
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      {/* Logo */}
      <div className="w-24 h-24 bg-gradient-to-br from-[#25d366] to-[#128c7e] rounded-full flex items-center justify-center mb-8">
        <MessageCircle className="w-12 h-12 text-white" />
      </div>

      <h1 className="text-3xl font-bold text-white mb-2">TakTak</h1>
      <p className="text-zinc-400 text-center mb-8">Tu messenger seguro y privado</p>

      {/* Features */}
      <div className="space-y-4 w-full max-w-sm">
        <div className="flex items-center gap-4 p-4 bg-zinc-900 rounded-xl">
          <div className="w-10 h-10 bg-[#25d366]/20 rounded-full flex items-center justify-center">
            <Shield className="w-5 h-5 text-[#25d366]" />
          </div>
          <div>
            <p className="text-white font-medium">Encriptación E2E</p>
            <p className="text-zinc-500 text-sm">Tus mensajes seguros</p>
          </div>
        </div>

        <div className="flex items-center gap-4 p-4 bg-zinc-900 rounded-xl">
          <div className="w-10 h-10 bg-[#25d366]/20 rounded-full flex items-center justify-center">
            <Smartphone className="w-5 h-5 text-[#25d366]" />
          </div>
          <div>
            <p className="text-white font-medium">Multi-dispositivo</p>
            <p className="text-zinc-500 text-sm">Usa en teléfono y PC</p>
          </div>
        </div>

        <div className="flex items-center gap-4 p-4 bg-zinc-900 rounded-xl">
          <div className="w-10 h-10 bg-[#25d366]/20 rounded-full flex items-center justify-center">
            <Lock className="w-5 h-5 text-[#25d366]" />
          </div>
          <div>
            <p className="text-white font-medium">Privacidad total</p>
            <p className="text-zinc-500 text-sm">Sin rastreo ni publicidad</p>
          </div>
        </div>
      </div>
    </div>

    {/* Footer */}
    <div className="p-6">
      <Button
        onClick={onStart}
        className="w-full bg-[#25d366] hover:bg-[#128c7e] text-white py-4 text-lg"
      >
        Aceptar y continuar
      </Button>
      <p className="text-zinc-500 text-xs text-center mt-4">
        Al continuar, aceptas nuestros Términos y Política de Privacidad
      </p>
    </div>
  </div>
);

const PhoneScreen = ({
  phone,
  setPhone,
  email,
  setEmail,
  showPhone,
  setShowPhone,
  isLoading,
  onContinue,
  onBack
}: {
  phone: string;
  setPhone: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  showPhone: boolean;
  setShowPhone: (v: boolean) => void;
  isLoading: boolean;
  onContinue: () => void;
  onBack: () => void;
}) => (
  <div className="flex flex-col h-screen bg-[#0a0a0a]">
    {/* Header */}
    <div className="p-4">
      <button onClick={onBack} className="p-2 hover:bg-zinc-900 rounded-full">
        <ArrowLeft className="w-5 h-5 text-white" />
      </button>
    </div>

    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="w-16 h-16 bg-[#25d366]/20 rounded-full flex items-center justify-center mb-6">
        <Smartphone className="w-8 h-8 text-[#25d366]" />
      </div>

      <h1 className="text-2xl font-bold text-white mb-2">Ingresa tu número</h1>
      <p className="text-zinc-400 text-center mb-8">
        Te enviaremos un código de verificación SMS
      </p>

      {/* Country Selector */}
      <div className="flex items-center gap-2 mb-4 p-3 bg-zinc-900 rounded-lg w-full max-w-sm">
        <span className="text-2xl">🇻🇪</span>
        <span className="text-white">+58</span>
        <span className="text-zinc-500">|</span>
        <span className="text-zinc-400">Venezuela</span>
      </div>

      {/* Phone Input */}
      <div className="relative w-full max-w-sm">
        <Input
          type={showPhone ? 'text' : 'tel'}
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
          placeholder="4121234567"
          className="bg-zinc-900 border-zinc-800 text-white text-lg py-6 pr-12"
        />
        <button
          onClick={() => setShowPhone(!showPhone)}
          className="absolute right-4 top-1/2 -translate-y-1/2"
        >
          {showPhone ? (
            <EyeOff className="w-5 h-5 text-zinc-500" />
          ) : (
            <Eye className="w-5 h-5 text-zinc-500" />
          )}
        </button>
      </div>

      {/* Email Input (Optional for admin) */}
      <div className="w-full max-w-sm mt-4">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com (opcional)"
          className="bg-zinc-900 border-zinc-800 text-white"
        />
        <p className="text-zinc-500 text-xs mt-1">
          Ingresa tu correo para acceder como administrador
        </p>
      </div>

      <p className="text-zinc-500 text-sm mt-4 text-center">
        ¿Incorrecto? <button className="text-[#25d366]">Cambiar país</button>
      </p>
    </div>

    {/* Footer */}
    <div className="p-6">
      <Button
        onClick={onContinue}
        disabled={isLoading || phone.length < 10}
        className="w-full bg-[#25d366] hover:bg-[#128c7e] text-white py-4 text-lg disabled:opacity-50"
      >
        {isLoading ? (
          <RefreshCw className="w-5 h-5 animate-spin" />
        ) : (
          <>
            Siguiente
            <Send className="w-5 h-5 ml-2" />
          </>
        )}
      </Button>
    </div>
  </div>
);

const OTPScreen = ({
  phone,
  otp,
  isLoading,
  onChange,
  onKeyDown,
  onVerify,
  onResend,
  onBack
}: {
  phone: string;
  otp: string[];
  isLoading: boolean;
  onChange: (i: number, v: string) => void;
  onKeyDown: (i: number, e: React.KeyboardEvent) => void;
  onVerify: () => void;
  onResend: () => void;
  onBack: () => void;
}) => (
  <div className="flex flex-col h-screen bg-[#0a0a0a]">
    {/* Header */}
    <div className="p-4">
      <button onClick={onBack} className="p-2 hover:bg-zinc-900 rounded-full">
        <ArrowLeft className="w-5 h-5 text-white" />
      </button>
    </div>

    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="w-16 h-16 bg-[#25d366]/20 rounded-full flex items-center justify-center mb-6">
        <MessageCircle className="w-8 h-8 text-[#25d366]" />
      </div>

      <h1 className="text-2xl font-bold text-white mb-2">Verificación</h1>
      <p className="text-zinc-400 text-center mb-8">
        Ingresa el código de 6 dígitos enviado al<br />
        <span className="text-white">+58 {phone}</span>
      </p>

      {/* OTP Input */}
      <div className="flex gap-2 mb-8">
        {otp.map((digit, i) => (
          <input
            key={i}
            id={`otp-${i}`}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => onChange(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            className="w-12 h-14 bg-zinc-900 border border-zinc-800 rounded-lg text-white text-center text-xl font-bold focus:border-[#25d366] focus:outline-none"
          />
        ))}
      </div>

      <p className="text-zinc-500 text-sm mb-2">
        ¿No recibiste el código?
      </p>
      <button onClick={onResend} className="text-[#25d366] text-sm mb-4">
        Reenviar código
      </button>

      {/* Demo hint */}
      <p className="text-zinc-600 text-xs bg-zinc-900 px-4 py-2 rounded-lg">
        👀 Para pruebas: usa <strong>123456</strong>
      </p>
    </div>

    {/* Footer */}
    <div className="p-6">
      <Button
        onClick={onVerify}
        disabled={isLoading || otp.join('').length < 6}
        className="w-full bg-[#25d366] hover:bg-[#128c7e] text-white py-4 text-lg disabled:opacity-50"
      >
        {isLoading ? (
          <RefreshCw className="w-5 h-5 animate-spin" />
        ) : (
          <>
            Verificar
            <Check className="w-5 h-5 ml-2" />
          </>
        )}
      </Button>
    </div>
  </div>
);

const ProfileScreen = ({
  username,
  setUsername,
  isLoading,
  onComplete
}: {
  username: string;
  setUsername: (v: string) => void;
  isLoading: boolean;
  onComplete: () => void;
}) => (
  <div className="flex flex-col h-screen bg-[#0a0a0a]">
    {/* Header */}
    <div className="p-4">
      <div className="w-8" />
    </div>

    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-bold text-white mb-2">Crea tu perfil</h1>
      <p className="text-zinc-400 text-center mb-8">
        Este será tu nombre de usuario público
      </p>

      {/* Avatar */}
      <div className="relative mb-8">
        <div className="w-24 h-24 bg-zinc-800 rounded-full flex items-center justify-center">
          <User className="w-10 h-10 text-zinc-500" />
        </div>
        <button className="absolute bottom-0 right-0 w-8 h-8 bg-[#25d366] rounded-full flex items-center justify-center">
          <Phone className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* Username Input */}
      <div className="w-full max-w-sm">
        <label className="text-zinc-400 text-sm mb-2 block">Nombre de usuario</label>
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          placeholder="tu_usuario"
          className="bg-zinc-900 border-zinc-800 text-white text-lg"
        />
        <p className="text-zinc-500 text-xs mt-2">
          TakTak.io/{username || 'tu_usuario'}
        </p>
      </div>
    </div>

    {/* Footer */}
    <div className="p-6">
      <Button
        onClick={onComplete}
        disabled={isLoading || !username.trim()}
        className="w-full bg-[#25d366] hover:bg-[#128c7e] text-white py-4 text-lg disabled:opacity-50"
      >
        {isLoading ? (
          <RefreshCw className="w-5 h-5 animate-spin" />
        ) : (
          'Completar registro'
        )}
      </Button>
    </div>
  </div>
);
