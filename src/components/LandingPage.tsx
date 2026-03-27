import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Smartphone, UserPlus, 
  Mail, Phone, Shield, Key,
  MessageCircle, Chrome, ArrowLeft
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface LandingPageProps {
  onEnterApp: () => void;
}

type View = 'landing' | 'auth' | 'register_info' | 'register_recovery' | 'register_security';

const RECOVERY_WORDS = [
  "sol", "luna", "estrellas", "fuego", "agua", "tierra", "viento", "mar", 
  "bosque", "montaña", "nieve", "trueno", "rayo", "lluvia", "niebla", "oasis"
];

export const LandingPage = ({ onEnterApp }: LandingPageProps) => {
  const [view, setView] = useState<View>('landing');
  const [fade, setFade] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    phone: '',
    secretWord: '',
    secretAnswer: ''
  });
  const [recoveryWords] = useState<string[]>(() => {
    const shuffled = [...RECOVERY_WORDS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 12);
  });

  const handleEnter = () => {
    setFade(true);
    setTimeout(() => {
      onEnterApp();
    }, 600);
  };

  const handleNext = () => {
    if (view === 'auth') setView('register_info');
    else if (view === 'register_info') setView('register_recovery');
    else if (view === 'register_recovery') setView('register_security');
    else if (view === 'register_security') {
       toast.success('Cuenta creada con éxito');
       handleEnter();
    }
  };

  const renderLanding = () => (
    <div className="w-full max-w-4xl px-4 py-12 flex flex-col items-center mt-10">
      {/* Logo */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="relative mb-6"
      >
        <img 
          src="/taktak-logo.jpeg" 
          alt="TakTak Logo" 
          className="w-28 h-28 object-cover rounded-2xl"
        />
      </motion.div>

      {/* Headings */}
      <motion.h1
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-4xl md:text-5xl font-black mb-4 text-white text-center"
      >
        Bienvenido a <span className="text-yellow-500">TakTak</span>
      </motion.h1>

      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-lg text-zinc-400 mb-8 max-w-xl text-center font-medium"
      >
        La red social de video descentralizada P2P donde los creadores mandan
      </motion.p>

      {/* Actions */}
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="flex flex-col w-full max-w-md gap-4 mb-16"
      >
        <Button 
          onClick={() => setView('auth')}
          className="flex items-center justify-center gap-2 w-full h-14 bg-yellow-600 hover:bg-yellow-500 text-black rounded-xl font-bold text-lg transition-colors shadow-[0_4px_15px_rgba(234,179,8,0.3)]"
        >
          <UserPlus className="w-6 h-6" />
          Crear Cuenta Nao
        </Button>
      </motion.div>

      {/* 3 Columns Features */}
      <div className="grid grid-cols-3 gap-4 w-full max-w-3xl mb-16">
        <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800 text-center">
          <h3 className="text-yellow-500 font-black text-xl mb-1">P2P</h3>
          <p className="text-zinc-500 text-sm">Descentralizado</p>
        </div>
        <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800 text-center">
          <h3 className="text-yellow-500 font-black text-xl mb-1">TTC</h3>
          <p className="text-zinc-500 text-sm">Tak Tak Coins</p>
        </div>
        <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800 text-center">
          <h3 className="text-yellow-500 font-black text-xl mb-1">18+</h3>
          <p className="text-zinc-500 text-sm">Sin censura</p>
        </div>
      </div>

      {/* Pepa del Queso Branding */}
      <div className="flex flex-col items-center mt-12 mb-20 text-center">
        <img 
          src="/1774532775301.jpg" 
          alt="Pepa del Queso" 
          className="w-40 h-40 object-cover rounded-full border-4 border-yellow-500/30 shadow-[0_0_20px_rgba(234,179,8,0.2)]"
        />
        <p className="text-yellow-500 font-black text-2xl mt-4 italic tracking-widest uppercase">
          Somos la Pepa del Queso
        </p>
      </div>
    </div>
  );

  const renderAuthOptions = () => (
    <div className="w-full max-w-md px-6 py-12 flex flex-col items-center">
       <button onClick={() => setView('landing')} className="self-start mb-8 text-zinc-500 hover:text-white flex items-center gap-2">
         <ArrowLeft className="w-5 h-5" /> Volver
       </button>
       <h2 className="text-3xl font-black text-white mb-8">Únete a TakTak</h2>
       
       <div className="space-y-4 w-full">
         <Button 
           onClick={() => {
             toast.info('Abriendo WhatsApp...');
             setTimeout(handleNext, 1000);
           }}
           className="w-full h-14 bg-[#25D366] hover:bg-[#128C7E] text-white rounded-xl font-bold flex items-center gap-3"
         >
           <MessageCircle className="w-6 h-6" /> Continuar con WhatsApp
         </Button>

         <Button 
           onClick={() => {
             toast.info('Conectando con Google...');
             setFormData({...formData, email: 'usuario@gmail.com'});
             setTimeout(handleNext, 1000);
           }}
           className="w-full h-14 bg-white hover:bg-zinc-100 text-black rounded-xl font-bold flex items-center gap-3"
         >
           <Chrome className="w-6 h-6" /> Continuar con Google
         </Button>

         <div className="py-4 flex items-center gap-4 text-zinc-500 uppercase text-xs font-bold w-full">
            <div className="h-px bg-zinc-800 flex-1" /> o <div className="h-px bg-zinc-800 flex-1" />
         </div>

         <Button 
           onClick={handleNext}
           variant="outline"
           className="w-full h-14 border-zinc-800 hover:bg-zinc-900 text-white rounded-xl font-bold flex items-center gap-3"
         >
           <Smartphone className="w-6 h-6 text-yellow-500" /> Usar teléfono y correo
         </Button>
       </div>
    </div>
  );

  const renderRegisterInfo = () => (
    <div className="w-full max-w-md px-6 py-12 flex flex-col items-center">
       <h2 className="text-3xl font-black text-white mb-4">Información básica</h2>
       <p className="text-zinc-500 mb-8 text-center">Para tu cuenta descentralizada</p>
       
       <div className="space-y-6 w-full">
         <div className="space-y-2">
           <label className="text-sm font-bold text-zinc-400">Nombre de usuario</label>
           <Input 
             value={formData.username}
             onChange={e => setFormData({...formData, username: e.target.value})}
             placeholder="@tu_usuario" 
             className="bg-zinc-900 border-zinc-800 h-12 text-white"
           />
         </div>
         <div className="space-y-2">
           <label className="text-sm font-bold text-zinc-400">Teléfono</label>
           <div className="relative">
             <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
             <Input 
               value={formData.phone}
               onChange={e => setFormData({...formData, phone: e.target.value})}
               placeholder="+1 234 567 890" 
               className="bg-zinc-900 border-zinc-800 h-12 text-white pl-10"
             />
           </div>
         </div>
         <div className="space-y-2">
           <label className="text-sm font-bold text-zinc-400">Correo electrónico</label>
           <div className="relative">
             <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
             <Input 
               value={formData.email}
               onChange={e => setFormData({...formData, email: e.target.value})}
               placeholder="tu@correo.com" 
               className="bg-zinc-900 border-zinc-800 h-12 text-white pl-10"
             />
           </div>
         </div>
         
         <Button 
           onClick={handleNext}
           disabled={!formData.username}
           className="w-full h-14 bg-yellow-600 hover:bg-yellow-500 text-black rounded-xl font-bold mt-4"
         >
           Continuar
         </Button>
       </div>
    </div>
  );

  const renderRecovery = () => (
    <div className="w-full max-w-md px-6 py-12 flex flex-col items-center">
       <Shield className="w-16 h-16 text-yellow-500 mb-6" />
       <h2 className="text-3xl font-black text-white mb-4 text-center">Frase de Recuperación</h2>
       <p className="text-zinc-500 mb-8 text-center text-sm">
         Guarda estas 12 palabras en un lugar seguro. <span className="text-red-500 font-bold">Nunca las compartas.</span>
       </p>
       
       <div className="grid grid-cols-2 gap-3 w-full mb-8">
         {recoveryWords.map((word, i) => (
           <div key={i} className="bg-zinc-900/80 border border-zinc-800 p-3 rounded-lg flex items-center gap-3">
              <span className="text-yellow-500/50 text-[10px] font-bold">{i + 1}</span>
              <span className="text-white font-medium">{word}</span>
           </div>
         ))}
       </div>

       <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-xl mb-8 flex items-start gap-3">
          <Key className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
          <p className="text-yellow-500/80 text-xs">
            Estas palabras son la clave única de tu billetera y perfil de TakTak.
          </p>
       </div>
       
       <Button 
         onClick={handleNext}
         className="w-full h-14 bg-yellow-600 hover:bg-yellow-500 text-black rounded-xl font-bold"
       >
         He guardado las palabras
       </Button>
    </div>
  );

  const renderSecurity = () => (
    <div className="w-full max-w-md px-6 py-12 flex flex-col items-center">
       <h2 className="text-3xl font-black text-white mb-4 text-center">Capa de Seguridad</h2>
       <p className="text-zinc-500 mb-8 text-center text-sm">Añade una palabra secreta adicional por seguridad</p>
       
       <div className="space-y-6 w-full">
         <div className="space-y-2">
           <label className="text-sm font-bold text-zinc-400">Palabra Secreta</label>
           <Input 
             value={formData.secretWord}
             onChange={e => setFormData({...formData, secretWord: e.target.value})}
             placeholder="Ej: Mi mascota favorita" 
             className="bg-zinc-900 border-zinc-800 h-12 text-white"
           />
         </div>
         <div className="space-y-2">
           <label className="text-sm font-bold text-zinc-400">Tu Respuesta</label>
           <Input 
             type="password"
             value={formData.secretAnswer}
             onChange={e => setFormData({...formData, secretAnswer: e.target.value})}
             placeholder="Tu respuesta" 
             className="bg-zinc-900 border-zinc-800 h-12 text-white"
           />
         </div>
         
         <Button 
           onClick={handleNext}
           disabled={!formData.secretWord || !formData.secretAnswer}
           className="w-full h-14 bg-yellow-600 hover:bg-yellow-500 text-black rounded-xl font-bold mt-4"
         >
           Finalizar y Entrar
         </Button>
       </div>
    </div>
  );

  return (
    <div 
      className={`flex flex-col items-center min-h-screen bg-black overflow-y-auto pb-20 scrollbar-hide transition-opacity duration-700 ${fade ? 'opacity-0' : 'opacity-100'}`}
    >
       <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -20, opacity: 0 }}
            className="w-full flex justify-center"
          >
            {view === 'landing' && renderLanding()}
            {view === 'auth' && renderAuthOptions()}
            {view === 'register_info' && renderRegisterInfo()}
            {view === 'register_recovery' && renderRecovery()}
            {view === 'register_security' && renderSecurity()}
          </motion.div>
       </AnimatePresence>
    </div>
  );
};
