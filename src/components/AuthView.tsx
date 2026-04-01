import { useState } from 'react';
import {
  ArrowLeft, MessageCircle, Shield,
  RefreshCw, Check, Plus
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

// --- SUB-COMPONENTS ---

function RecoveryScreen({ onBack, onRecover, onSwitchToQuestion, isLoading }: { onBack: () => void, onRecover: (id: string, phrase: string) => void, onSwitchToQuestion: () => void, isLoading?: boolean }) {
  const [identifier, setIdentifier] = useState('');
  const [recoveryWords, setRecoveryWords] = useState<string[]>(new Array(12).fill(''));
  const handleWordChange = (index: number, value: string) => {
    const newWords = [...recoveryWords];
    newWords[index] = value.toLowerCase().trim();
    setRecoveryWords(newWords);
  };
  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const words = e.clipboardData.getData('text').split(/\s+/).slice(0, 12);
    if (words.length > 0) {
      const newWords = [...recoveryWords];
      words.forEach((w, i) => { if (i < 12) newWords[i] = w.toLowerCase().trim(); });
      setRecoveryWords(newWords);
    }
  };
  return (
    <div className="flex flex-col h-screen bg-black text-white p-6 overflow-y-auto">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="p-2 hover:bg-zinc-800 rounded-full transition-colors" title="Volver"><ArrowLeft className="w-6 h-6" /></button>
        <h2 className="text-xl font-bold">Recuperar Cuenta</h2>
      </div>
      <div className="space-y-6 max-w-md mx-auto w-full">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-400">Teléfono o Correo</label>
          <Input placeholder="Ej: +584121234567 o email@ejemplo.com" value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="bg-zinc-900 border-zinc-800 h-12" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-400">Frase de Recuperación (12 palabras)</label>
          <div className="grid grid-cols-3 gap-2" onPaste={handlePaste}>
            {recoveryWords.map((word, i) => (
              <Input key={i} placeholder={String(i + 1)} value={word} onChange={(e) => handleWordChange(i, e.target.value)} className="bg-zinc-900 border-zinc-800 h-10 text-center text-sm" />
            ))}
          </div>
        </div>
        <Button className="w-full h-12 bg-yellow-600 hover:bg-yellow-500 text-black font-bold" onClick={() => onRecover(identifier, recoveryWords.join(' '))} disabled={isLoading || recoveryWords.some(w => !w) || !identifier}>
          {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Recuperar con Frase'}
        </Button>
        <div className="relative py-4">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-zinc-800"></div></div>
          <div className="relative flex justify-center text-xs uppercase"><span className="bg-black px-2 text-zinc-500">O usa tu pregunta</span></div>
        </div>
        <Button variant="outline" className="w-full border-zinc-800 text-zinc-400" onClick={onSwitchToQuestion}>Responder Pregunta de Seguridad</Button>
      </div>
    </div>
  );
}

function RecoveryQuestionScreen({ onBack, onRecover, isLoading }: { onBack: () => void, onRecover: (id: string, phrase: string, answer: string) => void, isLoading?: boolean }) {
  const [phoneOrEmail, setPhoneOrEmail] = useState('');
  const [answer, setAnswer] = useState('');
  return (
    <div className="flex flex-col h-screen bg-black text-white p-8">
      <div className="flex items-center gap-4 mb-10">
        <button onClick={onBack} className="p-2 hover:bg-zinc-800 rounded-full transition-colors" title="Volver"><ArrowLeft className="w-6 h-6" /></button>
        <h2 className="text-xl font-bold uppercase tracking-tight">Pregunta de Seguridad</h2>
      </div>
      <div className="space-y-8 max-w-sm mx-auto w-full">
        <div className="space-y-3">
          <label className="text-xs font-black text-zinc-500 uppercase ml-1">Tu Identificador</label>
          <Input placeholder="Teléfono o Correo" value={phoneOrEmail} onChange={(e) => setPhoneOrEmail(e.target.value)} className="bg-zinc-900/50 border-zinc-800 h-14 rounded-2xl text-lg placeholder:text-zinc-700" />
        </div>
        <div className="space-y-3">
          <label className="text-xs font-black text-zinc-500 uppercase ml-1">Tu Respuesta Secreta</label>
          <Input type="password" placeholder="Escribe tu respuesta aquí" value={answer} onChange={(e) => setAnswer(e.target.value)} className="bg-zinc-900/50 border-zinc-800 h-14 rounded-2xl text-lg placeholder:text-zinc-700" />
        </div>
        <Button disabled={!answer || !phoneOrEmail || isLoading} onClick={() => onRecover(phoneOrEmail, '', answer)} className="w-full h-14 bg-yellow-600 hover:bg-yellow-500 text-black font-black text-lg rounded-2xl shadow-[0_10px_30px_rgba(234,179,8,0.2)]">
          {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Validar Respuesta'}
        </Button>
      </div>
    </div>
  );
}

function PhoneScreen({ phone, setPhone, password, setPassword, countryCode, setCountryCode, referredByCode, setReferredByCode, isLoading, onContinue, mode, setIsResettingPassword, setStep }: { phone: string, setPhone: (v: string) => void, password: string, setPassword: (v: string) => void, countryCode: string, setCountryCode: (v: string) => void, referredByCode: string, setReferredByCode: (v: string) => void, isLoading: boolean, onContinue: () => void, mode: string, setIsResettingPassword: (v: boolean) => void, setStep: (v: any) => void }) {
  return (
    <div className="flex flex-col h-screen bg-black text-white">
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="p-4 mb-4"><img src="/taktak-logo.jpeg" alt="Logo" className="w-24 h-24 object-contain" /></div>
        <h1 className="text-2xl font-black text-white mb-2 uppercase tracking-tighter">{mode === 'login' ? 'Ingresar a TakTak' : 'Crear Tu Cuenta'}</h1>
        <p className="text-zinc-500 text-center mb-10 text-sm italic">{mode === 'login' ? 'Bienvenido de vuelta, ingresa tu número o correo' : 'Únete a la red P2P más grande'}</p>
        <div className="w-full max-w-md space-y-4 mb-8">
          <div className="flex items-center bg-zinc-900/30 border border-zinc-800/80 rounded-2xl h-16 px-1 shadow-[0_0_20px_rgba(0,0,0,0.5)]">
            {!phone.includes('@') && <CountryPicker value={countryCode} onChange={setCountryCode} className="border-none bg-transparent w-[100px] h-14" />}
            <Input type="text" placeholder={phone.includes('@') ? "Correo electrónico" : "Número de teléfono"} className="bg-transparent border-none text-white h-full text-lg placeholder:text-zinc-700 flex-1" value={phone} onChange={(e: any) => setPhone(e.target.value)} />
          </div>
          <div className="flex items-center bg-zinc-900/30 border border-zinc-800/80 rounded-2xl h-16 px-4 shadow-[0_0_20px_rgba(0,0,0,0.5)]">
            <Shield className="w-5 h-5 text-zinc-600 mr-3" />
            <Input type="password" placeholder="Tu contraseña (opcional para OTP)" className="bg-transparent border-none text-white h-full text-lg placeholder:text-zinc-700 flex-1" value={password} onChange={(e: any) => setPassword(e.target.value)} />
          </div>
          {mode === 'login' && (
            <div className="flex justify-center pt-1">
              <button onClick={async () => {
                const fullIdentifier = phone.includes('@') ? phone : (phone.startsWith('+') ? phone : countryCode + phone);
                if (!phone.trim()) { toast.error('Ingresa tu teléfono o correo primero'); return; }
                try {
                  await authApi.login(fullIdentifier);
                  toast.success('Código de recuperación enviado.');
                  setIsResettingPassword(true);
                  setStep('otp');
                } catch (err: any) { toast.error(err?.response?.data?.error || 'Error al enviar código'); }
              }} className="text-zinc-500 hover:text-white text-xs">¿Olvidaste tu contraseña? Restablecer por correo</button>
            </div>
          )}
        </div>
        {mode === 'signup' && <div className="w-full max-w-md mb-8"><Input type="text" placeholder="Código de Invitado (Opcional)" className="bg-zinc-900/30 border-zinc-800 text-zinc-400 h-10 text-center rounded-xl" value={referredByCode} onChange={(e: any) => setReferredByCode(e.target.value)} /></div>}
        <Button className="w-full max-w-md h-14 bg-yellow-600 text-black font-black text-lg rounded-2xl shadow-xl" onClick={onContinue} disabled={isLoading}>{isLoading ? <RefreshCw className="w-6 h-6 animate-spin" /> : 'Siguiente'}</Button>
        <p className="mt-8 text-[10px] text-zinc-600 text-center px-10">Al hacer clic en Siguiente, aceptas nuestros Términos y Política de Privacidad P2P.</p>
      </div>
    </div>
  );
}

function OTPScreen({ otp, isLoading, onOtpChange, onKeyDown, onVerify, onResend, onBack, isResettingPassword, newResetPassword, setNewResetPassword }: { otp: string[], isLoading: boolean, onOtpChange: (i: number, v: string) => void, onKeyDown: (i: number, e: any) => void, onVerify: () => void, onResend: () => void, onBack: () => void, isResettingPassword?: boolean, newResetPassword?: string, setNewResetPassword?: (v: string) => void }) {
  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white">
      <div className="p-4"><button onClick={onBack} className="p-2 hover:bg-zinc-800 rounded-full" title="Volver"><ArrowLeft className="w-5 h-5" /></button></div>
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mb-6"><MessageCircle className="w-8 h-8 text-green-500" /></div>
        <h1 className="text-2xl font-bold mb-2">Verificar código</h1>
        <p className="text-zinc-400 text-center mb-8">Ingresa el código de 6 dígitos enviado</p>
        <div className="flex gap-2 mb-8">
          {otp.map((digit: string, i: number) => (
            <input key={i} id={`otp-${i}`} type="text" maxLength={1} value={digit} onChange={(e) => onOtpChange(i, e.target.value)} onKeyDown={(e) => onKeyDown(i, e)} className="w-12 h-14 bg-zinc-900 border border-zinc-800 rounded-lg text-center text-2xl font-bold text-yellow-500" />
          ))}
        </div>
        {isResettingPassword && (
          <div className="w-full max-w-sm space-y-2 mb-8">
            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider ml-1">Nueva Contraseña</label>
            <div className="relative"><Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" /><Input type="password" value={newResetPassword} onChange={e => setNewResetPassword && setNewResetPassword(e.target.value)} placeholder="Mínimo 6 caracteres" className="bg-zinc-900 border-zinc-800 h-14 text-white pl-10 text-lg" /></div>
          </div>
        )}
        <div className="text-center mb-8"><p className="text-zinc-500 text-sm mb-2">¿No recibiste el código?</p><button onClick={onResend} className="text-yellow-500 font-semibold">Reenviar código</button></div>
        <Button className="w-full max-w-sm h-14 bg-yellow-600 text-black font-bold text-lg rounded-2xl shadow-xl" onClick={onVerify} disabled={isLoading}>{isLoading ? <RefreshCw className="w-6 h-6 animate-spin" /> : 'Verificar'}</Button>
      </div>
    </div>
  );
}

function ProfileScreen({ firstName, setFirstName, lastName, setLastName, email, setEmail, password, setPassword, isLoading, onComplete, onBack }: { firstName: string, setFirstName: (v: string) => void, lastName: string, setLastName: (v: string) => void, email: string, setEmail: (v: string) => void, password: string, setPassword: (v: string) => void, isLoading: boolean, onComplete: () => void, onBack: () => void }) {
  const [regStep, setRegStep] = useState<'info' | 'confirm'>('info');
  return (
    <div className="flex flex-col h-screen bg-black text-white overflow-hidden font-sans">
      <header className="pt-6 px-6 flex items-center justify-between border-b border-zinc-900">
         <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-500" title="Volver"><ArrowLeft className="w-5 h-5" /></button>
            <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-purple-900 rounded-full flex items-center justify-center border border-yellow-500/30">
               <div className="w-4 h-4 bg-green-500 rounded-full -mt-2 -mr-2 shadow-lg" />
            </div>
         </div>
         <div className="flex gap-8 text-xs font-serif italic text-zinc-500">
            <button onClick={() => setRegStep('info')} className={cn("pb-3 border-b-2 transition-all", regStep === 'info' ? "text-yellow-500 border-yellow-500" : "border-transparent")}>Registration</button>
            <button onClick={() => setRegStep('confirm')} className={cn("pb-3 border-b-2 transition-all", regStep === 'confirm' ? "text-yellow-500 border-yellow-500" : "border-transparent")}>Confirmation</button>
         </div>
      </header>
      <div className="flex-1 overflow-y-auto p-8 space-y-8 pb-32 relative">
         {regStep === 'info' ? (
           <div className="space-y-6">
              <h2 className="text-xl font-medium text-zinc-300">Create Account</h2>
              <div className="flex items-center gap-4">
                 <div className="w-20 h-20 bg-gradient-to-br from-purple-600/20 to-zinc-900 border-2 border-dashed border-purple-500/50 rounded-full flex items-center justify-center group cursor-pointer hover:border-yellow-500 transition-all"><Plus className="w-8 h-8 text-purple-400 group-hover:text-yellow-500" /></div>
                 <span className="text-sm font-medium text-zinc-500">add photo</span>
              </div>
              <div className="space-y-4">
                 <Input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First Name" className="bg-zinc-900/40 border-yellow-500/30 h-12 rounded-xl" />
                 <Input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last Name" className="bg-zinc-900/40 border-yellow-500/30 h-12 rounded-xl" />
                 <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="bg-zinc-900/40 border-yellow-500/30 h-12 rounded-xl" />
                 <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="bg-zinc-900/40 border-yellow-500/30 h-12 rounded-xl" />
              </div>
              <Button onClick={() => setRegStep('confirm')} className="w-full h-14 bg-zinc-900/80 border border-yellow-500/20 text-zinc-400 rounded-3xl font-medium text-lg hover:text-white transition-all shadow-xl">Sign Up</Button>
           </div>
         ) : (
           <div className="flex flex-col items-center space-y-8 pt-10">
              <div className="relative">
                 <div className="w-32 h-32 bg-gradient-to-br from-yellow-500 to-purple-600 rounded-full flex items-center justify-center p-1 shadow-2xl">
                    <div className="w-full h-full bg-black rounded-full flex items-center justify-center"><Check className="w-16 h-16 text-yellow-500" strokeWidth={3} /></div>
                 </div>
                 <div className="absolute inset-0 bg-yellow-400/10 blur-3xl rounded-full" />
              </div>
              <div className="bg-gradient-to-r from-purple-900/40 via-purple-600/20 to-black border border-yellow-500/30 px-8 py-3 rounded-full shadow-lg">
                 <p className="text-yellow-500 font-bold tracking-widest text-sm uppercase">🎉 Account Created! 🎉</p>
              </div>
              <div className="text-center space-y-2 max-w-xs"><p className="text-zinc-400 text-sm leading-relaxed">Account set up with temporary identifier. We've sent verification email to <span className="text-yellow-500/80">{email}</span>.</p></div>
              <Button onClick={onComplete} className="w-full h-14 bg-gradient-to-r from-yellow-600 to-yellow-500 text-black font-black text-lg rounded-3xl shadow-2xl hover:scale-105 transition-transform active:scale-95">Continue</Button>
           </div>
         )}
      </div>
      <footer className="p-10 flex flex-col items-center space-y-4">
         <div className="flex items-center gap-6">
            <div className="w-8 h-8 rounded-full bg-yellow-500 text-black flex items-center justify-center font-bold text-xs">1</div>
            <div className="w-20 h-1 bg-gradient-to-r from-yellow-500 to-zinc-800 rounded-full" />
            <div className="w-8 h-8 rounded-full border border-yellow-500/50 text-yellow-500 flex items-center justify-center font-bold text-xs">2</div>
         </div>
      </footer>
    </div>
  );
}

function SecurityScreen({ recoveryPhrase, securityQuestion, setSecurityQuestion, securityAnswer, setSecurityAnswer, isLoading, onComplete, onBack }: { recoveryPhrase: string, securityQuestion: string, setSecurityQuestion: (v: string) => void, securityAnswer: string, setSecurityAnswer: (v: string) => void, isLoading: boolean, onComplete: () => void, onBack: () => void }) {
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
      <div className="flex items-center gap-3 mb-6"><Shield className="w-10 h-10 text-yellow-500" /><div><h2 className="text-2xl font-black uppercase tracking-tighter">Seguridad P2P</h2><p className="text-zinc-500 text-xs italic">Respalda tu cuenta de forma descentralizada</p></div></div>
      <div className="bg-zinc-900/50 border border-yellow-500/20 rounded-3xl p-6 mb-8 backdrop-blur-xl">
        <h3 className="text-yellow-500 font-black mb-2 uppercase text-sm">⚠️ Frase de Recuperación</h3>
        <p className="text-[10px] text-zinc-500 mb-6 leading-relaxed">Copia estas 12 palabras en un lugar físico seguro. Si pierdes tu frase, TakTak no podrá recuperar tus datos ni fondos.</p>
        <div className="grid grid-cols-2 gap-3 mb-6">{words.map((word, i) => (<div key={i} className="bg-black/40 border border-zinc-800 rounded-2xl p-3 flex items-center gap-3"><span className="text-[10px] text-zinc-700 font-black">{i + 1}</span><span className="text-sm font-bold text-white tracking-tight">{word}</span></div>))}</div>
        <Button variant="outline" className={`w-full h-12 rounded-2xl ${copied ? 'text-green-500 border-green-500/30' : 'text-zinc-400 hover:text-white'}`} onClick={handleCopy}>{copied ? '¡FRASE COPIADA!' : 'COPIAR AL PORTAPAPELES'}</Button>
      </div>
      <div className="space-y-6 mb-10">
        <h3 className="text-xs font-black text-zinc-500 uppercase ml-1 tracking-widest">Pregunta de Seguridad</h3>
        <select className="w-full h-14 bg-zinc-900/50 border border-zinc-800 rounded-2xl px-4 text-sm text-white focus:outline-none focus:border-yellow-500/50" value={securityQuestion} onChange={(e) => setSecurityQuestion(e.target.value)} title="Pregunta de Seguridad">
          <option>¿Cuál es el nombre de tu primera mascota?</option><option>¿Cuál es la ciudad donde naciste?</option><option>¿Cuál era el apodo de tu infancia?</option><option>¿Nombre de tu escuela primaria?</option>
        </select>
        <div className="relative"><Input type={showAnswer ? "text" : "password"} placeholder="Tu respuesta secreta" className="bg-zinc-900/50 border border-zinc-800 h-14 rounded-2xl pr-14 text-white text-lg" value={securityAnswer} onChange={(e) => setSecurityAnswer(e.target.value)} /><button className="absolute right-5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-white transition-all text-xl" onClick={() => setShowAnswer(!showAnswer)}>{showAnswer ? '🙈' : '👁️'}</button></div>
      </div>
      <div className="mt-auto pb-4"><Button className="w-full h-16 bg-yellow-600 text-black font-black text-xl rounded-2xl shadow-xl" onClick={onComplete} disabled={isLoading || securityAnswer.length < 2 || !copied}>{isLoading ? <RefreshCw className="w-8 h-8 animate-spin" /> : 'FINALIZAR REGISTRO'}</Button><Button variant="ghost" className="w-full text-zinc-600 mt-2" onClick={onBack}>Volver</Button></div>
    </div>
  );
}

