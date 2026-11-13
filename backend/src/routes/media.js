const express = require('express');
const path = require('path');
const { Readable } = require('stream');
const storageService = require('../services/storageService');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

// Extensiones que se pueden pedir por esta ruta. Es una allowlist a propósito:
// la ruta reenvía al bucket la clave que recibe, y sin lista cualquier objeto
// del bucket —o una clave con `..`— quedaría accesible.
const ALLOWED = new Set([
  '.m3u8',
  '.ts',
  '.m4s',
  '.mp4',
  '.m4v',
  '.mov',
  '.webm',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
]);

// Sirve los medios del bucket (R2) desde el mismo dominio que la app.
//
// Hace falta porque el bucket no manda cabeceras CORS: hls.js carga la lista
// HLS y sus segmentos por XHR, y el navegador los bloquea con "Failed to
// fetch", dejando el vídeo en negro. El `<video>` que reproduce un fichero
// suelto no usa XHR, y por eso el original sí se ve y la escalera no. Pasando
// por aquí, el reproductor pide todo a `taktak.vip` y el CORS deja de importar.
router.get(
  '/*',
  asyncHandler(async (req, res) => {
    if (!storageService.isConfigured()) {
      throw new HttpError(404, 'Recurso no encontrado');
    }

    const key = req.params[0];
    if (!key || key.includes('..')) {
      throw new HttpError(400, 'Ruta inválida');
    }
    if (!ALLOWED.has(path.extname(key).toLowerCase())) {
      throw new HttpError(400, 'Tipo de archivo no permitido');
    }

    let object;
    try {
      object = await storageService.getObjectStream(key);
    } catch (err) {
      // Un objeto ausente no es un fallo del servidor: se traduce a 404 para que
      // el reproductor no lo lea como una caída.
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') {
        throw new HttpError(404, 'Recurso no encontrado');
      }
      throw new HttpError(502, 'No se pudo leer el almacenamiento de medios');
    }

    if (object.ContentLength) {
      res.setHeader('Content-Length', String(object.ContentLength));
    }
    // `Accept-Ranges` habilita el salto dentro del vídeo; sin él algunos
    // navegadores no reproducen en streaming.
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', storageService.contentTypeFor(key));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (object.CacheControl) {
      res.setHeader('Cache-Control', object.CacheControl);
    }

    if (!object.Body) {
      res.status(204).end();
      return;
    }

    // El SDK devuelve un stream de Node; en runtimes nuevos puede llegar un
    // ReadableStream web, que hay que convertir antes de la tubería.
    const body =
      typeof object.Body.pipe === 'function' ? object.Body : Readable.fromWeb(object.Body);
    body.on('error', () => res.destroy());
    body.pipe(res);
  })
);

module.exports = router;
