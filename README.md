# Willsgrove SalesFlow

An internal sales, fulfilment, and SAP-integration application for Willsgrove, built incrementally across 16 milestones — from master data and PO intake through picking, invoicing reconciliation, quotations, approvals, SAP Business One integration, communication channels, multi-dimensional reporting, decision intelligence, and finally production-readiness hardening.

This file is a short orientation. It does not duplicate the detailed documentation below — follow the links.

## Stack

Next.js 16.4.4 (App Router, Cache Components, Turbopack), React 19.3.0, TypeScript, Prisma 6.19.x over PostgreSQL, Tailwind CSS, Vitest. Single Node process, no separate backend service, no queue or cache layer. See `docs/production/PRODUCTION-ARCHITECTURE.md` for the full verified architecture.

## Getting started (development)

```powershell
npm ci
npx prisma generate
npx prisma migrate dev
npm run db:seed
npm run dev
```

Full, numbered, step-by-step setup instructions for every milestone — including each one's own migration, manual test script, and known sandbox-only limitations — are in `SETUP-WINDOWS.md`. Every environment variable the application reads, what it's for, and what happens if it's missing, is in `docs/production/PRODUCTION-ENVIRONMENT.md`.

## Roles

Three fixed roles, enforced server-side on every request: `SALESPERSON`, `SALES_MANAGER`, `ADMINISTRATOR`. There is no custom-role mechanism.

## Documentation map

| If you want to know... | Read |
|---|---|
| What's been built, milestone by milestone, and what's deliberately deferred | `docs/milestones/ROADMAP.md` |
| The full detail and honest verification results for any specific milestone | `docs/milestones/PROGRESS.md` |
| A file-by-file changelog | `CHANGES.md` |
| Step-by-step setup/verification instructions per milestone | `SETUP-WINDOWS.md` |
| Whether this application is ready for production, and under what conditions | `docs/milestones/MILESTONE-16-DELIVERY-REPORT.md` (the acceptance matrix and final verdict) |
| The verified production architecture | `docs/production/PRODUCTION-ARCHITECTURE.md` |
| Every environment variable, and fail-safe behaviour when one is missing | `docs/production/PRODUCTION-ENVIRONMENT.md` |
| The security audit (auth, authorisation, input validation, CSRF, file uploads, secrets) | `docs/production/SECURITY-REVIEW.md` |
| Database migration integrity, and the backup/restore procedure | `docs/production/DATABASE-BACKUP-AND-RECOVERY.md` |
| How to actually deploy this application | `docs/production/DEPLOYMENT-RUNBOOK.md` |
| What to do when a deployment goes wrong | `docs/production/ROLLBACK-AND-INCIDENT-RESPONSE.md` |
| Day-to-day operations, for an administrator who didn't build this | `docs/production/OPERATIONS-HANDBOOK.md` |
| The literal go-live checklist | `docs/production/GO-LIVE-CHECKLIST.md` |
| The user acceptance test plan, ready to execute against staging | `docs/production/USER-ACCEPTANCE-TESTING.md` |

## Current status

**READY AFTER LISTED CONDITIONS** — see `docs/milestones/MILESTONE-16-DELIVERY-REPORT.md` §16 for the full acceptance matrix. No known unresolved application-code defect remains. Backup configuration and a tested restore, UAT execution against a real staging environment, and two repository-integrity findings recorded in `docs/production/SECURITY-REVIEW.md` §0 are the open items standing between this state and a controlled go-live — none of them require further application code.
