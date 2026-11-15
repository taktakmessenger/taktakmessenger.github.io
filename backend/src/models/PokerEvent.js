const mongoose = require('mongoose');

// Un torneo de POKERTAK programado por el administrador.
//
// A diferencia de la mesa normal (que cobra comisión por mano y devuelve las
// fichas al levantarse), un torneo es un evento con hora de comienzo, aforo y
// entrada fija. Lo recaudado se reparte entre los primeros puestos menos la
// tarifa de la casa. Por eso el evento guarda su propio reparto y no lo deduce
// de la mesa: es la promesa que se le hizo a quien pagó la entrada.
//
// El estado es explícito (`scheduled -> running -> finished`, o `cancelled`)
// porque el dinero cambia en cada transición: al inscribirse se cobra, al
// empezar se juega, al terminar se paga a los ganadores y al cancelar se
// devuelve todo. Guardarlo evita pagar dos veces por una carrera entre dos
// peticiones.
const pokerEventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 80 },
    // Quién lo organiza. Se guarda aunque lo cree el asistente: la auditoría
    // necesita saber a qué administrador pertenece el evento.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Sala (squad) donde se juega. Es la misma que usa la mesa de póker, para
    // reutilizar el acceso: quien puede entrar a la sala puede jugar el torneo.
    squad: { type: mongoose.Schema.Types.ObjectId, ref: 'Squad', required: true, index: true },
    scheduledAt: { type: Date, required: true, index: true },
    entryCost: { type: Number, required: true, min: 0 },
    maxPlayers: { type: Number, required: true, min: 2, max: 9 },
    // Tarifa de la casa y reparto por puestos, congelados al crear el evento. Si
    // mañana cambia el reparto por defecto, un torneo ya inscrito no se altera.
    rakeRate: { type: Number, default: 0.1, min: 0, max: 1 },
    split: { type: [Number], default: () => [0.4, 0.3, 0.2] },
    status: {
      type: String,
      enum: ['scheduled', 'running', 'finished', 'cancelled'],
      default: 'scheduled',
      index: true,
    },
    // Inscritos. Se guarda el asiento y lo que pagó cada uno para poder devolver
    // exactamente lo mismo si el torneo se cancela.
    players: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        username: String,
        seat: Number,
        paid: { type: Number, default: 0 },
        paidFromTtcC: { type: Number, default: 0 },
        paidFromBonus: { type: Number, default: 0 },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
    // Resultado final: los puestos premiados y lo que cobró la casa.
    results: [
      {
        place: Number,
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        username: String,
        amount: Number,
      },
    ],
    prizePool: { type: Number, default: 0 },
    houseCut: { type: Number, default: 0 },
    finishedAt: Date,
    cancelReason: String,
  },
  { timestamps: true }
);

pokerEventSchema.index({ status: 1, scheduledAt: 1 });

pokerEventSchema.methods.isPlayer = function isPlayer(userId) {
  return this.players.some((p) => String(p.user) === String(userId));
};

module.exports = mongoose.model('PokerEvent', pokerEventSchema);
