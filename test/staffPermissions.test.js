const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

test("staff management is restricted and excludes restricted categories", () => {
  const source = fs.readFileSync("src/routes/staffRoutes.js", "utf8");
  assert.match(source, /requireRole\("administrator"\)/);
  assert.match(source, /exemption|exclusion/);
  assert.doesNotMatch(source, /restricted_category_records/);
});
