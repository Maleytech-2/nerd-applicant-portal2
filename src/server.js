require("dotenv").config();

const fs = require("fs");
const EMAIL_QUEUE_INTERVAL_MS = 60 * 1000;

function validateProductionEnvironment() {
  if (process.env.NODE_ENV !== "production") return;
  const required = [
    "SESSION_SECRET",
    "DATABASE_URL_STRING",
    "APP_URL",
    "PRIVATE_STORAGE_ROOT",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
  if (process.env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters in production.");
  }
}

function validatePrivateStorage() {
  const { PRIVATE_STORAGE_ROOT } = require("./services/paymentService");
  fs.mkdirSync(PRIVATE_STORAGE_ROOT, { recursive: true, mode: 0o700 });
  fs.accessSync(PRIVATE_STORAGE_ROOT, fs.constants.W_OK);
}

let server;
let emailQueueTimer;

async function applyPendingMigrations() {
  const { migrateConfiguredDatabase } = require("./scripts/migrate");
  const result = await migrateConfiguredDatabase();
  if (result.newlyApplied.length) {
    console.log(
      `Applied ${result.newlyApplied.length} database migration(s): ${result.newlyApplied.join(", ")}`
    );
  } else {
    console.log("Database schema is up to date.");
  }
}

async function start() {
  validateProductionEnvironment();
  validatePrivateStorage();

  try {
    await applyPendingMigrations();
  } catch (error) {
    console.error("Database migration failed; refusing to start:", error.message);
    process.exit(1);
  }

  const app = require("./app");
  const port = Number(process.env.PORT || 3000);

  server = app.listen(port, () => {
    console.log(`NERD Clearance Portal listening on port ${port}`);
    processPendingEmails();
  });

  emailQueueTimer = setInterval(processPendingEmails, EMAIL_QUEUE_INTERVAL_MS);
  emailQueueTimer.unref();
}

let emailQueueProcessing = false;
async function processPendingEmails() {
  if (emailQueueProcessing) return;
  emailQueueProcessing = true;
  try {
    const { processEmailQueue } = require("./services/emailService");
    const result = await processEmailQueue({ batchSize: 20, maxAttempts: 5 });
    if (result.reason === "SMTP_NOT_CONFIGURED") {
      console.warn("Email delivery is disabled: configure SMTP credentials in the administrator settings.");
      return;
    }
    if (result.processed > 0) {
      console.log(`Email queue processed: ${result.sent} sent, ${result.failed} failed.`);
    }
  } catch (error) {
    console.error("Email queue processing failed:", error);
  } finally {
    emailQueueProcessing = false;
  }
}

function shutdown(signal) {
  console.log(`${signal} received; shutting down gracefully.`);
  if (emailQueueTimer) clearInterval(emailQueueTimer);
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((error) => {
  console.error("Failed to start the portal:", error.message);
  process.exit(1);
});
