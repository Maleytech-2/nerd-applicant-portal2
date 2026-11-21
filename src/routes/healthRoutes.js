const express = require("express");
const db = require("../config/database");

const router = express.Router();

router.get("/health", async (_req, res, next) => {
  try {
    await db.query("SELECT 1");
    res.json({ success: true, status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

router.get("/api/csrf-token", (req, res) => {
  res.json({ success: true, csrfToken: res.locals.csrfToken });
});

module.exports = router;
