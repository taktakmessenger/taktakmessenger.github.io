# AGENTS.md

Guía para agentes que trabajen en este repositorio.

## Resumen

TAK TAK: plataforma de video con economía de tokens TTC.
- `backend/` — API Express + Mongoose (CommonJS).
- `frontend/` — React 18 + Vite (ESM, JSX).

## Comandos

```bash
# Pila completa (Docker + MongoDB + backend + frontend). Idempotente.
bash scripts/dev-up.sh
bash scripts/dev-down.sh

# Vigilante: relanza la pila sola si se cae (contenedor que se reinicia).
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

No hay Playwright en el entorno, pero **sí hay Chromium en `/usr/bin/chromium`**,
y basta con `puppeteer-core` (que no descarga navegador) para lanzar **dos
navegadores con cámara y micrófono falsos** y hacer una llamada real entre ellos:

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
- La espera de socket listo en el test usa `window.__taktakSocketConnected`, una
  señal que `SocketContext` solo expone en desarrollo (`import.meta.env.DEV`).
- Resultado: 6/6 en voz y 4/4 en vídeo, con audio (y vídeo) remotos confirmados.

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
    Los tres fallos de `e2e-upload-optimize.js` en este contenedor son
    ambientales: sin `ffmpeg` no hay HLS (`TRANSCODE_ENABLED`), no son de la UI.
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

### El vídeo se ve pero no suena: se subió en H.265/HEVC

Un `.mp4` grabado con un iPhone en modo "Alta eficiencia" es H.265/HEVC. El
fichero **sí trae pista de audio**, pero Chrome y Firefox de escritorio no traen
el códec, así que el `<video>` falla con `MEDIA_ELEMENT_ERROR: Format error`
(código 4): ni imagen ni sonido. No es un problema del micrófono ni del altavoz;
es de formato.

La solución es el HLS: `transcodeService` reencoda a **H.264/AAC**, que sí es
universal. Para que eso ocurra hacen falta dos cosas:

1. **`ffmpeg` instalado** (`sudo apt-get install -y ffmpeg`). El servicio lo
   detecta en el PATH y, si no está, sirve el original tal cual y avisa por
   consola: `[transcode] ffmpeg no disponible...`.
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
- **En el perfil** (`Profile.jsx`): cada vídeo propio muestra su estado
  (`⏳ Optimizando…` / `⚠️ Sin optimizar`) y, si está en `failed` o no tiene
  `hlsUrl`, un botón "🔄 Reprocesar" que llama a `POST /videos/:id/retranscode`.
- **`GET /api/videos/:id/status`** es un endpoint ligero y sin efectos
  secundarios: **no** incrementa el contador de vistas (a diferencia de
  `GET /:id`), que es justo lo que permite sondearlo sin inflar las métricas.
  El detalle de `transcodeError` solo se devuelve al dueño.
- Clases nuevas de CSS: `.optimize-panel`, `.optimize-title`, `.optimize-actions`,
  `.video-actions` en `App.css`.
- Verificación con navegador real: `npm run e2e:upload` (sube un webm, comprueba
  el aviso "Optimizando → ¡Listo!" y la visibilidad del botón Reprocesar).


## Navegación y pantallas

- La barra inferior (`.tabbar`, `Navigation.jsx`) tiene cinco pestañas —Inicio,
  Creators, Subir, WhaTaka, Perfil— y **cada sección es su propia pantalla**. No
  añadas pestañas nuevas a la barra: mete el acceso dentro del perfil, que es
  donde TikTok esconde ajustes, verificación y salud de la cuenta.
- La única excepción es la **campana de Avisos**, que va la primera en la barra.
  No es una sección más sino una acción con estado (el contador), y tiene que
  estar visible desde cualquier pantalla: escondida en el perfil, un aviso de
  regalo pasaría desapercibido, que es justo el fallo que se corrigió. Si añades
  otra cosa a la barra, pregúntate si de verdad necesita estar siempre a la
  vista; si no, va al perfil.
- La barra es `position: fixed`. El alto vive en la variable `--tabbar-h`
  (`index.css`) y tanto `.app` como `.reels`/`.reel` lo descuentan para que el
  feed no quede tapado. Si cambias el padding de `.tabbar`, actualiza
  `--tabbar-h` o el último reel se cortará por abajo.
- El feed es la única vista sin `padding` ni `max-width` (clase `app-feed`): el
  reel ocupa toda la pantalla y la barra flota encima.
- Las pantallas que cuelgan del perfil (Ajustes, Monedero, Verificación, Salud)
  reciben `onBack` y pintan su cabecera con `.screen-head`. Respeta ese patrón:
  sin botón de volver, el usuario queda atrapado (no hay historial de router).

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

Verificación: `npm run e2e:calls` (dos navegadores reales; tono entrante y
saliente, parada al aceptar, audio remoto, burbuja con vídeo y audio vivos) y
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

## Sala de voz del creator (SFU con mediasoup, reserva a malla)

La sala de voz de un TAK Creator es audio en grupo. Está en
`VoiceRoomContext.jsx`, `VoiceRoomBar.jsx`, `frontend/src/lib/sfuClient.js`,
`backend/src/services/sfuService.js` y la sección `voice:*` de
`backend/src/services/liveSockets.js`.

- **Es un SFU, no una malla.** Cada participante sube UN flujo de audio y el
  servidor (`mediasoup`) lo reenvía a quien lo pida. El coste de subida no crece
  con el número de personas, así que aguanta salas de cientos. Una malla haría
  que cada móvil subiera un flujo por cada uno de los demás (con 20 personas, 19
  flujos), que es lo que no escala.
- **El modo es de la sala, no del participante.** El primero que entra decide
  (`sfu` si el servidor lo tiene disponible, `mesh` si no) y los demás se
  adaptan; el modo viaja en `voice:joined.mode`. Si cada uno eligiera por su
  cuenta, una sala mixta quedaría sorda: quien espera ofertas de malla no las
  recibe y quien espera productores del SFU tampoco. La barra muestra el modo
  ("grupo" o "directo").
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
- **La barra vive fuera de las vistas** (`App.jsx`, junto a `CallOverlay`). Si se
  desmontara al cambiar de pestaña, el `<audio>` remoto se iría con ella y la
  sala quedaría muda. Por eso se puede seguir en el feed mientras hablas.
- Los elementos `<audio>` de los pares están ocultos (`.voice-audio`): solo
  existen para sonar, uno por participante.

Configuración del SFU (`backend/src/config/env.js`, todas por variable de
entorno): `SFU_ENABLED`, `SFU_ANNOUNCED_IP` (en producción TIENE que ser la IP
pública o los clientes no conectan), `SFU_LISTEN_IP`, `SFU_RTC_MIN_PORT` /
`SFU_RTC_MAX_PORT` (hay que abrirlos en el cortafuegos), `SFU_WORKERS` y
`SFU_MAX_PARTICIPANTS`.

Verificación: `npm run e2e:voice-room` (navegadores reales; con SFU prueba tres
participantes: entran a la misma sala, el servidor monta el SFU, todos oyen a
todos, el audio sobrevive al cambio de pestaña, el silencio se propaga y al salir
el par desaparece) y `backend/test/voice-room.test.js` (autorización, modo de la
sala, señalización SFU con acuse de recibo, aislamiento entre salas y limpieza al
desconectar).

