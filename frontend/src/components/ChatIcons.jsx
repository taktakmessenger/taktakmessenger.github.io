// Iconos del chat, dibujados como SVG en línea.
//
// Antes estos botones usaban emojis (📞 🎥 📎 🎤 ➤). El problema es que cada
// móvil dibuja los emojis a su manera y algunos Android no los renderizan: en
// la barra del chat aparecían cuadros vacíos en vez del teléfono o la cámara.
// Con SVG en línea el icono es el mismo en todas partes y hereda el color del
// botón (`currentColor`), que es lo que permite que se lean bien tanto sobre la
// cabecera violeta como sobre la barra oscura de escribir.

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  focusable: 'false',
};

export function BackIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M15 5 8 12l7 7" />
    </svg>
  );
}

export function PhoneIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M6.5 3.5h3l1.4 3.7-1.9 1.3a12 12 0 0 0 5.5 5.5l1.3-1.9 3.7 1.4v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z" />
    </svg>
  );
}

export function VideoIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <rect x="3" y="6.5" width="12" height="11" rx="2.4" />
      <path d="M15 10.5l5.2-2.6a.6.6 0 0 1 .9.5v7.2a.6.6 0 0 1-.9.5L15 13.5" />
    </svg>
  );
}

export function AttachIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M19 11.5 12 18.5a4.6 4.6 0 0 1-6.5-6.5l7.2-7.2a3 3 0 0 1 4.3 4.3l-7.3 7.2a1.4 1.4 0 0 1-2-2l6.6-6.6" />
    </svg>
  );
}

export function MicIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

export function SendIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} strokeWidth="2" aria-hidden="true">
      <path d="M4 12 20 4l-4.2 16-3.8-6.4L4 12Z" />
    </svg>
  );
}

export function EmojiIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
      <path d="M9 9.5h.01M15 9.5h.01" strokeWidth="2.4" />
    </svg>
  );
}

export function CameraIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M3 8.5A2 2 0 0 1 5 6.5h1.6l1-1.8h4.8l1 1.8H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <circle cx="12" cy="12.6" r="3.1" />
    </svg>
  );
}

export function GalleryIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M4 17.5l4.8-4.3a1.6 1.6 0 0 1 2.2.1L20 19" />
    </svg>
  );
}

export function LocationIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M12 21s6.5-5.4 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.6 12 21 12 21Z" />
      <circle cx="12" cy="10.5" r="2.4" />
    </svg>
  );
}

export function ContactIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

export function DocumentIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M6 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6.5 3.5Z" />
      <path d="M13 3.5V9h5" />
    </svg>
  );
}

export function PollIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M5 20V11M12 20V5M19 20v-6" />
    </svg>
  );
}

export function EventIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
    </svg>
  );
}

export function CloseIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} strokeWidth="2" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
