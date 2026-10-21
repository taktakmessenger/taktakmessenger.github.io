import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import Dialer from './Dialer';

function initials(person) {
  const name = person?.displayName || person?.username || '?';
  return name.slice(0, 2).toUpperCase();
}

// El mismo usuario llega con `_id` desde /users/me y con `id` desde el resto de
// la API. Sin normalizar, `user.id` es `undefined` y ni se empareja la copia
// optimista (el mensaje se duplica) ni se distingue el lado de la burbuja.
function userId(person) {
  return person?._id ?? person?.id ?? null;
}

// Incorpora un mensaje confirmado por el servidor al hilo sin duplicarlo.
//
// El mismo mensaje llega por dos vías: el eco del socket y la respuesta del
// POST. Además hay una copia optimista en pantalla. Por eso se retira cualquier
// pendiente que este mensaje sustituya y, si el id ya está, no se vuelve a
// añadir: con dos hijos de la misma `key` React descarta uno y el hilo queda
// descolocado.
function mergeMessage(prev, incoming) {
  const senderId = userId(incoming.sender);

  const withoutEcho = prev.filter(
    (m) =>
      !(
        m.pending &&
        String(userId(m.sender)) === String(senderId) &&
        m.text === incoming.text
      )
  );

  if (withoutEcho.some((m) => m.id === incoming.id)) return withoutEcho;
  return [...withoutEcho, incoming];
}

