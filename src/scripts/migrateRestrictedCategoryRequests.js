require("dotenv").config();
const mysql = require("mysql2/promise");
const { getDatabaseConfig } = require("../config/databaseConfig");

async function migrate() {
  const databaseConfig = getDatabaseConfig();
  const connection = await mysql.createConnection({
    ...databaseConfig,
  });

  try {
    const [columns] = await connection.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME='eligibility_screenings' AND COLUMN_NAME='study_mode'`,
      [databaseConfig.database]
    );
    if (!columns.length) {
      await connection.execute(
        "ALTER TABLE eligibility_screenings ADD COLUMN study_mode ENUM('full_time','part_time') NOT NULL DEFAULT 'full_time' AFTER country"
      );
    }
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS restricted_category_requests (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        applicant_id BIGINT UNSIGNED NOT NULL,
        case_reason ENUM('over_age_full_time','nigerian_part_time','noun') NOT NULL,
        suggested_category ENUM('exemption','exclusion') NULL,
        category ENUM('exemption','exclusion') NULL,
        status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
        admin_notes TEXT NULL,
        assigned_by BIGINT UNSIGNED NULL,
        decided_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_restricted_request_applicant (applicant_id),
        KEY ix_restricted_request_status (status, created_at),
        CONSTRAINT fk_restricted_request_applicant FOREIGN KEY (applicant_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_restricted_request_assigner FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);
    await connection.execute(`
      INSERT IGNORE INTO restricted_category_requests (
        applicant_id, case_reason, suggested_category, status
      )
      SELECT e.applicant_id,
             CASE
               WHEN LOWER(e.institution_name) LIKE '%national open university%'
                 OR LOWER(e.institution_name)='noun'
                 OR LOWER(COALESCE(e.rejection_reason,'')) LIKE '%noun%'
               THEN 'noun'
               ELSE 'over_age_full_time'
             END,
             CASE
               WHEN LOWER(e.institution_name) LIKE '%national open university%'
                 OR LOWER(e.institution_name)='noun'
                 OR LOWER(COALESCE(e.rejection_reason,'')) LIKE '%noun%'
               THEN NULL
               ELSE 'exemption'
             END,
             'pending'
      FROM eligibility_screenings e
      WHERE e.is_eligible=FALSE
        AND (
          LOWER(e.institution_name) LIKE '%national open university%'
          OR LOWER(e.institution_name)='noun'
          OR LOWER(COALESCE(e.rejection_reason,'')) LIKE '%noun%'
          OR (e.study_mode='full_time' AND e.age_at_graduation>30)
        )
    `);
    console.log("Restricted category request migration completed.");
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  console.error("Restricted category request migration failed:", error.message);
  process.exit(1);
});
