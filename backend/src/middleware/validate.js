const { validationResult } = require('express-validator');

// Collects express-validator errors into a single 400 response.
function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  return res.status(400).json({
    error: 'Datos inválidos',
    details: result.array().map(({ path, msg }) => ({ field: path, message: msg })),
  });
}

module.exports = validate;
