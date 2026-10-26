const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    // E.164 (+international format). Unique and sparse: accounts created before
    // phone sign-in existed have no phone, and many accounts share the absence
    // of one, so a plain unique index would reject all but the first.
    phone: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    // Null for accounts created through Google, which never set a password.
    // The `required` flag is on the login path instead of the schema: a
    // Google-only account is valid and must be able to exist.
    password: {
      type: String,
      minlength: 6,
      select: false,
    },
    // Google's stable subject id ("sub"), not the email: an email can be
    // changed or re-assigned, the subject cannot.
    googleId: { type: String, unique: true, sparse: true },
    // Facebook's stable user id, con el mismo criterio que `googleId`: es el
    // identificador que no cambia aunque la persona cambie de correo.
    facebookId: { type: String, unique: true, sparse: true },
    profile: {
      displayName: String,
      bio: { type: String, maxlength: 300 },
      avatar: String,
      followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      isVerified: { type: Boolean, default: false },
      isCreator: { type: Boolean, default: false },
    },
    // Kept at the top level rather than under `profile` because they are
    // security state, not presentation: the sign-in flows query on them.
    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },

    // Última vez que se vio conectado. Se guarda para poder mostrar "última vez
    // a las 18:40" cuando el otro no está en línea, igual que hace WhatsApp. La
    // presencia en vivo no se guarda aquí: se deduce de los sockets conectados.
    lastSeenAt: { type: Date, default: Date.now },

    // Date of birth. `select: false` so it never rides along in an ordinary
    // query: `GET /api/users/me` and every populate would otherwise leak it,
    // and a birth date is the raw material of identity theft. Code that truly
    // needs it must ask with `.select('+dateOfBirth')`.
    dateOfBirth: { type: Date, select: false },

    // Outcome of the age check. Deliberately separate from `dateOfBirth`:
    // a self-declared date proves nothing, and gating adult content on it
    // would be security theatre. Only `verified` unlocks NSFW.
    ageVerification: {
      status: {
        type: String,
        enum: ['unverified', 'pending', 'verified', 'rejected'],
        default: 'unverified',
      },
      // How it was proven: 'document' (ID + selfie), 'self_declared' (dev only,
      // never trusted in production) or 'admin' (manual override).
      method: { type: String, enum: ['document', 'self_declared', 'admin', null], default: null },
      verifiedAt: { type: Date, default: null },
      // Reference at the provider. No document image is ever stored here: the
      // provider holds the sensitive material, we hold only the verdict.
      providerRef: { type: String, default: null, select: false },
    },

    // Coin and Diamond buckets. `ttcC` and `bonusC` are both spendable on
    // gifts; only `ttcC` (paid) produces withdrawable `ttcR` Diamonds.
    wallet: {
      // Paid coins: bought with real money. Gifted, they pay the creator
      // withdrawable Diamonds.
      ttcC: { type: Number, default: 0, min: 0 },
      // Promotional coins (welcome bonus, support credits). Spendable on gifts
      // but never redeemable for cash: a gift paid with them credits the creator
      // in this same bucket, so free coins can only ever recirculate as free
      // coins. Without this split, N free accounts could gift to one account and
      // withdraw real money the platform never received.
      bonusC: { type: Number, default: 0, min: 0 },
      ttcR: { type: Number, default: 0, min: 0 },
    },
    stats: {
      totalLikes: { type: Number, default: 0 },
      totalViews: { type: Number, default: 0 },
      totalGifts: { type: Number, default: 0 },
      totalGiftsReceived: { type: Number, default: 0 },
    },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },

    // Referencias de cobro en cada pasarela. Son secretos operativos: con el
    // `stripeCustomerId` y una tarjeta guardada se puede cobrar sin que el
    // usuario esté delante, así que nunca salen en una respuesta pública.
    paymentRefs: {
      stripeCustomerId: { type: String, default: null, select: false },
    },

    // Explicit negative signals for the recommender. A ranking model needs a
    // way to be told "not this", otherwise a viewer's only escape from a topic
    // is to stop opening the app.
    feedPreferences: {
      hiddenCreators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      hiddenTags: [{ type: String, trim: true, maxlength: 30 }],
    },

    // Cuentas bloqueadas por este usuario. Es distinto de `hiddenCreators`: una
    // cosa es "no quiero ver sus vídeos en el feed" (una preferencia de
    // recomendación) y otra "no quiero volver a saber de esta persona" (una
    // decisión de seguridad). El bloqueo corta además el chat y las llamadas,
    // por eso vive en su propio campo y no se mezcla con el feed.
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Idioma en el que esta persona quiere leer y oír a los demás. Es lo que
    // hace que la traducción de WhaTaka sirva para algo: quien llama o escribe
    // no elige el idioma del otro, lo lee el destinatario de aquí.
    //
    // Se guarda como código canónico de `lib/language` ('es', 'en', 'zh-Hans').
    // Vacío significa "no lo he elegido": en ese caso el cliente propone el
    // idioma del navegador y la traducción usa ese como destino, en lugar de
    // forzar un idioma que quizá no habla.
    preferredLanguage: { type: String, default: null, trim: true },
    // Si quiere que WhaTaka traduzca sola los mensajes y las llamadas que no
    // estén en su idioma, sin tener que pulsar el botón cada vez. Apagado por
    // defecto: traducir cuesta dinero y no se activa a espaldas de nadie.
    autoTranslate: { type: Boolean, default: false },
    // Si quiere subtítulos en las llamadas traducidas. Se puede querer oír la
    // voz original con subtítulos, o solo la traducida.
    callCaptions: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Hash on every save where the password actually changed, so no code path can
