const programmeTypes = {
  Undergraduate: new Set(["B.Sc.","B.A.","B.Eng.","B.Tech.","B.Ed.","LL.B.","MBBS","B.Agric.","B.NSc.","B.Pharm.","B.Sc. (Ed.)","B.Sc. (Hons.)"]),
  Postgraduate: new Set(["PGD","M.Sc.","M.A.","MBA","M.Ed.","M.Eng.","LL.M.","MPH","M.Phil.","Ph.D.","DBA","Ed.D."]),
  Diploma: new Set(["ND","HND","Diploma in Computer Science","Diploma in Business Administration","Diploma in Education","Diploma in Public Administration","Diploma in Accounting","Diploma in Law","Diploma in Mass Communication","Diploma in Nursing","Professional Diploma","Ordinary Diploma","Advanced Diploma"]),
};

function isValidProgrammeSelection(category, type) {
  return Boolean(programmeTypes[category]?.has(type));
}

module.exports = { isValidProgrammeSelection };
