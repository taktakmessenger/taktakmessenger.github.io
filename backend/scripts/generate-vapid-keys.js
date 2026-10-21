#!/usr/bin/env node
/**
 * Genera el par de claves VAPID que firma las notificaciones push.
 *
 * Se ejecuta una sola vez por despliegue y las claves se pegan en el entorno.
 * No hace falta cuenta de nadie: las claves se generan aquí mismo.
 *
 *   npm run push:keys
 *
 * Aviso: la privada identifica al servidor. Si se cambia, todas las
 * suscripciones existentes dejan de ser válidas y los usuarios tienen que
 * volver a activar las notificaciones. Por eso se genera una vez y se guarda.
 */
const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();

console.log('\nClaves VAPID generadas. Añádelas al entorno:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('\nLa pública puede ir en `.env`; la privada, en el gestor de secretos,');
console.log('nunca en el repositorio.\n');
