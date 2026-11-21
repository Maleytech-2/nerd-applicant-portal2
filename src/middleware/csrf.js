const crypto = require("crypto");
const { AppError } = require("./errorHandler");

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const supplied = req.get("X-CSRF-Token") || req.body?.csrfToken;
  if (!supplied || supplied !== req.session.csrfToken) {
    return next(new AppError("Invalid or missing CSRF token.", 403, "CSRF_INVALID"));
  }
  next();
}

module.exports = { csrfProtection };
