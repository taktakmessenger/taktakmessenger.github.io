import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { userId } from '../lib/user';
import { formatDuration } from '../lib/voiceNote';
import { resolveViewerLanguage, normalizeLanguage, languageNativeName } from '../lib/translate';
import TranslateButton from './TranslateButton';
import TranslateIcon from './TranslateIcon';
import { translateBatch } from '../lib/translateClient';
import VoiceTranscript from './VoiceTranscript';
import Dialer from './Dialer';
import VoiceRecorder from './VoiceRecorder';

function initials(person) {
  const name = person?.displayName || person?.username || '?';
  return name.slice(0, 2).toUpperCase();
}

// El mismo usuario llega con `_id` desde /users/me y con `id` desde el resto de
// la API. La normalización vive en `lib/user` porque no es cosa solo de este
// componente: sin ella, `user.id` es `undefined` y ni se empareja la copia
// optimista (el mensaje se duplica) ni se distingue el lado de la burbuja.

// Incorpora un mensaje confirmado por el servidor al hilo sin duplicarlo.
//
// El mismo mensaje llega por dos vías: el eco del socket y la respuesta del
// POST. Además hay una copia optimista en pantalla. Por eso se retira cualquier
// pendiente que este mensaje sustituya y, si el id ya está, no se vuelve a
// añadir: con dos hijos de la misma `key` React descarta uno y el hilo queda
// descolocado.
function mergeMessage(prev, incoming) {
  const senderId = userId(incoming.sender);

  // La copia optimista se reconoce por emisor, texto y adjunto. No basta con el
  // texto: dos fotos enviadas seguidas sin pie de foto comparten texto vacío y
  // la segunda borraría a la primera. El adjunto se compara por su URL, que es
  // única por archivo subido.
  const withoutEcho = prev.filter(
    (m) =>
      !(
        m.pending &&
        String(userId(m.sender)) === String(senderId) &&
        m.text === incoming.text &&
        (m.attachment?.url || null) === (incoming.attachment?.url || null)
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
  // La otra cuenta ya no existe (se eliminó). Se distingue de "aún cargando"
  // para poder explicarlo, en vez de dejar los botones muertos sin motivo.
  const [peerMissing, setPeerMissing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // Presencia del interlocutor y si está escribiendo, al estilo WhatsApp.
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const bottomRef = useRef(null);
  const typingSentAt = useRef(0);
  const typingStopTimer = useRef(null);
  // Adjunto elegido y aún no enviado. Se sube al servidor en cuanto se elige,
  // para que el envío del mensaje sea inmediato; aquí solo se guarda la
  // referencia que devolvió el servidor.
  const [attachment, setAttachment] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Traducción del hilo. El idioma del que lee sale de lo que eligió en Ajustes
  // y, si no eligió nada, del idioma del navegador. El del otro viene con la
  // conversación, y se usa como pista: en una frase corta ("ok", "sí") es la
  // única señal fiable que hay.
  const viewerLanguage = resolveViewerLanguage({ preferred: user?.preferredLanguage });
  const peerLanguage = normalizeLanguage(peer?.preferredLanguage);
  // Apagada por defecto, y encendida si esta persona activó la traducción
  // automática en sus ajustes. Traducir cuesta dinero, así que no se enciende
  // sola a espaldas de nadie.
  const [translateOn, setTranslateOn] = useState(Boolean(user?.autoTranslate));
  // Se pone a `true` cuando el lote de traducción del hilo ya está en la caché.
  // Las burbujas esperan a esta señal para recoger su traducción: sin ella, una
  // burbuja ya montada se quedaría con el resultado vacío de la caché.
  const [translateReady, setTranslateReady] = useState(false);

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
        setPeerMissing(Boolean(current?.peerMissing));
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

  // Al encender la traducción del hilo, se piden de una vez los mensajes que ya
  // están en pantalla. Cada burbuja pediría el suyo al montarse, y veinte
  // mensajes serían veinte peticiones que saltarían el límite por minuto del
  // servidor. El lote deja las traducciones en la caché, y las burbujas las
  // recogen cuando `translateReady` les avisa.
  //
  // Los mensajes que llegan después del lote ya no pasan por aquí: los traduce su
  // propia burbuja al montarse, que es una sola petición.
  const batchRef = useRef({ key: null, done: false });
  useEffect(() => {
    if (!translateOn) return undefined;

    const key = `${conversationId}|${viewerLanguage}|${peerLanguage}|${translateOn}`;
    if (batchRef.current.key !== key) {
      batchRef.current = { key, done: false };
      setTranslateReady(false);
    }
    // El lote ya se pidió para este hilo y esta configuración.
    if (batchRef.current.done) return undefined;

    const texts = messages
      .filter(
        (m) =>
          String(userId(m.sender)) !== String(userId(user)) &&
          m.text &&
          String(m.text).trim()
      )
      .map((m) => m.text)
      // El servidor acepta 30 por lote. Un hilo largo se traduce por la cola, que
      // es lo que el usuario tiene a la vista; lo de más arriba se traduce al
      // subir, con el botón de cada burbuja.
      .slice(-30);
    // Sin mensajes todavía (el hilo acaba de abrirse) no se marca como hecho: se
    // pide el lote en cuanto lleguen, en vez de quedarse sin traducir.
    if (texts.length === 0) return undefined;

    batchRef.current.done = true;
    const token = batchRef.current;
    translateBatch({ texts, to: viewerLanguage, hint: peerLanguage })
      .catch(() => {
        // Un fallo del lote no rompe el hilo: cada burbuja sigue ofreciendo su
        // botón para traducir a mano.
      })
      .finally(() => {
        // Solo avisa si sigue siendo el lote vigente: si se cambió de hilo
        // mientras tanto, su resultado ya no pinta nada.
        if (batchRef.current === token) setTranslateReady(true);
      });

    return undefined;
  }, [translateOn, conversationId, viewerLanguage, peerLanguage, messages, user]);

  // Sube el archivo elegido y guarda la referencia. Se sube al elegirlo y no al
  // enviar, para que el usuario vea una vista previa y pueda quitar el archivo
  // antes de mandarlo, y para que el envío no dependa de una subida lenta.
  async function pickFile(event) {
    const file = event.target.files?.[0];
    // Se limpia el input para poder elegir el mismo archivo otra vez.
    event.target.value = '';
    if (!file) return;

    setError('');
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/messages/attachments', form);
      setAttachment(data.attachment);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function clearAttachment() {
    setAttachment(null);
  }

  // Nota de voz recién grabada: se sube y se envía en un solo gesto, como al
  // soltar el botón en WhatsApp. No se deja como vista previa pendiente porque
  // el gesto ya terminó: pedir un segundo toque para "Enviar" rompería la
  // expectativa de que soltar envía.
  async function sendVoiceNote(file, durationSeconds) {
    setError('');
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/messages/attachments', form);
      const note = { ...data.attachment, durationSeconds };

      // Se reutiliza el mismo camino que un mensaje con adjunto: la copia
      // optimista, el POST y el `mergeMessage`. Duplicar esa lógica para el
      // audio sería la forma segura de que los ticks se comportaran distinto.
      const optimistic = {
        id: `local-${Date.now()}`,
        conversation: conversationId,
        sender: { id: userId(user), username: user.username },
        kind: 'attachment',
        text: '',
        attachment: note,
        status: 'pending',
        createdAt: new Date().toISOString(),
        pending: true,
      };
      setMessages((prev) => [...prev, optimistic]);

      const { data: sent } = await api.post(
        `/messages/conversations/${conversationId}/messages`,
        { attachment: note }
      );
      setMessages((prev) => mergeMessage(prev, sent.message));
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function send(event) {
    event.preventDefault();
    const body = text.trim();
    // Sin texto ni adjunto no hay nada que enviar.
    if (!body && !attachment) return;

    setText('');
    setAttachment(null);
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
      kind: attachment ? 'attachment' : 'text',
      text: body,
      attachment: attachment || null,
      status: 'pending',
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);

    api
      .post(`/messages/conversations/${conversationId}/messages`, {
        text: body,
        attachment: attachment || undefined,
      })
      .then(({ data }) => {
        // `mergeMessage` retira la copia pendiente y, si el eco del socket ya
        // añadió el mensaje, no lo repite.
        setMessages((prev) => mergeMessage(prev, data.message));
      })
      .catch((err) => {
        setError(err.message);
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        // Se devuelven texto y adjunto para que el usuario no tenga que
        // volver a subir el archivo.
        setText(body);
        setAttachment(optimistic.attachment);
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
          <span className="avatar">{peerMissing ? '?' : initials(peer)}</span>
          <div className="thread-peer-id">
            <strong>
              {peerMissing
                ? 'Cuenta eliminada'
                : peer?.profile?.displayName || `@${peer?.username || '…'}`}
            </strong>
            <small className={peerTyping ? 'typing' : peerOnline ? 'online' : ''}>
              {peerMissing
                ? 'Esta persona ya no está en TAK TAK'
                : peerTyping
                  ? 'escribiendo…'
                  : lastSeenLabel(peer, peerOnline)}
            </small>
          </div>
        </div>
        <div className="thread-call">
          <button
            type="button"
            className={`btn-secondary translate-toggle ${translateOn ? 'on' : ''}`}
            onClick={() => setTranslateOn((prev) => !prev)}
            aria-pressed={translateOn}
            aria-label={translateOn ? 'Desactivar traducción automática' : 'Activar traducción automática'}
            title={
              translateOn
                ? `Traduciendo a ${languageNativeName(viewerLanguage) || viewerLanguage}`
                : 'Traducir los mensajes a mi idioma'
            }
          >
            <TranslateIcon size={18} active={translateOn} />
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!peer}
            title={peerMissing ? 'Esta cuenta ya no existe' : undefined}
            onClick={() => onCall?.(peer, 'audio')}
            aria-label="Llamada de voz"
          >
            📞
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!peer}
            title={peerMissing ? 'Esta cuenta ya no existe' : undefined}
            onClick={() => onCall?.(peer, 'video')}
            aria-label="Videollamada"
          >
            🎥
          </button>
        </div>
      </div>

      {translateOn && (
        <div className="translate-banner">
          <TranslateIcon size={16} active />
          <span>
            Traducción a {languageNativeName(viewerLanguage) || viewerLanguage}
            {peerLanguage ? ` · ${peer?.profile?.displayName || `@${peer?.username}`} escribe en ${
              languageNativeName(peerLanguage) || peerLanguage
            }` : ''}
          </span>
        </div>
      )}

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
                <div className={`bubble ${m.pending ? 'pending' : ''} ${m.attachment ? 'has-attachment' : ''}`}>
                  <Attachment
                    attachment={m.attachment}
                    pending={m.pending}
                    translateTarget={viewerLanguage}
                    translateHint={peerLanguage}
                    canTranslate={!mine}
                  />
                  {m.text && <span className="bubble-text">{m.text}</span>}

                  {/* El botón va en la burbuja del otro: traducir lo que uno
                      mismo escribió no sirve de nada, y un icono en cada burbuja
                      propia solo añade ruido al hilo. `auto` traduce solo cuando
                      el hilo tiene la traducción encendida. */}
                  {!mine && (
                    <TranslateButton
                      text={m.text}
                      target={viewerLanguage}
                      hint={peerLanguage}
                      compact
                      auto={translateOn}
                      ready={translateReady}
                    />
                  )}

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
        {/* Input oculto: el botón visible solo lo dispara. `accept` filtra el
            selector del sistema, y el servidor vuelve a validar de todas formas:
            lo que el usuario pueda forzar en el navegador no es de fiar. */}
        <input
          ref={fileInputRef}
          type="file"
          className="visually-hidden"
          onChange={pickFile}
          accept="image/*,video/*,audio/*,.pdf,.txt,.csv,.md,.json,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
          aria-label="Adjuntar archivo"
        />
        <button
          type="button"
          className="composer-attach"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label="Adjuntar archivo"
          title="Adjuntar archivo"
        >
          {uploading ? '⏳' : '📎'}
        </button>

        {/* Nota de voz: mantener pulsado graba, soltar envía. Se desactiva
            mientras hay texto escrito, porque en ese caso el gesto natural es
            enviar el texto y no empezar una grabación. */}
        <VoiceRecorder
          onRecorded={sendVoiceNote}
          disabled={uploading || Boolean(text.trim())}
        />

        {attachment && (
          <div className="composer-preview">
            {attachment.kind === 'image' ? (
              <img src={attachment.url} alt="" className="preview-thumb" />
            ) : (
              <span className="preview-icon" aria-hidden="true">
                {attachment.kind === 'video' ? '🎥' : attachment.kind === 'audio' ? '🎤' : '📎'}
              </span>
            )}
            <span className="preview-name">{attachment.name}</span>
            <button
              type="button"
              className="preview-remove"
              onClick={clearAttachment}
              aria-label="Quitar adjunto"
            >
              ✕
            </button>
          </div>
        )}

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
        <button type="submit" className="btn-primary" disabled={(!text.trim() && !attachment) || uploading}>
          Enviar
        </button>
      </form>
    </div>
  );
}

// Reproductor de una nota de voz, con la barra de progreso y el tiempo, como en
// WhatsApp. Se usa un `<audio>` oculto y se pinta la barra a mano: los controles
// nativos del navegador no se pueden estilizar y rompen el diseño del chat.
function VoiceBubble({ attachment, translateTarget, translateHint, canTranslate }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Duración: la que guardó el servidor al enviar. Si no la hay (un audio
  // adjunto a mano), se toma la del propio archivo en cuanto se conoce.
  const [duration, setDuration] = useState(attachment.durationSeconds || 0);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      return;
    }
    // Solo suena una nota a la vez: pausar las demás evita que dos audios se
    // solapen al ir pulsando por el hilo.
    document.querySelectorAll('audio[data-voice]').forEach((other) => {
      if (other !== el) other.pause();
    });
    el.play().catch(() => {});
  }

  const total = duration || 0;
  const progress = total > 0 ? Math.min(1, elapsed / total) : 0;

  return (
    <div className="bubble-attachment bubble-voice">
      <button
        type="button"
        className="voice-play"
        onClick={toggle}
        aria-label={playing ? 'Pausar nota de voz' : 'Reproducir nota de voz'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="voice-track" aria-hidden="true">
        <div className="voice-track-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <small className="voice-duration">
        {formatDuration(playing || elapsed > 0 ? elapsed : total)}
      </small>

      {/* Transcribir y traducir la nota. Solo en las notas del otro: la propia
          se sabe lo que dice, y transcribirla gastaría una llamada al proveedor
          para nada. El botón se ofrece siempre en las notas ajenas porque el
          cliente no sabe si el servidor tiene proveedor de STT: se intenta
          primero el servidor y, si no lo hay (503), se cae al reconocimiento del
          navegador. Cuando ninguna de las dos vías existe, `VoiceTranscript`
          enseña el motivo en vez de quedarse en blanco. */}
      {canTranslate && (
        <VoiceTranscript
          attachment={attachment}
          target={translateTarget}
          hint={translateHint}
        />
      )}

      <audio
        ref={audioRef}
        data-voice
        src={attachment.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setElapsed(0);
        }}
        onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const known = e.currentTarget.duration;
          // `duration` puede llegar como Infinity en algunos webm grabados sin
          // cabecera de duración; en ese caso se conserva la del servidor.
          if (Number.isFinite(known) && known > 0) {
            setDuration((prev) => (prev > 0 ? prev : Math.round(known)));
          }
        }}
      />
    </div>
  );
}

// Adjunto dentro de una burbuja. Cada tipo se pinta como se espera en un chat:
// la imagen se ve, el vídeo y el audio se reproducen ahí mismo, y el resto se
// ofrece como descarga con su nombre y tamaño.
function Attachment({ attachment, pending, translateTarget, translateHint, canTranslate }) {
  if (!attachment) return null;

  const url = attachment.url;
  const size = formatSize(attachment.size);

  if (attachment.kind === 'image') {
    return (
      <a
        className="bubble-attachment bubble-image"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <img src={url} alt={attachment.name || 'Imagen'} loading="lazy" />
      </a>
    );
  }

  if (attachment.kind === 'video') {
    return (
      <video
        className="bubble-attachment bubble-video"
        src={url}
        controls
        preload="metadata"
        // Sin esto, en móvil el vídeo se abre a pantalla completa al tocarlo.
        playsInline
      />
    );
  }

  if (attachment.kind === 'audio') {
    // Una nota de voz y un archivo de audio suelto se pintan igual: un
    // reproductor con barra. La diferencia es solo de dónde salió el archivo.
    return (
      <VoiceBubble
        attachment={attachment}
        translateTarget={translateTarget}
        translateHint={translateHint}
        canTranslate={canTranslate}
      />
    );
  }

  // Archivo genérico: se descarga. Se muestra el icono, el nombre y el tamaño.
  return (
    <a
      className="bubble-attachment bubble-file"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.name || undefined}
    >
      <span className="bubble-file-icon" aria-hidden="true">
        📎
      </span>
      <span className="bubble-file-info">
        <span className="bubble-file-name">{attachment.name || 'Archivo'}</span>
        {size && <span className="bubble-file-size">{size}</span>}
      </span>
    </a>
  );
}

// Tamaño legible. Se redondea a una cifra: "1,2 MB" es lo que se quiere leer,
// no "1,1876 MB".
function formatSize(bytes) {
  if (!bytes || bytes < 1024) return bytes ? `${bytes} B` : '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
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
            // Sin interlocutor solo cabe una lectura: la otra cuenta se
            // eliminó. Mostrar `@undefined` era el síntoma de no contemplarlo.
            const name = c.peerMissing
              ? 'Cuenta eliminada'
              : other?.displayName || `@${other?.username}`;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={`conversation-item ${c.unread > 0 ? 'unread' : ''}`}
                  onClick={() => setOpenId(c.id)}
                >
                  <span className="avatar-wrap">
                    <span className="avatar">{c.peerMissing ? '?' : initials(other)}</span>
                    {(online[String(other?.id)] ?? false) && <span className="presence-dot" />}
                  </span>
                  <span className="conversation-main">
                    <span className="conversation-top">
                      <strong>{name}</strong>
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
