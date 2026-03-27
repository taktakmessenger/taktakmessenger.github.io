import { ArrowLeft } from 'lucide-react';

interface LegalViewProps {
  onBack: () => void;
}

export const TermsOfService = ({ onBack }: LegalViewProps) => {
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
        <h1 className="text-xl font-bold">Términos de Servicio</h1>
      </div>

      <div className="p-6 space-y-6 max-w-2xl mx-auto text-zinc-300 leading-relaxed">
        <section>
          <h2 className="text-yellow-500 font-bold text-lg mb-2">1. Aceptación de los Términos</h2>
          <p>
            Al acceder o utilizar TakTak, aceptas cumplir con estos Términos de Servicio. Si no estás de acuerdo con alguna parte de los términos, no podrás acceder al servicio.
          </p>
        </section>

        <section>
          <h2 className="text-yellow-500 font-bold text-lg mb-2">2. Uso del Servicio</h2>
          <p>
            Aceptas usar el servicio solo para fines legales. Queda prohibido el uso de TakTak para actividades ilícitas, acoso, o distribución de contenido dañino.
          </p>
        </section>

        <section>
          <h2 className="text-yellow-500 font-bold text-lg mb-2">3. Propiedad del Contenido</h2>
          <p>
            Tú mantienes todos los derechos sobre el contenido que publicas o envías a través de TakTak. Al usar el servicio P2P, otorgas una licencia técnica limitada para que la red distribuya tu contenido a tus destinatarios.
          </p>
        </section>

        <section>
          <h2 className="text-yellow-500 font-bold text-lg mb-2">4. Limitación de Responsabilidad</h2>
          <p>
            TakTak se proporciona "tal cual". Al ser una red descentralizada, no somos responsables por fallos técnicos de terceros, pérdida de datos fuera de nuestro control, o el contenido compartido por otros usuarios.
          </p>
        </section>

        <section>
          <h2 className="text-yellow-500 font-bold text-lg mb-2">5. Terminación</h2>
          <p>
            Podemos suspender o rescindir tu acceso al servicio de inmediato, sin previo aviso ni responsabilidad, por cualquier motivo, incluido el incumplimiento de los Términos.
          </p>
        </section>

        <div className="pt-8 text-zinc-500 text-sm text-center">
          Última actualización: 15 de marzo de 2026
        </div>
      </div>
    </div>
  );
};
