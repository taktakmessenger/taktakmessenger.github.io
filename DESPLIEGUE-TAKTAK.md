# TAK TAK: cómo desplegar en Render

## Lo que ya está hecho y probado

Un solo servicio web sirve la web y la API juntas, y un worker aparte lo pide
cada 10 minutos para que Render no lo duerma. Todo verificado sobre la imagen
real:

- Web, rutas profundas del SPA y API: 200.
- Vídeo borrado y asset que falta: 404 (antes devolvían la página con un 200).
- Assets con hash: `immutable`. `index.html` y `sw.js`: revalidan cada visita.
- Keep-alive: 200 contra una URL HTTPS pública, y sigue insistiendo si la app
  no responde.
- Pruebas: backend 303/303, frontend 48/48.

## Por qué no he podido subirlo yo

El token de GitHub que tengo es de una GitHub App con permiso **solo de
lectura**. Lo he comprobado petición a petición:

| Acción | Resultado |
| --- | --- |
| Leer el repositorio | 200 |
| Leer workflows | 200 |
| Crear un issue | 403 |
| Crear una rama | 403 |
| `git push` | 403 |

El mensaje exacto es `Resource not accessible by integration`. La API dice que
tengo `admin: true`, pero el permiso real de la instalación es `contents: read`,
y GitHub no deja ampliarlo por API. El token que venía guardado en el remoto
está caducado (devuelve 401).

## Dos versiones distintas de la app en el mismo repositorio

Esto es importante y conviene resolverlo a conciencia, porque `main` y el
trabajo que tienes aquí **no comparten ni un solo commit**:

- `main` (267 archivos): app React con `src/` y `server/`, Capacitor y Android,
  Firebase, `render.yaml` propio. Sin `backend/` ni `frontend/`.
- Este trabajo (186 archivos): `backend/` (Express, Socket.IO, Mongo,
  mediasoup) y `frontend/` (Vite + React), que es la que sirve la web y la API.

Son dos proyectos separados. Un push directo a `main` no fusiona nada: daría
error por historias no relacionadas, y forzarlo borraría la otra app. Por eso no
he tocado `main`.

**Decide qué quieres que sea TAK TAK antes de desplegar.** Las dos opciones
razonables:

1. Desplegar esta versión en su propia rama (`mejoras-mensajeria-taktak`) y
   apuntar Render ahí. `main` se queda como está.
2. Traer esta versión a `main` a propósito, asumiendo que sustituye a la otra.

Si eliges la 2, dímelo y lo preparo con cuidado para no perder la app que ya
está en `main`.

## Cómo desbloquear el despliegue

### Opción A: dar permiso de escritura a la App (lo más limpio)

En GitHub: `Settings` → `Applications` → la App instalada → `Configure` →
`Repository permissions` → `Contents` → **Read and write**. Luego avísame y
subo la rama.

### Opción B: un token con permiso

Crea un token clásico con permiso `repo` en
`https://github.com/settings/tokens` y pásamelo. Con eso subo la rama y te dejo
el enlace para desplegar. No lo pegues en un sitio público.

### Opción C: subirlo tú

El parche con los dos últimos commits está en `CAMBIOS-TAKTAK.patch`. Desde una
copia del repositorio:

```bash
git checkout -b mejoras-mensajeria-taktak
git am CAMBIOS-TAKTAK.patch
git push origin mejoras-mensajeria-taktak
```

## El enlace https://taktakmessenger.github.io/ no es la app funcional

Ese enlace está vivo, pero sirve **la versión de `main`**, y es una **maqueta
visual**: un único archivo HTML de ~106 KB, sin ninguna etiqueta `<script>` y sin
una sola llamada a una API o a Firebase. Se ve la interfaz (feed, perfiles,
monedas), pero **no hay backend detrás**: no se puede crear una cuenta de verdad,
ni subir un vídeo, ni enviar un regalo, ni retirar TTC. Es una demostración del
aspecto, no la app.

Dos consecuencias prácticas:

1. **GitHub Pages no puede ejecutar esta versión.** Pages solo sirve archivos
   estáticos: no hay Node, ni Mongo, ni Socket.IO. La app real (auth, feed,
   wallet, regalos, llamadas) necesita un proceso en marcha, así que necesita
   Render o un servidor equivalente. Subir esta versión a Pages no la haría
   funcionar; solo cambiaría una maqueta por otra.
2. **El enlace que se ve bonito y el que funciona son cosas distintas.** Si
   alguien prueba `taktakmessenger.github.io` esperando registrarse, no podrá. No
   es un fallo del código: es que ese sitio nunca tuvo servidor.

Para abrir TAK TAK de verdad hace falta desplegar el backend, que es lo que hace
`render.yaml`. Ese paso está bloqueado por el permiso de escritura de GitHub
(ver arriba).

## Despliegue en Render, paso a paso

1. Entra en `https://dashboard.render.com` y pulsa `New` → `Blueprint`.
2. Conecta `taktakmessenger/taktakmessenger.github.io` y elige la rama donde
   esté esta versión.
3. Render lee `render.yaml` y crea los dos servicios: `taktak` (web) y
   `taktak-keepalive` (worker).
4. Rellena las variables que están marcadas `sync: false`, que no van en el
   repositorio:
   - `MONGODB_URI`: cadena de MongoDB Atlas. **Tiene que incluir
     `?replicaSet=...`**, porque la app usa transacciones y sin replica set
     fallan los regalos y las compras.
   - Las de pago (`STRIPE_*`, `PAYPAL_*`) solo si vas a cobrar ya.
5. `JWT_SECRET` lo genera Render solo. No lo cambies después: cerraría la sesión
   a todo el mundo.
6. Espera el primer build. El frontend se compila dentro de la imagen, así que
   tarda unos minutos y no hay que hacer nada antes.

## Qué probar cuando esté arriba

En el enlace `https://<tu-servicio>.onrender.com`:

1. Que carga la portada.
2. Que puedes registrarte con correo y entras al feed.
3. Que `/health` responde `{"status":"OK","service":"TAK TAK API"}`.
4. Que un vídeo que no existe da 404 y no la página.

## Limitaciones del plan gratuito, para que no te sorprendan

- **750 horas al mes por espacio de trabajo.** Por eso hay un solo servicio web
  y no dos: dos encendidos 24/7 son 1440 horas y Render suspendería ambos hacia
  el día 15. Con uno solo hay margen para el mes entero.
- El servicio se sigue durmiendo si el keep-alive falla. El worker lo cubre,
  pero si el worker se cae, la app se duerme.
- Sin puertos UDP, así que el SFU de mediasoup queda apagado y las llamadas
  usan modo malla.
- La imagen no lleva ffmpeg, así que la transcodificación a HLS va apagada.
- **Los archivos subidos se pierden en cada despliegue**: el disco gratuito de
  Render es efímero. Para conservar vídeos hay que montar un disco persistente
  (de pago) o usar almacenamiento externo tipo S3.

## Antes de abrirlo al público

- Poner un proveedor de SMS real para verificar teléfonos: hoy el código se
  registra en el log.
- Poner el correo saliente real, para la recuperación de contraseña.
- Revisar el límite de subida de vídeo y el almacenamiento, que en el plan
  gratuito se agota rápido.
