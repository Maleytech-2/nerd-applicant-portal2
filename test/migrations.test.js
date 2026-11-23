const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MIGRATIONS_DIRECTORY,
  MIGRATIONS_TABLE,
  loadMigrations,
  runMigrations,
  getStatus,
} = require("../src/scripts/migrate");

const silentLogger = { log() {} };

function createFakeConnection({ existingTables = [], appliedVersions = [] } = {}) {
  const executed = [];
  const applied = new Set(appliedVersions);

  return {
    executed,
    async execute(sql, params = []) {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) {
        const [tableName] = params;
        return [[{ table_count: existingTables.includes(tableName) ? 1 : 0 }]];
      }
      if (sql.startsWith(`INSERT INTO ${MIGRATIONS_TABLE}`)) {
        applied.add(params[0]);
        return [{ affectedRows: 1 }];
      }
      return [{}];
    },
    async query(sql, params) {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (sql.trimStart().startsWith(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE}`)) return [{}];
      if (sql.includes(`SELECT version FROM ${MIGRATIONS_TABLE}`)) {
        return [[...applied].map((version) => ({ version }))];
      }
      if (params && sql.includes("?")) return [{}];
      executed.push(sql);
      return [{}];
    },
  };
}

const fakeMigrations = [
  { version: "001_initial_schema.sql", sql: "BASELINE SQL" },
  { version: "002_add_column.sql", sql: "SECOND SQL" },
];

test("loads migration files in version order", () => {
  const migrations = loadMigrations();
  assert.ok(migrations.length >= 1);
  assert.equal(migrations[0].version, "001_initial_schema.sql");
  assert.deepEqual(
    migrations.map((migration) => migration.version),
    [...migrations.map((migration) => migration.version)].sort()
  );
  assert.equal(new Set(migrations.map((migration) => migration.version)).size, migrations.length);
  assert.ok(migrations.every((migration) => migration.sql.trim().length > 0));
  assert.ok(MIGRATIONS_DIRECTORY.endsWith("migrations"));
});

test("applies every migration to a fresh database", async () => {
  const connection = createFakeConnection();

  const result = await runMigrations({ connection, migrations: fakeMigrations, logger: silentLogger });

  assert.deepEqual(result.newlyApplied, ["001_initial_schema.sql", "002_add_column.sql"]);
  assert.equal(result.baselined, false);
  assert.deepEqual(connection.executed, ["BASELINE SQL", "SECOND SQL"]);
});

test("baselines an existing database instead of re-running the schema seed", async () => {
  const connection = createFakeConnection({ existingTables: ["users"] });

  const result = await runMigrations({ connection, migrations: fakeMigrations, logger: silentLogger });

  assert.deepEqual(result.newlyApplied, ["001_initial_schema.sql", "002_add_column.sql"]);
  assert.equal(result.baselined, true);
  assert.deepEqual(connection.executed, ["SECOND SQL"]);
});

test("does nothing when every migration has been applied", async () => {
  const connection = createFakeConnection({
    existingTables: ["users", MIGRATIONS_TABLE],
    appliedVersions: ["001_initial_schema.sql", "002_add_column.sql"],
  });

  const result = await runMigrations({ connection, migrations: fakeMigrations, logger: silentLogger });

  assert.deepEqual(result.newlyApplied, []);
  assert.equal(result.pending, 0);
  assert.deepEqual(connection.executed, []);
});

test("reruns the baseline after a failed first migration attempt", async () => {
  const connection = createFakeConnection({
    existingTables: ["users", MIGRATIONS_TABLE],
  });

  const result = await runMigrations({ connection, migrations: fakeMigrations, logger: silentLogger });

  assert.equal(result.baselined, false);
  assert.deepEqual(connection.executed, ["BASELINE SQL", "SECOND SQL"]);
});

test("reports pending migrations for an existing database", async () => {
  const connection = createFakeConnection({
    existingTables: ["users", MIGRATIONS_TABLE],
    appliedVersions: ["001_initial_schema.sql"],
  });

  const status = await getStatus(connection, fakeMigrations);

  assert.deepEqual(status.applied.map((migration) => migration.version), ["001_initial_schema.sql"]);
  assert.deepEqual(status.pending.map((migration) => migration.version), ["002_add_column.sql"]);
  assert.equal(status.isLegacyDatabase, false);
});

test("reports the baseline migration as pending for an untracked database", async () => {
  const connection = createFakeConnection({ existingTables: ["users"] });

  const status = await getStatus(connection, fakeMigrations);

  assert.deepEqual(status.pending.map((migration) => migration.version), [
    "001_initial_schema.sql",
    "002_add_column.sql",
  ]);
  assert.equal(status.isLegacyDatabase, true);
});
