# Hostinger VPS Deployment

This guide deploys the portal to a Hostinger VPS running Ubuntu 24.04, with
Node.js, MySQL, Nginx, and HTTPS. A VPS is recommended because the portal needs
a continuously running Node.js process and durable private storage for payment
receipts, application documents, and clearance PDFs.

Hostinger also offers managed Node.js hosting. Before choosing that option,
confirm that your specific plan supports persistent private file storage,
MySQL, HTTPS, and continuously running background email processing. Do not
deploy this application as a static site or to PHP-only hosting. See
[Hostinger's Node.js hosting options](https://www.hostinger.com/nodejs-hosting).

## 1. Prepare Hostinger and your domain

1. Create a VPS with Ubuntu 24.04 LTS in Hostinger hPanel.
2. Point your domain's DNS `A` record to the VPS IPv4 address. If you use
   `www`, point it to the same address.
3. In hPanel, allow inbound SSH, HTTP, and HTTPS traffic. Keep SSH available
   before enabling any server firewall.
4. Connect to the VPS using SSH as the account provided by Hostinger.

Replace `portal.example.com` below with your actual domain.

## 2. Install server software

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y nginx mysql-server git curl ca-certificates

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

node --version
npm --version
```

Use Node.js 22 or another version supported by the host that satisfies the
project's `node >=18` requirement.

Configure the Hostinger firewall and Ubuntu firewall to allow SSH, HTTP, and
HTTPS only. If using UFW, confirm SSH access works before enabling it:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Do not open MySQL port 3306 to the public internet.

## 3. Create the production database

Open the MySQL administrator prompt:

```bash
sudo mysql
```

At the MySQL prompt, create a database and a dedicated account. Replace the
example password with a unique random password; do not reuse an account
password:

```sql
CREATE DATABASE nerd_clearance_portal
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'nerd_portal'@'localhost'
  IDENTIFIED BY 'REPLACE_WITH_A_UNIQUE_RANDOM_PASSWORD';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON nerd_clearance_portal.*
  TO 'nerd_portal'@'localhost';

EXIT;
```

This account is limited to this database; it has no global MySQL privileges.
Keep MySQL bound to localhost unless you have a specific, secured remote
database design.

## 4. Download the application

Create a dedicated, unprivileged service account and install the project:

```bash
sudo useradd --system --home /opt/nerd-clearance-portal \
  --shell /usr/sbin/nologin nerdportal
sudo mkdir -p /opt/nerd-clearance-portal
sudo chown "$USER" /opt/nerd-clearance-portal

git clone --branch main \
  https://github.com/Maleytech-2/nerd-applicant-portal2.git \
  /opt/nerd-clearance-portal

cd /opt/nerd-clearance-portal
npm ci --omit=dev

sudo chown -R root:nerdportal /opt/nerd-clearance-portal
sudo chmod -R o-rwx /opt/nerd-clearance-portal
```

The GitHub repository is public, so do not put production secrets or private
applicant files in it.

## 5. Configure secrets and private file storage

Create a persistent directory outside the web application and public web root:

```bash
sudo install -d -o nerdportal -g nerdportal -m 700 \
  /var/lib/nerd-clearance-portal/private
```

Create the production environment file:

```bash
sudo nano /opt/nerd-clearance-portal/.env
```

Set the following values. Replace the domain, database password, email
addresses, and SMTP credentials with your own values. Generate a unique session
secret with `openssl rand -hex 48`. For Gmail, use an App Password, not your
normal Google password.

```dotenv
NODE_ENV=production
PORT=3000
APP_URL=https://portal.example.com

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=nerd_portal
DB_PASSWORD=REPLACE_WITH_THE_MYSQL_PASSWORD
DB_NAME=nerd_clearance_portal

SESSION_SECRET=REPLACE_WITH_OUTPUT_FROM_OPENSSL
PRIVATE_STORAGE_ROOT=/var/lib/nerd-clearance-portal/private

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-sender@gmail.com
SMTP_PASSWORD=REPLACE_WITH_GMAIL_APP_PASSWORD
SMTP_FROM="NERD Clearance Portal <your-sender@gmail.com>"
ADMIN_NOTIFICATION_EMAIL=your-admin-email@example.com

MAX_UPLOAD_BYTES=10485760
MAX_APPLICATION_UPLOAD_BYTES=10485760
MAX_CLEARANCE_UPLOAD_BYTES=20971520
LOG_LEVEL=info
```

Protect the file so only the service account and root can read it:

```bash
sudo chown root:nerdportal /opt/nerd-clearance-portal/.env
sudo chmod 640 /opt/nerd-clearance-portal/.env
```

Keep the same `SESSION_SECRET` across restarts and deployments. Never commit
this `.env` file, paste its contents into support requests, or place uploaded
documents under the public `public/` directory.

## 6. Initialize the database and create the first administrator

The database was created separately in MySQL, so tell the initializer to use
that database instead of trying to create it with extra privileges:

```bash
cd /opt/nerd-clearance-portal
sudo -u nerdportal env DB_INIT_CREATE_DATABASE=false npm run db:init
sudo -u nerdportal npm run db:migrate
```

Create the first administrator in an interactive shell. Enter a unique
password of at least 14 characters when prompted; avoid placing it directly in
a command or source file:

```bash
sudo -u nerdportal -H bash
cd /opt/nerd-clearance-portal
read -r -p "Administrator full name: " INIT_ADMIN_FULL_NAME
read -r -p "Administrator email: " INIT_ADMIN_EMAIL
read -r -p "Administrator phone: " INIT_ADMIN_PHONE
read -r -s -p "Unique administrator password: " INIT_ADMIN_PASSWORD
printf '\n'
export INIT_ADMIN_FULL_NAME INIT_ADMIN_EMAIL INIT_ADMIN_PHONE INIT_ADMIN_PASSWORD
npm run admin:create
unset INIT_ADMIN_FULL_NAME INIT_ADMIN_EMAIL INIT_ADMIN_PHONE INIT_ADMIN_PASSWORD
exit
```

The bootstrap command refuses to create an additional administrator once one
already exists.

## 7. Run Node.js under systemd

Find the installed Node.js path:

```bash
command -v node
```

Create a service file:

```bash
sudo nano /etc/systemd/system/nerd-clearance-portal.service
```

Use this configuration. If `command -v node` did not return `/usr/bin/node`,
replace that path in `ExecStart`.

```ini
[Unit]
Description=NERD Clearance Portal
After=network.target mysql.service
Wants=mysql.service

[Service]
Type=simple
User=nerdportal
Group=nerdportal
WorkingDirectory=/opt/nerd-clearance-portal
EnvironmentFile=/opt/nerd-clearance-portal/.env
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/nerd-clearance-portal/private

[Install]
WantedBy=multi-user.target
```

Enable the service and check its logs:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nerd-clearance-portal
sudo systemctl status nerd-clearance-portal --no-pager
sudo journalctl -u nerd-clearance-portal -n 100 --no-pager
```

The application processes its email queue while the service is running. Keep
the service enabled so the queue worker restarts after a VPS reboot.

## 8. Configure Nginx and HTTPS

Create an Nginx site configuration:

```bash
sudo nano /etc/nginx/sites-available/nerd-clearance-portal
```

Replace `portal.example.com` with your domain:

```nginx
server {
    listen 80;
    server_name portal.example.com www.portal.example.com;
    client_max_body_size 21m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site and validate Nginx before reloading:

```bash
sudo ln -s /etc/nginx/sites-available/nerd-clearance-portal \
  /etc/nginx/sites-enabled/nerd-clearance-portal
sudo nginx -t
sudo systemctl reload nginx
```

After DNS points to the VPS, obtain and install the TLS certificate:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d portal.example.com -d www.portal.example.com
```

If you do not use `www`, omit that name from the Nginx config and Certbot
command. Once HTTPS is active, confirm `APP_URL` in `.env` is the canonical
HTTPS URL and restart the app:

```bash
sudo systemctl restart nerd-clearance-portal
```

## 9. Verify before opening registration

Check the health endpoint and site:

```bash
curl -i https://portal.example.com/health
curl -I https://portal.example.com/
```

Then test registration, login and logout, password reset email, applicant
document uploads, payment receipt upload, authorized downloads, administrator
access, and backups. Verify that:

- documents are saved under `/var/lib/nerd-clearance-portal/private`, not
  beneath the public web directory;
- unauthorized users cannot view or download private files;
- HTTPS is active and the session cookie is secure;
- SMTP sends a test message and administrator notifications arrive;
- the health endpoint reports a successful database connection.

Do not announce registration until these checks pass.

## 10. Back up the database and private files

Create a restricted backup directory:

```bash
sudo install -d -o root -g root -m 700 /var/backups/nerd-clearance-portal
sudo nano /root/.my.cnf
```

Store database credentials in `/root/.my.cnf` in this format, then restrict the
file. Use a unique password and do not add this file to the project:

```ini
[client]
user=nerd_portal
password=REPLACE_WITH_THE_MYSQL_PASSWORD
```

```bash
sudo chmod 600 /root/.my.cnf
```

Create a backup script:

```bash
sudo nano /usr/local/sbin/nerd-clearance-portal-backup
```

Paste and save:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

backup_dir=/var/backups/nerd-clearance-portal
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
install -d -o root -g root -m 700 "$backup_dir"

database_tmp="$backup_dir/database-$timestamp.sql.tmp"
files_tmp="$backup_dir/private-files-$timestamp.tar.gz.tmp"

mysqldump --defaults-extra-file=/root/.my.cnf --single-transaction \
  nerd_clearance_portal > "$database_tmp"
tar -czf "$files_tmp" \
  -C /var/lib/nerd-clearance-portal private

mv "$database_tmp" "${database_tmp%.tmp}"
mv "$files_tmp" "${files_tmp%.tmp}"
chmod 600 "$backup_dir"/*
find "$backup_dir" -type f \( -name 'database-*.sql' \
  -o -name 'private-files-*.tar.gz' \) -mtime +30 -delete
```

Make it executable and test a manual run:

```bash
sudo chmod 700 /usr/local/sbin/nerd-clearance-portal-backup
sudo /usr/local/sbin/nerd-clearance-portal-backup
```

Schedule a daily 02:00 UTC run:

```bash
sudo crontab -e
```

Add this line:

```cron
0 2 * * * /usr/local/sbin/nerd-clearance-portal-backup
```

The script keeps local backups for 30 days. Copy encrypted backups off the VPS
and test restoring both the database and private files before production use.

## 11. Deploy updates

Back up the database and private files first. Then update the application:

```bash
cd /opt/nerd-clearance-portal
sudo git pull --ff-only origin main
sudo npm ci --omit=dev
```

Run only the migrations required by that release, following the project's
migration instructions. Restart and inspect the service:

```bash
sudo systemctl restart nerd-clearance-portal
sudo systemctl status nerd-clearance-portal --no-pager
sudo journalctl -u nerd-clearance-portal -n 100 --no-pager
```

Never replace or delete the private storage directory during a code update.
