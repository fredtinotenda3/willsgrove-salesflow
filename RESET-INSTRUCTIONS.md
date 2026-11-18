# Full reset to User + Product only

## What this does

Deletes every row in the database **except** `User` (logins) and `Product`
(your real SAP item master, already imported). Everything else — every
`Customer` and its contacts/locations, every order, quotation, invoice
claim, delivery, dispatch, approval, notification, price list, tax code,
personnel/vehicle record, integration config, session, and audit-log entry
— is wiped. This is for starting clean before re-running
`customer-master-import` (and any other master-data imports you use) against
a blank operational slate.

It never touches `Product` rows: that table is only ever read, never written,
by this script.

**Judgment call, flag before you run this:** a literal reading of "except
User and Products" also wipes `ApprovalPolicy`, `IntegrationConnection`,
`Personnel`, `Vehicle`, `Session`, and `AuditEvent` — none of which is pure
transactional/business data. If you want any of those *kept* instead
(e.g. your SAP integration config, or your driver/vehicle registers), say so
before running the real reset — removing a table from the delete list is a
small, low-risk change; putting data back after it's gone is not.

## Files in this package

- `lib/db-reset-operations.ts` — the actual delete logic (two phases,
  FK-order reasoning documented inline, cross-checked against
  `prisma/schema.prisma`'s own `onDelete` declarations).
- `lib/db-reset-args.ts` — updated with `FULL_RESET_CONFIRM_PHRASE` and two
  new optional parameters on `checkRealRunGuards` (a custom confirm phrase,
  and whether `--backup-reference` is required). Fully backward-compatible
  with the existing `reset-operational-data.ts` call site.
- `scripts/reset-operational-data.ts` — your existing, narrower reset
  script, refactored to delegate its delete logic to the new shared module
  (same behavior, zero duplication).
- `scripts/reset-to-user-and-product.ts` — **the new script you asked for.**
- `tests/db-reset-args.test.ts` — extended with 9 new tests covering the
  confirm-phrase and backup-reference parameters (28/28 passing).
- `package.json` — one new line: the `db:reset-to-user-and-product` script.

Drop these into the matching paths in your project (overwriting the three
existing files), then `npm install` is not required for this alone — no new
dependencies were added.

## How to run it

**1. This cannot be undone from within the application once it commits.**
You've said the current contents of every table this script removes are
test/setup data with nothing worth preserving, so this script does not
force a `--backup-reference` the way `db:reset-operational-data` does. If
that stops being true later — real Customer/order data has entered the
system by the time you'd ever run this again — take a real backup first
regardless of what the script enforces.

**2. Dry run (changes nothing) — find your admin user's id first:**

```bash
npm run db:reset-to-user-and-product -- --actor=<your-admin-user-id> --dry-run
```

This prints what will be **KEPT** (User/Product counts) and what will be
**REMOVED** (every other table, with a grand total at the bottom). Review it.

**3. Real run**, using the exact total the dry run just printed:

```bash
npm run db:reset-to-user-and-product -- \
  --actor=<your-admin-user-id> \
  --confirm="RESET TO USER AND PRODUCT DATA ONLY FOR WILLSGROVE SALESFLOW" \
  --confirm-total-rows=<N from the dry run>
```

Per your note that there's nothing in the affected tables worth backing up,
`--backup-reference` is **not required** for this script (unlike
`db:reset-operational-data`, which still requires one). You can still pass
`--backup-reference="<description>"` if you want one recorded in the audit
log — it's accepted, just not enforced.

If the total doesn't match a **fresh** recount taken the moment you run this
(not the dry run's cached number), it refuses — so a stale or copy-pasted
command can't silently delete a different amount of data than you reviewed.

**4. After it completes**, re-import your customer data (and any other
master data) through the application's normal import flows.

## Verification performed in this delivery

- `npx eslint` — clean on all 5 changed/new files.
- `npx tsc --noEmit` — the two new/modified scripts each show exactly one
  pre-existing, sandbox-only error (`Parameter 'tx' implicitly has an 'any'
  type`), identical to the same error on every other `prisma.$transaction`
  call site in your codebase (e.g. `lib/users.ts`, `lib/communications/
  dispatcher.ts`) — a stub-`@prisma/client`-typings artifact of this
  sandbox having no real database to generate against, not something these
  changes introduced.
- `npx vitest run` — 968 passed, 28/28 in `tests/db-reset-args.test.ts`
  (19 pre-existing + 9 new), 228 skipped (require a live DB, not available
  here), 2 pre-existing failures in `tests/acceptance-item-0228.test.ts`
  unrelated to this change (missing `test-data/` fixture files not present
  in this zip at all).
- Could not run the script against a real database from this sandbox (no
  live Postgres connection here) — the FK-order reasoning was instead
  verified by re-reading every relevant `onDelete` declaration directly in
  `prisma/schema.prisma` line by line (see the doc comments in
  `lib/db-reset-operations.ts`), not just restated from an earlier pass.
  Run the dry run and read its output carefully before the real run.
