const NOUN_NORMALIZED = "national open university of nigeria noun";

function normalizeInstitutionName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bnational open university\b/g, "national open university")
    .replace(/\bnoun\b/g, "noun")
    .trim()
    .replace(/\s+/g, " ");
}

function isNounInstitution(value) {
  const normalized = normalizeInstitutionName(value);
  return normalized === NOUN_NORMALIZED
    || normalized.includes("national open university of nigeria")
    || normalized === "noun";
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return date;
}

function calculateAgeAtDate(dateOfBirth, targetDate) {
  const dob = parseIsoDate(dateOfBirth);
  const target = parseIsoDate(targetDate);
  if (!dob || !target) throw new RangeError("Dates must use valid YYYY-MM-DD values.");
  if (dob > target) throw new RangeError("Date of birth cannot be after the graduation date.");

  let age = target.getUTCFullYear() - dob.getUTCFullYear();
  const birthdayMonth = dob.getUTCMonth();
  const birthdayDay = dob.getUTCDate();
  if (
    target.getUTCMonth() < birthdayMonth
    || (target.getUTCMonth() === birthdayMonth && target.getUTCDate() < birthdayDay)
  ) {
    age--;
  }
  return age;
}

function calculateFullTimeFee(nationality) {
  return String(nationality).trim().toLowerCase() === "nigerian" ? 12000 : 25000;
}

function evaluateEligibility({ dateOfBirth, graduationDate, nationality, institution, studyMode = "full_time" }) {
  const ageAtGraduation = calculateAgeAtDate(dateOfBirth, graduationDate);
  const isNigerian = String(nationality).trim().toLowerCase() === "nigerian";

  if (isNounInstitution(institution)) {
    return {
      eligible: false,
      reviewRequired: true,
      caseReason: "noun",
      suggestedCategory: null,
      ageAtGraduation,
      rejectionReason: "Your details have been submitted for administrator review. Payment and application remain locked until a decision is made.",
      fee: null,
    };
  }

  if (isNigerian && studyMode === "part_time") {
    return {
      eligible: false,
      reviewRequired: true,
      caseReason: "nigerian_part_time",
      suggestedCategory: "exclusion",
      ageAtGraduation,
      rejectionReason: "Your details have been submitted for administrator review. Payment and application remain locked until a decision is made.",
      fee: null,
    };
  }

  if (ageAtGraduation > 30) {
    if (studyMode === "full_time") {
      return {
        eligible: false,
        reviewRequired: true,
        caseReason: "over_age_full_time",
        suggestedCategory: "exemption",
        ageAtGraduation,
        rejectionReason: "Your details have been submitted for administrator review. Payment and application remain locked until a decision is made.",
        fee: null,
      };
    }
    return {
      eligible: false,
      reviewRequired: false,
      caseReason: null,
      suggestedCategory: null,
      ageAtGraduation,
      rejectionReason: "The applicant was older than 30 years on the actual date of graduation.",
      fee: null,
    };
  }

  return {
    eligible: true,
    reviewRequired: false,
    caseReason: null,
    suggestedCategory: null,
    ageAtGraduation,
    rejectionReason: null,
    fee: calculateFullTimeFee(nationality),
  };
}

module.exports = {
  calculateAgeAtDate,
  calculateFullTimeFee,
  evaluateEligibility,
  isNounInstitution,
  normalizeInstitutionName,
};