// --- MAIN COMPONENT ---

export const AuthView = ({ mode = 'signup' }: { mode?: 'login' | 'signup' | 'recovery' }) => {
  const [step, setStep] = useState<AuthStep>(mode === 'recovery' ? 'recovery' : 'phone');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [dob] = useState('2000-01-01');
  const [recoveryPhrase, setRecoveryPhrase] = useState<string>('');
  const [securityQuestion, setSecurityQuestion] = useState('¿Cuál es el nombre de tu primera mascota?');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [referredByCode, setReferredByCode] = useState(() => { return new URLSearchParams(window.location.search).get('ref') || ''; });
  const { login } = useStore();
  const [countryCode, setCountryCode] = useState('+58');
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [newResetPassword, setNewResetPassword] = useState('');

  const handleIdentitySubmit = async () => {
    if (!phone.trim()) { toast.error('Ingresa tu teléfono o correo'); return; }
    setIsLoading(true);
    const fullIdentifier = phone.includes('@') ? phone : (phone.startsWith('+') ? phone : countryCode + phone);
    try {
      if (password.trim()) {
        try {
          const response = await authApi.loginWithPassword(fullIdentifier, password);
          if (response?.data?.token && response?.data?.user) {
            localStorage.setItem('taktak_token', response.data.token);
            login(response.data.user); toast.success(`¡Bienvenido de nuevo!`); return;
          }
        } catch (err: any) {
          if (err.response?.status === 401 || err.response?.status === 404) { toast.error(err.response?.data?.error || 'Credenciales incorrectas'); setIsLoading(false); return; }
        }
      }
      await authApi.login(fullIdentifier).catch(() => {
        return authApi.register({ phone: phone.includes('@') ? 'temp_' + Date.now() : fullIdentifier, email: phone.includes('@') ? fullIdentifier : undefined, username: 'pending_' + Date.now(), dob: '2000-01-01', legalAccepted: true, privacyAccepted: true, referredByCode });
      });
      setStep('otp'); toast.success(`Código enviado a ${fullIdentifier}`);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error al iniciar sesión'); } finally { setIsLoading(false); }
  };

  const handleVerifyOTP = async () => {
    const otpCode = otp.join('');
    if (otpCode.length < 6) { toast.error('Ingresa el código completo'); return; }
    setIsLoading(true);
    const fullIdentifier = phone.includes('@') ? phone : (phone.startsWith('+') ? phone : countryCode + phone);
    try {
      if (isResettingPassword) {
        await authApi.resetPassword(fullIdentifier, otpCode, newResetPassword);
        toast.success('¡Contraseña restablecida!'); setStep('phone'); setIsResettingPassword(false); setNewResetPassword(''); return;
      }
      const response = await authApi.verify(fullIdentifier, otpCode);
      const { user, token } = response.data;
      localStorage.setItem('taktak_token', token);
      if (!user.username || user.username.startsWith('pending_')) setStep('profile');
      else { login(user); toast.success(`¡Bienvenido!`); }
    } catch (err: any) { toast.error(err.response?.data?.error || 'Código incorrecto'); } finally { setIsLoading(false); }
  };

  const handleCompleteProfile = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password.trim()) { toast.error('Completa los campos'); return; }
    setIsLoading(true);
    try {
      const combinedUsername = `${firstName.toLowerCase()}${lastName.toLowerCase()}`.replace(/[^a-z0-9]/g, '').slice(0, 15);
      const response = await authApi.register({ phone, username: combinedUsername, password, email, dob, legalAccepted: true, privacyAccepted: true, referredByCode });
      if (response.data?.token) localStorage.setItem('taktak_token', response.data.token);
      const wordList = ['sol', 'luna', 'estrella', 'mar', 'montaña', 'rio', 'viento', 'fuego', 'tierra', 'bosque'];
      const phrase = Array.from({ length: 12 }, () => wordList[Math.floor(Math.random() * wordList.length)]).join(' ');
      setRecoveryPhrase(phrase); setStep('security');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error al completar perfil'); } finally { setIsLoading(false); }
  };

  const handleCompleteSecurity = async () => {
    if (!securityAnswer.trim()) { toast.error('Respuesta requerida'); return; }
    setIsLoading(true);
    try {
      await authApi.setupSecurity({ securityQuestion, securityAnswer, recoveryPhrase });
      const { data } = await authApi.getMe();
      login(data.user); toast.success('¡Seguridad completada!');
    } catch { toast.error('Error al guardar seguridad'); } finally { setIsLoading(false); }
  };

  const handleRecover = async (identifier: string, phrase: string, answer?: string) => {
    if (!identifier) { toast.error('Identificador requerido'); return; }
    setIsLoading(true);
    try {
      const response = await authApi.recoverAccount({ identifier, recoveryPhrase: phrase, securityAnswer: answer });
      const { user, token } = response.data;
      localStorage.setItem('taktak_token', token); login(user); toast.success(`¡Bienvenido!`);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error de recuperación'); } finally { setIsLoading(false); }
  };

  const renderCurrentStep = () => {
    switch (step) {
      case 'recovery': return <RecoveryScreen onBack={() => setStep('phone')} onRecover={handleRecover} onSwitchToQuestion={() => setStep('recovery_question')} isLoading={isLoading} />;
      case 'recovery_question': return <RecoveryQuestionScreen onBack={() => setStep('recovery')} onRecover={handleRecover} isLoading={isLoading} />;
      case 'phone': return <PhoneScreen phone={phone} setPhone={setPhone} password={password} setPassword={setPassword} countryCode={countryCode} setCountryCode={setCountryCode} referredByCode={referredByCode} setReferredByCode={setReferredByCode} isLoading={isLoading} onContinue={handleIdentitySubmit} mode={mode === 'recovery' ? 'signup' : mode} setIsResettingPassword={setIsResettingPassword} setStep={setStep} />;
      case 'otp': return <OTPScreen otp={otp} isLoading={isLoading} onOtpChange={(i: number, v: string) => { const n = [...otp]; n[i] = v; setOtp(n); if (v && i < 5) document.getElementById(`otp-${i + 1}`)?.focus(); }} onKeyDown={(i: number, e: any) => { if (e.key === 'Backspace' && !otp[i] && i > 0) document.getElementById(`otp-${i - 1}`)?.focus(); }} onVerify={handleVerifyOTP} onResend={() => toast.success('Reenviado')} onBack={() => setStep('phone')} isResettingPassword={isResettingPassword} newResetPassword={newResetPassword} setNewResetPassword={setNewResetPassword} />;
      case 'profile': return <ProfileScreen firstName={firstName} setFirstName={setFirstName} lastName={lastName} setLastName={setLastName} email={email} setEmail={setEmail} password={password} setPassword={setPassword} isLoading={isLoading} onComplete={handleCompleteProfile} onBack={() => setStep('otp')} />;
      case 'security': return <SecurityScreen recoveryPhrase={recoveryPhrase} securityQuestion={securityQuestion} setSecurityQuestion={setSecurityQuestion} securityAnswer={securityAnswer} setSecurityAnswer={setSecurityAnswer} isLoading={isLoading} onComplete={handleCompleteSecurity} onBack={() => setStep('profile')} />;
      case 'terms': return <TermsOfService onBack={() => setStep('phone')} />;
      case 'privacy': return <PrivacyPolicy onBack={() => setStep('phone')} />;
      default: return null;
    }
  };

  return <div className="fixed inset-0 z-[100] bg-black">{renderCurrentStep()}</div>;
};
