const fs = require("fs");
const path = require("path");
const express = require("express");
const { body, validationResult } = require("express-validator");
const db = require("../config/database");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const { AppError } = require("../middleware/errorHandler");
const { writeAuditLog } = require("../middleware/audit");
const { queueNotification } = require("../services/emailService");

const router = express.Router();
const storageRoot = path.resolve(
  process.env.PRIVATE_STORAGE_ROOT ||
  path.join(__dirname, "..", "..", "storage", "private")
);

const reviewAccess = [requireAuth, requireRole("administrator", "staff"), requirePermission("applications.view")];

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

router.get("/admin/applications", ...reviewAccess, async (req, res, next) => {
  try {
    const status = String(req.query.status || "").trim();
    const allowedStatuses = new Set([
      "submitted","under_review","correction_required","approved_internally",
      "ready_for_nerd_registration","nerd_registration_in_progress",
      "nerd_registration_completed","clearance_available",
    ]);
    const params = {};
    const where = status && allowedStatuses.has(status) ? "WHERE a.status=:status" : "";
    if (where) params.status = status;
    const [rows] = await db.execute(
      `SELECT a.id, a.application_reference, a.status, a.submitted_at,
              a.first_name, a.middle_name, a.surname, a.email_address,
              a.phone_number, a.nationality, a.institution_name,
              a.faculty, a.department, a.course_of_study,
              u.id AS applicant_id
       FROM applications a
       JOIN users u ON u.id=a.applicant_id
       ${where}
       ORDER BY a.submitted_at DESC, a.updated_at DESC
       LIMIT 100`,
      params
    );
    res.json({ success: true, applications: rows });
  } catch (error) {
    next(error);
  }
});

