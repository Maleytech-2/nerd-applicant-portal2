const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
const { getDatabaseConfig } = require("./databaseConfig");

dotenv.config();

const pool = mysql.createPool({
  ...getDatabaseConfig(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true,
  timezone: "Z",
});

module.exports = pool;
