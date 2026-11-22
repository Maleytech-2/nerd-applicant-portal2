# Production Deployment

## Hosting Requirements

Use a host that supports:

- Node.js 18 or later
- Persistent MySQL 8 access
- HTTPS termination
- Persistent private file storage
- Background command execution or scheduling

Traditional PHP-only hosting is not suitable.

For a step-by-step Hostinger VPS setup, see [Hostinger VPS Deployment](../../docs/HOSTINGER_VPS.md).
The VPS route is recommended for this portal because it gives you control over
the long-running Node.js process and persistent private document storage. A
managed Node.js plan is suitable only if it explicitly supports persistent
private files, MySQL connections, and the portal's background email processing.

## Environment

Copy `.env.example` to `.env` on the server and set every required value.

Never commit `.env`, database passwords, SMTP passwords, or session secrets.

Generate a session secret with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Set `NODE_ENV=production`, `APP_URL=https://your-domain.example`, and a real private
storage path outside the public web directory.

HTTPS must terminate in front of Node.js. The session cookie is set with `Secure`
automatically in production.

## Database

Create a limited MySQL user and initialize the database. By default,
initialization creates the database and requires database-creation privileges.
If the hosting provider created the database already and the user cannot create
databases, initialize only the selected database:

```powershell
npm install --omit=dev
$env:DB_INIT_CREATE_DATABASE="false"
npm run db:init
$env:DB_INIT_CREATE_DATABASE=$null
npm run db:migrate
```

Set `DATABASE_URL` in `.env` to
`mysql://USER:PASSWORD@HOST:PORT/DATABASE`, using the database name assigned by
the host. URL-encode reserved characters in the username or password. Keep the
URL private and do not paste it into chat or commit it.
Do not use a MySQL account with unnecessary global privileges.

## First Administrator

Set temporary environment variables in the secure shell, then run:

```powershell
$env:INIT_ADMIN_FULL_NAME="First Administrator"
$env:INIT_ADMIN_EMAIL="admin@example.com"
$env:INIT_ADMIN_PHONE="+2348000000000"
$env:INIT_ADMIN_PASSWORD="Use-A-Unique-Strong-Password"
npm run admin:create
Remove-Item Env:INIT_ADMIN_FULL_NAME,Env:INIT_ADMIN_EMAIL,Env:INIT_ADMIN_PHONE,Env:INIT_ADMIN_PASSWORD
```

The script refuses to create an additional administrator.

## SMTP

For Gmail, set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`,
`SMTP_SECURE=true`, and `SMTP_USER` to the Gmail account used to send portal
email. Create a Google App Password for that account and set it as
`SMTP_PASSWORD`; do not use or share the account's regular password. Set
`SMTP_FROM` to the same Gmail address and `ADMIN_NOTIFICATION_EMAIL` to the
inbox that should receive payment alerts. Administrators can change the payment
notification recipient later in **Admin Dashboard → Audit logs & settings → System
settings**; the saved dashboard setting takes precedence over this environment default.

Restart the portal after changing `.env`. The server processes queued email at
startup and once per minute, including pending payment alerts. To run a manual
retry:

```powershell
npm run email:process
```

Failed deliveries remain in `email_notifications` for retry.

On Windows, Gmail SMTP can be configured locally without exposing the App Password in
the command or source control:

```powershell
npm run smtp:configure
```

Enter the Gmail App Password when prompted. Restart the portal afterward, then run
`npm run email:process` to retry any queued email.

Administrators can change the outgoing sender in **Admin Dashboard → Audit logs &
settings → System settings → Outgoing email sender**. Enter the sender address,
provider SMTP host, port, encryption mode, SMTP username, and password or App Password.
The portal verifies the connection and credentials before saving. Credentials are
encrypted in `system_settings` using a key derived from `SESSION_SECRET`; keep that
secret stable and backed up, or reconfigure the sender after rotating it. Gmail
requires the sender address and SMTP username to be the same account and an App Password
when 2-Step Verification is enabled.

## Backups

Database:

```powershell
.\scripts\backup-database.ps1 -OutputDirectory "C:\Backups\nerd-db"
```

Private files:

```powershell
.\scripts\backup-files.ps1 -OutputDirectory "C:\Backups\nerd-files"
```

Backups must be encrypted or stored on access-controlled off-host storage.
Test restore procedures regularly.

## Start

```powershell
npm start
```

In production, run the application behind a process manager or the host platform's
Node.js service manager. The server handles `SIGTERM` and `SIGINT` gracefully.

## Deployment Checklist

- TLS certificate active and automatic renewal configured
- `NODE_ENV=production`
- Session and database secrets unique
- Private storage outside public web root and backed up
- Database initialization and migration complete
- First administrator created securely
- SMTP configured and queue worker scheduled
- Health endpoint verified
- Applicant registration tested
- Login, logout, password reset, and role restrictions tested
- Payment and document upload file limits verified
- Backups completed and restore tested
- Application and audit logs monitored

## Verification

Verify:

```text
https://your-domain.example/health
https://your-domain.example/
https://your-domain.example/applicant/register
```

The health endpoint should report database connectivity. Verify HTTPS redirects,
security headers, login restrictions, private document access, and administrator actions
before opening registration to applicants.
