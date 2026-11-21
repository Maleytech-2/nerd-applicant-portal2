const fs = require("fs");
const path = require("path");
const express = require("express");
const { body, validationResult } = require("express-validator");
const db = require("../config/database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { AppError } = require("../middleware/errorHandler");
const { writeAuditLog } = require("../middleware/audit");
const { PRIVATE_STORAGE_ROOT } = require("../services/paymentService");
const { queueNotification } = require("../services/emailService");

const router = express.Router();

router.use(
  ["/admin/stats", "/admin/applicants", "/admin/payments", "/admin/restricted-cases"],
  requireAuth,
  requireRole("administrator")
);

router.get("/admin/stats", async (_req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='applicant') AS totalApplicants,
        (SELECT COUNT(*) FROM eligibility_screenings WHERE is_eligible=TRUE) AS eligibleApplicants,
        (SELECT COUNT(*) FROM payments WHERE status='pending_verification') AS pendingPayments,
        (SELECT COUNT(*) FROM payments WHERE status='approved') AS approvedPayments,
        (SELECT COUNT(*) FROM payments WHERE status='rejected') AS rejectedPayments,
        (SELECT COUNT(*) FROM applications WHERE status='submitted') AS applicationsSubmitted,
        (SELECT COUNT(*) FROM applications WHERE status='under_review') AS applicationsUnderReview,
        (SELECT COUNT(*) FROM applications WHERE status='ready_for_nerd_registration') AS readyForRegistration,
        (SELECT COUNT(*) FROM clearances WHERE status='available') AS clearancesUploaded
    `);
    res.json({ success: true, stats: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get("/admin/applicants", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(10, Number(req.query.limit || 20)));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim();
    const params = { limit, offset };
    let where = "WHERE r.name='applicant'";
    if (search) {
      where += " AND (u.full_name LIKE :search OR u.email LIKE :search OR u.phone LIKE :search)";
      params.search = `%${search}%`;
    }
    const [rows] = await db.execute(
      `SELECT u.id, u.full_name, u.email, u.phone, u.is_active,
              u.created_at,
              e.is_eligible, e.nationality, e.institution_name,
              (SELECT latestPayment.status
               FROM payments latestPayment
               WHERE latestPayment.applicant_id=u.id
               ORDER BY latestPayment.submitted_at DESC
               LIMIT 1) AS payment_status,
              a.application_reference, a.status AS application_status
       FROM users u
       JOIN roles r ON r.id=u.role_id
       LEFT JOIN eligibility_screenings e ON e.applicant_id=u.id
       LEFT JOIN applications a ON a.applicant_id=u.id
       ${where}
       ORDER BY u.created_at DESC
       LIMIT :limit OFFSET :offset`,
      params
    );
    const [countRows] = await db.execute(
      `SELECT COUNT(DISTINCT u.id) AS total
      FROM users u JOIN roles r ON r.id=u.role_id
      ${where}`,
      params
    );
    res.json({ success: true, applicants: rows, pagination: { page, limit, total: countRows[0].total } });
  } catch (error) {
    next(error);
  }
});

router.get("/admin/restricted-cases", async (req, res, next) => {
  try {
    const status = String(req.query.status || "pending");
    const allowedStatuses = new Set(["pending", "approved", "rejected", "cancelled", "all"]);
    if (!allowedStatuses.has(status)) {
      throw new AppError("Invalid restricted case status.", 400, "INVALID_CASE_STATUS");
    }
    const [rows] = await db.execute(
      `SELECT r.id, r.case_reason, r.suggested_category, r.category,
              r.status, r.admin_notes, r.created_at, r.decided_at,
              u.full_name, u.email, u.phone,
              e.nationality, e.country, e.study_mode, e.institution_name,
              e.date_of_birth, e.actual_graduation_date, e.age_at_graduation
       FROM restricted_category_requests r
       JOIN users u ON u.id=r.applicant_id
       JOIN eligibility_screenings e ON e.applicant_id=r.applicant_id
       WHERE (:status='all' OR r.status=:status)
       ORDER BY r.created_at DESC
       LIMIT 200`,
      { status }
    );
    res.json({ success: true, cases: rows });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/admin/restricted-cases/:requestId/action",
  [
    body("action").isIn(["approve", "reject"]),
    body("category").optional({ checkFalsy: true }).isIn(["exemption", "exclusion"]),
    body("notes").optional({ checkFalsy: true }).trim().isLength({ max: 2000 }),
  ],
  async (req, res, next) => {
    const connection = await db.getConnection();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError("Please correct the restricted case action.", 422, "VALIDATION_ERROR", errors.mapped());
      }
      const requestId = Number(req.params.requestId);
      if (!Number.isInteger(requestId) || requestId < 1) {
        throw new AppError("Invalid restricted case.", 400, "INVALID_RESTRICTED_CASE");
      }
      const action = req.body.action;
      const notes = String(req.body.notes || "").trim() || null;
      const newStatus = action === "approve" ? "approved" : "rejected";

      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT r.id, r.applicant_id, r.case_reason, r.suggested_category, r.status,
                u.email
         FROM restricted_category_requests r
         JOIN users u ON u.id=r.applicant_id
         WHERE r.id=:requestId
         FOR UPDATE`,
        { requestId }
      );
      const restrictedCase = rows[0];
      if (!restrictedCase) throw new AppError("Restricted case not found.", 404, "RESTRICTED_CASE_NOT_FOUND");
      if (restrictedCase.status !== "pending") {
        throw new AppError("This restricted case has already been reviewed.", 409, "RESTRICTED_CASE_ALREADY_REVIEWED");
      }

      let category = null;
      let feeAmount = null;
      if (action === "approve") {
        category = req.body.category || restrictedCase.suggested_category;
        if (!category || !["exemption", "exclusion"].includes(category)) {
          throw new AppError("Choose Exemption or Exclusion before approving this case.", 422, "RESTRICTED_CATEGORY_REQUIRED");
        }
        if (restrictedCase.suggested_category && category !== restrictedCase.suggested_category) {
          throw new AppError("This case category must match its eligibility criteria.", 422, "INVALID_RESTRICTED_CATEGORY");
        }
        const [settings] = await connection.execute(
          "SELECT setting_value FROM system_settings WHERE setting_key=:settingKey LIMIT 1",
          { settingKey: `${category}_fee` }
        );
        feeAmount = Number(settings[0]?.setting_value);
        if (!Number.isFinite(feeAmount) || feeAmount <= 0) {
          throw new AppError("The configured restricted-category fee is invalid.", 500, "INVALID_RESTRICTED_FEE");
        }
        await connection.execute(
          `UPDATE eligibility_screenings
           SET is_eligible=TRUE, rejection_reason=NULL, expected_fee_amount=:fee
           WHERE applicant_id=:applicantId`,
          { fee: feeAmount, applicantId: restrictedCase.applicant_id }
        );
        const [existingRecords] = await connection.execute(
          `SELECT id FROM restricted_category_records
           WHERE applicant_id=:applicantId AND category=:category AND status='active'
           ORDER BY created_at DESC LIMIT 1`,
          { applicantId: restrictedCase.applicant_id, category }
        );
        const reason = restrictedCase.case_reason === "noun"
          ? "Administrator-approved NOUN eligibility case."
          : restrictedCase.case_reason === "nigerian_part_time"
            ? "Nigerian part-time applicant; administrator-approved exclusion."
            : "Full-time applicant over 30 at graduation; administrator-approved exemption.";
        if (existingRecords[0]) {
          await connection.execute(
            `UPDATE restricted_category_records
             SET fee_amount=:fee, reason=:reason, assigned_by=:adminId, updated_at=CURRENT_TIMESTAMP
             WHERE id=:recordId`,
            { fee: feeAmount, reason, adminId: req.session.user.id, recordId: existingRecords[0].id }
          );
        } else {
          await connection.execute(
            `INSERT INTO restricted_category_records (applicant_id, category, fee_amount, reason, assigned_by)
             VALUES (:applicantId, :category, :fee, :reason, :adminId)`,
            { applicantId: restrictedCase.applicant_id, category, fee: feeAmount, reason, adminId: req.session.user.id }
          );
        }
      }

      await connection.execute(
        `UPDATE restricted_category_requests
         SET status=:status, category=:category, admin_notes=:notes,
             assigned_by=:adminId, decided_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
         WHERE id=:requestId`,
        {
          status: action === "approve" ? "approved" : "rejected",
          category,
          notes,
          adminId: req.session.user.id,
          requestId,
        }
      );
      await connection.commit();
      await writeAuditLog({
        userId: req.session.user.id,
        action: `restricted_case.${newStatus}`,
        recordType: "restricted_category_requests",
        recordId: requestId,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        newValues: { status: action === "approve" ? "approved" : "rejected", category, feeAmount },
      }).catch(() => {});
      try {
        await queueNotification({
          recipientUserId: restrictedCase.applicant_id,
          recipientEmail: restrictedCase.email,
          templateName: "eligibility_review_decision",
          payload: { approved: action === "approve" },
        });
      } catch (notificationError) {
        console.error("Failed to queue eligibility review notification:", notificationError);
      }
      res.json({
        success: true,
        message: action === "approve"
          ? "Restricted case approved. The applicant can now continue to payment."
          : "Restricted case rejected.",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }
);

router.get("/admin/payments", async (req, res, next) => {
  try {
    const status = String(req.query.status || "").trim();
    const params = {};
    let where = "";
    if (["pending_verification","under_review","approved","rejected","correction_required","not_paid"].includes(status)) {
      where = "WHERE p.status=:status";
      params.status = status;
    }
    const [rows] = await db.execute(
      `SELECT p.id, p.applicant_reference, p.amount_expected, p.amount_submitted,
              p.payment_date, p.channel, p.transaction_reference, p.status,
              p.duplicate_flag, p.submitted_at, p.internal_notes,
              u.id AS applicant_id, u.full_name, u.email, u.phone,
              e.nationality, e.institution_name,
              d.id AS receipt_document_id, d.original_filename, d.mime_type
       FROM payments p
       JOIN users u ON u.id=p.applicant_id
       JOIN eligibility_screenings e ON e.id=p.eligibility_id
       LEFT JOIN documents d ON d.id=p.receipt_document_id
       ${where}
       ORDER BY p.submitted_at DESC
       LIMIT 100`,
      params
    );
    res.json({ success: true, payments: rows });
  } catch (error) {
    next(error);
  }
});

router.get("/admin/payments/:paymentId/receipt", async (req, res, next) => {
  try {
    const paymentId = Number(req.params.paymentId);
    if (!Number.isInteger(paymentId) || paymentId < 1) throw new AppError("Invalid payment.", 400, "INVALID_PAYMENT");
    const [rows] = await db.execute(
      `SELECT d.relative_path, d.original_filename, d.mime_type
       FROM payments p
       JOIN documents d ON d.id=p.receipt_document_id
       WHERE p.id=:paymentId`,
      { paymentId }
    );
    if (!rows[0]) throw new AppError("Receipt not found.", 404, "RECEIPT_NOT_FOUND");
    const absolutePath = path.resolve(PRIVATE_STORAGE_ROOT, rows[0].relative_path);
    if (!absolutePath.startsWith(`${PRIVATE_STORAGE_ROOT}${path.sep}`)) {
      throw new AppError("Invalid document path.", 403, "INVALID_DOCUMENT_PATH");
    }
    if (!fs.existsSync(absolutePath)) throw new AppError("Receipt file is unavailable.", 404, "FILE_NOT_FOUND");
    res.setHeader("Content-Type", rows[0].mime_type);
    res.setHeader("Content-Disposition", `inline; filename="${path.basename(rows[0].original_filename).replace(/["\r\n]/g, "")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.sendFile(absolutePath);
  } catch (error) {
    next(error);
  }
});

router.post(
  "/admin/payments/:paymentId/action",
  [
    body("action").isIn(["approve","reject","correction_required"]),
    body("reason").optional({ checkFalsy: true }).trim().isLength({ max: 2000 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new AppError("Please correct the action fields.", 422, "VALIDATION_ERROR", errors.mapped());
      const paymentId = Number(req.params.paymentId);
      if (!Number.isInteger(paymentId) || paymentId < 1) throw new AppError("Invalid payment.", 400, "INVALID_PAYMENT");

      const [payments] = await db.execute(
        `SELECT p.id, p.applicant_id, p.status, p.applicant_reference,
                p.amount_expected, p.amount_submitted, p.transaction_reference,
                u.full_name, u.email
         FROM payments p JOIN users u ON u.id=p.applicant_id
         WHERE p.id=:paymentId`,
        { paymentId }
      );
      if (!payments[0]) throw new AppError("Payment not found.", 404, "PAYMENT_NOT_FOUND");

      const payment = payments[0];
      const action = req.body.action;
      const reason = String(req.body.reason || "").trim() || null;
      const newStatus =
        action === "approve" ? "approved" :
        action === "reject" ? "rejected" : "correction_required";

      if (action === "approve" && ["rejected","correction_required"].includes(payment.status)) {
        throw new AppError("This payment cannot be approved from its current status.", 409, "INVALID_PAYMENT_TRANSITION");
      }
      if (action === "approve") {
        const [approved] = await db.execute(
          "SELECT id FROM payments WHERE applicant_id=:applicantId AND status='approved' AND id<>:paymentId LIMIT 1",
          { applicantId: payment.applicant_id, paymentId }
        );
        if (approved.length) throw new AppError("Applicant already has an approved payment.", 409, "PAYMENT_ALREADY_APPROVED");
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          `UPDATE payments
           SET status=:newStatus, internal_notes=:reason, verified_by=:adminId,
               verified_at=CURRENT_TIMESTAMP
           WHERE id=:paymentId`,
          { newStatus, reason, adminId: req.session.user.id, paymentId }
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      await writeAuditLog({
        userId: req.session.user.id,
        action: `payment.${action}`,
        recordType: "payments",
        recordId: paymentId,
        previousValues: { status: payment.status },
        newValues: { status: newStatus, reason },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      }).catch(() => {});

      const templateName =
        action === "approve" ? "payment_approved" :
        action === "reject" ? "payment_rejected" : "correction_requested";
      try {
        await queueNotification({
          recipientUserId: payment.applicant_id,
          recipientEmail: payment.email,
          templateName,
          payload: { reason, applicantName: payment.full_name },
        });
      } catch (notificationError) {
        console.error("Failed to queue payment status notification:", notificationError);
      }

      res.json({
        success: true,
        message: `Payment ${action === "approve" ? "approved" : action === "reject" ? "rejected" : "marked for correction"}.`,
        status: newStatus,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