router.get("/admin/applications/:applicationId", ...reviewAccess, async (req, res, next) => {
  try {
    const applicationId = Number(req.params.applicationId);
    if (!Number.isInteger(applicationId) || applicationId < 1) {
      throw new AppError("Invalid application.", 400, "INVALID_APPLICATION");
    }
    const [applications] = await db.execute(
      `SELECT a.*, u.full_name AS account_name, u.email AS account_email, u.phone AS account_phone
       FROM applications a
       JOIN users u ON u.id=a.applicant_id
       WHERE a.id=:applicationId`,
      { applicationId }
    );
    if (!applications[0]) throw new AppError("Application not found.", 404, "APPLICATION_NOT_FOUND");

    const [documents] = await db.execute(
      `SELECT d.id, d.category, d.original_filename, d.mime_type, d.file_size,
              d.is_current, d.uploaded_at, d.relative_path
       FROM application_documents ad
       JOIN documents d ON d.id=ad.document_id
       WHERE ad.application_id=:applicationId
       ORDER BY d.uploaded_at DESC`,
      { applicationId }
    );
    const [corrections] = await db.execute(
      `SELECT ac.id, ac.reason, ac.authorized_fields,
              ac.authorized_document_categories, ac.status,
              ac.resolved_at, ac.created_at, u.full_name AS requested_by_name
       FROM application_corrections ac
       JOIN users u ON u.id=ac.requested_by
       WHERE ac.application_id=:applicationId
       ORDER BY ac.created_at DESC`,
      { applicationId }
    );
    res.json({
      success: true,
      application: applications[0],
      documents: documents.map((document) => {
        const absolutePath = path.resolve(storageRoot, document.relative_path);
        const fileAvailable = absolutePath.startsWith(`${storageRoot}${path.sep}`) &&
          fs.existsSync(absolutePath);
        const { relative_path: _relativePath, ...safeDocument } = document;
        return { ...safeDocument, file_available: fileAvailable };
      }),
      corrections,
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/admin/applications/:applicationId/action",
  requireAuth,
  requireRole("administrator", "staff"),
  requirePermission("applications.correct"),
  [
    body("action").isIn([
      "under_review",
      "correction_required",
      "approved_internally",
      "ready_for_nerd_registration",
      "nerd_registration_in_progress",
      "nerd_registration_completed",
    ]),
    body("reason").optional({ checkFalsy: true }).trim().isLength({ max: 2000 }),
    body("authorizedFields").optional().isArray(),
    body("authorizedDocumentCategories").optional().isArray(),
    body("officialReference").optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError("Please correct the action fields.", 422, "VALIDATION_ERROR", errors.mapped());
      }

      const applicationId = Number(req.params.applicationId);
      if (!Number.isInteger(applicationId) || applicationId < 1) {
        throw new AppError("Invalid application.", 400, "INVALID_APPLICATION");
      }

      const staffActionAllowed = new Set([
        "under_review",
        "correction_required",
        "approved_internally",
        "ready_for_nerd_registration",
        "nerd_registration_in_progress",
      ]);
      if (req.session.user.role === "staff" && !staffActionAllowed.has(req.body.action)) {
        throw new AppError("This application action is not permitted for your staff role.", 403, "ACTION_FORBIDDEN");
      }

      const [applications] = await db.execute(
        `SELECT a.id, a.applicant_id, a.status, a.application_reference,
                u.full_name, u.email
         FROM applications a JOIN users u ON u.id=a.applicant_id
         WHERE a.id=:applicationId`,
        { applicationId }
      );
      if (!applications[0]) throw new AppError("Application not found.", 404, "APPLICATION_NOT_FOUND");
      const application = applications[0];
      const action = req.body.action;
      const reason = String(req.body.reason || "").trim();

      if (action === "correction_required" && !reason) {
        throw new AppError("A correction reason is required.", 422, "CORRECTION_REASON_REQUIRED");
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          `UPDATE applications SET status=:status, updated_at=CURRENT_TIMESTAMP WHERE id=:applicationId`,
          { status: action, applicationId }
        );
        if (action === "correction_required") {
          await connection.execute(
            `INSERT INTO application_corrections (
               application_id, requested_by, reason,
               authorized_fields, authorized_document_categories, status
             ) VALUES (
               :applicationId, :requestedBy, :reason,
               :authorizedFields,
               :authorizedDocumentCategories,
               'open'
             )`,
            {
              applicationId,
              requestedBy: req.session.user.id,
              reason,
              authorizedFields: JSON.stringify(req.body.authorizedFields || []),
              authorizedDocumentCategories: JSON.stringify(req.body.authorizedDocumentCategories || []),
            }
          );
        }
        if (action.startsWith("nerd_registration_")) {
          const trackingStatus =
            action === "nerd_registration_in_progress" ? "in_progress" :
            action === "nerd_registration_completed" ? "completed" : "not_started";
          await connection.execute(
            `INSERT INTO nerd_registration_tracking (
               application_id, official_nerd_reference, status,
               updated_by, started_at, completed_at
             ) VALUES (
               :applicationId, :officialReference, :trackingStatus,
               :updatedBy,
               CASE WHEN :trackingStatus='in_progress' THEN CURRENT_TIMESTAMP ELSE NULL END,
               CASE WHEN :trackingStatus='completed' THEN CURRENT_TIMESTAMP ELSE NULL END
             )
             ON DUPLICATE KEY UPDATE
               official_nerd_reference=COALESCE(VALUES(official_nerd_reference), official_nerd_reference),
               status=VALUES(status),
               updated_by=VALUES(updated_by),
               started_at=COALESCE(VALUES(started_at), started_at),
               completed_at=COALESCE(VALUES(completed_at), completed_at)`,
            {
              applicationId,
              officialReference: req.body.officialReference || null,
              trackingStatus,
              updatedBy: req.session.user.id,
            }
          );
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      await writeAuditLog({
        userId: req.session.user.id,
        action: `application.${action}`,
        recordType: "applications",
        recordId: applicationId,
        previousValues: { status: application.status },
        newValues: {
          status: action,
          reason: reason || null,
          authorizedFields: req.body.authorizedFields || [],
          authorizedDocumentCategories: req.body.authorizedDocumentCategories || [],
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      }).catch(() => {});

      try {
        await queueNotification({
          recipientUserId: application.applicant_id,
          recipientEmail: application.email,
          templateName: action === "correction_required" ? "correction_requested" : "application_submitted",
          payload: {
            reason,
            applicationReference: application.application_reference,
          },
        });
      } catch (notificationError) {
        console.error("Failed to queue application review notification:", notificationError);
      }

      res.json({ success: true, message: "Application status updated.", status: action });
    } catch (error) {
      next(error);
    }
  }
);

router.get("/application/corrections", requireAuth, requireRole("applicant"), async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT ac.id, ac.reason, ac.authorized_fields,
              ac.authorized_document_categories, ac.status,
              ac.resolved_at, ac.created_at,
              u.full_name AS requested_by_name
       FROM application_corrections ac
       JOIN applications a ON a.id=ac.application_id
       JOIN users u ON u.id=ac.requested_by
       WHERE a.applicant_id=:applicantId
       ORDER BY ac.created_at DESC`,
      { applicantId: req.session.user.id }
    );
    res.json({
      success: true,
      corrections: rows.map((row) => ({
        ...row,
        authorized_fields: parseJsonArray(row.authorized_fields),
        authorized_document_categories: parseJsonArray(row.authorized_document_categories),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/application/corrections/:correctionId/resubmit",
  requireAuth,
  requireRole("applicant"),
  async (req, res, next) => {
    const connection = await db.getConnection();
    try {
      const correctionId = Number(req.params.correctionId);
      if (!Number.isInteger(correctionId) || correctionId < 1) {
        throw new AppError("Invalid correction.", 400, "INVALID_CORRECTION");
      }
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT ac.id, ac.application_id, ac.status,
                a.applicant_id, a.application_reference
         FROM application_corrections ac
         JOIN applications a ON a.id=ac.application_id
         WHERE ac.id=:correctionId`,
        { correctionId }
      );
      if (!rows[0] || rows[0].applicant_id !== req.session.user.id) {
        throw new AppError("Correction not found.", 404, "CORRECTION_NOT_FOUND");
      }
      if (rows[0].status !== "open") {
        throw new AppError("This correction is no longer open.", 409, "CORRECTION_CLOSED");
      }
      const [corrections] = await connection.execute(
        `SELECT authorized_document_categories
         FROM application_corrections
         WHERE id=:correctionId`,
        { correctionId }
      );
      const authorizedCategories = parseJsonArray(corrections[0]?.authorized_document_categories);
      if (authorizedCategories.length) {
        const [documents] = await connection.execute(
          `SELECT ad.field_name, d.relative_path
           FROM application_documents ad
           JOIN documents d ON d.id=ad.document_id
           WHERE ad.application_id=:applicationId
             AND d.is_current=TRUE`,
          {
            applicationId: rows[0].application_id,
          }
        );
        const authorizedCategorySet = new Set(authorizedCategories);
        const availableCategories = new Set(documents.filter((document) => {
          if (!authorizedCategorySet.has(document.field_name)) return false;
          const absolutePath = path.resolve(storageRoot, document.relative_path);
          return absolutePath.startsWith(`${storageRoot}${path.sep}`) && fs.existsSync(absolutePath);
        }).map((document) => document.field_name));
        const missingCategories = authorizedCategories.filter((category) => !availableCategories.has(category));
        if (missingCategories.length) {
          throw new AppError(
            "Upload all requested replacement documents before resubmitting.",
            422,
            "CORRECTION_DOCUMENTS_REQUIRED",
            { categories: missingCategories }
          );
        }
      }
      await connection.execute(
        `UPDATE application_corrections
         SET status='resolved', resolved_at=CURRENT_TIMESTAMP
         WHERE id=:correctionId`,
        { correctionId }
      );
      await connection.execute(
        `UPDATE applications
         SET status='submitted', updated_at=CURRENT_TIMESTAMP
         WHERE id=:applicationId`,
        { applicationId: rows[0].application_id }
      );
      await connection.commit();
      await writeAuditLog({
        userId: req.session.user.id,
        action: "application.correction_resubmitted",
        recordType: "application_corrections",
        recordId: correctionId,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        newValues: { status: "resolved" },
      }).catch(() => {});
      res.json({ success: true, message: "Corrections submitted for review.", status: "submitted" });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
