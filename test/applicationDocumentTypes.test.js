const test = require("node:test");
const assert = require("node:assert/strict");
const { isAllowedApplicationDocument } = require("../src/utils/applicationDocumentTypes");

test("full project accepts PDF and DOCX only", () => {
  assert.equal(isAllowedApplicationDocument("full_project", "application/pdf"), true);
  assert.equal(isAllowedApplicationDocument("full_project", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), true);
  assert.equal(isAllowedApplicationDocument("full_project", "image/jpeg"), false);
  assert.equal(isAllowedApplicationDocument("full_project", "image/png"), false);
});

test("signed certification accepts PDF and images but not Word documents", () => {
  assert.equal(isAllowedApplicationDocument("signed_certification", "application/pdf"), true);
  assert.equal(isAllowedApplicationDocument("signed_certification", "image/jpeg"), true);
  assert.equal(isAllowedApplicationDocument("signed_certification", "image/png"), true);
  assert.equal(isAllowedApplicationDocument("signed_certification", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), false);
});
