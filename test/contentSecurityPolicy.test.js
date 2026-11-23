const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { collectInlineScriptHashes, createContentSecurityPolicy } = require("../src/config/contentSecurityPolicy");

const publicDirectory = path.join(__dirname, "..", "public");

test("production CSP allows the Bootstrap CDN and hashes trusted inline scripts", () => {
  const policy = createContentSecurityPolicy(publicDirectory);
  const scriptSources = policy.directives.scriptSrc;

  assert.ok(scriptSources.includes("https://cdn.jsdelivr.net"));
  assert.ok(scriptSources.some((source) => source.startsWith("'sha256-")));
  assert.ok(!scriptSources.includes("'unsafe-inline'"));
});

test("inline script hashes are calculated from the shipped HTML source", () => {
  const html = fs.readFileSync(path.join(publicDirectory, "auth", "reset-password.html"), "utf8");
  const inlineScript = html.match(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/i)?.[1];
  assert.ok(inlineScript);

  const expected = `'sha256-${crypto.createHash("sha256").update(inlineScript).digest("base64")}'`;
  assert.ok(collectInlineScriptHashes(publicDirectory).has(expected));
});
