require("dotenv").config();
const mysql = require("mysql2/promise");

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    const [columns] = await connection.execute(
      `SELECT DATA_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA=?
         AND TABLE_NAME='applications'
         AND COLUMN_NAME='programme_type'`,
      [process.env.DB_NAME]
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
