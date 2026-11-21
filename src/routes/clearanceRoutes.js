const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const db = require("../config/database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { AppError } = require("../middleware/errorHandler");
const { writeAuditLog } = require("../middleware/audit");
const { queueNotification } = require("../services/emailService");

const router = express.Router();
const storageRoot = path.resolve(
  process.env.PRIVATE_STORAGE_ROOT ||
  path.join(__dirname, "..", "..", "storage", "private")
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_CLEARANCE_UPLOAD_BYTES || 20971520), files: 1 },
});

function clearanceUpload(req, res, next) {
  upload.single("clearance")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return next(new AppError("The clearance PDF exceeds the allowed file size.", 413, "FILE_TOO_LARGE"));
    }
    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return next(new AppError("Exactly one clearance PDF is required.", 422, "CLEARANCE_UPLOAD_FAILED"));
    }
    return next(new AppError("The clearance PDF could not be uploaded.", 422, "CLEARANCE_UPLOAD_FAILED"));
  });
}

function isPdf(buffer) {
  return buffer.length >= 5 &&
    buffer.subarray(0, 5).equals(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]));
}

router.get("/admin/clearances", requireAuth, requireRole("administrator"), async (_req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT c.id AS clearance_id, c.status AS clearance_status, c.uploaded_at,
              a.id AS application_id, a.application_reference, a.status AS application_status,
              u.id AS applicant_id, u.full_name, u.email,
              d.id AS document_id, d.original_filename
       FROM clearances c
       JOIN applications a ON a.id=c.application_id
       JOIN users u ON u.id=a.applicant_id
       JOIN documents d ON d.id=c.document_id
       ORDER BY c.uploaded_at DESC
       LIMIT 100`
    );
    res.json({ success: true, clearances: rows });
  } catch (error) {
    next(error);
  }
});

router.get("/admin/clearance-candidates", requireAuth, requireRole("administrator"), async (_req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT a.id, a.application_reference, a.status,
              a.first_name, a.middle_name, a.surname, u.full_name
       FROM applications a
       JOIN users u ON u.id=a.applicant_id
       WHERE a.status NOT IN ('draft', 'correction_required')
       ORDER BY a.submitted_at DESC, a.updated_at DESC
       LIMIT 500`
    );
    res.json({ success: true, applications: rows });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/admin/applications/:applicationId/clearance",
  requireAuth,
  requireRole("administrator"),
  clearanceUpload,
  async (req, res, next) => {
    let storedRelativePath = null;
    const connection = await db.getConnection();
    try {
      const applicationId = Number(req.params.applicationId);
      if (!Number.isInteger(applicationId) || applicationId < 1) {
        throw new AppError("Invalid application.", 400, "INVALID_APPLICATION");
      }
      if (!req.file) throw new AppError("A clearance PDF is required.", 422, "CLEARANCE_REQUIRED");
      if (!isPdf(req.file.buffer)) {
        throw new AppError("The clearance must be a valid PDF file.", 422, "INVALID_CLEARANCE_PDF");
      }

      await connection.beginTransaction();
      const [applications] = await connection.execute(
        `SELECT a.id, a.application_reference, a.applicant_id, a.status,
                u.full_name, u.email
         FROM applications a
         JOIN users u ON u.id=a.applicant_id
         WHERE a.id=:applicationId
         LIMIT 1`,
        { applicationId }
      );
      if (!applications[0]) throw new AppError("Application not found.", 404, "APPLICATION_NOT_FOUND");
      const application = applications[0];
      if (["draft", "correction_required"].includes(application.status)) {
        throw new AppError("The application must be submitted and complete before uploading the clearance slip.", 409, "APPLICATION_NOT_READY_FOR_CLEARANCE");
      }

      const directory = path.join(
        storageRoot,
        "clearances",
        String(application.applicant_id)
      );
      await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
      const storedFilename = `${crypto.randomUUID()}.pdf`;
      const absolutePath = path.join(directory, storedFilename);
      await fs.promises.writeFile(absolutePath, req.file.buffer, { flag: "wx", mode: 0o600 });
      storedRelativePath = path.relative(storageRoot, absolutePath).split(path.sep).join("/");
      const fileHash = crypto.createHash("sha256").update(req.file.buffer).digest("hex");

      const [documentResult] = await connection.execute(
        `INSERT INTO documents (
           applicant_id, uploader_id, category, original_filename, stored_filename,
           relative_path, mime_type, file_size, file_hash, is_current
         ) VALUES (
           :applicantId, :uploaderId, 'official_clearance', :originalFilename, :storedFilename,
           :relativePath, 'application/pdf', :fileSize, :fileHash, TRUE
         )`,
        {
          applicantId: application.applicant_id,
          uploaderId: req.session.user.id,
          originalFilename: path.basename(req.file.originalname).slice(0, 255),
          storedFilename,
          relativePath: storedRelativePath,
          fileSize: req.file.buffer.length,
          fileHash,
        }
      );

      const [oldClearances] = await connection.execute(
        `SELECT id, document_id
         FROM clearances
         WHERE application_id=:applicationId AND status='available'
         ORDER BY uploaded_at DESC LIMIT 1`,
        { applicationId }
      );
      let clearanceId;
      const [clearanceResult] = await connection.execute(
        `INSERT INTO clearances (
           application_id, document_id, uploaded_by, status, uploaded_at
         ) VALUES (
           :applicationId, :documentId, :uploadedBy, 'available', CURRENT_TIMESTAMP
         )`,
        {
          applicationId,
          documentId: documentResult.insertId,
          uploadedBy: req.session.user.id,
        }
      );
      clearanceId = clearanceResult.insertId;

      if (oldClearances[0]) {
        await connection.execute(
          `UPDATE clearances
           SET status='replaced', replaced_by_clearance_id=:replacementId
           WHERE id=:oldId`,
          { replacementId: clearanceId, oldId: oldClearances[0].id }
        );
        await connection.execute(
          `UPDATE documents
           SET is_current=FALSE, replaced_by_document_id=:documentId
           WHERE id=:oldDocumentId`,
          { documentId: documentResult.insertId, oldDocumentId: oldClearances[0].document_id }
        );
      }

      await connection.execute(
        `UPDATE applications
         SET status='clearance_available', updated_at=CURRENT_TIMESTAMP
         WHERE id=:applicationId`,
        { applicationId }
      );
      await connection.commit();

      await writeAuditLog({
        userId: req.session.user.id,
        action: oldClearances[0] ? "clearance.replaced" : "clearance.uploaded",
        recordType: "clearances",
        recordId: clearanceId,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        previousValues: oldClearances[0] ? { clearanceId: oldClearances[0].id } : null,
        newValues: {
          clearanceId,
          applicationId,
          applicationReference: application.application_reference,
        },
      }).catch(() => {});

      try {
        await queueNotification({
          recipientUserId: application.applicant_id,
          recipientEmail: application.email,
          templateName: "clearance_available",
          payload: { applicationReference: application.application_reference },
        });
      } catch (notificationError) {
        console.error("Failed to queue clearance notification:", notificationError);
      }

      res.status(201).json({
        success: true,
        message: oldClearances[0] ? "Clearance replaced successfully." : "Clearance uploaded successfully.",
        clearanceId,
        documentId: documentResult.insertId,
      });
    } catch (error) {
      await connection.rollback();
      if (storedRelativePath) {
        const absolutePath = path.resolve(storageRoot, storedRelativePath);
        if (absolutePath.startsWith(`${storageRoot}${path.sep}`)) {
          await fs.promises.unlink(absolutePath).catch(() => {});
        }
      }
      next(error);
    } finally {
      connection.release();
    }
  }
);

