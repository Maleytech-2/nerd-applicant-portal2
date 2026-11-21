const crypto = require("crypto");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const express = require("express");
const multer = require("multer");
const db = require("../config/database");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const { AppError } = require("../middleware/errorHandler");
const { writeAuditLog } = require("../middleware/audit");
const { isAllowedApplicationDocument } = require("../utils/applicationDocumentTypes");

const router = express.Router();
const storageRoot = path.resolve(
  process.env.PRIVATE_STORAGE_ROOT ||
  path.join(__dirname, "..", "..", "storage", "private")
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MAX_APPLICATION_UPLOAD_BYTES || 10485760),
    files: 1,
  },
});

const allowedCategories = new Set([
  "passport_photo",
  "means_of_identification",
  "institutional_attestation",
  "full_project",
  "signed_certification",
]);

function detectMime(buffer) {
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x25, 0x50, 0x44, 0x46]))) {
    return "application/pdf";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "image/jpeg";
  }
  if (buffer.length >= 4 &&
      buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    const zipNames = buffer.toString("latin1");
    if (
      zipNames.includes("[Content_Types].xml") &&
      zipNames.includes("word/")
    ) {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
  }
  return null;
}

function uploadMiddleware(req, res, next) {
  upload.single("document")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return next(new AppError("The document exceeds the allowed file size.", 413, "FILE_TOO_LARGE"));
    }
    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return next(new AppError("Exactly one document is required.", 422, "DOCUMENT_UPLOAD_FAILED"));
    }
    return next(new AppError("The document could not be uploaded.", 422, "DOCUMENT_UPLOAD_FAILED"));
  });
}

async function storeDocument(applicantId, category, file) {
  await fsPromises.mkdir(storageRoot, { recursive: true, mode: 0o700 });
  const directory = path.join(storageRoot, "applications", String(applicantId), category);
  await fsPromises.mkdir(directory, { recursive: true, mode: 0o700 });

  const mimeType = detectMime(file.buffer);
  if (!mimeType || !isAllowedApplicationDocument(category, mimeType)) {
    throw new AppError("The file content is not valid for this document category.", 422, "INVALID_DOCUMENT_TYPE");
  }

  const extension =
    mimeType === "application/pdf" ? "pdf" :
    mimeType === "image/png" ? "png" :
    mimeType === "image/jpeg" ? "jpg" : "docx";
  const storedFilename = `${crypto.randomUUID()}.${extension}`;
  const absolutePath = path.join(directory, storedFilename);
  await fsPromises.writeFile(absolutePath, file.buffer, { flag: "wx", mode: 0o600 });

  return {
    absolutePath,
    relativePath: path.relative(storageRoot, absolutePath).split(path.sep).join("/"),
    storedFilename,
    originalFilename: path.basename(file.originalname).slice(0, 255),
    mimeType,
    fileSize: file.buffer.length,
    fileHash: crypto.createHash("sha256").update(file.buffer).digest("hex"),
  };
}

async function removeStoredFile(relativePath) {
  if (!relativePath) return;
  const absolutePath = path.resolve(storageRoot, relativePath);
  if (!absolutePath.startsWith(`${storageRoot}${path.sep}`)) return;
  await fsPromises.unlink(absolutePath).catch(() => {});
}

