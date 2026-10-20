const express = require('express');
const Gift = require('../models/Gift');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

// Public catalogue. Prices come from the database, never from the client, so a
// sender cannot choose what a gift costs.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const gifts = await Gift.find({ isActive: true }).sort({ sortOrder: 1, coinCost: 1 });
    res.json({ gifts });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const gift = await Gift.findById(req.params.id);
    if (!gift || !gift.isActive) throw new HttpError(404, 'Regalo no encontrado');
    res.json({ gift });
  })
);

module.exports = router;