// accidentally persist a plaintext password. Google-only accounts have no
// password, so the guard also covers `undefined`.
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password') || !this.password) return next();

  // Phone sign-up hashes the password when the code is requested, so the
  // pending record never holds plaintext, and assigns that digest at
  // verification time. Hashing it again would store a hash *of a hash* and the
  // user's real password would stop working.
  //
  // The skip is an explicit flag rather than a "looks like a bcrypt digest"
  // check: a user is free to choose a password that *starts* like a digest, and
  // a pattern test would silently store theirs in the clear.
  if (this.$locals?.passwordAlreadyHashed) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Returns false rather than throwing when the account has no password, so a
// Google account cannot be logged into with an empty password.
userSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

// Busca una cuenta por su @usuario sin distinguir mayúsculas. `username` es
// único con índice sensible a mayúsculas, así que `@Elmalayaso` y
// `@elmalayaso` eran dos cadenas distintas: escribir el nombre con otra caja
// respondía "usuario no encontrado" aunque la cuenta existiera, y desde el
// marcador eso dejaba la llamada inalcanzable. El patrón se escapa para que un
// nombre no pueda inyectar expresiones regulares.
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `slice(0, 30)` va con el `maxlength` del esquema: un nombre más largo no
// puede existir, así que recortar no cambia el resultado y evita construir
// patrones enormes. Devuelve `null` para un nombre vacío, que nunca casa.
function usernameFilter(username) {
  const name = String(username || '').trim().replace(/^@/, '').slice(0, 30);
  if (!name) return null;
  return { username: new RegExp(`^${escapeRegex(name)}$`, 'i') };
}

// Siempre devuelve una consulta, aunque el nombre venga vacío: quien llama
// encadena `.select()` y no debe tener que comprobar el nulo antes.
userSchema.statics.findByUsername = function findByUsername(username) {
  return this.findOne(usernameFilter(username) || { username: null });
};

// La misma regla para el alta: sin esto se podía crear `elmalayaso` con
// `Elmalayaso` ya registrado, y las dos cuentas casaban con la misma búsqueda.
userSchema.statics.existsByUsername = function existsByUsername(username) {
  const filter = usernameFilter(username);
  if (!filter) return Promise.resolve(false);
  return this.exists(filter);
};

// Whether this account may see adult content. This is the single question the
// feed and the upload gate ask, so the definition of "adult" lives in one
// place. A self-declared date of birth is intentionally *not* enough: it is
// unverifiable and would make the gate trivial to bypass.
userSchema.methods.isAdult = function isAdult() {
  return this.ageVerification?.status === 'verified';
};

userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.password;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
