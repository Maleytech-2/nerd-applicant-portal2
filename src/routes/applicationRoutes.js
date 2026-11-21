const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { body, validationResult } = require("express-validator");
const db = require("../config/database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { AppError } = require("../middleware/errorHandler");
const { writeAuditLog } = require("../middleware/audit");
const { queueNotification } = require("../services/emailService");
const { isValidProgrammeSelection } = require("../utils/programmeSelection");
const { isElevenDigitNumber } = require("../utils/validation");

const router = express.Router();
const storageRoot = path.resolve(process.env.PRIVATE_STORAGE_ROOT || path.join(__dirname, "..", "..", "storage", "private"));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_APPLICATION_UPLOAD_BYTES || 10485760), files: 5 },
});

router.use("/application", requireAuth, requireRole("applicant"));

async function getUnlockedApplication(req) {
  const [rows] = await db.execute(
    `SELECT p.id AS payment_id, p.status AS payment_status
     FROM payments p
     WHERE p.applicant_id=:applicantId AND p.status='approved'
     ORDER BY p.verified_at DESC LIMIT 1`,
    { applicantId: req.session.user.id }
  );
  if (!rows[0]) throw new AppError("The application form unlocks only after payment approval.", 403, "APPLICATION_LOCKED");
  return rows[0];
}

async function getDraftOrCreate(req, connection) {
  const payment = await getUnlockedApplication(req);
  const [existing] = await connection.execute(
    "SELECT * FROM applications WHERE applicant_id=:applicantId LIMIT 1",
    { applicantId: req.session.user.id }
  );
  if (existing[0]) {
    if (!["draft", "correction_required"].includes(existing[0].status)) {
      throw new AppError("Submitted application information cannot be directly overwritten.", 409, "APPLICATION_LOCKED");
    }
    return { application: existing[0], payment };
  }
  const [eligibility] = await connection.execute(
    "SELECT date_of_birth, nationality, institution_name FROM eligibility_screenings WHERE applicant_id=:applicantId LIMIT 1",
    { applicantId: req.session.user.id }
  );
  const reference = `NERD-${new Date().getUTCFullYear()}-${String(req.session.user.id).padStart(6, "0")}`;
  const [created] = await connection.execute(
    `INSERT INTO applications (
       applicant_id, payment_id, application_reference, date_of_birth,
       nationality, institution_name, email_address, phone_number,
       first_name
     ) VALUES (
       :applicantId, :paymentId, :reference, :dateOfBirth,
       :nationality, :institutionName, :email, :phone, :firstName
     )`,
    {
      applicantId: req.session.user.id,
      paymentId: payment.payment_id,
      reference,
      dateOfBirth: eligibility[0]?.date_of_birth || null,
      nationality: eligibility[0]?.nationality || null,
      institutionName: eligibility[0]?.institution_name || null,
      email: req.session.user.email,
      phone: req.session.user.phone,
      firstName: req.session.user.fullName.split(" ")[0],
    }
  );
  const [rows] = await connection.execute("SELECT * FROM applications WHERE id=:id", { id: created.insertId });
  return { application: rows[0], payment };
}

router.get("/application", async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    await getUnlockedApplication(req);
    const [rows] = await connection.execute(
      "SELECT * FROM applications WHERE applicant_id=:applicantId LIMIT 1",
      { applicantId: req.session.user.id }
    );
    res.json({ success: true, application: rows[0] || null });
  } catch (error) {
    next(error);
  } finally {
    connection.release();
  }
});

router.get("/application/status", async (req, res, next) => {
  try {
    const [applications] = await db.execute(
      `SELECT id, application_reference, status, submitted_at
       FROM applications
       WHERE applicant_id=:applicantId
       LIMIT 1`,
      { applicantId: req.session.user.id }
    );
    const application = applications[0] || null;
    let clearance = null;
    if (application) {
      const [clearances] = await db.execute(
        `SELECT c.uploaded_at, d.id AS document_id
         FROM clearances c
         JOIN documents d ON d.id=c.document_id
         WHERE c.application_id=:applicationId
           AND c.status='available'
           AND d.is_current=TRUE
         ORDER BY c.uploaded_at DESC
         LIMIT 1`,
        { applicationId: application.id }
      );
      clearance = clearances[0] || null;
    }
    res.json({
      success: true,
      application: application && {
        reference: application.application_reference,
        status: application.status,
        submittedAt: application.submitted_at,
      },
      clearance: clearance && {
        available: true,
        uploadedAt: clearance.uploaded_at,
        documentId: clearance.document_id,
      },
    });
  } catch (error) {
    next(error);
  }
});

const allowedUpdates = [
  "title","first_name","middle_name","surname","sex","marital_status","nin",
  "nationality","country","state_of_origin","local_government_area","town_or_city",
  "residential_address","email_address","phone_number","next_of_kin_full_name",
  "next_of_kin_phone","next_of_kin_email","institution_name","faculty","department",
  "programme_category","programme_type","matriculation_number","course_of_study",
  "supervisor_title","supervisor_full_name","supervisor_email","supervisor_phone",
  "hod_title","hod_full_name","hod_email","hod_phone",
];
const elevenDigitFields = [
  "nin",
  "phone_number",
  "next_of_kin_phone",
  "supervisor_phone",
  "hod_phone",
];

