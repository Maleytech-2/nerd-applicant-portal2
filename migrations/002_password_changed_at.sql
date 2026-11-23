-- Track password changes so existing sessions can be invalidated.
-- MySQL does not support ADD COLUMN IF NOT EXISTS, so check the catalog first.
SET @has_password_changed_at := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'password_changed_at'
);

SET @statement := IF(
  @has_password_changed_at = 0,
  'ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER password_hash',
  'SELECT 1'
);

PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
