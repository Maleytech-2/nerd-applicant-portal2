const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function collectInlineScriptHashes(directory) {
  const hashes = new Set();

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const hash of collectInlineScriptHashes(entryPath)) hashes.add(hash);
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".html") continue;

    const html = fs.readFileSync(entryPath, "utf8");
    const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    for (const match of html.matchAll(scriptPattern)) {
      if (/\bsrc\s*=/i.test(match[1])) continue;
      const digest = crypto.createHash("sha256").update(match[2]).digest("base64");
      hashes.add(`'sha256-${digest}'`);
    }
  }

  return hashes;
}

function createContentSecurityPolicy(publicDirectory) {
  return {
    directives: {
      scriptSrc: [
        "'self'",
        "https://cdn.jsdelivr.net",
        ...collectInlineScriptHashes(publicDirectory),
      ],
      styleSrc: ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net", "data:"],
    },
  };
}

module.exports = { collectInlineScriptHashes, createContentSecurityPolicy };
