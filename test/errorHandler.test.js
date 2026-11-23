const test = require("node:test");
const assert = require("node:assert/strict");
const { AppError, errorHandler } = require("../src/middleware/errorHandler");

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("server errors include a support reference matching the server log", () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);

  try {
    const response = createResponse();
    errorHandler(new Error("Database operation failed"), {
      method: "POST",
      path: "/api/auth/register",
    }, response, () => {});

    const requestId = response.body.error.requestId;
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.error.message, "An unexpected error occurred.");
    assert.match(requestId, /^[0-9a-f-]{36}$/i);
    assert.equal(logged[0][1].requestId, requestId);
    assert.equal(logged[0][1].path, "/api/auth/register");
  } finally {
    console.error = originalConsoleError;
  }
});

test("client errors keep their specific message and do not receive a support reference", () => {
  const response = createResponse();
  errorHandler(new AppError("Email or password is incorrect.", 401, "INVALID_CREDENTIALS"), {
    method: "POST",
    path: "/api/auth/login",
  }, response, () => {});

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error.message, "Email or password is incorrect.");
  assert.equal(response.body.error.requestId, undefined);
});

test("missing and outdated database schema errors have actionable safe messages", () => {
  const missingTableResponse = createResponse();
  errorHandler(Object.assign(new Error("Table does not exist"), { code: "ER_NO_SUCH_TABLE" }), {
    method: "POST",
    path: "/api/auth/register",
  }, missingTableResponse, () => {});

  assert.equal(missingTableResponse.statusCode, 503);
  assert.equal(missingTableResponse.body.error.code, "DATABASE_NOT_INITIALIZED");
  assert.match(missingTableResponse.body.error.message, /database is not initialized/i);
  assert.ok(missingTableResponse.body.error.requestId);

  const outdatedSchemaResponse = createResponse();
  errorHandler(Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" }), {
    method: "POST",
    path: "/api/auth/login",
  }, outdatedSchemaResponse, () => {});

  assert.equal(outdatedSchemaResponse.statusCode, 503);
  assert.equal(outdatedSchemaResponse.body.error.code, "DATABASE_SCHEMA_OUTDATED");
  assert.match(outdatedSchemaResponse.body.error.message, /database needs an update/i);
});
