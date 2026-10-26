// Icono de traducción de TAK TAK.
//
// Son dos rostros de perfil mirándose de frente, uno a cada lado, cada uno con
// la marca de su idioma: el de la izquierda con una "A" y el de la derecha con
// el carácter chino "文" (que es el que se usa en todo el mundo para decir
// "idioma" en un icono). Entre los dos, unas flechas que van y vuelven, porque la
// traducción de WhaTaka funciona en los dos sentidos: el español oye en chino y
// el chino oye en español, no es un idioma que se dobla hacia el otro.
//
// Se dibuja como SVG en línea y no como emoji a propósito: el emoji de "dos
// personas" cambia de aspecto en cada sistema operativo y aquí hace falta que se
// lea igual en todas partes. Además así puede heredar el color del texto
// (`currentColor`), que es lo que le permite verse bien sobre la burbuja clara y
// sobre la fucsia.
//
// `active` lo pone en fucsia cuando la traducción está encendida; apagado queda
// en el gris del texto. Es la única señal de estado: no lleva etiqueta porque el
// icono se repite en cada burbuja del hilo.

export default function TranslateIcon({ size = 20, active = false, title = 'Traducir' }) {
  const color = active ? 'var(--fuchsia, #d6006e)' : 'currentColor';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 26"
      fill="none"
      stroke={color}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={title}
      focusable="false"
    >
      <title>{title}</title>

      {/* Rostro izquierdo: el que habla el idioma de origen, marcado con "A". */}
      <circle cx="6.2" cy="7.4" r="2.6" stroke={color} />
      <path d="M1.6 15.2c0-2.2 2-3.9 4.6-3.9s4.6 1.7 4.6 3.9" stroke={color} />
      <text
        x="6.2"
        y="8.6"
        textAnchor="middle"
        fontSize="4.2"
        fontFamily="system-ui, sans-serif"
        fontWeight="700"
        fill={color}
        stroke="none"
      >
        A
      </text>

      {/* Rostro derecho: el receptor, marcado con "文" (idioma). */}
      <circle cx="17.8" cy="7.4" r="2.6" stroke={color} />
      <path d="M13.2 15.2c0-2.2 2-3.9 4.6-3.9s4.6 1.7 4.6 3.9" stroke={color} />
      <text
        x="17.8"
        y="8.7"
        textAnchor="middle"
        fontSize="4.2"
        fontFamily="system-ui, sans-serif"
        fontWeight="700"
        fill={color}
        stroke="none"
      >
        文
      </text>

      {/* Las dos flechas del intercambio, una hacia cada lado. Son dos y no una
          porque la traducción funciona en los dos sentidos: quien habla español
          y quien habla chino se entienden, no es un idioma que se dobla hacia el
          otro. */}
      <path d="M8.4 17.8h6.4" stroke={color} />
      <path d="M13.2 16.6l1.6 1.2-1.6 1.2" stroke={color} />
      <path d="M15.6 22.4H9.2" stroke={color} />
      <path d="M10.8 21.2l-1.6 1.2 1.6 1.2" stroke={color} />
    </svg>
  );
}
