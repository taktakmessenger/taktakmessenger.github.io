# AGENTS.md

Guía para agentes que trabajen en este repositorio.

## Resumen

TAK TAK: plataforma de video con economía de tokens TTC.
- `backend/` — API Express + Mongoose (CommonJS).
- `frontend/` — React 18 + Vite (ESM, JSX).

## Comandos

```bash
# Pila completa (Docker + MongoDB + web + API). Idempotente, y arranca además
# el vigilante. Por defecto sirve todo desde un solo proceso (SERVE_MODE=single).
bash scripts/dev-up.sh
bash scripts/dev-down.sh

# Con recarga en caliente del frontend (dos procesos + proxy de Vite)
SERVE_MODE=split bash scripts/dev-up.sh

# Vigilante suelto (dev-up ya lo enciende solo; guarda contra duplicados)
setsid bash scripts/dev-watch.sh > /tmp/taktak-watch.log 2>&1 < /dev/null &

# Backend
cd backend && npm install
npm run dev                                  # servidor con watch
TEST_MONGODB_URI=mongodb://localhost:27017/taktak_test npm test

# Frontend
cd frontend && npm install
npm run dev
npm run build

# Base de datos (replica set de un nodo, necesario para transacciones)
docker run -d --name taktak-mongo -p 27017:27017 mongo:6 mongod --replSet rs0 --bind_ip_all
docker exec taktak-mongo mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'
```

### Notas del entorno (contenedor de desarrollo)

- El usuario **no** pertenece al grupo `docker`: hay que usar `sudo docker`.
  `scripts/dev-up.sh` detecta esto solo y guarda el comando en `$DOCKER`.
- **No hay `ss`, `lsof` ni `fuser`** en el contenedor. Para saber si algo está
  vivo, usa `curl` contra el endpoint o `pgrep -f <patrón>`. `scripts/dev-down.sh`
  se apoya en pidfiles (`.run/`) con `pgrep` como respaldo.
- Arrancar un proceso con `nohup ... &` dentro de un script que luego termina
  deja el pipe de salida abierto y la terminal se queda colgada. Lanza el script
  con `setsid ... < /dev/null > log 2>&1 &` o usa `scripts/dev-up.sh`.

## Convenciones

- Backend en CommonJS; frontend en ESM con componentes `.jsx`.
- **Estilos:** los tokens de marca están en `frontend/src/styles/index.css`
  (paleta neón: `--pink`, `--primary`, `--accent`, `--glow-*`) y la maquetación
  en `App.css`. Al tocar estilos, **conserva los nombres de clase**: los
  componentes los usan y no hay comprobación automática de que existan. Si
  añades una clase nueva en un componente, añade también su regla.
- Mensajes de error de la API en español, con la forma `{ error: string }`.
  Los errores de validación añaden `{ details: [{ field, message }] }`.
- Todo endpoint que reciba datos pasa por reglas de `express-validator` +
  middleware `validate`.
- Los handlers async se envuelven en `asyncHandler` para que los rechazos
  lleguen al manejador de errores.
- Los componentes de React usan el cliente `api` (`src/api/client.js`), que ya
  inyecta el token y normaliza los errores.
- **Un concepto, un nombre visible.** La monetización es solo por regalos: no hay
  minería ni emisión automática de Diamantes, así que nadie cobra dos veces por
  el mismo engagement. La sub-comunidad privada se llama **TAK Creators** en la
  UI, pero internamente sigue siendo `squads` (modelo, ruta `/api/squads`,
  componente `Squads.jsx`); no renombres esos identificadores sin migración.

## Reglas importantes

- **Toda ruta nueva debe montarse en `app.js`.** Cuatro módulos completos
  (`feed`, `analytics`, `gifts`, `sounds`) vivieron meses con tests en verde y
  respondiendo 404, porque `app.js` no los registraba. Si añades un fichero a
  `src/routes/`, añádelo también a `createApp()`. El test "the previously
  orphaned routes are mounted" cubre esta regresión.
- **Un `$inc` de contador necesita una condición de idempotencia.** El endpoint
  de likes decía ser idempotente pero incrementaba sin filtro, y un doble clic
  inflaba el contador con el que el feed rankea. Usa `likedBy` con
  `findOneAndUpdate({ _id, likedBy: { $ne: userId } }, { $addToSet, $inc })` y
  trata el no-match como "quitar el like".
- **`fs.access` no busca en el PATH.** `fs.access('ffmpeg')` resuelve relativo
  al cwd y fallaba siempre, dejando el HLS muerto en silencio. Para un binario
  por nombre usa `execFile(binary, ['-version'])`; `path.isAbsolute` sí vale con
  `fs.access`.
- **El ranking del feed vive en `rankingService.js`, no en Mongo.** Necesita
  compresión logarítmica, decaimiento exponencial y tope por creador, que el
  pipeline de agregación no expresa de forma legible. Además, así la misma
  fórmula que prueban los tests es la que se ejecuta. La consulta de Mongo solo
  pre-filtra y ordena el conjunto de candidatos; no reimplementa el modelo.
- **Un tope por creador no puede "rellenarse desde el sobrante".** Si al llegar
  al límite se completa la página con los videos descartados, el tope deja de
  existir: una cuenta vuelve a ocupar todo. Una página corta es correcta; una
  página de un solo creador no lo es.
- **Toda métrica de ranking se comprime con `log1p`.** Con suma lineal, un solo
  video con un millón de vistas aplasta a todos los demás candidatos y el feed
  se congela en el pasado.
- **Las señales negativas son parte del recomendador.** "No me interesa" y
  "ocultar creador" deben excluir en la recuperación (`$nin`), no solo bajar el
  puntaje. Si solo bajan el score, el contenido silenciado sigue apareciendo.
- **En la nube el host público debe estar en `allowedHosts`.** Vite 5 rechaza
  cualquier cabecera `Host` que no reconozca (protección contra DNS rebinding).
  Si la app se sirve detrás de un proxy en un dominio público, la respuesta es
  `403 Blocked request. This host is not allowed.` y la página parece "en
  blanco". `vite.config.js` permite `*.prod-runtime.all-hands.dev` por defecto y
  acepta más hosts con `VITE_ALLOWED_HOSTS=a.com,b.com`. El puerto sale de
  `PORT` (por defecto 3000), para poder usar el 12000 del contenedor.
- **El build usa `base: './'`.** Los assets deben ser relativos para que el
  bundle funcione servido desde una subruta o abierto desde disco, no solo
  desde la raíz del dominio. Con rutas absolutas (`/assets/...`) los ficheros
  dan 404 y la página queda en blanco.
- **`localStorage` se lee con `try/catch`.** Un `taktak_user` corrupto hacía
  que `JSON.parse` lanzara dentro de `useState`; sin error boundary React
  desmonta el árbol y la pantalla queda vacía. `AuthContext` descarta el valor
  inválido, y `ErrorBoundary` (en `main.jsx`) muestra el error en lugar de un
  blanco silencioso.
- **El dinero (TTC) solo se mueve con actualizaciones atómicas.** Nunca hagas
  `read -> check in JS -> save` sobre `wallet`: usa `$inc` con condición
  (`findOneAndUpdate({ _id, 'wallet.ttcC': { $gte: amount } }, { $inc: ... })`).
  El test "concurrent gifts cannot overdraw the balance" cubre esta regresión.
  Con dos cubos, `debitSpendable` lee ambos, calcula el reparto y aplica un
  `$gte` **por cada cubo que toca**, reintentando si otro regalo se adelantó.
  Añade la condición solo al cubo que se gasta: un documento sin `bonusC` no
  debe dejar de coincidir.
- **Hay tres cubos, y la frontera entre ellos es la que impide acuñar dinero.**
  - `wallet.ttcC` (Monedas compradas): solo entra por compra real. Al regalar,
    produce Diamantes retirables.
  - `wallet.bonusC` (Monedas de regalo): bono de bienvenida y créditos de admin.
    Se gasta en regalos, pero al regalar produce **más `bonusC`**, nunca `ttcR`.
  - `wallet.ttcR` (Diamantes): lo único retirable.
  El bono de bienvenida es `bonusC`, no `ttcC`. Antes eran 100 `ttcC` gratis por
  cuenta: con N cuentas gratis regalando a una sola, esa cuenta retiraba dinero
  real que la plataforma nunca recibió (100 cuentas = ~$300). El bucle cerrado lo
  corta: el bono solo puede recircular como bono. El test
  "a cash-out from a pure bonus loop yields nothing" lo fija.
- **Lo comprado se gasta antes que el bono.** Un usuario que paga no debe ver su
  regalo degradado a no-retirable para el creador solo porque aún le quedaba
  bono. `debitSpendable` gasta `ttcC` primero y `bonusC` después; como una cuenta
  gratis no tiene `ttcC`, sus regalos son siempre de bono.
- **Un regalo se clasifica por cómo se pagó, no por el resultado.**
  `Transaction.type` es `gift`/`platform` si el emisor usó monedas compradas, y
  `gift_bonus`/`platform_bonus` si usó bono. `getPlatformEarnings` solo suma
  `platform`: el corte de un regalo de bono no es dinero que nadie pagó, y
  contarlo inflaría los ingresos y el NAV. Un regalo pagado de 1 moneda que
  redondea a 0 Diamantes sigue siendo `gift`.
- **Los créditos de admin van a `bonusC` por defecto** y dejan un asiento
  `type: 'bonus'`. Es el único punto que puede acuñar saldo: por defecto no debe
  crear dinero retirable, y nunca debe moverse sin registro.
- **Transacciones:** `walletService` detecta si el servidor soporta
  transacciones (replica set) antes de usarlas. No vuelvas a intentar
  `withTransaction` con un `catch` de fallback: en un servidor standalone las
  escrituras se aplican *antes* de lanzar el error y el fallback duplicaría la
  operación. Dos detalles que ya rompieron el flujo de regalos:
  - `Transaction.create([...], { session })` con **varios** documentos exige
    `ordered: true`; sin él Mongoose lanza y todo regalo devuelve 500.
  - El crédito al creador debe ir **dentro** de la sesión
    (`creditWithdrawable(id, amount, session)`). Si se ejecuta fuera, el creador
    cobra aunque el asiento contable falle y se crean tokens de la nada.
- **Nunca** pongas un `JWT_SECRET` por defecto que se use en producción; `env.js`
  falla a propósito si falta.
- Las rutas `/api/admin/*` requieren `auth` + `requireAdmin`.
- **El reparto de ingresos es 60/40 y debe sumar 1.** `CREATOR_SHARE` y
  `PLATFORM_SHARE` se validan al arrancar; un desajuste crearía o destruiría
  tokens. El share del creador se redondea hacia abajo (`Math.floor`) porque los
  Diamantes son enteros, y el resto va a la plataforma para que ambos lados
  sumen siempre el importe debitado.
- El corte de plataforma se registra como `Transaction` con
  `type: 'platform'`. No lo omitas: sin ese asiento los ingresos de la casa no
  son auditables.
- **Ningún paquete puede vender el TTC por debajo de `TTC_USD_RATE`** (hoy
  $0,01). Ese es el suelo, y es la tasa de retiro entera, no
  `CREATOR_SHARE × TTC_USD_RATE`: el regalo solo paga el 60%, pero el retiro
  paga el 100%, y es el retiro el que marca el techo del desembolso. Por debajo
  de esa cifra, comprar monedas, convertirlas a Diamantes y retirar daría
  beneficio, y el NAV —base del precio de la acción— se iría a cero con el uso.
  `assertPackagesCoverPayout()` lo comprueba al arrancar y aborta con el
  paquete culpable. Si bajas `TTC_USD_RATE`, revisa los precios a la vez.
- El vocabulario de cara al usuario es **Monedas (`coins`)** y **Diamantes
  (`diamonds`)**; `ttcC`/`ttcR` son los nombres internos. Mantén ambos en las
  respuestas. El saldo gastable total se expone como `spendable`
  (`coins + bonusCoins`): la UI debe usarlo para habilitar regalos, porque un
  usuario nuevo con bono no tiene `coins` pero sí puede regalar.
- Los `joinCode` de TAK Creators (internamente `squads`) nunca se devuelven al cliente.
- **Cambiar de pestaña no debe cambiar de vista.** En `AuthForm`, las pestañas
  Correo/Teléfono llamaban a `reset('login')`, que además de limpiar el estado
  hacía `setView('login')`. Estando en registro, pulsar "Teléfono" devolvía al
  login y el formulario de teléfono de registro quedaba en blanco. Para cambiar
  solo de proveedor usa `switchTab`, que preserva la vista. El mismo formulario
  sirve a login y registro: muestra usuario/contraseña cuando `view === 'register'`
  y los omite en login (el backend reutiliza la cuenta existente).

## Tests

- `node:test` + `supertest`, contra MongoDB real.
- Los ficheros de test comparten una base de datos y la vacían en
  `beforeEach`, por eso se ejecutan en serie (`--test-concurrency=1`). Si
  añades un fichero nuevo, mantén la convención `test/*.test.js`.

## Identidad de usuario en el frontend

- El mismo usuario llega con formas distintas según el endpoint: `/users/me`
  devuelve el documento con `_id`, mientras que los mensajes y el feed traen
  `id`. Comparar `user.id` a secas deja `undefined` y rompe cosas silenciosas:
  la copia optimista del chat no se empareja (el mensaje sale duplicado) y las
  burbujas no se alinean por lado. Normaliza siempre con un helper que pruebe
  `_id ?? id` antes de comparar.

## Mensajería en tiempo real

- El fan-out vive en `services/liveSockets.js` (`broadcastMessage`) y lo llaman
  tanto el handler de socket como la ruta REST. Si añades otra vía de envío,
  difunde desde ahí: el frontend solo pinta lo que llega por `chat:message`.
- En el hilo (`Messages.jsx`), el efecto que se suscribe a `chat:message` **no**
  debe depender de `messages.length`. Si depende, cada mensaje nuevo deshace y
  rehace la suscripción y el evento que la provocó puede caer en ese hueco.
- Un mismo mensaje llega por dos vías (eco del socket y respuesta del POST) más
  la copia optimista local. Usa `mergeMessage` para deduplicar por id y retirar
  la copia pendiente; dos hijos con la misma `key` descuadran el hilo.

### Recibos, presencia y "escribiendo…" (estilo WhatsApp)

- El estado del mensaje **se deriva, no se guarda**: `serializeMessage` lo calcula
  a partir de `deliveredTo` y `readTo` (listas de ids, no booleanos, para que
  sirvan también en grupos). Nunca se escribe un campo `status` en la base.
- `deliveredTo` se marca en `broadcastMessage` **solo si el destinatario tiene
  algún socket abierto** (`fetchSockets`). Emitir a una sala vacía no entrega
  nada, así que darlo por hecho pintaría un ✓✓ falso.
- La presencia en vivo es un **contador de sockets por usuario** (`onlineSockets`
  en `liveSockets.js`), no un booleano: varias pestañas del mismo usuario no
  deben marcar "desconectado" al cerrar una. Al irse el último socket se guarda
  `lastSeenAt` en el usuario y se avisa por `chat:presence` a quienes comparten
  conversación (no a todo el mundo: la presencia es dato de contactos).
- `chat:typing` es efímero y solo se reenvía al hilo (`socket.to(room)`, no
  `io.to`), previa comprobación de que el emisor es participante. En el cliente se
  espacia a un evento cada 2,5 s: sin ese freno, teclear una frase dispararía
  decenas de eventos por socket.
