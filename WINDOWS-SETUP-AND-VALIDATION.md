# Windows Setup & Validation — This Round Only

This file covers **only** the setup and validation steps specific to this
round's own work (the "FINAL COMPLETION DIRECTIVE," tasks #166-179, zipped as
`willsgrove-salesflow-final-enhancements.zip`). It is **not** a replacement
for `SETUP-WINDOWS.md`, which is this project's full, Milestone-0
fresh-environment setup guide (Node, PostgreSQL, environment variables,
initial seed, etc.) — if you are setting this project up from nothing, run
that guide first, then come back here.

All commands assume PowerShell, run from the project root after extracting
this round's zip over your existing checkout, and assume `SETUP-WINDOWS.md`
has already been completed once (so `node_modules`, your `.env`, and your
database already exist).

The sections below are split deliberately: **Part A never writes to your
database.** **Part B does, and each command in it says exactly what it will
change before you run it.** Run Part A first, every time. Run Part B only
when you mean to.

---

## Part A — Safe, read-only validation (run this first, always)

### A.1. Install this round's new/updated npm dependencies

This round added `recharts`, the Radix UI primitives shadcn/ui needs, and a
few small utility packages (`class-variance-authority`, `clsx`,
`tailwind-merge`, `tsx`). They are already declared in `package.json`; this
just resolves them into `node_modules`.

```powershell
npm install
```

### A.2. Apply this round's shadcn/ui component groundwork (optional, non-destructive)

This round could not run the `shadcn` CLI from its own sandbox (no network
route to `ui.shadcn.com` there). `components.json` and `lib/utils.ts` are
already in place and correct; the commands below each add exactly one new
file under `components/ui/` and will never touch `components/ui/chart.tsx`
or any other existing file. Skip this section entirely if you don't need the
primitives yet — nothing delivered this round depends on them being
installed.

```powershell
npx shadcn@latest add button badge card table alert select input checkbox dialog tabs tooltip
```

See `INSTALLATION-COMMANDS.md` for the full per-component breakdown of what
each one would replace.

### A.3. Lint (read-only)

```powershell
npx eslint .
```

Expected: 0 errors, 0 warnings.

### A.4. TypeScript check (read-only)

```powershell
npx tsc --noEmit
```

Expected on a machine with **real internet access to `binaries.prisma.sh`**
(this round's own sandbox did not have this — see
`FINAL-IMPLEMENTATION-REPORT.md` §4/§5): once `npx prisma generate` (A.6) has
run successfully against a real engine binary, this should come back with
**0 errors**. If you instead see the same 760-error pattern this report
documents (TS7006/TS2694/TS2339/TS2305/TS2345/TS2322/TS18046), it means
`prisma generate` has not yet produced a real client on this machine —
run A.6 before re-running this check, not after.

### A.5. Unit + non-DB tests (read-only, no database required)

```powershell
npx vitest run --exclude "**/*-db.integration.test.ts"
```

Expected: 60 files passed, 950 tests passed, 20 skipped.

### A.6. Generate the real Prisma client (read-only against your database — generates code locally, does not connect)

```powershell
npx prisma generate
```

This was blocked in this round's own sandbox (`binaries.prisma.sh` returned
403 there — a sandbox network-policy block, not a credential or schema
issue). On a normal machine with internet access this should succeed
immediately. Re-run A.4 and A.5 afterward — a few additional pure-logic
tests may behave slightly differently once real Prisma types are available,
though none are expected to newly fail.

### A.7. Check migration status (read-only — reports what *would* change, changes nothing)

```powershell
npx prisma migrate status
```

Expected: this should report exactly one pending migration —
`20261116130000_add_lost_sales_automation` — not yet applied. If it reports
*more* than one pending migration, stop and investigate before continuing to
Part B; that would mean an earlier round's migration was also never applied
to this database, and migrations should be applied in order.

### A.8. Dry-run the operational data reset (read-only — prints counts, deletes nothing)

```powershell
npm run db:reset-operational-data -- --dry-run
```

This prints, per table, how many rows exist across the 47 operational
tables this script is scoped to (orders, picking sessions, dispatches,
invoices, lost-sales records, etc. — see `DATABASE-CLEANUP-PLAN.md` for the
full table list). **It deletes nothing in `--dry-run` mode, under any
circumstances.** Run this as many times as you like.

