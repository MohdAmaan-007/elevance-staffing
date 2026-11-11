# Elevance Staffing — Multi-page website + recruitment portal

This package extends the Elevance Staffing website with a Node.js/Express API and PostgreSQL database.

## Included functionality

- Candidate and employer registration
- Password hashing (bcrypt) and server-side login sessions
- Candidate CV upload (PDF/DOC/DOCX, max 5 MB), stored outside the public website directory
- Employer job submission; new jobs start as `pending`
- Public job API returns only administrator-published jobs
- Candidate dashboard with application history and CV upload
- Employer dashboard with submitted job posts
- Admin dashboard with counts, account list, job approval/rejection, application status updates, and private CV download endpoint
- Session cookies are HTTP-only and SameSite=Lax; HTTPS-only cookies in production
- Login rate limiting, Helmet security headers, request/file size limits

## Requirements

- Node.js 20+
- PostgreSQL 13+
- Hosting that supports a continuously running Node.js application and a persistent private disk for CV files
- HTTPS in production

## Local setup

1. Create a PostgreSQL database named `elevance_staffing`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, a random `SESSION_SECRET` (32+ characters), `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD`.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000`.
6. Visit `login.html` to create candidate/employer accounts. Sign in with the seeded administrator credentials to access `admin.html`.

The app creates the schema and the initial admin account on first startup. The admin account is created only when `ADMIN_PASSWORD` is changed from the placeholder value.

## Hosting notes

Upload the project to a Node.js-capable host, configure the environment variables in its dashboard, attach a managed PostgreSQL database, and configure persistent private storage for `../elevance_private_uploads`. Set `NODE_ENV=production` and `TRUST_PROXY=true` if the host terminates HTTPS at a reverse proxy. Point the domain to the app and enable HTTPS.

A static-only shared hosting plan (HTML/PHP-only) cannot run this backend. The current HTML site can be hosted statically, but the portal features require Node.js + PostgreSQL hosting. Do not upload `.env`, `node_modules`, or the private CV directory to a public web root.

## Before accepting real applicants

- Add a privacy notice, terms, consent and retention/deletion policy suitable for each country where candidates are recruited.
- Configure transactional email for verification, password reset and application notifications; these flows are not included yet.
- Add malware scanning for uploaded documents and a documented backup/restore process.
- Add CSRF protection and security review before production launch.
- Set up admin MFA and an audited process for staff access to candidate CVs.
- Review local employment, privacy and data-transfer obligations (USA, India, Canada and UK).

This is a working starter application, not a certified compliance solution. It should be security-reviewed and tested on the selected host before collecting real candidate data.


## Deploy on Render (free starter setup)

1. Push the contents of this folder to a GitHub repository (the `render.yaml` and `package.json` must be at the repository root).
2. Create a PostgreSQL project on Supabase and copy its connection string. Use the connection string that Supabase recommends for server-side applications; ensure the password is URL-encoded if it contains special characters.
3. In Render, choose **New → Blueprint**, connect the GitHub repository, and deploy the `render.yaml` blueprint.
4. Render will ask for `DATABASE_URL`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`. Enter the Supabase connection string, the administrator email, and a unique strong password. Keep these private.
5. After deployment, open the Render URL and test `/health`, registration, login, and job posting.

### Important free-tier limitation for CV uploads

This starter application currently saves CV files to the Node server's local filesystem (`../elevance_private_uploads`). Render free web services have an ephemeral filesystem, so uploaded CV files can disappear when the service restarts or redeploys. Do not use this deployment to collect real CVs until CV storage has been changed to durable private object storage (for example, a private Supabase Storage bucket) and tested. The app's current CV upload code is not yet integrated with Supabase Storage.

Render free PostgreSQL databases expire after the free retention period, so this blueprint deliberately expects an external database URL rather than creating a short-lived Render database. Free Render web services can spin down when idle. Review current Render and Supabase free-plan limits before launch.

Before accepting real candidate information, add and review privacy/consent notices, retention/deletion procedures, email verification and password reset, malware scanning, CSRF protection, admin MFA, and backups. See the main README for the full checklist.
