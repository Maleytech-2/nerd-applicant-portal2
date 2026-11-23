// Deprecated: use `npm run db:migrate` (src/scripts/migrate.js) instead.
require("dotenv").config();
const mysql = require("mysql2/promise");
const { getDatabaseConfig } = require("../config/databaseConfig");

async function migrate() {
  const databaseConfig = getDatabaseConfig();
  const connection = await mysql.createConnection({
    ...databaseConfig,
  });

  try {
    const databaseName = databaseConfig.database;
    const [columns] = await connection.execute(
      `SELECT DATA_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA=?
         AND TABLE_NAME='applications'
         AND COLUMN_NAME='programme_type'`,
      [databaseName]
    );
    if (!columns.length) throw new Error("applications.programme_type does not exist.");
    if (columns[0].DATA_TYPE.toLowerCase() !== "varchar") {
      await connection.execute(
        "ALTER TABLE applications MODIFY programme_type VARCHAR(80) NULL"
      );
    }
    console.log("Programme type migration completed.");
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  console.error("Programme type migration failed:", error.message);
  process.exit(1);
});