### A.9. Run `next build` (read-only against your database — compiles the app)

```powershell
npm run build
```

This was blocked in this round's own sandbox by an inability to reach
`fonts.googleapis.com` for `next/font`'s Geist font fetch — again a sandbox
network-policy block, not a code defect (`app/layout.tsx`, where the font is
imported, was not touched by this round at all). On a normal machine with
internet access this should build cleanly. This has not been exercised
end-to-end for this round's new/changed pages anywhere in this engagement
before now — run it and read the output before deploying.

---

## Part B — Mutating steps (each one changes something; read what it does before running it)

Run these **only** after Part A is clean, and only in the order given —
each assumes the previous one succeeded.

### B.1. Apply this round's one migration

**What this changes:** adds one value to the `UnfulfilledDemandStatus` enum
(`SUPERSEDED`), three new nullable columns and one new nullable
self-referential foreign key to the `UnfulfilledDemand` table. All four
additions are nullable at the database level — **no backfill is required
and no existing row is modified.** This is purely additive; nothing is
dropped, renamed, or made `NOT NULL`.

```powershell
npx prisma migrate deploy
```

Before running this against a production database, run it first against a
disposable copy, and confirm `npx prisma migrate status` reports "up to
date" afterward.

### B.2. Run the DB-integration test suite against a real database

**What this changes:** these tests create and delete their own fixture rows
(orders, picking sessions, customers) inside transactions scoped to the
test run. **Run this only against a disposable or staging database, never
production** — while the tests are written to clean up after themselves,
this engagement's own standing policy is that no automated test run should
ever be pointed at a production database.

```powershell
$env:RUN_DB_INTEGRATION_TESTS = "1"
npx vitest run
```

Expected: the same 60 files / 950 tests this round's report confirmed
unconditionally, plus the 25 DB-integration files (207 additional tests)
now actually executing instead of self-skipping, all passing.

### B.3. The operational data reset itself — **do not run this without a separate, explicit go-ahead**

This round's standing constraint, carried through this entire engagement,
is unchanged by anything in this round: **the operational data reset must
never be run against any database without your own explicit, specific
approval at the time, never automatically, and never as part of a
deployment, migration, seeding, or startup routine.** It is documented here
only for completeness, with every gate it requires spelled out, so that if
and when you do decide to run it, you know exactly what it asks for and why:

```powershell
npm run db:reset-operational-data -- `
  --actor=<your-admin-user-id> `
  --backup-reference="<where your backup/snapshot lives, e.g. a Postgres snapshot id or pg_dump path>" `
  --confirm="RESET OPERATIONAL DATA FOR WILLSGROVE SALESFLOW" `
  --confirm-total-rows=<the exact number A.8's dry-run just printed as the grand total>
```

It will refuse to run for real unless **all** of the following are true,
checked in this order: the actor resolves to an `ACTIVE` `ADMINISTRATOR`
user; `--backup-reference` is present and non-blank; `--confirm` matches the
phrase above **exactly**; `--confirm-total-rows` is present and numeric;
and that number matches a **freshly recounted** total taken at the moment
the script runs — so a stale or copy-pasted command from an earlier
dry-run will be rejected rather than silently deleting a different amount
of data than you reviewed. Take a real backup (per your own
infrastructure's backup procedure — this script does not take one for you)
before ever supplying a `--backup-reference` and running this for real.

---

## Summary

| Step | Changes the database? | Section |
|---|---|---|
| `npm install` | No | A.1 |
| `npx shadcn@latest add ...` | No (adds files under `components/ui/` only) | A.2 |
| `npx eslint .` | No | A.3 |
| `npx tsc --noEmit` | No | A.4 |
| `npx vitest run --exclude "**/*-db.integration.test.ts"` | No | A.5 |
| `npx prisma generate` | No (generates local client code only) | A.6 |
| `npx prisma migrate status` | No | A.7 |
| `npm run db:reset-operational-data -- --dry-run` | No | A.8 |
| `npm run build` | No | A.9 |
| `npx prisma migrate deploy` | **Yes** — additive schema only | B.1 |
| `RUN_DB_INTEGRATION_TESTS=1 npx vitest run` | **Yes** — test fixtures only, disposable DB only | B.2 |
| `npm run db:reset-operational-data` (real run) | **Yes — destructively, 47 tables** | B.3, explicit approval required |