// Texto de una entrada de llamada, tal como se lee en el hilo. El estado es el
// mismo para los dos participantes, así que la etiqueta también lo es: no
// distingue "entrante" de "saliente", solo cómo acabó.
function callLabel(call) {
  const isVideo = call?.kind === 'video';
  const label = isVideo ? 'Videollamada' : 'Llamada';

  if (call?.status === 'answered') {
    const total = Math.max(0, call.durationSeconds || 0);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${label} de ${mins}:${String(secs).padStart(2, '0')}`;
  }
  if (call?.status === 'declined') return `${label} rechazada`;
  if (call?.status === 'cancelled') return `${label} cancelada`;
  if (call?.status === 'unreachable') return `${label} no disponible`;
  return `${label} perdida`;
}

// Hora corta, como en la cabecera de una burbuja de WhatsApp.
function clock(value) {
  if (!value) return '';
  const d = new Date(value);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// Etiqueta de separador de día. Hoy y ayer se nombran; el resto, con fecha.
function dayLabel(value) {
  const d = new Date(value);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function sameDay(a, b) {
  const x = new Date(a);
  const y = new Date(b);
  return x.toDateString() === y.toDateString();
}

// Última conexión, al estilo WhatsApp: si no está en línea, cuándo se le vio.
function lastSeenLabel(peer, online) {
  if (online) return 'en línea';
  if (!peer?.lastSeenAt) return 'última vez recientemente';
  const d = new Date(peer.lastSeenAt);
  const today = new Date().toDateString() === d.toDateString();
  if (today) return `última vez hoy a las ${clock(d)}`;
  return `última vez el ${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} a las ${clock(d)}`;
}

// Los ticks: ✓ enviado, ✓✓ entregado, ✓✓ azul leído.
function Ticks({ status }) {
  if (status === 'read') return <span className="ticks read" title="Leído">✓✓</span>;
  if (status === 'delivered') return <span className="ticks" title="Entregado">✓✓</span>;
  if (status === 'sent') return <span className="ticks" title="Enviado">✓</span>;
  return <span className="ticks pending" title="Enviando…">🕓</span>;
}

// La conversación abierta: cabecera con el otro participante, historial y caja
// de escritura. Se separa del listado para que el listado no tenga que
// preocuparse por el ciclo de vida del hilo.
function Thread({ conversationId, onBack, onCall }) {
  const { user } = useAuth();
  const { emit, subscribe } = useSocket();
  const [messages, setMessages] = useState([]);
  const [peer, setPeer] = useState(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // Presencia del interlocutor y si está escribiendo, al estilo WhatsApp.
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const bottomRef = useRef(null);
  const typingSentAt = useRef(0);
  const typingStopTimer = useRef(null);

  // Carga inicial del hilo y del interlocutor.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    Promise.all([
      api.get(`/messages/conversations/${conversationId}/messages`),
      api.get('/messages/conversations'),
      api.get(`/messages/conversations/${conversationId}/presence`).catch(() => ({ data: {} })),
    ])
      .then(([threadRes, inboxRes, presenceRes]) => {
        if (!active) return;
        setMessages(Array.isArray(threadRes.data?.messages) ? threadRes.data.messages : []);
        const inbox = Array.isArray(inboxRes.data?.conversations) ? inboxRes.data.conversations : [];
        const current = inbox.find((c) => c.id === conversationId);
        setPeer(current?.with?.[0] || null);
        const me = presenceRes?.data?.peers?.find(
          (p) => String(p.userId) !== String(userId(user))
        );
        setPeerOnline(Boolean(me?.online));
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [conversationId]);

  // Tiempo real: unirse a la sala del hilo y escuchar mensajes nuevos. Depende
  // de `subscribe`, que cambia cuando el socket termina de conectar, así que la
  // suscripción se registra de verdad aunque el socket llegue tarde.
  //
  // No depende del número de mensajes: si lo hiciera, cada mensaje nuevo
  // desharía y reharía la suscripción, y el evento que la provocó podría
  // perderse justo en ese hueco.
  useEffect(() => {
    if (!conversationId) return undefined;

    emit('chat:join', { conversationId });

    const unsubscribe = subscribe('chat:message', (message) => {
      if (String(message.conversation) !== String(conversationId)) return;
      setMessages((prev) => mergeMessage(prev, message));
      // Algo entró mientras se mira el hilo: se mantiene a cero.
      api.post(`/messages/conversations/${conversationId}/read`).catch(() => {});
      // Si el otro escribe y el mensaje entra, ya no está escribiendo.
      setPeerTyping(false);
    });

    // Recibos: el emisor ve sus ticks cambiar sin recargar.
    const unsubRead = subscribe('chat:read', (payload) => {
      if (String(payload?.conversationId) !== String(conversationId)) return;
      const ids = new Set((payload.ids || []).map(String));
      setMessages((prev) =>
        prev.map((m) => (ids.has(String(m.id)) ? { ...m, status: 'read' } : m))
      );
    });

    const unsubDelivered = subscribe('chat:delivered', (payload) => {
      if (String(payload?.conversationId) !== String(conversationId)) return;
      const ids = new Set((payload.ids || []).map(String));
      setMessages((prev) =>
        prev.map((m) =>
          ids.has(String(m.id)) && m.status !== 'read' ? { ...m, status: 'delivered' } : m
        )
      );
    });

    // "Escribiendo…" del otro participante.
    const unsubTyping = subscribe('chat:typing', (payload) => {
      if (String(payload?.conversationId) !== String(conversationId)) return;
      if (String(payload.userId) === String(userId(user))) return;
      setPeerTyping(Boolean(payload.typing));
    });

    // Presencia del otro.
    const unsubPresence = subscribe('chat:presence', (payload) => {
      if (!peer || String(payload?.userId) !== String(peer.id)) return;
      setPeerOnline(Boolean(payload.online));
      setPeer((prev) => (prev ? { ...prev, lastSeenAt: payload.at } : prev));
    });

    // Marca como leído al abrir el hilo.
    api.post(`/messages/conversations/${conversationId}/read`).catch(() => {});

    return () => {
      unsubscribe();
      unsubRead();
      unsubDelivered();
      unsubTyping();
      unsubPresence();
      emit('chat:leave', { conversationId });
    };
  }, [conversationId, emit, subscribe, peer?.id, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  function send(event) {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;

    setText('');
    // Se deja de escribir al enviar, para que el otro no siga viendo los puntos.
    setPeerTyping(false);
    clearTimeout(typingStopTimer.current);
    emit('chat:typing', { conversationId, typing: false });

    // Optimista: se pinta de inmediato y el servidor confirma con el mismo id
    // más abajo. Si falla, el mensaje se retira y se muestra el error.
    const optimistic = {
      id: `local-${Date.now()}`,
      conversation: conversationId,
      sender: { id: userId(user), username: user.username },
      text: body,
      status: 'pending',
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);

    api
      .post(`/messages/conversations/${conversationId}/messages`, { text: body })
      .then(({ data }) => {
        // `mergeMessage` retira la copia pendiente y, si el eco del socket ya
        // añadió el mensaje, no lo repite.
        setMessages((prev) => mergeMessage(prev, data.message));
      })
      .catch((err) => {
        setError(err.message);
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setText(body);
      });
  }

  // Avisa de que se está escribiendo, con dos frenos: no se repite el evento en
  // cada pulsación (se espacia) y se manda el "he parado" solo tras una pausa.
  // Sin el espaciado, teclear una frase dispararía decenas de eventos por socket.
  function notifyTyping() {
    const now = Date.now();
    if (now - typingSentAt.current > 2500) {
      typingSentAt.current = now;
      emit('chat:typing', { conversationId, typing: true });
    }
    clearTimeout(typingStopTimer.current);
    typingStopTimer.current = setTimeout(() => {
      emit('chat:typing', { conversationId, typing: false });
      typingSentAt.current = 0;
    }, 2500);
  }

  return (
    <div className="thread">
      <div className="thread-header">
        <button type="button" className="btn-ghost" onClick={onBack} aria-label="Volver">
          ←
        </button>
        <div className="thread-peer">
          <span className="avatar">{initials(peer)}</span>
          <div className="thread-peer-id">
            <strong>{peer?.profile?.displayName || `@${peer?.username || '…'}`}</strong>
            <small className={peerTyping ? 'typing' : peerOnline ? 'online' : ''}>
              {peerTyping ? 'escribiendo…' : lastSeenLabel(peer, peerOnline)}
            </small>
          </div>
        </div>
        <div className="thread-call">
          <button
            type="button"
            className="btn-secondary"
            disabled={!peer}
            onClick={() => onCall?.(peer, 'audio')}
            aria-label="Llamada de voz"
          >
            📞
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!peer}
            onClick={() => onCall?.(peer, 'video')}
            aria-label="Videollamada"
          >
            🎥
          </button>
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="thread-body">
        {loading && <p className="muted">Cargando…</p>}
        {!loading && messages.length === 0 && (
          <p className="muted">Todavía no hay mensajes. Escribe el primero.</p>
        )}

        {messages.map((m, index) => {
          const mine = String(userId(m.sender)) === String(userId(user));
          // Separador de día cuando cambia respecto al mensaje anterior, como
          // en WhatsApp: sin él, un hilo largo no dice cuándo se dijo cada cosa.
          const prev = messages[index - 1];
          const showDay = !prev || !sameDay(prev.createdAt, m.createdAt);

          // Las llamadas comparten hilo con el texto, pero se pintan como una
          // tarjeta con su estado y duración en vez de como una burbuja.
          if (m.kind === 'call') {
            return (
              <div key={m.id}>
                {showDay && <div className="day-sep"><span>{dayLabel(m.createdAt)}</span></div>}
                <div className={`bubble-row ${mine ? 'mine' : 'theirs'}`}>
                  <div className="bubble call-bubble">
                    <span aria-hidden="true">{m.call?.kind === 'video' ? '🎥' : '📞'}</span>
                    <span>{callLabel(m.call)}</span>
                    <small className="bubble-time">{clock(m.createdAt)}</small>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={m.id}>
              {showDay && <div className="day-sep"><span>{dayLabel(m.createdAt)}</span></div>}
              <div className={`bubble-row ${mine ? 'mine' : 'theirs'}`}>
                <div className={`bubble ${m.pending ? 'pending' : ''}`}>
                  <span className="bubble-text">{m.text}</span>
                  <span className="bubble-meta">
                    <span className="bubble-time">{clock(m.createdAt)}</span>
                    {mine && <Ticks status={m.pending ? 'pending' : m.status} />}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {peerTyping && (
          <div className="bubble-row theirs">
            <div className="bubble typing-bubble" aria-label="Escribiendo">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="thread-composer" onSubmit={send}>
        <input
          type="text"
          placeholder="Escribe un mensaje…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) notifyTyping();
          }}
          maxLength={2000}
          aria-label="Mensaje"
        />
        <button type="submit" className="btn-primary" disabled={!text.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}

export default function Messages({ onCall, initialUser, onConsumeInitialUser, onOpenChat }) {
  const [conversations, setConversations] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [username, setUsername] = useState('');
  const [query, setQuery] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [online, setOnline] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // WhaTaka agrupa los dos modos: los chats y el marcador para llamar a un
  // número. Van en la misma vista porque son la misma idea (hablar con alguien)
  // y así el botón de llamada no obliga a salir de la app.
  const [mode, setMode] = useState('chats');
  const { subscribe } = useSocket();

  function loadInbox() {
    return api
      .get('/messages/conversations')
      .then(({ data }) => setConversations(data.conversations))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    loadInbox();
  }, []);

  // Presencia en la bandeja: el punto verde del avatar se actualiza en vivo sin
  // recargar la lista, que es lo que se espera al mirar los chats abiertos.
  useEffect(() => {
    const unsubscribe = subscribe('chat:presence', (payload) => {
      setOnline((prev) => ({ ...prev, [String(payload.userId)]: Boolean(payload.online) }));
    });
    return unsubscribe;
  }, [subscribe]);

  // Abre el chat de un usuario concreto cuando se llega desde el feed. El
  // aviso se consume una sola vez para que volver a Mensajes no reabra el hilo.
  useEffect(() => {
    if (!initialUser) return;
    const targetId = initialUser._id || initialUser.id;
    if (!targetId) return;

    let active = true;
    api
      .post('/messages/conversations', { userId: targetId })
      .then(({ data }) => {
        if (!active) return;
        setOpenId(data.conversationId);
        loadInbox();
      })
      .catch((err) => active && setError(err.message))
      .finally(() => onConsumeInitialUser?.());

    return () => {
      active = false;
    };
  }, [initialUser, onConsumeInitialUser]);

  // Un mensaje entrante reordena la bandeja y sube el contador de no leídos,
  // aunque el usuario esté en otra pestaña de la app.
  useEffect(() => {
    const unsubscribe = subscribe('chat:notify', () => loadInbox());
    return unsubscribe;
  }, [subscribe]);

  async function startConversation(event) {
    event.preventDefault();
    const name = username.trim().replace(/^@/, '');
    if (!name) return;

    setBusy(true);
    setError('');
    try {
      const found = await api.get(`/users/${encodeURIComponent(name)}`);
      const targetId = found.data.user?._id || found.data.user?.id;
      const { data } = await api.post('/messages/conversations', { userId: targetId });
      setUsername('');
      await loadInbox();
      setOpenId(data.conversationId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (openId) {
    return (
      <Thread
        conversationId={openId}
        onBack={() => {
          setOpenId(null);
          loadInbox();
        }}
        onCall={onCall}
      />
    );
  }

  const visible = conversations.filter((c) => {
    const name = c.with?.[0]?.username || '';
    if (!query.trim()) return true;
    return name.toLowerCase().includes(query.trim().replace(/^@/, '').toLowerCase());
  });

  // Abrir un chat desde el marcador tras resolver el número.
  function openChatWith(user) {
    api
      .post('/messages/conversations', { userId: user.id || user._id })
      .then(({ data }) => {
        setMode('chats');
        setOpenId(data.conversationId);
        loadInbox();
      })
      .catch((err) => setError(err.message));
  }

  if (mode === 'dial') {
    return (
      <div className="messages">
        <div className="messages-head">
          <h2>📞 WhaTaka</h2>
        </div>
        <div className="whataka-tabs">
          <button
            type="button"
            className="whataka-tab"
            onClick={() => setMode('chats')}
          >
            💬 Chats
          </button>
          <button type="button" className="whataka-tab active" aria-current="page">
            📞 Llamar
          </button>
        </div>
        <Dialer onCall={onCall} onOpenChat={openChatWith} />
      </div>
    );
  }

  return (
    <div className="messages">
      <div className="messages-head">
        <h2>💬 WhaTaka</h2>
        <button
          type="button"
          className="btn-primary btn-new-chat"
          onClick={() => setShowNew((v) => !v)}
          aria-label="Nuevo chat"
        >
          {showNew ? '✖' : '＋'}
        </button>
      </div>

      <div className="whataka-tabs">
        <button type="button" className="whataka-tab active" aria-current="page">
          💬 Chats
        </button>
        <button type="button" className="whataka-tab" onClick={() => setMode('dial')}>
          📞 Llamar
        </button>
      </div>

      <p className="muted">Habla en privado con quien quieras, sin anuncios ni ruido.</p>

      <input
        type="search"
        className="inbox-search"
        placeholder="Buscar en tus chats"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Buscar conversaciones"
      />

      {showNew && (
        <form className="start-chat" onSubmit={startConversation}>
          <input
            type="text"
            placeholder="@usuario con quien hablar"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-label="Usuario"
          />
          <button type="submit" className="btn-primary" disabled={busy || !username.trim()}>
            {busy ? 'Abriendo…' : 'Abrir chat'}
          </button>
        </form>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="muted">
          {query.trim() ? 'Ningún chat coincide con la búsqueda.' : 'No tienes conversaciones todavía.'}
        </p>
      ) : (
        <ul className="conversation-list">
          {visible.map((c) => {
            const other = c.with?.[0];
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={`conversation-item ${c.unread > 0 ? 'unread' : ''}`}
                  onClick={() => setOpenId(c.id)}
                >
                  <span className="avatar-wrap">
                    <span className="avatar">{initials(other)}</span>
                    {(online[String(other?.id)] ?? false) && <span className="presence-dot" />}
                  </span>
                  <span className="conversation-main">
                    <span className="conversation-top">
                      <strong>{other?.displayName || `@${other?.username}`}</strong>
                      <small className="conversation-time">{clock(c.lastMessageAt)}</small>
                    </span>
                    <small className="conversation-preview">
                      {c.lastMessagePreview || 'Sin mensajes'}
                    </small>
                  </span>
                  {c.unread > 0 && <span className="badge">{c.unread}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
