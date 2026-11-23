-- Widen applications.programme_type for the supported qualification names.
SET @programme_type_data_type := (
  SELECT DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'applications'
    AND COLUMN_NAME = 'programme_type'
);

SET @statement := IF(
  @programme_type_data_type IS NOT NULL
    AND LOWER(@programme_type_data_type) <> 'varchar',
  'ALTER TABLE applications MODIFY programme_type VARCHAR(80) NULL',
  'SELECT 1'
);

PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
