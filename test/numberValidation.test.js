const test = require("node:test");
const assert = require("node:assert/strict");
const { isElevenDigitNumber } = require("../src/utils/validation");

test("accepts exactly 11 numeric digits", () => {
  assert.equal(isElevenDigitNumber("08012345678"), true);
});

test("rejects phone numbers and NIN values shorter or longer than 11 digits", () => {
  assert.equal(isElevenDigitNumber("8012345678"), false);
  assert.equal(isElevenDigitNumber("080123456789"), false);
});

test("rejects non-digit and non-string values", () => {
  assert.equal(isElevenDigitNumber("08012A45678"), false);
  assert.equal(isElevenDigitNumber("+2348012345678"), false);
  assert.equal(isElevenDigitNumber(8012345678), false);
});
