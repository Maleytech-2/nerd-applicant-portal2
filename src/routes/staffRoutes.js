const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcrypt");
const { body, validationResult } = require("express-validator");
const db = require("../config/database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { AppError } = require("../middleware/errorHandler");
const { writeAuditLog } = require("../middleware/audit");

const router = express.Router();

router.use("/admin/staff", requireAuth, requireRole("administrator"));

router.get("/admin/staff", async (_req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT u.id, u.full_name, u.email, u.phone, u.is_active,
              u.last_login_at, u.created_at
       FROM users u
       JOIN roles r ON r.id=u.role_id
       WHERE r.name='staff'
       ORDER BY u.created_at DESC`
    );
    const [permissions] = await db.execute(
      `SELECT id, name, description FROM permissions
       WHERE name NOT LIKE 'exemption%'
         AND name NOT LIKE 'exclusion%'
       ORDER BY name`
    );
    const [assignments] = await db.execute(
      `SELECT up.user_id, p.name
       FROM user_permissions up
       JOIN permissions p ON p.id=up.permission_id
       WHERE up.is_granted=TRUE
       ORDER BY up.user_id, p.name`
    );
    res.json({ success: true, staff: rows, permissions, assignments });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/admin/staff",
  [
    body("fullName").trim().isLength({ min: 3, max: 160 }),
    body("email").trim().isEmail().normalizeEmail().isLength({ max: 190 }),
    body("phone").trim().matches(/^\+?[0-9]{7,15}$/),
    body("password").isLength({ min: 4, max: 72 }).matches(/[A-Z]/).matches(/[a-z]/).matches(/[0-9]/),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError("Please correct the staff account fields.", 422, "VALIDATION_ERROR", errors.mapped());
      }
      const [existing] = await db.execute("SELECT id FROM users WHERE email=:email LIMIT 1", { email: req.body.email });
      if (existing.length) throw new AppError("A user already exists with this email.", 409, "EMAIL_EXISTS");
      const [roles] = await db.execute("SELECT id FROM roles WHERE name='staff' LIMIT 1");
      if (!roles[0]) throw new AppError("Staff role is unavailable.", 500, "STAFF_ROLE_MISSING");

      const passwordHash = await bcrypt.hash(req.body.password, 12);
      const [result] = await db.execute(
        `INSERT INTO users (role_id, full_name, email, phone, password_hash, is_active)
         VALUES (:roleId, :fullName, :email, :phone, :passwordHash, TRUE)`,
        {
          roleId: roles[0].id,
          fullName: req.body.fullName,
          email: String(req.body.email).toLowerCase(),
          phone: req.body.phone,
          passwordHash,
        }
      );
      await writeAuditLog({
        userId: req.session.user.id,
        action: "staff.created",
        recordType: "users",
        recordId: result.insertId,
        newValues: { staffId: result.insertId, email: req.body.email },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      }).catch(() => {});
      res.status(201).json({ success: true, message: "Staff account created.", staffId: result.insertId });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/admin/staff/:staffId",
  [
    body("fullName").optional().trim().isLength({ min: 3, max: 160 }),
    body("phone").optional().trim().matches(/^\+?[0-9]{7,15}$/),
    body("isActive").optional().isBoolean(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new AppError("Please correct the staff fields.", 422, "VALIDATION_ERROR", errors.mapped());
      const staffId = Number(req.params.staffId);
      if (!Number.isInteger(staffId) || staffId < 1) throw new AppError("Invalid staff account.", 400, "INVALID_STAFF");
      const [staff] = await db.execute(
        `SELECT u.id, u.full_name, u.phone, u.is_active
         FROM users u JOIN roles r ON r.id=u.role_id
         WHERE u.id=:staffId AND r.name='staff'`,
        { staffId }
      );
      if (!staff[0]) throw new AppError("Staff account not found.", 404, "STAFF_NOT_FOUND");

      await db.execute(
        `UPDATE users
         SET full_name=COALESCE(:fullName, full_name),
             phone=COALESCE(:phone, phone),
             is_active=COALESCE(:isActive, is_active),
             updated_at=CURRENT_TIMESTAMP
         WHERE id=:staffId`,
        {
          staffId,
          fullName: req.body.fullName || null,
          phone: req.body.phone || null,
            isActive: req.body.isActive === undefined
              ? null
              : ["true", true, "1", 1].includes(req.body.isActive),
        }
      );
      await writeAuditLog({
        userId: req.session.user.id,
        action: "staff.updated",
        recordType: "users",
        recordId: staffId,
        previousValues: { isActive: staff[0].is_active, fullName: staff[0].full_name, phone: staff[0].phone },
        newValues: { isActive: req.body.isActive, fullName: req.body.fullName, phone: req.body.phone },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      }).catch(() => {});
      res.json({ success: true, message: "Staff account updated." });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/admin/staff/:staffId/permissions",
  [body("permissions").isArray()],
  async (req, res, next) => {
    const connection = await db.getConnection();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new AppError("Permissions must be provided as an array.", 422, "VALIDATION_ERROR", errors.mapped());
      const staffId = Number(req.params.staffId);
      if (!Number.isInteger(staffId) || staffId < 1) throw new AppError("Invalid staff account.", 400, "INVALID_STAFF");

      const [staff] = await connection.execute(
        `SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
         WHERE u.id=:staffId AND r.name='staff'`,
        { staffId }
      );
      if (!staff[0]) throw new AppError("Staff account not found.", 404, "STAFF_NOT_FOUND");

      const [permissions] = await connection.execute(
        `SELECT id, name FROM permissions
         WHERE name IN (${req.body.permissions.length ? req.body.permissions.map((_, i) => `:permission${i}`).join(",") : "NULL"})`,
        Object.fromEntries(req.body.permissions.map((permission, i) => [`permission${i}`, permission]))
      );
      const allowedNames = new Set(permissions.map((permission) => permission.name));
      if (permissions.some((permission) => /exemption|exclusion/i.test(permission.name))) {
        throw new AppError("Restricted categories cannot be assigned to staff.", 403, "RESTRICTED_PERMISSION");
      }

      await connection.beginTransaction();
      await connection.execute(
        "UPDATE user_permissions SET is_granted=FALSE WHERE user_id=:staffId",
        { staffId }
      );
      for (const permission of permissions) {
        await connection.execute(
          `INSERT INTO user_permissions (user_id, permission_id, granted_by, is_granted)
           VALUES (:staffId, :permissionId, :grantedBy, TRUE)
           ON DUPLICATE KEY UPDATE is_granted=TRUE, granted_by=:grantedBy`,
          { staffId, permissionId: permission.id, grantedBy: req.session.user.id }
        );
      }
      await connection.commit();
      await writeAuditLog({
        userId: req.session.user.id,
        action: "staff.permissions_updated",
        recordType: "users",
        recordId: staffId,
        newValues: { permissions: [...allowedNames] },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      }).catch(() => {});
      res.json({ success: true, message: "Staff permissions updated.", permissions: [...allowedNames] });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/admin/staff/:staffId/reset-password",
  [body("password").isLength({ min: 4, max: 72 }).matches(/[A-Z]/).matches(/[a-z]/).matches(/[0-9]/)],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new AppError("Please provide a strong password.", 422, "VALIDATION_ERROR", errors.mapped());
      const staffId = Number(req.params.staffId);
      if (!Number.isInteger(staffId) || staffId < 1) throw new AppError("Invalid staff account.", 400, "INVALID_STAFF");
      const [staff] = await db.execute(
        `SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
         WHERE u.id=:staffId AND r.name='staff'`,
        { staffId }
      );
      if (!staff[0]) throw new AppError("Staff account not found.", 404, "STAFF_NOT_FOUND");
      const passwordHash = await bcrypt.hash(req.body.password, 12);
      await db.execute(
        "UPDATE users SET password_hash=:passwordHash, password_changed_at=CURRENT_TIMESTAMP WHERE id=:staffId",
        { passwordHash, staffId }
      );
      await writeAuditLog({
        userId: req.session.user.id,
        action: "staff.password_reset",
        recordType: "users",
        recordId: staffId,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      }).catch(() => {});
      res.json({ success: true, message: "Staff password reset." });
    } catch (error) {
      next(error);
    }
  }
);

router.get("/admin/staff/:staffId/activity", async (req, res, next) => {
  try {
    const staffId = Number(req.params.staffId);
    if (!Number.isInteger(staffId) || staffId < 1) throw new AppError("Invalid staff account.", 400, "INVALID_STAFF");
    const [rows] = await db.execute(
      `SELECT id, action, record_type, record_id, ip_address, created_at
       FROM audit_logs
       WHERE user_id=:staffId
       ORDER BY created_at DESC
       LIMIT 100`,
      { staffId }
    );
    res.json({ success: true, activity: rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
