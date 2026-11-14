# Files deleted by Milestone 16

A zip archive cannot represent a deletion. When applying this milestone's
changes to your own copy of the repository, delete this file/directory
manually:

- `prisma/migrations/20261110140630_add_invoice_reconciliation/`
  (the entire directory and its `migration.sql`)

Reason: this migration runs (by its timestamp-prefixed name) BEFORE
`prisma/migrations/20261110190000_add_invoice_reconciliation/`, which is
the migration that actually creates the `SapInvoiceLine` table this
earlier one tries to `ALTER`. Applied in order to a fresh database,
`prisma migrate deploy` would fail with "relation does not exist."

**Before deleting it from a repository that has ever been deployed
anywhere real**, run `npx prisma migrate status` against that database
first. If `20261110140630_add_invoice_reconciliation` shows as already
applied there, do NOT just delete the folder — run
`npx prisma migrate resolve --applied 20261110140630_add_invoice_reconciliation`
instead, or ignore this deletion entirely for that specific database and
treat it as institutional history. Full detail:
`docs/production/DATABASE-BACKUP-AND-RECOVERY.md` §1.