- El doble tick azul se pinta con la clase `.ticks.read` y el **turquesa de la
  marca** (`--accent`), no con el azul de WhatsApp.

## Llamadas de voz y vídeo

- El audio y el vídeo van de peer a peer por WebRTC; el servidor solo retransmite
  la señalización (`call:invite`, `call:offer`, `call:answer`, `call:ice`,
  `call:accept`, `call:reject`, `call:end`). Con solo STUN configurado, una
  llamada funciona en la misma red pero se corta detrás de NAT estricto: para eso
  hace falta un TURN (`VITE_TURN_URL`, `VITE_TURN_USERNAME`,
  `VITE_TURN_CREDENTIAL`).
- El historial de llamadas reutiliza el hilo de mensajes. Una llamada es un
  `Message` con `kind: 'call'` y un subdocumento `call` (`kind`, `status`,
  `durationSeconds`). Así comparte orden, no leídos y paginación con el texto sin
  código extra. `text` es opcional cuando `kind === 'call'`.
- Solo **quien inicia** la llamada escribe la entrada del hilo (`isCallerRef` en
  `CallContext`). Si escribieran los dos, cada llamada aparecería duplicada, ya
  que el hilo es compartido. El receptor nunca registra nada. La marca se pone
  **después** de conseguir el micrófono/cámara: si el usuario deniega el permiso,
  nunca hubo llamada y no debe quedar una "perdida" en el historial.
- Todo final de llamada pasa por `finalize`, el único punto que cierra la
  conexión y registra el resultado. Lo llaman colgar, rechazar, el fin remoto y
  el temporizador de timbrado (45 s sin respuesta = `missed`). `loggedRef` evita
  un doble registro y se rearma en `cleanup` para la siguiente llamada.
- La duración cuenta desde `activeSinceRef`, que se fija al quedar activa (el
  receptor en `acceptCall`, el llamante al recibir `call:answer`). El servidor
  fuerza a 0 la duración de cualquier llamada no contestada.
- El endpoint es `POST /api/messages/calls` con `peerId`, `status`
  (`answered|missed|declined|cancelled|unreachable`), `kind` y
  `durationSeconds`. Se identifica por `peerId` porque la llamada puede no tener
  hilo previo; el servidor lo crea. El estado lo reporta el cliente: es historial,
  no una fuente de verdad para facturación.

### Llamar a teléfonos que NO tienen TAK TAK

Un número sin la app **no puede recibir una videollamada WebRTC**: no hay dónde
entregarle la invitación, igual que no se puede videollamar por WhatsApp a quien
no tiene WhatsApp. No es un fallo que se arregle con código. Lo que sí existe:

- **`tel:` (marcador del sistema)**, el camino por defecto y sin coste. En un
  móvil abre la app de teléfono y marca de verdad. Es lo que se ofrece cuando no
  hay proveedor de voz (`voice: false` en `/api/auth/providers`).
- **Twilio Voice**, para llamar también desde escritorio. El navegador pide un
  token de acceso a `POST /api/calls/token`, se registra como cliente de Twilio y
  marca; Twilio pide el TwiML a `POST /api/calls/twiml`, que conecta la pata del
  navegador con el número. El SDK (`@twilio/voice-sdk`) se carga con
  `import()` dinámico: pesa 181 kB y solo se descarga si de verdad se llama.
- **`POST /api/calls/invite`** manda un SMS con un enlace para instalar la app.
  Es la única forma de que ese número acabe pudiendo recibir vídeo.

Detalles que cuesta descubrir:

- El endpoint de TwiML **no puede llevar sesión** (lo llama Twilio, no el
  navegador), así que se protege con la firma `X-Twilio-Signature` en HMAC-SHA1.
  Sin esa comprobación, cualquiera podría marcar números de tarificación especial
  a costa de la cuenta.
- La URL que se firma es la de `APP_URL`, **no** la reconstruida del `Host`: con
  un proxy por medio el protocolo no coincide y la firma nunca valida.
- El token de voz se firma a mano con `jsonwebtoken` (ya está en el proyecto) en
  vez de añadir el SDK de Node solo para eso. Twilio exige el header
  `cty: 'twilio-fpa;v=1'`; sin él el SDK lo rechaza con un error poco claro.
- El token de acceso necesita **API Key + secreto + TwiML App SID**, no solo el
  auth token. `voiceService.isConfigured()` exige los cuatro.
- `navigator.contacts` solo existe en algunos navegadores móviles y exige
  permiso. Se pide con un botón ("Importar"), nunca al montar: pedir los
  contactos al abrir el marcador es invasivo y en escritorio la API no existe.
- La pulsación larga del 0 para escribir "+" necesita `onPointerDown/Up`, no
  `onClick` (que no distingue corta de larga), y `onContextMenu` con
  `preventDefault`, porque el menú contextual del móvil cancela la pulsación.

### Llamadas con la app cerrada (Web Push)

Sin esto, llamar a alguien que no tiene la app abierta terminaba en "esa persona
no está disponible". Con Web Push suena como WhatsApp: el servicio de push
(FCM/APNs/Mozilla) despierta el dispositivo y la llamada entra.

- Claves VAPID en `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`). Se generan una vez con `npm run push:keys`. **Sin ellas el
  servidor no intenta nada** y `isConfigured()` es false: es preferible decir "no
  disponible" que fingir un envío que no llegará. La privada es un secreto y
  `.env` está ignorado por git; no la metas en el repo.
- La suscripción del navegador vive en `PushSubscription` (única por
  `endpoint`). El endpoint es único en el mundo, así que el alta es un `upsert`
  y la baja **filtra por usuario**: borrar por endpoint a secas dejaría a
  cualquiera desuscribir el dispositivo de otro conociendo su endpoint.
- En `liveSockets`, `call:invite` consulta `fetchSockets()`. Si hay socket, la
  llamada entra en vivo y **no se manda push** (sería un aviso duplicado). Si no
  lo hay, se manda el push, se guarda la invitación en `pendingCalls` y se
  responde `call:ringing { reachable: false, pushed: true }`.
- **`call:ringing` se emite una sola vez, al final, ya con la decisión tomada.**
  Emitirlo antes de intentar el push rompe la función: el cliente ve
  `reachable: false` y cuelga como "no disponible" justo antes de que llegue el
  `pushed: true`. El llamante solo cuelga si `!reachable && !pushed`.
- La invitación pendiente se reentrega en el `connection` del destinatario, que
  es justo lo que pasa al abrir la app desde la notificación (su socket conecta
  *después* del aviso). Sin esa reentrega la llamada se perdería al aceptarla.
  Se limpia en `call:accept/reject/end`; si no, al reconectar sonaría otra vez
  una llamada ya en curso. Caduca sola por TTL.
- El service worker (`frontend/public/sw.js`) es mínimo y **no cachea nada**: un
  SW que cachea el bundle deja servida una versión vieja de la app. Solo recibe
  el push y muestra la notificación.
- La notificación **no tiene acción de "Rechazar"** a propósito: la API usa
  tokens Bearer en `localStorage` y el service worker no puede leerlos, así que
  un rechazo desde ahí fallaría con 401 en silencio. La llamada caduca sola.
- El permiso se pide desde **Ajustes**, no al arrancar: en iOS solo se puede
  pedir una vez, y pedirlo antes de saber si el servidor tiene claves lo gastaría
  en balde. `subscribeToPush` consulta `/push/config` primero. `main.jsx` solo
  registra el SW, sin pedir permiso.
- Al iniciar sesión, `syncPushSubscription` reenvía la suscripción al servidor:
  el servidor guarda a qué cuenta pertenece cada dispositivo, y sin reenviarla
  tras cambiar de usuario las llamadas sonarían en el teléfono equivocado. Al
  cerrar sesión, `detachPushSubscription` la desvincula **sin borrarla** del
  navegador, para que al volver a entrar se reasocie sola.
- **Límite real que no se arregla con código:** en iPhone el push web solo
  existe desde iOS 16.4 y **solo si la app está añadida a la pantalla de inicio**.
  En Safari normal, `PushManager` no existe. Android y escritorio funcionan con
  la app cerrada. La UI lo explica en Ajustes en vez de fallar en silencio.

## Verificación por correo/SMS en desarrollo

- Sin `SMTP_HOST` ni `SMS_PROVIDER` configurados, ningún código sale del
  servidor: solo se escribe en el log (`[MAIL:dev]` / `[SMS:dev]`) y el usuario
  no puede leerlo. El helper `devCode(code)` de `routes/auth.js` devuelve el
  código en la respuesta **solo** cuando `NODE_ENV !== 'production'`, y el
  frontend lo pinta en un `DevCodeBox` que lo autorrellena al pulsar.
- La guarda es sobre `isProduction`, **no** sobre "¿hay proveedor?". En
  producción devuelve `undefined` siempre: enviar el código en la respuesta
  dejaría que cualquiera con un email o teléfono ajeno tomase esa cuenta.
- `phone/start` puede responder `existingAccount: true` sin código. El frontend
  debe mostrar ese aviso; el formulario de teléfono tenía el `notice` sin
  renderizar, así que el mensaje era invisible y el usuario quedaba atascado.
  Al reintentar se limpia `notice` para no mostrar un aviso viejo junto a un
  resultado nuevo que lo contradice.

## Vincular un teléfono a una cuenta que ya existe

- Quien se registra por correo o con Google **no tiene teléfono**, y sin teléfono
  la cuenta no se puede llamar por número (el marcador resuelve números a cuentas
  por el campo `phone`) ni aparece en coincidencias de contactos. Por eso existen
  `POST /api/auth/phone/link/start` y `/link/verify`, **autenticados**: el número
  se adjunta a la cuenta de la sesión, nunca crea ni cambia de cuenta.
- Es el mismo flujo en dos pasos que el registro por teléfono (pedir código,
  verificar) pero con `purpose: 'link_phone'`. El código guarda `userId` en el
  `payload` y en la verificación debe coincidir con la sesión: sin eso, un código
  filtrado podría vincular el número a otra cuenta.
- `link/start` responde 409 si el número ya es de **otra** cuenta, y
  `alreadyLinked: true` si es de la propia y ya está verificado (no se gasta un
  SMS en algo ya hecho). Verificar prueba el control del número, así que nadie
  puede adjuntar un teléfono ajeno.
- El `save()` de `link/verify` puede chocar con el índice único si dos cuentas
  verifican el mismo número a la vez; el perdedor recibe 409, no un 500.
- En el frontend, `PhoneLink.jsx` es un componente reutilizable (Ajustes y el
  aviso de primer arranque). El modal de la primera vez es **opcional y
  descartable**, y se recuerda el descarte por cuenta en `localStorage`
  (`taktak_phone_prompt_<id>`): obligar a dar el teléfono para ver vídeos
  espantaría a quien solo quiere mirar.

## Verificación de edad y verificación de noticias (Fase 2)

### Verificación de edad

- El estado vive en `User.ageVerification` (`status`, `verifiedAt`, `provider`,
  `reference`). Los valores son `unverified`, `pending`, `verified`, `rejected`.
- `services/ageService.js` abstrae al proveedor externo. En producción, sin
  proveedor configurado, **falla cerrado**: `startVerification` lanza 503 en vez
  de dejar pasar. El proveedor `dev` (por defecto fuera de producción) **nunca
  auto-aprueba**: abre una sesión `pending` y solo un administrador la resuelve.
- **Declarar la fecha de nacimiento no verifica.** `PUT /api/verification/age/declaration`
  guarda `dateOfBirth` para la experiencia de edad, pero deja el estado como
  está. Si esa ruta tocase `ageVerification.status`, cualquiera se verificaría
  escribiendo una fecha. La fecha se rechaza si es futura.
- **El único camino que el propio usuario puede usar para llegar a `verified` es
  `POST /api/verification/age/refresh`**, que relee el veredicto del proveedor.
  No lo escribas a mano en una ruta de usuario.
- El gating del contenido adulto es **404, no 403**, y se aplica en tres sitios
  (feed, listado y vídeo individual): un 403 confirmaría que el vídeo existe. El
  creador conserva acceso a su propia subida. La misma comprobación
  (`feedService.canViewAdultContent`) bloquea la subida de `isNSFW` sin verificar
  (ahí sí 403, porque el creador ya conoce su propio contenido).
- La ruta `GET /api/users/me` no debe exponer `dateOfBirth`: es dato personal y
  el panel de admin ya tiene su propia vista.

### Verificación de noticias

- El sello `newsVerified` **solo lo concede un administrador**
  (`POST /api/admin/news-claims/:id/approve`). El creador reclama la autoría de
  la fuente al subir; no puede sellarse solo.
- Una fuente (`NewsSource`) empieza en `pending` y no aparece en el catálogo
  público (`GET /api/videos/news-sources` filtra `status: 'verified'`). Se
  propone con `POST /api/verification/news-sources` (cualquiera con sesión puede
  proponer; solo el admin verifica).
- Al reclamar, `newsService.validateClaim` comprueba que el `sourceUrl` cuelga
  de uno de los dominios de la fuente. Un enlace de otro dominio se rechaza con
  **400**. La comprobación usa `hostnameOf` (no un `includes` de cadena, que
  aceptaría `malicioso-diario.test` para la fuente `diario.test`).
- **Revocar una fuente retira el sello en cascada** de todo lo ya publicado bajo
  ella (`Video.updateMany`). Si no, un medio desacreditado conservaría su
  credibilidad en contenido ya en vivo.
- El `Video.create` de la subida copia campo a campo, **nunca** con spread del
  body: un spread dejaría que el cliente enviase `newsVerified: true` y se
  saltase la revisión.

## Contrato de respuestas de la API (y el error "no es JSON")

- **La API responde JSON en todas las rutas, incluidos los errores.** El único
  servicio que puede devolver HTML es el *frontend*: en un hosting estático
  (o en el `try_files` de nginx) una ruta desconocida devuelve `index.html` con
  **200**, no un 404. Por eso `/api/...` nunca debe quedar fuera del proxy: si el
  proxy no reenvía `/api`, el cliente recibe el HTML de la SPA.
- Ese HTML con 200 es la causa de
  `Unexpected token '<', "<!DOCTYPE" ... is not valid JSON`: el cliente parseaba
  la respuesta como JSON sin mirar el `Content-Type`. `frontend/src/api/client.js`
  ahora rechaza cualquier respuesta que no sea JSON antes de que un componente
  lea campos de ella, y muestra un texto comprensible en vez del error del
  parser. `frontend/src/api/response.js` tiene los mensajes y los predicados.
- **No basta con ocultar el mensaje**: si aparece, es que la petición no llegó a
  la API. Revisa el proxy (`nginx.conf`, `vite.config.js`) y que el backend esté
  arriba. Las pruebas `frontend/test/api-response.test.js` fijan este contrato.
- Los componentes siguen comprobando la forma del cuerpo (`Array.isArray(...)`)
  porque un JSON válido puede venir incompleto si el backend y el frontend van
  desincronizados.

## Comentarios

- Un comentario es un **documento propio** (`models/Comment.js`), no un array
  dentro de `Video`: un array crecería sin límite y obligaría a cargar el hilo
  entero para pintar una página.
- **Un solo nivel de anidamiento.** Responder a una respuesta cuelga del
  comentario raíz (`parent.parent`). No hay árbol.
- **El contador `comments` del vídeo solo cuenta comentarios de primer nivel.**
  Una respuesta incrementa `replyCount` del padre, no el contador del vídeo, que
  es lo que la UI muestra. El servicio y el panel aplican la misma regla; si
  cambias una, cambia la otra.