router.get("/application/documents", requireAuth, requireRole("applicant"), async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT d.id, d.category, d.original_filename, d.mime_type, d.file_size,
              d.file_hash, d.uploaded_at, d.is_current
       FROM documents d
       WHERE d.applicant_id=:applicantId
         AND d.category IN (
           'passport_photo','means_of_identification','institutional_attestation',
           'full_project','signed_certification'
         )
       ORDER BY d.uploaded_at DESC`,
      { applicantId: req.session.user.id }
    );
    res.json({ success: true, documents: rows });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/application/documents/:category",
  requireAuth,
  requireRole("applicant"),
  uploadMiddleware,
  async (req, res, next) => {
    let storedPath = null;
    try {
      const category = req.params.category;
      if (!allowedCategories.has(category)) {
        throw new AppError("Invalid document category.", 400, "INVALID_DOCUMENT_CATEGORY");
      }
      if (!req.file) {
        throw new AppError("A document is required.", 422, "DOCUMENT_REQUIRED");
      }

      const [applications] = await db.execute(
        `SELECT id, status FROM applications WHERE applicant_id=:applicantId LIMIT 1`,
        { applicantId: req.session.user.id }
      );
      if (!applications[0] || !["draft", "correction_required"].includes(applications[0].status)) {
        throw new AppError("The document cannot be changed in the application's current status.", 409, "DOCUMENT_LOCKED");
      }

      if (applications[0].status === "correction_required") {
        const [corrections] = await db.execute(
          `SELECT authorized_document_categories
           FROM application_corrections
           WHERE application_id=:applicationId
             AND status='open'
           ORDER BY created_at DESC LIMIT 1`,
          { applicationId: applications[0].id }
        );
        const categories = corrections[0]?.authorized_document_categories;
        let authorizedCategories = categories;
        if (typeof authorizedCategories === "string") {
          try {
            authorizedCategories = JSON.parse(authorizedCategories);
          } catch (_error) {
            authorizedCategories = [];
          }
        }
        if (!Array.isArray(authorizedCategories) || !authorizedCategories.includes(category)) {
          throw new AppError("This document was not authorized for correction.", 403, "DOCUMENT_CORRECTION_NOT_AUTHORIZED");
        }
      }

      const stored = await storeDocument(req.session.user.id, category, req.file);
      storedPath = stored.relativePath;
      const connection = await db.getConnection();
      let documentId;
      try {
        await connection.beginTransaction();
        const [inserted] = await connection.execute(
          `INSERT INTO documents (
             applicant_id, uploader_id, category, original_filename, stored_filename,
             relative_path, mime_type, file_size, file_hash, is_current
           ) VALUES (
             :applicantId, :uploaderId, :category, :originalFilename, :storedFilename,
             :relativePath, :mimeType, :fileSize, :fileHash, TRUE
           )`,
          {
            applicantId: req.session.user.id,
            uploaderId: req.session.user.id,
            category,
            originalFilename: stored.originalFilename,
            storedFilename: stored.storedFilename,
            relativePath: stored.relativePath,
            mimeType: stored.mimeType,
            fileSize: stored.fileSize,
            fileHash: stored.fileHash,
          }
        );
        documentId = inserted.insertId;
        const [previous] = await connection.execute(
          `SELECT id FROM documents
           WHERE applicant_id=:applicantId
             AND category=:category
             AND is_current=TRUE
             AND id<>:documentId
           LIMIT 1`,
          { applicantId: req.session.user.id, category, documentId }
        );
        if (previous[0]) {
          await connection.execute(
            `UPDATE documents
             SET is_current=FALSE, replaced_by_document_id=:documentId
             WHERE id=:previousId`,
            { documentId, previousId: previous[0].id }
          );
        }

        await connection.execute(
          `INSERT INTO application_documents (application_id, document_id, field_name)
           VALUES (:applicationId, :documentId, :fieldName)
           ON DUPLICATE KEY UPDATE document_id=VALUES(document_id)`,
          {
            applicationId: applications[0].id,
            documentId,
            fieldName: category,
          }
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        await removeStoredFile(storedPath);
        throw error;
      } finally {
        connection.release();
      }

      await writeAuditLog({
        userId: req.session.user.id,
        action: "document.uploaded",
        recordType: "documents",
        recordId: documentId,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        newValues: { category, originalFilename: stored.originalFilename },
      }).catch(() => {});
      res.status(201).json({ success: true, message: "Document uploaded securely.", documentId });
    } catch (error) {
      next(error);
    }
  }
);

async function authorizeDocumentDownload(req, documentId) {
  const [rows] = await db.execute(
    `SELECT d.*, u.role_id,
            r.name AS role_name
     FROM documents d
     JOIN users u ON u.id=d.applicant_id
     JOIN roles r ON r.id=u.role_id
     WHERE d.id=:documentId`,
    { documentId }
  );
  if (!rows[0]) throw new AppError("Document not found.", 404, "DOCUMENT_NOT_FOUND");
  const document = rows[0];
  const requester = req.session.user;
  if (requester.role === "administrator") return document;
  if (requester.role === "applicant" && document.applicant_id === requester.id) return document;
  if (requester.role === "staff") {
    const [permissions] = await db.execute(
      `SELECT p.name
       FROM role_permissions rp
       JOIN permissions p ON p.id=rp.permission_id
       JOIN users u ON u.role_id=rp.role_id
       WHERE u.id=:userId AND p.name='documents.view'
       UNION
       SELECT p.name
       FROM user_permissions up
       JOIN permissions p ON p.id=up.permission_id
       WHERE up.user_id=:userId
         AND up.is_granted=TRUE
         AND p.name='documents.view'`,
      { userId: requester.id }
    );
    if (permissions.length) return document;
  }
  throw new AppError("You are not authorized to access this document.", 403, "DOCUMENT_FORBIDDEN");
}

router.get("/documents/:documentId", requireAuth, async (req, res, next) => {
  try {
    const documentId = Number(req.params.documentId);
    if (!Number.isInteger(documentId) || documentId < 1) {
      throw new AppError("Invalid document.", 400, "INVALID_DOCUMENT");
    }
    const document = await authorizeDocumentDownload(req, documentId);
    if (document.category === "official_clearance" && req.session.user.role !== "administrator" &&
        document.applicant_id !== req.session.user.id) {
      throw new AppError("You are not authorized to access this clearance.", 403, "CLEARANCE_FORBIDDEN");
    }
    const absolutePath = path.resolve(storageRoot, document.relative_path);
    if (!absolutePath.startsWith(`${storageRoot}${path.sep}`)) {
      throw new AppError("Invalid document path.", 403, "INVALID_DOCUMENT_PATH");
    }
    if (!fs.existsSync(absolutePath)) throw new AppError("Document file is unavailable.", 404, "FILE_NOT_FOUND");

    const mode = String(req.query.mode || "download").toLowerCase();
    res.setHeader("Content-Type", document.mime_type);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Disposition",
      `${mode === "preview" ? "inline" : "attachment"}; filename="${path.basename(document.original_filename).replace(/["\r\n]/g, "")}"`
    );
    res.sendFile(absolutePath);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
