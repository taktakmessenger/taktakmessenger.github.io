const fs = require('fs');
const path = require('path');

// Sirve el frontend ya construido desde el mismo proceso que la API.
//
// Con esto el despliegue es un único servicio, y eso resuelve dos cosas:
//
//  - El frontend llama a `/api` y a Socket.IO con rutas relativas, así que
//    tiene que salir todo del mismo origen. Con dos servicios habría que
//    proxear y el keep-alive tendría que despertar los dos.
//  - El plan gratuito da 750 horas de instancia al mes por espacio de trabajo.
//    Con dos servicios encendidos las 24 horas se consumen en unos 15 días y
//    Render suspende ambos hasta el mes siguiente. Con uno solo hay margen.
//
// Si `publicDir` está vacío (desarrollo y pruebas) no monta nada y la API se
// comporta como antes.
function serveFrontend(app) {
  const dir = process.env.PUBLIC_DIR;
  if (!dir) return false;

  const indexFile = path.join(dir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    // Un aviso en vez de un error: la API puede arrancar sin el build del
    // frontend, y así el fallo se lee en el log en lugar de tumbar el servicio.
    console.warn(`[frontend] PUBLIC_DIR=${dir} no contiene index.html; se sirve solo la API`);
    return false;
  }

  const assetsDir = path.join(dir, 'assets');
  const hasAssets = fs.existsSync(assetsDir);

  if (hasAssets) {
    // Los nombres de los assets llevan hash, así que su contenido no cambia
    // nunca: se pueden cachear para siempre.
    app.use(
      '/assets',
      require('express').static(assetsDir, {
        immutable: true,
        maxAge: '1y',
        index: false,
        dotfiles: 'deny',
      })
    );
  }

  app.use(
    require('express').static(dir, {
      index: false,
      dotfiles: 'deny',
    })
  );

  // Comodín para las rutas del SPA (React Router, enlaces profundos). Va al
  // final y solo para GET: si un POST o un DELETE llegasen aquí es que la ruta
  // no existe, y devolver el HTML de la app con un 200 lo escondería.
  app.get('*', (req, res, next) => {
    // Rutas que no son de la aplicación. Si no las ha resuelto su propio
    // manejador es que no existen: devolver la página convertiría un 404 en un
    // 200. En `/uploads` el reproductor intentaba leer HTML como vídeo.
    if (
      req.path.startsWith('/api/') ||
      req.path.startsWith('/socket.io/') ||
      req.path.startsWith('/uploads/') ||
      req.path.startsWith('/assets/')
    ) {
      return next();
    }
    // Un archivo pedido por su nombre no es una ruta del router. Sin esto, un
    // asset que falta se servía como la página con un 200 y el navegador
    // intentaba ejecutar el HTML como JavaScript.
    if (path.extname(req.path)) {
      return next();
    }
    res.sendFile(indexFile);
  });

  return true;
}

module.exports = serveFrontend;
