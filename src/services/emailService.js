const nodemailer = require("nodemailer");
const db = require("../config/database");
const { decryptSmtpCredentials } = require("../utils/smtpCredentials");

function getEnvironmentSmtpConfiguration() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    return null;
  }
  const from = process.env.SMTP_FROM || `OGAH JOHN BUSINESS CENTER <${process.env.SMTP_USER}>`;
  const fromAddress = from.match(/<([^>]+)>/)?.[1] || process.env.SMTP_USER;
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from,
    fromAddress,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function getSmtpConfiguration() {
  const [rows] = await db.execute(
    `SELECT setting_value
     FROM system_settings
     WHERE setting_key='smtp_sender_credentials' AND is_sensitive=TRUE
     LIMIT 1`
  );
  if (rows[0]?.setting_value) {
    return decryptSmtpCredentials(rows[0].setting_value);
  }
  return getEnvironmentSmtpConfiguration();
}

function createTransporter(configuration) {
  if (!configuration) return null;
  return nodemailer.createTransport({
    host: configuration.host,
    port: Number(configuration.port),
    secure: Boolean(configuration.secure),
    auth: { user: configuration.user, pass: configuration.password },
  });
}

async function verifySmtpConfiguration(configuration) {
  const transporter = createTransporter(configuration);
  try {
    await transporter.verify();
  } finally {
    transporter.close();
  }
}

