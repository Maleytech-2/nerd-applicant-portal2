CREATE DATABASE IF NOT EXISTS nerd_clearance_portal
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE nerd_clearance_portal;

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(32) NOT NULL,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(64) NOT NULL,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_id BIGINT UNSIGNED NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  password_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified_at TIMESTAMP NULL,
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY ix_users_role (role_id),
  KEY ix_users_active (is_active),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  granted_by BIGINT UNSIGNED NOT NULL,
  is_granted BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, permission_id),
  KEY ix_user_permissions_granted (is_granted),
  CONSTRAINT fk_user_permissions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_permissions_granter FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_reset_token_hash (token_hash),
  KEY ix_password_reset_user (user_id),
  KEY ix_password_reset_expiry (expires_at),
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS institutions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  normalized_name VARCHAR(255) NOT NULL,
  is_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_institutions_normalized (normalized_name),
  KEY ix_institutions_restricted (is_restricted)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS eligibility_screenings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  applicant_id BIGINT UNSIGNED NOT NULL,
  date_of_birth DATE NOT NULL,
  actual_graduation_date DATE NOT NULL,
  nationality VARCHAR(100) NOT NULL,
  country VARCHAR(100) NULL,
  study_mode ENUM('full_time','part_time') NOT NULL DEFAULT 'full_time',
  institution_id BIGINT UNSIGNED NULL,
  institution_name VARCHAR(255) NOT NULL,
  age_at_graduation TINYINT UNSIGNED NOT NULL,
  is_eligible BOOLEAN NOT NULL,
  rejection_reason VARCHAR(255) NULL,
  category VARCHAR(32) NOT NULL DEFAULT 'full_time',
  expected_fee_amount DECIMAL(12,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_eligibility_applicant (applicant_id),
  KEY ix_eligibility_result (is_eligible),
  KEY ix_eligibility_institution (institution_id),
  CONSTRAINT fk_eligibility_applicant FOREIGN KEY (applicant_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_eligibility_institution FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  applicant_id BIGINT UNSIGNED NOT NULL,
  uploader_id BIGINT UNSIGNED NULL,
  category ENUM(
    'passport_photo',
    'means_of_identification',
    'institutional_attestation',
    'full_project',
    'signed_certification',
    'payment_receipt',
    'official_clearance'
  ) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  relative_path VARCHAR(1024) NOT NULL,
  mime_type VARCHAR(127) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  file_hash CHAR(64) NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  replaced_by_document_id BIGINT UNSIGNED NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_documents_stored_filename (stored_filename),
  KEY ix_documents_applicant_category (applicant_id, category),
  KEY ix_documents_hash (file_hash),
  KEY ix_documents_current (is_current),
  CONSTRAINT fk_documents_applicant FOREIGN KEY (applicant_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_documents_uploader FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_documents_replaced_by FOREIGN KEY (replaced_by_document_id) REFERENCES documents(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  applicant_id BIGINT UNSIGNED NOT NULL,
  eligibility_id BIGINT UNSIGNED NOT NULL,
  applicant_reference VARCHAR(32) NOT NULL,
  amount_expected DECIMAL(12,2) NOT NULL,
  amount_submitted DECIMAL(12,2) NOT NULL,
  payment_date DATE NOT NULL,
  channel ENUM('palmpay','access_bank') NOT NULL,
  transaction_reference VARCHAR(100) NOT NULL,
  receipt_document_id BIGINT UNSIGNED NULL,
  receipt_file_hash CHAR(64) NULL,
  status ENUM('not_paid','pending_verification','under_review','approved','rejected','correction_required') NOT NULL DEFAULT 'pending_verification',
  active_approval_key BIGINT UNSIGNED
    GENERATED ALWAYS AS (CASE WHEN status = 'approved' THEN applicant_id ELSE NULL END) VIRTUAL,
  duplicate_flag BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_match_payment_id BIGINT UNSIGNED NULL,
  internal_notes TEXT NULL,
  verified_by BIGINT UNSIGNED NULL,
  verified_at TIMESTAMP NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_transaction_reference (transaction_reference),
  UNIQUE KEY uq_payments_one_approved_per_applicant (active_approval_key),
  KEY ix_payments_applicant_status (applicant_id, status),
  KEY ix_payments_eligibility (eligibility_id),
  KEY ix_payments_receipt_hash (receipt_file_hash),
  KEY ix_payments_duplicate_match (duplicate_match_payment_id),
  CONSTRAINT fk_payments_applicant FOREIGN KEY (applicant_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_eligibility FOREIGN KEY (eligibility_id) REFERENCES eligibility_screenings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payments_receipt_document FOREIGN KEY (receipt_document_id) REFERENCES documents(id) ON DELETE SET NULL,
  CONSTRAINT fk_payments_duplicate_match FOREIGN KEY (duplicate_match_payment_id) REFERENCES payments(id) ON DELETE SET NULL,
  CONSTRAINT fk_payments_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  applicant_id BIGINT UNSIGNED NOT NULL,
  payment_id BIGINT UNSIGNED NOT NULL,
  application_reference VARCHAR(32) NOT NULL,
  title VARCHAR(24) NULL,
  first_name VARCHAR(80) NULL,
  middle_name VARCHAR(80) NULL,
  surname VARCHAR(80) NULL,
  sex ENUM('female','male','other') NULL,
  date_of_birth DATE NULL,
  marital_status VARCHAR(32) NULL,
  nin VARCHAR(11) NULL,
  nationality VARCHAR(100) NULL,
  country VARCHAR(100) NULL,
  state_of_origin VARCHAR(100) NULL,
  local_government_area VARCHAR(120) NULL,
  town_or_city VARCHAR(120) NULL,
  residential_address TEXT NULL,
  email_address VARCHAR(190) NULL,
  phone_number VARCHAR(32) NULL,
  next_of_kin_full_name VARCHAR(160) NULL,
  next_of_kin_phone VARCHAR(32) NULL,
  next_of_kin_email VARCHAR(190) NULL,
  institution_name VARCHAR(255) NULL,
  faculty VARCHAR(160) NULL,
  department VARCHAR(160) NULL,
  programme_category VARCHAR(32) NULL,
  programme_type VARCHAR(80) NULL,
  matriculation_number VARCHAR(80) NULL,
  course_of_study VARCHAR(160) NULL,
  supervisor_title VARCHAR(24) NULL,
  supervisor_full_name VARCHAR(160) NULL,
  supervisor_email VARCHAR(190) NULL,
  supervisor_phone VARCHAR(32) NULL,
  hod_title VARCHAR(24) NULL,
  hod_full_name VARCHAR(160) NULL,
  hod_email VARCHAR(190) NULL,
  hod_phone VARCHAR(32) NULL,
  status ENUM('draft','submitted','under_review','correction_required','approved_internally','ready_for_nerd_registration','nerd_registration_in_progress','nerd_registration_completed','clearance_available') NOT NULL DEFAULT 'draft',
  information_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_applications_applicant (applicant_id),
  UNIQUE KEY uq_applications_reference (application_reference),
  UNIQUE KEY uq_applications_payment (payment_id),
  KEY ix_applications_status (status),
  KEY ix_applications_submitted (submitted_at),
  CONSTRAINT fk_applications_applicant FOREIGN KEY (applicant_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_applications_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS application_documents (
  application_id BIGINT UNSIGNED NOT NULL,
  document_id BIGINT UNSIGNED NOT NULL,
  field_name VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (application_id, document_id),
  UNIQUE KEY uq_application_document_field (application_id, field_name),
  CONSTRAINT fk_application_documents_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_application_documents_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS application_corrections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id BIGINT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  reason TEXT NOT NULL,
  authorized_fields JSON NULL,
  authorized_document_categories JSON NULL,
  status ENUM('open','resolved','cancelled') NOT NULL DEFAULT 'open',
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_application_corrections_application_status (application_id, status),
  CONSTRAINT fk_application_corrections_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_application_corrections_requester FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS restricted_category_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  applicant_id BIGINT UNSIGNED NOT NULL,
  category ENUM('exemption','exclusion') NOT NULL,
  fee_amount DECIMAL(12,2) NOT NULL,
  reason TEXT NOT NULL,
  evidence_document_id BIGINT UNSIGNED NULL,
  assigned_by BIGINT UNSIGNED NOT NULL,
  status ENUM('active','revoked') NOT NULL DEFAULT 'active',
  revoked_by BIGINT UNSIGNED NULL,
  revoked_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_restricted_applicant_category (applicant_id, category),
  KEY ix_restricted_status (status),
  CONSTRAINT fk_restricted_applicant FOREIGN KEY (applicant_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_restricted_evidence FOREIGN KEY (evidence_document_id) REFERENCES documents(id) ON DELETE SET NULL,
  CONSTRAINT fk_restricted_assigner FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_restricted_revoker FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS nerd_registration_tracking (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id BIGINT UNSIGNED NOT NULL,
  official_nerd_reference VARCHAR(100) NULL,
  status ENUM('not_started','ready','in_progress','completed','on_hold','failed') NOT NULL DEFAULT 'not_started',
  internal_notes TEXT NULL,
  updated_by BIGINT UNSIGNED NULL,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_nerd_tracking_application (application_id),
  KEY ix_nerd_tracking_status (status),
  CONSTRAINT fk_nerd_tracking_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_nerd_tracking_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS clearances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id BIGINT UNSIGNED NOT NULL,
  document_id BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  status ENUM('available','replaced','revoked') NOT NULL DEFAULT 'available',
  replaced_by_clearance_id BIGINT UNSIGNED NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_clearances_document (document_id),
  KEY ix_clearances_application_status (application_id, status),
  CONSTRAINT fk_clearances_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_clearances_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE RESTRICT,
  CONSTRAINT fk_clearances_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_clearances_replaced_by FOREIGN KEY (replaced_by_clearance_id) REFERENCES clearances(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS email_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipient_user_id BIGINT UNSIGNED NULL,
  recipient_email VARCHAR(190) NOT NULL,
  template_name VARCHAR(64) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  payload JSON NULL,
  status ENUM('queued','sent','failed','cancelled') NOT NULL DEFAULT 'queued',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  sent_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_email_notifications_status_attempts (status, attempts),
  KEY ix_email_notifications_recipient (recipient_user_id),
  CONSTRAINT fk_email_notifications_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  action VARCHAR(128) NOT NULL,
  record_type VARCHAR(64) NULL,
  record_id BIGINT UNSIGNED NULL,
  previous_values JSON NULL,
  new_values JSON NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_audit_logs_user_created (user_id, created_at),
  KEY ix_audit_logs_action_created (action, created_at),
  KEY ix_audit_logs_record (record_type, record_id),
  CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS system_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  setting_key VARCHAR(100) NOT NULL,
  setting_value TEXT NULL,
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_system_settings_key (setting_key),
  CONSTRAINT fk_system_settings_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO roles (name, description) VALUES
  ('applicant', 'Applicant account'),
  ('staff', 'Limited administrative staff account'),
  ('administrator', 'Full system administrator')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO permissions (name, description) VALUES
  ('applicants.view', 'View ordinary applicant records'),
  ('applications.view', 'View submitted applications'),
  ('documents.view', 'Review permitted application documents'),
  ('applications.correct', 'Request application corrections'),
  ('nerd.update', 'Update official NERD registration progress'),
  ('reports.view', 'View permitted reports'),
  ('reports.export', 'Export permitted reports')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO institutions (name, normalized_name, is_restricted) VALUES
  ('National Open University of Nigeria (NOUN)', 'national open university of nigeria noun', TRUE)
ON DUPLICATE KEY UPDATE is_restricted = TRUE;

INSERT INTO system_settings (setting_key, setting_value, is_sensitive) VALUES
  ('business_name', 'OGAH JOHN BUSINESS CENTER - UDUS MINI MART', FALSE),
  ('admin_notification_email', 'campuscoretv@gmail.com', FALSE),
  ('full_time_nigerian_fee', '12000.00', FALSE),
  ('full_time_foreign_fee', '25000.00', FALSE),
  ('exemption_fee', '15000.00', TRUE),
  ('exclusion_fee', '15000.00', TRUE),
  ('registration_available', 'true', FALSE),
  ('application_reference_format', 'NERD-{YYYY}-{SEQUENCE}', FALSE)
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
