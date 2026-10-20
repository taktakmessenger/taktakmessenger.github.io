// Small helpers shared by the route modules.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    // Marks the error as deliberately raised with a message written for the
    // client. The error handler shows it verbatim even for a 5xx, so a
    // configuration problem ("Google is not configured") reaches the user as a
    // real explanation instead of a generic "something went wrong".
    this.expose = true;
  }
}

// Wraps an async handler so rejected promises reach the error middleware
// instead of hanging the request.
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, asyncHandler };
