interface StartupScreenProps {
  onContinue: () => void;
}

export function StartupScreen({ onContinue }: StartupScreenProps) {
  return (
    <main className="relative h-[100dvh] min-h-screen w-full overflow-hidden bg-[#09051b]">
      <img
        src="/taktak-logo.jpeg"
        alt="TakTak: videos cortos, minijuegos y creación con IA. Somos la Pepa del Queso."
        className="absolute inset-0 h-full w-full object-cover object-center"
        fetchPriority="high"
      />
      <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/70 to-transparent px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-20">
        <button
          type="button"
          onClick={onContinue}
          className="rounded-full border border-white/70 bg-black/55 px-8 py-3 text-sm font-bold text-white shadow-lg backdrop-blur-sm transition hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          Continuar
        </button>
      </div>
    </main>
  );
}
