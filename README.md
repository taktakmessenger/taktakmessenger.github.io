# TakTak 🎵 — Plataforma de Vídeo Corto (Node + React PWA)

TakTak es una plataforma moderna y completa de vídeo vertical en formato corto (estilo TikTok / Instagram Reels / Douyin). Incluye backend escalable en Express, frontend web PWA optimizado con feed vertical inmersivo, soporte para carga de vídeos directa y mediante URLs prefirmadas S3/MinIO, interacciones sociales y adaptadores para generación de vídeos con IA.

---

## ⚡ Estructura del Repositorio

```text
taktak/
├── docker-compose.yml        # Infraestructura local: Postgres, Redis, MinIO, FFmpeg
├── docs/
│   └── OSS_ADAPTERS.md       # Guía de integración de IA & Licencias OSS (MoneyPrinterTurbo, KrillinAI)
├── taktak-api/                # Backend API (Node.js + Express)
│   ├── .env.example
│   ├── index.js              # Endpoints auth, presigned S3, feed, likes, comentarios, AI generator
│   ├── package.json
│   └── Dockerfile
└── taktak-web/                # Frontend React PWA (Vite + React)
    ├── package.json
    ├── vite.config.js
    ├── public/               # Manifest PWA y Service Worker
    └── src/
        ├── components/       # Feed vertical, VideoCard, Upload, AI Studio, Comments, Likes
        ├── context/          # Contexto de autenticación JWT
        └── index.css         # Diseño ultra-oscuro estilo TikTok con Glassmorphism y Neón
```

---

## 🚀 Inicio Rápido (Quickstart)

### Opción 1: Con Docker Compose (Infraestructura Completa)

1. **Levantar los servicios base:**
   ```bash
   docker-compose up -d
   ```
   *Servicios inicializados:*
   - **MinIO S3**: `http://localhost:9000` (Consola Web: `http://localhost:9001`, user: `minioadmin` / pass: `minioadmin`)
   - **PostgreSQL**: `localhost:5432` (db: `taktak`, user: `taktak`, pass: `taktakpass`)
   - **Redis**: `localhost:6379`
   - **FFmpeg**: Contenedor listo para transcodificación

2. **Iniciar el Backend:**
   ```bash
   cd taktak-api
   npm install
   npm start
   ```
   *API disponible en `http://localhost:4000`.*

3. **Iniciar el Frontend:**
   ```bash
   cd taktak-web
   npm install
   npm run dev
   ```
   *App web disponible en `http://localhost:3000`.*

---

### Opción 2: Modo Ligero (Sin Docker)
TakTak cuenta con **fallback automático**: si no tienes MinIO o Docker corriendo, el backend gestiona las subidas directamente de forma local (`/uploads`) y carga vídeos de muestra en el feed para que puedas probar todas las funcionalidades al instante.

---

## 📱 Características Principales

- 🎬 **Feed Vertical Inmersivo**: Snap-scrolling vertical, autoplay/pause inteligente mediante `IntersectionObserver`, barra de progreso y botón rápido de sonido.
- ❤️ **Interacciones Sociales**: Doble toque con animación de corazones flotantes, contador reactivo de likes, drawer deslizable de comentarios y modal de compartir.
- 📤 **Carga de Vídeos**: Selector con previsualización en tiempo real, etiquetas (#hashtags), asignación de audio y soporte de subida prefirmada a S3/MinIO.
- ✨ **AI Creation Studio**: Generador de shorts automáticos a partir de un guión o prompt mediante el adaptador `MoneyPrinterTurbo`.
- 📲 **PWA & Offline Ready**: Service Worker integrado, instalación en pantalla de inicio y detección de estado de conexión.
- 🎨 **Diseño de Vanguardia**: Dark mode profundo (`#000000` / `#121212`), acentos neón (#FE2C55 / #25F4EE), tipografía moderna y micro-animaciones a 60 FPS.

---

## 🔌 Endpoints de la API

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `GET` | `/health` | Estado del servicio |
| `POST` | `/api/auth/login` | Inicio de sesión / token JWT |
| `POST` | `/api/auth/demo` | Acceso rápido con usuario de demostración |
| `GET` | `/api/feed` | Feed paginado con metadatos de vídeos, autor y tags |
| `POST` | `/api/presign` | Generación de URL prefirmada para subida a S3/MinIO |
| `POST` | `/api/upload-complete` | Notificación de subida finalizada a S3 |
| `POST` | `/api/upload-direct` | Subida multipart directa (fallback local) |
| `POST` | `/api/interactions/like` | Toggle de me gusta |
| `POST` | `/api/interactions/comment` | Publicar nuevo comentario |
| `POST` | `/api/interactions/share` | Registrar contador de compartidos |
| `POST` | `/api/ai/generate` | Generar vídeo corto con IA (MoneyPrinterTurbo) |

---

## 📄 Licencia
Este prototipo está disponible bajo la licencia MIT. Consulta [docs/OSS_ADAPTERS.md](docs/OSS_ADAPTERS.md) para más detalles sobre licencias de librerías y modelos de terceros.
