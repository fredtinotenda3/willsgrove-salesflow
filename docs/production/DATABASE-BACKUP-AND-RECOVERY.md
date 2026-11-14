# Database Migration Integrity, Backup & Recovery — Milestone 16

## 1. Migration integrity review

**Method:** every one of the 20 migration directories supplied with this milestone's repository was inspected chronologically. A script cross-checked every `ALTER TABLE`/`REFERENCES` target against the set of tables already created by an earlier (or the same) migration, to catch ordering defects a manual read could miss.

### Finding (CRITICAL, fixed): out-of-order migration would break a fresh deploy

`prisma/migrations/20261110140630_add_invoice_reconciliation/migration.sql` contained exactly one statement:

```sql
ALTER TABLE "SapInvoiceLine" ALTER COLUMN "matchedAt" SET DATA TYPE TIMESTAMP(3);
```

`SapInvoiceLine` is not created until `20261110190000_add_invoice_reconciliation/migration.sql` — which, by its timestamp prefix, Prisma applies **after** `20261110140630`. Applied in order to a fresh database (exactly what `prisma migrate deploy` does, and exactly what this milestone's own safe-migration-sequence procedure in §2 below calls for), the `140630` migration would fail outright with a Postgres `relation "SapInvoiceLine" does not exist` error — blocking every fresh database setup, including the very first one Willsgrove ever runs.

Further, even if it could somehow run after `190000`, it would have **regressed** the column's type: `190000` creates `matchedAt` directly as `TIMESTAMPTZ(6)` (the type every other timestamp column in this schema uses — confirmed by cross-checking `Product.createdAt`/`updatedAt` and others), while `140630` would change it to `TIMESTAMP(3)` — no time zone, 3 fractional digits — a real regression on a timestamp used for invoice-matching, not a neutral change.

This is leftover cruft from draft schema iteration during Milestone 5's own development (the table was evidently redesigned and regenerated as a single clean migration before `add_invoice_reconciliation` was finalized, and the earlier, now-dead migration file was never removed) — not something introduced by this milestone. It has, as far as this audit can determine, **never been applied to any real database**: every environment this project has ever been built in has had `prisma generate`/`migrate deploy` blocked by the sandbox's network restriction on `binaries.prisma.sh` (reconfirmed this round — see §11 of the delivery report), so no migration in this project's history has ever actually run against a live Postgres instance.

**Fix applied:** the dead `20261110140630_add_invoice_reconciliation` migration directory was deleted. The remaining 19 migrations were re-verified with the same automated check: zero ordering issues found.

**Mandatory pre-deployment check, before this fix is trusted against any real target database:** run `npx prisma migrate status` against that database **before** running `migrate deploy` for the first time against it.
- If it reports no migrations applied yet (a genuinely fresh database), this fix is safe exactly as delivered.
- If it reports `20261110140630_add_invoice_reconciliation` as already applied to that specific database (meaning someone, somewhere, with real network access, already ran it against a real Willsgrove database before this audit), **do not simply copy this milestone's migrations folder over it.** That database's migration history and this repository's migration folder would now disagree, and Prisma's own `migrate resolve` command (not a file deletion) is the correct, documented path to reconcile that — consult Prisma's migration-history-editing documentation at that point rather than reapplying this fix blindly.

This is exactly the kind of irreversible-if-wrong decision this milestone's spec reserves for a human with real access to the actual target database, not something to assume away in a sandbox with no live database to test against.

### No other ordering, data-loss, or referential-integrity issues found

- Only one `DROP COLUMN` exists anywhere in the migration history (`20261104054652_add_sap_product_barcode`, dropping three columns from `Product` during the earliest hours of the project, long before any real data existed). No other migration drops a column, table, or enum value.
- Foreign-key `ON DELETE` behaviour is consistent throughout: `RESTRICT` on every FK that protects against deleting a referenced parent while a child row exists (the project's established convention, matched by `scripts/remove-demo-data.ts`'s own FK-ordered cleanup), with `CASCADE` used only for `ON UPDATE` (ID stability on update, never a surprise cascading delete).
- The Milestone 15 migration (`20261113060000_add_decision_intelligence`, specifically flagged for attention by this milestone's spec) was read in full: entirely additive, no dropped column, correctly indexed (10 indexes across its 2 new tables, including a composite `(isDemo, status)` index matching the demo-exclusion query pattern), and its own header comment honestly discloses it has never been applied or tested against a live database — exactly the standard this review expects and the standard every migration in this project should be held to.
- `prisma/migrations/migration_lock.toml` correctly declares `provider = "postgresql"`.

## 2. Safe migration sequence (for every future deploy, including the first)

1. **Confirm the target.** Run `echo $DATABASE_URL` (or check the host's dashboard) and visually confirm it is the database you intend to migrate — never assume from memory which environment a shell is pointed at.
2. **Confirm a backup exists and is recent** (see §3) before touching a database that holds anything real.
3. **Check migration status:** `npx prisma migrate status`. Read its output — do not proceed past a status that doesn't match your expectation (e.g. it reports migrations as applied that you didn't expect, or a drift warning).
4. **Review what's pending:** `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script` (or simply read the new migration's `.sql` file — they are short and meant to be human-read) before applying anything to a database that matters.
5. **Deploy:** `npx prisma migrate deploy`. This command, unlike `migrate dev`, never prompts and never resets data — it is the correct command for every environment beyond a developer's own machine, staging included.
6. **Verify schema:** `npx prisma migrate status` again — confirm it now reports "Database schema is up to date."
7. **Verify application health:** `GET /api/health` (readiness) returns `database: "connected"`, and `GET /api/health/live` returns `status: "alive"`.
8. **Confirm core workflows:** log in, open the orders list, open one customer's 360 profile — a smoke test that touches the most heavily-used tables, not a full regression pass.
9. **Record the result:** date, who ran it, which migration(s) were newly applied, and the health-check output, in whatever change log Willsgrove keeps for production changes (see `docs/production/GO-LIVE-CHECKLIST.md`).

**Never run `prisma migrate reset` against a database that holds anything real** — it drops and recreates the entire schema. It is a development-only command. Nothing in the procedure above ever calls it, and no documentation in this delivery recommends it for anything but a disposable local/test database.

## 3. Backup and recovery — what Willsgrove needs to decide and configure

This sandbox has no live database and no hosting account, so **no backup has been configured or verified by this milestone** — anything stated as fact here would be invented, which the spec explicitly forbids ("do not claim backups exist unless they have been configured and verified"). What follows is the concrete plan Willsgrove (or whoever manages the real database) needs to put in place, plus the one piece this milestone *can* and did verify: that the restore procedure, once backups exist, is safe to describe precisely.

### What must be decided and configured (not yet done — no live database exists to configure)

| Decision | Recommendation | Owner |
|---|---|---|
| Backup frequency | At minimum daily full backups; if the chosen Postgres host offers continuous WAL archiving / point-in-time recovery (PITR), enable it — most managed providers (Neon, RDS, Supabase, etc.) offer this with no custom scripting needed. | Willsgrove's chosen hosting provider / whoever administers the database |
| Retention | At minimum 30 days of daily backups, or whatever the hosting provider's standard retention tier provides — confirm the actual number, do not assume a provider's default is sufficient for Willsgrove's own audit/compliance needs. | Same |
| Storage location | Backups must live in a location separate from the primary database (most managed providers already do this) — never only on the same disk/volume as the live database. | Same |
| Encryption | Confirm the provider encrypts backups at rest (standard for every major managed Postgres provider) — do not assume; check the provider's own documentation. | Same |
| Access control | Only the database administrator role should be able to initiate a restore or download a backup. | Same |
| RPO/RTO | **Proposed targets, not yet approved:** RPO (maximum acceptable data loss) of 24 hours if only daily backups are used, or near-zero if PITR is enabled; RTO (maximum acceptable downtime to restore) of 2–4 hours for a single-database, single-process application of this size. **These are proposals requiring explicit Willsgrove management sign-off, not a committed SLA this document can set unilaterally.** |
| File storage backup | **Separately from the database** — `STORAGE_LOCAL_DIR` (uploaded order/claim documents) lives on local disk and is captured by **no** database backup. If this directory is not separately backed up (e.g. host-level disk snapshots, or a periodic sync to object storage), every uploaded document is unrecoverable if that disk is lost. This is a real, distinct risk from the database backup question and must be decided alongside it. |

### Restore procedure (the documented procedure — verify it against a **separate**, non-production database before trusting it against the real one)

1. Provision a **separate** Postgres instance/database — never restore on top of the live production database to "test" a restore.
2. Restore the chosen backup (full dump or PITR snapshot, per whatever the hosting provider's own restore tooling provides) into that separate instance.
3. Point a throwaway copy of this application's `DATABASE_URL`/`DIRECT_URL` at the restored instance.
4. Run `npx prisma migrate status` against it — confirm the restored database's migration history matches what this repository's `prisma/migrations/` folder expects.
5. Run the application's health check and a handful of read queries (e.g. list customers, list orders) against the restored copy to confirm the data is actually usable, not just present.
6. Record how long steps 1–5 took — that measured time is the real evidence for the RTO figure above, not a guess.
7. Tear down the throwaway restored instance once verified.

**Never test recovery by restoring over the production database.** This procedure was not actually executed in this delivery because no real backup and no second database exist in this sandbox to restore from — it is the documented, ready-to-run procedure for whoever does have access to Willsgrove's real database and hosting account, recorded here precisely so that first real restore test is not improvised.
