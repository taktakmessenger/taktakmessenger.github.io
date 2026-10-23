// Reinicio de datos: deja la plataforma como recién instalada.
//
// Borra todo lo generado por usuarios (cuentas, vídeos, mensajes, saldos...) y
// conserva los catálogos que no son datos de usuario (regalos, sonidos, fuentes
// de noticias). Al final crea la cuenta de administrador.
//
// Es destructivo e irreversible. Antes de ejecutarlo, haz copia:
//   scripts/backup-db.sh
//
// Uso:
//   node scripts/reset-data.js
//   ADMIN_PASSWORD=... node scripts/reset-data.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');

// mongoose vive en backend/node_modules, no en la raíz: se resuelve desde ahí
// para que el script funcione igual invocado desde cualquier directorio.
const mongoose = require(path.join(BACKEND, 'node_modules', 'mongoose'));

// Colecciones de datos de usuario. Se vacían por completo.
const USER_DATA = [
  'users',
  'videos',
  'transactions',
  'comments',
  'conversations',
  'messages',
  'notifications',
  'pushsubscriptions',
  'squads',
  'verifications',
  'watchevents',
];

// Catálogos que sobreviven al reinicio: no son datos de usuario.
const CATALOGUES = ['gifts', 'sounds', 'newssources'];

const ADMIN = {
  username: process.env.ADMIN_USERNAME || 'eliecerdepablos',
  email: process.env.ADMIN_EMAIL || 'eliecerdepablos@gmail.com',
  phone: process.env.ADMIN_PHONE || '+584146487704',
  password: process.env.ADMIN_PASSWORD || 'TakTak-Admin-2026',
};

function loadEnv() {
  // El backend lee su propio .env; aquí solo se necesita la cadena de Mongo.
  const envPath = path.join(BACKEND, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}

async function main() {
  loadEnv();
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/taktak';
  const User = require(path.join(BACKEND, 'src', 'models', 'User'));

  await mongoose.connect(uri);
  console.log(`Conectado a ${uri.replace(/\/\/.*@/, '//***@')}\n`);

  for (const name of USER_DATA) {
    const { deletedCount } = await mongoose.connection.collection(name).deleteMany({});
    console.log(`  ${name.padEnd(20)} ${String(deletedCount).padStart(5)} borrados`);
  }

  console.log('');
  for (const name of CATALOGUES) {
    const kept = await mongoose.connection.collection(name).countDocuments();
    console.log(`  ${name.padEnd(20)} ${String(kept).padStart(5)} conservados (catálogo)`);
  }

  const admin = await User.create({
    username: ADMIN.username,
    email: ADMIN.email,
    phone: ADMIN.phone,
    password: ADMIN.password,
    role: 'admin',
    emailVerified: true,
    phoneVerified: true,
    profile: { displayName: ADMIN.username },
    wallet: { ttcC: 0, ttcR: 0 },
  });

  console.log(`\nCuenta admin creada: ${admin.email} (${admin.username}) tel ${admin.phone}`);

  // Los ficheros subidos ya no los referencia ningún vídeo, así que se van con
  // ellos: dejar 43 MB de originales y renditions huérfanos solo ocupa disco.
  const uploads = process.env.UPLOADS_DIR || path.join(BACKEND, 'uploads');
  if (fs.existsSync(uploads)) {
    let removed = 0;
    for (const entry of fs.readdirSync(uploads)) {
      fs.rmSync(path.join(uploads, entry), { recursive: true, force: true });
      removed += 1;
    }
    console.log(`Ficheros subidos borrados: ${removed}`);
  }

  await mongoose.disconnect();
  console.log('\nListo.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
