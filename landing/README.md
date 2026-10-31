# Tak Tak — landing final para Netlify

Esta carpeta está lista para desplegar en Netlify sin tocar la app principal del repositorio.

## Archivos incluidos
- `index.html`: landing final de Tak Tak
- `404.html`: página de error
- `netlify.toml`: configuración adicional de Netlify
- `_redirects`: redirecciones útiles

## Cómo desplegar en Netlify
1. Ve a https://app.netlify.com/drop
2. Arrastra esta carpeta `landing/`
3. Netlify te generará una URL pública
4. En `Site settings` > `Domain management` añade `taktak.brave`
5. En Unstoppable Domains configura DNS para que apunte al dominio generado por Netlify

## DNS recomendado para `.brave`
- Usa la opción de DNS de Unstoppable Domains
- Apunta el dominio a la URL de Netlify
- Espera la propagación (puede tardar unos minutos u horas)

## Pago y formulario
- PayPal: https://paypal.me/eliecerdepablos/1
- Zinli: https://recargas.zinli.com/mbbrqGmkwnhJk3C2LHDhkt
- El formulario de anuncio prepara un mensaje para `eliecerdepablos@gmail.com` usando el cliente de correo del usuario

## Si quieres conectar Formspree o Google Forms
- Puedes cambiar el bloque del formulario y el script en `index.html`
- Si me pasas el endpoint exacto, lo dejo completamente conectado
