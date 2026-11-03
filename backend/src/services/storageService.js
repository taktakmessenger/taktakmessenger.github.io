const fs = require('fs/promises');
const fsSync = require('fs');
const { pipeline } = require('stream/promises');
const path = require('path');
const env = require('../config/env');

// Almacenamiento de los ficheros subidos. Por defecto escribe en el disco local
// (desarrollo y tests), pero si hay un bucket S3 configurado —Cloudflare R2 en
// producción— los publica ahí.
//
// Hace falta porque el disco de un servicio de Render es efímero: se borra en
// cada despliegue y en cada reinicio del contenedor. Sin un bucket externo, un
// vídeo subido hoy desaparece mañana y su enlace queda roto.
//
// Todo es opt-in: sin las variables `R2_*`, cada función se comporta como si el
// almacenamiento externo no existiera y nada cambia respecto a antes.

// Tipos que el bucket debe devolver. Un objeto servido como
// `application/octet-stream` no lo reproduce el navegador ni en `<video>` ni en
// el reproductor de HLS, así que se fija al subir en vez de dejarlo adivinar.
const CONTENT_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.3gp': 'video/3gpp',
  '.avi': 'video/x-msvideo',
  '.ogv': 'video/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

let cachedClient = null;

function isConfigured() {
  const { endpoint, accessKeyId, secretAccessKey, bucket, publicBaseUrl } = env.r2;
  return Boolean(endpoint && accessKeyId && secretAccessKey && bucket && publicBaseUrl);
}

function contentTypeFor(key) {
  return CONTENT_TYPES[path.extname(key).toLowerCase()] || 'application/octet-stream';
}

// El cliente se crea solo cuando de verdad se va a usar: así el arranque en
// modo local no carga el SDK ni falla si falta el paquete.
function getClient() {
  if (cachedClient) return cachedClient;
  const { S3Client } = require('@aws-sdk/client-s3');
  cachedClient = new S3Client({
    // R2 no usa regiones reales y documenta `auto`; B2 exige la suya. El valor
    // sale de `R2_REGION`, con `auto` por defecto para no romper R2.
    region: env.r2.region,
    endpoint: env.r2.endpoint,
    // B2 sirve los objetos en `/bucket/clave`; sin esto, el SDK los pide en
    // `bucket.endpoint` y el proveedor responde 404.
    forcePathStyle: env.r2.forcePathStyle,
    credentials: {
      accessKeyId: env.r2.accessKeyId,
      secretAccessKey: env.r2.secretAccessKey,
    },
  });
  return cachedClient;
}

// URL pública de una clave del bucket. Sin barra doble aunque la base la lleve.
function publicUrl(key) {
  return `${env.r2.publicBaseUrl}/${String(key).replace(/^\/+/, '')}`;
}

async function putFile(localPath, key) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const body = await fs.readFile(localPath);
  await getClient().send(
    new PutObjectCommand({
      Bucket: env.r2.bucket,
      Key: key,
      Body: body,
      ContentType: contentTypeFor(key),
    })
  );
  return publicUrl(key);
}

// Sube un directorio entero conservando la estructura relativa. Lo usa la
// escalera HLS, que son un puñado de ficheros pequeños en subcarpetas.
async function putDirectory(localDir, keyPrefix) {
  const entries = await fs.readdir(localDir, { withFileTypes: true });
  const uploaded = [];

  for (const entry of entries) {
    const full = path.join(localDir, entry.name);
    const key = `${String(keyPrefix).replace(/\/+$/, '')}/${entry.name}`;
    if (entry.isDirectory()) {
      uploaded.push(...(await putDirectory(full, key)));
    } else {
      await putFile(full, key);
      uploaded.push(publicUrl(key));
    }
  }

  return uploaded;
}

// Descarga un objeto del bucket a un fichero temporal. Lo necesita el
// reproceso: el original vive en el bucket, no en el disco del contenedor, y
// ffmpeg necesita un fichero real que leer.
async function getFileToTemp(key, destPath) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const res = await getClient().send(
    new GetObjectCommand({ Bucket: env.r2.bucket, Key: key })
  );
  // El cuerpo llega como stream en Node: hay que volcarlo a disco, no
  // escribirlo directo. Con `fs.writeFile` se guardaría "[object Object]".
  await pipeline(res.Body, fsSync.createWriteStream(destPath));
  return destPath;
}

// Devuelve el objeto como stream, sin tocar disco. Se usa para servir una
// descarga a través de nuestra propia API: así el navegador la pide al mismo
// origen y no depende de que el bucket mande cabeceras CORS.
async function getObjectStream(key) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  return getClient().send(new GetObjectCommand({ Bucket: env.r2.bucket, Key: key }));
}

// Borra todo lo que cuelga de un prefijo. Se usa al eliminar un vídeo, para no
// dejar la escalera HLS huérfana ocupando cuota del bucket.
async function deletePrefix(keyPrefix) {
  const { ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
  const prefix = `${String(keyPrefix).replace(/\/+$/, '')}/`;
  const client = getClient();

  let token;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: env.r2.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    const keys = (listed.Contents || []).map((o) => ({ Key: o.Key }));
    if (keys.length) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: env.r2.bucket,
          Delete: { Objects: keys, Quiet: true },
        })
      );
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
}

module.exports = {
  isConfigured,
  contentTypeFor,
  publicUrl,
  putFile,
  putDirectory,
  getFileToTemp,
  getObjectStream,
  deletePrefix,
};
