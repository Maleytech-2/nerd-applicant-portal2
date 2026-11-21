const test = require("node:test");
const assert = require("node:assert/strict");

test("document route source does not expose public storage paths", () => {
  const fs = require("fs");
  const source = fs.readFileSync(
    "src/routes/documentRoutes.js",
    "utf8"
  );
  assert.doesNotMatch(source, /express\.static|public[/"']/i);
  assert.match(source, /PRIVATE_STORAGE_ROOT|storageRoot/);
});
