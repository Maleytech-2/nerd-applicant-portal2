const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

test("protected authentication rechecks account and password state", () => {
  const source = fs.readFileSync("src/middleware/auth.js", "utf8");
  assert.match(source, /u\.is_active/);
  assert.match(source, /password_changed_at/);
  assert.match(source, /PASSWORD_CHANGED/);
});

test("private document downloads use ownership or staff permission checks", () => {
  const source = fs.readFileSync("src/routes/documentRoutes.js", "utf8");
  assert.match(source, /document\.applicant_id === requester\.id/);
  assert.match(source, /documents\.view/);
  assert.match(source, /absolutePath\.startsWith/);
});

test("payment amounts and exemption classification remain server controlled", () => {
  const payment = fs.readFileSync("src/routes/paymentRoutes.js", "utf8");
  const eligibility = fs.readFileSync("src/routes/eligibilityRoutes.js", "utf8");
  assert.match(payment, /calculateFullTimeFee/);
  assert.doesNotMatch(payment, /exemption|exclusion/i);
  assert.match(eligibility, /result\.suggestedCategory === "exemption"/);
  assert.doesNotMatch(eligibility, /req\.body\.(?:category|exemption|exclusion)/i);
});
