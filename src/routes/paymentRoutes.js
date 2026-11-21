const express = require("express");
const multer = require("multer");
const { body, validationResult } = require("express-validator");
const db = require("../config/database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { AppError } = require("../middleware/errorHandler");
const { writeAuditLog } = require("../middleware/audit");
const { calculateFullTimeFee } = require("../services/eligibilityService");
const {
  createReceiptHash,
  storePrivateReceipt,
  removeStoredFile,
} = require("../services/paymentService");
const { queueNotification } = require("../services/emailService");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 10485760),
    files: 1,
  },
});

router.use("/payment", requireAuth, requireRole("applicant"));

function receiptUpload(req, res, next) {
  upload.single("receipt")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return next(new AppError("The receipt exceeds the allowed file size.", 413, "FILE_TOO_LARGE"));
    }
    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return next(new AppError("Exactly one payment receipt is required.", 422, "INVALID_RECEIPT_FIELD"));
    }
    return next(new AppError("The receipt could not be uploaded.", 422, "RECEIPT_UPLOAD_FAILED"));
  });
}

router.get("/payment", async (req, res, next) => {
  try {
    const [screenings] = await db.execute(
      `SELECT id, nationality, is_eligible, expected_fee_amount
       FROM eligibility_screenings
       WHERE applicant_id = :applicantId
       LIMIT 1`,
      { applicantId: req.session.user.id }
    );
    if (!screenings[0]?.is_eligible) {
      throw new AppError("A successful eligibility screening is required before payment.", 403, "ELIGIBILITY_REQUIRED");
    }

    const expectedFee = Number(screenings[0].expected_fee_amount ?? calculateFullTimeFee(screenings[0].nationality));
    if (!Number.isFinite(expectedFee) || expectedFee <= 0) {
      throw new AppError("The applicable payment fee has not been configured.", 500, "INVALID_PAYMENT_FEE");
    }
    const [payments] = await db.execute(
      `SELECT id, applicant_reference, amount_expected, amount_submitted, payment_date,
              channel, transaction_reference, status, duplicate_flag, submitted_at
       FROM payments
       WHERE applicant_id = :applicantId
       ORDER BY submitted_at DESC
       LIMIT 1`,
      { applicantId: req.session.user.id }
    );

    res.json({
      success: true,
      paymentChannels: {
        palmpay: { accountNumber: "8138048059", accountName: "Bartholomew John" },
        access_bank: { accountNumber: "1500770181", accountName: "Bartholomew John" },
      },
      expectedFee,
      nationality: screenings[0].nationality,
      payment: payments[0] || null,
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/payment",
  receiptUpload,
  [
    body("amountPaid").isFloat({ gt: 0 }).toFloat(),
    body("paymentDate").isISO8601({ strict: true }).withMessage("Enter a valid payment date."),
    body("channel").isIn(["palmpay", "access_bank"]),
    body("transactionReference").trim().isLength({ min: 4, max: 100 }),
  ],
  async (req, res, next) => {
    let storedPath = null;
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError("Please correct the highlighted payment fields.", 422, "VALIDATION_ERROR", errors.mapped());
      }
      if (!req.file) {
        throw new AppError("A payment receipt is required.", 422, "RECEIPT_REQUIRED");
      }

      const [applications] = await db.execute(
        "SELECT id FROM applications WHERE applicant_id=:applicantId LIMIT 1",
        { applicantId: req.session.user.id }
      );
      if (applications.length) {
        throw new AppError(
          "Your registration is already in progress or submitted. You cannot start another registration; wait for the administrator to upload your clearance slip.",
          409,
          "REGISTRATION_ALREADY_STARTED"
        );
      }

      const [screenings] = await db.execute(
        `SELECT id, nationality, is_eligible, expected_fee_amount
         FROM eligibility_screenings
         WHERE applicant_id = :applicantId
         LIMIT 1`,
        { applicantId: req.session.user.id }
      );
      if (!screenings[0]?.is_eligible) {
        throw new AppError("A successful eligibility screening is required before payment.", 403, "ELIGIBILITY_REQUIRED");
      }

      const expectedFee = Number(screenings[0].expected_fee_amount ?? calculateFullTimeFee(screenings[0].nationality));
      if (!Number.isFinite(expectedFee) || expectedFee <= 0) {
        throw new AppError("The applicable payment fee has not been configured.", 500, "INVALID_PAYMENT_FEE");
      }
      const submittedAmount = Number(req.body.amountPaid);
      const transactionReference = req.body.transactionReference.trim();
      const receiptHash = createReceiptHash(req.file.buffer);

      const [existingReferences] = await db.execute(
        "SELECT id FROM payments WHERE transaction_reference = :transactionReference LIMIT 1",
        { transactionReference }
      );
      if (existingReferences.length) {
        throw new AppError("This transaction reference has already been submitted.", 409, "DUPLICATE_TRANSACTION_REFERENCE");
      }

      const [existingReceipts] = await db.execute(
        `SELECT id, applicant_id
         FROM payments
         WHERE receipt_file_hash = :receiptHash
         LIMIT 1`,
        { receiptHash }
      );

      let storedReceipt;
      try {
        storedReceipt = await storePrivateReceipt({
          applicantId: req.session.user.id,
          buffer: req.file.buffer,
          originalFilename: req.file.originalname,
        });
      } catch (error) {
        throw new AppError(error.message, 422, "INVALID_RECEIPT");
      }
      storedPath = storedReceipt.relativePath;

      const [existingPayments] = await db.execute(
        "SELECT id FROM payments WHERE applicant_id = :applicantId AND status = 'approved' LIMIT 1",
        { applicantId: req.session.user.id }
      );
      if (existingPayments.length) {
        await removeStoredFile(storedPath);
        throw new AppError("An approved payment already exists for this applicant.", 409, "PAYMENT_ALREADY_APPROVED");
      }

      let status = "pending_verification";
      if (submittedAmount < expectedFee) status = "rejected";
      if (submittedAmount > expectedFee) status = "under_review";

      const applicantReference = `NERD-${new Date().getUTCFullYear()}-${String(req.session.user.id).padStart(6, "0")}`;
      const connection = await db.getConnection();
      let paymentId;
      try {
        await connection.beginTransaction();

        const [documentResult] = await connection.execute(
          `INSERT INTO documents (
             applicant_id, uploader_id, category, original_filename, stored_filename,
             relative_path, mime_type, file_size, file_hash, is_current
           ) VALUES (
             :applicantId, :uploaderId, 'payment_receipt', :originalFilename, :storedFilename,
             :relativePath, :mimeType, :fileSize, :fileHash, TRUE
           )`,
          {
            applicantId: req.session.user.id,
            uploaderId: req.session.user.id,
            originalFilename: storedReceipt.originalFilename,
            storedFilename: storedReceipt.storedFilename,
            relativePath: storedReceipt.relativePath,
            mimeType: storedReceipt.mimeType,
            fileSize: storedReceipt.fileSize,
            fileHash: receiptHash,
          }
        );

        const [paymentResult] = await connection.execute(
          `INSERT INTO payments (
             applicant_id, eligibility_id, applicant_reference, amount_expected,
             amount_submitted, payment_date, channel, transaction_reference,
             receipt_document_id, receipt_file_hash, status,
             duplicate_flag, duplicate_match_payment_id
           ) VALUES (
             :applicantId, :eligibilityId, :applicantReference, :expectedFee,
             :submittedAmount, :paymentDate, :channel, :transactionReference,
             :receiptDocumentId, :receiptHash, :status,
             :duplicateFlag, :duplicateMatchPaymentId
           )`,
          {
            applicantId: req.session.user.id,
            eligibilityId: screenings[0].id,
            applicantReference,
            expectedFee,
            submittedAmount,
            paymentDate: req.body.paymentDate,
            channel: req.body.channel,
            transactionReference,
            receiptDocumentId: documentResult.insertId,
            receiptHash,
            status,
            duplicateFlag: existingReceipts.length > 0,
            duplicateMatchPaymentId: existingReceipts[0]?.id || null,
          }
        );
        paymentId = paymentResult.insertId;
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        await removeStoredFile(storedPath);
        if (error.code === "ER_DUP_ENTRY") {
          throw new AppError("This transaction reference or receipt submission is already reserved.", 409, "DUPLICATE_PAYMENT");
        }
        throw error;
      } finally {
        connection.release();
      }

      try {
        const [notificationSettings] = await db.execute(
          `SELECT setting_value
           FROM system_settings
           WHERE setting_key='admin_notification_email' AND is_sensitive=FALSE
           LIMIT 1`
        );
        const notificationEmail = notificationSettings[0]?.setting_value?.trim()
          || process.env.ADMIN_NOTIFICATION_EMAIL?.trim();
        if (!notificationEmail) {
          throw new Error("Payment notification email is not configured.");
        }
        await queueNotification({
          recipientEmail: notificationEmail,
          templateName: "new_payment_claim",
          payload: {
            applicantName: req.session.user.fullName,
            applicantReference,
            email: req.session.user.email,
            phone: req.session.user.phone,
            nationality: screenings[0].nationality,
            amountSubmitted: submittedAmount,
            expectedAmount: expectedFee,
            paymentChannel: req.body.channel,
            transactionReference,
            paymentDate: req.body.paymentDate,
            submittedAt: new Date().toISOString(),
          },
        });
      } catch (notificationError) {
        console.error("Failed to queue payment notification:", notificationError);
      }

      try {
        await queueNotification({
          recipientUserId: req.session.user.id,
          recipientEmail: req.session.user.email,
          templateName: "payment_received",
          payload: {
            status,
            transactionReference,
          },
        });
      } catch (notificationError) {
        console.error("Failed to queue applicant payment notification:", notificationError);
      }

      await writeAuditLog({
        userId: req.session.user.id,
        action: "payment.submitted",
        recordType: "payments",
        recordId: paymentId,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        newValues: {
          status,
          amountExpected: expectedFee,
          amountSubmitted: submittedAmount,
          channel: req.body.channel,
          transactionReference,
          duplicateReceipt: existingReceipts.length > 0,
        },
      }).catch(() => {});

      const messages = {
        rejected: "The submitted amount is below the required fee. This claim was rejected.",
        under_review: "The submitted amount is above the required fee and is under review.",
        pending_verification: "Payment received. Your claim is pending administrator verification.",
      };
      res.status(201).json({
        success: true,
        message: messages[status],
        status,
        duplicateReceiptFlagged: existingReceipts.length > 0,
        paymentId,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
