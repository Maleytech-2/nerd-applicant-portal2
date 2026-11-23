require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { getDatabaseConfig } = require("../config/databaseConfig");

const MIGRATIONS_DIRECTORY = path.join(__dirname, "..", "..", "migrations");
const MIGRATIONS_TABLE = "schema_migrations";
const BASELINE_MIGRATION = "001_initial_schema.sql";
const LOCK_NAME = "nerd_clearance_portal_schema_migrations";
const LOCK_TIMEOUT_SECONDS = 60;

function loadMigrations(directory = MIGRATIONS_DIRECTORY) {
  let entries;
  try {
    entries = fs.readdirSync(directory);
  } catch (error) {
    throw new Error(`Unable to read the migrations directory at ${directory}: ${error.message}`);
  }

  const files = entries.filter((entry) => entry.endsWith(".sql")).sort();
  if (!files.length) {
    throw new Error(`No .sql migration files found in ${directory}.`);
  }

  return files.map((filename) => ({
    version: filename,
    sql: fs.readFileSync(path.join(directory, filename), "utf8"),
  }));
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS table_count
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(rows[0].table_count) > 0;
}

async function ensureMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (version)
    ) ENGINE=InnoDB
  `);
}

async function getAppliedVersions(connection) {
  const [rows] = await connection.query(
    `SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version`
  );
  return new Set(rows.map((row) => row.version));
}

async function acquireLock(connection) {
  const [rows] = await connection.query("SELECT GET_LOCK(?, ?) AS acquired", [
    LOCK_NAME,
    LOCK_TIMEOUT_SECONDS,
  ]);
  if (Number(rows[0].acquired) !== 1) {
    throw new Error(
      `Timed out after ${LOCK_TIMEOUT_SECONDS}s waiting for the migration lock. Another deployment may be migrating the database.`
    );
  }
}

async function releaseLock(connection) {
  try {
    await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
  } catch (error) {
    console.warn(`Could not release the migration lock: ${error.message}`);
  }
}

async function runMigrations({ connection, migrations = loadMigrations(), logger = console } = {}) {
  // A database that already has the core users table but no migration history
  // was created before migrations were tracked. Skip the baseline schema (its
  // seed statements would overwrite admin settings) and run only the
  // incremental migrations that follow it. If schema_migrations already
  // exists, a previous migration attempt started; rerun any pending files.
  const migrationsTableExisted = await tableExists(connection, MIGRATIONS_TABLE);
  const isLegacyDatabase = (await tableExists(connection, "users")) && !migrationsTableExisted;
  await ensureMigrationsTable(connection);
  await acquireLock(connection);

  try {
    const appliedVersions = await getAppliedVersions(connection);
    const pending = migrations.filter((migration) => !appliedVersions.has(migration.version));
    const newlyApplied = [];
    let baselined = false;

    for (const migration of pending) {
      if (isLegacyDatabase && appliedVersions.size === 0 && migration.version === BASELINE_MIGRATION) {
        logger.log(`Baselining existing database: marking ${migration.version} as applied.`);
        baselined = true;
      } else {
        logger.log(`Applying ${migration.version}...`);
        await connection.query(migration.sql);
      }

      await connection.execute(
        `INSERT INTO ${MIGRATIONS_TABLE} (version) VALUES (?)`,
        [migration.version]
      );
      appliedVersions.add(migration.version);
      newlyApplied.push(migration.version);
    }

    return { newlyApplied, baselined, pending: pending.length };
  } finally {
    await releaseLock(connection);
  }
}

async function getStatus(connection, migrations = loadMigrations()) {
  const hasMigrationsTable = await tableExists(connection, MIGRATIONS_TABLE);
  const appliedVersions = hasMigrationsTable ? await getAppliedVersions(connection) : new Set();
  const isLegacyDatabase = (await tableExists(connection, "users")) && !hasMigrationsTable;

  return {
    applied: migrations.filter((migration) => appliedVersions.has(migration.version)),
    pending: migrations.filter((migration) => !appliedVersions.has(migration.version)),
    isLegacyDatabase,
  };
}

async function main(argv = process.argv.slice(2)) {
  const statusOnly = argv.includes("--status");
  const databaseConfig = getDatabaseConfig();
  const connection = await mysql.createConnection({
    ...databaseConfig,
    multipleStatements: true,
  });

  try {
    if (statusOnly) {
      const status = await getStatus(connection);
      console.log(`Database: ${databaseConfig.database}`);
      for (const migration of status.applied) {
        console.log(`  applied  ${migration.version}`);
      }
      for (const migration of status.pending) {
        const note = status.isLegacyDatabase && migration.version === BASELINE_MIGRATION
          ? " (will be baselined)"
          : "";
        console.log(`  pending  ${migration.version}${note}`);
      }
      if (!status.pending.length) {
        console.log("Database is up to date.");
      }
      return;
    }

    const result = await runMigrations({ connection });
    if (!result.pending) {
      console.log(`No pending migrations. Database ${databaseConfig.database} is up to date.`);
      return;
    }

    if (result.baselined) {
      console.log("Existing database baselined; baseline schema was not re-run.");
    }
    console.log(
      `Applied ${result.newlyApplied.length} migration(s) to ${databaseConfig.database}: ${result.newlyApplied.join(", ")}`
    );
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Database migration failed:", error.message);
    process.exit(1);
  });
}

module.exports = {
  MIGRATIONS_DIRECTORY,
  MIGRATIONS_TABLE,
  loadMigrations,
  runMigrations,
  getStatus,
  tableExists,
};
