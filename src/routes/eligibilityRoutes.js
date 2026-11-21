const express = require("express");
const { body, validationResult } = require("express-validator");
const db = require("../config/database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { AppError } = require("../middleware/errorHandler");
const { writeAuditLog } = require("../middleware/audit");
const { queueNotification } = require("../services/emailService");
const { evaluateEligibility, normalizeInstitutionName } = require("../services/eligibilityService");

const router = express.Router();

router.use("/eligibility", requireAuth, requireRole("applicant"));

router.get("/eligibility", async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT e.date_of_birth, e.actual_graduation_date, e.nationality, e.country,
              e.study_mode,
              e.institution_name, e.age_at_graduation, e.is_eligible,
              e.rejection_reason, e.expected_fee_amount, e.updated_at,
              r.status AS restricted_review_status,
              CASE WHEN r.case_reason='over_age_full_time' THEN r.status ELSE NULL END
                AS exemption_review_status
       FROM eligibility_screenings e
       LEFT JOIN restricted_category_requests r ON r.applicant_id=e.applicant_id
       WHERE e.applicant_id = :applicantId`,
      { applicantId: req.session.user.id }
    );
    res.json({ success: true, screening: rows[0] || null });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/eligibility",
  [
    body("dateOfBirth").matches(/^\d{4}-\d{2}-\d{2}$/),
    body("graduationDate").matches(/^\d{4}-\d{2}-\d{2}$/),
    body("nationality").trim().isLength({ min: 2, max: 100 }),
    body("studyMode").isIn(["full_time", "part_time"]),
    body("institution").trim().isLength({ min: 2, max: 255 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError("Please correct the highlighted fields.", 422, "VALIDATION_ERROR", errors.mapped());
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

      const [approvedCases] = await db.execute(
        `SELECT e.age_at_graduation, e.expected_fee_amount, r.case_reason, r.category
         FROM eligibility_screenings e
         JOIN restricted_category_requests r ON r.applicant_id=e.applicant_id
         WHERE e.applicant_id=:applicantId
           AND r.status='approved'
           AND e.is_eligible=TRUE
         LIMIT 1`,
        { applicantId: req.session.user.id }
      );
      if (approvedCases[0]) {
        return res.json({
          success: true,
          eligible: true,
          reviewRequired: false,
          ageAtGraduation: approvedCases[0].age_at_graduation,
          fee: Number(approvedCases[0].expected_fee_amount),
          exemptionReviewStatus: approvedCases[0].case_reason === "over_age_full_time" &&
            approvedCases[0].category === "exemption" ? "approved" : null,
          message: "Eligibility approved. Payment details are available.",
        });
      }

      let result;
      try {
        result = evaluateEligibility({
          dateOfBirth: req.body.dateOfBirth,
          graduationDate: req.body.graduationDate,
          nationality: req.body.nationality,
          institution: req.body.institution,
          studyMode: req.body.studyMode,
        });
      } catch (error) {
        throw new AppError(error.message, 422, "INVALID_DATE");
      }

      const institutionNormalized = normalizeInstitutionName(req.body.institution);
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        let institutionId = null;
        const [institutionRows] = await connection.execute(
          "SELECT id, is_restricted FROM institutions WHERE normalized_name = :normalized LIMIT 1",
          { normalized: institutionNormalized }
        );
        if (institutionRows[0]) institutionId = institutionRows[0].id;
        if (!institutionId) {
          const [insertInstitution] = await connection.execute(
            `INSERT INTO institutions (name, normalized_name, is_restricted)
             VALUES (:name, :normalized, FALSE)
             ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
            { name: req.body.institution, normalized: institutionNormalized }
          );
          institutionId = insertInstitution.insertId;
        }

        await connection.execute(
          `INSERT INTO eligibility_screenings (
             applicant_id, date_of_birth, actual_graduation_date, nationality,
             country, study_mode, institution_id, institution_name, age_at_graduation,
             is_eligible, rejection_reason, category, expected_fee_amount
           ) VALUES (
             :applicantId, :dateOfBirth, :graduationDate, :nationality,
             :country, :studyMode, :institutionId, :institutionName, :ageAtGraduation,
             :isEligible, :rejectionReason, 'full_time', :expectedFee
           )
           ON DUPLICATE KEY UPDATE
             date_of_birth = VALUES(date_of_birth),
             actual_graduation_date = VALUES(actual_graduation_date),
             nationality = VALUES(nationality),
             country = VALUES(country),
             study_mode = VALUES(study_mode),
             institution_id = VALUES(institution_id),
             institution_name = VALUES(institution_name),
             age_at_graduation = VALUES(age_at_graduation),
             is_eligible = VALUES(is_eligible),
             rejection_reason = VALUES(rejection_reason),
             expected_fee_amount = VALUES(expected_fee_amount)`,
          {
            applicantId: req.session.user.id,
            dateOfBirth: req.body.dateOfBirth,
            graduationDate: req.body.graduationDate,
            nationality: req.body.nationality,
            country: req.body.country || null,
            studyMode: req.body.studyMode,
            institutionId,
            institutionName: req.body.institution,
            ageAtGraduation: result.ageAtGraduation,
            isEligible: result.eligible,
            rejectionReason: result.rejectionReason,
            expectedFee: result.fee,
          }
        );
        if (result.reviewRequired) {
          await connection.execute(
            `INSERT INTO restricted_category_requests (
               applicant_id, case_reason, suggested_category, category, status,
               admin_notes, assigned_by, decided_at
             ) VALUES (
               :applicantId, :caseReason, :suggestedCategory, NULL, 'pending',
               NULL, NULL, NULL
             )
             ON DUPLICATE KEY UPDATE
               case_reason=VALUES(case_reason),
               suggested_category=VALUES(suggested_category),
               category=NULL,
               status='pending',
               admin_notes=NULL,
               assigned_by=NULL,
               decided_at=NULL,
               updated_at=CURRENT_TIMESTAMP`,
            {
              applicantId: req.session.user.id,
              caseReason: result.caseReason,
              suggestedCategory: result.suggestedCategory,
            }
          );
        } else {
          await connection.execute(
            `UPDATE restricted_category_requests
             SET status='cancelled', updated_at=CURRENT_TIMESTAMP
             WHERE applicant_id=:applicantId AND status='pending'`,
            { applicantId: req.session.user.id }
          );
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      await writeAuditLog({
        userId: req.session.user.id,
        action: "eligibility.screened",
        recordType: "eligibility_screenings",
        recordId: req.session.user.id,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        newValues: {
          isEligible: result.eligible,
          ageAtGraduation: result.ageAtGraduation,
          nationality: req.body.nationality,
        },
      }).catch(() => {});

      if (!result.reviewRequired) {
        try {
          await queueNotification({
            recipientUserId: req.session.user.id,
            recipientEmail: req.session.user.email,
            templateName: "eligibility_result",
            payload: {
              eligible: result.eligible,
              rejectionReason: result.rejectionReason,
              fee: result.fee,
            },
          });
        } catch (notificationError) {
          console.error("Failed to queue eligibility notification:", notificationError);
        }
      }

      res.status(result.reviewRequired ? 202 : result.eligible ? 200 : 422).json({
        success: result.eligible,
        eligible: result.eligible,
        reviewRequired: result.reviewRequired,
        exemptionReviewStatus: result.suggestedCategory === "exemption" ? "pending" : null,
        ageAtGraduation: result.ageAtGraduation,
        fee: result.eligible ? result.fee : null,
        rejectionReason: result.rejectionReason,
        message: result.eligible
          ? "Eligibility confirmed. Payment details are now available."
          : result.rejectionReason,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
