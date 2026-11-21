const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateAgeAtDate,
  calculateFullTimeFee,
  evaluateEligibility,
  isNounInstitution,
} = require("../src/services/eligibilityService");

test("applicant aged exactly 30 is eligible", () => {
  assert.equal(calculateAgeAtDate("1996-05-10", "2026-05-10"), 30);
  assert.equal(evaluateEligibility({
    dateOfBirth: "1996-05-10",
    graduationDate: "2026-05-10",
    nationality: "Nigerian",
    institution: "University of Example",
  }).eligible, true);
});

test("Nigerian full-time applicant over 30 is sent for exemption review", () => {
  assert.equal(calculateAgeAtDate("1995-05-09", "2026-05-10"), 31);
  const result = evaluateEligibility({
    dateOfBirth: "1995-05-09",
    graduationDate: "2026-05-10",
    nationality: "Nigerian",
    institution: "University of Example",
    studyMode: "full_time",
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.suggestedCategory, "exemption");
});

test("Nigerian part-time applicant is sent for exclusion review", () => {
  const result = evaluateEligibility({
    dateOfBirth: "1996-05-10",
    graduationDate: "2026-05-10",
    nationality: "Nigerian",
    institution: "University of Example",
    studyMode: "part_time",
  });
  assert.equal(result.reviewRequired, true);
  assert.equal(result.suggestedCategory, "exclusion");
});

test("NOUN applicants are sent to admin for category assignment", () => {
  const result = evaluateEligibility({
    dateOfBirth: "1996-05-10",
    graduationDate: "2026-05-10",
    nationality: "Nigerian",
    institution: "NOUN",
    studyMode: "part_time",
  });
  assert.equal(result.reviewRequired, true);
  assert.equal(result.caseReason, "noun");
  assert.equal(result.suggestedCategory, null);
});

test("foreign full-time applicant over 30 is sent for exemption review", () => {
  const result = evaluateEligibility({
    dateOfBirth: "1995-05-09",
    graduationDate: "2026-05-10",
    nationality: "Foreign",
    institution: "University of Example",
    studyMode: "full_time",
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.suggestedCategory, "exemption");
});

test("full-time applicant over 30 is classified for exemption review regardless of nationality", () => {
  const result = evaluateEligibility({
    dateOfBirth: "1995-05-09",
    graduationDate: "2026-05-10",
    nationality: "Foreign",
    institution: "University of Example",
    studyMode: "full_time",
  });
  assert.equal(result.reviewRequired, true);
  assert.equal(result.suggestedCategory, "exemption");
});

test("foreign part-time applicant over 30 remains ineligible without a restricted case", () => {
  const result = evaluateEligibility({
    dateOfBirth: "1995-05-09",
    graduationDate: "2026-05-10",
    nationality: "Foreign",
    institution: "University of Example",
    studyMode: "part_time",
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reviewRequired, false);
});

test("birthday after graduation is counted correctly", () => {
  assert.equal(calculateAgeAtDate("1996-05-20", "2026-05-10"), 29);
});

test("current age does not replace age at graduation", () => {
  const result = evaluateEligibility({
    dateOfBirth: "1988-01-01",
    graduationDate: "2015-01-01",
    nationality: "Nigerian",
    institution: "University of Example",
  });
  assert.equal(result.ageAtGraduation, 27);
  assert.equal(result.eligible, true);
});

test("NOUN is routed for administrator review across nationalities", () => {
  assert.equal(isNounInstitution("National Open University of Nigeria (NOUN)"), true);
  assert.equal(evaluateEligibility({
    dateOfBirth: "1996-01-01",
    graduationDate: "2026-01-01",
    nationality: "Foreign",
    institution: "NOUN",
  }).reviewRequired, true);
});

test("fees are calculated from nationality", () => {
  assert.equal(calculateFullTimeFee("Nigerian"), 12000);
  assert.equal(calculateFullTimeFee("Foreign"), 25000);
});
