const test = require("node:test");
const assert = require("node:assert/strict");
const { getDatabaseConfig, parseDatabaseUrl } = require("../src/config/databaseConfig");

test("parses database credentials and database name from DATABASE_URL_STRING", () => {
  const config = parseDatabaseUrl(
    "mysql://portal%40user:p%40ss%3Aword@db.example.com:3307/nerd_portal"
  );

  assert.deepEqual(config, {
    host: "db.example.com",
    port: 3307,
    user: "portal@user",
    password: "p@ss:word",
    database: "nerd_portal",
  });
});

test("uses the MySQL default port and parses JSON URL options", () => {
  const config = parseDatabaseUrl(
    "mysql://portal:secret@db.example.com/nerd_portal?ssl=%7B%22rejectUnauthorized%22%3Atrue%7D"
  );

  assert.equal(config.port, 3306);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("can omit the database for initialization that creates the database", () => {
  const originalUrl = process.env.DATABASE_URL_STRING;
  process.env.DATABASE_URL_STRING = "mysql://portal:secret@db.example.com/nerd_portal";
  try {
    assert.deepEqual(getDatabaseConfig({ includeDatabase: false }), {
      host: "db.example.com",
      port: 3306,
      user: "portal",
      password: "secret",
    });
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL_STRING;
    else process.env.DATABASE_URL_STRING = originalUrl;
  }
});

test("rejects missing and malformed MySQL URLs", () => {
  assert.throws(() => parseDatabaseUrl(""), /DATABASE_URL_STRING is required/);
  assert.throws(() => parseDatabaseUrl("postgres://portal:secret@db/portal"), /mysql:\/\/ or mysql2:\/\//);
  assert.throws(() => parseDatabaseUrl("mysql://portal:secret@db.example.com"), /username, host, and database name/);
  assert.throws(() => parseDatabaseUrl("mysql://portal:secret@db.example.com/%E0%A4%A"), /invalid URL encoding/);
});
