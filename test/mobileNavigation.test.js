const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

test("hero decoration cannot intercept mobile taps", () => {
  const stylesheet = fs.readFileSync("public/assets/css/public.css", "utf8");
  const decoration = stylesheet.match(/\.hero-section::after\s*\{([^}]+)\}/);

  assert.ok(decoration);
  assert.match(decoration[1], /pointer-events:\s*none/);
});

test("mobile menu has an accessible toggle fallback when Bootstrap JavaScript is unavailable", () => {
  const script = fs.readFileSync("public/assets/js/public.js", "utf8");

  assert.match(script, /navToggle\.addEventListener\("click"/);
  assert.match(script, /navCollapse\.classList\.toggle\("show", !isExpanded\)/);
  assert.match(script, /navToggle\.setAttribute\("aria-expanded", String\(!isExpanded\)\)/);
});
