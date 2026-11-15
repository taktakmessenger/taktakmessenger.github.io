interface StartupScreenProps {
  onContinue: () => void;
}

export function StartupScreen({ onContinue }: StartupScreenProps) {
  return (
    <main className="relative h-[100dvh] min-h-screen w-full overflow-hidden bg-[#080615] text-white">
      {/* Ambient neon lighting around the existing brand artwork. */}
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_22%,rgba(192,38,211,0.36),transparent_42%),radial-gradient(ellipse_at_82%_54%,rgba(34,211,238,0.26),transparent_44%),linear-gradient(160deg,#11091f_0%,#080615_54%,#08152a_100%)]" />

      <section className="relative mx-auto flex h-full w-full max-w-md flex-col items-center px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))] text-center">
        <div className="relative mt-3 rounded-[2rem] bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-300 p-[2px] shadow-[0_0_34px_rgba(192,38,211,0.35),0_0_42px_rgba(34,211,238,0.22)]">
          <div className="rounded-[calc(2rem-2px)] bg-black p-3">
            <img
              src="/taktak-logo.jpeg"
              alt="Logo TakTak"
              className="h-36 w-36 rounded-[1.45rem] object-cover"
              fetchPriority="high"
            />
          </div>
        </div>

        <h1 className="mt-8 bg-gradient-to-r from-fuchsia-400 via-violet-300 to-cyan-300 bg-clip-text text-4xl font-black tracking-tight text-transparent drop-shadow-[0_0_18px_rgba(34,211,238,0.25)]">
          TakTak
        </h1>
        <p className="mt-3 max-w-xs text-base leading-relaxed text-violet-100/80">
          Videos cortos en vertical, minijuegos y creación con IA.
        </p>

        <div className="my-auto flex flex-col items-center">
          <img
            src="/pepa.png"
            alt="Pepa del Queso"
            className="h-48 w-48 rounded-[2rem] object-cover shadow-[0_0_32px_rgba(34,211,238,0.16)]"
          />
          <p className="mt-7 bg-gradient-to-r from-fuchsia-400 to-cyan-300 bg-clip-text text-2xl font-black text-transparent">
            Somos la Pepa del Queso
          </p>
        </div>

        <button
          type="button"
          onClick={onContinue}
          className="w-full max-w-xs rounded-full border border-cyan-300/70 bg-gradient-to-r from-fuchsia-700/80 to-cyan-700/80 px-8 py-3.5 text-sm font-bold text-white shadow-[0_0_24px_rgba(34,211,238,0.22)] backdrop-blur transition hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200"
        >
          Continuar
        </button>
      </section>
    </main>
  );
}
