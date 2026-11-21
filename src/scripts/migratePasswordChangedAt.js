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
  const [columns] = await connection.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=:databaseName
       AND TABLE_NAME='users'
       AND COLUMN_NAME='password_changed_at'`,
    { databaseName: process.env.DB_NAME }
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
