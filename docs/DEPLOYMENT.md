# Production Deployment

## Hosting Requirements

Use a host that supports:

- Node.js 18 or later
- Persistent MySQL 8 access
- HTTPS termination
- Persistent private file storage
- Background command execution or scheduling

Traditional PHP-only hosting is not suitable.

For a step-by-step Hostinger VPS setup, see [Hostinger VPS Deployment](HOSTINGER_VPS.md).
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

`npm run db:migrate` applies every pending file in `migrations/` and records it
in `schema_migrations`. It is idempotent, takes an advisory lock, and is safe to
run on every deployment. Use `npm run db:migrate:status` to inspect applied and
pending migrations.

Set `DATABASE_URL_STRING` in `.env` to
`mysql://USER:PASSWORD@HOST:PORT/DATABASE`, using the database name assigned by
the host. URL-encode reserved characters in the username or password. Keep the
URL private and do not paste it into chat or commit it.
Do not use a MySQL account with unnecessary global privileges.

## Railway

### Required service settings

Add a MySQL service to the same Railway project and environment, then set these
variables on the web service:

```text
NODE_ENV=production
DATABASE_URL_STRING=${{MySQL.MYSQL_URL}}
SESSION_SECRET=<at-least-32-random-characters>
APP_URL=https://your-public-domain.example
PRIVATE_STORAGE_ROOT=/data/private
```

Replace `MySQL` in the reference with the actual database service name. Use the
private `MYSQL_URL`, not `MYSQL_PUBLIC_URL`, so traffic stays on Railway's
private network. `DATABASE_URL_STRING` must use the `mysql://` scheme; `MYSQL_URL`
already does.

Generate the session secret locally:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Persistent uploads

Attach a Railway volume to the web service and mount it at `/data`. Then set
`PRIVATE_STORAGE_ROOT=/data/private`. Uploaded receipts, application documents,
and clearance PDFs are written there. Without a volume, Railway's container
filesystem is ephemeral and all uploads disappear on the next deploy or restart.

### Migrations

The repository's `railway.json` declares `npm run db:migrate` as a pre-deploy
command. Railway executes it after the build and before the new deployment
receives traffic, with access to the service's `DATABASE_URL_STRING` and private
network. A failing migration stops the deployment, so the previous release
keeps serving.

`railway.json` uses Railway's deprecated Config as Code format, and Railway
stops reading it on 2026-12-01. Also, new services cannot opt into Config as
Code. Confirm the pre-deploy command appears on the service's deploy settings;
if it does not, set it in the Railway dashboard under **Settings → Deploy →
Pre-deploy Command**:

```text
npm run db:migrate
```

Alternatively, migrate the setting to Railway Infrastructure as Code
(`.railway/railway.ts`) with `preDeploy: "npm run db:migrate"` and apply it with
`railway config apply`.

Do not also run migrations from `npm start`. The pre-deploy step is the single
place that should apply schema changes. The first deploy against an empty
Railway MySQL database runs the baseline migration; `npm run db:init` is not
needed.

### First administrator

After the first successful deploy, open a Railway shell for the web service and
run the bootstrap with temporary variables:

```bash
INIT_ADMIN_FULL_NAME="First Administrator" \
INIT_ADMIN_EMAIL="admin@example.com" \
INIT_ADMIN_PHONE="+2348000000000" \
INIT_ADMIN_PASSWORD="Use-A-Unique-Strong-Password" \
npm run admin:create
```

The password is not stored in the repository; set it only for that command.

### Health and backups

Railway checks `GET /health`, which verifies the database connection. Enable
Railway MySQL backups or point the existing backup procedure at the database's
public connection URL; private connections are only reachable from inside the
project.

Keep the web service at one replica unless you move the email queue worker out
of the web process. The queue currently processes `email_notifications` in the
running app process and does not take a row-level lock, so multiple replicas can
send the same notification more than once.


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