- **Borrado suave.** La fila queda con `deletedAt` y `text: ''`, sin autor, para
  que las respuestas no pierdan su sitio. El borrado se hace con `updateOne`, no
  con `save()`: `text` es `required` y guardar un documento vaciado fallaría la
  validación. La validación sigue protegiendo la creación.
- **La visibilidad del hilo sigue la del vídeo.** `assertVideoVisible` aplica
  las mismas reglas que la ruta del vídeo (aprobado, y NSFW solo con edad
  verificada o para el propio creador). Un vídeo restringido responde 404 en sus
  comentarios: no se confirma que exista.
- Borrar un vídeo retira su hilo en cascada (`commentService.removeForVideo`).
- Los me gusta de un comentario usan el mismo patrón que los del vídeo: el
  conjunto `likedBy` es la fuente de verdad, así que tocar dos veces no infla el
  contador.
- El panel (`frontend/src/components/Comments.jsx`) es `position: fixed` dentro
  del feed para que el vídeo de detrás siga reproduciéndose y no se pierda la
  posición del scroll al cerrarlo.

## WhaTaka: contacto contextual desde el reel

Lo que se pidió como "extensión WhaTaka" (chat, voz y vídeo desde el feed) se
apoya en la mensajería y las llamadas que ya existían. **No hay un segundo
sistema en paralelo**: `CreatorSheet` solo abre lo que ya hay.

- **Por qué no se usó libp2p.** El diseño original proponía señalización por
  libp2p con `@libp2p/tcp`. Ese transporte **no existe en el navegador** (así lo
  documenta libp2p: `@libp2p/tcp (not available in browsers)`), y un navegador
  tampoco puede *escuchar* en un WebSocket, solo marcar. Un `listenAddrs` como
  `/ip4/0.0.0.0/tcp/0` lanzaría en el cliente. Además, "cero servidores
  centrales" no es alcanzable en una app web: alguien tiene que presentar a los
  pares (un nodo bootstrap, un relay o un servidor de señalización), y WebRTC ya
  necesita STUN y, tras NAT estricto, TURN. La señalización actual por socket.io
  cumple esa función y ya está probada.
- **`CreatorSheet.jsx`** es la acción contextual: se abre tocando el nombre del
  creador en el reel y ofrece Mensaje, Llamada de voz, Videollamada y Seguir.
  Es una hoja inferior, no una pantalla: el vídeo sigue detrás y al cerrarla el
  scroll no se mueve.
