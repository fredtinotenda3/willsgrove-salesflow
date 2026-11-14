# Deployment Runbook — Milestone 16

Platform-agnostic, because no specific host has been confirmed for this deployment (see `PRODUCTION-ARCHITECTURE.md` §3). Every step below is concrete and ready to run; where a specific host (Vercel, a VPS, a managed Node platform) changes the exact command, that is called out.

## 1. Hosting requirements

- Node.js ≥ 20.9 (declared in `package.json: engines`).
- One process running `next start` (or the host's equivalent) — this application is designed for a single, long-lived Node process (see `PRODUCTION-ARCHITECTURE.md` §2). If a host that auto-scales to multiple instances is chosen, read that section's consequences first (rate limiting, scheduled scripts) before relying on horizontal scaling.
- Outbound network access to: the PostgreSQL host, `fonts.googleapis.com`/`fonts.gstatic.com` (only at **build** time, for `next/font/google` — see §4's note), and, if live integrations are ever enabled, the real SAP Service Layer host and/or the configured email/WhatsApp provider's API.
- Persistent local disk for `STORAGE_LOCAL_DIR`, sized for expected document-upload volume, **included in the host's own backup/snapshot plan** (see `DATABASE-BACKUP-AND-RECOVERY.md` §3).

## 2. Database requirements

A reachable PostgreSQL instance (version compatible with the SQL features this schema's migrations use — standard DDL, enums, `TIMESTAMPTZ`, no exotic extensions). See `DATABASE-BACKUP-AND-RECOVERY.md` for migration safety and backup/restore.

## 3. Environment variables

Every variable in `docs/production/PRODUCTION-ENVIRONMENT.md` must be set before first start. At minimum, confirm before the first deploy: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET` (unique to this environment), `APP_BASE_URL` (the real production URL, exactly, no trailing slash), `STORAGE_LOCAL_DIR` (an absolute path outside the deployed code directory), `NODE_ENV=production`.

## 4. Build procedure

```
npm ci                 # not `npm install` -- exact, lockfile-pinned versions for a deploy
npx prisma generate    # regenerates the Prisma client against the real schema
npm run build           # next build
```

**Note on `next/font/google`:** `app/layout.tsx` uses Google-hosted fonts (Geist/Geist Mono), fetched at build time. This requires the build environment to reach `fonts.googleapis.com` — confirmed, in this audit's own sandbox, to be the one thing blocking a full `next build` here (a sandbox network restriction, not an application defect; every prior milestone has hit and documented the identical wall). A normal CI/build environment with standard internet access will not have this problem. If the chosen build environment is itself network-restricted (an air-gapped or heavily firewalled CI runner), either allow that one outbound host or switch `app/layout.tsx` to `next/font/local` with the font files vendored into the repository — not done in this milestone because it was not possible to verify the rendered result end to end without build access, and changing a working file without the ability to verify the change is exactly what this milestone's spec warns against.

## 5. Migration procedure

See `docs/production/DATABASE-BACKUP-AND-RECOVERY.md` §2 for the full, step-by-step safe sequence. Summary: confirm target → confirm backup → `prisma migrate status` → review pending → `prisma migrate deploy` → `prisma migrate status` again → verify app health → confirm core workflows → record the result. **Never `prisma migrate reset` or `migrate dev` against anything but a disposable local database.**

## 6. Scheduled scripts

Neither of these runs on its own — wire both into the host's own scheduler (cron on a VPS, or the equivalent on whatever platform is chosen; this project intentionally has no built-in scheduler — see `PRODUCTION-ARCHITECTURE.md` §2/§6):

```cron
# Quotation expiry sweep -- hourly is a reasonable default; adjust to how
# quickly Willsgrove needs an expired quotation to actually flip status.
0 * * * * cd /path/to/app && /usr/bin/env NODE_ENV=production npm run quotations:expire >> /var/log/willsgrove/quotations-expire.log 2>&1

# SAP product/customer sync -- only meaningful once SAP_B1_PROVIDER=live
# and an ADMINISTRATOR has enabled it in-app; harmless (reports "mock" and
# does nothing live) to leave scheduled even before that, since both sync
# functions already fail safe to the mock adapter.
0 2 * * * cd /path/to/app && /usr/bin/env NODE_ENV=production npm run sap:sync >> /var/log/willsgrove/sap-sync.log 2>&1
```

Both scripts are idempotent and exit non-zero on failure (`process.exitCode = 1`) — wire the host's cron/alerting to notice a non-zero exit, not just run the command silently.

## 7. Deployment procedure (first deploy and every subsequent one)

1. Build (§4) in a build environment with normal internet access, or in CI.
2. Run the migration procedure (§5) against the real target database — **before** switching live traffic to the new build, if the host supports a staged rollout; otherwise immediately before starting the new process.
3. Start the new process (`npm run start`, or the host's process manager).
4. **Health verification:** `curl https://<app-host>/api/health/live` → expect `{"success":true,"status":"alive",...}` (confirms the process itself started). Then `curl https://<app-host>/api/health` → expect `{"success":true,"database":"connected",...}` (confirms it can reach the database).
5. **Smoke test:** sign in as an existing user, open `/orders`, open one customer's `/customers/[id]` 360 profile, open `/reports` (as a SALES_MANAGER or ADMINISTRATOR account) — confirms the most heavily-used read paths work end to end against the real database, not just that the process started.
6. **Post-deployment monitoring:** watch application logs (`console.error` output — see `OPERATIONS-HANDBOOK.md` §4 for what to look for) for at least the first 15–30 minutes of real traffic after a deploy, not just the smoke test above.

## 8. Rollback

See `docs/production/ROLLBACK-AND-INCIDENT-RESPONSE.md` for the full procedure and the explicit warning about database migrations not being automatically reversed by rolling back application code.

## 9. Minimising downtime

- Run the migration step (§5) before cutting traffic to the new code where the host supports it, since every migration in this project is additive (no migration drops a column/table that older code still reads from) — confirmed during this milestone's migration review (`DATABASE-BACKUP-AND-RECOVERY.md` §1). This means the **old** code can keep running correctly against the **new** schema during a rolling deploy, which is what makes a staged rollout safe here.
- If the host supports it, keep the previous build's process running until the new one passes its health check (§7 step 4), then switch traffic, then stop the old process — a blue/green or rolling pattern, not a hard cutover with a gap.
- This project has no caching layer to warm and no CDN-fronted dynamic content to invalidate, so there is no additional cache-coherency step beyond the above.
