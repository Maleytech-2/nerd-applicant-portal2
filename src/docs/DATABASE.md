# Database Architecture

## Initialization

1. Create a MySQL 8 user and `.env` file.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL_STRING` to `mysql://USER:PASSWORD@HOST:PORT/DATABASE`. URL-encode
   reserved characters in the username or password.
4. Run `npm install`.
5. Run `npm run db:init`.

Private database hostnames such as `mysql.railway.internal` resolve only from
services connected to that provider's private network. Use the provider's public
connection host when the application runs elsewhere or on your local computer.

For an existing database, run `npm run db:migrate:programme-types` to expand
`applications.programme_type` for the supported qualification names. The migration
preserves existing values.

Run `npm run db:migrate:restricted-cases` to add study mode and the administrator-only
Exemption/Exclusion review queue. Eligible applicants can proceed to payment only after
administrator approval of a restricted-category request.

## Restricted-category eligibility flow

- During registration eligibility screening, full-time applicants older than 30 on their actual
  graduation date are classified as Exemption and sent for administrator verification. Payment
  and the application form remain locked until that verification is approved; approval applies
  the configured Exemption fee and unlocks both steps.
- Nigerian part-time applicants are sent for Exclusion review.
- NOUN applicants are sent to the administrator, who assigns Exemption or Exclusion.
- Applicants see only a general review status; category and case details are restricted
  to administrator routes. Approval sets the configured category fee and unlocks the
  usual payment and application steps.

The database name comes from the URL path. The initialization script can create
the configured database and schema; the database user needs permission to create
and alter tables. Set `DB_INIT_CREATE_DATABASE=false` when the provider already
created the database and the user cannot create databases.

## Core Relationships

- `users.role_id` identifies applicant, staff, or administrator.
- `role_permissions` and `permissions` support granular staff authorization.
- `eligibility_screenings.applicant_id` is unique, preserving the authoritative server-calculated
  result and the DOB reused by the application.
- `payments.eligibility_id` verifies that a claim belongs to a qualifying screening.
- `payments.transaction_reference` is globally unique and pending references remain reserved.
- `documents.applicant_id` and `documents.category` associate private files with applicants.
- `applications.payment_id` is unique, while `applications.applicant_id` is unique, preventing
  duplicate active registrations and ensuring a payment unlock is not reused.
- Application review checks that each linked private document still exists. Administrators can
  request an authorized replacement for a missing current document; applicants must upload that
  document before the server allows the correction to be resubmitted.
- Once an application exists, eligibility and payment submissions cannot be restarted. After
  application submission, the applicant dashboard shows the administrator-review wait state;
  an administrator-uploaded clearance PDF becomes available there to view, download, and print.
- `application_documents` links application fields to private documents.
- `restricted_category_records` is intentionally separate and contains Exemption/Exclusion data.
- `restricted_category_requests` keeps pending, approved, and rejected special-case reviews
  accessible only to administrators.
- `nerd_registration_tracking` keeps official NERD progress separate from internal application status.
- `clearances.document_id` preserves the original clearance PDF and replacement is auditable.
- `email_notifications` provides delivery status and retry state.
- `audit_logs` records administrative and authentication activity.

## Table List

| Table | Purpose |
|---|---|
| `roles` | Account role definitions |
| `permissions` | Granular staff permissions |
| `role_permissions` | Permission assignments |
| `users` | Applicant, staff, and administrator accounts |
| `password_reset_tokens` | Expiring hashed password-reset tokens |
| `institutions` | Institution registry and restrictions |
| `eligibility_screenings` | Server-calculated eligibility and fee data |
| `payments` | Payment claims and verification state |
| `documents` | Private upload metadata and replacement history |
| `applications` | Draft and submitted applicant applications |
| `application_documents` | Application/document associations |
| `application_corrections` | Administrator-controlled correction requests |
| `restricted_category_records` | Administrator-only Exemption/Exclusion records |
| `restricted_category_requests` | Administrator-only special-case review queue |
| `nerd_registration_tracking` | Official NERD registration progress |
| `clearances` | Final clearance ownership and replacement history |
| `email_notifications` | Email queue and delivery audit |
| `audit_logs` | Immutable application activity trail |
| `system_settings` | Business and operational settings |
| `sessions` | Express-session records, created automatically |

No upload content is stored in public directories. Private files should use `relative_path` under
the server-only storage root; all downloads must pass authenticated authorization middleware.