async function getApplicantClearance(applicantId) {
  const [rows] = await db.execute(
    `SELECT c.id AS clearance_id, c.uploaded_at,
            d.id AS document_id, d.relative_path, d.original_filename,
            d.mime_type
     FROM clearances c
     JOIN applications a ON a.id=c.application_id
     JOIN documents d ON d.id=c.document_id
     WHERE a.applicant_id=:applicantId
       AND c.status='available'
       AND d.is_current=TRUE
     ORDER BY c.uploaded_at DESC
     LIMIT 1`,
    { applicantId }
  );
  return rows[0] || null;
}

router.get("/applicant/clearance/status", requireAuth, requireRole("applicant"), async (req, res, next) => {
  try {
    const clearance = await getApplicantClearance(req.session.user.id);
    res.json({
      success: true,
      available: Boolean(clearance),
      clearance: clearance
        ? { clearanceId: clearance.clearance_id, uploadedAt: clearance.uploaded_at, documentId: clearance.document_id }
        : null,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/applicant/clearance/:mode", requireAuth, requireRole("applicant"), async (req, res, next) => {
  try {
    const mode = String(req.params.mode || "").toLowerCase();
    if (!["view", "download", "print"].includes(mode)) {
      throw new AppError("Invalid clearance mode.", 400, "INVALID_CLEARANCE_MODE");
    }
    const clearance = await getApplicantClearance(req.session.user.id);
    if (!clearance) throw new AppError("No clearance is available.", 404, "CLEARANCE_NOT_FOUND");

    const absolutePath = path.resolve(storageRoot, clearance.relative_path);
    if (!absolutePath.startsWith(`${storageRoot}${path.sep}`) || !fs.existsSync(absolutePath)) {
      throw new AppError("Clearance file is unavailable.", 404, "CLEARANCE_FILE_NOT_FOUND");
    }

    const safeName = path.basename(clearance.original_filename).replace(/["\r\n]/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Disposition",
      mode === "download" ? `attachment; filename="${safeName}"` : `inline; filename="${safeName}"`
    );
    res.sendFile(absolutePath);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
