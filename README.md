# TAKTAK — Plataforma de vídeos cortos y juegos

TAKTAK es una plataforma para subir, ver y compartir vídeos cortos y pequeños juegos. Este proyecto está pensado para ser self‑hosted o desplegado rápidamente usando Firebase (autenticación, storage y Firestore). Inspirado en TikTok, ofrece las funciones básicas de una red social de vídeo.

## Descripción
Página para subir vídeos y juegos. Usuarios pueden registrarse, subir/editar vídeos, ver un feed por deslizamiento, dar like, comentar y compartir enlaces a perfiles y vídeos.

## Características principales
- Registro e inicio de sesión (Google / teléfono)  
- Perfil de usuario con avatar y biografía  
- Feed tipo "swipe" (recomendados y de amigos)  
- Reproducción avanzada de vídeo con ExoPlayer  
- Grabar vídeo desde la cámara o subir desde galería  
- Likes, comentarios y búsqueda por hashtags  
- Compartir enlaces públicos a perfiles/vídeos  
- Temas (Claro/Oscuro) y notificaciones básicas  
- Panel administrador (opcional) y reglas básicas de seguridad

## Requisitos previos
- Android Studio (SDK 28 o superior)  
- Dispositivo Android (Android 9 / Pie o superior) o emulador con 4GB RAM recomendado  
- Cuenta de Firebase (Firestore + Storage + Auth)  
- Gradle compatible (recomendado: 7.x / Android Gradle Plugin acorde)

## Instalación rápida (Android)
1. Clona el repositorio:
   git clone https://github.com/taktakmessenger/taktakmessenger.github.io
2. Crea un proyecto en Firebase y añade Android app; descarga `google-services.json`.
3. Coloca `google-services.json` en la carpeta `app/`.
4. Abre el proyecto en Android Studio y sincroniza Gradle.
5. Construye y ejecuta: `Run` → selecciona dispositivo/emulador.

## Dependencias recomendadas (añadir a app/build.gradle — sección dependencies)
```gradle
implementation platform('com.google.firebase:firebase-bom:latest-version')
implementation 'com.google.firebase:firebase-auth'
implementation 'com.google.firebase:firebase-firestore'
implementation 'com.google.firebase:firebase-storage'

implementation 'com.google.android.exoplayer:exoplayer:2.20.2'
implementation 'com.squareup.retrofit2:retrofit:2.9.0'
implementation 'com.squareup.retrofit2:converter-gson:2.9.0'
implementation 'com.squareup.okhttp3:okhttp:4.11.0'

implementation 'com.google.dagger:hilt-android:2.46.1' // opcional pero recomendado
kapt 'com.google.dagger:hilt-compiler:2.46.1'

implementation 'androidx.lifecycle:lifecycle-viewmodel-ktx:2.6.1'
implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3'
implementation 'io.coil-kt:coil:2.4.0'
implementation 'androidx.room:room-runtime:2.6.1'
kapt 'androidx.room:room-compiler:2.6.1'
```

## Permisos Android (AndroidManifest.xml)
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<!-- Evitar READ/WRITE_EXTERNAL_STORAGE en Android 10+; usar Scoped Storage/SAF -->
```
Usa permisos en tiempo de ejecución (ActivityCompat.requestPermissions / permisos por flujo).

## Ejemplo básico: subida a Firebase Storage (Java)
```java
StorageReference storageRef = FirebaseStorage.getInstance().getReference();
Uri file = videoUri; // Uri del archivo de vídeo
StorageReference videoRef = storageRef.child("videos/" + userId + "/" + System.currentTimeMillis() + ".mp4");

UploadTask uploadTask = videoRef.putFile(file);
uploadTask.addOnProgressListener(snapshot -> {
    double progress = (100.0 * snapshot.getBytesTransferred()) / snapshot.getTotalByteCount();
    // actualizar UI
}).addOnSuccessListener(taskSnapshot -> {
    videoRef.getDownloadUrl().addOnSuccessListener(uri -> {
        String downloadUrl = uri.toString();
        // guardar downloadUrl en Firestore como nuevo post
    });
}).addOnFailureListener(e -> {
    // manejar error
});
```

## Reglas básicas sugeridas para Firebase

Storage.rules (ejemplo):
```text
service firebase.storage {
  match /b/{bucket}/o {
    match /videos/{userId}/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == userId
        && request.resource.contentType.matches("video/.*")
        && request.resource.size < 50 * 1024 * 1024;
    }
  }
}
```

Firestore.rules (ejemplo):
```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /posts/{postId} {
      allow read: if true;
      allow create: if request.auth != null &&
                    request.resource.data.keys().hasAll(['videoUrl','ownerId','createdAt']);
      allow update, delete: if request.auth != null && request.auth.uid == resource.data.ownerId;
    }
  }
}
```

## Integración ExoPlayer (Kotlin)
```kotlin
val player = ExoPlayer.Builder(context).build()
val mediaItem = MediaItem.fromUri(videoUri)
player.setMediaItem(mediaItem)
player.prepare()
player.playWhenReady = true
playerView.player = player

override fun onStop() {
  super.onStop()
  player.release()
}
```

## Buenas prácticas y mejoras recomendadas
1. Reglas estrictas de Firebase (validación de campos y tamaños).  
2. Subida resiliente y transcodificación (Cloud Functions + FFmpeg) para generar thumbnails y uniformizar codecs.  
3. Background upload / WorkManager para reintentos con conectividad intermitente.  
4. Introducir DI (Hilt) y arquitectura limpia (Repository, ViewModel, UseCases).  
5. Tests unitarios y de UI (Espresso) para flujos críticos.  
6. Monitoreo y límites (Cloud Functions y límites de Storage) para evitar abuso.

## Contribuir
Si utilizas este repo como base, incluye la LICENSE (MIT) y conserva el aviso de copyright si así lo decides. Pull requests y mejoras son bienvenidas.

## Licencia
Este proyecto usa MIT License. Ver `LICENSE` para detalles.
