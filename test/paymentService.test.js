const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createReceiptHash,
  getReceiptMagicType,
} = require("../src/services/paymentService");

test("receipt hash remains identical for renamed copies", () => {
  const buffer = Buffer.from("identical receipt content");
  assert.equal(createReceiptHash(buffer), createReceiptHash(Buffer.from("identical receipt content")));
});

test("PDF magic bytes are detected", () => {
  assert.equal(getReceiptMagicType(Buffer.from("%PDF-1.7 test")), "application/pdf");
});

test("PNG magic bytes are detected", () => {
  assert.equal(getReceiptMagicType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
});

test("invalid receipt content is rejected", () => {
  assert.equal(getReceiptMagicType(Buffer.from("not a supported document")), null);
});