router.post("/application/save", async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { application } = await getDraftOrCreate(req, connection);
    for (const field of elevenDigitFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field) && req.body[field] !== ""
          && !isElevenDigitNumber(req.body[field])) {
        throw new AppError(`${field.replaceAll("_", " ")} must contain exactly 11 digits.`, 422, "INVALID_NUMBER_LENGTH", { field });
      }
    }
    const category = Object.prototype.hasOwnProperty.call(req.body, "programme_category")
      ? req.body.programme_category || null
      : application.programme_category;
    const type = Object.prototype.hasOwnProperty.call(req.body, "programme_type")
      ? req.body.programme_type || null
      : application.programme_type;
    const keepsExistingLegacySelection =
      category === application.programme_category && type === application.programme_type;
    if (category && type && !isValidProgrammeSelection(category, type) && !keepsExistingLegacySelection) {
      throw new AppError("Select a programme type that belongs to the chosen category.", 422, "INVALID_PROGRAMME_SELECTION");
    }
    const updates = [];
    const params = { id: application.id };
    if (application.status === "correction_required") {
      const [corrections] = await connection.execute(
        `SELECT authorized_fields
         FROM application_corrections
         WHERE application_id=:applicationId AND status='open'
         ORDER BY created_at DESC LIMIT 1`,
        { applicationId: application.id }
      );
      let authorizedFields = [];
      if (corrections[0]?.authorized_fields) {
        try {
          authorizedFields = typeof corrections[0].authorized_fields === "string"
            ? JSON.parse(corrections[0].authorized_fields)
            : corrections[0].authorized_fields;
        } catch (_error) {
          authorizedFields = [];
        }
      }
      for (const field of Object.keys(req.body)) {
        if (!["csrfToken", ...authorizedFields].includes(field)) {
          throw new AppError("This field was not authorized for correction.", 403, "FIELD_CORRECTION_NOT_AUTHORIZED");
        }
      }
    }
    for (const field of allowedUpdates) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates.push(`${field}=:${field}`);
        params[field] = req.body[field] === "" ? null : req.body[field];
      }
    }
    if (updates.length) {
      await connection.execute(
        `UPDATE applications SET ${updates.join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE id=:id`,
        params
      );
    }
    await connection.commit();
    await writeAuditLog({
      userId: req.session.user.id,
      action: "application.saved",
      recordType: "applications",
      recordId: application.id,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    }).catch(() => {});
    res.json({ success: true, message: "Application progress saved.", applicationId: application.id });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

router.post("/application/submit",
  [
    body("informationConfirmed").equals("true"),
  ],
  async (req, res, next) => {
    const connection = await db.getConnection();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new AppError("You must confirm that the submitted information is accurate.", 422, "CONFIRMATION_REQUIRED");
      await connection.beginTransaction();
      const { application } = await getDraftOrCreate(req, connection);
      const [current] = await connection.execute("SELECT * FROM applications WHERE id=:id", { id: application.id });
      const app = current[0];
      const required = [
        "first_name","surname","sex","date_of_birth","marital_status","nin","nationality",
        "country","state_of_origin","residential_address","email_address","phone_number",
        "next_of_kin_full_name","next_of_kin_phone","institution_name","faculty","department",
        "programme_category","programme_type","matriculation_number","course_of_study",
        "supervisor_full_name","supervisor_email","supervisor_phone","hod_full_name","hod_email","hod_phone",
      ];
      const missing = required.filter((field) => !app[field]);
      if (missing.length) {
        throw new AppError("Complete all required application fields before final submission.", 422, "INCOMPLETE_APPLICATION", { missing });
      }
      const invalidNumberFields = elevenDigitFields.filter((field) => !isElevenDigitNumber(String(app[field] || "")));
      if (invalidNumberFields.length) {
        throw new AppError("NIN and all phone numbers must contain exactly 11 digits.", 422, "INVALID_NUMBER_LENGTH", { fields: invalidNumberFields });
      }
      if (!isValidProgrammeSelection(app.programme_category, app.programme_type)) {
        throw new AppError("Select a programme type that belongs to the chosen category.", 422, "INVALID_PROGRAMME_SELECTION");
      }

      await connection.execute(
        `UPDATE applications
         SET status='submitted', information_confirmed=TRUE,
             submitted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
         WHERE id=:id`,
        { id: app.id }
      );
      await connection.commit();
      await writeAuditLog({
        userId: req.session.user.id,
        action: "application.submitted",
        recordType: "applications",
        recordId: app.id,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        newValues: { status: "submitted", applicationReference: app.application_reference },
      }).catch(() => {});
      try {
        await queueNotification({
          recipientUserId: req.session.user.id,
          recipientEmail: req.session.user.email,
          templateName: "application_submitted",
          payload: { applicationReference: app.application_reference },
        });
      } catch (notificationError) {
        console.error("Failed to queue application notification:", notificationError);
      }
      res.json({
        success: true,
        message: "Application submitted successfully.",
        applicationReference: app.application_reference,
        status: "submitted",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
