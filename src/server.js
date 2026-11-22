require("dotenv").config();

const EMAIL_QUEUE_INTERVAL_MS = 60 * 1000;

function validateProductionEnvironment() {
  if (process.env.NODE_ENV !== "production") return;
  const required = [
    "SESSION_SECRET",
    "DATABASE_URL",
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

validateProductionEnvironment();
const app = require("./app");
const { processEmailQueue } = require("./services/emailService");
const port = Number(process.env.PORT || 3000);

const server = app.listen(port, () => {
  console.log(`NERD Clearance Portal listening on port ${port}`);
  processPendingEmails();
});

let emailQueueProcessing = false;
async function processPendingEmails() {
  if (emailQueueProcessing) return;
  emailQueueProcessing = true;
  try {
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

const emailQueueTimer = setInterval(processPendingEmails, EMAIL_QUEUE_INTERVAL_MS);
emailQueueTimer.unref();

function shutdown(signal) {
  console.log(`${signal} received; shutting down gracefully.`);
  clearInterval(emailQueueTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
