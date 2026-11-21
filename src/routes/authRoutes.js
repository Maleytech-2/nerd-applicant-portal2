const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const db = require("../config/database");
const { AppError } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");
const { writeAuditLog } = require("../middleware/audit");
const { sendPasswordResetEmail, queueNotification } = require("../services/emailService");
const { isElevenDigitNumber } = require("../utils/validation");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: "RATE_LIMITED", message: "Too many login attempts. Try again later." },
  },
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: "RATE_LIMITED", message: "Too many reset requests. Try again later." },
  },
});

function validationErrors(req) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    throw new AppError("Please correct the highlighted fields.", 422, "VALIDATION_ERROR", result.mapped());
  }
}

async function getSessionUser(userId) {
  const [rows] = await db.execute(
    `SELECT u.id, u.full_name, u.email, u.phone, u.is_active,
            u.password_changed_at, r.name AS role
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = :id`,
    { id: userId }
  );
  if (!rows[0]) {
    throw new AppError("Account not found.", 404, "ACCOUNT_NOT_FOUND");
  }
  if (!rows[0].is_active) {
    throw new AppError("This account is inactive.", 403, "ACCOUNT_INACTIVE");
  }
  const [permissionRows] = await db.execute(
    `SELECT p.name
     FROM permissions p
     WHERE p.id IN (
       SELECT rp.permission_id
       FROM role_permissions rp
       JOIN users u ON u.role_id=rp.role_id
       WHERE u.id=:id
     )
     OR p.id IN (
       SELECT up.permission_id
       FROM user_permissions up
       WHERE up.user_id=:id AND up.is_granted=TRUE
     )
     AND p.id NOT IN (
       SELECT up.permission_id
       FROM user_permissions up
       WHERE up.user_id=:id AND up.is_granted=FALSE
     )`,
    { id: userId }
  );
  return {
    id: rows[0].id,
    fullName: rows[0].full_name,
    email: rows[0].email,
    phone: rows[0].phone,
    role: rows[0].role,
    permissions: permissionRows.map((permission) => permission.name),
    passwordChangedAt: rows[0].password_changed_at
      ? new Date(rows[0].password_changed_at).toISOString()
      : null,
  };
}

