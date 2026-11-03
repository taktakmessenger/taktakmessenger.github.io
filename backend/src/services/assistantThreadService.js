const AssistantThread = require('../models/AssistantThread');

// Memoria del asistente del administrador.
//
// Antes el historial lo mandaba el navegador en cada petición. Eso lo hacía
// frágil: al recargar, cerrar sesión o abrir el panel desde otro dispositivo la
// conversación desaparecía y el asistente contestaba que no tenía memoria. Ahora
// el hilo se guarda por administrador en la base de datos.
//
// El hilo se recorta a los últimos `MAX_MESSAGES` turnos: la conversación debe
// ser memoria útil, no un archivo que crezca sin límite. Con 40 turnos (20
// intercambios) sobra para "¿dónde quedamos?" sin acercarse al límite de
// contexto del modelo.
const MAX_MESSAGES = 40;

// Devuelve el hilo guardado como lista de mensajes { role, content }, listo para
// reenviar al modelo. Un administrador sin historial devuelve lista vacía.
async function load(adminId) {
  const thread = await AssistantThread.findOne({ admin: adminId }).select('messages');
  if (!thread) return [];
  return thread.messages.map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Añade turnos al hilo y devuelve la conversación completa ya recortada.
 *
 * `messages` es una lista de { role, content }. Se usa `$push` con `$slice` para
 * que el recorte lo haga MongoDB en la misma escritura y no haya que leer,
 * recortar y volver a escribir (que se pisaría si dos turnos entran a la vez).
 */
async function append(adminId, messages) {
  const clean = messages
    .filter((m) => m && m.content && String(m.content).trim())
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content).slice(0, 4000),
      at: new Date(),
    }));

  if (!clean.length) return load(adminId);

  const thread = await AssistantThread.findOneAndUpdate(
    { admin: adminId },
    {
      $setOnInsert: { admin: adminId },
      $push: { messages: { $each: clean, $slice: -MAX_MESSAGES } },
    },
    { new: true, upsert: true, select: 'messages' }
  );

  return thread.messages.map((m) => ({ role: m.role, content: m.content }));
}

// Borra el hilo del administrador. Lo usa el botón "Limpiar" del panel.
async function clear(adminId) {
  await AssistantThread.deleteOne({ admin: adminId });
}

module.exports = { load, append, clear, MAX_MESSAGES };
