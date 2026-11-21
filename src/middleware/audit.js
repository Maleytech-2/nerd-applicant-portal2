const db = require("../config/database");

async function writeAuditLog({
  userId = null,
  action,
  recordType = null,
  recordId = null,
  previousValues = null,
  newValues = null,
  ipAddress = null,
  userAgent = null,
}) {
  await db.execute(
    `INSERT INTO audit_logs
       (user_id, action, record_type, record_id, previous_values, new_values, ip_address, user_agent)
     VALUES
       (:userId, :action, :recordType, :recordId, :previousValues, :newValues, :ipAddress, :userAgent)`,
    {
      userId,
      action,
      recordType,
      recordId,
      previousValues: previousValues ? JSON.stringify(previousValues) : null,
      newValues: newValues ? JSON.stringify(newValues) : null,
      ipAddress,
      userAgent,
    }
  );
}

function auditRequest(action, recordType = null) {
  return async (req, _res, next) => {
    req.audit = (details = {}) =>
      writeAuditLog({
        userId: req.session?.user?.id || null,
        action,
        recordType,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        ...details,
      });
    next();
  };
}

module.exports = { writeAuditLog, auditRequest };
