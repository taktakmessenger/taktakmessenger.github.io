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

// Iconos de la pantalla de llamada. Faltaban porque los botones usaban emojis
// (🎤 📷 🔊 🔽 📵), que en varios Android salían como cuadros vacíos y no
// heredaban el color del botón. Con SVG el icono es el mismo en todas partes y
// se puede apagar (tachado) para decir "esto está silenciado" sin cambiar de
// símbolo, que es lo que hace WhatsApp.

export function MicOffIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

export function CameraOffIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <rect x="3" y="6.5" width="12" height="11" rx="2.4" />
      <path d="M15 10.5l5.2-2.6a.6.6 0 0 1 .9.5v7.2a.6.6 0 0 1-.9.5L15 13.5" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

export function VolumeIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z" />
      <path d="M16 9a4 4 0 0 1 0 6" />
      <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  );
}

export function VolumeOffIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z" />
      <path d="M16 10l4 4M20 10l-4 4" />
    </svg>
  );
}

export function SpeakerIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z" />
      <path d="M16 9a4 4 0 0 1 0 6" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} strokeWidth="2" aria-hidden="true">
      <path d="M5 9l7 7 7-7" />
    </svg>
  );
}

// Auricular colgado (colgar la llamada). Es el teléfono girado, no el mismo
// icono del botón de llamar, para que "colgar" se lea de un vistazo.
export function HangUpIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M6.5 3.5h3l1.4 3.7-1.9 1.3a12 12 0 0 0 5.5 5.5l1.3-1.9 3.7 1.4v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z" />
      <path d="M3 21l18-18" />
    </svg>
  );
}

// Bocadillo de chat, para la pestaña "Chats". Sustituye al emoji 💬 de la
// pestaña: el emoji cambia de forma en cada sistema y en algunos Android sale
// como cuadro vacío.
export function ChatIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-4 3.5V5.5Z" />
    </svg>
  );
}

// Grupo de personas, para la pestaña "Grupal". Sustituye al emoji 👥.
export function UsersIcon({ size = 22 }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.4a3.2 3.2 0 0 1 0 5.2" />
      <path d="M17 13.6a5.5 5.5 0 0 1 3.5 5.4" />
    </svg>
  );
}

