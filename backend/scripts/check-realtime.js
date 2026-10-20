#!/usr/bin/env node
/**
 * Comprueba que un mensaje enviado por REST llega en vivo al destinatario por
 * socket, sin recargar nada.
 *
 * Este es el caso que se rompía: el cliente publica por REST y la difusión solo
 * ocurría en la ruta del socket, así que el otro usuario no veía nada hasta
 * refrescar.
 *
 * Uso: node scripts/check-realtime.js
 */
const { io } = require('socket.io-client');

const API = 'http://127.0.0.1:4000/api';
const WS = 'http://127.0.0.1:4000';

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error || res.status}`);
  return data;
}

function waitFor(socket, event, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`sin "${event}" en ${timeoutMs}ms`)),
      timeoutMs
    );
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

(async () => {
  const stamp = Date.now();

  const ana = await call('/auth/register', {
    method: 'POST',
    body: {
      username: `rt_ana_${stamp}`,
      email: `rt_ana_${stamp}@example.com`,
      password: 'secret123',
    },
  });
  const bruno = await call('/auth/register', {
    method: 'POST',
    body: {
      username: `rt_bruno_${stamp}`,
      email: `rt_bruno_${stamp}@example.com`,
      password: 'secret123',
    },
  });

  const { conversationId } = await call('/messages/conversations', {
    method: 'POST',
    token: ana.token,
    body: { userId: bruno.user.id },
  });

  // Bruno abre su sesión de socket y se une al hilo, como haría su pestaña.
  const brunoSocket = io(WS, { auth: { token: bruno.token }, transports: ['websocket'] });
  await waitFor(brunoSocket, 'connect');
  brunoSocket.emit('chat:join', { conversationId });
  await new Promise((r) => setTimeout(r, 300));

  const incoming = waitFor(brunoSocket, 'chat:message');
  const notified = waitFor(brunoSocket, 'chat:notify');

  // Ana envía por REST, que es exactamente lo que hace la interfaz.
  await call(`/messages/conversations/${conversationId}/messages`, {
    method: 'POST',
    token: ana.token,
    body: { text: '¿Te llega en vivo?' },
  });

  const [message, notify] = await Promise.all([incoming, notified]);

  const ok =
    message.text === '¿Te llega en vivo?' &&
    String(message.conversation) === String(conversationId) &&
    notify.text === message.text;

  brunoSocket.close();

  if (!ok) {
    console.error('❌ el mensaje llegó con datos inesperados');
    process.exit(1);
  }

  console.log('✅ el mensaje enviado por REST llegó en vivo al destinatario');
  console.log(`   chat:message -> "${message.text}" de @${message.sender.username}`);
  console.log('   chat:notify  -> aviso de no leído recibido');
})().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