- Toda acción de contacto exige sesión. Sin usuario la hoja avisa ("Inicia sesión
  para contactar con el creador") en vez de no hacer nada.
- **"Mensaje" reutiliza la ruta de conversaciones.** `App` guarda el creador en
  `chatTarget` y `Messages` lo consume una sola vez (`onConsumeInitialUser`)
  para abrir el hilo; si no se consumiera, volver a Mensajes lo reabriría.
- **`onCall` acepta `id` o `_id`.** El feed entrega el creador tal cual viene del
  vídeo (`_id`), mientras el chat usa `id`. `callPeer` normaliza los dos; sin eso
  una llamada desde el reel no arrancaría.

### Burbuja flotante de llamada (picture-in-picture)

- `CallContext` expone `minimized` y `toggleMinimize`. Minimizar **solo** se
  ofrece con la llamada activa: una entrante debe verse entera para poder
  aceptarla o rechazarla, y durante el timbrado hay que ver a quién se llama.
- La burbuja es un `<button>` que devuelve a la pantalla completa. **No lleva
  `muted`**: es una llamada en curso y silenciarla al minimizar cortaría al
  interlocutor, que es justo lo contrario de lo que se pide.
- El efecto que engancha el stream remoto depende también de `minimized`: al
  pasar de pantalla completa a burbuja el `<video>` es otro elemento, y sin esa
  dependencia la burbuja se quedaría negra.
- `cleanup` restablece `minimized` a `false`. Si no, la siguiente llamada
  nacería minimizada.
- `z-index` 88: por debajo del overlay de llamada (90) y de la pantalla de
  bienvenida (100), por encima del resto. Se coloca sobre la barra inferior.

### Cómo se negocian las llamadas (y por qué el orden importa)

La negociación tiene un orden estricto que costó encontrar, porque el fallo era
silencioso: la pantalla se quedaba en "Llamando…" para siempre.

1. A llama: `call:invite`. **No** manda la oferta todavía.
2. B acepta: `call:accept`. Aquí B **no** puede esperar la oferta para
   contestarla, porque A aún no la ha mandado: A espera el `accept` para mandarla
   y B esperaba la oferta para aceptar. Ese abrazo mortal dejaba la llamada
   colgada sin ningún error. B solo avisa de que acepta y pide permisos.
3. A recibe `call:accept` y manda la oferta. Si B ya aceptó, B contesta en el
   momento con `answerOffer`.
4. Los candidatos ICE van sueltos con `call:ice`, y se encolan si llegan antes
   que la conexión (`pendingIceRef`), o se pierden en silencio.

Reglas que no se deben romper:

- **En llamada de voz hace falta un `<audio>` remoto.** El `<video>` remoto solo
  existe con `kind === 'video'` y `status === 'active'`. Sin un elemento de audio
  propio, una llamada de voz conectaba (los dos lados "En llamada") pero no se
  oía nada. `CallOverlay` monta `<audio ref={remoteAudioRef}>` fuera del bloque
  condicional, para que exista desde el primer render y no se desmonte.
- **`answerOffer` no debe montar una segunda conexión.** Una oferta duplicada
  (reenvío o carrera) se ignora si ya hay `pcRef`.
- **No se puede llamar sin socket conectado.** `startCall` y `acceptCall`
  comprueban `connectedRef`. Si el socket aún no conectó, la invitación se
  perdería sin aviso y la pantalla quedaría en "Llamando…" para siempre. Mejor
  un error claro ("Sin conexión…") que una llamada fantasma. Ese aviso es la
  razón de que exista `connectedRef`: se lee dentro de `startCall` sin recrear la
  función en cada reconexión.
- **El aviso de TURN es informativo, no un error.** Si la lista ICE del servidor
  no trae `turn:`, `hasTurn` es falso y la primera llamada avisa de que puede
  cortarse fuera de la red local. Va en `notice`, no en `error`: la llamada sigue
  en pie y no debe parecer rota.

### Cómo se probó de verdad

Hay **dos** caminos, y conviene saber cuál se está usando:

- Los harness de `scripts/e2e-*.js` usan **Chromium del sistema en
  `/usr/bin/chromium`** con `puppeteer-core` (que no descarga navegador).
- Los tests de `frontend/test/e2e-*.mjs` usan **Playwright**, que hay que
  instalar una vez por entorno (`npx playwright install chromium`). Ojo: el
  navegador de Playwright vive en `~/.cache/ms-playwright`, **fuera de
  `/workspace`**, así que un reinicio del contenedor se lo lleva y los e2e
  fallan con "Executable doesn't exist". No es un fallo de la app: se reinstala
  y sigue.

Con cualquiera de los dos se lanzan **dos navegadores con cámara y micrófono
falsos** y se hace una llamada real entre ellos:

- Flags imprescindibles: `--use-fake-ui-for-media-stream` (concede permisos sin
  diálogo) y `--use-fake-device-for-media-stream` (cámara y micro sintéticos).
  Sin el primero, `getUserMedia` se queda esperando un permiso que nadie pulsa.
- El test **no se fía de la UI**: comprueba `video.srcObject.getTracks()` y que
  el audio esté `playing`, es decir, que llegan pistas de audio (y de vídeo en
  videollamada). Eso es lo que distingue "conectó" de "funciona".
- **Cuidado con el límite de registro.** `authLimiter` permite 20 registros cada
  15 minutos. Una tanda de rondas que registre cuentas nuevas se agota y falla
  por 429, no por la llamada. Reutiliza cuentas (login como respaldo) o reinicia
  el backend, que limpia el limitador en memoria.
- Resultado: 6/6 en voz y 4/4 en vídeo, con audio (y vídeo) remotos confirmados.

#### Trampa: los enganches `window.__taktak*` solo existen en desarrollo

`CallContext` y `SocketContext` exponen `window.__taktakCall` y
`window.__taktakSocketConnected` **solo bajo `import.meta.env.DEV`**. El puerto
de la app (`SERVE_MODE=single`, el que se despliega) sirve el **build de
producción**, donde esos objetos no existen.

Un test que los use pasa en el servidor de Vite y falla entero contra el build
real, con un síntoma que engaña: parece que "las llamadas no funcionan" cuando
lo único roto es el atajo del test. `frontend/test/e2e-call.mjs` cayó en esto
—daba 11 fallos y ni una sola llamada se establecía— y se reescribió para
iniciar y aceptar **por la interfaz** (botones `.thread-call`, `.call-btn.accept`
y `.call-btn.end`) y leer el estado de la pantalla (`.call-overlay .call-info
span`). Regla: **un e2e debe manejar la UI, no un enganche que solo existe en
desarrollo**, o deja de probar lo que se despliega.

### Verificación funcional integral (prueba de humo y UI)

- `scripts/smoke-api.sh` recorre la API completa con `curl` sobre una pila ya
  levantada: auth (registro, verificación de correo, login, 401 sin sesión),
  subida y feed, like idempotente, comentarios, social, economía (regalos,
  retiro, monetización abierta), mensajería, creators, salud, analítica, catálogos,
  admin y ICE. Son ~48 comprobaciones; salir en verde es la señal de que la API
  no se ha roto. Registra usuarios nuevos cada vez, así que reinicia el backend
  antes si has agotado el `authLimiter`.
- Dos detalles del script que no son de la app: hay que declarar
  `-F "video=@archivo;type=video/mp4"` (curl no adivina el MIME de un archivo sin
  extensión reconocible y el filtro del servidor lo rechaza) y `/wallet/transactions`
  devuelve un **array plano**, no `{ transactions: [...] }`.
- Para la UI hay tres harness con **Chromium real** (`puppeteer-core` sobre
  `/usr/bin/chromium`, sin descargar navegador), en `scripts/`:
  - `node scripts/e2e-ui.js` recorre feed (comprueba que el `<video>` se
    reproduce, `readystate` y `paused`), registro, like, comentario, wallet
    (incluido enviar un regalo y ver bajar el saldo), squads, salud y perfil.
    Sin sesión la app abre en la **portada de acceso**, así que el harness
    entra por "Explorar sin cuenta" antes de esperar el feed; el alta exige
    repetir la contraseña y aceptar los términos, y termina en la pantalla de
    verificación del correo (se sale con "Lo verificaré más tarde").
    `waitText` **lanza** al agotar el tiempo: para comprobaciones que se
    registran con `check` hay que usar `sawText`, que devuelve booleano; si no,
    el `check` sale siempre en falso aunque la pantalla sea la correcta.
    `e2e-upload-optimize.js` necesita `ffmpeg` en el host para que el vídeo
    quede optimizado; `scripts/dev-up.sh` lo instala al arrancar, así que en
    este contenedor ya no hay fallos ambientales.
  - `node scripts/e2e-calls.js` lanza **dos navegadores** y hace una llamada de
    voz y otra de vídeo reales entre ellos, comprobando que llegan pistas
    remotas de audio (y vídeo) y que colgar cierra la llamada en el otro lado.
  - `node scripts/e2e-messaging.js` lanza **dos navegadores** y verifica lo que no
    se ve desde la API: presencia ("en línea" / "última vez…"), aviso de
    "escribiendo…", llegada del mensaje en vivo, ticks que pasan a leído y el
    contador de no leídos en la bandeja.
  - `bash scripts/check-messaging.sh` es una comprobación rápida por API de los
    recibos (`sent` → `read`) y la presencia, útil para depurar sin navegador.
  - `puppeteer-core` se declara en el `package.json` raíz (utilidades de
    desarrollo, no forma parte de la app) y los scripts lo resuelven desde
    cualquier `node_modules` del repo. El fixture de vídeo lo genera el propio
    harness con ffmpeg en `.data/` (ignorado por git).
  - Ojo: muchas etiquetas se muestran en mayúsculas por CSS, así que
    `innerText` las devuelve transformadas; compara sin distinguir mayúsculas.

#### El proxy de `/uploads` en desarrollo (bug real)

Los vídeos subidos se sirven desde el backend en `/uploads/...`. En producción
nginx ya proxea esa ruta, **pero el servidor de desarrollo de Vite no lo hacía**:
la petición caía en el fallback del SPA y devolvía `index.html` con
`Content-Type: text/html`. Resultado: cualquier vídeo recién subido fallaba en el
reproductor (`DEMUXER_ERROR_COULD_NOT_OPEN`, `readyState=0`) y el feed parecía
roto. Arreglado añadiendo `/uploads` al `proxy` de `frontend/vite.config.js`.
Si vuelves a ver ese error, comprueba que el proxy sigue ahí.

- Otra trampa al probar: el **Chromium de código abierto no trae el códec H.264**.
  Un fixture `.mp4` válido da `readyState=0` por el códec, no por la app. Genera
  el vídeo de prueba en **WebM** (`ffmpeg -c:v libvpx`).

### Persistencia de datos en el contenedor de desarrollo

- **Lo único que sobrevive a un reinicio del entorno es `/workspace`.** Docker,
  los volúmenes (`/var/lib/docker`) y `/tmp` viven en la capa del contenedor y
  se borran. Un reinicio deja el enlace en 502 y la base de datos vacía.
- Por eso los datos de Mongo van a `<repo>/.data/mongo` (bind mount) y no a un
  volumen con nombre. `scripts/dev-up.sh` detecta un contenedor viejo que aún
  apunte a un volumen y lo recrea solo; `docker-compose.yml` monta el mismo
  directorio. Los ficheros subidos van a `.data/uploads` por el mismo motivo.
- Si ves el feed vacío tras un reinicio, es esto: la app está bien, se perdió la
  base. No busques el fallo en el código.
- Recuperar el enlace sin perder nada: `bash scripts/dev-up.sh` (idempotente).
  Para que se relance solo, el vigilante `scripts/dev-watch.sh`. Comprueba la
  pila cada `WATCH_INTERVAL` segundos (15 por defecto) y relanza `dev-up.sh` si
  el backend o el frontend no responden.

### Modo de servicio: `single` (por defecto) contra `split`

`dev-up.sh` sirve la web y la API **desde un solo proceso Node** por defecto
(`SERVE_MODE=single`): el backend escucha en el puerto público y sirve además
`frontend/dist` con `PUBLIC_DIR`. Antes eran dos procesos (Vite en el frontend
proxeando `/api` y `/socket.io` al backend) y cada uno era una pieza más que
resucitar tras una caída.

Por qué importa: con dos procesos, si Vite muere y el backend no, el enlace
sigue dando 502 y hay que levantar los dos. Con uno solo, o está arriba o no lo
está, sin estados a medias. Además el frontend llama a `/api` y al socket con
rutas relativas, así que en un solo origen no hace falta proxy ninguno.

- El bundle vive en `frontend/dist`, dentro de `/workspace`, que es lo único
  persistente: **sobrevive al reinicio** y arrancar no depende de que Vite
  compile. `dev-up.sh` lo construye solo si falta (`REBUILD_FRONTEND=1` para
  forzarlo).
- Para desarrollo con recarga en caliente: `SERVE_MODE=split bash scripts/dev-up.sh`.
  Ahí sí hacen falta los dos procesos y el proxy de Vite.
- El vigilante entiende los dos modos: en `single` comprueba un solo puerto
  (`/api/gifts`); en `split`, los dos.

Los procesos se lanzan con `setsid ... </dev/null`, no con un `nohup` a secas.
Un `nohup` sigue en la misma sesión, y cuando la shell que lo lanzó cierra (o el
agente corta la herramienta por tiempo), el proceso se va con ella. `setsid` lo
pone en su propia sesión y sobrevive. Comprobado: tras un `pkill` del servicio,
el vigilante lo restaura en ~16 s; matando además Docker (simulacro de reinicio
completo), la pila entera vuelve en ~12 s con los datos intactos.

### Lo que NO se puede arrancar solo

Tras un **reinicio del contenedor** el vigilante también muere, y no hay forma
de relanzarlo desde dentro: PID 1 es el agente, no hay `cron`, `systemd` está
`offline` y no existe `rc.local` ni gancho de arranque en el entorno. En ese
caso hay que ejecutar `bash scripts/dev-up.sh` una vez (deja la app arriba y
además enciende el vigilante). Para no depender de un contenedor que se borra,
el camino es el push a GitHub, que sigue pendiente del permiso de escritura.

## Audio: sonido del feed y altavoz de llamadas

- **El vídeo del feed estaba siempre mudo.** `VideoCard` llevaba el atributo
  `muted` fijo, así que nunca se oía nada. Ahora el silencio lo decide
  `isMuted(active, soundOn)` (`frontend/src/lib/sound.js`): suena solo la tarjeta
  visible y solo si la persona activó el sonido.
- **Autoplay con sonido:** los navegadores lo bloquean hasta que hay un gesto.
  Por eso el estado por defecto es **silenciado** (el vídeo se reproduce solo) y
  el sonido es una acción explícita. Si el `play()` con sonido se rechaza, se
  reintenta en silencio para no congelar el vídeo y se muestra
  `.reel-sound-hint`; el primer toque sobre el vídeo o el botón levantan el
  bloqueo.
- **Control de sonido:** botón `.reel-sound` arriba a la derecha del feed.
  La preferencia se guarda en `localStorage` (`taktak_sound`) y sobrevive a la
  recarga.
- **Altavoz en llamadas:** `CallContext` ya pedía `audio: true`, así que el
  micrófono funcionaba; lo que faltaba era elegir la salida. `CallOverlay` usa
  `setSinkId` (helpers `listAudioOutputs`/`applySink`) y muestra el botón de
  altavoz **solo si el navegador lo soporta** (Firefox y parte de Safari no).
  Con el altavoz apagado se busca una salida que no sea el altavoz externo
  (auricular del teléfono).
- Si añades clases nuevas (`.reels-wrap`, `.reel-sound`, `.reel-sound-hint`),
  mantén sus reglas en `App.css`: no hay comprobación automática de que existan.

### Formatos de vídeo aceptados al subir

El filtro vive en `backend/src/lib/videoUpload.js` (`isAcceptedVideo`), no
dentro de la ruta, para poder probarlo sin levantar el servidor
(`backend/test/video-upload.test.js`).

- **Acepta el MIME de vídeo habitual** (`video/mp4`, `video/webm`,
  `video/quicktime`, `video/x-matroska`…) y también el **3GP/3G2** que graban
  los Android y el AVI/MKV que exportan los editores.
- **Cuando el MIME es genérico** (`application/octet-stream`, `application/mp4`)
  **o no viene, decide por la extensión.** Esto es lo que rompía las subidas:
  hay navegadores y grabadores que no etiquetan bien el archivo, y mirar solo el
  MIME rechazaba vídeos válidos con "Formato de video no soportado". La
  extensión es lo único que queda en ese caso.
- **Un MIME de otro tipo sigue rechazando aunque la extensión sea de vídeo**
  (`image/png` con nombre `.mp4` no pasa): la allowlist no se ha vuelto un
  coladero.
- El límite de tamaño es `MAX_VIDEO_BYTES` (50 MB por defecto); al superarlo
  `errorHandler` responde 413 con un mensaje claro en vez de un 500.

### El vídeo se ve pero no suena: se subió en H.265/HEVC

Un `.mp4` grabado con un iPhone en modo "Alta eficiencia" es H.265/HEVC. El
fichero **sí trae pista de audio**, pero Chrome y Firefox de escritorio no traen
el códec, así que el `<video>` falla con `MEDIA_ELEMENT_ERROR: Format error`
(código 4): ni imagen ni sonido. No es un problema del micrófono ni del altavoz;
es de formato.

La solución es el HLS: `transcodeService` reencoda a **H.264/AAC**, que sí es
universal. Para que eso ocurra hacen falta dos cosas:

1. **`ffmpeg` instalado.** El servicio lo detecta en el PATH y, si no está,
   sirve el original tal cual y avisa por consola:
   `[transcode] ffmpeg no disponible...`.
   - En desarrollo, `scripts/dev-up.sh` **lo instala al arrancar** si falta
     (`apt-get install -y ffmpeg`). Hace falta porque apt vive en el sistema de
     archivos del contenedor, no en `/workspace`: un reinicio del entorno se
     lleva ffmpeg y, sin esta comprobación, la optimización se rompía en
     silencio (la subida seguía funcionando y el creador veía "No se pudo
     optimizar" sin más pista).
   - En producción viene en la imagen (`backend/Dockerfile`), no del host.
   - `hasFfmpeg()` **cachea** el resultado en el proceso, así que instalar
     ffmpeg con el servidor ya arriba no basta: hay que reiniciarlo.
2. **`TRANSCODE_ENABLED=true`** en `backend/.env` (por defecto está en `false`).

Comprobación rápida de qué códec trae un fichero, sin ffprobe:

```bash
strings -n 4 archivo.mp4 | grep -oiE "hvc1|hev1|avc1|SoundHandler|mp4a"
# hvc1 = H.265 (no reproducible en navegador) / avc1 = H.264 (sí)
```

- **Vídeos ya subidos:** `cd backend && node scripts/backfill-hls.js` regenera
  el HLS de todos los que no lo tengan (`--all` los rehace todos). Los que ya
  tienen `hlsUrl` y su `.m3u8` en disco se saltan por diseño.
- **Reintento desde la app:** `POST /api/videos/:id/retranscode` (dueño o admin,
  responde 202 y procesa en segundo plano; 503 si falta ffmpeg). Es la vía para
  que el creador arregle un vídeo antiguo sin pasar por el servidor.
- **Comprobación del HLS generado:**
  `ffprobe -v error -show_entries stream=codec_name,codec_type -of csv=p=0 backend/uploads/<id>/480p/index.m3u8`
  debe listar `h264,video` y `aac,audio`.
- Los `.webm` VP8 de los tests ya se reproducen; el problema es solo de los
  `.mp4` con HEVC.

### Aviso de progreso al subir y botón "Reprocesar"

La conversión a HLS corre después de responder al upload, así que antes el
creador no tenía forma de saber si su vídeo iba a reproducirse. Ahora:

- **Al publicar** (`Upload.jsx`): no navega de inmediato. Muestra
  `OptimizePanel` con "Optimizando tu vídeo…" y sondea `GET /videos/:id/status`
  cada 3 s (máximo ~5 min) hasta `ready`, `failed` o `timeout`, con los botones
  adecuados en cada caso (Ir al feed / Reintentar / Subir otro). El sondeo se
  cancela al desmontar la pantalla.
- **En el perfil** (`Profile.jsx`): los vídeos se ven en una **rejilla estilo
  TikTok** (tres columnas de miniaturas verticales) y el estado y las acciones
  viven dentro del reproductor a pantalla completa, no en una lista aparte. Al
  abrir un vídeo se ve su `⏳ Optimizando…` / `⚠️ Sin optimizar` y, si está en
  `failed` o no tiene `hlsUrl`, un botón "🔄 Reprocesar" que llama a
  `POST /videos/:id/retranscode`.
- **`GET /api/videos/:id/status`** es un endpoint ligero y sin efectos
  secundarios: **no** incrementa el contador de vistas (a diferencia de
  `GET /:id`), que es justo lo que permite sondearlo sin inflar las métricas.
  El detalle de `transcodeError` solo se devuelve al dueño.
- Clases nuevas de CSS: `.optimize-panel`, `.optimize-title`, `.optimize-actions`,
  `.video-actions`, `.profile-grid`, `.profile-thumb*`, `.profile-player*` en
  `App.css`.

### La rejilla de vídeos del perfil (estilo TikTok)

Antes el perfil listaba los vídeos como filas de texto (título, métricas y
botones). Ahora son **miniaturas verticales en tres columnas**, como la pestaña
de vídeos de un perfil de TikTok:

- **Rejilla** (`VideoGrid` en `Profile.jsx`, `.profile-grid`): cada miniatura
  mantiene la proporción 9/16 con `aspect-ratio`, para que la rejilla no salte de
  altura mientras cargan las imágenes. Lleva el contador de vistas abreviado
  (`formatCount`, en `lib/format.js`: "1,2 mil", "3 M") y un aviso si el vídeo
  sigue optimizándose o falló.
- **Sin miniatura, el propio vídeo hace de cartel**: muchos vídeos recién subidos
  aún no tienen `thumbnailUrl`, y sin esta reserva la rejilla saldría vacía. Se
  pinta un `<video>` mudo con `preload="metadata"`.
- **Reproductor a pantalla completa** (`ProfilePlayer`): al tocar una miniatura
  se abre a pantalla completa, con desplazamiento por vídeo (snap) para pasar de
  uno a otro, botón de cerrar y de sonido. **Arranca en silencio** a propósito:
  el navegador bloquea el autoplay con audio, así que empezar mudo garantiza que
  el vídeo se vea y el usuario activa el sonido cuando quiere.
- **Solo el vídeo visible se carga**: cada diapositiva es su propio componente
  (`PlayerSlide`) y solo la activa monta la fuente; las demás muestran su
  miniatura. Sin esto, abrir el perfil descargaría todos los vídeos a la vez.
- **Exportar y Reprocesar viven en el reproductor**, junto al vídeo que se está
  viendo, en lugar de en una fila de la lista.
- **La lógica de reproducción se comparte** (`lib/video.js`, `attachVideoSource`)
  entre el feed y el perfil: preferir el HLS y caer al original si no existe, sin
  duplicar el import dinámico de hls.js.

Verificación: `npm run e2e:profile-grid` (rejilla de tres columnas, cartel de
reserva sin miniatura, contador, apertura del reproductor, salto entre vídeos y
cierre) y `npm run e2e:upload` (las acciones de exportar y reprocesar dentro del
reproductor).

### Compartir y descargar vídeos (propios o de otras personas)

En el feed, cada vídeo tiene una **flecha curva de compartir** (➦) en la barra de
acciones, al estilo TikTok. No es un menú de tres puntos: es el icono de
compartir de TikTok, y al pulsarlo abre una **hoja de compartir** desde abajo con
las salidas habituales:

- **Compartir** — Web Share API del sistema (`navigator.share`), que abre
  WhatsApp, correo, etc. Si no está disponible (escritorio, HTTP sin localhost),
  cae a copiar el enlace.
- **Copiar enlace** — copia `/?video=<id>` al portapapeles, con respaldo
  `execCommand('copy')` para contextos no seguros.
- **Descargar** — baja el archivo original, sin marca de agua (ver abajo).
- **Mensaje** — abre un chat de WhaTaka con el creador.
- **Enviar a** — fila de contactos recientes (bandeja de WhaTaka); al tocar uno
  se abre/crea el hilo y se publica el enlace con su texto.
- **No me interesa** / **Ocultar a @creador** — las señales negativas que antes
  vivían en su propio menú de tres puntos, ahora al final de la hoja.

Detalles de implementación:

- **Componente:** `frontend/src/components/ShareSheet.jsx` (hoja inferior, mismo
  telón y animación que `CreatorSheet`). El estado `shareFor` vive en `Feed.jsx`
  y la hoja se monta dentro del feed, para que el vídeo siga detrás y el scroll
  no se pierda al cerrar.
- **Helper:** `frontend/src/lib/share.js` — `videoShareUrl`, `shareMessage`,
  `copyToClipboard`, `shareWithSystem`. Son funciones puras con dependencias
  inyectables (origen, portapapeles, `document`), por eso se prueban sin DOM.
- **Enlace profundo:** el enlace apunta a `/?video=<id>` (la portada con un
  parámetro, no a `/video/<id>`, porque el servidor sirve una única página y una
  ruta desconocida daría 404). `App.jsx` lee el parámetro al arrancar, lo pasa a
  `Feed` como `focusVideoId`, y el feed trae ese vídeo con `GET /videos/:id` y lo
  coloca el primero. Se hace en un efecto aparte para no chocar con la carga
  asíncrona del feed y sin volver a saltar al principio al pulsar "Cargar más".

Descarga (la opción **Descargar** de la hoja):

- **Endpoint:** `GET /api/videos/:id/download` (con `auth`). Devuelve
  `{ downloadUrl, filename, watermark: false, reencoded: false }`. La URL apunta
  al original en `/uploads/...`, así que no hay reencode.
- **Mismas puertas que `GET /:id`:** un vídeo `rejected` responde 404, y uno
  `isNSFW` responde 404 (no 403, para no confirmar que existe) si quien lo pide
  no ha verificado su edad. El creador sí puede bajarse el suyo.
- **Contador `downloads`** en el modelo `Video`: sube solo cuando la descarga se
  concede. Es una señal de interés distinta de la vista y el "me gusta".
- **El frontend pide el fichero como blob** (`frontend/src/lib/download.js`),
  no con un enlace directo al `/uploads`. El motivo: `express.static` sirve ese
  endpoint con su propia cabecera `Content-Disposition` (nombre interno del
  archivo), y el navegador le da prioridad sobre el atributo `download`, así que
  el archivo se guardaba con el nombre feo del servidor. Con un blob el nombre
  legible (`Titulo-<id>.ext`) es el que gana.
- **Avisos:** la hoja de compartir confirma "Descargando «…»" o muestra el error
  en `.share-notice`; un fallo general del feed usa el aviso flotante
  `.reel-toast` (solo errores, y se retira solo a los 4 s).
- Tests: `backend/test/transparency.test.js` (autorización, moderación, NSFW,
  contador), `frontend/test/download.test.js` (helper de descarga),
  `frontend/test/share.test.js` (helper de compartir) y
  `frontend/test/e2e-download.mjs` (un usuario baja el vídeo de otro desde la
  hoja de compartir, con descarga real del navegador, y comprueba que el enlace
  `?video=` abre ese reel).

### Limpieza de rastro ajeno y marca TAK TAK

Un vídeo bajado de otra red (TikTok y similares) llega con el nombre, el autor,
el enlace y la herramienta en los **metadatos**, y a veces con la marca pegada
en los píxeles. Al subirlo, `transcodeService.processVideoToHLS` hace dos cosas
antes de generar el HLS:

1. **Borra los metadatos** (`-map_metadata -1` + `+bitexact`). Se aplica a tres
   sitios, porque el rastro vive en los tres: el **archivo original** servido
   (`cleanMetadata`, que reescribe el contenedor con `-c copy`, sin recodificar,
   y por eso no pierde calidad), **cada variante HLS** y la **miniatura**.
2. **Estampa la marca** `@usuario` + `TAK TAK` abajo a la izquierda, con
   `drawtext`, sobre una placa **casi opaca** (`boxcolor=0x140826@0.95`, el fondo
   oscuro de la app). Va abajo a la izquierda porque es donde la otra red pone su
   sello: así la placa **tapa** la marca ajena en vez de dejarla ver a través. El
   texto va en un fichero `brand.txt` dentro de la carpeta del vídeo (`textfile`),
   no incrustado en la cadena de filtros, porque un `:`, una coma o un `%` en el
   nombre romperían el comando. El tamaño de letra se calcula para que la línea
   más larga quepa en el 70% del ancho: con el nombre de usuario más largo
   permitido, un tamaño fijo se saldría del cuadro.

**Qué no se puede hacer.** Si la marca ajena está quemada en los píxeles y el
vídeo no es vertical (o la marca se mueve, como la de TikTok), la placa solo la
tapa si cae dentro de su zona. Quitarla de verdad no es posible: `delogo` y
`removelogo` dejan un manchurrón y necesitan que el logo esté siempre quieto.
Por eso la estrategia es tapar con la marca propia, no borrar.

- **`username`** se pasa desde la ruta: en la subida es `req.user.username`; en
  el reproceso se consulta el del **creador**, no el de quien reprocesa (un
  admin puede reprocesar el vídeo de otra persona y la autoría no cambia).
- **Sin fuente instalada** (`resolveBrandFont` prueba DejaVu/Liberation/FreeSans)
  el vídeo se limpia igual pero sin marca, y se avisa por consola.
- **Comprobación de extremo a extremo:** `bash scripts/e2e-video-hls.sh`
  (acepta `API_BASE=...`). Sube un clip vertical de fondo liso con un recuadro
  rojo (la marca ajena) y metadatos que dicen "tiktok", y verifica: (0) el
  original servido no tiene rastro, (1) el segmento HLS tampoco, (2) la marca
  está abajo a la izquierda (tinta clara en esa mitad), (3) la miniatura también
  la lleva, y (4) **el recuadro rojo ajeno desaparece** (de 8400 píxeles rojos a
  0). El fondo liso es a propósito: con una imagen de colores, el rojo y el
  blanco están por todas partes y las comprobaciones de píxeles no miden nada.
- **Tests unitarios** de los ayudantes puros (saneado del nombre, posición del
  filtro, opciones de limpieza): `backend/test/transcode-brand.test.js`. El
  pipeline con ffmpeg real se prueba en `scripts/`, no en los tests de la API,
  para que la suite no dependa de que ffmpeg esté instalado.
- Verificación con navegador real: `npm run e2e:upload` (sube un webm, comprueba
  el aviso "Optimizando → ¡Listo!" y la visibilidad del botón Reprocesar).


## Navegación y pantallas

- La barra inferior (`.tabbar`, `Navigation.jsx`) tiene siete pestañas —Inicio,
  Explorar, Facetak, Creators, Subir, WhaTaka, Perfil— y **cada sección es su
  propia pantalla**. TAK TAK es una sola aplicación con tres secciones grandes,
  cada una inspirada en una app conocida: el feed vertical (como TikTok), el chat
  WhaTaka (como WhatsApp) y Facetak (como Facebook). El resto de accesos
  (Ajustes, Monedero, Verificación, Salud de la cuenta) van dentro del perfil,
  que es donde TikTok los esconde.
- No añadas más pestañas a la barra por encima de estas siete: con siete botones
  la etiqueta ya hubo que encogerla (`font-size: 0.6rem` y `white-space:
  nowrap` en `.tabbar-label`). Si algo nuevo no es una app en sí, va al perfil.
- La única excepción es la **campana de Avisos**, que va la primera en la barra.
  No es una sección más sino una acción con estado (el contador), y tiene que
  estar visible desde cualquier pantalla: escondida en el perfil, un aviso de
  regalo pasaría desapercibido, que es justo el fallo que se corrigió. Si añades
  otra cosa a la barra, pregúntate si de verdad necesita estar siempre a la
  vista; si no, va al perfil.
- **Inicio tiene dos pestañas por dentro**, no una: `Vídeos | Publicaciones`
  (`Home.jsx`, selector flotante `.home-switch`). El feed de vídeo manda y va
  primero; Publicaciones pinta Facetak ahí mismo, sin cambiar de pestaña en la
  barra. El selector flota **sobre** el vídeo en vez de empujarlo hacia abajo a
  propósito: `.reels` mide `calc(100dvh - var(--tabbar-h))` y restarle altura
  descuadraría el encaje de cada tarjeta con el snap. Es el mismo recurso que
  usa TikTok con su "Para ti / Siguiendo".
- Al cambiar a Publicaciones el feed **no se desmonta, se pausa** (`Feed` acepta
  `paused`): si se desmontara, el vídeo seguiría sonando por detrás y al volver
  cada uno habría perdido su sitio. Con `paused`, `active` se apaga en todas las
  tarjetas y el efecto de reproducción pausa y rebobina la que estaba puesta.
- La barra es `position: fixed`. El alto vive en la variable `--tabbar-h`
  (`index.css`) y tanto `.app` como `.reels`/`.reel` lo descuentan para que el
  feed no quede tapado. Si cambias el padding de `.tabbar`, actualiza
  `--tabbar-h` o el último reel se cortará por abajo.
- El feed es la única vista sin `padding` ni `max-width` (clase `app-feed`): el
  reel ocupa toda la pantalla y la barra flota encima.
- Las pantallas que cuelgan del perfil (Ajustes, Monedero, Verificación, Salud)
  reciben `onBack` y pintan su cabecera con `.screen-head`. Respeta ese patrón:
  sin botón de volver, el usuario queda atrapado (no hay historial de router).

## Seguridad del usuario: bloquear y reportar

Dos caras del mismo problema, en `backend/src/services/safetyService.js` y
`frontend/src/components/ReportDialog.jsx` / `BlockDialog.jsx`.

- **Bloquear es mutuo, y en las dos direcciones.** `getBlockedCreatorIds`
  (`feedService.js`) devuelve los que bloqueé **y** los que me bloquearon: el
  feed filtra por los dos lados. El chat (`isBlockedBetween`) ya lo hacía así.
  Si el feed mirara solo "a quién bloqueé", quien bloquea desaparecería del otro
  pero seguiría viendo al que lo bloqueó, que es justo lo contrario de lo que
  espera cualquiera que pulse "bloquear". Al bloquear también se corta el
  seguimiento en ambos sentidos.
- **Reportar dos veces lo mismo no crea dos filas.** Hay un índice único
  `{reporter, targetType, targetId}` y `createReport` hace `upsert`: la segunda
  vez actualiza el motivo y devuelve el estado a `open`. Un doble toque no debe
  inflar la cola de moderación.
- **No se puede reportar el propio contenido.** Lo corta el servicio, no la
  ruta, porque los diálogos de vídeo y de perfil comparten esa puerta.
- **El reporte es anónimo para el reportado:** `listMyReports` filtra por
  `reporter`, así que solo ve los suyos.
- **La cola de reportes se ve en el panel de administración** (`AdminPanel.jsx`,
  sección "Reportes", con filtro por estado). Antes el reporte llegaba a la base
  de datos y no a ninguna pantalla: un agujero negro.
- Los motivos son una lista cerrada (`REASONS` en `routes/safety.js`, el mismo
  enum en el esquema). Un motivo inventado se rechaza en la validación y en el
  modelo, para que la cola se pueda agrupar.
- Regresión: `backend/test/safety.test.js` (18 casos) y el recorrido con
  navegador real `npm run e2e:explore`.

## Ranking del feed: `rankingBonus` no es un contador

- La afinidad por etiquetas se suma al ranking como likes-equivalentes. Antes se
  inyectaba sobre el campo `likes`, y como el bonus es `TAG_BONUS / weights.like`
  (no entero), la API devolvía likes fraccionarios —el feed llegó a mostrar
  `333.3333333333333`—. Ahora viaja en `rankingBonus`, el ranker lo suma en
  `computeEngagement`, y `feedService` lo elimina antes de responder. Si añades
  otra señal de ranking, dale su propio campo y bórralo al salir del servicio.

## Que una llamada se note (tono, burbuja y aviso)

Una llamada que solo cambia de pantalla no sirve: si nadie mira, no se entera.
Tres piezas, en `frontend/src/lib/ringtone.js`, `CallOverlay.jsx` y
`NotificationPrompt.jsx`:

- El tono se genera con Web Audio, sin ficheros de audio que descargar. Suena en
  `incoming` (entrante) y `ringing` (saliente), y para en cualquier otro estado.
  El efecto vive en `CallContext` y depende solo de `status`, así que colgar,
  rechazar o contestar lo apaga sin casos especiales.
- **El navegador bloquea el audio hasta el primer gesto.** Sin `unlockAudio()` en
  el primer `pointerdown`/`keydown`, el timbre sonaría mudo justo cuando más
  falta hace. El desbloqueo se engancha una sola vez y se quita solo.
- `startRingtone` es idempotente y `stopRingtone` cancela sus temporizadores: dos
  arranques no apilan dos tonos ni dejan un intervalo vivo. `isRinging()` y el
  evento `taktak:ringtone` existen para observarlo desde las pruebas (Vite sirve
  el módulo con sufijo de versión, así que un `import` desde el test obtendría
  una segunda copia con estado propio: hay que escuchar el evento, no importar).
- La **burbuja** (`minimized`) mantiene el `<audio>` remoto montado. Sin él, al
  minimizar se desmontaría el elemento y una llamada de voz quedaría muda; el
  efecto que engancha el stream depende de `minimized` justo por eso.
- El **aviso de notificaciones** (`NotificationPrompt`) es una tarjeta flotante,
  no un modal: se puede seguir usando la app sin atenderlo. El descarte se
  recuerda por cuenta. En iOS sin la app en la pantalla de inicio no se muestra,
  porque ahí el push no existe y el aviso solo confundiría.
- Sin suscripción push no hay forma de despertar un dispositivo dormido; esa era
  la causa real de que la app no estuviese "activa" para llamadas entrantes. El
  aviso es la vía para conseguir esa suscripción sin pasar por Ajustes.

## Que la llamada responda al volumen

En una llamada por navegador la voz remota es un `MediaStream` que se reproduce
en un `<audio>`. En varios móviles los botones de volumen del teléfono no bajan
ese flujo, así que bajar el volumen durante una llamada parecía no hacer nada.
Tres piezas lo resuelven:

- **Control propio** (`CallOverlay.jsx`, `.call-volume`): un deslizador que
  escribe el volumen del elemento de audio. Es el arreglo que siempre funciona,
  porque no depende del sistema. El valor vive en `CallContext` (`volume`) y se
  acota en `clampVolume` (`lib/sound.js`) para que nunca salga de `[0, 1]`; un
  dato ausente se resuelve al máximo, no a cero.
- **Sesión de audio** (`applyAudioSession`): mientras hay llamada se declara
  `navigator.audioSession.type = 'play-and-record'`. Es lo que hace que el móvil
  trate el audio como una conversación y no como música de una pestaña, de modo
  que los botones del teléfono sí la regulen. La API solo existe en Safari; si
  falta, la función no hace nada y la app sigue igual. Al colgar se vuelve a
  `'auto'` para no retener el canal de comunicación.
- **El feed se calla durante la llamada** (`shouldPauseFeed` en `lib/sound.js`,
  usado por `Home.jsx`): sin esto el vídeo de fondo seguiría sonando y los
  botones de volumen acabarían regulando el vídeo en vez de la voz. El feed se
  pausa con cualquier estado de llamada, no solo con la llamada activa.

Además, el `<video>` remoto va siempre `muted`: el stream lleva audio, pero se
reproduce en el `<audio>` para que el control de volumen no tenga que perseguir
dos copias del mismo sonido.

Verificación: `npm run e2e:calls` (dos navegadores reales; tono entrante y
saliente, parada al aceptar, audio remoto, control de volumen que baja de verdad
el volumen del audio, vídeo remoto silenciado, burbuja con vídeo y audio vivos) y
`npm run e2e:notifications` (el aviso aparece, explica que sonará con la app
cerrada y desaparece con el permiso concedido).

## Actividad: avisos de regalos, seguidores, me gusta y comentarios

Antes, un regalo desde el vídeo movía las monedas en silencio: `sendGift` no
emitía nada y no existía modelo de avisos, así que el creador no se enteraba de
que le habían regalado hasta que abría el monedero. Lo mismo con seguidores,
me gusta y comentarios. Está en `models/Notification.js`,
`services/notificationService.js`, `routes/notifications.js`, y en el frontend
`components/Activity.jsx` más la campana de `Navigation.jsx`.

- **Un único punto de entrada, `notificationService.notify()`.** Crea el aviso,
  lo entrega por socket a `userRoom(recipientId)` como `notification:new` y, si
  el destinatario no está conectado, manda un push. Los cuatro emisores (regalo
  en `routes/wallet.js`, follow en `routes/user.js`, me gusta en
  `routes/video.js`, comentario y respuesta en `services/commentService.js`)
  llaman a esa función en vez de hablar con el socket directamente.
- **Nunca se avisa a uno mismo.** El filtro está en el servicio, no en cada
  emisor: darle me gusta a tu propio vídeo o comentarte es normal y no debe
  llenar tu propia campana.
- **El aviso va después del efecto, nunca antes.** En el regalo se llama cuando
  el dinero ya se movió, y el importe que se enseña es el `result.amount` que
  devolvió `sendGift`, no lo que pidió el cliente. Si el aviso falla, el regalo
  sigue hecho; al revés se anunciaría un regalo que quizá no se cobró.
- **Al quitar un me gusta no se avisa.** Solo en el `liked` (alta); el `unlike`
  no emite. Avisar de un "ya no me gusta" sería ruido.
- **En las respuestas, el destinatario es el autor del comentario padre**, no el
  creador del vídeo: es con quien se está hablando. Por eso `commentService`
  selecciona también `author` al cargar el padre.
- **El contador de la campana se siembra del servidor** (`GET
  /api/notifications/unread-count`) y luego sube con cada `notification:new`. No
  se incrementa a ciegas con cada evento: si el usuario lee desde otro
  dispositivo, al volver a la pestaña el número se recalcula.
- **`?view=activity` abre la pantalla directamente.** Es la URL que lleva el
  push de un aviso, y se lee una sola vez al arrancar (en `App.jsx`). Sin esto,
  tocar la notificación abriría el feed y el usuario tendría que buscar el aviso
  a mano; el push de llamadas ya dependía de que el frontend leyese la URL, así
  que este era un hueco real, no una comodidad.
- El push de un aviso **no es una llamada**: usa `type: 'activity'` y el título
  es el nombre de quien actuó. `pushService` reserva `incomingCallPayload` para
  las llamadas; no mezcles ambos formatos o el service worker mostraría el aviso
  equivocado.

Verificación: `backend/test/notifications.test.js` cubre los cuatro tipos, el
filtro de uno mismo, el contador, el marcado como leído, el aislamiento entre
cuentas, la paginación por cursor y la entrega en vivo por socket con clientes
reales (`socket.io-client`).

## Facetak (la sección estilo Facebook, antes "Muro")

TAK TAK es una sola aplicación con tres secciones grandes, cada una inspirada
en una app conocida: el feed vertical (como TikTok), el chat WhaTaka (como
WhatsApp) y **Facetak** (como Facebook, antes llamado "Muro"), una sección social de publicaciones con
adjuntos, me gusta y comentarios. Facetak es `models/Post.js`,
`models/PostComment.js`, `services/postService.js`, `routes/posts.js`
(`/api/posts`) y, en el frontend, `components/Wall.jsx` con su pestaña en
`Navigation.jsx`.

- **Facetak tiene dos pestañas: Publicaciones y Marketak.** `Wall.jsx` monta un
  selector (`.wall-sections`) y renderiza `components/Marketak.jsx` en la
  segunda. Publicaciones es lo de siempre; Marketak se describe más abajo.
- **Facetak es de lectura pública.** `GET /api/posts` y los comentarios no piden
  sesión: un visitante puede leer Facetak sin cuenta, como el feed. Publicar,
  dar me gusta, comentar y borrar sí requieren sesión. Sin ella, `Wall.jsx`
  enseña Facetak pero esconde la caja de publicar y muestra `.wall-login-hint`.
- **`?view=wall` es el enlace de Facetak.** Los avisos de Facetak apuntan ahí, igual
  que `?view=activity`. Se lee una sola vez al arrancar, en `App.jsx`.
- **Los adjuntos se suben a `uploads/wall/`** por `POST /api/posts/attachments`
  (multipart, campo `file`), con la misma allowlist de `lib/attachments.js` que
  el chat: imagen o vídeo. El archivo se sube **al elegirlo**, no al publicar,
  para poder ver la vista previa y para que publicar no dependa de una subida
  lenta. El adjunto que se guarda en la publicación tiene que ser de nuestra
  propia subida (`/uploads/wall/`), no una URL externa: si no, Facetak sería un
  escaparate de contenido ajeno.
- **El me gusta es idempotente** (`$addToSet` sobre `likedBy` y `$inc` sobre
  `likes` en la misma operación). Repetir el toque no infla el contador. Mismo
  patrón que los me gusta de vídeo.
- **Los avisos de Facetak son tipos propios**: `post_like` y `post_comment`, no
  los `like`/`comment` del vídeo. El texto de un aviso es fijo por tipo ("le
  gustó tu publicación"), así que reusar el del vídeo diría "le gustó tu vídeo"
  cuando fue una publicación, que es falso. `Activity.jsx` tiene que conocer los
  tipos nuevos o caen en el genérico "hizo algo".
- **Al tocar un aviso de Facetak se abre Facetak**, no el vídeo ni el perfil: la
  publicación no tiene pantalla propia. `Activity` recibe `onOpenWall` para eso.
- **Borrar es lógico y solo del autor o un admin**, y conserva el hueco en el
  hilo igual que en los comentarios de vídeo.

Verificación: `backend/test/posts.test.js` (publicar texto y adjunto, lectura
pública, me gusta idempotente, comentar, avisos propios, borrado por autor y por
admin) y `frontend/test/e2e-wall.mjs` (dos navegadores reales: publica texto y
foto, el otro la ve, da me gusta —que no se infla al repetir—, comenta, llegan
los avisos, el autor borra y un visitante sin cuenta no puede publicar).

## Marketak (el mercado de segunda mano, dentro de Facetak)

Marketak es el mercado de segunda mano de TAK TAK, como el Marketplace de
Facebook: se publica un anuncio con fotos, precio y zona, y el comprador
contacta al vendedor por WhaTaka. Vive **dentro de Facetak** como una segunda
pestaña, no como sección propia. Es `models/Listing.js`,
`services/listingService.js`, `routes/listings.js` (`/api/listings`) y, en el
frontend, `components/Marketak.jsx` (que monta `Wall.jsx`) con sus helpers en
`lib/market.js`.

- **El precio va en TTC**, la moneda que ya existe en toda la app. Marketak **no
  cierra el pago**: el comprador escribe al vendedor por WhaTaka y acuerdan la
  entrega. Guardar el dinero en depósito exigiría un arbitraje de disputas que
  el producto todavía no tiene, así que no se finge que exista.
- **Marketak es de lectura pública.** `GET /api/listings` y el detalle no piden
  sesión, igual que Facetak. Publicar, marcar como vendido y borrar sí la piden.
- **Las fotos se suben a `uploads/market/`** por `POST /api/listings/photos`
  (multipart, campo `file`), con la allowlist de `lib/attachments.js` y **solo
  imágenes**. La foto que se guarda tiene que ser de nuestra subida
  (`/uploads/market/`); una URL externa se rechaza (400) para que Marketak no sea
  un escaparate de contenido ajeno. Máximo 8 fotos por anuncio.
- **La categoría es un `enum`, no texto libre.** `Listing.CATEGORIES`
  (`electronica`, `ropa`, `hogar`, `vehiculos`, `servicios`, `mascotas`, `otros`)
  lo comparte el modelo y el servicio; `lib/market.js` pone las etiquetas en
  español. Con texto libre, "celulares" y "celu" acabarían siendo categorías
  distintas y el filtro dejaría de servir.
- **La búsqueda usa una expresión regular escapada**, no `$text`: `$text` exige
  un índice de texto y no busca por subcadenas, que es lo que espera quien
  escribe "bici" y quiere ver "bicicleta". El patrón se escapa para que un `.*`
  escrito por el usuario no recorra la colección entera.
- **`sold` no borra el anuncio:** queda visible como vendido, para que el
  vendedor no tenga que republicarlo y quien lo buscaba sepa que se cerró. Solo
  el vendedor o un admin pueden marcarlo o borrarlo; la comprobación va en el
  servicio, no solo en la interfaz.
- **El detalle cuenta una visita** (`views`) al abrirlo, no al pintarlo en la
  cuadrícula: contar cada aparición inflaría el número sin que nadie lo mire.
- **"Escribir al vendedor" abre WhaTaka** con esa persona. `Marketak` recibe
  `onMessage`, que en `App.jsx` es `messageCreator` (el mismo que usa el feed), y
  `Wall.jsx` lo reenvía. Sin ese cableado el botón no haría nada.

Verificación: `backend/test/listings.test.js` (lectura pública, validaciones de
título/precio/categoría, foto propia vs externa, filtro por categoría, búsqueda,
contador de visitas, marcar vendido, permisos de borrado) y
`frontend/test/e2e-marketak.mjs` (dos navegadores reales: Ana publica con foto,
Beto lo encuentra buscando, abre el detalle, escribe al vendedor y Ana lo marca
vendido).

## Inicio de sesión con Facebook

Además de Google y el correo, la portada ofrece **"Continuar con Facebook"**,
siguiendo el mismo patrón que el botón de Google.

- **El SDK del navegador entrega un token de acceso opaco, no un JWT.** Por eso
  `services/facebookService.js` **verifica el token contra el Graph API**
  (`debug_token`) antes de fiarse de él. Un token sin verificar sería una puerta
  abierta: cualquiera podría mandar el token de otra app.
- **La comprobación clave es `data.app_id` igual a nuestro App ID.** Es el
  equivalente al `aud` de Google: impide que un token emitido para *otra*
  aplicación sirva para entrar aquí. Además se exige `data.is_valid`.
- **El perfil se lee del Graph API**, no del cliente: el navegador no decide
  quién eres. El correo solo llega si la app tiene el permiso `email` y la
  persona lo autorizó, así que su ausencia es normal.
- **Enlazar con una cuenta existente exige el correo verificado.** Igual que con
  Google: si Facebook no devuelve el correo, no se toca una cuenta que ya exista
  con esa dirección. Se identifica por `User.facebookId` (id estable de
  Facebook), no por el correo.
- **Cierre si no está configurado.** Sin `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET`
  el endpoint responde 503 y `/auth/providers` lo marca como no disponible, así
  que el botón no se ofrece. El CSP permite `connect.facebook.net` (script),
  `graph.facebook.com` y `www.facebook.com` (conexión); sin eso el botón falla
  en el navegador aunque el backend esté bien.
- **El Graph API se puede apuntar a un servidor falso** con
  `FACEBOOK_GRAPH_BASE`, igual que Stripe y PayPal, para probar la ruta de
  extremo a extremo sin salir a internet.

Verificación: `backend/test/facebook.test.js` (cerrado sin configurar, token
inválido, token de otra app, alta nueva, enlace con cuenta existente, providers)
y `frontend/test/auth-form.test.js` para las reglas de la portada.

## Directo del creator (SFU con mediasoup, reserva a malla)

El directo de un TAK Creator es audio **y vídeo** en grupo, con la rejilla al
estilo de TikTok Live: se ve al anfitrión en una ventana algo más grande arriba
y a los invitados repartidos debajo, hasta veinte. Está en
`VoiceRoomContext.jsx`, `LiveStage.jsx`, `VoiceRoomBar.jsx`, `VoiceRoomAudio.jsx`,
`frontend/src/lib/sfuClient.js`, `frontend/src/lib/liveGrid.js`,
`backend/src/services/sfuService.js` y la sección `voice:*` de
`backend/src/services/liveSockets.js`.

- **Es un SFU, no una malla.** Cada participante sube UN flujo de audio y otro de
  vídeo, y el servidor (`mediasoup`) los reenvía a quien los pida. El coste de
  subida no crece con el número de personas, así que aguanta salas de cientos.
  Una malla haría que cada móvil subiera un flujo por cada uno de los demás (con
  20 personas, 19 flujos por tipo), que es lo que no escala.
- **El anfitrión es el dueño del creator**, no quien entra primero. Al montar la
  sala se fija `voiceRoomHosts` y `voice:joined` lo entrega como `hostId`; el
  aforo de invitados viaja como `guestLimit`. El anfitrión no cuenta para el
  aforo: si la sala está llena y él vuelve, entra igual. El cliente pinta su
  ventana con `.live-tile.host` (más grande, arriba) y la marca "Anfitrión".
- **El modo es de la sala, no del participante.** El primero que entra decide
  (`sfu` si el servidor lo tiene disponible, `mesh` si no) y los demás se
  adaptan; el modo viaja en `voice:joined.mode`. Si cada uno eligiera por su
  cuenta, una sala mixta quedaría sorda: quien espera ofertas de malla no las
  recibe y quien espera productores del SFU tampoco. La cabecera del directo y la
  barra muestran el modo ("grupo" o "directo").
- **La malla sigue existiendo como reserva.** Si `mediasoup` no está instalado o
  el worker no se descargó, `sfuService.isAvailable()` es `false` y la sala cae
  a malla sin más. Degradar es mejor que romper. El cliente puede pedir malla
  explícitamente (`voice:join { mesh: true }`), que es lo que usan los tests.
- **Un solo sentido de negociación en malla.** Quien entra es siempre quien
  ofrece, a cada uno de los que ya estaban (`voice:joined` trae `peers`). Los que
  ya estaban esperan la oferta. Sin esta regla, dos ofertas simultáneas se pisan.
- **La autorización va contra la base de datos**, igual que el feed REST: el
  handler `voice:join` busca el squad por `slug` y comprueba la membresía si es
  privado. El nombre de la sala sale de `squad.voiceRoom` (fijado en el servidor
  al crear), nunca de un string del cliente. La señalización de malla
  (`voice:offer`/`answer`/`ice`) solo se reenvía a alguien de la misma sala y
  solo si la sala está en modo malla. Los eventos del SFU usan acuse de recibo y
  operan sobre la sala del socket, así que un socket no puede tocar los
  transportes de otra.
- **El SFU se apaga solo cuando nadie está dentro**: al quedar vacía, la sala
  cierra su router. Al desconectar, el socket libera sus transportes y
  productores (`sfuService.removeParticipant`), o quedarían consumiendo puertos.
- **El audio vive en su propio componente** (`VoiceRoomAudio.jsx`, montado en
  `App.jsx` junto a `CallOverlay`). No puede colgar ni de la barra (que se oculta
  al abrir la rejilla) ni de la rejilla (que se cierra al minimizar): en los dos
  casos el `<audio>` se desmontaría y la voz se cortaría. Por eso se puede seguir
  en el feed mientras hablas.
- **La rejilla se abre al entrar y se minimiza a la barra** (`LiveStage` +
  `stageOpen` en el contexto). Al minimizar, la barra flotante queda con los
  controles de cámara, micro, reabrir y salir. El vídeo se pinta en las ventanas;
  el sonido, en los `<audio>` ocultos (`.voice-audio`).
- **`frontend/src/lib/user.js` normaliza el id del usuario** (`_id` ?? `id`). Sin
  esto `user.id` es `undefined` y el anfitrión no se reconocería a sí mismo en la
  rejilla (ni funcionarían los avisos de una vez por cuenta).

Configuración del SFU (`backend/src/config/env.js`, todas por variable de
entorno): `SFU_ENABLED`, `SFU_ANNOUNCED_IP` (en producción TIENE que ser la IP
pública o los clientes no conectan), `SFU_LISTEN_IP`, `SFU_RTC_MIN_PORT` /
`SFU_RTC_MAX_PORT` (hay que abrirlos en el cortafuegos), `SFU_WORKERS`,
`SFU_MAX_PARTICIPANTS` y `LIVE_GUEST_LIMIT` (tope de invitados, por defecto 20).

Verificación: `npm run e2e:voice-room` (navegadores reales; con SFU prueba tres
participantes: entran al directo, se abre la rejilla con la ventana del anfitrión
marcada, todos oyen y **ven** a todos, el audio sobrevive al minimizar y al
cambio de pestaña, el silencio se propaga y al salir el par desaparece) y
`backend/test/voice-room.test.js` (autorización, host y aforo, modo de la sala,
señalización SFU con acuse de recibo, códec de vídeo, aislamiento entre salas y
limpieza al desconectar). La disposición de la rejilla se prueba aparte, sin
navegador, en `frontend/test/liveGrid.test.js`.

## Métodos de pago guardados (tarjeta y PayPal)

El usuario registra su tarjeta y su cuenta de PayPal una vez y luego paga en un
toque. Pantalla: `frontend/src/components/PaymentMethods.jsx`, vista
`metodos-pago` en `App.jsx`, alcanzable desde Monedero y desde la tienda.

- **El número de tarjeta NUNCA entra en TAK TAK.** Stripe.js lo manda del
  navegador directo a Stripe con la clave publicable (`/api/payments/config` la
  sirve); al backend solo llega un `pm_...`. De la tarjeta se guardan marca,
  últimos 4 y caducidad, y siempre leídos de Stripe
  (`stripeService.retrievePaymentMethod`), nunca del cliente. Guardar el número
  metería al proyecto en PCI-DSS y un vuelco daría tarjetas usables.
- **PayPal guarda un `vault_id`**, no una tarjeta. Es un secreto de cobro: vive
  en `PaymentMethod.providerRef`, que no se expone jamás (hay test).
- **Cobrar y acreditar están separados.** `POST /methods/:id/pay` lanza el cargo
  (`chargeStoredPaymentMethod` / `chargeStoredVault`) pero NO acredita monedas:
  eso lo hace el webhook del proveedor. Acreditar en la respuesta regalaría
  monedas si el banco rechaza el cargo después.
- **El importe sale del catálogo del servidor** (`env.coinPackages`), nunca del
  cliente, igual que en el checkout.
- **Clave de idempotencia** por (usuario, método, paquete, minuto) en cabecera
  (`Idempotency-Key` en Stripe, `PayPal-Request-Id` en PayPal): un doble clic no
  cobra dos veces.
- **Propiedad**: todas las consultas filtran por `user`; conocer el id de otro no
  permite ver, cobrar ni borrar (test de aislamiento).
- **Baja**: primero se revoca en Mongo y luego se intenta desvincular del
  proveedor. Si esa llamada falla, el método ya no se puede cobrar y la limpieza
  se reintenta después.
- **Cliente de Stripe**: se crea perezosamente en `paymentRefs.stripeCustomerId`
  (campo `select: false`). Un cobro `off_session` exige que la tarjeta cuelgue de
  un cliente; sin él Stripe lo rechaza.

Config (`backend/.env`): `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_API_BASE` (para tests), `PAYPAL_CLIENT_ID`,
`PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_API_BASE`.

Tests: `backend/test/payment-methods.test.js` contra un servidor falso real
(`backend/test/fakeProviders.js`) que se levanta en localhost y al que se apuntan
`stripeApiBase`/`paypalApiBase`. Es un HTTP de verdad, no un doble de funciones,
así que ejercita form-encode, cabeceras y parseo. `stripeApiBase` se lee en cada
llamada (`apiBase()`), no al cargar el módulo, para que el test pueda
redirigirlo. Frontend: `frontend/test/stripe.test.js` sobre la lógica de
`saveCardWithStripe`, que recibe el cliente de Stripe por parámetro para poder
probarla sin descargar Stripe.js.


## La CSP no puede quedarse en la de helmet por defecto

`app.js` monta `helmet()` con una CSP a medida y `useDefaults: false`. **No la
cambies por `helmet()` a secas**: la CSP por defecto trae `default-src 'self'`
sin excepciones y eso rompe dos cosas que la app sí usa.

- **`media-src` necesita `blob:`.** hls.js no reproduce HLS con un
  `<video src="algo.m3u8">`: descarga los segmentos y los inyecta en el elemento
  mediante un Blob (MSE). Con la CSP por defecto el navegador bloquea `blob:` y
  **ningún vídeo transcodificado se ve**, aunque el `.m3u8` y los segmentos se
  sirvan con un 200. El síntoma engaña: el reproductor queda mudo en
  `readyState 0` y `error.code 4` sin ningún error de red, porque la petición
  sí llegó bien; lo que se bloquea es el Blob.
- **`script-src` necesita `js.stripe.com` y `accounts.google.com`.** Sin eso no
  se carga Stripe (comprar monedas) ni el botón de alta con Google. Se veía en
  consola como "Failed to load Stripe.js".
- `connectSrc` lleva `wss:` porque el chat y las llamadas van por WebSocket.

Lo que **no** se relaja: nada de `unsafe-eval`, `object-src 'none'`,
`frame-ancestors 'self'` y `data:` solo para imágenes y fuentes, nunca para
scripts. Tres pruebas en `security.test.js` fijan esto; si alguien vuelve a la
CSP por defecto, fallan y explican por qué.

Esto no se detectó durante mucho tiempo porque los vídeos de prueba eran
archivos falsos de un byte: sin un vídeo real, el reproductor fallaba igual con
CSP y sin ella y la causa quedaba tapada.

## Despliegue (Docker y Render)

Las imagenes de `backend/` y `frontend/` construyen y arrancan. Trampas que ya
costaron tiempo, por si reaparecen al tocar los Dockerfiles:

- La base del backend es Debian (`node:20-slim`), no Alpine. `mediasoup` no
  publica binario para musl, asi que npm intentaba compilarlo desde fuente y el
  build moria con `python: not found`.
- Los `COPY` llevan `--chown=node:node`. El repo deja los fuentes en 660 y el
  usuario `node` no podia leerlos (`EACCES` al abrir `src/index.js`).
- `/app/uploads` se crea y se cede a `node` antes de bajar privilegios, o el
  disco persistente no es escribible.

nginx usa plantilla (`envsubst`) para que la misma imagen sirva en Compose y en
Render. `PORT` es el puerto de escucha, `BACKEND_URL` la URL completa del
backend y `RESOLVER` el DNS que resuelve ese nombre: `127.0.0.11` en Docker (el
unico que conoce el nombre del servicio) y `1.1.1.1` en Render. El destino se
guarda en una variable (`$backend_upstream`) para que nginx lo resuelva en cada
peticion; con la forma directa lo resuelve al arrancar y, si la API aun no
existe, el frontend no levanta. Al usar variable hay que declarar `resolver`, y
si el DNS no conoce el nombre el proxy devuelve 502.

Render se define en `render.yaml` (dos servicios, plan gratuito). La base de
datos no esta ahi: la app usa transacciones y eso exige un replica set, asi que
Mongo va en Atlas y su cadena se pasa en `MONGODB_URI`. En el plan gratuito no
hay disco persistente, por eso no se declara: los videos subidos se pierden en
cada despliegue. Con `SFU_ENABLED=false` (Render no da UDP) las llamadas usan el
modo malla. El frontend apunta a la URL publica de la API porque su nginx
resuelve con DNS publico.

### GitHub Pages no puede ejecutar esta app

`taktakmessenger.github.io` sirve la rama `gh-pages`, que es solo el build
estatico. No hay servidor: las llamadas a `/api` no tienen a quien llegar, asi
que la pantalla de entrada se queda parada. No es un fallo que se arregle ahi,
es que Pages no ejecuta backend. La app necesita un servicio como el de Render.

### Metodos de entrada

`GET /api/auth/providers` decide que botones funcionan. Con todo apagado
(`google:false`, `facebook:false`, `sms:false`, `email:false`) la pantalla de
entrada sigue ofreciendo correo y telefono: el registro por correo funciona y el
codigo de verificacion se imprime en consola (`MAIL:dev`) y se muestra en
pantalla si no hay proveedor de SMS. Para activarlos: `GOOGLE_CLIENT_ID`,
`FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET` (login con Facebook), `SMS_PROVIDER=twilio`
con `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER`, y el correo
con las variables SMTP.

## Keep-alive: por que el servicio no se duerme

Render duerme un servicio web gratuito tras 15 minutos sin trafico de entrada y
la siguiente visita espera cerca de un minuto. `scripts/keepalive.js` pide la
aplicacion cada 10 minutos para que cuente actividad.

Va como **worker aparte**, no como un temporizador dentro de la API, y la razon
es que Render apaga la instancia que duerme: un `setInterval` dentro de ese
proceso muere con el y jamas podria despertarlo. El worker vive en otro
contenedor, sigue haciendo peticiones y es quien la despierta. Un worker
gratuito no se duerme.

### El limite de 750 horas decide la arquitectura

El plan gratuito da 750 horas de instancia al mes por espacio de trabajo. Dos
servicios encendidos 24/7 son unas 1440 horas: se agotan hacia el dia 15 y
Render suspende **todos** los servicios gratuitos hasta el mes siguiente. Por
eso hay **un solo servicio web** que sirve la web y la API juntas (unas 720
horas al mes) y no dos. El keep-alive cuesta ademas cerca de 1 hora al mes.

Consecuencia: el frontend y la API comparten origen. Encaja con como esta
escrito el frontend, que llama a `/api` y a Socket.IO con rutas relativas.

### Un solo servicio sirve la web y la API

`backend/src/middleware/serveFrontend.js` monta el build del frontend desde el
mismo proceso. Se activa con `PUBLIC_DIR` y sin esa variable no hace nada, asi
que el desarrollo y las pruebas siguen igual.

El comodin del SPA tiene dos exclusiones que costaron un fallo cada una:

- `/api`, `/socket.io`, `/uploads` y `/assets` no lo usan. Si lo hicieran, una
  ruta inexistente devolveria la pagina con un 200. En `/uploads` el
  reproductor intentaba leer HTML como video.
- Cualquier ruta con extension tampoco lo usa. Sin esto un asset que falta se
  servia como la pagina con un 200 y el navegador intentaba ejecutar el HTML
  como JavaScript.

El `index.html` y `sw.js` se sirven con `max-age=0`, que obliga a revalidar en
cada visita: un service worker cacheado deja al navegador pegado a una version
vieja de la app. Los assets llevan hash en el nombre, asi que se cachean un ano
con `immutable`.

El contexto de build del backend es la **raiz del repositorio**, no `./backend`,
porque la imagen construye y copia el frontend. Por eso `backend/Dockerfile`
referencia `backend/package.json`, `backend/src` y `frontend/`, y por eso el
`.dockerignore` que se aplica es el de la raiz.

El frontend se compila **dentro de la imagen**, en una etapa `web` aparte, y el
`dist` se copia de ahi con `COPY --from=web`. Asi un clon recien bajado compila
con un solo `docker build`, sin ejecutar `npm run build` a mano antes. La etapa
usa `node:20-slim` y no Alpine para no arrastrar dos bases distintas, ya que el
backend necesita Debian por mediasoup.

Pruebas: `backend/test/serve-frontend.test.js` levanta la app en un proceso hijo
por caso, porque `config/env` lee `PUBLIC_DIR` al importarse. Usa archivos de
verdad en disco: un doble de `express.static` no diria nada sobre cabeceras ni
sobre el comodin, que es donde estaban los fallos.

## AVISO: el repositorio remoto tiene dos versiones distintas de TAK TAK

`main` en `taktakmessenger/taktakmessenger.github.io` y esta rama de trabajo **no
comparten ni un commit**. Son dos proyectos separados, no dos ramas del mismo:

- `main` (267 archivos): app React con `src/` y `server/`, Capacitor y Android,
  Firebase, su propio `render.yaml`. Sin `backend/` ni `frontend/`.
- Esta rama (186 archivos): `backend/` (Express, Socket.IO, Mongo, mediasoup) y
  `frontend/` (Vite + React). Es la que sirve la web y la API en un solo proceso.

Consecuencia practica: **no hacer `git push --force` a `main`**. Un push directo
falla por historias no relacionadas, y forzarlo borra la otra app. Antes de
tocar `main` hay que decidir cual de las dos es TAK TAK. Lo mismo con
`git merge origin/main`: intentaria fusionar dos arboles de archivos sin
relacion y saldria un desastre.

El token de GitHub del entorno es de una GitHub App con permiso **solo de
lectura** (`Resource not accessible by integration` en cualquier escritura, y
403 al hacer push). La API miente en `permissions` y reporta `admin: true`; el
permiso real de la instalacion manda. Para desbloquearlo hay que dar a la App
`Contents: Read and write`, o usar un token con permiso `repo`.

## La economia de monedas: por que un regalo con bono NO da diamantes

Hay tres saldos y confundirlos lleva a "arreglar" lo que ya esta bien:

- `ttcC` (coins): monedas **pagadas** con dinero real.
- `bonusC` (bonusCoins): monedas de regalo (bienvenida, promos). Se gastan en
  regalos, pero **nunca** se convierten en dinero.
- `ttcR` (diamonds): diamantes **retirables**. Solo nacen de monedas pagadas.

Un regalo paga primero `ttcC` y luego `bonusC`. Si se paga con `bonusC`, el
creador recibe `bonusC` (monedas de bono), **no** diamantes. Es deliberado: sin
ese corte, N cuentas gratis se regalan entre si y retiran dinero que la
plataforma nunca recibio. Cualquier prueba que espere diamantes de un regalo con
el bono de bienvenida esta midiendo la economia vieja.

Para probar el 60/40 de verdad hace falta saldo pagado. En local, la via sin
pasarela es `POST /api/admin/users/:id/credit` con `{"amount":1000,"bucket":"ttcC"}`
y un token de admin. Comprobado: regalo de 300 pagado -> creador recibe 180
diamantes (60% exacto).

## Los limitadores de peticiones son la causa de "fallos" fantasma

`authLimiter` permite **20 intentos cada 15 minutos** por IP, y hay un limite
base de 300 req/min en `/api`. Al ejecutar `scripts/smoke-api.sh` varias veces
seguidas, las llamadas empiezan a devolver 401 "Token de autenticacion
requerido" y parece que el login o la mensajeria se han roto. No se han roto:
es el limitador. Se arregla reiniciando el backend (el contador vive en memoria)
y ejecutando el smoke **una sola vez**.

## smoke-api.sh necesita SMOKE_ADMIN_TOKEN para probar el dinero

El reparto 60/40 requiere monedas pagadas, que en local solo concede un admin.
Sin el token, esa seccion se omite con un aviso en vez de fallar. Para
ejecutarla entera:

```bash
ADM=$(curl -s -X POST http://127.0.0.1:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<admin>@example.com","password":"<clave>"}' | \
  python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
SMOKE_ADMIN_TOKEN="$ADM" bash scripts/smoke-api.sh
```

Ultima ejecucion: **51/51 en verde** (backend 308/308, frontend 48/48).

## Un aviso flotante puede dejar WhaTaka "muerta" sin dar ningun error

Los avisos anclados abajo (el de notificaciones, `.notif-prompt`) son tarjetas
`position: fixed` que se dibujan **encima** de lo que queda debajo. Si no se
limita su `pointer-events`, se comen el toque de lo que tapan: en pantallas
bajas (360x640) tapaban el compositor del chat, el boton de llamar y la lista de
paises del marcador.

El sintoma engana porque **no hay error de consola**: el boton "Enviar" parece
muerto, el mensaje "no sale" y el selector de pais "no abre". Se diagnostica con
`document.elementFromPoint()` en el centro del control: si devuelve otro
elemento, ese es el que roba el toque.

Reglas que quedan de esto:

- Un aviso flotante no bloqueante lleva `pointer-events: none`, y sus propios
  botones `pointer-events: auto`. Un modal real (`.modal`) si bloquea a
  proposito.
- El aviso de notificaciones no se dibuja en la vista `messages`: ahi choca con
  el compositor y el teclado del marcador. Se sigue ofreciendo sobre el feed.
- `frontend/test/e2e-whataka-taps.mjs` cubre esto: comprueba con
  `elementFromPoint` que el campo de mensaje, "Enviar", el boton de pais y el de
  llamar reciben el toque, a 360x640. Es la regresion del fallo.

### Los harness de la interfaz se desincronizan con el tiempo

Al cambiar textos o marcado, los scripts de `scripts/e2e-*.js` fallan por
selectores viejos y parece que la app esta rota. Dos trampas ya vistas:

- La pestana se llama **WhaTaka**, no "Mensajes".
- `.thread-composer input` es el **input de archivo oculto** (el del clip `📎`);
  el campo de texto es `.thread-composer input[type="text"]`. Teclear en el
  primero no envia nada y el harness daba "el mensaje no llega".

Antes de culpar a la app, comprobar que el selector del harness sigue existiendo.

Otras trampas vistas al probar Explorar y la seguridad
(`scripts/e2e-explore-safety.js`):

- **Los avisos de entrada interceptan los clics.** Al abrir la sesión saltan dos
  modales de pantalla completa (añadir teléfono y activar notificaciones). Un
  `click` sobre un elemento que hay debajo no llega y parece que el botón "no
  funciona". Hay que descartarlos antes de tocar nada (ver `dismissPrompts`).
- **Esperar por texto da falsos positivos.** `waitText(page, '@beto')` daba por
  abierto el perfil cuando `@beto` ya estaba en la lista de resultados de
  Explorar. Para saber si una pantalla se abrió, esperar un selector suyo
  (`.public-profile-safety`), no un texto que pueda estar en la pantalla previa.
- **Comprobar el estado con la API, no con el texto de la pantalla.** El feed
  pinta una tarjeta a la vez y la base de datos de desarrollo acumula vídeos de
  ejecuciones anteriores con títulos parecidos. Comparar por `_id` contra
  `/feed/for-you` es determinista; buscar el título en `innerText` no lo es.

## La lista de países se perdía al reiniciar la app

Sintoma: se reinicia TAK TAK y el marcador de WhaTaka se queda sin codigos de
area (el boton muestra `🌐` y el selector sale vacio), hasta recargar la pagina.

Causa: `Dialer.jsx` pedia `/auth/providers` **una sola vez** al montar y su
`.catch(() => {})` se tragaba el error **sin reintentar**. Ese es justo el primer
momento de la sesion, asi que si el backend aun arrancaba (un 502 del proxy
mientras levanta) la lista se perdia para siempre. El mismo patron estaba en
`AuthForm.jsx` (registro) y `PhoneLink.jsx` (enlazar telefono): un solo intento,
error silenciado.

Arreglo: `frontend/src/lib/providers.js` centraliza la carga con **reintentos de
espera creciente** (1, 2, 4 y 8 s) y `shouldAbort` para no seguir reintentando si
el componente se desmonto. Lo usan los tres. Sin el `shouldAbort`, un reintento
programado seguiria vivo despues de salir de la pantalla.

- Regresion con navegador real: `npm run e2e:area-codes` (necesita
  `E2E_BASE_URL`). Intercepta `/auth/providers` para que falle 8 s y comprueba
  que el marcador **se recupera solo** (pasa de `🌐` a `+1` con 245 paises) sin
  recargar. Antes de medir se espera hasta 25 s: los reintentos tardan, y medir a
  los pocos segundos da un falso negativo.
- Tests unitarios del reintento (sin esperas reales): `frontend/test/providers.test.js`.

## "Se caia la senal": el token caducaba y nadie lo renovaba

Sintoma: con la app abierta un rato (o al volver al dia siguiente), dejan de
llegar mensajes y llamadas y la app parece "sin senal", sin ningun error claro.

Causa (cadena completa):
1. La sesión se apoya en un token de **7 dias**. El de refresco (30 dias) se
   guardaba en `localStorage` (`taktak_refresh`) pero **nunca se canjeaba**: no
   habia ninguna llamada a `/auth/refresh` en el frontend. (El backend tambien
   emite un `accessToken` de 1 h, pero el frontend usa `token`, el de 7 dias, y
   es el que valida el socket con `env.jwtSecret`.)
2. Al caducar el token, cada peticion recibia 401 y el interceptor **borraba la
   sesion entera** (`clearSession`), echando al usuario sin intentar renovar.
3. El socket se autentica **solo al conectar**. Con el token caducado el
   servidor rechaza el handshake con `Token invalido` y socket.io reintentaba
   para siempre con el mismo token muerto: no habia recuperacion posible sin
   recargar y volver a entrar.

Arreglo:
- `frontend/src/lib/session.js` (NUEVO): `refreshSession()` canjea el refresco
  (una sola peticion en vuelo, aunque lleguen varios 401 a la vez), guarda el
  token nuevo y avisa por `onSessionChange`. Distingue **definitivo** (`null`:
  4xx del refresco, hay que volver a entrar) de **pasajero** (`undefined`: red
  caida o 5xx, no se cierra la sesion). `tokenExpiry()` lee el `exp` del JWT.
- `frontend/src/api/client.js`: en un 401 renueva y **reintenta** la peticion
  una vez (`__retried`) en lugar de cerrar sesion. Un fallo pasajero no borra
  nada.
- `frontend/src/contexts/AuthContext.jsx`: escucha `onSessionChange` (asi el
  token renovado llega al estado y al socket) y **renueva por adelantado** 1
  minuto antes de caducar. El arranque ya no cierra sesion si `/users/me` falla
  por red (solo si de verdad no queda token).
- `frontend/src/contexts/SocketContext.jsx`: en `connect_error` por token,
  renueva y reconecta con el token nuevo (`instance.auth.token = fresh`).
  Reconexion sin limite.
- `frontend/src/components/ConnectionBanner.jsx` (NUEVO): aviso "Sin conexion.
  Reconectando…" (con 3 s de gracia, para no parpadear en cortes normales).

- Regresion con navegador real: `npm run e2e:session-renewal` (necesita
  `JWT_SECRET` y `E2E_BASE_URL`). Arranca con un token **caducado** y un refresco
  valido, y comprueba que la app se recupera sola: renueva el token y el socket
  vuelve a conectar. **Verificado que falla sin el arreglo** (0 conexiones, el
  socket se queda reintentando).
- Tests unitarios (servidor HTTP real, sin dobles): `frontend/test/session.test.js`
  y los casos nuevos de `frontend/test/api-response.test.js`.

### Un WebSocket no genera eventos `response` en Puppeteer

Al diagnosticar esto, las sondas de red veian **0** handshakes de socket.io
aunque el socket conectaba perfectamente. La razon: el cliente usa
`transports: ['websocket', 'polling']` y el WebSocket (upgrade 101) **no** emite
eventos `response`/`requestfailed` de Puppeteer. Para verlo hay que usar
**CDP**: `page.target().createCDPSession()` + `Network.enable` y escuchar
`Network.webSocketCreated` y `Network.webSocketFrameReceived`. El servidor manda
un fotograma que empieza por `40` cuando el namespace conecta (sesion aceptada) y
`44` (connect_error) cuando rechaza el token: asi se distingue exito de rechazo.
No confundir con `window.__taktakSocketConnected`, que solo existe en DEV (el
build de produccion no lo define).

### Las llamadas van por cuenta, no por teléfono

Las llamadas WebRTC (voz y vídeo) se invitan por **id de cuenta**
(`call:invite { to: <id> }` en `backend/src/services/liveSockets.js`). El
teléfono no interviene: `startCall` solo necesita `target.id`. Por eso una
cuenta registrada **con correo** (sin teléfono) sí puede recibir y hacer
videollamadas.

La trampa está en el **marcador**: `/api/users/lookup-phone` busca en el campo
`phone`, así que una cuenta de correo nunca se encuentra por ahí y la
videollamada quedaba inalcanzable desde esa pantalla. El marcador ahora acepta
también `@usuario` y resuelve con `GET /api/users/:username`. Si vuelve a
reportarse "no me deja videollamar a X", comprobar primero si X se registró con
correo: su teléfono estará vacío y hay que buscarle por `@usuario`.

`frontend/test/e2e-call-email-account.mjs` cubre esto de extremo a extremo con
dos navegadores (una cuenta de correo recibe y acepta la videollamada).

### Las suites e2e esperan la app en 13000

El valor por defecto de `E2E_BASE_URL` en los `frontend/test/e2e-*.mjs` es
`http://127.0.0.1:13000`. En este entorno la app corre en 12000, así que hay que
pasar la variable: `E2E_BASE_URL=http://127.0.0.1:12000 node test/e2e-home.mjs`.
Sin ella el fallo es `ECONNREFUSED 127.0.0.1:13000` y parece que la app está
rota.

### Playwright puede perder sus navegadores

Si `chromium.launch()` falla con "Executable doesn't exist ... chrome-headless-shell",
no es un fallo del test: hay que reponerlos con
`cd frontend && npx playwright install chromium`.


## Traducción de WhaTaka: dónde vive cada pieza

La traducción tiene tres sitios y conviene no confundirlos, porque cada uno
resuelve un caso distinto:

- **Mensajes de texto** — `frontend/src/components/TranslateButton.jsx`, uno por
  burbuja del otro. Se apoya en `frontend/src/lib/translateClient.js`, que lleva
  la caché por sesión y la deduplicación de peticiones en vuelo.
- **Notas de voz** — `frontend/src/components/VoiceTranscript.jsx`. Intenta
  primero `POST /api/messages/transcribe` (servidor, si hay `STT_PROVIDER`);
  si no, cae al reconocimiento del navegador, que obliga a reproducir la nota en
  alto para que el micrófono la oiga. Traduce con el mismo `translateText` del
  chat, así que funciona sin configurar nada: con solo MyMemory, una nota en
  chino se lee en español (y al revés) sin tocar ajustes. El botón se ofrece
  siempre en las notas ajenas porque el cliente no sabe si el servidor tiene
  proveedor de STT; la comprobación se hace al pulsar (503 → respaldo local).
- **Llamadas** — `frontend/src/lib/speech.js` (lógica pura) enganchado en
  `frontend/src/contexts/CallContext.jsx`, con la interfaz en
  `frontend/src/components/CallOverlay.jsx`.

### En una llamada cada lado reconoce su propia voz

El modelo es emisor/receptor y no "traducir el audio del otro": cada lado
reconoce **su** micrófono, manda el TEXTO por `call:speech`, y el receptor lo
traduce a su idioma y lo sintetiza. Nadie reproduce el audio del otro para
volver a capturarlo. Las razones, por si alguien quiere cambiarlo:

- Mi voz se oye limpia en mi dispositivo; el audio que llega del otro viene
  comprimido y con eco, y reconocerlo da peor transcripción.
- Reproducir en alto para capturar con el micrófono falla con auriculares, que es
  justo cuando más se usa una llamada.
- El texto no gasta ancho de banda y el otro lo dice con la voz de **su**
  sistema, que es la que suena bien en su dispositivo.

`call:speech` es el único evento de llamada que el servidor NO reenvía a ciegas:
valida que sea cadena y lo recorta a 1000 caracteres en
`backend/src/services/liveSockets.js`, porque el otro lado lo va a decir en voz
alta. Los demás (`call:offer`, `call:answer`, `call:ice`) sí son opacos.

### La traducción automática del hilo se pide en lote

Al encender el interruptor del hilo, `Messages.jsx` pide **un** lote
(`POST /api/translate/batch`) con los últimos 30 mensajes en vez de dejar que
cada burbuja pida el suyo: veinte burbujas serían veinte peticiones y saltarían
el límite por minuto del servidor. El lote deja las traducciones en la caché de
`translateClient` y las burbujas las recogen cuando `translateReady` avisa. El
endpoint acepta 30 como máximo, así que el `slice(-30)` no es decorativo.

### La traducción funciona sin contratar nada

`backend/src/services/translationService.js` tiene un proveedor **sin clave**,
MyMemory (`mymemoryProvider`). Es el que hace que la app traduzca recién
instalada, sin que nadie configure una cuenta: `auto` elige deepl → google →
libretranslate y, si no hay ninguno, cae en MyMemory. Dos detalles que no son
opcionales:

- **Corta a 500 caracteres** (403 por encima). El proveedor trocea el texto en
  trozos de 450 y vuelve a unir la traducción; sin eso, todo mensaje largo se
  quedaría sin traducir.
- **Contesta 200 con un aviso dentro** cuando se agota la cuota diaria
  (`responseStatus: 403`). Ese aviso en inglés no puede acabar en la burbuja como
  si fuera la traducción, así que se detecta y se lanza un 502.
- El chino se pide como `zh-CN`/`zh-TW`: el servicio no conoce `zh-Hans` y, si se
  mandara tal cual, no traduciría.

Los tests lo ejercitan contra un servidor falso (`test/fakeTranslator.js`, ruta
`/mymemory`), nunca contra internet. En `NODE_ENV=test` el proveedor sin clave
queda apagado salvo que un test lo pida con `{ provider: 'mymemory' }`.

### La traducción en vivo es solo de las llamadas de WhaTaka

`CallOverlay` se pinta en toda la app, así que sin una marca explícita la
traducción de llamada aparecería también en las que salen del feed. El origen
viaja con la llamada y se decide en un solo sitio:

- `startCall(target, kind, origin)` (`CallContext`) fija el origen **al empezar**
  y no cambia en toda la llamada. `callPeerFromChat` en `App.jsx` es el único que
  pasa `'whataka'`; los demás puntos de llamada (feed, perfil, marcador fuera del
  chat) pasan `'app'` por defecto.
- El servidor **normaliza** el origen en `call:invite`: lo que no sea exactamente
  `whataka` es `app`. Un cliente no puede etiquetar su llamada como del chat para
  colar la traducción donde no toca. Lo reenvía en `call:incoming`.
- El receptor **no se fía de lo que reciba**: vuelve a comprobar que sea
  `whataka` antes de ofrecer la traducción.

El idioma de cada parte sale del **perfil** (`preferredLanguage`), no de lo que
diga el cliente. El llamante lo manda en `call:incoming` y el servidor lo
devuelve en `call:ringing`. Con los dos idiomas, `CallContext` calcula
`needsTranslation` (idiomas distintos) e `isWhatakaCall`, y `CallOverlay` ofrece
un aviso de un toque para traducir en vez de esperar a que el usuario encuentre
el botón. Si falta el idioma del otro, `needsTranslation` es falso: es preferible
callar a sugerir una traducción que puede no hacer falta.

`cleanup` limpia origen e idioma al colgar. Sin eso, la siguiente llamada
heredaría el "es de WhaTaka" de la anterior y ofrecería traducir donde no toca.

### Una llamada traducida es semi-dúplex, y sin eso entra en bucle

El motor de la traducción en vivo son tres piezas en `frontend/src/lib/speech.js`:
un reconocedor de mi voz (`createRecognizer`), un altavoz de la traducción
(`createSpeaker`) y los dos extremos que las unen (`createSpeechSender` y
`createSpeechReceiver`). El fallo que hay que entender antes de tocar esto es el
**eco**, porque no se ve leyendo el código y hace la función inservible en cuanto
se usa sin auriculares:

1. Ana dice algo; el reconocedor de Ana lo convierte en texto y lo manda.
2. A Li le llega, lo traduce a su idioma y su altavoz lo dice en alto.
3. **Ese altavoz lo oye el micrófono de Li**, que está abierto. Lo reconoce como
   si fuera Li hablando y lo reenvía a Ana.
4. Ana lo traduce y lo dice, y su altavoz lo vuelve a capturar. La llamada repite
   frases cada vez más deformadas.

Se corta en dos sitios, y los dos hacen falta:

- **El altavoz cierra el micrófono mientras habla.** `createSpeaker` avisa por
  `onStart`/`onEnd`, y `CallContext` los engancha a `sender.pause()`/`resume()`.
  Es semi-dúplex a propósito: en una llamada traducida no se puede hablar y oír
  la síntesis a la vez.
- **El emisor descarta lo que llegue con el altavoz aún en la boca.** Cerrar el
  micrófono no basta: el reconocedor tarda un poco en cerrar un resultado final,
  así que una frase que oyó del altavoz puede llegar después de que este termine.
  Por eso `createSpeechSender` recibe `isSpeaking` y `pause` deja `paused = true`
  hasta el `resume`.

Tres detalles que son trampas:

- `stop()` del emisor pone `active = false`. Al apagar la traducción se para
  primero el emisor y luego el altavoz; el `onEnd` del altavoz llama a `resume`,
  y sin ese distintivo el micrófono se reabriría justo cuando el usuario acaba de
  pedir que se cierre.
- El altavoz lleva un **vigilante** (`setTimeout` al doble de lo que tardaría una
  persona en decir la frase). Algunos navegadores no disparan `onend`; como
  `speaking` cierra el micrófono, quedarse en `true` dejaría al usuario mudo el
  resto de la llamada.
- Mientras habla la síntesis, `CallOverlay` baja la voz del otro al 15 % en vez
  de callarla: si se cortara, se perdería el principio de la frase que el otro
  empieza mientras termina la traducción.

El e2e que cubre todo esto es `frontend/test/e2e-call-translate-live.mjs`.
Chromium headless no tiene motor de voz, así que instala dobles de
`webkitSpeechRecognition` y `speechSynthesis` con `addInitScript` (antes de que
cargue la app, para que `canRecognize`/`canSynthesize` los vean) y comprueba lo
que sí es real: el cableado de `CallContext`, el envío por `call:speech`, el relay
del servidor, la traducción de verdad contra la API y la pausa del micrófono.

### La transcripción no deja leer el audio de otro

`POST /api/messages/transcribe` recibe una **ruta relativa** de un adjunto del
chat, no una URL. `transcriptionService.resolveAttachmentPath` la resuelve
dentro de la carpeta de adjuntos y rechaza cualquier cosa que se salga de ahí,
que es lo que cierra el SSRF. Además,
`messageService.attachmentBelongsToUser` comprueba que el audio está en un
mensaje de una conversación del que pregunta: sin eso, la ruta del audio se ve en
el DOM y cualquiera podría transcribir la nota de voz de otro con solo copiarla.
Los tests de esto están en `backend/test/transcription.test.js`.
