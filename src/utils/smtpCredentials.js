const crypto = require("crypto");

const CREDENTIAL_VERSION = 1;

function deriveKey(salt, secret = process.env.SESSION_SECRET) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters to encrypt SMTP credentials.");
  }
  return crypto.scryptSync(secret, salt, 32);
}

function encryptSmtpCredentials(credentials, secret) {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(salt, secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    version: CREDENTIAL_VERSION,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}

function decryptSmtpCredentials(serialized, secret) {
  const record = JSON.parse(serialized);
  if (
    record.version !== CREDENTIAL_VERSION ||
    typeof record.salt !== "string" ||
    typeof record.iv !== "string" ||
    typeof record.authTag !== "string" ||
    typeof record.ciphertext !== "string"
  ) {
    throw new Error("Stored SMTP credentials have an unsupported format.");
  }
  const salt = Buffer.from(record.salt, "base64");
  const key = deriveKey(salt, secret);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(record.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext);
}

module.exports = { encryptSmtpCredentials, decryptSmtpCredentials };
