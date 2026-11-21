const { AppError } = require("./errorHandler");
const db = require("../config/database");

async function requireAuth(req, _res, next) {
  if (!req.session?.user) {
    return next(new AppError("Authentication required.", 401, "UNAUTHENTICATED"));
  }
  try {
    const [rows] = await db.execute(
      `SELECT u.id, u.full_name, u.email, u.phone, u.is_active,
              u.password_changed_at, r.name AS role
       FROM users u
       JOIN roles r ON r.id=u.role_id
       WHERE u.id=:id
       LIMIT 1`,
      { id: req.session.user.id }
    );
    if (!rows[0] || !rows[0].is_active) {
      req.session.destroy(() => {});
      return next(new AppError("This account is inactive or no longer available.", 403, "ACCOUNT_INACTIVE"));
    }

    const passwordChangedAt = rows[0].password_changed_at
      ? new Date(rows[0].password_changed_at).toISOString()
      : null;
    if (
      req.session.passwordChangedAt &&
      passwordChangedAt &&
      req.session.passwordChangedAt !== passwordChangedAt
    ) {
      req.session.destroy(() => {});
      return next(new AppError("Session expired after a password change. Please sign in again.", 401, "PASSWORD_CHANGED"));
    }
    req.session.passwordChangedAt = passwordChangedAt;

    const [permissionRows] = await db.execute(
      `SELECT p.name
       FROM permissions p
       LEFT JOIN role_permissions rp ON rp.permission_id=p.id
       LEFT JOIN users u ON u.role_id=rp.role_id
       LEFT JOIN user_permissions up ON up.permission_id=p.id AND up.user_id=:id
       WHERE (u.id=:id OR up.is_granted=TRUE)
         AND NOT EXISTS (
           SELECT 1 FROM user_permissions revoked
           WHERE revoked.user_id=:id
             AND revoked.permission_id=p.id
             AND revoked.is_granted=FALSE
         )
       GROUP BY p.name`,
      { id: rows[0].id }
    );

    req.session.user = {
      id: rows[0].id,
      fullName: rows[0].full_name,
      email: rows[0].email,
      phone: rows[0].phone,
      role: rows[0].role,
      permissions: permissionRows.map((permission) => permission.name),
    };
    next();
  } catch (error) {
    next(error);
  }
}

function requireRole(...allowedRoles) {
  return (req, _res, next) => {
    const role = req.session?.user?.role;
    if (!role || !allowedRoles.includes(role)) {
      return next(new AppError("You are not authorized to access this resource.", 403, "FORBIDDEN"));
    }
    next();
  };
}

function requirePermission(...permissions) {
  return (req, _res, next) => {
    const user = req.session?.user;
    if (!user) {
      return next(new AppError("Authentication required.", 401, "UNAUTHENTICATED"));
    }
    if (user.role === "administrator") {
      return next();
    }
    const granted = new Set(user.permissions || []);
    const allowed = permissions.some((permission) => granted.has(permission));
    if (!allowed) {
      return next(new AppError("You do not have permission for this action.", 403, "FORBIDDEN"));
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requirePermission };
