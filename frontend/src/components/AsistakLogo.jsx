// Cara de Asistak, el asistente administrativo que hace de repartidor en la
// mesa de POKERTAK. Es una máscara con visor dorado y pajarita, para que se
// reconozca de un vistazo quién lleva las cartas en la mesa.
export default function AsistakLogo({ size = 48, className = '' }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Asistak, el repartidor de la mesa"
    >
      <defs>
        <linearGradient id="asistak-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f7f5" />
          <stop offset="1" stopColor="#b9c8c0" />
        </linearGradient>
        <linearGradient id="asistak-visor" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe98a" />
          <stop offset="1" stopColor="#f0a91b" />
        </linearGradient>
      </defs>

      {/* Cabeza redondeada de la máscara. */}
      <rect x="18" y="16" width="64" height="58" rx="24" fill="url(#asistak-face)" stroke="#7c8b83" strokeWidth="2.5" />
      {/* Visor: la mirada que vigila la mesa. */}
      <rect x="27" y="34" width="46" height="20" rx="10" fill="#0c3628" />
      <circle cx="41" cy="44" r="5.5" fill="url(#asistak-visor)" />
      <circle cx="59" cy="44" r="5.5" fill="url(#asistak-visor)" />
      <circle cx="41" cy="44" r="2" fill="#fffbe0" />
      <circle cx="59" cy="44" r="2" fill="#fffbe0" />
      {/* Antenas. */}
      <path d="M36 16 L30 6" stroke="#7c8b83" strokeWidth="3" strokeLinecap="round" />
      <path d="M64 16 L70 6" stroke="#7c8b83" strokeWidth="3" strokeLinecap="round" />
      <circle cx="29" cy="5" r="3.4" fill="#ffd94a" stroke="#b9790a" strokeWidth="1.5" />
      <circle cx="71" cy="5" r="3.4" fill="#ffd94a" stroke="#b9790a" strokeWidth="1.5" />
      {/* Pajarita de repartidor. */}
      <path d="M50 74 L36 66 L36 82 Z" fill="#d63a1f" stroke="#8f2410" strokeWidth="1.5" />
      <path d="M50 74 L64 66 L64 82 Z" fill="#d63a1f" stroke="#8f2410" strokeWidth="1.5" />
      <circle cx="50" cy="74" r="4" fill="#ff7a59" stroke="#8f2410" strokeWidth="1.5" />
    </svg>
  );
}
