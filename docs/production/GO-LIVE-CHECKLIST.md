# Go-Live Checklist — Milestone 16

Use this as the literal, in-order checklist for the first real production go-live. Each item links to the document that has the detail; this file is deliberately just the checklist.

## Before go-live

- [ ] **Hosting decided.** Node ≥20.9 host chosen and reachable; confirm against `docs/production/PRODUCTION-ARCHITECTURE.md` §2–3.
- [ ] **Database provisioned.** Real PostgreSQL instance; `DATABASE_URL`/`DIRECT_URL` set to it, never to a development database.
- [ ] **Every environment variable set**, per `docs/production/PRODUCTION-ENVIRONMENT.md` — `AUTH_SECRET` freshly generated and unique to production (never reused from dev/staging), `APP_BASE_URL` set to the exact real production URL.
- [ ] **Database backups configured and verified**, per `docs/production/DATABASE-BACKUP-AND-RECOVERY.md` §3 — not just "the provider probably does this," an actual confirmed, working backup.
- [ ] **A restore has been test-run against a separate, non-production database**, per the same document's restore procedure — this has NOT been done as part of this milestone (no live database existed to test against) and must happen before go-live, not after.
- [ ] **File-storage backup decided and configured** for `STORAGE_LOCAL_DIR` (separately from the database backup — see `DATABASE-BACKUP-AND-RECOVERY.md` §3's file-storage row).
- [ ] **The one migration-ordering defect fix has been verified against the real target database** per the mandatory pre-deployment check in `DATABASE-BACKUP-AND-RECOVERY.md` §1 (run `prisma migrate status` first; do not assume).
- [ ] **Migrations deployed**, per `docs/production/DEPLOYMENT-RUNBOOK.md` §5, following the safe sequence.
- [ ] **Seed admin account created** with a strong, unique password (`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`), and that password changed at first real login.
- [ ] **Application built and deployed**, per `DEPLOYMENT-RUNBOOK.md` §4/§7.
- [ ] **Health checks pass**: `GET /api/health/live` and `GET /api/health` both return success against the real deployment.
- [ ] **Smoke test passed**: sign in, open orders, open a customer profile, open reports (per role).
- [ ] **Scheduled scripts wired into a real cron/scheduler**, per `DEPLOYMENT-RUNBOOK.md` §6 — quotation expiry and SAP sync do nothing on their own otherwise.
- [ ] **UAT executed** against the real staging/production-like environment using `docs/production/USER-ACCEPTANCE-TESTING.md`, with every row resolved to PASS, or an explicitly accepted BLOCKED/FAIL with sign-off.
- [ ] **Security findings reviewed** per `docs/production/SECURITY-REVIEW.md` — in particular §0's two repository-integrity findings (the `Object Storage.md` instruction file and the Next.js agent-feedback flag) have been seen and actioned by someone at Willsgrove, not just left in a document.
- [ ] **Who-to-contact filled in** per `docs/production/ROLLBACK-AND-INCIDENT-RESPONSE.md` §7 — this document cannot invent a real on-call contact.
- [ ] **Integration status reviewed and accepted**: SAP and email/WhatsApp remain in mock mode unless Willsgrove has actually obtained and configured real, verified credentials for the specific one(s) it wants live at go-live. Going live with these in mock mode is a legitimate choice (the application works correctly either way) — the checklist item is "this was a deliberate decision," not "these must be live."
- [ ] **Rollback procedure understood** by whoever will be on point for the go-live, per `docs/production/ROLLBACK-AND-INCIDENT-RESPONSE.md`.

## At go-live

- [ ] Deploy during a low-traffic/low-risk window if Willsgrove has one; not strictly required (this is a new go-live, not a migration of an already-live system), but still good practice for the first real cutover.
- [ ] Run the deployment procedure exactly as documented, item by item — not from memory.
- [ ] Confirm health checks and smoke test immediately after.
- [ ] Monitor logs actively for the first hour of real use (`docs/production/OPERATIONS-HANDBOOK.md` §4).

## After go-live (first week)

- [ ] Confirm the first scheduled run of both cron jobs actually happened and logged a clean exit.
- [ ] Confirm the first backup under the new schedule actually ran and is restorable (don't just trust the schedule exists — check that a backup file/snapshot actually appeared).
- [ ] Review the acceptance matrix in `docs/milestones/MILESTONE-16-DELIVERY-REPORT.md` §16 for every item marked OUTSTANDING ACTION or ACCEPTED RISK, and confirm each has either been resolved or formally accepted by whoever at Willsgrove has the authority to accept it.

**This checklist does not authorize itself.** It is complete only when a named person at Willsgrove has gone through it and checked each box against the real environment — nothing in this sandbox can check these boxes on Willsgrove's behalf.
