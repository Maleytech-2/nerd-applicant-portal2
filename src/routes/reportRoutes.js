const express = require("express");
const ExcelJS = require("exceljs");
const db = require("../config/database");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const { AppError } = require("../middleware/errorHandler");
const { writeAuditLog } = require("../middleware/audit");

const router = express.Router();

router.use("/reports", requireAuth, requireRole("administrator", "staff"), requirePermission("reports.view"));

function addFilter(params, conditions, field, column, value) {
  if (!value) return;
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 1) {
    params[field] = values[0];
    conditions.push(`${column}=:${field}`);
  } else {
    values.forEach((item, index) => {
      params[`${field}${index}`] = item;
    });
    conditions.push(`${column} IN (${values.map((_, index) => `:${field}${index}`).join(",")})`);
  }
}

function escapeLike(value) {
  return String(value).replace(/[%_\\]/g, "\\$&");
}

async function getReportRows(filters = {}, includeRestricted = false) {
  const conditions = [];
  const params = {};

  if (filters.from) {
    params.from = filters.from;
    conditions.push("u.created_at>=:from");
  }
  if (filters.to) {
    params.to = `${filters.to} 23:59:59`;
    conditions.push("u.created_at<=:to");
  }
  if (filters.name) {
    params.name = `%${escapeLike(filters.name)}%`;
    conditions.push("u.full_name LIKE :name ESCAPE '\\\\'");
  }
  if (filters.applicationReference) {
    params.applicationReference = `%${escapeLike(filters.applicationReference)}%`;
    conditions.push("COALESCE(a.application_reference,'') LIKE :applicationReference ESCAPE '\\\\'");
  }
  if (filters.phone) {
    params.phone = `%${escapeLike(filters.phone)}%`;
    conditions.push("u.phone LIKE :phone ESCAPE '\\\\'");
  }
  if (filters.email) {
    params.email = `%${escapeLike(filters.email)}%`;
    conditions.push("u.email LIKE :email ESCAPE '\\\\'");
  }
  if (filters.nationality) {
    params.nationality = filters.nationality;
    conditions.push("e.nationality=:nationality");
  }
  if (filters.institution) {
    params.institution = `%${escapeLike(filters.institution)}%`;
    conditions.push("COALESCE(e.institution_name,'') LIKE :institution ESCAPE '\\\\'");
  }
  if (filters.department) {
    params.department = `%${escapeLike(filters.department)}%`;
    conditions.push("COALESCE(a.department,'') LIKE :department ESCAPE '\\\\'");
  }
  addFilter(params, conditions, "paymentStatus", "p.status", filters.paymentStatus);
  addFilter(params, conditions, "applicationStatus", "a.status", filters.applicationStatus);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await db.execute(
    `SELECT
       u.id AS applicant_id,
       u.full_name,
       u.email,
       u.phone,
       u.created_at AS account_created_at,
       e.date_of_birth,
       e.actual_graduation_date,
       e.age_at_graduation,
       e.nationality,
       e.institution_name,
       e.is_eligible,
       e.rejection_reason,
       e.expected_fee_amount,
       p.applicant_reference,
       p.amount_expected,
       p.amount_submitted,
       p.payment_date,
       p.channel,
       p.transaction_reference,
       p.status AS payment_status,
       p.submitted_at AS payment_submitted_at,
       a.application_reference,
       a.department,
       a.course_of_study,
       a.status AS application_status,
       a.submitted_at AS application_submitted_at,
       nt.official_nerd_reference,
       nt.status AS nerd_registration_status,
       CASE WHEN c.status='available' THEN TRUE ELSE FALSE END AS clearance_available,
       c.uploaded_at AS clearance_uploaded_at
     FROM users u
     JOIN roles r ON r.id=u.role_id
     LEFT JOIN eligibility_screenings e ON e.applicant_id=u.id
     LEFT JOIN payments p ON p.applicant_id=u.id
     LEFT JOIN applications a ON a.applicant_id=u.id
     LEFT JOIN nerd_registration_tracking nt ON nt.application_id=a.id
     LEFT JOIN clearances c ON c.application_id=a.id AND c.status='available'
     ${where}
     ORDER BY u.created_at DESC
     LIMIT 1000`,
    params
  );
  if (!includeRestricted) {
    return rows.map(({ restricted_category, restricted_fee, ...row }) => row);
  }
  return rows;
}

router.get("/reports", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(10, Number(req.query.limit || 20)));
    const filters = req.query;
    const includeRestricted = req.session.user.role === "administrator";
    const rows = await getReportRows(filters, includeRestricted);
    const start = (page - 1) * limit;
    res.json({
      success: true,
      reports: rows.slice(start, start + limit),
      pagination: {
        page,
        limit,
        total: rows.length,
        pages: Math.ceil(rows.length / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/reports/excel",
  requirePermission("reports.export"),
  async (req, res, next) => {
    try {
      const includeRestricted = req.session.user.role === "administrator";
      const rows = await getReportRows(req.body || {}, includeRestricted);
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "OGAH JOHN BUSINESS CENTER - UDUS MINI MART";
      workbook.subject = "NERD Clearance Portal Report";
      workbook.created = new Date();
      const worksheet = workbook.addWorksheet("Report");

      if (!rows.length) {
        worksheet.addRow(["No records matched the report filters"]);
      } else {
        worksheet.columns = Object.keys(rows[0]).map((key) => ({
          header: key.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpper()),
          key,
          width: Math.min(32, Math.max(12, key.length + 4)),
        }));
        worksheet.addRows(rows);
        worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        worksheet.getRow(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF0B1F3A" },
        };
        worksheet.autoFilter = {
          from: "A1",
          to: `${worksheet.getColumn(worksheet.columnCount).letter}${worksheet.rowCount}`,
        };
      }

      await writeAuditLog({
        userId: req.session.user.id,
        action: "report.exported",
        recordType: "reports",
        recordId: null,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        newValues: { reportType: "excel", recordCount: rows.length },
      }).catch(() => {});

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="nerd-clearance-report-${new Date().toISOString().slice(0, 10)}.xlsx"`
      );
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
