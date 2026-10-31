# Tak Tak landing page

Esta carpeta contiene la landing page estática de Tak Tak para publicar sin afectar la app principal del repositorio.

## Archivos
- `index.html`: portada principal
- `404.html`: página de error

## Publicación recomendada

### Opción 1: Netlify (recomendada)
1. Entra en https://app.netlify.com/drop
2. Arrastra esta carpeta `landing/`
3. Netlify te dará una URL pública
4. En Unstoppable Domains configura el DNS para apuntar a Netlify
5. Si quieres, puedes añadir el dominio `taktak.brave`

### Opción 2: GitHub Pages (si prefieres usar GitHub)
1. Crea un repo nuevo o usa uno existente
2. Sube esta carpeta como sitio estático
3. Configura la rama y la carpeta correspondiente en Pages
4. En Unstoppable Domains añade el dominio o configura DNS

### Opción 3: Carga directa en Unstoppable Domains
1. Entra a `https://unstoppabledomains.com/manage?page=website&domain=taktak.brave`
2. Busca la opción “Website”
3. Sube `index.html` y `404.html`
4. Verifica que el sitio se vea bien

## Nota útil
El formulario de anuncios está configurado para abrir el cliente de email del usuario y preparar el mensaje para `eliecerdepablos@gmail.com`, para que funcione sin depender de un backend externo.

Si deseas conectar un servicio real como Formspree, Google Forms o un webhook, te dejo ese ajuste listo en el HTML.
