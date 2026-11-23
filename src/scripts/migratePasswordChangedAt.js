// Deprecated: use `npm run db:migrate` (src/scripts/migrate.js) instead.
require("dotenv").config();
const mysql = require("mysql2/promise");
const { getDatabaseConfig } = require("../config/databaseConfig");

async function migrate() {
  const databaseConfig = getDatabaseConfig();
  const connection = await mysql.createConnection({
    ...databaseConfig,
  });
  const [columns] = await connection.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=:databaseName
       AND TABLE_NAME='users'
       AND COLUMN_NAME='password_changed_at'`,
    { databaseName: databaseConfig.database }
  );
  if (!columns.length) {
    await connection.execute(
      "ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER password_hash"
    );
  }
  await connection.end();
  console.log("Password change session migration completed.");
}

migrate().catch((error) => {
  console.error("Password change migration failed:", error.message);
  process.exit(1);
});
