const crypto = require("crypto");

class AppError extends Error {
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR", details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function notFound(req, res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404, "NOT_FOUND"));
}

function errorHandler(error, req, res, _next) {
  const databaseIssue = {
    ER_NO_SUCH_TABLE: {
      code: "DATABASE_NOT_INITIALIZED",
      message: "The application database is not initialized. Contact support.",
    },
    ER_BAD_FIELD_ERROR: {
      code: "DATABASE_SCHEMA_OUTDATED",
      message: "The application database needs an update. Contact support.",
    },
  }[error.code];
  const statusCode = databaseIssue ? 503 : error.statusCode || 500;
  const requestId = statusCode >= 500 ? crypto.randomUUID() : null;
  if (statusCode >= 500) {
    console.error("Request failed", {
      requestId,
      method: req.method,
      path: req.path,
      error,
    });
  }

  const code = databaseIssue ? databaseIssue.code : error.code || "INTERNAL_ERROR";
  const message = databaseIssue
    ? databaseIssue.message
    : statusCode >= 500
      ? "An unexpected error occurred."
      : error.message;

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(requestId ? { requestId } : {}),
      ...(error.details ? { details: error.details } : {}),
    },
  });
}

module.exports = { AppError, notFound, errorHandler };
