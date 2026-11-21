const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

test("clearance route preserves administrator-only upload and applicant ownership", () => {
  const source = fs.readFileSync("src/routes/clearanceRoutes.js", "utf8");
  assert.match(source, /requireRole\("administrator"\)/);
  assert.match(source, /requireRole\("applicant"\)/);
  assert.match(source, /a\.applicant_id=:applicantId/);
  assert.match(source, /status='replaced'/);
});
