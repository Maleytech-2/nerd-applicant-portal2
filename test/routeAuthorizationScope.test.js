const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

test("API router authorization is scoped to its own route prefixes", () => {
  const expectedScopes = {
    "eligibilityRoutes.js": /router\.use\("\/eligibility", requireAuth, requireRole\("applicant"\)\)/,
    "paymentRoutes.js": /router\.use\("\/payment", requireAuth, requireRole\("applicant"\)\)/,
    "applicationRoutes.js": /router\.use\("\/application", requireAuth, requireRole\("applicant"\)\)/,
    "adminRoutes.js": /router\.use\(\s*\["\/admin\/stats", "\/admin\/applicants", "\/admin\/payments", "\/admin\/restricted-cases"\]/,
    "staffRoutes.js": /router\.use\("\/admin\/staff", requireAuth, requireRole\("administrator"\)\)/,
    "systemRoutes.js": /router\.use\(\["\/admin\/audit-logs", "\/admin\/settings"\]/,
    "reportRoutes.js": /router\.use\("\/reports", requireAuth, requireRole\("administrator", "staff"\), requirePermission\("reports\.view"\)\)/,
  };

  for (const [file, scopePattern] of Object.entries(expectedScopes)) {
    const source = fs.readFileSync(`src/routes/${file}`, "utf8");
    assert.match(source, scopePattern, `${file} must scope its router middleware`);
  }
});

test("admin application review page requires an authorized staff or administrator session", () => {
  const app = fs.readFileSync("src/app.js", "utf8");
  const review = fs.readFileSync("src/routes/applicationReviewRoutes.js", "utf8");
  assert.match(app, /app\.get\("\/admin\/applications", requireAuth, requireRole\("administrator", "staff"\)/);
  assert.match(review, /router\.get\("\/admin\/applications\/:applicationId", \.\.\.reviewAccess/);
});

test("admin Applicants and Payments navigation links target dashboard sections", () => {
  const dashboard = fs.readFileSync("public/admin/dashboard.html", "utf8");
  assert.match(dashboard, /<a href="#applicants">[\s\S]*?Applicants<\/a>/);
  assert.match(dashboard, /<section class="panel mb-4" id="applicants">/);
  assert.match(dashboard, /<a href="#payments">[\s\S]*?Payments<\/a>/);
  assert.match(dashboard, /<section class="panel" id="payments">/);
  assert.match(dashboard, /fetch\(`\/api\/admin\/applicants\?\$\{query\}`/);
});

test("legacy applicant registration URL serves the registration page", () => {
  const app = fs.readFileSync("src/app.js", "utf8");
  assert.match(app, /app\.get\("\/applicant\/register\.html", \(_req, res\) => \{\s*res\.sendFile\(path\.join\(__dirname, "\.\.", "public", "auth", "register\.html"\)\);/);
});

test("restricted-category requests are only exposed through administrator routes", () => {
  const admin = fs.readFileSync("src/routes/adminRoutes.js", "utf8");
  const eligibility = fs.readFileSync("src/routes/eligibilityRoutes.js", "utf8");
  assert.match(admin, /router\.use\(\s*\[[\s\S]*?"\/admin\/restricted-cases"[\s\S]*?\],\s*requireAuth,\s*requireRole\("administrator"\)/);
  assert.match(admin, /router\.get\("\/admin\/restricted-cases"/);
  assert.match(admin, /router\.post\(\s*"\/admin\/restricted-cases\/:requestId\/action"/);
  assert.match(eligibility, /r\.status AS restricted_review_status/);
  assert.match(eligibility, /CASE WHEN r\.case_reason='over_age_full_time' THEN r\.status ELSE NULL END\s+AS exemption_review_status/);
  assert.doesNotMatch(eligibility, /AS (?:restricted_)?(?:category|case_reason|suggested_category)/);
});
