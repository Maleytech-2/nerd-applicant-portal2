const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidProgrammeSelection } = require("../src/utils/programmeSelection");

const expectedTypes = {
  Undergraduate: ["B.Sc.","B.A.","B.Eng.","B.Tech.","B.Ed.","LL.B.","MBBS","B.Agric.","B.NSc.","B.Pharm.","B.Sc. (Ed.)","B.Sc. (Hons.)"],
  Postgraduate: ["PGD","M.Sc.","M.A.","MBA","M.Ed.","M.Eng.","LL.M.","MPH","M.Phil.","Ph.D.","DBA","Ed.D."],
  Diploma: ["ND","HND","Diploma in Computer Science","Diploma in Business Administration","Diploma in Education","Diploma in Public Administration","Diploma in Accounting","Diploma in Law","Diploma in Mass Communication","Diploma in Nursing","Professional Diploma","Ordinary Diploma","Advanced Diploma"],
};

test("accepts programme types only within their selected category", () => {
  for (const [category, types] of Object.entries(expectedTypes)) {
    for (const type of types) assert.equal(isValidProgrammeSelection(category, type), true);
  }
  assert.equal(isValidProgrammeSelection("Undergraduate", "Ph.D."), false);
  assert.equal(isValidProgrammeSelection("Postgraduate", "ND"), false);
  assert.equal(isValidProgrammeSelection("Diploma", "B.Sc."), false);
  assert.equal(isValidProgrammeSelection("Full-Time", "Other"), false);
});
