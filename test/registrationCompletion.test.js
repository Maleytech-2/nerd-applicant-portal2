const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("applicant registration status exposes only the signed-in applicant's application and current slip", () => {
  const routes = fs.readFileSync("src/routes/applicationRoutes.js", "utf8");
  assert.match(routes, /router\.get\("\/application\/status"/);
  assert.match(routes, /WHERE applicant_id=:applicantId/);
  assert.match(routes, /c\.status='available'/);
  assert.match(routes, /d\.is_current=TRUE/);
});

test("eligibility and payment cannot be restarted after an application exists", () => {
  const eligibility = fs.readFileSync("src/routes/eligibilityRoutes.js", "utf8");
  const payment = fs.readFileSync("src/routes/paymentRoutes.js", "utf8");
  for (const source of [eligibility, payment]) {
    assert.match(source, /SELECT id FROM applications WHERE applicant_id=:applicantId LIMIT 1/);
    assert.match(source, /REGISTRATION_ALREADY_STARTED/);
  }
});

test("admin can upload a clearance slip only after the application is submitted and complete", () => {
  const routes = fs.readFileSync("src/routes/clearanceRoutes.js", "utf8");
  assert.match(routes, /SELECT a\.id, a\.application_reference, a\.applicant_id, a\.status/);
  assert.match(routes, /APPLICATION_NOT_READY_FOR_CLEARANCE/);
  assert.match(routes, /router\.get\("\/admin\/clearance-candidates", requireAuth, requireRole\("administrator"\)/);
  assert.match(routes, /WHERE a\.status NOT IN \('draft', 'correction_required'\)/);
});

test("applicant dashboard waits for the admin slip and exposes print only when available", () => {
  const dashboard = fs.readFileSync("public/applicant/dashboard.html", "utf8");
  assert.match(dashboard, /Waiting for administrator to upload your slip/);
  assert.match(dashboard, /You cannot submit another registration/);
  assert.match(dashboard, /api\/applicant\/clearance\/print/);
  assert.match(dashboard, /clearance\?\.available/);
  const adminDashboard = fs.readFileSync("public/admin/dashboard.html", "utf8");
  assert.match(adminDashboard, /api\/admin\/clearance-candidates/);
  assert.match(adminDashboard, /clearanceApplicationId/);
});

test("missing current application documents can be identified and re-requested securely", () => {
  const reviewRoutes = fs.readFileSync("src/routes/applicationReviewRoutes.js", "utf8");
  const adminPage = fs.readFileSync("public/admin/applications.html", "utf8");
  const applicantPage = fs.readFileSync("public/applicant/application.html", "utf8");
  assert.match(reviewRoutes, /file_available: fileAvailable/);
  assert.match(reviewRoutes, /CORRECTION_DOCUMENTS_REQUIRED/);
  assert.match(adminPage, /data-request-document/);
  assert.match(adminPage, /authorizedDocumentCategories: \[button\.dataset\.requestDocument\]/);
  assert.match(applicantPage, /authorizedDocumentCategories\.includes\(input\.dataset\.category\)/);
  assert.match(applicantPage, /application\/corrections\/\$\{encodeURIComponent\(correctionId\)\}\/resubmit/);
});

test("over-30 full-time applicants are classified for Exemption verification before payment", () => {
  const eligibilityRoutes = fs.readFileSync("src/routes/eligibilityRoutes.js", "utf8");
  const eligibilityPage = fs.readFileSync("public/applicant/eligibility.html", "utf8");
  assert.match(eligibilityRoutes, /exemptionReviewStatus: result\.suggestedCategory === "exemption" \? "pending" : null/);
  assert.match(eligibilityRoutes, /approvedCases\[0\]\.category === "exemption" \? "approved" : null/);
  assert.match(eligibilityPage, /Your age at graduation places you in the Exemption category/);
  assert.match(eligibilityPage, /An administrator must verify your details before payment and the application form are unlocked/);
  assert.match(eligibilityPage, /Your Exemption has been verified\. You can now continue to payment/);
});
