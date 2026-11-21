const express = require("express");
const { body, validationResult } = require("express-validator");
const db = require("../config/database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { AppError } = require("../middleware/errorHandler");
const { writeAuditLog } = require("../middleware/audit");
const { getSmtpConfiguration, verifySmtpConfiguration } = require("../services/emailService");
const { encryptSmtpCredentials } = require("../utils/smtpCredentials");

const router = express.Router();

router.use(["/admin/audit-logs", "/admin/settings"], requireAuth, requireRole("administrator"));

router.get("/admin/audit-logs", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(10, Number(req.query.limit || 25)));
    const offset = (page - 1) * limit;
    const params = { limit, offset };
    const conditions = [];

    if (req.query.action) {
      params.action = `%${String(req.query.action).replace(/[%_\\]/g, "\\$&")}%`;
      conditions.push("al.action LIKE :action ESCAPE '\\\\'");
    }
    if (req.query.recordType) {
      params.recordType = String(req.query.recordType);
      conditions.push("al.record_type=:recordType");
    }
    if (req.query.recordId) {
      params.recordId = Number(req.query.recordId);
      if (!Number.isInteger(params.recordId)) throw new AppError("Record ID must be numeric.", 400, "INVALID_RECORD_ID");
      conditions.push("al.record_id=:recordId");
    }
    if (req.query.from) {
      params.from = String(req.query.from);
      conditions.push("al.created_at>=:from");
    }
    if (req.query.to) {
      params.to = `${req.query.to} 23:59:59`;
      conditions.push("al.created_at<=:to");
    }
    if (req.query.userId) {
      params.userId = Number(req.query.userId);
      if (!Number.isInteger(params.userId)) throw new AppError("User ID must be numeric.", 400, "INVALID_USER_ID");
      conditions.push("al.user_id=:userId");
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await db.execute(
      `SELECT al.id, al.user_id, u.full_name, u.email,
              al.action, al.record_type, al.record_id,
              al.previous_values, al.new_values,
              al.ip_address, al.user_agent, al.created_at
       FROM audit_logs al
       LEFT JOIN users u ON u.id=al.user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT :limit OFFSET :offset`,
      params
    );
    const [countRows] = await db.execute(
      `SELECT COUNT(*) AS total
       FROM audit_logs al
       LEFT JOIN users u ON u.id=al.user_id
       ${where}`,
      params
    );
    res.json({
      success: true,
      logs: rows,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        pages: Math.ceil(countRows[0].total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/admin/settings", async (_req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, setting_key, setting_value, is_sensitive, updated_at
       FROM system_settings
       ORDER BY setting_key`
    );
    const settings = rows.map((setting) => ({
      id: setting.id,
      key: setting.setting_key,
      value: setting.is_sensitive ? "[Protected]" : setting.setting_value,
      isSensitive: Boolean(setting.is_sensitive),
      updatedAt: setting.updated_at,
    }));
    const smtpConfiguration = await getSmtpConfiguration();
    res.json({
      success: true,
      settings,
      smtpConfigured: Boolean(smtpConfiguration),
      smtpSender: smtpConfiguration ? {
        fromEmail: smtpConfiguration.fromAddress,
        host: smtpConfiguration.host,
        port: smtpConfiguration.port,
        secure: smtpConfiguration.secure,
        user: smtpConfiguration.user,
      } : null,
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/admin/settings/smtp-sender",
  [
    body("smtp").isObject().withMessage("SMTP settings are required."),
    body("smtp.fromEmail").trim().isEmail().isLength({ max: 254 }).withMessage("Enter a valid sender email address."),
    body("smtp.host").trim().isLength({ min: 1, max: 253 })
      .matches(/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/)
      .withMessage("Enter a valid SMTP server hostname."),
    body("smtp.port").isInt({ min: 1, max: 65535 }).withMessage("SMTP port must be between 1 and 65535."),
    body("smtp.secure").custom((value) => [true, false, "true", "false"].includes(value))
      .withMessage("Choose the SMTP encryption setting."),
    body("smtp.user").trim().isLength({ min: 1, max: 254 }).matches(/^[^\s]+$/)
      .withMessage("Enter a valid SMTP username."),
    body("smtp.password").isString().isLength({ min: 1, max: 512 })
      .withMessage("Enter the SMTP password or App Password."),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError("Please provide valid SMTP sender settings.", 422, "VALIDATION_ERROR", errors.mapped());
      }

      const fromEmail = req.body.smtp.fromEmail.trim().toLowerCase();
      const host = req.body.smtp.host.trim().toLowerCase();
      const user = req.body.smtp.user.trim();
      const password = host === "smtp.gmail.com"
        ? req.body.smtp.password.replace(/\s/g, "")
        : req.body.smtp.password.trim();
      if (!password) {
        throw new AppError("Enter the SMTP password or App Password.", 422, "INVALID_SMTP_PASSWORD");
      }
      if (host === "smtp.gmail.com" && user.toLowerCase() !== fromEmail) {
        throw new AppError("For Gmail, the sender email and SMTP username must be the same account.", 422, "GMAIL_SENDER_MISMATCH");
      }
      const configuration = {
        host,
        port: Number(req.body.smtp.port),
        secure: req.body.smtp.secure === true || req.body.smtp.secure === "true",
        user,
        password,
        from: `OGAH JOHN BUSINESS CENTER <${fromEmail}>`,
        fromAddress: fromEmail,
      };

      try {
        await verifySmtpConfiguration(configuration);
      } catch (error) {
        const code = error.code === "EAUTH" ? "SMTP_AUTHENTICATION_FAILED" : "SMTP_VERIFICATION_FAILED";
        const message = error.code === "EAUTH"
          ? "The mail server rejected these credentials. Check the SMTP username and password."
          : "Could not connect to and verify the mail server. Check the host, port, and encryption settings.";
        throw new AppError(message, 422, code);
      }

      const previousConfiguration = await getSmtpConfiguration();
      const encrypted = encryptSmtpCredentials(configuration);
      await db.execute(
        `INSERT INTO system_settings
          (setting_key, setting_value, is_sensitive, updated_by)
         VALUES
          ('smtp_sender_credentials', :value, TRUE, :updatedBy)
         ON DUPLICATE KEY UPDATE
          setting_value=VALUES(setting_value),
          is_sensitive=TRUE,
          updated_by=VALUES(updated_by),
          updated_at=CURRENT_TIMESTAMP`,
        { value: encrypted, updatedBy: req.session.user.id }
      );

      await writeAuditLog({
        userId: req.session.user.id,
        action: "system.smtp_sender_updated",
        recordType: "system_settings",
        recordId: null,
        previousValues: previousConfiguration ? [{
          sender: {
            fromEmail: previousConfiguration.fromAddress,
            host: previousConfiguration.host,
            port: previousConfiguration.port,
            secure: previousConfiguration.secure,
            user: previousConfiguration.user,
          },
        }] : [],
        newValues: [{
          sender: {
            fromEmail,
            host,
            port: configuration.port,
            secure: configuration.secure,
            user,
          },
        }],
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      }).catch(() => {});

      res.json({ success: true, message: "SMTP sender verified and updated." });
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  "/admin/settings",
  [
    body("settings").isArray().withMessage("Settings must be an array."),
  ],
  async (req, res, next) => {
    const connection = await db.getConnection();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError("Please provide valid setting values.", 422, "VALIDATION_ERROR", errors.mapped());
      }
      await connection.beginTransaction();
      const allowedKeys = new Set([
        "business_name",
        "admin_notification_email",
        "registration_available",
        "application_reference_format",
      ]);
      const previous = [];
      for (const setting of req.body.settings) {
        if (!setting || typeof setting.key !== "string" || !allowedKeys.has(setting.key)) {
          throw new AppError("A setting key is not editable.", 400, "SETTING_NOT_EDITABLE");
        }
        if (typeof setting.value !== "string" || setting.value.length > 1000) {
          throw new AppError("Setting values must be strings of 1000 characters or fewer.", 422, "INVALID_SETTING_VALUE");
        }
        let value = setting.value;
        if (setting.key === "admin_notification_email") {
          value = value.trim().toLowerCase();
          if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            throw new AppError("Enter a valid payment notification email address.", 422, "INVALID_NOTIFICATION_EMAIL");
          }
        }
        if (setting.key === "registration_available" && !["true", "false"].includes(value)) {
          throw new AppError("Registration availability must be true or false.", 422, "INVALID_REGISTRATION_SETTING");
        }

        const [existing] = await connection.execute(
          "SELECT setting_value FROM system_settings WHERE setting_key=:key AND is_sensitive=FALSE LIMIT 1",
          { key: setting.key }
        );
        if (!existing[0]) throw new AppError("Setting not found.", 404, "SETTING_NOT_FOUND");
        previous.push({ key: setting.key, oldValue: existing[0].setting_value, newValue: value });
        await connection.execute(
          `UPDATE system_settings
           SET setting_value=:value, updated_by=:updatedBy, updated_at=CURRENT_TIMESTAMP
           WHERE setting_key=:key AND is_sensitive=FALSE`,
          { value, updatedBy: req.session.user.id, key: setting.key }
        );
      }
      await connection.commit();
      await writeAuditLog({
        userId: req.session.user.id,
        action: "system.settings_updated",
        recordType: "system_settings",
        recordId: null,
        previousValues: previous.map((item) => ({ [item.key]: item.oldValue })),
        newValues: previous.map((item) => ({ [item.key]: item.newValue })),
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      }).catch(() => {});
      res.json({ success: true, message: "System settings updated." });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
