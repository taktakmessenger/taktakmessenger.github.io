# TAK TAK

Plataforma de video con economía de tokens **TTC**. Los usuarios suben videos,
se siguen entre sí, se envían regalos y los creadores acumulan tokens
retirables.

Este repositorio mejora el prototipo original corrigiendo varios problemas de
corrección y seguridad (ver [Mejoras sobre el prototipo](#mejoras-sobre-el-prototipo)).

## Stack

| Capa | Tecnología |
|------|------------|
| Backend | Node.js 20+, Express 4, Mongoose 8 |
| Base de datos | MongoDB 6 (replica set de un nodo) |
| Frontend | React 18 + Vite 5 |
| Auth | JWT + bcrypt |
| Infra | Docker + docker-compose |

## Economía TTC

Dos saldos por usuario:

- **Monedas (TTC-C)** — gastables. Se usan para enviar regalos.
- **Diamantes (TTC-R)** — retirables. Los creadores los ganan con regalos.

En la API se exponen ambos nombres: `coins`/`diamonds` (de cara al usuario) y
`ttcC`/`ttcR` (los buckets internos), para no romper clientes existentes.

Flujo de un regalo:

```
emisor Monedas  --(débito atómico)-->  se divide:
                                       75% -> Diamantes del creador
                                       25% -> plataforma
```

El reparto es configurable con `CREATOR_SHARE` / `PLATFORM_SHARE`, pero ambos
deben sumar 1 o el proceso se niega a arrancar (un desajuste crearía o destruiría
tokens). El 25% de la plataforma se registra como asiento contable propio
(`Transaction.type = 'platform'`), así los ingresos son auditables, y se agregan
en `GET /api/admin/stats` como `platformEarnings`.

## Funciones diferenciales frente a TikTok

| Función | Endpoint | Punto de dolor que resuelve |
|---|---|---|
| Monetización abierta | `GET /api/wallet/monetization` | TikTok exige 10k seguidores y 100k vistas. Aquí `eligible: true` desde el primer video. |
| Exportar limpio | `GET /api/videos/:id/export` | Descarga sin marca de agua ni logo, sin webs externas. |
| Panel de salud | `GET /api/health` | Muestra exactamente qué limita tu alcance. Sin shadowban opaco. |
| TAK Creators | `POST /api/squads`, `/:slug/join`, `/:slug/feed` | Comunidad privada con código de invitación, contenido exclusivo y sala de voz. |

### TAK Creators

- `POST /api/squads` — crea un creator. El creador queda como `owner` y se genera
  un `voiceRoom`.
- `GET /api/squads` — creators públicos + aquellos donde ya eres miembro.
- `POST /api/squads/:slug/join` — los públicos entran directo; los privados
  requieren `joinCode`. Unirse dos veces no duplica al miembro.
- `DELETE /api/squads/:slug/leave` — el `owner` no puede salir de su propio creator.
- `GET /api/squads/:slug/feed` — contenido exclusivo, solo para miembros.

El `joinCode` nunca se devuelve al cliente.

## Requisitos

- Node.js >= 20
- Docker (para MongoDB, o una instancia propia)

## Inicio rápido (local)

La forma más simple es el script, que levanta la pila entera de una vez
(Docker + MongoDB + backend + frontend) y es idempotente:

```bash
bash scripts/dev-up.sh     # levanta todo y comprueba que responde
bash scripts/dev-down.sh   # lo para
```

En un contenedor que se reinicia solo (como el de desarrollo), añade el
vigilante para que la app se levante sola cuando se caiga:

```bash
setsid bash scripts/dev-watch.sh > /tmp/taktak-watch.log 2>&1 < /dev/null &
```

Comprueba cada 30 s que backend y frontend respondan; si alguno no responde,
vuelve a ejecutar `dev-up.sh`. Se para con `pkill -f dev-watch.sh`.

Si prefieres hacerlo a mano:

```bash
# 1. MongoDB como replica set de un nodo (habilita transacciones)
docker run -d --name taktak-mongo -p 27017:27017 mongo:6 \
  mongod --replSet rs0 --bind_ip_all
docker exec taktak-mongo mongosh --quiet --eval \
  'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'

# 2. Backend
cd backend
cp .env.example .env          # ajusta JWT_SECRET
npm install
npm run dev                   # http://localhost:4000

# 3. Frontend (otra terminal)
cd frontend
npm install
npm run dev                   # http://localhost:3000
```

El frontend hace proxy de `/api` hacia `http://localhost:4000`.

## Inicio rápido (Docker)

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
docker compose up --build
# Frontend: http://localhost:3000
# API:      http://localhost:4000
```

## Tests

Los tests corren contra un MongoDB real (no mocks), porque las garantías de
atomicidad del wallet solo se pueden verificar con la base de datos de verdad.

```bash
cd backend
TEST_MONGODB_URI=mongodb://localhost:27017/taktak_test npm test
```

Cobertura actual: autenticación, videos, wallet (incluido un test de regresión de
doble gasto con peticiones concurrentes) y squads.

## API

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/auth/register` | — | Crear cuenta |
| POST | `/api/auth/login` | — | Iniciar sesión |
| GET | `/api/users/me` | ✅ | Perfil propio |
| PATCH | `/api/users/me` | ✅ | Editar perfil |
| GET | `/api/users/:username` | — | Perfil público + videos |
| POST/DELETE | `/api/users/:username/follow` | ✅ | Seguir / dejar de seguir |
| GET | `/api/videos` | — | Feed paginado |
| GET | `/api/videos/:id` | — | Ver video (incrementa vistas) |
| POST | `/api/videos` | ✅ | Publicar por URL |
| POST | `/api/videos/upload` | ✅ | Subir archivo (multipart) + HLS |
| POST | `/api/videos/:id/like` | ✅ | Alternar like (idempotente) |
| GET | `/api/videos/:id/export` | ✅ | Exportar sin marca de agua |
| DELETE | `/api/videos/:id` | ✅ | Borrar (dueño o admin) |
| GET | `/api/feed/for-you` | — | Feed personalizado por retención |
| GET | `/api/feed/interests` | — | Etiquetas que el sistema infiere de ti |
| POST | `/api/feed/hide-creator` | ✅ | "No me interesa" este creador |
| DELETE | `/api/feed/hide-creator/:id` | ✅ | Deshacer |
| POST | `/api/feed/hide-tag` | ✅ | Silenciar una etiqueta |
| POST | `/api/analytics/watch` | ✅ | Registrar retención de reproducción |
| GET | `/api/gifts` | — | Catálogo de regalos (precios del servidor) |
| GET | `/api/sounds` | — | Sonidos reutilizables |
| GET | `/api/payments/packages` | — | Paquetes de monedas |
| POST | `/api/payments/webhook` | 🔑 | Webhook de compra (firma + idempotencia) |
| GET | `/api/wallet` | ✅ | Saldos |
| GET | `/api/wallet/transactions` | ✅ | Historial |
| GET | `/api/wallet/monetization` | ✅ | Monetización abierta |
| POST | `/api/wallet/gift` | ✅ | Enviar regalo (monto o `giftId`) |
| POST | `/api/wallet/withdraw` | ✅ | Solicitar retiro |
| GET | `/api/health` | ✅ | Panel de salud de cuenta |
| GET | `/api/squads` | ✅ | TAK Creators |
| WS | `live:join` / `live:message` / `live:gift` | ✅ | Chat y regalos en vivo |
| GET | `/api/admin/stats` | 🛡️ | Métricas |
| GET | `/api/admin/videos` | 🛡️ | Cola de moderación |
| PATCH | `/api/admin/videos/:id/moderate` | 🛡️ | Aprobar / rechazar |
| POST | `/api/admin/users/:id/credit` | 🛡️ | Ajustar saldo |

## Mejoras sobre el prototipo

### Fase 4: modelo de recomendación

El feed anterior ordenaba con `sort({ views: -1, likes: -1 })`. Eso optimiza un
solo objetivo, que es exactamente cómo un feed se convierte en un motor de
clickbait, y no deja entrar contenido nuevo. Se reemplazó por un modelo de dos
etapas, siguiendo la arquitectura que ByteDance publicó para su recomendador
(Monolith, ACM RecSys 2022) y la descripción pública del "Para ti" de TikTok:

1. **Recuperación (en Mongo):** filtra a un conjunto de candidatos — sin
   rechazados, sin lo ya visto, sin creadores ni etiquetas silenciados.
2. **Ranking (en `rankingService`):** la función de valor multi-objetivo.

Cuatro piezas concretas:

- **Función de valor multi-objetivo.** Cada señal se puntúa por separado con un
  peso explícito (compartir > regalo > comentario > like > vista), así que un
  share vale más que un like *a propósito*. Los pesos son configuración
  (`FEED_WEIGHT_*`), porque codifican intención de producto.
- **Compresión logarítmica** (`ln(1+x)`). Sin ella un solo video viral con un
  millón de vistas aplasta a todos los demás candidatos a cero.
- **Decaimiento por vida media.** La popularidad se multiplica por
  `0.5 ** (edad / FEED_HALF_LIFE_HOURS)`, así que un video del año pasado no
  puede ganarle a uno de esta mañana.
- **Arranque en frío por niveles.** Un video nuevo y poco expuesto recibe un
  impulso temporal de exploración (+60% por defecto) que se desvanece con la
  edad y con las impresiones. Es el paso de "distribuir primero a un público
  pequeño" descrito públicamente, y es lo que hace que un creador nuevo tenga
  oportunidad.

Además, **tope por creador** (`FEED_MAX_PER_CREATOR`, 2 por defecto): sin él una
cuenta prolífica ocupa la página entera. El tope es estricto — una página puede
volver más corta antes que repetir creador, porque rellenar desde el sobrante
anularía el tope (fue un bug real durante el desarrollo).

Y **señales negativas explícitas**: "no me interesa" por etiqueta y "ocultar
creador". Un recomendador las necesita tanto como las positivas; sin ellas, la
única forma de escapar de un tema es dejar de abrir la app.

### Fase 3: auditoría, HLS y funciones que estaban desconectadas

Una revisión archivo por archivo encontró código completo que nunca llegaba al
usuario, y varios fallos de dinero y de datos:

1. **Cuatro módulos huérfanos (crítico).** `feed.js`, `analytics.js`,
   `gifts.js` y `sounds.js` existían y tenían tests, pero `app.js` nunca los
   montaba: respondían 404 en producción. El feed personalizado, el catálogo de
   regalos y el registro de retención eran inalcanzables. Ya están montados.
2. **Likes inflables (crítico).** El endpoint decía ser idempotente pero hacía
   `$inc` sin condición: tres toques del mismo usuario daban `likes: 3`, inflando
   el contador con el que el feed rankea. Ahora
   `likedBy` con `$addToSet` condicional hace que sea una alternancia real.
3. **HLS nunca se activaba.** `hasFfmpeg()` comprobaba `fs.access('ffmpeg')`,
   que resuelve relativo al directorio de trabajo. Con la ruta por defecto
   (`ffmpeg`) siempre fallaba, así que el transcodificado estaba muerto en
   silencio. Ahora un nombre simple se busca en el PATH ejecutándolo.
4. **No había subida de archivos.** El formulario solo aceptaba una URL. Ahora
   `POST /api/videos/upload` recibe el archivo con `multer`, lo sirve en
   `/uploads` y lanza el HLS en segundo plano (el video es reproducible al
   instante; la calidad adaptativa llega después).
5. **El catálogo de regalos estaba vacío.** `sendGift` ya sabía leer el precio
   del servidor, pero no había dónde. Se siembran 8 regalos al arrancar y la
   ruta acepta `giftId`, así el cliente no puede elegir cuánto cuesta un regalo.
6. **No existía la compra de monedas.** Las monedas se ganaban, pero no se
   compraban. Se añadió `POST /api/payments/webhook` con firma de tiempo
   constante e idempotencia por `externalId` (índice único), de modo que un
   webhook reintentado no acredita dos veces.
7. **Socket.IO estaba instalado y sin usar.** Ahora hay chat y regalos en vivo,
   con el token verificado en el handshake: un socket anónimo puede mirar pero
   no publicar.

### Correcciones anteriores

Problemas corregidos respecto al código original:

1. **Doble gasto en regalos (crítico).** El prototipo leía el saldo, lo
   comparaba en JavaScript y guardaba el documento. Dos regalos concurrentes
   podían pasar la comprobación y dejar el saldo en negativo. Ahora el
   débito es una única actualización condicional atómica
   (`findOneAndUpdate` con `$gte`), y el crédito + asiento contable se aplican
   en una transacción (o con escritura compensatoria en MongoDB standalone).
2. **Secretos hardcodeados.** El `JWT_SECRET` tenía un valor por defecto
   inseguro usado también en producción. Ahora el arranque falla en producción
   si no se define `JWT_SECRET`.
3. **Sin validación de entrada.** Se añadió `express-validator` en todos los
   endpoints que reciben datos, y límites de tasa en auth y operaciones de
   dinero.
4. **Contraseñas.** El prototipo hasheaba manualmente en la ruta de registro.
   Ahora el hashing ocurre en un hook `pre('save')`, la contraseña es
   `select: false` y nunca se serializa.
5. **Panel de admin sin control de acceso.** `/api/admin/*` estaba abierto.
   Ahora exige token válido **y** rol `admin` (`requireAdmin`).
6. **Minería con condición de carrera.** Repartía con read-modify-write por
   usuario, perdiendo actualizaciones. Ahora usa `$inc` atómico y registra cada
   recompensa en el libro de transacciones.
7. **Transacciones inexistentes en el libro contable.** Los retiros no dejaban
   rastro. Ahora cada regalo, retiro y recompensa genera una entrada.
8. **Fuga de información en login.** Mensajes distintos para usuario
   inexistente y contraseña incorrecta. Ahora el mensaje es genérico.
9. **Manejo de errores inconsistente.** El prototipo devolvía 500 para todo y
   filtraba el stack. Ahora hay un manejador central que respeta el status y
   solo muestra el stack fuera de producción.
10. **Sin cierre ordenado.** Se añadió manejo de `SIGINT`/`SIGTERM`, healthcheck
    y `trust proxy`.

## Interfaz

El diseño sigue la identidad neón fosforescente de TAK TAK: fondo oscuro con
degradados radiales violeta/rosa/cian, superficies translúcidas con
`backdrop-filter`, botones en degradado y resplandores de acento.

- Los tokens de color y tipografía viven en `frontend/src/styles/index.css`
  (`--pink`, `--primary`, `--accent`, `--glow-*`). Cambiar la paleta es cambiar
  esas variables.
- La maquetación de cada vista está en `frontend/src/styles/App.css`.
- En pantallas pequeñas la barra de navegación baja al borde inferior, como en
  una app nativa.

## Estructura

```
backend/
  src/
    config/       env + conexión Mongo (con detección de transacciones)
    models/       User, Video, Transaction
    middleware/   auth, validación, errores
    routes/       auth, user, video, wallet, admin
    services/     walletService, giftService
  test/           tests de integración (node:test + supertest)
frontend/
  src/
    api/          cliente axios
    contexts/     AuthContext
    components/   Navigation, Feed, Upload, Wallet, Profile, AdminPanel, AuthForm
    styles/       index.css (tokens de marca) + App.css (maquetación)
scripts/
  dev-up.sh       levanta Docker + Mongo + backend + frontend
  dev-down.sh     para la pila
  dev-watch.sh    vigilante: relanza la pila si se cae
```

## Notas de seguridad

- Ejecuta siempre sobre HTTPS en producción.
- `CORS_ORIGIN` debe apuntar al dominio del frontend, no a `*`.
- La subida de archivos está fuera de alcance: el API acepta URLs de video ya
  alojadas. Para subida directa, integra S3/MinIO y valida tipo y tamaño.
- Los retiros quedan en estado `pending`: la integración con la pasarela de pago
  (PayPal, Zelle, cripto) es responsabilidad del operador.
