import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../contexts/SocketContext';

// Comentarios del directo, al estilo de TikTok: los mensajes suben por el socket
// y se pintan encima del vídeo. El canal es la sala de voz del creator, así que
// el servidor ya comprobó al unirse que quien escribe es miembro (cuando el
// creator es privado).
export default function LiveChat({ room, onGift, hidden = false }) {
  const { emit, subscribe } = useSocket();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    if (!room) return undefined;

    // Unirse al canal de comentarios de la sala. El nombre es la sala de voz
    // (`voice:<name>`), que es la única clave que el servidor puede comprobar
    // contra la base de datos.
    emit('live:join', { room });

    const unsubs = [
      subscribe('live:message', (msg) => {
        setMessages((prev) => [...prev.slice(-99), msg]);
      }),
      // Un regalo también aparece como línea del chat, además de su animación:
      // así queda constancia de quién regaló qué cuando la animación se va.
      subscribe('live:gift', (gift) => {
        onGift?.(gift);
        setMessages((prev) => [
          ...prev.slice(-99),
          { system: true, text: `🎁 @${gift.from} envió ${gift.giftName}`, at: gift.at },
        ]);
      }),
      subscribe('live:error', ({ error: message }) => setError(message || 'No se pudo abrir el chat')),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
      emit('live:leave', { room });
    };
  }, [room, emit, subscribe, onGift]);

  // El último mensaje siempre a la vista, como en cualquier chat en vivo.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    // El servidor reenvía el mensaje a todos los de la sala, incluido quien lo
    // escribió, así que no hace falta pintarlo aquí: aparecerá con el mismo
    // aspecto para todos (y sin duplicarse).
    emit('live:message', { room, text: body });
    setText('');
  }

  return (
    <div
      className={`live-chat ${hidden ? 'live-chat-hidden' : ''}`}
      aria-label="Comentarios del directo"
      aria-hidden={hidden}
    >
      <ul className="live-chat-list" ref={listRef}>
        {messages.map((msg, i) => (
          <li key={`${msg.at}-${i}`} className={msg.system ? 'live-chat-system' : ''}>
            {!msg.system && <strong>@{msg.user}</strong>} {msg.text}
          </li>
        ))}
      </ul>

      {error && <p className="live-chat-error" role="alert">{error}</p>}

      <form className="live-chat-form" onSubmit={send}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribe un comentario…"
          maxLength={200}
          aria-label="Comentario"
        />
        <button type="submit" className="live-chat-send" disabled={!text.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}
