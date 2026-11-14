# Operations Handbook — Milestone 16

Written for a competent IT administrator who did not build this application, not only for the original developer. Where a procedure lives in more detail in another production document, this handbook points to it rather than duplicating it.

## 1. Architecture, in one paragraph

Willsgrove SalesFlow is a single Next.js 16 application process (no separate backend service, no background worker) talking to one PostgreSQL database and one local-disk file store. There is no queue, no cache layer, no second database. Authentication is a signed, database-backed session cookie; authorization is checked on every request server-side, never only in the browser. Two optional external integrations (SAP Business One; email/WhatsApp messaging) exist in the code but default to a safe mock mode until an administrator explicitly configures real credentials in both the environment and the in-app settings. Full detail: `docs/production/PRODUCTION-ARCHITECTURE.md`.

## 2. Environment configuration

Every setting the application reads, what it's for, and what happens if it's missing: `docs/production/PRODUCTION-ENVIRONMENT.md`. Start there before touching a running deployment's configuration.

## 3. Starting the application / health verification

```
npm run start     # after npm ci && npx prisma generate && npm run build, see DEPLOYMENT-RUNBOOK.md
```

Two health endpoints, both public (no login needed), both added/extended this milestone:

- `GET /api/health/live` — **liveness.** Is the process itself up? No database call. If this fails or times out, the process needs restarting — that's the one-sentence diagnosis this endpoint exists to give.
- `GET /api/health` — **readiness.** Is the database actually reachable right now? Returns `database: "connected"` or `"disconnected"`, plus the running build's version/build id/environment. If liveness passes but readiness fails, the process is fine and the database is the problem — check the database host, not the application.

Neither endpoint discloses a connection string, credential, or internal configuration value — confirmed by reading both route handlers directly.

## 4. Day-to-day: where to look when something seems wrong

- **Application logs** (`console.error`/`console.log` output, wherever the host captures stdout/stderr) are the only logging mechanism in this codebase — there is no external log aggregation service wired up. Every caught error in a route handler logs a short, specific message before returning a generic error to the user (e.g. `"Customer list failed:"`, `"Order document creation failed:"`) — searching logs for the word "failed" is a reasonable first move.
- **Audit trail:** every meaningful mutation (user creation, order approval, status changes, document uploads, decision-recommendation status changes, etc.) writes an `AuditEvent` row — `actorId`, `action`, `entityType`/`entityId`, and a JSON `afterData` snapshot. This is queryable directly in the database and is the authoritative record of "who did what, when," reused by every milestone rather than each building its own separate audit mechanism.
- **Integration health:** `/integrations/sap` (ADMINISTRATOR) shows the SAP connection's configured mode and the history of sync jobs/operations, each with a sanitized (credential-redacted) error message on failure — see `SECURITY-REVIEW.md` §6.

## 5. User management

`/settings` (visible to all roles for the read-only directory; creation and status changes are ADMINISTRATOR-only, enforced server-side regardless of what the UI shows):
- **Create a user:** admin fills in name/email/role; the system generates a strong temporary password, shown **once** in the creation response (never emailed — no mail integration exists for this at the time of writing). The new user must change it at first login (`mustChangePassword`).
- **Deactivate a user:** sets `status=INACTIVE` and **immediately revokes every one of that user's active sessions** — they are logged out on their very next request, not merely blocked from a future login.
- **Roles:** `SALESPERSON`, `SALES_MANAGER`, `ADMINISTRATOR` — fixed, no custom-role mechanism exists.

## 6. Database operations

Migration procedure, backup/restore plan, and the one real migration defect found and fixed this milestone: `docs/production/DATABASE-BACKUP-AND-RECOVERY.md`. **Read it before running any `prisma migrate` command against a database that matters.**

## 7. Scheduled jobs

Neither quotation expiry nor SAP sync runs on its own — both need a cron entry (or host-equivalent scheduler). Exact lines: `docs/production/DEPLOYMENT-RUNBOOK.md` §6. Both scripts log their own result and exit non-zero on failure; a cron wrapper that discards output will hide failures, so don't discard it.

## 8. Investigating a failed SAP/email/WhatsApp import or send

- SAP sync: `/integrations/sap` shows every `IntegrationSyncJob` with its status and, on failure, a redacted error message. A failed scheduled sync (`npm run sap:sync` exiting non-zero) does not retry itself — re-run it manually (or wait for the next scheduled run) once the underlying issue (network, SAP-side outage, credential expiry) is resolved.
- Email/WhatsApp: a failed outbound message is recorded as `FAILED` with a redacted error message, and has a manual "Resend" action (restricted to `SALES_MANAGER`/`ADMINISTRATOR`) that resends the exact same immutable rendered body — it never silently retries or duplicates content.
- Inbound webhooks (email/WhatsApp intake) return `503` and do nothing if the corresponding webhook secret isn't configured — this is a configuration gap to close via `.env`, not an application bug, if real inbound channels are expected to work.

## 9. Deployment failure / rollback

`docs/production/DEPLOYMENT-RUNBOOK.md` (deploy) and `docs/production/ROLLBACK-AND-INCIDENT-RESPONSE.md` (what to do when a deploy goes wrong, including the critical note that rolling back code does not reverse a migration).

## 10. Demo data

`npm run db:remove-demo` deletes every row flagged `isDemo: true`, in a carefully FK-ordered transaction (see the script's own extensive header comments — it is the authoritative reference for exactly what it deletes and in what order). **This is a destructive command and must never be run against a database that holds any real Willsgrove data mixed in with demo data without first confirming every row it will touch is genuinely demo-only.** It has never been run against a real database in this project's history (same sandbox limitation as every migration) — treat its first real run as a reviewed event, not a routine one, and run it against a backup-tested/non-production copy first if there is any doubt.

## 11. Who to contact

See `docs/production/ROLLBACK-AND-INCIDENT-RESPONSE.md` §7 — this needs Willsgrove's own input; it is not something this milestone can fill in on your behalf.
