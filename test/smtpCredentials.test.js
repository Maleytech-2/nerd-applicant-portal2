const test = require("node:test");
const assert = require("node:assert/strict");
const { encryptSmtpCredentials, decryptSmtpCredentials } = require("../src/utils/smtpCredentials");

test("SMTP credentials are encrypted and can be decrypted with the same secret", () => {
  const secret = "test-session-secret-with-at-least-32-characters";
  const credentials = {
    user: "sender@example.com",
    password: "smtp-app-password",
  };
  const encrypted = encryptSmtpCredentials(credentials, secret);

  assert.equal(encrypted.includes(credentials.password), false);
  assert.deepEqual(decryptSmtpCredentials(encrypted, secret), credentials);
});

test("SMTP credentials cannot be decrypted with a different secret", () => {
  const encrypted = encryptSmtpCredentials(
    { user: "sender@example.com", password: "smtp-app-password" },
    "test-session-secret-with-at-least-32-characters"
  );

  assert.throws(() => decryptSmtpCredentials(
    encrypted,
    "another-session-secret-with-at-least-32-characters"
  ));
});
