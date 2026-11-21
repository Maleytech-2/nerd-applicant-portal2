const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

test("audit and settings routes are administrator-only and sensitive values are redacted", () => {
  const source = fs.readFileSync("src/routes/systemRoutes.js", "utf8");
  assert.match(source, /requireRole\("administrator"\)/);
  assert.match(source, /is_sensitive/);
  assert.match(source, /\[Protected\]/);
  assert.match(source, /writeAuditLog/);
});

test("payment notification address is validated, normalized, and admin-editable", () => {
  const routes = fs.readFileSync("src/routes/systemRoutes.js", "utf8");
  const dashboard = fs.readFileSync("public/admin/system.html", "utf8");
  const payments = fs.readFileSync("src/routes/paymentRoutes.js", "utf8");
  assert.match(routes, /"admin_notification_email"/);
  assert.match(routes, /value = value\.trim\(\)\.toLowerCase\(\)/);
  assert.match(routes, /INVALID_NOTIFICATION_EMAIL/);
  assert.match(dashboard, /Payment notification email/);
  assert.match(dashboard, /type="email"/);
  assert.match(payments, /recipientEmail: notificationEmail/);
  assert.doesNotMatch(payments, /campuscoretv@gmail\.com/);
});

test("admin sender changes verify SMTP credentials and persist encrypted secrets", () => {
  const routes = fs.readFileSync("src/routes/systemRoutes.js", "utf8");
  const service = fs.readFileSync("src/services/emailService.js", "utf8");
  const dashboard = fs.readFileSync("public/admin/system.html", "utf8");
  assert.match(routes, /\/admin\/settings\/smtp-sender/);
  assert.match(routes, /verifySmtpConfiguration\(configuration\)/);
  assert.match(routes, /encryptSmtpCredentials\(configuration\)/);
  assert.match(routes, /is_sensitive/);
  assert.match(service, /decryptSmtpCredentials/);
  assert.match(service, /from: configuration\.from/);
  assert.match(dashboard, /Outgoing email sender/);
  assert.match(dashboard, /SMTP password or App Password/);
  assert.match(dashboard, /smtp-sender/);
});
