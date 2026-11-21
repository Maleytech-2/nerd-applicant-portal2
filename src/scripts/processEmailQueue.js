require("dotenv").config();
const { processEmailQueue } = require("../services/emailService");
const db = require("../config/database");

processEmailQueue({ batchSize: 20, maxAttempts: 5 })
  .then((result) => {
    console.log(JSON.stringify(result));
  })
  .catch((error) => {
    console.error("Email queue processing failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.end());