router.post(
  "/auth/register",
  [
    body("fullName").trim().isLength({ min: 3, max: 160 }).withMessage("Enter your full name."),
    body("email").trim().isEmail().isLength({ max: 190 }).normalizeEmail(),
    body("phone").trim().custom(isElevenDigitNumber).withMessage("Phone number must contain exactly 11 digits."),
    body("password").isLength({ min: 4, max: 72 }).matches(/[A-Z]/).matches(/[a-z]/).matches(/[0-9]/)
      .withMessage("Password must contain at least 4 characters with uppercase, lowercase, and a number."),
    body("passwordConfirmation").custom((value, { req }) => value === req.body.password)
      .withMessage("Password confirmation does not match."),
  ],
  async (req, res, next) => {
    try {
      validationErrors(req);
      const email = String(req.body.email).toLowerCase();
      const [existing] = await db.execute("SELECT id FROM users WHERE email = :email LIMIT 1", { email });
      if (existing.length) {
        throw new AppError("An account already exists with this email.", 409, "EMAIL_EXISTS");
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const [roles] = await connection.execute("SELECT id FROM roles WHERE name = 'applicant'", []);
        if (!roles[0]) throw new Error("Applicant role is missing.");

        const passwordHash = await bcrypt.hash(req.body.password, 12);
        const [result] = await connection.execute(
          `INSERT INTO users (role_id, full_name, email, phone, password_hash)
           VALUES (:roleId, :fullName, :email, :phone, :passwordHash)`,
          {
            roleId: roles[0].id,
            fullName: req.body.fullName,
            email,
            phone: req.body.phone,
            passwordHash,
          }
        );
        await connection.commit();

        try {
          await queueNotification({
            recipientUserId: result.insertId,
            recipientEmail: email,
            templateName: "account_registered",
            payload: { fullName: req.body.fullName },
          });
        } catch (notificationError) {
          console.error("Failed to queue account registration notification:", notificationError);
        }

        await writeAuditLog({
          userId: result.insertId,
          action: "account.created",
          recordType: "users",
          recordId: result.insertId,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        req.session.regenerate((sessionError) => {
          if (sessionError) return next(sessionError);
          getSessionUser(result.insertId).then((user) => {
            req.session.user = user;
            req.session.passwordChangedAt = user.passwordChangedAt;
            req.session.save((saveError) => {
              if (saveError) return next(saveError);
              res.status(201).json({ success: true, message: "Account created successfully.", redirect: "/applicant/dashboard" });
            });
          }).catch(next);
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/auth/login",
  loginLimiter,
  [
    body("email").trim().isEmail().normalizeEmail(),
    body("password").isLength({ min: 1, max: 72 }),
  ],
  async (req, res, next) => {
    try {
      validationErrors(req);
      const email = String(req.body.email).toLowerCase();
      const [rows] = await db.execute(
        `SELECT u.id, u.password_hash, u.is_active
         FROM users u
         WHERE u.email = :email LIMIT 1`,
        { email }
      );

      const valid = rows[0] ? await bcrypt.compare(req.body.password, rows[0].password_hash) : false;
      if (!rows[0] || !valid || !rows[0].is_active) {
        await writeAuditLog({
          action: "auth.login_failed",
          recordType: "users",
          recordId: rows[0]?.id || null,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
          newValues: { email, reason: "invalid_credentials_or_inactive_account" },
        }).catch(() => {});
        throw new AppError("Email or password is incorrect.", 401, "INVALID_CREDENTIALS");
      }

      req.session.regenerate(async (sessionError) => {
        if (sessionError) return next(sessionError);
        try {
          const user = await getSessionUser(rows[0].id);
          await db.execute("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = :id", { id: user.id });
          await writeAuditLog({
            userId: user.id,
            action: "auth.login_success",
            recordType: "users",
            recordId: user.id,
            ipAddress: req.ip,
            userAgent: req.get("user-agent"),
          });
          req.session.user = user;
          req.session.passwordChangedAt = user.passwordChangedAt;
          req.session.save((saveError) => {
            if (saveError) return next(saveError);
            const redirect =
              user.role === "applicant" ? "/applicant/dashboard" :
              user.role === "staff" ? "/staff/dashboard" : "/admin/dashboard";
            res.json({ success: true, message: "Login successful.", redirect });
          });
        } catch (error) {
          next(error);
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post("/auth/logout", requireAuth, async (req, res, next) => {
  const userId = req.session.user.id;
  await writeAuditLog({
    userId,
    action: "auth.logout",
    recordType: "users",
    recordId: userId,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  }).catch(() => {});
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("nerd.sid");
    res.json({ success: true, message: "You have been logged out.", redirect: "/applicant/login" });
  });
});

router.post(
  "/auth/forgot-password",
  resetLimiter,
  [body("email").trim().isEmail().normalizeEmail()],
  async (req, res, next) => {
    try {
      validationErrors(req);
      const email = String(req.body.email).toLowerCase();
      const [users] = await db.execute(
        "SELECT id, full_name FROM users WHERE email = :email AND is_active = TRUE LIMIT 1",
        { email }
      );

      if (users[0]) {
        await db.execute(
          "UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = :userId AND used_at IS NULL",
          { userId: users[0].id }
        );
        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
        await db.execute(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES (:userId, :tokenHash, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 MINUTE))`,
          { userId: users[0].id, tokenHash }
        );

        const resetLink = `${process.env.APP_URL || "http://localhost:3000"}/applicant/reset-password?token=${rawToken}`;
        await writeAuditLog({
          userId: users[0].id,
          action: "auth.password_reset_requested",
          recordType: "users",
          recordId: users[0].id,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        }).catch(() => {});

        try {
          const mailResult = await sendPasswordResetEmail({
            to: email,
            fullName: users[0].full_name,
            resetLink,
          });
          if (!mailResult.sent && process.env.NODE_ENV !== "production") {
            console.info(`Password reset link for ${email}: ${resetLink}`);
          }
        } catch (mailError) {
          console.error("Password reset email failed:", mailError);
        }


      }

      res.json({
        success: true,
        message: "If that account exists, password reset instructions have been sent.",
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/auth/reset-password",
  [
    body("token").isLength({ min: 64, max: 64 }),
    body("password").isLength({ min: 4, max: 72 }).matches(/[A-Z]/).matches(/[a-z]/).matches(/[0-9]/),
    body("passwordConfirmation").custom((value, { req }) => value === req.body.password),
  ],
  async (req, res, next) => {
    try {
      validationErrors(req);
      const tokenHash = crypto.createHash("sha256").update(req.body.token).digest("hex");
      const [tokens] = await db.execute(
        `SELECT id, user_id
         FROM password_reset_tokens
         WHERE token_hash = :tokenHash
           AND used_at IS NULL
           AND expires_at > CURRENT_TIMESTAMP
         LIMIT 1`,
        { tokenHash }
      );
      if (!tokens[0]) {
        throw new AppError("Reset link is invalid or expired.", 400, "RESET_TOKEN_INVALID");
      }

      const passwordHash = await bcrypt.hash(req.body.password, 12);
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          "UPDATE users SET password_hash = :passwordHash, password_changed_at=CURRENT_TIMESTAMP WHERE id = :userId",
          { passwordHash, userId: tokens[0].user_id }
        );
        await connection.execute(
          "UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = :tokenId",
          { tokenId: tokens[0].id }
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      await writeAuditLog({
        userId: tokens[0].user_id,
        action: "auth.password_reset_completed",
        recordType: "users",
        recordId: tokens[0].user_id,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      }).catch(() => {});

      res.json({ success: true, message: "Password reset successfully.", redirect: "/applicant/login" });
    } catch (error) {
      next(error);
    }
  }
);

router.get("/session", requireAuth, (req, res) => {
  res.json({ success: true, user: req.session.user });
});

module.exports = router;
