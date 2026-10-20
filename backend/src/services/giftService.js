const Gift = require('../models/Gift');

// Default catalogue. Prices are server-side on purpose: `walletService` reads
// the cost from here, so a client can never send a 5000-coin gift for 1 coin.
const DEFAULT_GIFTS = [
  { name: 'Rosa', coinCost: 1, iconUrl: '/gifts/rosa.svg', category: 'popular', sortOrder: 1 },
  { name: 'Corazón', coinCost: 5, iconUrl: '/gifts/corazon.svg', category: 'popular', sortOrder: 2 },
  { name: 'Aplauso', coinCost: 10, iconUrl: '/gifts/aplauso.svg', category: 'popular', sortOrder: 3 },
  { name: 'Helado', coinCost: 25, iconUrl: '/gifts/helado.svg', category: 'intermediate', sortOrder: 4 },
  { name: 'Cohete', coinCost: 100, iconUrl: '/gifts/cohete.svg', category: 'intermediate', sortOrder: 5 },
  { name: 'León', coinCost: 500, iconUrl: '/gifts/leon.svg', category: 'premium', sortOrder: 6 },
  { name: 'Corona', coinCost: 1000, iconUrl: '/gifts/corona.svg', category: 'premium', sortOrder: 7 },
  {
    name: 'Galaxia',
    coinCost: 5000,
    iconUrl: '/gifts/galaxia.svg',
    category: 'legendary',
    isFullScreen: true,
    sortOrder: 8,
  },
];

/**
 * Insert any missing gifts. `upsert` on the unique `name` keeps this safe to
 * run on every boot and never overwrites a price an operator changed.
 */
async function seedGifts() {
  const ops = DEFAULT_GIFTS.map((gift) => ({
    updateOne: {
      filter: { name: gift.name },
      update: { $setOnInsert: gift },
      upsert: true,
    },
  }));

  const result = await Gift.bulkWrite(ops, { ordered: false });
  return result.upsertedCount || 0;
}

module.exports = { seedGifts, DEFAULT_GIFTS };
