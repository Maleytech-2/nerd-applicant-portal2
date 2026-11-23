const path = require("path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const dotenv = require("dotenv");

dotenv.config();

const { createSessionStore } = require("./config/session");
const { createContentSecurityPolicy } = require("./config/contentSecurityPolicy");
const { csrfProtection } = require("./middleware/csrf");
const { notFound, errorHandler } = require("./middleware/errorHandler");
const healthRoutes = require("./routes/healthRoutes");
const authRoutes = require("./routes/authRoutes");
const eligibilityRoutes = require("./routes/eligibilityRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const adminRoutes = require("./routes/adminRoutes");
const applicationRoutes = require("./routes/applicationRoutes");
const documentRoutes = require("./routes/documentRoutes");
const applicationReviewRoutes = require("./routes/applicationReviewRoutes");
const clearanceRoutes = require("./routes/clearanceRoutes");
const staffRoutes = require("./routes/staffRoutes");
const reportRoutes = require("./routes/reportRoutes");
const systemRoutes = require("./routes/systemRoutes");
const { requireAuth, requireRole } = require("./middleware/auth");

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === "production"
    ? createContentSecurityPolicy(path.join(__dirname, "..", "public"))
    : false,
  crossOriginResourcePolicy: { policy: "same-site" },
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.use(session({
  name: "nerd.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  store: createSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

app.use(csrfProtection);

app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
}));

app.use(express.static(path.join(__dirname, "..", "public")));
app.use(healthRoutes);
app.use("/api", authRoutes);
app.use("/api", eligibilityRoutes);
app.use("/api", paymentRoutes);
app.use("/api", adminRoutes);
app.use("/api", applicationRoutes);
app.use("/api", documentRoutes);
app.use("/api", applicationReviewRoutes);
app.use("/api", clearanceRoutes);
app.use("/api", staffRoutes);
app.use("/api", reportRoutes);
app.use("/api", systemRoutes);

app.get("/applicant/register", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "auth", "register.html"));
});
app.get("/applicant/register.html", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "auth", "register.html"));
});
app.get("/applicant/login", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "auth", "login.html"));
});
app.get("/applicant/forgot-password", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "auth", "forgot-password.html"));
});
app.get("/applicant/reset-password", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "auth", "reset-password.html"));
});
app.get("/applicant/dashboard", requireAuth, requireRole("applicant"), (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "applicant", "dashboard.html"));
});
app.get("/applicant/eligibility", requireAuth, requireRole("applicant"), (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "applicant", "eligibility.html"));
});
app.get("/applicant/payment", requireAuth, requireRole("applicant"), (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "applicant", "payment.html"));
});
app.get("/applicant/application", requireAuth, requireRole("applicant"), (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "applicant", "application.html"));
});
app.get("/admin/dashboard", requireAuth, requireRole("administrator"), (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "dashboard.html"));
});
app.get("/admin/applications", requireAuth, requireRole("administrator", "staff"), (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "applications.html"));
});
app.get("/staff/dashboard", requireAuth, requireRole("staff"), (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "staff", "dashboard.html"));
});
app.get("/admin/reports", requireAuth, requireRole("administrator", "staff"), (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "reports.html"));
});
app.get("/admin/system", requireAuth, requireRole("administrator"), (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "system.html"));
});
app.get("/admin/staff-dashboard", requireAuth, requireRole("administrator"), (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "staff.html"));
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
