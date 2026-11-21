const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");

dotenv.config();

async function initDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  });

  const schemaPath = path.join(__dirname, "..", "..", "database", "schema.sql");
  let schema = fs.readFileSync(schemaPath, "utf8");
  const databaseName = process.env.DB_NAME || "nerd_clearance_portal";
  if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error("DB_NAME must contain only letters, numbers, and underscores.");
  }
  schema = schema
    .replace(/CREATE DATABASE IF NOT EXISTS nerd_clearance_portal/g, `CREATE DATABASE IF NOT EXISTS ${databaseName}`)
    .replace(/USE nerd_clearance_portal/g, `USE ${databaseName}`);
  await connection.query(schema);
  await connection.end();
  console.log("Database initialized successfully.");
}

initDatabase().catch((error) => {
  console.error("Database initialization failed:", error.message);
  process.exit(1);
});
