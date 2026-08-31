# TakTak 🎵 — Plataforma de Vídeos Cortos y Juegos

TakTak es una plataforma moderna, interactiva y de alto rendimiento para subir, ver, compartir vídeos cortos en formato vertical y jugar minijuegos integrados (estilo TikTok / Reels / Douyin). Incluye soporte para aplicaciones Android (ExoPlayer + Firebase / Clean Architecture), backend escalable en Node.js/Express con soporte S3/MinIO y Cloudflare R2, y frontend PWA en React/Vite con modo standalone para GitHub Pages.

---

## ⚡ Características Principales

- 🎬 **Feed Vertical Inmersivo**: Desplazamiento tipo swipe con reproducción continua, autoplay suave, control rápido de sonido (🔇/🔊) y barra de progreso.
- 🎮 **Plataforma de Minijuegos Integrados ("Juegos" 🎮)**: Pestaña con minijuegos interactivos (TakTak Beat Runner, desafíos de ritmo y reflejos) con registro y publicación de récords en el feed.
- 🎥 **Grabador de Vídeo con Cámara en Vivo**: Grabación directa con la cámara web o móvil (`MediaRecorder` y permisos `CAMERA` + `RECORD_AUDIO`), previsualización instantánea y publicación con un clic.
- 📤 **Carga de Archivos de Vídeo & Galería**: Selector local de archivos (`.mp4`, `.webm`) con soporte drag & drop y generación automática de previsualizaciones.
- ❤️ **Interacciones Sociales**: Doble toque con ráfaga de corazones neón, contador reactivo de me gusta, drawer deslizable de comentarios en tiempo real y contador de compartidos.
- 🔗 **Compartir Multiplataforma**: Integración directa con WhatsApp, Telegram, Twitter/X y copia rápida al portapapeles.
- ✨ **AI Creation Studio**: Generador automático de clips cortos y guiones mediante el adaptador `MoneyPrinterTurbo`.
- 🔍 **Búsqueda & Tendencias**: Filtrado instantáneo por hashtags (`#lifestyle`, `#gaming`, `#coding`, `#aivideo`, `#trend`).
- 👤 **Gestión de Perfiles & Autenticación Flexible**: Inicio de sesión con Google, SMS/Teléfono o usuario Demo; perfil con avatar personalizable, edición de biografía y estadísticas.
- 🌓 **Temas & Diseño Premium**: Modo oscuro profundo estilo TikTok (`#000000`/`#121212`), acentos neón (#FE2C55 / #25F4EE) y micro-animaciones a 60 FPS.

---

## 🚀 Inicio Rápido

### 1. Ejecución Web Inmediata (Zero-Build / GitHub Pages)
Simplemente abre `index.html` o `preview.html` en cualquier navegador web moderno (Chrome, Edge, Safari, Firefox) o sírvelo directamente con cualquier servidor estático.

### 2. Frontend React + Vite (`taktak-web`)
```bash
cd taktak-web
npm install
npm run dev
```
> La app estará disponible en `http://localhost:3000`.

### 3. Backend Express API (`taktak-api`)
```bash
cd taktak-api
npm install
npm start
```
> API disponible en `http://localhost:4000`.

### 4. Infraestructura Docker Completa (Opcional)
```bash
docker-compose up -d
```
- **MinIO S3**: `http://localhost:9000` (Consola: `http://localhost:9001`, user: `minioadmin` / pass: `minioadmin`)
- **PostgreSQL**: `localhost:5432` (db: `taktak`, user: `taktak`, pass: `taktakpass`)
- **Redis**: `localhost:6379`

---

## 🔥 Configuración de Firebase (Firestore & Storage)

### Variables de Entorno (`.env`)
Configura tu archivo `taktak-web/.env`:
```env
VITE_FIREBASE_API_KEY=AIzaSyTuApiKeyFirebase
VITE_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tu-proyecto
VITE_FIREBASE_STORAGE_BUCKET=tu-proyecto.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef0123456789
VITE_BASE_URL=http://localhost:3000
VITE_API_URL=http://localhost:4000
```

### Reglas de Seguridad de Firestore (`firestore.rules`)
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /posts/{postId} {
      allow read: if true;
      allow create: if request.auth != null && 
                    request.resource.data.keys().hasAll(['videoUrl', 'ownerId', 'createdAt']);
      allow update, delete: if request.auth != null && request.auth.uid == resource.data.ownerId;
    }
    match /users/{userId} {
      allow read: if true;
      allow create, update: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### Reglas de Seguridad de Storage (`storage.rules`)
```javascript
service firebase.storage {
  match /b/{bucket}/o {
    match /videos/{userId}/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == userId
                   && request.resource.contentType.matches('video/.*')
                   && request.resource.size < 50 * 1024 * 1024;
    }
  }
}
```

---

## 📱 Guía para el Proyecto Android (ExoPlayer & Clean Architecture)

1. Coloca tu archivo `google-services.json` dentro del directorio `app/`.
2. En `app/build.gradle` añade las dependencias recomendadas:
```groovy
dependencies {
    implementation platform('com.google.firebase:firebase-bom:31.2.3')
    implementation 'com.google.firebase:firebase-auth'
    implementation 'com.google.firebase:firebase-firestore'
    implementation 'com.google.firebase:firebase-storage'
    implementation 'com.google.android.exoplayer:exoplayer:2.20.2'
    implementation 'com.squareup.retrofit2:retrofit:2.9.0'
    implementation 'com.squareup.retrofit2:converter-gson:2.9.0'
    implementation 'io.coil-kt:coil:2.4.0'
}
```
3. Permisos en `AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
```

---

## 📄 Licencia

Este proyecto está distribuido bajo la licencia MIT.
