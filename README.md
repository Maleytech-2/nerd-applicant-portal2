# NERD Clearance Registration and Management Portal

Independent registration assistance platform for OGAH JOHN BUSINESS CENTER - UDUS MINI MART.
This application is not the official NERD website.

## Production

See [Deployment documentation](docs/DEPLOYMENT.md) for environment variables,
first-administrator bootstrap, SMTP queue processing, backups, HTTPS, verification,
and hosting requirements.
For a Hostinger VPS walkthrough, see [Hostinger VPS Deployment](docs/HOSTINGER_VPS.md).

## Phase 1 Status

The project foundation is implemented:

- Node.js and Express application structure
- Helmet security headers
- MySQL connection pool
- Database-backed Express sessions
- CSRF token middleware
- Role and granular permission middleware
- Centralized error handling
- Audit log helper
- Complete MySQL initialization schema

Public website, applicant workflows, and administrative modules will be built in later phases.

## Phase 2 Status

The public website is implemented in `public/index.html` with supporting CSS and JavaScript:

- Responsive navy, white, and gold branding
- Public fees and payment account details
- Eligibility overview
- Registration process
- FAQ and contact sections
- Independent-portal disclaimer
- No Exemption or Exclusion content

## Phase 3 Status

Applicant authentication is implemented:

- Registration with server-side validation
- bcrypt password hashing
- Duplicate email prevention
- Session fixation protection and secure session cookies
- Login rate limiting
- Logout audit logging
- Expiring password reset tokens
- Optional Nodemailer SMTP delivery for password reset links

## Phase 4 Status

Eligibility screening is implemented with:

- Exact age-at-graduation calculation
- NOUN institutional restriction
- Nigerian and foreign Full-Time fee calculation
- Server-side result storage
- Applicant eligibility page
- Unit tests for the eligibility rules

## Phase 5 Status

Payment submission is implemented with:

- Server-calculated required fees
- Independent amount validation
- Private receipt storage
- PDF, JPEG, and PNG content validation
- Cryptographic receipt hash duplicate checks
- Unique transaction reference enforcement
- Pending, under-review, and rejected payment states
- Administrator notification queue

## Phase 6 Status

Reliable email notifications are implemented with:

- Branded HTML and plain-text templates
- SMTP environment configuration
- Persistent database queue
- Retry tracking and failure logging
- Password reset delivery
- Administrator new-payment notification
- Applicant account, eligibility, payment, correction, submission, and clearance templates
- `npm run email:process` queue worker

## Phase 7 Status

The administrator payment dashboard is implemented with:

- Administrator-only dashboard and APIs
- Applicant, eligibility, payment, and application overview metrics
- Searchable applicant records
- Filterable payment verification claims
- Receipt preview from private storage
- Confirmed approve, reject, and correction actions
- Internal notes and audit trail
- Applicant payment-status notifications

## Phase 8 Status

The multi-step application form is implemented with:

- Payment-approval access lock
- Eight-step polished application flow
- DOB loaded from eligibility screening
- Save-and-continue draft persistence
- Final submission confirmation
- Application reference generation
- Direct overwrite protection after submission
- Administrator-controlled correction status support

## Phase 9 Status

Secure document management is implemented with:

- Category-specific private uploads
- PDF, JPEG, PNG, and valid DOCX content checks
- Randomized stored names and restricted storage directories
- SHA-256 document hashes
- Current-document and replacement history
- Applicant-only document upload and download
- Administrator document access
- Granular staff `documents.view` permission support
- Authenticated preview/download routes
- Applicant correction-category authorization

## Phase 10 Status

Application review and correction management is implemented with:

- Staff and administrator application review APIs
- Granular `applications.view` and `applications.correct` permissions
- Submitted, under-review, approved, ready, and official-progress statuses
- Administrator-controlled correction requests
- Authorized fields and document categories
- Applicant correction notification and resubmission
- Official NERD registration tracking
- Review action audit logging

## Phase 11 Status

Final clearance management is implemented with:

- Administrator-only original PDF upload
- Applicant and application verification
- Private randomized clearance storage
- View, download, and print PDF routes
- Current-clearance ownership checks
- Replacement history without deleting prior files
- Application status updated to clearance available
- Applicant clearance notification
- Audit logs for upload and replacement

## Phase 12 Status

Staff account and permission management is implemented with:

- Administrator-only staff creation and management
- Staff activation and deactivation
- Administrator password reset
- Granular staff permission assignment
- Staff activity log API
- Staff-only dashboard
- Backend permission checks
- Exemption and Exclusion permissions blocked for staff

## Phase 13 Status

Reports and Excel exports are implemented with:

- Searchable and filterable report APIs
- Date, name, reference, phone, email, nationality, institution, department, and status filters
- Pagination with bounded result limits
- Administrator and permitted staff access
- ExcelJS `.xlsx` generation
- Export audit logging
- Automatic exclusion of restricted categories from staff report data

## Phase 14 Status

Audit logs and system administration are implemented with:

- Paginated, filterable audit-log APIs
- Read-only audit history
- Administrator-only system settings APIs
- Sensitive setting redaction
- Protected fee and category settings
- Registration availability control
- Application reference format configuration
- SMTP configuration status
- Previous/new value audit records

## Phase 15 Status

Security and quality review completed for:

- Session fixation protection
- Password reset and password-change session invalidation
- Active-account revalidation
- Live permission revalidation
- CSRF protection
- Parameterized database queries
- Private document ownership and path checks
- Server-calculated eligibility and payment fees
- Duplicate payment and receipt controls

## Phase 16 Status

Production deployment preparation is complete:

- Production `.env.example`
- Required production environment validation
- Secure session cookie configuration
- Graceful process shutdown
- First-administrator bootstrap script
- Database and private-file backup scripts
- Deployment and hosting documentation
- Database initialization, migration, and SMTP queue commands

Before running against an existing database, execute:

```powershell
npm run db:migrate
```
- Applicant-only dashboard access

## Installation

```powershell
npm install
Copy-Item .env.example .env
```

Update `.env` with MySQL and session settings, then initialize:

```powershell
npm run db:init
npm start
```

For XAMPP on Windows, start Apache and MySQL, configure `.env` for the local
database, run `npm install` and `npm run db:init` once, then use
`start-portal.cmd`. Open `http://localhost:3000` for registration and other
server-backed features. Apache's `http://localhost/john/public` URL only serves
static files and cannot process the portal API.

Health check:

```text
GET http://localhost:3000/health
```

## Security

- Never commit `.env`.
- Use a unique, random `SESSION_SECRET` of at least 32 characters.
- Run the application behind HTTPS in production.
- `EXEMPTION` and `EXCLUSION` data is isolated in `restricted_category_records`.
- Staff permissions must be enforced in routes and controllers.
