# Rollback and Incident Response — Milestone 16

## 1. Rollback — the critical caveat first

**Rolling back the application code does not automatically reverse a database migration.** Prisma migrations are forward-only by design; there is no built-in "undo" command. Every migration shipped in this project so far (re-verified this milestone — see `DATABASE-BACKUP-AND-RECOVERY.md` §1) is additive: new tables, new nullable/defaulted columns, new enum values. That means **the previous version of the application code will still run correctly against the new schema** — an additive migration never removes something older code depends on. This is what makes a same-direction rollback (deploy the old code, leave the new schema in place) safe for every migration in this project today.

A rollback would only become genuinely dangerous if a future migration ever drops a column, renames a table, or removes an enum value that older code still reads — none of that exists yet, but if it ever does, the correct response is **not** to try to reverse that migration automatically. Write a separate, explicit, forward migration that restores compatibility (e.g. re-adding a column with a default), and treat "roll the schema back" as a last resort requiring a verified restore from backup (`DATABASE-BACKUP-AND-RECOVERY.md` §3), never a guess.

## 2. Rollback conditions — when to roll back rather than fix forward

Roll back immediately if, after a deploy:
- `GET /api/health` or `GET /api/health/live` fails and stays failing for more than a couple of minutes (not a single transient blip).
- The smoke test in `DEPLOYMENT-RUNBOOK.md` §7 step 5 fails (cannot sign in, cannot open core pages).
- Application logs show a sustained spike in unhandled errors on a core workflow (order creation, authentication, invoice reconciliation) that wasn't present before the deploy.
- A genuine data-integrity issue is discovered that the new code is actively causing (not a pre-existing one noticed for the first time).

Prefer a fix-forward (a small, targeted patch deployed immediately) over a rollback when the issue is cosmetic, isolated to a non-critical path, or when rolling back would itself be risky (e.g. after a destructive migration — not applicable to anything shipped so far, but worth stating as a principle for future milestones).

## 3. Rollback procedure

1. Identify the last known-good build (the one running immediately before the problem deploy — the build id surfaced by `GET /api/health`'s `buildId` field, new this milestone, is what makes this identifiable at all; see `lib/app-info.ts`).
2. Deploy that previous build's code using the same deployment procedure (`DEPLOYMENT-RUNBOOK.md` §7), **skipping the migration step** — the schema should stay as it is, since (per §1) the old code is compatible with it.
3. Re-run the health check and smoke test.
4. Once confirmed stable, investigate the root cause of the failed deploy in a non-production environment before attempting to re-deploy the fixed version.
5. Record what happened, when, and what was done, in whatever incident log Willsgrove keeps (see §6 below for the minimum this should capture).

## 4. Incident response — triage

| Severity | Definition | Example |
|---|---|---|
| **Critical** | The application is down, or data is being corrupted, for all or most users. | Health check failing site-wide; a bug causing duplicate financial records on every order. |
| **High** | A core workflow is broken for some/most users, but the app is otherwise reachable. | Order creation failing; login failing for one role but not others. |
| **Medium** | A non-core feature is broken, or a core feature is degraded but still usable. | CSV export failing; a report showing a stale figure. |
| **Low** | Cosmetic or isolated to a rare edge case. | A label rendering incorrectly; a rare validation message wording issue. |

## 5. Incident response — immediate actions by severity

- **Critical:** check `GET /api/health` and `GET /api/health/live` first — this tells you in seconds whether the process is up and whether the database is reachable, narrowing the search before reading a single log line. If the database is unreachable, check the database host's own status page/dashboard before assuming the application caused it. If the application itself is the cause, roll back (§3) immediately rather than debugging live.
- **High:** reproduce the failure against the smoke-test paths (`DEPLOYMENT-RUNBOOK.md` §7 step 5); check application logs for the specific error; decide fix-forward vs. rollback per §2.
- **Medium/Low:** log the issue, fix forward on the normal development/test cycle — no emergency rollback needed.

## 6. What to capture during any incident (minimum)

- Timestamp the issue was first noticed, and by whom/how (a user report, a monitoring alert, a routine check).
- The exact symptom (error message shown to the user, or the health-check/log output).
- What was running at the time: which build/version (`buildId` from the health endpoint), which migration state (`prisma migrate status` output).
- What action was taken (rollback / fix-forward / no action needed) and when.
- Root cause, once known.
- One sentence on what would have caught this sooner (a test, a monitoring check, a smoke-test step) — feeds back into `docs/production/USER-ACCEPTANCE-TESTING.md` and this runbook, not meant as blame.

## 7. Who to contact

This document cannot name a real on-call rotation or escalation contact — none was supplied to this milestone, and inventing one would be exactly the kind of fabricated operational detail the spec warns against. **Willsgrove needs to fill in:** who holds database-hosting-provider access, who holds the application-hosting-provider access, and who is the first point of contact for each of the severities in §4, before go-live. Record that list in this file once decided — it belongs here, not scattered across chat threads or a single person's memory.
