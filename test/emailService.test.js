const test = require("node:test");
const assert = require("node:assert/strict");
process.env.DATABASE_URL_STRING ||= "mysql://test:test@127.0.0.1/test";
const {
  escapeHtml,
  renderTemplate,
} = require("../src/services/emailService");

test("email HTML escapes user-provided text", () => {
  assert.equal(
    escapeHtml('<script>alert("x")</script>'),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
  );
});

test("payment notification omits restricted category details", () => {
  const rendered = renderTemplate("new_payment_claim", {
    applicantName: "Test Applicant",
    applicantReference: "NERD-2026-000001",
    email: "applicant@example.com",
    nationality: "Nigerian",
    amountSubmitted: 12000,
    expectedAmount: 12000,
    paymentChannel: "palmpay",
    transactionReference: "TX-123",
  });
  assert.match(rendered.subject, /payment claim/i);
  assert.doesNotMatch(rendered.html, /exemption|exclusion/i);
});

test("eligibility review notification does not reveal the restricted category", () => {
  const rendered = renderTemplate("eligibility_review_decision", { approved: true });
  assert.doesNotMatch(rendered.subject, /exemption|exclusion/i);
  assert.doesNotMatch(rendered.text, /exemption|exclusion/i);
  assert.doesNotMatch(rendered.html, /exemption|exclusion/i);
});
