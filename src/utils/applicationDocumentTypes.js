function isAllowedApplicationDocument(category, mimeType) {
  if (["passport_photo", "means_of_identification"].includes(category)) {
    return ["image/jpeg", "image/png"].includes(mimeType);
  }
  if (category === "institutional_attestation" || category === "signed_certification") {
    return ["application/pdf", "image/jpeg", "image/png"].includes(mimeType);
  }
  if (category === "full_project") {
    return [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ].includes(mimeType);
  }
  return false;
}

module.exports = { isAllowedApplicationDocument };