function brandedTemplate(title, introduction, details = []) {
  const detailRows = details.map(([label, value]) => `
    <tr><td style="padding:8px 12px;border-bottom:1px solid #e4e9f0;color:#68758a">${escapeHtml(label)}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #e4e9f0;color:#17243a;font-weight:700">${escapeHtml(value)}</td></tr>
  `).join("");
  return `
    <div style="max-width:620px;margin:auto;font-family:Segoe UI,Arial,sans-serif;color:#17243a">
      <div style="padding:24px;background:#0b1f3a;color:white">
        <strong>OGAH JOHN BUSINESS CENTER - UDUS MINI MART</strong>
        <div style="margin-top:4px;font-size:12px;color:#d6ad60">Independent NERD Clearance Registration Assistance</div>
      </div>
      <div style="padding:28px;border:1px solid #dde4ed;border-top:0">
        <h2 style="color:#0b1f3a">${escapeHtml(title)}</h2>
        <p>${escapeHtml(introduction)}</p>
        ${detailRows ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0">${detailRows}</table>` : ""}
        <p style="color:#68758a;font-size:13px">This message was sent by an independent registration assistance portal and is not from the official NERD website.</p>
      </div>
    </div>
  `;
}

function renderTemplate(templateName, payload = {}) {
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const templates = {
    password_reset: {
      subject: "Reset your NERD Clearance Portal password",
      text: `Use this secure link within 30 minutes: ${payload.resetLink}`,
      html: `
        ${brandedTemplate(
          "Password reset request",
          `Hello ${payload.fullName || "Applicant"}, use the secure button below within 30 minutes.`,
          []
        ).replace("</div>\n  ", `<p><a href="${escapeHtml(payload.resetLink)}" style="display:inline-block;padding:12px 18px;border-radius:7px;background:#d6ad60;color:#0b1f3a;font-weight:bold;text-decoration:none">Reset password</a></p></div>\n  `)}
      `
    },
    account_registered: {
      subject: "Your applicant account is ready",
      text: `Welcome ${payload.fullName || "Applicant"}. Continue with eligibility screening.`,
      html: brandedTemplate("Account registration confirmed", `Welcome ${payload.fullName || "Applicant"}.`, [
        ["Next step", "Complete eligibility screening"],
        ["Portal", appUrl],
      ]),
    },
    eligibility_result: {
      subject: "Your eligibility screening result",
      text: payload.eligible ? "Eligibility confirmed." : `Not eligible: ${payload.rejectionReason}`,
      html: brandedTemplate(
        payload.eligible ? "Eligibility confirmed" : "Eligibility not confirmed",
        payload.eligible ? "You may proceed according to the portal's next stage." : String(payload.rejectionReason || "Eligibility requirements were not met."),
        payload.eligible ? [["Applicable Full-Time fee", `N${payload.fee}`], ["Next step", "Submit payment evidence"]] : []
      ),
    },
    eligibility_review_decision: {
      subject: "Your eligibility review has been updated",
      text: payload.approved
        ? "Your eligibility review was approved. Sign in to continue to payment."
        : "Your eligibility review was not approved. Sign in or contact the registration team for assistance.",
      html: brandedTemplate(
        payload.approved ? "Eligibility review approved" : "Eligibility review completed",
        payload.approved
          ? "An administrator reviewed your details. Sign in to continue to payment and the application."
          : "An administrator completed the review. Sign in to the portal or contact the registration team for assistance.",
        [["Next step", payload.approved ? "Continue to payment" : "Contact the registration team"]]
      ),
    },
    payment_received: {
      subject: "Payment claim received",
      text: `Your payment claim is ${payload.status || "pending verification"}.`,
      html: brandedTemplate("Payment claim received", "Your claim has been saved. It has not been approved.", [
        ["Status", payload.status || "pending verification"],
        ["Transaction reference", payload.transactionReference],
      ]),
    },
    payment_approved: {
      subject: "Payment approved",
      text: "Your payment was approved. The main application form is now available.",
      html: brandedTemplate("Payment approved", "An administrator verified your payment.", [
        ["Status", "Approved"],
        ["Next step", "Complete the application form"],
      ]),
    },
    payment_rejected: {
      subject: "Payment claim rejected",
      text: "Your payment claim was rejected. Review the administrator's notification.",
      html: brandedTemplate("Payment claim rejected", "The administrator could not approve this payment claim.", [
        ["Status", "Rejected"],
        ["Reason", payload.reason || "See the portal for details"],
      ]),
    },
    correction_requested: {
      subject: "Application correction required",
      text: "Correction has been requested on your application.",
      html: brandedTemplate("Correction required", "Your application needs authorized corrections.", [
        ["Reason", payload.reason || "See the applicant portal"],
      ]),
    },
    application_submitted: {
      subject: "Application submitted successfully",
      text: `Your application ${payload.applicationReference || ""} was submitted.`,
      html: brandedTemplate("Application submitted", "Your complete application is now awaiting review.", [
        ["Application reference", payload.applicationReference],
      ]),
    },
    clearance_available: {
      subject: "Final clearance is available",
      text: "Your final clearance is available in the applicant portal.",
      html: brandedTemplate("Final clearance available", "Log in to securely view or download your clearance PDF.", [
        ["Portal", `${appUrl}/applicant/dashboard`],
      ]),
    },
    new_payment_claim: {
      subject: "New payment claim requires verification",
      text: "A new applicant payment claim has been submitted.",
      html: brandedTemplate("New payment claim", "A payment claim requires manual administrator verification.", [
        ["Applicant", payload.applicantName],
        ["Applicant reference", payload.applicantReference],
        ["Email", payload.email],
        ["Phone", payload.phone],
        ["Nationality", payload.nationality],
        ["Amount submitted", payload.amountSubmitted ? `N${payload.amountSubmitted}` : ""],
        ["Expected amount", payload.expectedAmount ? `N${payload.expectedAmount}` : ""],
        ["Payment channel", payload.paymentChannel],
        ["Transaction reference", payload.transactionReference],
        ["Payment date", payload.paymentDate],
        ["Submitted", payload.submittedAt],
      ]),
    },
  };
  return templates[templateName] || {
    subject: "NERD Clearance Portal notification",
    text: "There is a new update in your applicant portal.",
    html: brandedTemplate("Portal notification", "There is a new update in your applicant portal."),
  };
}

async function queueNotification({ recipientUserId = null, recipientEmail, templateName, payload = {} }) {
  const rendered = renderTemplate(templateName, payload);
  await db.execute(
    `INSERT INTO email_notifications
      (recipient_user_id, recipient_email, template_name, subject, payload, status)
     VALUES
      (:recipientUserId, :recipientEmail, :templateName, :subject, :payload, 'queued')`,
    {
      recipientUserId,
      recipientEmail,
      templateName,
      subject: rendered.subject,
      payload: JSON.stringify(payload),
    }
  );
  return { queued: true };
}

async function processEmailQueue({ batchSize = 20, maxAttempts = 5 } = {}) {
  const configuration = await getSmtpConfiguration();
  if (!configuration) return { processed: 0, sent: 0, failed: 0, reason: "SMTP_NOT_CONFIGURED" };
  const transporter = createTransporter(configuration);
  const [queued] = await db.execute(
    `SELECT id, recipient_email, template_name, payload, attempts
     FROM email_notifications
     WHERE status IN ('queued', 'failed') AND attempts < :maxAttempts
     ORDER BY created_at ASC
     LIMIT :batchSize`,
    { maxAttempts, batchSize }
  );
  let sent = 0;
  let failed = 0;

  try {
    for (const notification of queued) {
      const payload = notification.payload ? JSON.parse(notification.payload) : {};
      const rendered = renderTemplate(notification.template_name, payload);
      const attempts = notification.attempts + 1;
      try {
        await transporter.sendMail({
          from: configuration.from,
          to: notification.recipient_email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        });
        await db.execute(
          `UPDATE email_notifications
           SET status='sent', attempts=:attempts, sent_at=CURRENT_TIMESTAMP, last_error=NULL
           WHERE id=:id`,
          { attempts, id: notification.id }
        );
        sent++;
      } catch (error) {
        const status = attempts >= maxAttempts ? "failed" : "queued";
        await db.execute(
          `UPDATE email_notifications
           SET status=:status, attempts=:attempts, last_error=:lastError
           WHERE id=:id`,
          { status, attempts, lastError: error.message, id: notification.id }
        );
        failed++;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    transporter.close();
  }
  return { processed: queued.length, sent, failed };
}

async function sendPasswordResetEmail({ to, fullName, resetLink }) {
  const configuration = await getSmtpConfiguration();
  if (!configuration) return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
  const rendered = renderTemplate("password_reset", { fullName, resetLink });
  const transporter = createTransporter(configuration);
  try {
    await transporter.sendMail({
      from: configuration.from,
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    return { sent: true };
  } finally {
    transporter.close();
  }
}

module.exports = {
  escapeHtml,
  getSmtpConfiguration,
  queueNotification,
  processEmailQueue,
  renderTemplate,
  sendPasswordResetEmail,
  verifySmtpConfiguration,
};
