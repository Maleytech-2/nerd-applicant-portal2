const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
const { getDatabaseConfig } = require("../config/databaseConfig");

dotenv.config();

async function initDatabase() {
  const databaseConfig = getDatabaseConfig();
  const databaseName = databaseConfig.database;
  if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error("The database name in DATABASE_URL_STRING must contain only letters, numbers, and underscores.");
  }
  const createDatabase = process.env.DB_INIT_CREATE_DATABASE !== "false";
  const connection = await mysql.createConnection({
    ...getDatabaseConfig({ includeDatabase: !createDatabase }),
    multipleStatements: true,
  });

  try {
    const schemaPath = path.join(__dirname, "..", "..", "database", "schema.sql");
    let schema = fs.readFileSync(schemaPath, "utf8");
    if (createDatabase) {
      schema = schema
        .replace(/CREATE DATABASE IF NOT EXISTS nerd_clearance_portal/g, `CREATE DATABASE IF NOT EXISTS ${databaseName}`)
        .replace(/USE nerd_clearance_portal/g, `USE ${databaseName}`);
    } else {
      schema = schema
        .replace(/CREATE DATABASE IF NOT EXISTS nerd_clearance_portal[\s\S]*?;\s*/i, "")
        .replace(/USE nerd_clearance_portal;\s*/i, "");
    }
    await connection.query(schema);
    console.log("Database initialized successfully.");
  } finally {
    await connection.end();
  }
}

initDatabase().catch((error) => {
  console.error("Database initialization failed:", error.message);
  process.exit(1);
});
