function isElevenDigitNumber(value) {
  return typeof value === "string" && /^\d{11}$/.test(value);
}

module.exports = { isElevenDigitNumber };
