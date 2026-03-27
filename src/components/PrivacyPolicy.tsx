import { ArrowLeft } from 'lucide-react';

interface LegalViewProps {
  onBack: () => void;
}

export const PrivacyPolicy = ({ onBack }: LegalViewProps) => {
  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white overflow-y-auto">
      <div className="sticky top-0 bg-black/80 backdrop-blur-md p-4 border-b border-zinc-800 flex items-center gap-4 z-50">
        <button 
          onClick={onBack} 
          aria-label="Volver"
          title="Volver"
          className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-white"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">Política de Privacidad</h1>
      </div>

      <div className="p-6 space-y-6 max-w-2xl mx-auto text-zinc-300 leading-relaxed">
        <section>
          <h2 className="text-yellow-500 font-bold text-lg mb-2">1. Recopilación de Información</h2>
          <p>
            TakTak es una plataforma orientada a la privacidad. No recopilamos datos personales innecesarios. 
            Solo requerimos tu número de teléfono para la creación de la cuenta y verificación.
          </p>
        </section>

        <section>
          <h2 className="text-yellow-500 font-bold text-lg mb-2">2. Encriptación de Extremo a Extremo</h2>
          <p>
            Todos tus mensajes, llamadas y archivos compartidos están protegidos por encriptación AES-256 de extremo a extremo (E2EE). 
            Esto significa que solo tú y el destinatario pueden leer el contenido. Ni siquiera TakTak tiene acceso a tus comunicaciones.
          </p>
        </section>

        <section>
          <h2 className="text-yellow-500 font-bold text-lg mb-2">3. Red P2P y Descentralización</h2>
          <p>
            TakTak utiliza protocolos Peer-to-Peer (P2P). Tus datos no se almacenan en servidores centrales permanentes. 
            La distribución de archivos utiliza tecnologías similares a BitTorrent para garantizar que el contenido sea tuyo.
          </p>
        </section>

        <section>
          <h2 className="text-yellow-500 font-bold text-lg mb-2">4. Tus Derechos</h2>
          <p>
            Tienes derecho a eliminar tu cuenta y todos los datos asociados en cualquier momento. 
            Al ser un sistema P2P, parte de tu información pública (como tu nombre de usuario) puede persistir en la red hasta que se purgue de los nodos.
          </p>
        </section>

        <section>
          <h2 className="text-yellow-500 font-bold text-lg mb-2">5. Cambios en esta Política</h2>
          <p>
            Podemos actualizar nuestra política de privacidad periódicamente. Te notificaremos de cualquier cambio publicando la nueva política en esta página.
          </p>
        </section>

        <div className="pt-8 text-zinc-500 text-sm text-center">
          Última actualización: 15 de marzo de 2026
        </div>
      </div>
    </div>
  );
};
