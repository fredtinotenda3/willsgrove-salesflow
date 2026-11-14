# Windows Setup — Milestone 0

Written for PowerShell on Windows. Commands assume you're in the project
root unless noted.

## 0. Prerequisites

- **Node.js >= 20.9.0** (Next.js 16's own minimum — confirmed working on
  v20.20.2, which is what this guide and the test suite were verified
  against; see `docs/milestones/PROGRESS.md`). Check with:
  ```powershell
  node -v
  ```
- **PostgreSQL** reachable from this machine (local install, Docker, or a
  remote dev instance) with a database created for this app.
- Git Bash or WSL is **not** required — everything below is plain
  PowerShell + `npm`.

## 1. PowerShell execution policy

If `npm` or `npx` fail with something like *"running scripts is disabled
on this system"*, PowerShell's script execution policy is blocking the
`.ps1` shims npm installs. Check your current policy:

```powershell
Get-ExecutionPolicy -List
```

The usual fix, for the current user only (does not require
Administrator, does not weaken the machine-wide policy):

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

`RemoteSigned` allows locally-created scripts (which is what `npm`
generates) while still requiring a signature for scripts downloaded from
the internet. Avoid `Unrestricted` — it's broader than this needs.

If your organization manages execution policy centrally (a `Set-
ExecutionPolicy` under `-Scope CurrentUser` getting silently overridden,
or a message about a Group Policy), you won't be able to change this
yourself — ask whoever manages the machine to allow `RemoteSigned` or
run `npm`/`npx` through `cmd.exe` instead of PowerShell as a workaround
for this project.

## 2. Install dependencies

```powershell
npm install
```

This also installs `prisma` and `tsx`, both used below.

## 3. Configure environment

```powershell
Copy-Item .env.example .env.local
```

Then edit `.env.local` in your editor and fill in every value — see the
comments in `.env.example` for what each one is and how to generate it.
In particular:

- `AUTH_SECRET` — generate with:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
- `STORAGE_LOCAL_DIR` — an **absolute path outside this project folder**,
  e.g. `C:\willsgrove-storage`. Create it if it doesn't exist:
  ```powershell
  New-Item -ItemType Directory -Force -Path "C:\willsgrove-storage"
  ```
- `SEED_ADMIN_PASSWORD` — any password meeting the strength check in
  `lib/auth/password.ts` (at least 10 characters, not a known-trivial
  password, under 256 characters). You'll be forced to change it on first
  login regardless, since the seed sets `mustChangePassword: true`.

`.env.local` is in `.gitignore` — it will not be committed, and nothing in
it should ever be pasted into chat, a commit message, or a support ticket.

## 4. Generate the Prisma client

```powershell
npx prisma generate
```

This downloads Prisma's query-engine binaries and generates
`@prisma/client`'s types from `prisma/schema.prisma`. **This step could not
be run in the build sandbox** (its network allowlist blocks
`binaries.prisma.sh`) — it is expected to work normally here, with regular
internet access. If it fails, check the error for a specific blocked host
or proxy issue before assuming anything is wrong with the schema itself.

## 5. Run the migration

```powershell
npx prisma migrate deploy
```

This applies `prisma/migrations/20261107070000_milestone_0_foundations/`
— purely additive (new columns with defaults, one new table, new indexes;
no drops, renames, or type changes), so it's safe to run against a
database that already has real rows in it.

If you're setting up a brand-new, empty database instead and want Prisma
to also create every earlier migration's tables from scratch, use
`migrate deploy` the same way — it applies every pending migration in
order, not just the newest one.

## 6. Seed the database

```powershell
npm run db:seed
```

This creates:
- The one real administrator account (`SEED_ADMIN_EMAIL` /
  `SEED_ADMIN_PASSWORD`), with `mustChangePassword: true`.
- A small set of clearly-labelled demo customers and demo orders (all
  `isDemo: true`), built by calling the same `createCustomer()` /
  `createOrder()` functions the real API uses.

**As of this fix round, this script no longer creates any demo
products.** Willsgrove's real SAP item catalogue (`sapItemCode`,
`itemName`, `barcode`, `category`) is imported separately, from the
browser, once the app is running (step 8 below) — go to **Products →
Import**, sign in as the admin, and upload your SAP items export. That
import is what the Products page and the order-lines catalogue search
on **Receive New Order** are reading from; this script never invents
placeholder SAP codes.

The demo orders this script creates need *something* real to reference,
so they look up a handful of already-imported, real products
(`isDemo: false`) rather than creating any — if you run `npm run
db:seed` **before** importing the catalogue (e.g. on a brand-new
database), you'll see a console message like:

```
Demo orders skipped: only found 0 real, active SAP product(s) (need at least 3).
Import the SAP catalogue via Products -> Import in the browser, then re-run
`npm run db:seed` to add demo orders referencing it. The admin account and
demo customers above were still seeded normally.
```

That's expected, not an error — the admin account and demo customers are
still created either way. Import the catalogue (step 8), then simply
**re-run `npm run db:seed`** to add the demo orders retroactively, now
referencing your real products.

Safe to re-run either way — it upserts/looks up by natural key rather
than inserting duplicates.

**If you already ran an older version of this script** (before this fix
round) and have the old `DEMO-0001`..`DEMO-0006` placeholder products in
your database: run `npm run db:remove-demo` (step 7 below) to clear out
the old demo products, customers and orders in one safe, transactional
sweep, then re-run `npm run db:seed` to recreate the demo customers and
orders fresh — this time referencing your real imported catalogue
instead of the old placeholders.

**Why this needs `tsx --conditions=react-server`** (already set up for
you in `package.json`'s `db:seed` script and in `prisma.config.ts`'s
`migrations.seed`, so you shouldn't need to type this yourself): several
library files import the `server-only` package, which throws unless the
module resolver sets Next.js's special `"react-server"` export condition.
Next's own bundler sets that automatically; a plain `tsx prisma/seed.ts`
without the flag would fail. If you ever add a new script that imports
anything under `lib/auth/` or `lib/storage/` and run it with `tsx`
directly, remember to add `--conditions=react-server` to that command too.

## 7. Removing demo data

```powershell
npm run db:remove-demo
```

Deletes every `isDemo: true` row, in one transaction, in
foreign-key-safe order. Records an audit event with the counts removed.
Does **not** touch the seeded administrator account (it's a real account,
`isDemo: false`) or any real data you've created since — **including
every product imported via Products → Import**, which is always
`isDemo: false` regardless of how few (or how many) of those real
products happen to be referenced by a demo order's lines. This script
already scoped product deletion to `isDemo: true` before this fix round,
so it's unchanged here — it's documented explicitly now because this is
the command to use if you have the old `DEMO-0001`..`DEMO-0006`
placeholder products from before this fix round and want them gone
without touching your real catalogue.

## 8. Run it

```powershell
npm run dev
```

Then open http://localhost:3000 (or whatever `APP_BASE_URL` you set — the
two must match exactly, or the CSRF check on login will reject the
request).

## 9. Manual test script (no coding required)

This is a click-through checklist for confirming the app actually works,
written for someone who isn't a developer. It doesn't replace `npm test`
/ `tsc` / `lint` / `npm run build` (those check the code itself) — this
checks the running application, the way a user would. Do it after step 8
(`npm run dev`), with the app open in a browser at `http://localhost:3000`
(or whatever `APP_BASE_URL` you set).

Each step says what you should see. If you see something else, stop and
report exactly what step failed and what happened instead — that's far
more useful for tracking down a problem than "it didn't work."

1. **Log in.** Use the admin email/password you set in `.env.local`
   (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).
   - ✅ You're immediately asked to set a new password (this is forced —
     the seeded password is meant to be used exactly once).
   - Pick a new password and submit.
   - ✅ You land on the Dashboard.

2. **Check the dashboard counts.** Look at the four number cards at the
   top (Total Orders, Pending Verification, Awaiting Fulfilment,
   Completed Deliveries).
   - ✅ These are real numbers from the database — they'll most likely
     all read **0** right now, since no real (non-demo) order exists
     yet. That's correct, not a bug.
   - The colourful pipeline bar chart and order list further down the
     dashboard are **not** wired up yet (still placeholder content from
     before this milestone) — you don't need to check those.

3. **Check user management.** Go to Settings → Users & Roles.
   - ✅ Your own admin account is listed.
   - Click "Add User", fill in a name/email/role, and submit.
   - ✅ A temporary password is shown **once**, with a copy button. Write
     it down or copy it now — it will not be shown again.
   - ✅ Try to deactivate your own account from this screen — it should
     be blocked (you can't lock yourself out).

4. **Import the real SAP catalogue (if you haven't already).** Go to
   Products → Import.
   - Upload your SAP items export (the same CSV behind your Products
     page).
   - ✅ The preview shows real counts, then the import completes and the
     Products page lists your real items, each with a real SAP item
     code.
   - This only needs doing once — later steps rely on these real
     products existing.

5. **Create an order using manual entry with the catalogue search.** Go
   to Orders → "Receive New Order".
   - Search for and select a customer (the demo data seeded a handful —
     type a few letters of a name to find one).
   - In an order line, use the "Catalogue search" box and type a few
     letters of a real product's **name**, then clear it and try a real
     **SAP item code**, then (if one of your real products has a
     barcode) the **barcode** — each should find and let you select the
     same real product.
   - Fill in a quantity (e.g. `10`) and unit (e.g. `KG` or `EA`) for that
     line, then click "Submit Order".
   - ✅ You land on an "Order Received" screen showing a real order
     reference like `ORD-20261109-A1B2C3D4`.

6. **Create an order from a pasted message only — no lines, no file.**
   Go to Orders → "Receive New Order" again.
   - Select a customer.
   - Paste a couple of lines of text into "Customer's message or PO
     text". Leave every order line blank and attach no file.
   - Click "Submit Order".
   - ✅ This succeeds — a zero-line order from pasted text alone is
     expected to work, not an error.

7. **Create an order from uploaded file(s) only — no lines, no pasted
   text, multiple files.** Go to Orders → "Receive New Order" again.
   - Select a customer.
   - Click "Attach file(s)" and choose one file, then click it again and
     choose a second file (any PDFs or images on your computer). Leave
     the message box and every order line blank.
   - Click "Submit Order".
   - ✅ This succeeds. On the "Order Received" screen, both files show
     "Uploaded" one after another (not stuck on "Uploading...").

8. **Find your orders in the list.** Go back to Orders.
   - ✅ All three orders you just created are in the list, with the
     right customer names and references.
   - ✅ The manual-entry order's amount reads **"Pending pricing"** —
     that's correct, not a bug. Pricing and approval are a later
     milestone, not built yet.
   - ✅ The four summary cards at the top of this page now include your
     new orders in their counts.

9. **Open each order and check what's shown.**
   - ✅ Every order shows an amber notice explaining that
     verification/pricing/approval isn't built yet — an honest "not
     built" notice, not an error.
   - ✅ The manual-entry order (step 5) lists its line item with the
     quantity, unit, and linked SAP item code you selected.
   - ✅ The pasted-message order (step 6) shows **"No line items yet"**
     in Order Lines, and an "Original Message" card further down with
     your pasted text shown exactly as you typed it.
   - ✅ The file-only order (step 7) also shows "No line items yet", and
     both files are listed under Documents with working "Download"
     buttons — click one and confirm it opens correctly.
   - ✅ Each order's "Status History" shows one entry: "Order Received",
     with your name and the current date/time.

10. **Confirm Stock and Reports are still clearly demo.** Open each from
    the sidebar.
    - ✅ Both are still visibly labelled as demo/prototype data — they
      are **not** wired to the real database in this milestone, by
      design.

11. **Remove demo data and confirm your real catalogue survives.** In a
    terminal, run `npm run db:remove-demo` (see step 7 above).
    - ✅ The console reports counts for orders, customers, locations and
      **0 products removed** if you never had the old `DEMO-0001`..
      `DEMO-0006` placeholders, or the exact count of those old demo
      products if you did.
    - Go back to the Products page in the browser (refresh it).
    - ✅ All of your real, imported SAP products are still there,
      untouched — only demo rows were removed.
    - Go back to Orders.
    - ✅ The demo orders (`PO-DEMO-1001` etc., if your database had any)
      are gone; the three real orders you created in steps 5-7 are still
      there.

12. **Log out and back in.** Use the sidebar's user menu to log out, then
    log back in with the **new** password you set in step 1 (not the
    original seeded one).
    - ✅ This confirms the password change really was saved, and that
      logging in and out works correctly.

If every step above matched its ✅, the real, non-demo parts of this
milestone (login, forced password change, user management, catalogue
import, order intake in all three combinable modes with real products
and real file uploads, the order list/detail views, and safe demo-data
removal) are working end to end against your real database.

## 10. Undoing the migration

Prisma's modern CLI (`prisma migrate dev` / `deploy`) does not generate an
automatic "down" migration — you write the reverse SQL yourself. For this
specific migration, the exact inverse of
`prisma/migrations/20261107070000_milestone_0_foundations/migration.sql`
is:

```sql
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";

DROP INDEX "OrderLine_isDemo_idx";
DROP INDEX "CustomerOrder_isDemo_idx";
DROP INDEX "CustomerOrder_idempotencyKey_key";
DROP INDEX "Product_isDemo_idx";
DROP INDEX "CustomerLocation_isDemo_idx";
DROP INDEX "Customer_isDemo_idx";
DROP INDEX "User_isDemo_idx";
DROP INDEX "Session_expiresAt_idx";
DROP INDEX "Session_userId_idx";

DROP TABLE "Session";

ALTER TABLE "OrderLine" DROP COLUMN "isDemo";

ALTER TABLE "CustomerOrder"
  DROP COLUMN "isDemo",
  DROP COLUMN "invoicedAt",
  DROP COLUMN "handedToSapAt",
  DROP COLUMN "approvedAt",
  DROP COLUMN "reviewedAt",
  DROP COLUMN "extractedAt",
  DROP COLUMN "receivedAt",
  DROP COLUMN "idempotencyKey";

ALTER TABLE "Product" DROP COLUMN "isDemo";
ALTER TABLE "CustomerLocation" DROP COLUMN "isDemo";
ALTER TABLE "Customer" DROP COLUMN "isDemo";

ALTER TABLE "User"
  DROP COLUMN "isDemo",
  DROP COLUMN "mustChangePassword";
```

**This is destructive** — it permanently deletes the `Session` table
(signing everyone out) and every `isDemo`/timing/idempotency column, along
with any data already stored in them. Back up first:

```powershell
pg_dump -Fc -d <your-database-name> -f backup-before-undo.dump
```

To apply the rollback, either run the SQL above directly against your
database (`psql`, a GUI client, whatever you normally use), or save it as
a `.sql` file and run:

```powershell
npx prisma db execute --file .\rollback-milestone-0.sql --schema prisma/schema.prisma
```

After rolling back the database, also revert `prisma/schema.prisma` to
remove the same model/field changes (or just restore it from before this
milestone), then run `npx prisma generate` again so the generated client
matches the now-reverted schema. Do **not** delete the migration folder
from `prisma/migrations/` and then try to run `migrate deploy` again
without also telling Prisma's migration history about the rollback (`npx
prisma migrate resolve --rolled-back
20261107070000_milestone_0_foundations`) — otherwise Prisma will think
this migration is still pending and you'll get a confusing failure the
next time you try to apply it.

## 11. Milestone 1: SAP master data (tax codes, item master, price lists, customer master)

This migration is purely additive (no column dropped, no table dropped),
but it cannot be validated or generated in the build sandbox — run these
for real on your machine.

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_sap_master_data

# 2. Regenerate the Prisma client so it knows about TaxCode, PriceList,
#    PriceListEntry, CustomerContact, and the new Product/Customer columns
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test
```

If `prisma migrate dev` reports schema drift because you've been running
against the hand-written SQL already, use `migrate deploy` instead:

```powershell
npx prisma migrate deploy
npx prisma generate
```

### Importing the sample files

Four new pages, each the same upload → preview → confirm flow as the
existing product importer:

- `/tax-codes/import` — upload `test-data/sample-tax-codes.csv`
- `/item-master/import` — upload `test-data/sample-item-master-extension.csv`
  (run this *after* products already exist — e.g. after your Milestone 0
  product import — since this one only extends existing rows)
- `/price-lists/import` — upload `test-data/sample-price-lists.csv`
- `/customers/master-import` — upload `test-data/sample-customer-master.csv`

The item `0228` / customer `HREC0D677` rows in all four sample files are
real, taken from your invoice `HRE580108`; everything else in those
files is an illustrative placeholder for your SAP administrator to
replace with real exports (see `docs/sap-exports/*.csv.md` for the exact
column layouts).

### Manual test script (no coding required)

1. Import the four sample files above, in the order listed, each via
   preview → confirm.
2. Open `/catalogue/health` and confirm it loads without error against
   your real product catalogue (not the sample files — it reads whatever
   is actually in your `Product` table).
3. Open your database client (or `npx prisma studio`) and confirm:
   - `Product` row for `0228` now has `unitOfMeasure = "PNT"`,
     `packSize = "250G"`, `vatCode = "VAT00"`.
   - `TaxCode` row `VAT00` has `ratePercent = 0.00`.
   - `PriceList` row `PL-TM-CHINHOYI` has one `PriceListEntry` for item
     `0228` at `unitPrice = 0.45`.
   - `Customer` row `HREC0D677` has `tin = "2000003164"`, `vatNumber =
     "220003216"`, and `priceListId` pointing at `PL-TM-CHINHOYI`.
4. Confirm the arithmetic matches invoice `HRE580108`: 10 × 0.45 = 4.50,
   VAT at 0% = 0.00. (This exact check also runs unconditionally as
   `tests/acceptance-item-0228.test.ts`, with no database needed — `npm
   test` already confirms it in the sandbox.)

### Removing demo data (updated)

`npm run db:remove-demo` now also cleans up any demo rows (`isDemo:
true`) in the four new tables — nothing changes in how you run it.

### 11a. Undoing this migration

**This is destructive** — it drops the three new price-list/tax-code/
contact tables and every new column, along with any data already stored
in them. Back up first:

```powershell
pg_dump -Fc -d <your-database-name> -f backup-before-undo-milestone-1.dump
```

```sql
ALTER TABLE "PriceListEntry" DROP CONSTRAINT "PriceListEntry_priceListId_fkey";
ALTER TABLE "PriceListEntry" DROP CONSTRAINT "PriceListEntry_productId_fkey";
ALTER TABLE "CustomerContact" DROP CONSTRAINT "CustomerContact_customerId_fkey";
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_priceListId_fkey";

DROP INDEX "Customer_storeCode_idx";
DROP INDEX "Customer_priceListId_idx";
DROP INDEX "Product_vatCode_idx";
DROP INDEX "CustomerContact_isDemo_idx";
DROP INDEX "CustomerContact_customerId_idx";
DROP INDEX "PriceListEntry_isDemo_idx";
DROP INDEX "PriceListEntry_validFrom_validTo_idx";
DROP INDEX "PriceListEntry_priceListId_sapItemCodeSnapshot_idx";
DROP INDEX "PriceList_isDemo_idx";
DROP INDEX "PriceList_code_key";
DROP INDEX "TaxCode_isDemo_idx";
DROP INDEX "TaxCode_code_key";

ALTER TABLE "Customer"
  DROP COLUMN "priceListId",
  DROP COLUMN "creditHold",
  DROP COLUMN "creditLimit",
  DROP COLUMN "storeCode",
  DROP COLUMN "branchCode",
  DROP COLUMN "paymentTermsCode",
  DROP COLUMN "currencyCode",
  DROP COLUMN "vatNumber",
  DROP COLUMN "tin";

ALTER TABLE "Product"
  DROP COLUMN "vatCode",
  DROP COLUMN "isVariableWeight",
  DROP COLUMN "packSize",
  DROP COLUMN "unitOfMeasure";

DROP TABLE "CustomerContact";
DROP TABLE "PriceListEntry";
DROP TABLE "PriceList";
DROP TABLE "TaxCode";
```

Apply it the same way as section 10's rollback (`psql`, a GUI client, or
`npx prisma db execute --file .\rollback-milestone-1.sql --schema
prisma/schema.prisma`), then revert `prisma/schema.prisma` to remove the
same changes and run `npx prisma generate` again. Also tell Prisma's
migration history about the rollback so a future `migrate deploy`
doesn't think this migration is still pending:

```powershell
npx prisma migrate resolve --rolled-back 20261109090000_add_sap_master_data
```

## 12. Milestone 2A: PO intake, document storage, classification, extraction

This migration is purely additive — no column dropped, no table dropped,
and the two existing `OrderSource` values (`EMAIL`/`WHATSAPP`) and
`OrderDocument`'s previous columns are untouched. As with Milestone 1, it
cannot be validated or generated in the build sandbox — run these for real
on your machine.

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_po_intake_extraction

# 2. Regenerate the Prisma client so it knows about the new OrderSource
#    values, the four new enums, OrderDocument's new columns, and the new
#    ExtractionRun model
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test
```

If `prisma migrate dev` reports schema drift because you've been running
against the hand-written SQL already, use `migrate deploy` instead:

```powershell
npx prisma migrate deploy
npx prisma generate
```

### Configure the extraction provider

Add to your `.env` (see `.env.example` for the full comment block):

```
# Leave unset to use the mock provider (works with no API key at all --
# fine for development and for trying out the intake flow before you have
# a real key).
ANTHROPIC_API_KEY=
# Optional -- defaults to claude-sonnet-5-5 if unset.
ANTHROPIC_MODEL=
# Optional -- set to "mock" to force the mock provider even with a real
# key configured (useful for predictable demos that shouldn't spend a
# real API call).
EXTRACTION_PROVIDER=
```

Nothing else needs configuring for CSV/Excel intake — those never call an
AI provider regardless of this configuration.

### Manual test script (no coding required)

This covers both the "no API key" path (what you'll see before you have a
real Anthropic key) and the deterministic Excel/CSV path (which never
needs one).

1. Leave `ANTHROPIC_API_KEY` unset (or blank) for now. Start the app and
   open **PO Intake** in the sidebar.
2. **CSV test**: create a small CSV file (e.g. in Excel, saved as CSV) with
   columns `Description, Quantity, Unit` and two rows, something like
   `Baby Marrow 250G Punnet, 10, PNT` and `Tomatoes Box, 5, BOX`. Upload it
   via the "Upload a file" option. Confirm:
   - The document appears in the list with status **Extracted**.
   - Opening it shows an extraction run with provider **DETERMINISTIC**
     (no AI call was made).
   - Both lines show the exact description you typed and quantity `10`
     / `5`, with no price filled in.
3. **Excel test**: repeat step 2 but save the same two rows as a real
   `.xlsx` file instead of CSV. Confirm the same result — provider
   **DETERMINISTIC**, same two lines.
4. **Pasted WhatsApp text test (mock provider, no key)**: switch to
   "Paste text", choose **WhatsApp**, and paste something like:
   ```
   10 Baby Marrow 250g punnet
   Tomatoes, usual box please
   ```
   Confirm the extraction run shows provider **MOCK**, the first line's
   quantity is `10`, and the second line's quantity is **blank/null** with
   a warning shown next to it (it should never guess a number for "usual
   box please").
5. **Re-extract**: on any document above, use the re-extract action.
   Confirm a *second* extraction run appears underneath the first —
   the original run is never overwritten or removed.
6. **With a real Anthropic key**: once you have `ANTHROPIC_API_KEY` set,
   restart the app and upload a real scanned/photographed PO (PDF or
   JPEG/PNG). Confirm the extraction run shows provider **ANTHROPIC** and
   a plausible model name, and spot-check that the extracted lines match
   what's actually on the document — particularly that it never merges
   two different pack sizes of the same product into one line, and that
   it leaves quantity/price `null` rather than guessing wherever the
   document doesn't clearly state one. This step is the one piece of this
   milestone that could not be verified before reaching your machine —
   see `docs/milestones/PROGRESS.md`.
7. The acceptance test for this milestone
   (`tests/acceptance-po-intake-deterministic.test.ts`) runs
   unconditionally with no database needed — `npm test` already confirms
   the CSV/Excel/pasted-text logic above in the sandbox; steps 1–6 are
   what confirm the actual upload/paste/re-extract flow and a real
   Anthropic call end to end on your machine.

### 12a. Undoing this migration

**This is destructive** — it drops the new `ExtractionRun` table, the four
new columns on `OrderDocument`, and the four new enum types, along with
any data already stored in them. Back up first:

```powershell
pg_dump -Fc -d <your-database-name> -f backup-before-undo-milestone-2a.dump
```

```sql
ALTER TABLE "ExtractionRun" DROP CONSTRAINT "ExtractionRun_documentId_fkey";

DROP INDEX "ExtractionRun_isDemo_idx";
DROP INDEX "ExtractionRun_status_idx";
DROP INDEX "ExtractionRun_documentId_idx";
DROP INDEX "OrderDocument_status_idx";
DROP INDEX "OrderDocument_documentGroupId_idx";

DROP TABLE "ExtractionRun";

ALTER TABLE "OrderDocument"
  DROP COLUMN "pageNumber",
  DROP COLUMN "documentGroupId",
  DROP COLUMN "status",
  DROP COLUMN "classification",
  DROP COLUMN "sourceChannel";

DROP TYPE "ExtractionRunStatus";
DROP TYPE "ExtractionProvider";
DROP TYPE "DocumentIntakeStatus";
DROP TYPE "DocumentClassification";
```

**`OrderSource`'s four new values (`PDF`/`IMAGE`/`EXCEL`/`CSV`) cannot be
cleanly dropped** — Postgres has no `ALTER TYPE ... DROP VALUE`. If you
need to fully reverse this migration including those enum values (rather
than just leaving the four extra, unused values in place, which is
harmless), the only way is to recreate the type: create a new
`OrderSource_old` enum with just `EMAIL`/`WHATSAPP`/`MANUAL`, convert every
column that uses `OrderSource` (`OrderDocument.sourceChannel` from this
migration, and `CustomerOrder.source` from Milestone 0) to it, drop the
current `OrderSource` type, and rename `OrderSource_old` to `OrderSource`
— and this would also then require this migration's own `ADD COLUMN`
rollback above to run first (since `OrderDocument.sourceChannel` has to
exist to be converted, then dropped by the block above). Given how invasive
that is for a value that costs nothing to simply leave unused, leaving the
four extra enum values in place is the recommended path for any partial
rollback.

Apply the reversible part the same way as section 10/11's rollback
(`psql`, a GUI client, or `npx prisma db execute --file
.\rollback-milestone-2a.sql --schema prisma/schema.prisma`), then revert
`prisma/schema.prisma` to remove the same changes and run `npx prisma
generate` again. Also tell Prisma's migration history about the rollback:

```powershell
npx prisma migrate resolve --rolled-back 20261109100000_add_po_intake_extraction
```

## 13. Milestone 2B: matching, aliases, duplicate detection, human review

This migration is purely additive — no column dropped, no table dropped,
no existing column's type or nullability changed. As with Milestones 1
and 2A, it cannot be validated or generated in the build sandbox — run
these for real on your machine.

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_matching_review_aliases

# 2. Regenerate the Prisma client so it knows about the new
#    ExtractedOrderLine/ProductAlias/CustomerAlias models, the two new
#    enums, and DocumentIntakeStatus's new CONFIRMED value
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test
```

If `prisma migrate dev` reports schema drift because you've been running
against the hand-written SQL already, use `migrate deploy` instead:

```powershell
npx prisma migrate deploy
npx prisma generate
```

**Verify the two hand-added partial unique indexes actually exist** — these
are not something `prisma migrate dev`/`generate` can create from
`schema.prisma` alone (see `docs/milestones/PROGRESS.md`'s Milestone 2B
section for why), so it's worth a quick direct check after migrating:

```sql
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'ProductAlias';
```

You should see `ProductAlias_global_normalizedText_key` (with `WHERE
("customerId" IS NULL)`) and `ProductAlias_customer_normalizedText_key`
(with `WHERE ("customerId" IS NOT NULL)`) in the output, alongside the
ordinary plain indexes.

### Run this milestone's real database acceptance test

Unlike Milestone 2A's acceptance test, this milestone's core deliverable
*is* database rows (`ExtractedOrderLine`, `ProductAlias`, `CustomerAlias`,
the created `CustomerOrder`), so its one true acceptance test needs a
real database and cannot run unconditionally in the sandbox. Run it here,
once, after seeding:

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

(Or, in one line: `$env:RUN_DB_INTEGRATION_TESTS="1"; npm test`.) This
also runs the pre-existing `tests/orders-db.integration.test.ts`. Both
clean up their own rows afterward (all `isDemo: true`).

### Manual test script (no coding required)

1. Start the app, open **PO Intake**, and open (or create, per section
   12's steps 2–4) a document that's already reached status
   **Extracted**.
2. Click **Review & confirm**. Confirm the workspace loads: the
   extracted customer name/store, a resolved customer match (or a
   prompt to search for one if nothing matched confidently), and one row
   per extracted line with its matched product (or a prompt to search
   for one).
3. **Accept a well-matched order**: leave every line's product match as
   suggested, fill in or confirm the order date/requested delivery date,
   and click **Confirm order**. Confirm you land on a success state
   linking to the new order, and that opening that order (**Orders** in
   the sidebar) shows the correct customer, lines, quantities, and
   products.
4. **Confirm with a manual override**: open a different extracted
   document whose description doesn't closely match anything in your
   catalogue (or use a deliberately odd pasted-text line, e.g. "usual
   veggie box" with no code). Confirm the line shows no confident match;
   search for and select a real product manually, fill in quantity/unit,
   and confirm. Then re-submit a near-identical pasted-text document with
   the *same* odd wording — confirm the line now matches your manually
   chosen product automatically (labelled **Learned alias**, 100%
   confidence) without you picking it again. This is the alias-learning
   loop working end to end.
5. **Trigger and acknowledge a duplicate warning**: confirm an order with
   a customer PO reference, e.g. `"PO-1001"`. Then open a *different*
   document for the *same customer* with the *same* `"PO-1001"` PO
   reference in its header and try to confirm it. Confirm a duplicate
   warning appears, the **Confirm order** button is disabled or the
   confirm request is rejected until you tick the acknowledge checkbox,
   and after ticking it and confirming again, a second order is created
   (intentionally — the human explicitly said this isn't actually a
   duplicate).
6. **Exclude a line**: on any document with more than one line, mark one
   line **Exclude** with a short reason, leave the rest **Accept**, and
   confirm. Confirm the resulting order has only the accepted line(s),
   and that re-opening the document's review workspace shows the
   excluded line's status as excluded (not pending, not accepted).
7. **Re-confirm guard**: try to open a document that's already confirmed
   and confirm it again (e.g. by calling the confirm endpoint a second
   time, or revisiting an already-confirmed review page and re-submitting
   if the UI allows it). Confirm this is rejected rather than creating a
   second order for the same document.

### 13a. Undoing this migration

**This is destructive** — it drops the three new tables and the two new
enum types, along with any rows already stored in them. Back up first:

```powershell
pg_dump -Fc -d <your-database-name> -f backup-before-undo-milestone-2b.dump
```

```sql
ALTER TABLE "ExtractedOrderLine" DROP CONSTRAINT "ExtractedOrderLine_extractionRunId_fkey";
ALTER TABLE "ExtractedOrderLine" DROP CONSTRAINT "ExtractedOrderLine_matchedProductId_fkey";
ALTER TABLE "ExtractedOrderLine" DROP CONSTRAINT "ExtractedOrderLine_reviewedById_fkey";
ALTER TABLE "ExtractedOrderLine" DROP CONSTRAINT "ExtractedOrderLine_resultingOrderLineId_fkey";
ALTER TABLE "ProductAlias" DROP CONSTRAINT "ProductAlias_customerId_fkey";
ALTER TABLE "ProductAlias" DROP CONSTRAINT "ProductAlias_productId_fkey";
ALTER TABLE "ProductAlias" DROP CONSTRAINT "ProductAlias_createdById_fkey";
ALTER TABLE "CustomerAlias" DROP CONSTRAINT "CustomerAlias_customerId_fkey";
ALTER TABLE "CustomerAlias" DROP CONSTRAINT "CustomerAlias_createdById_fkey";

DROP TABLE "ExtractedOrderLine";
DROP TABLE "ProductAlias";
DROP TABLE "CustomerAlias";

DROP TYPE "ExtractedLineMatchSource";
DROP TYPE "ExtractedLineStatus";
```

**`DocumentIntakeStatus`'s new `CONFIRMED` value cannot be cleanly
dropped** — Postgres has no `ALTER TYPE ... DROP VALUE`. As with
Milestone 2A's `OrderSource` additions, the only way to fully remove it is
to recreate the enum type and convert every column that uses it
(`OrderDocument.status`) — invasive for a value that costs nothing to
leave unused, so leaving it in place is the recommended path for any
partial rollback.

Apply the reversible part the same way as previous rollbacks (`psql`, a
GUI client, or `npx prisma db execute --file
.\rollback-milestone-2b.sql --schema prisma/schema.prisma`), then revert
`prisma/schema.prisma` to remove the same changes and run `npx prisma
generate` again. Also tell Prisma's migration history about the rollback:

```powershell
npx prisma migrate resolve --rolled-back 20261109140000_add_matching_review_aliases
```

## 14. Milestone 2C: SAP handover, multi-store splitting, repeat orders

This migration is purely additive — one new enum, one new table, no
column dropped, no existing column's type or nullability changed. As
with every previous milestone's migration, it cannot be validated or
generated in the build sandbox — run these for real on your machine.

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_order_handover

# 2. Regenerate the Prisma client so it knows about the new
#    OrderHandover model and the HandoverFormat enum
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test
```

If `prisma migrate dev` reports schema drift because you've been running
against the hand-written SQL already, use `migrate deploy` instead:

```powershell
npx prisma migrate deploy
npx prisma generate
```

### Run this milestone's real database acceptance tests

Like Milestone 2B's, this milestone's core deliverables are real
files/database rows (a readable `.xlsx`, real split `CustomerOrder`
rows) that a no-DB test cannot prove. Run them here, once, after seeding:

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

(Or, in one line: `$env:RUN_DB_INTEGRATION_TESTS="1"; npm test`.) This
runs the new `tests/handover-db.integration.test.ts`, the new split-order
test appended to `tests/matching-review-db.integration.test.ts`, and
every pre-existing gated integration test. All clean up their own rows
and stored files afterward (everything created `isDemo: true`).

### Manual test script (no coding required)

1. **Generate a handover in each format**: open an existing confirmed
   order (**Orders** in the sidebar → any order with at least one line).
   In the new **SAP Handover** panel, click **Generate Excel**. Confirm a
   new row appears under **Past handovers** and downloading it opens a
   real, readable spreadsheet with your order's lines, SAP item codes,
   and official descriptions. Click **Generate CSV** — confirm a second,
   separate row appears (the Excel one is still there, unchanged) and the
   downloaded `.csv` opens cleanly in Excel with the same line content.
   Click **Copy to clipboard** — confirm a "Copied" message appears, then
   paste into a blank spreadsheet or text editor and confirm you get
   tab-separated columns (SAP code, description, quantity, unit, note)
   with no header row.
2. **Unmatched-line flagging**: generate a handover for an order that has
   at least one line with no resolved product (or temporarily remove a
   product's catalogue entry a line points at). Confirm that line still
   appears in every format — never silently dropped — with an empty SAP
   item code and a note explaining it needs manual attention in SAP.
3. **`handedToSapAt` is set once**: before generating anything, check the
   order's details don't show a "handed to SAP" time. Generate one
   handover, then generate a second, different-format handover for the
   same order. Confirm (via the database or an admin view, if available)
   that `handedToSapAt` was set by the first generation and did **not**
   change on the second.
4. **Split one document into several orders**: open **PO Intake**, open a
   document at status **Extracted** whose pasted text/lines actually name
   two different customers (or just pick any document with 2+ lines for
   a dry run), and click **Review & confirm**. On one line, click
   **Assign to a different store**, search for and select a different
   customer than the document's own resolved one, and confirm the chip
   "Different store: `<name>`" appears. Leave the other line(s)
   unassigned (using the document's own resolved customer) and click
   **Confirm order**. Confirm the success banner lists **two** separate
   orders, each linking to a real order page, each showing only its own
   line(s) and its own customer.
5. **Repeat an order**: open any existing order and click **Repeat this
   order**. Confirm you land on **Receive New Order** with a green
   "Pre-filled from order `<reference>`" banner, the same customer
   already selected, the same delivery address, and one line per original
   line (product, quantity, unit all pre-filled) — and that
   `customerPoReference`/dates/internal notes are blank, ready for you to
   re-enter. Adjust something if you like, then submit, and confirm a
   genuinely new order is created (the original is untouched).

### 14a. Undoing this migration

**This is destructive** — it drops the new table and enum type, along
with any rows already stored in it. Back up first:

```powershell
pg_dump -Fc -d <your-database-name> -f backup-before-undo-milestone-2c.dump
```

```sql
ALTER TABLE "OrderHandover" DROP CONSTRAINT "OrderHandover_orderId_fkey";
ALTER TABLE "OrderHandover" DROP CONSTRAINT "OrderHandover_generatedById_fkey";

DROP TABLE "OrderHandover";

DROP TYPE "HandoverFormat";
```

This does **not** delete the Excel/CSV files this milestone's handovers
stored on disk (under the local storage driver's upload directory, same
as every document upload) — remove those separately if you want them
gone too; they're otherwise harmless orphans referencing rows that no
longer exist.

Apply the reversible part the same way as previous rollbacks (`psql`, a
GUI client, or `npx prisma db execute --file
.\rollback-milestone-2c.sql --schema prisma/schema.prisma`), then revert
`prisma/schema.prisma` to remove the same changes and run `npx prisma
generate` again. Also tell Prisma's migration history about the rollback:

```powershell
npx prisma migrate resolve --rolled-back 20261109150000_add_order_handover
```

## 15. Milestone 3A: warehouse picking (SAP Invoice Handover Specification, stage 1 of 4)

This is the first of four stages (3A–3D) implementing the SAP Invoice
Handover Specification you provided. 3A is schema + core workflow only —
no UI yet (that's 3B), and the handover itself is not reworked yet
(that's 3C). This migration is purely additive: two new `OrderStatus`
enum values appended, one new enum, two new tables, two new nullable
columns on `OrderHandover`. No existing column's type or nullability
changes, no existing table is dropped or renamed. As with every previous
milestone's migration, it cannot be validated or generated in the build
sandbox — run these for real on your machine.

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_picking_sessions

# 2. Regenerate the Prisma client so it knows about the new
#    PickingSession/PickingLine models, PickingSessionStatus enum, the
#    two new OrderStatus values (PICKING, READY_TO_INVOICE), and
#    OrderHandover's new pickingSessionId/reference columns
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test
```

If `prisma migrate dev` reports schema drift because you've been running
against the hand-written SQL already, use `migrate deploy` instead:

```powershell
npx prisma migrate deploy
npx prisma generate
```

### Run this milestone's real database acceptance tests

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

This runs the new `tests/picking-db.integration.test.ts` (start → record
→ complete → authorize, every refusal path, and the re-pick-after-
authorization case) alongside every pre-existing gated integration test.
Everything it creates is marked `isDemo: true` and cleaned up afterward.

### Manual test script (no UI yet — via curl or any HTTP client)

There's no `/fulfilment` page in this stage, so exercise the new API
directly. Replace `<ORDER_ID>` with a real order id (e.g. from
`npm run db:seed`'s demo data) and `<SESSION_COOKIE>` with a logged-in
session cookie value copied from your browser's dev tools after signing
in at `/login`.

```powershell
# Start picking
curl -X POST http://localhost:3000/api/orders/<ORDER_ID>/picking `
  -H "Cookie: salesflow_session=<SESSION_COOKIE>" `
  -H "Origin: http://localhost:3000"
# -> 201, { success: true, session: { id, status: "IN_PROGRESS", lines: [...] } }
# Copy the session id and each line's orderLineId from the response.

# Record a found/unavailable split for one line
curl -X PATCH http://localhost:3000/api/orders/<ORDER_ID>/picking/<SESSION_ID>/lines/<ORDER_LINE_ID> `
  -H "Content-Type: application/json" `
  -H "Cookie: salesflow_session=<SESSION_COOKIE>" `
  -H "Origin: http://localhost:3000" `
  -d '{"foundQuantity": "10.0000", "unavailableQuantity": "5.0000", "notes": "5 damaged in transit"}'

# Once every line has a found/unavailable split that sums to its requested quantity, complete:
curl -X POST http://localhost:3000/api/orders/<ORDER_ID>/picking/<SESSION_ID>/complete `
  -H "Cookie: salesflow_session=<SESSION_COOKIE>" `
  -H "Origin: http://localhost:3000"

# Authorize (must be signed in as a SALES_MANAGER or ADMINISTRATOR -- a
# SALESPERSON session gets a 403 here):
curl -X POST http://localhost:3000/api/orders/<ORDER_ID>/picking/<SESSION_ID>/authorize `
  -H "Cookie: salesflow_session=<SESSION_COOKIE>" `
  -H "Origin: http://localhost:3000"

# Confirm the order moved to READY_TO_INVOICE
curl http://localhost:3000/api/orders/<ORDER_ID> `
  -H "Cookie: salesflow_session=<SESSION_COOKIE>"
```

Also confirm in the existing **Orders** list/detail pages (no code change
needed to see this): an order you've started picking for now shows a
**Picking** badge, and one you've authorized shows **Ready to Invoice** —
both are new filter tabs on the order list too.

### 15a. Undoing this migration

**This is destructive** — it drops the new tables, removes the two new
`OrderHandover` columns, and (for the enum) requires recreating
`OrderStatus` without the two new values, which **fails if any row is
currently using them** (so cancel/complete past any `PICKING`/
`READY_TO_INVOICE` orders first, or accept losing that distinction).
Back up first:

```powershell
pg_dump -Fc -d <your-database-name> -f backup-before-undo-milestone-3a.dump
```

```sql
ALTER TABLE "OrderHandover" DROP CONSTRAINT "OrderHandover_pickingSessionId_fkey";
ALTER TABLE "PickingLine" DROP CONSTRAINT "PickingLine_pickingSessionId_fkey";
ALTER TABLE "PickingLine" DROP CONSTRAINT "PickingLine_orderLineId_fkey";
ALTER TABLE "PickingLine" DROP CONSTRAINT "PickingLine_pickedById_fkey";
ALTER TABLE "PickingSession" DROP CONSTRAINT "PickingSession_orderId_fkey";
ALTER TABLE "PickingSession" DROP CONSTRAINT "PickingSession_startedById_fkey";
ALTER TABLE "PickingSession" DROP CONSTRAINT "PickingSession_completedById_fkey";
ALTER TABLE "PickingSession" DROP CONSTRAINT "PickingSession_authorizedById_fkey";

DROP TABLE "PickingLine";
DROP TABLE "PickingSession";
DROP TYPE "PickingSessionStatus";

ALTER TABLE "OrderHandover" DROP COLUMN "pickingSessionId";
ALTER TABLE "OrderHandover" DROP COLUMN "reference";

-- Only if nothing uses these two values (see warning above) --
-- Postgres has no simple "remove enum value"; recreating the type is the
-- standard approach:
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'RECEIVED', 'PENDING_VERIFICATION', 'READY_FOR_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED');
ALTER TABLE "CustomerOrder" ALTER COLUMN "status" TYPE "OrderStatus" USING ("status"::text::"OrderStatus");
DROP TYPE "OrderStatus_old";
```

Apply the reversible part the same way as previous rollbacks (`psql`, a
GUI client, or `npx prisma db execute --file
.\rollback-milestone-3a.sql --schema prisma/schema.prisma`), then revert
`prisma/schema.prisma` to remove the same changes and run `npx prisma
generate` again. Also tell Prisma's migration history about the rollback:

```powershell
npx prisma migrate resolve --rolled-back 20261110060000_add_picking_sessions
```

## 16. Milestone 3B: picking UI (SAP Invoice Handover Specification, stage 2 of 4)

No migration this round — 3B builds the `/fulfilment` UI on top of 3A's
schema and API, unchanged. Just confirm the app builds and runs:

```powershell
npx tsc --noEmit
npm run lint
npm test
npm run dev
```

### Manual test script (now via the real UI)

Replace `<ORDER_ID>` below with a real order's id if you want to jump
straight to its workstation; otherwise just click through from the
queue.

1. Sign in at `/login`, then open **Picking & Fulfilment** in the
   sidebar (`/fulfilment`). You should see every live order that hasn't
   yet been handed to SAP, each with a **Not started** / **Picking in
   progress** / **Ready to invoice** badge.
2. Click an order with **Not started** to open its workstation
   (`/fulfilment/<ORDER_ID>`). Click **Start picking**.
3. For each line, enter a found quantity and an unavailable quantity
   (they must sum to the requested quantity) and click **Save** on that
   row. Try an invalid split first (e.g. leave unavailable blank, or make
   the two not sum to the requested quantity) to confirm the inline error
   message appears and nothing is saved.
4. Once every line is saved and accounted for, click **Complete
   picking**. If you leave a line short on purpose, confirm the error
   message names the specific line number(s) still incomplete.
5. While signed in as a `SALESPERSON`, confirm you see the "only a sales
   manager or administrator can authorize" note instead of an Authorize
   button. Sign in as a `SALES_MANAGER` or `ADMINISTRATOR` and confirm
   the **Authorize** button appears and works.
6. After authorizing, confirm the order now shows **Ready to invoice**
   back on the `/fulfilment` queue, and a **Ready to Invoice** badge on
   the regular **Orders** list/detail pages too (no code change needed —
   this already worked from 3A).
7. Click **Start a new picking session** on an already-authorized order
   to confirm the re-pick/correction path works, and that the previous
   session isn't lost (there's no UI to inspect picking history directly
   yet, but confirming the new session starts cleanly and the order
   briefly shows **Picking in progress** again is enough for this round).

## 17. Milestone 3C: Invoice Handover rework (SAP Invoice Handover Specification, stage 3 of 4)

One small, additive migration this round -- a uniqueness guarantee on
the new Handover Reference field. Apply it the same way as every
previous one:

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_handover_reference_unique

# 2. Regenerate the Prisma client
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test
```

If `prisma migrate dev` reports schema drift, use `migrate deploy`
instead (same as every previous round):

```powershell
npx prisma migrate deploy
npx prisma generate
```

### Run this milestone's real database acceptance tests

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

This runs the reworked `tests/handover-db.integration.test.ts` -- it now
drives a real picking lifecycle (start → record → complete → authorize)
before generating each test handover, so it's exercising the actual
end-to-end 3A→3C pipeline, not just the handover layer in isolation.

### Manual test script (via the UI)

1. Open an order on `/orders/[id]` that hasn't been through picking yet
   (any status other than **Ready to Invoice**). Confirm the **SAP
   Invoice Handover** panel's three Generate buttons are all disabled,
   with the message explaining picking must be completed and authorized
   first.
2. Take that order through `/fulfilment/<ORDER_ID>`: start picking,
   record each line, complete, and authorize (see §16's script above).
3. Back on `/orders/[id]`, confirm the Generate buttons are now enabled.
   Click **Generate Excel** and open the downloaded file. Confirm:
   - The header block shows a **Handover Reference** (`HND-...`),
     **Picking Authorized By**, and **Picking Authorized At**, alongside
     the existing order/customer fields.
   - The product table has exactly 4 columns: SAP Item Code,
     Description, Quantity, Unit.
   - The **Quantity** column matches what was actually found in
     picking, not what was originally requested, for any line where the
     two differ.
   - A line that was recorded as 100% unavailable in picking does not
     appear in the table at all.
   - If any line has no SAP match (or a stale snapshot), a "Lines
     needing attention before processing" section appears below the
     main table naming it and why.
4. Click **Copy to clipboard** and confirm the success message no
   longer claims it's safe to paste directly into SAP -- it should read
   "Copied to your clipboard -- paste it wherever the invoice team needs
   it next."
5. Confirm the new handover's reference appears in the "past handovers"
   list underneath the Generate buttons.

## 18. Milestone 3D: tests, docs, verification (final stage) -- and what Milestone 3 ships with overall

No schema change this round, so nothing to migrate. Just run the full
suite, which now also covers the three previously-untested query
functions found during this round's audit:

```powershell
npx tsc --noEmit
npm run lint
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
npm run build
```

The two files worth checking specifically are new/changed this round:
`tests/picking-queries-db.integration.test.ts` (new) and
`tests/handover-db.integration.test.ts` (one test added). Both are
gated the same way as every other DB-integration test in this project
-- they only run with `RUN_DB_INTEGRATION_TESTS=1` set and a seeded
database.

### What Milestone 3 (SAP Invoice Handover Specification) ships with, end to end

Across 3A-3D: warehouse picking (`/fulfilment`, start → record →
complete → authorize, with authorization restricted to SALES_MANAGER/
ADMINISTRATOR) is now a hard prerequisite for generating an SAP Invoice
Handover, which itself now sources its quantities from what was actually
picked and authorized, not what the customer originally requested, with
a generated Handover Reference and full who/when traceability on the
document.

**One thing it deliberately does not ship with**: there is no way to
abandon or cancel an in-progress or completed-but-not-yet-authorized
picking session -- it can only be progressed forward. This was flagged
as an open question at the end of 3A and never answered across three
further rounds, so it was never built (per this project's "don't build
speculatively" rule) and is now formally recorded as a known limitation
rather than a bug. If you want it, it's a small, isolated addition --
just ask for it in a future round.

## 19. Milestone 3 completion: Warehouse Assembly Form & Partial Availability

No schema change this round, so nothing to migrate. Just run the full
suite, which now also covers the two new pure modules and the new
assembly-form data path:

```powershell
npx tsc --noEmit
npm run lint
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
npm run build
```

New/changed test files this round: `tests/picking-validation.test.ts`
(6 new tests), `tests/assembly-form-resolve-line.test.ts` (new, 4
tests), `tests/assembly-form-db.integration.test.ts` (new, 2 gated
tests), `tests/handover-db.integration.test.ts` (1 test added). All
DB-gated tests only run with `RUN_DB_INTEGRATION_TESTS=1` set and a
seeded database, same as every prior round.

### Manual test script (via the UI)

1. Open any confirmed order on `/orders/[id]` (any status other than
   Cancelled/Rejected) and confirm a **"Print Warehouse Assembly Form"**
   button appears near "Repeat this order."
2. Click it -- it opens `/orders/<ORDER_ID>/assembly-form` in a new tab.
   Confirm the page shows:
   - Willsgrove's name and address at the top, with "Warehouse Assembly
     Form" and "Not an invoice or SAP handover document" clearly
     labelled -- it should look nothing like the Excel handover.
   - Customer name, Customer PO Number, the order's own SalesFlow
     reference, and order date.
   - One table row per order line, with an SAP item code and official
     description where one resolves, and the customer's requested
     quantity and unit.
   - The **Qty Found** and **Qty Unavailable** columns are completely
     blank -- not pre-filled with anything, even if this order already
     has picking history.
   - Assembler Name / Date / Signature blanks and a Remarks box at the
     bottom.
3. Click **Print** (top right) and confirm, in the print preview, that
   the Print/Back buttons disappear from the page (`print:hidden`) and
   the layout fits cleanly on an A4 page.
4. Confirm printing/viewing this page did **not** start picking: go to
   `/fulfilment/<ORDER_ID>` immediately after and confirm it still shows
   "Start picking" (no session exists), not an in-progress one. Reload
   `/orders/[id]` and confirm its status badge hasn't changed either.
5. Now actually start picking on `/fulfilment/<ORDER_ID>` and record a
   **mixed** set of findings across at least three lines: one fully
   available (found = requested), one partially available (found some
   but not all), one completely unavailable (found = 0). Confirm the new
   **Availability** column shows "Fully Available" (green), "Partially
   Available" (amber), and "Unavailable" (red) respectively for those
   three lines, and "Not yet recorded" (gray) for any line you haven't
   saved a value for yet.
6. Complete and authorize picking, then generate an SAP Invoice Handover
   on `/orders/[id]` as in §17's script -- confirm the completely-
   unavailable line from step 5 does not appear anywhere in the
   generated Excel/CSV, and the partially-available line shows only the
   quantity actually found, not what was originally requested.

## 20. Milestone 4: Lost-Sales Management

This migration is purely additive: 5 new enums and 3 new tables only.
No existing table, column, or enum value is touched — every "new field"
you'll see on `Product`/`CustomerOrder`/`OrderLine`/`PickingSession`/
`PickingLine` in `prisma/schema.prisma` is a pure Prisma inverse-relation
side with no new column of its own. As with every previous milestone's
migration, it cannot be validated or generated in the build sandbox —
run these for real on your machine.

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_lost_sales_management

# 2. Regenerate the Prisma client so it knows about UnfulfilledDemand,
#    CustomerDecisionEvent, LostSaleRecord, and their 5 new enums
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test
```

If `prisma migrate dev` reports schema drift because you've been running
against the hand-written SQL already, use `migrate deploy` instead:

```powershell
npx prisma migrate deploy
npx prisma generate
```

### Run this milestone's real database acceptance tests

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

This runs the new `tests/lost-sales-db.integration.test.ts` (creation on
authorization, every decision type, substitution, outstanding-to-lost
conversion, original-PO immutability, audit history, reporting)
alongside every pre-existing gated integration test. Everything it
creates is marked `isDemo: true`; cleanup happens in `afterAll` in an
order that respects every new foreign key (`LostSaleRecord` →
`CustomerDecisionEvent` → `UnfulfilledDemand` → `PickingSession`, then
the pre-existing order/order-line cleanup). It needs an admin user, a
`DEMO-CUST-*` customer, and **at least two** active products already
seeded (one as the original demand's product, one as a substitute) — if
your seed data has fewer than two active products, add one or re-run
`npm run db:seed`.

### Manual test script (via the UI)

1. Pick (or create) an order with at least one line, then on
   `/fulfilment/<ORDER_ID>` start picking and record that line as
   **partially available** — e.g. requested 20, found 12, unavailable 8
   — then complete and authorize the session (SALES_MANAGER or
   ADMINISTRATOR).
2. Open **Lost Sales** in the sidebar (`/lost-sales`). Confirm the new
   record for that order/line appears with status **"Awaiting customer
   decision"**, unavailable quantity 8, and every other bucket at 0 —
   it should never show as lost or cancelled on its own.
3. Open the record (`/lost-sales/<id>`). Confirm the quantity-summary
   tiles match (requested 20 / found 12 / unavailable 8 / all others 0)
   and there's no decision history yet.
4. Record a decision: choose **"Partial cancellation"**, source
   **"Customer email"**, quantity `5.0000`, and submit. Confirm the page
   refreshes to show outstanding/cancelled quantities updated (cancelled
   = 5, undecided = 3) and the decision appears in the history list with
   its source clearly shown.
5. Record a second decision on the remaining 3: **"Await remaining
   quantity"**, source **"Customer phone call"**, quantity `3.0000`, with
   an expected follow-up date a week out. Confirm status becomes
   **"Waiting for remaining supply"** and the follow-up date appears.
6. If signed in as SALES_MANAGER or ADMINISTRATOR, confirm a lost sale
   on the cancelled 5: reason **"Product unavailable"**, quantity
   `5.0000`. Confirm it appears under "Confirmed Lost Sales" with either
   an estimated value (if the order line had an approved price or the
   customer has a price list entry) or an explicit "No estimated value
   available" message — never a guessed number. Confirm the status stays
   **"Waiting for remaining supply"** (the 3 still-outstanding units take
   priority over the now-partially-confirmed-lost cancelled bucket).
7. Sign in as a plain SALESPERSON and confirm the "Confirm lost sale"
   form does **not** appear on this page at all, and confirm a direct
   `POST` to `/api/lost-sales/<id>/confirm-lost` with that session's
   cookie returns `403`.
8. Back on `/lost-sales`, confirm the stat tiles (awaiting decision,
   total outstanding, total confirmed lost) reflect what you just did,
   and that filtering by status narrows the list correctly.

### 20a. Undoing this migration

**This is destructive** — it drops the 3 new tables and the 5 new enum
types. Unlike some earlier milestones, no existing enum was modified, so
there's no "recreate the enum type" step needed. Back up first:

```powershell
pg_dump -Fc -d <your-database-name> -f backup-before-undo-milestone-4.dump
```

```sql
ALTER TABLE "LostSaleRecord" DROP CONSTRAINT "LostSaleRecord_unfulfilledDemandId_fkey";
ALTER TABLE "LostSaleRecord" DROP CONSTRAINT "LostSaleRecord_confirmedById_fkey";
ALTER TABLE "CustomerDecisionEvent" DROP CONSTRAINT "CustomerDecisionEvent_unfulfilledDemandId_fkey";
ALTER TABLE "CustomerDecisionEvent" DROP CONSTRAINT "CustomerDecisionEvent_substituteProductId_fkey";
ALTER TABLE "CustomerDecisionEvent" DROP CONSTRAINT "CustomerDecisionEvent_recordedById_fkey";
ALTER TABLE "UnfulfilledDemand" DROP CONSTRAINT "UnfulfilledDemand_orderId_fkey";
ALTER TABLE "UnfulfilledDemand" DROP CONSTRAINT "UnfulfilledDemand_orderLineId_fkey";
ALTER TABLE "UnfulfilledDemand" DROP CONSTRAINT "UnfulfilledDemand_customerId_fkey";
ALTER TABLE "UnfulfilledDemand" DROP CONSTRAINT "UnfulfilledDemand_pickingSessionId_fkey";
ALTER TABLE "UnfulfilledDemand" DROP CONSTRAINT "UnfulfilledDemand_pickingLineId_fkey";
ALTER TABLE "UnfulfilledDemand" DROP CONSTRAINT "UnfulfilledDemand_productId_fkey";

DROP TABLE "LostSaleRecord";
DROP TABLE "CustomerDecisionEvent";
DROP TABLE "UnfulfilledDemand";

DROP TYPE "LostSaleValueSource";
DROP TYPE "LostSaleReason";
DROP TYPE "UnfulfilledDemandStatus";
DROP TYPE "DecisionSource";
DROP TYPE "CustomerDecisionType";
```

Apply the reversible part the same way as previous rollbacks (`psql`, a
GUI client, or `npx prisma db execute --file
.\rollback-milestone-4.sql --schema prisma/schema.prisma`), then revert
`prisma/schema.prisma` to remove the same changes and run `npx prisma
generate` again. Also tell Prisma's migration history about the rollback:

```powershell
npx prisma migrate resolve --rolled-back 20261110180000_add_lost_sales_management
```

## 21. Milestone 5: SAP Invoice Reconciliation

This migration is purely additive: 3 new enums and 3 new tables only. No
existing table, column, or enum value is touched — every "new field"
you'll see on `User`/`Customer`/`CustomerOrder`/`OrderLine` in
`prisma/schema.prisma` is a pure Prisma inverse-relation side with no new
column of its own. As with every previous milestone's migration, it
cannot be validated or generated in the build sandbox — run these for
real on your machine.

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_invoice_reconciliation

# 2. Regenerate the Prisma client so it knows about SapInvoiceImportBatch,
#    SapInvoice, SapInvoiceLine, and their 3 new enums
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test
```

If `prisma migrate dev` reports schema drift because you've been running
against the hand-written SQL already, use `migrate deploy` instead:

```powershell
npx prisma migrate deploy
npx prisma generate
```

### Run this milestone's real database acceptance tests

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

This runs the new `tests/invoice-reconciliation-db.integration.test.ts`
(CSV import, matching by exact SAP item code, the four quantity-
reconciliation worked examples, over-invoicing, ambiguous-match manual
resolution with full audit history, cancelled-invoice exclusion,
multi-currency, multi-order invoices, original-record immutability,
reports) alongside every pre-existing gated integration test. Everything
it creates is marked `isDemo: true`; cleanup happens in `afterAll` in an
order that respects every new foreign key (`SapInvoiceLine` →
`SapInvoice` → `SapInvoiceImportBatch`, then the pre-existing picking/
order/order-line cleanup). It needs an admin user and the `DEMO-CUST-001`
customer already seeded — if you're missing either, run `npm run
db:seed` first.

### Manual test script (via the UI)

1. Pick (or create) an order for **TM Supermarket Borrowdale (Demo)**
   (`DEMO-CUST-001`) with at least one line for a known SAP item code
   (e.g. item `8104` from `test-data/sap-items-list.csv`), then on
   `/fulfilment/<ORDER_ID>` start picking, record that line as fully
   available (requested 20, found 20), then complete and authorize the
   session (SALES_MANAGER or ADMINISTRATOR). Note the order's reference
   (e.g. `SF-00123`).
2. Save the following as `test-invoice.csv` (header-level columns
   repeated on every line, the shape a real SAP B1 "flattened document
   rows" export uses):

   ```csv
   DocEntry,DocNum,CardCode,CardName,DocDate,DocCur,DocStatus,NumAtCard,DocTotalBeforeDisc,VatSum,DocTotal,LineNum,ItemCode,Dscription,Quantity,UomCode,Price,DiscPrcnt,VatGroup,LineTotal
   50001,INV-90001,DEMO-CUST-001,TM Supermarket Borrowdale (Demo),2026-11-10,USD,Open,SF-00123,0,0,0,0,8104,Apples,12.0000,EA,0,0,0,0
   50002,INV-90002,DEMO-CUST-001,TM Supermarket Borrowdale (Demo),2026-11-11,USD,Open,SF-00123,0,0,0,0,8104,Apples,8.0000,EA,0,0,0,0
   ```

   This splits the 20 authorized units across two separate invoices (12
   then 8), so you can watch the order line move from "awaiting
   invoicing" to "partially invoiced" to "fully invoiced" one import at a
   time.
3. Open **Invoice Reconciliation** in the sidebar
   (`/invoice-reconciliation`), then **Import**. Upload `test-invoice.csv`
   and click "Read columns" — confirm the suggested mapping already
   matches every column correctly (the header names above are chosen to
   match the built-in suggestion patterns), then "Validate mapping".
4. Confirm the preview shows **1 new invoice** (only `INV-90001` is in
   the file at this point if you import it first with only that row —
   or, importing both at once, **2 new invoices**, 0 duplicates, 0
   invalid rows, 0 unmatched customer codes), then tick the confirmation
   checkbox and click "Confirm and import". Confirm the panel stays
   visible with an "Importing..." label while the request is in flight
   (this is the bug fixed this round — if it instead disappears
   entirely, something has regressed).
5. Open the resulting invoice(s) from the queue. Confirm `INV-90001`
   shows **Authorized 20.0000 / Invoiced 12.0000 / Remaining 8.0000**,
   order-line status **"Partially invoiced"**, match status **"Auto-
   matched"** — and, once `INV-90002` is also imported, confirm its
   detail page shows **Invoiced 20.0000 / Remaining 0.0000**, status
   **"Fully invoiced"** (cumulative across both invoices, matching the
   spec's own 20/12 then 20/8 worked examples).
6. Re-import the same `test-invoice.csv` a second time. Confirm the
   preview shows **0 new invoices, 2 duplicate invoices** and that
   "Confirm and import" either shows "Nothing to import" or, if
   submitted anyway, creates nothing new (check `/invoice-reconciliation`
   — invoice count is unchanged).
7. Create a second authorized order line for the **same** item code
   `8104` and the same customer, then import a third invoice for a
   partial quantity against it. Confirm it is **not** auto-matched (two
   qualifying order lines now exist for that item code) — it should sit
   `UNMATCHED` in the queue. Open it, use the **Match** action to choose
   the correct order line by hand with a written explanation, confirm
   it updates to "Manually matched," then use **Reopen** and confirm it
   returns to `UNMATCHED`. Finally use **Cannot link** with an
   explanation and confirm it resolves without ever auto-guessing.
8. If signed in as a plain SALESPERSON, confirm none of the Match/
   Cannot-link/Reopen/note controls appear on the detail page, and that
   a direct `POST` to `/api/invoice-reconciliation/lines/<id>/match`
   with that session's cookie returns `403`.
9. Open **Reports** (`/invoice-reconciliation/reports`) and confirm the
   stat tiles and the order-line/invoice tables reflect what you just
   did.

### 21a. Undoing this migration

**This is destructive** — it drops the 3 new tables and the 3 new enum
types. No existing enum was modified, so there's no "recreate the enum
type" step needed. Back up first:

```powershell
pg_dump -Fc -d <your-database-name> -f backup-before-undo-milestone-5.dump
```

```sql
ALTER TABLE "SapInvoiceLine" DROP CONSTRAINT "SapInvoiceLine_sapInvoiceId_fkey";
ALTER TABLE "SapInvoiceLine" DROP CONSTRAINT "SapInvoiceLine_matchedOrderId_fkey";
ALTER TABLE "SapInvoiceLine" DROP CONSTRAINT "SapInvoiceLine_matchedOrderLineId_fkey";
ALTER TABLE "SapInvoiceLine" DROP CONSTRAINT "SapInvoiceLine_matchedById_fkey";
ALTER TABLE "SapInvoice" DROP CONSTRAINT "SapInvoice_importBatchId_fkey";
ALTER TABLE "SapInvoice" DROP CONSTRAINT "SapInvoice_matchedCustomerId_fkey";
ALTER TABLE "SapInvoice" DROP CONSTRAINT "SapInvoice_matchedOrderId_fkey";
ALTER TABLE "SapInvoiceImportBatch" DROP CONSTRAINT "SapInvoiceImportBatch_uploadedById_fkey";

DROP TABLE "SapInvoiceLine";
DROP TABLE "SapInvoice";
DROP TABLE "SapInvoiceImportBatch";

DROP TYPE "InvoiceReconciliationStatus";
DROP TYPE "InvoiceLineMatchMethod";
DROP TYPE "InvoiceLineMatchStatus";
```

Apply the reversible part the same way as previous rollbacks (`psql`, a
GUI client, or `npx prisma db execute --file
.\rollback-milestone-5.sql --schema prisma/schema.prisma`), then revert
`prisma/schema.prisma` to remove the same changes and run `npx prisma
generate` again. Also tell Prisma's migration history about the
rollback:

```powershell
npx prisma migrate resolve --rolled-back 20261110190000_add_invoice_reconciliation
```

## 22. Milestone 6A: Invoice Claims Management

This migration is purely additive: 5 new enums and 4 new tables only.
No existing table, column, or enum value is touched — every "new
field" you'll see on `SapInvoice`/`SapInvoiceLine`/`CustomerOrder`/
`Customer`/`User` in `prisma/schema.prisma` is a pure Prisma
inverse-relation side with no new column of its own. As with every
previous milestone's migration, it cannot be validated or generated in
the build sandbox — run these for real on your machine.

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_invoice_claims_management

# 2. Regenerate the Prisma client so it knows about InvoiceClaim,
#    InvoiceClaimLine, ClaimResolution, InvoiceClaimAttachment, and
#    their 5 new enums
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test
```

If `prisma migrate dev` reports schema drift because you've been
running against the hand-written SQL already, use `migrate deploy`
instead:

```powershell
npx prisma migrate deploy
npx prisma generate
```

### Run this milestone's real database acceptance tests

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

This runs the new `tests/invoice-claims-db.integration.test.ts` (claim
creation with a quantity dispute, live-aggregate rejection of a second
claim once a line's remaining quantity is exhausted, an amount-only
dispute, the full resolution lifecycle — record → reject → record →
approve — with append-only history asserted, direct transition-graph
enforcement, and a financial summary confirming the actual-SAP-
credited figure stays unavailable) alongside every pre-existing gated
integration test. Everything it creates is marked `isDemo: true`;
cleanup happens in `afterAll` in an order that respects every new
foreign key (`InvoiceClaimAttachment` → `ClaimResolution` →
`InvoiceClaimLine` → `InvoiceClaim`, then the pre-existing SAP-invoice/
order/picking cleanup). The fixture builds its own
`SapInvoiceImportBatch`/`SapInvoice`/`SapInvoiceLine` rows directly
(not through Milestone 5's CSV import pipeline), so it needs only an
admin user and the `DEMO-CUST-001` customer already seeded — if you're
missing either, run `npm run db:seed` first.

### Manual test script (via the UI)

1. Open an existing reconciled or partially-reconciled SAP invoice from
   `/invoice-reconciliation` for **TM Supermarket Borrowdale (Demo)**
   (`DEMO-CUST-001`) — or import one via `/invoice-reconciliation/import`
   per §21's manual test script first if you don't have one yet. Note
   its invoice number (e.g. `INV-90001`) and the item/quantity on at
   least one of its lines (e.g. item `8104`, 12.0000 units invoiced).
2. Open **Invoice Claims** in the sidebar (`/invoice-claims`), then
   **File a claim**. Search for and select the invoice from step 1,
   select one of its lines, choose dispute type **Quantity**, enter an
   accepted quantity and a rejected quantity that together do not
   exceed what was invoiced (e.g. accepted `9`, rejected `3` against 12
   invoiced), pick category **Quantity Discrepancy**, priority
   **Medium**, today's date, and a description, then submit. Confirm
   you land on the new claim's detail page with status **Open** and a
   generated reference (`CLM-YYYYMMDD-XXXXXXXX`).
3. On the claim detail page, use the actions panel to change status to
   **Under Investigation**, then record a resolution: decision
   **Partial Credit Recommended**, with an approved-credit-amount
   placeholder notes field. Confirm the claim moves to **Awaiting
   Internal Action** and the resolution appears in the (append-only)
   history as pending.
4. While signed in as a plain SALESPERSON, confirm the **Approve** /
   **Reject** buttons on that resolution either do not appear or, if
   you call the API directly
   (`POST /api/invoice-claims/<id>/resolutions/<resolutionId>/approve`)
   with that session's cookie, return `403`.
5. Sign in as a SALES_MANAGER or ADMINISTRATOR and **Approve** the
   resolution with an approved credit amount (e.g. equal to the
   rejected quantity × the invoice line's unit price). Confirm the
   claim's status advances to **Approved**, the resolution now shows
   an approver and an approved amount, and the financial-exposure
   section shows a non-zero **Approved credit exposure** while
   **Actual SAP-credited amount** is explicitly labeled
   unavailable/not yet recorded (this is correct — Milestone 6B is
   where that figure will ever be populated).
6. Try to file a second claim against the *same* invoice line for a
   quantity that, combined with the first claim's accepted+rejected
   total, would exceed what was invoiced (e.g. 12 invoiced, first claim
   already used 9+3=12, so any further accepted/rejected quantity on
   this line should be refused). Confirm the form/API rejects it with a
   clear message rather than silently allowing it.
7. File an amount-only dispute on a different line of the same or
   another invoice (dispute type **Amount only**, a disputed amount at
   or below that line's total), and confirm it is accepted and appears
   correctly as **Amount only** on the disputed-lines table, with no
   accepted/rejected quantity shown for that line.
8. Upload a small file (e.g. a PDF or image) as an attachment on the
   claim via the actions panel, confirm it appears in the attachments
   list, and confirm clicking it downloads the original file correctly
   (check the filename and that the content opens).
9. Open **Dashboard** (`/invoice-claims/dashboard`) and confirm the
   status/category/customer breakdowns, the exposure-by-currency table,
   and average resolution time reflect what you just did. Click through
   a customer's drill-down link and confirm it lands back on
   `/invoice-claims` filtered to that customer.

### 22a. Undoing this migration

**This is destructive** — it drops the 4 new tables and the 5 new
enum types. No existing enum was modified, so there's no "recreate the
enum type" step needed. Back up first:

```powershell
pg_dump -Fc -d <your-database-name> -f backup-before-undo-milestone-6a.dump
```

```sql
ALTER TABLE "InvoiceClaimAttachment" DROP CONSTRAINT "InvoiceClaimAttachment_claimId_fkey";
ALTER TABLE "InvoiceClaimAttachment" DROP CONSTRAINT "InvoiceClaimAttachment_claimLineId_fkey";
ALTER TABLE "InvoiceClaimAttachment" DROP CONSTRAINT "InvoiceClaimAttachment_uploadedById_fkey";
ALTER TABLE "ClaimResolution" DROP CONSTRAINT "ClaimResolution_claimId_fkey";
ALTER TABLE "ClaimResolution" DROP CONSTRAINT "ClaimResolution_recordedById_fkey";
ALTER TABLE "ClaimResolution" DROP CONSTRAINT "ClaimResolution_approvedById_fkey";
ALTER TABLE "ClaimResolution" DROP CONSTRAINT "ClaimResolution_rejectedById_fkey";
ALTER TABLE "InvoiceClaimLine" DROP CONSTRAINT "InvoiceClaimLine_claimId_fkey";
ALTER TABLE "InvoiceClaimLine" DROP CONSTRAINT "InvoiceClaimLine_sapInvoiceLineId_fkey";
ALTER TABLE "InvoiceClaim" DROP CONSTRAINT "InvoiceClaim_sapInvoiceId_fkey";
ALTER TABLE "InvoiceClaim" DROP CONSTRAINT "InvoiceClaim_orderId_fkey";
ALTER TABLE "InvoiceClaim" DROP CONSTRAINT "InvoiceClaim_customerId_fkey";
ALTER TABLE "InvoiceClaim" DROP CONSTRAINT "InvoiceClaim_reportedById_fkey";
ALTER TABLE "InvoiceClaim" DROP CONSTRAINT "InvoiceClaim_assignedToId_fkey";

DROP TABLE "InvoiceClaimAttachment";
DROP TABLE "ClaimResolution";
DROP TABLE "InvoiceClaimLine";
DROP TABLE "InvoiceClaim";

DROP TYPE "ClaimResolutionDecision";
DROP TYPE "ClaimLineDisputeType";
DROP TYPE "InvoiceClaimStatus";
DROP TYPE "InvoiceClaimPriority";
DROP TYPE "InvoiceClaimCategory";
```

Apply the reversible part the same way as previous rollbacks (`psql`,
a GUI client, or `npx prisma db execute --file
.\rollback-milestone-6a.sql --schema prisma/schema.prisma`), then
revert `prisma/schema.prisma` to remove the same changes and run `npx
prisma generate` again. Also tell Prisma's migration history about the
rollback:

```powershell
npx prisma migrate resolve --rolled-back 20261111000000_add_invoice_claims_management
```

## 23. Milestone 6B: Returns & Credit Notes

This migration is purely additive: 2 new enums and 3 new tables only
(`ClaimReturn`, `CreditNote`, `CreditNoteImportBatch`). No existing
table, column, or enum value is touched — `InvoiceLineMatchMethod`
(Milestone 5) is reused as-is for `CreditNote.matchMethod`. As with
every previous milestone's migration, it cannot be validated or
generated in the build sandbox — run these for real on your machine.

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_returns_credit_notes

# 2. Regenerate the Prisma client so it knows about ClaimReturn,
#    CreditNote, CreditNoteImportBatch, and their 2 new enums
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test
```

If `prisma migrate dev` reports schema drift because you've been
running against the hand-written SQL already, use `migrate deploy`
instead:

```powershell
npx prisma migrate deploy
npx prisma generate
```

### Run this milestone's real database acceptance tests

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

This runs the new `tests/returns-credits-db.integration.test.ts`
alongside every pre-existing gated integration test. It drives claims
to `APPROVED` through the real Milestone 6A lifecycle
(`createInvoiceClaim` → `recordClaimResolution` →
`approveClaimResolution`, never by writing `InvoiceClaim.status` by
hand) and then covers: a physical return auto-resolving a
`PHYSICAL_RETURN_REQUIRED` claim; a manually-recorded credit note
auto-resolving a `FULL_CREDIT_RECOMMENDED` claim, with the financial
summary's `actualSapCreditedAmount`/`actualCreditShortfall`/
`actualExceedsApproved` all checked against the real recorded amount;
a `PARTIAL_CREDIT_RECOMMENDED` claim confirmed to move to
`PARTIALLY_RESOLVED` and never silently escalate to `RESOLVED` even
once the full approved amount has been credited; a
`PRICING_CORRECTION_REQUIRED` claim credited for MORE than was
approved, confirming the excess is flagged, never clamped; the full
CSV import pipeline (`applyCreditNoteColumnMapping` →
`groupIntoCreditNotes` → `planCreditNoteImport` →
`executeCreditNoteImport`) auto-matching a credit note to its one
outstanding candidate claim by resolved base invoice, and separately
confirming it lands `UNMATCHED` (never a guess) when two claims
against the same invoice both qualify; a full manual-reconciliation
cycle (match → cannot-link → reopen-rejected-when-already-unmatched →
reopen → re-match); and both `recordClaimReturn`/
`recordCreditNoteManually` refusing to act on a claim with no approved
resolution yet. Everything it creates is marked `isDemo: true` where
the model supports it; cleanup happens in `afterAll` in an order that
respects every new foreign key (`ClaimReturn`/`CreditNote`/
`CreditNoteImportBatch` first, since they reference `InvoiceClaim`,
then the pre-existing Milestone 6A/5 cleanup). The fixture builds its
own `SapInvoiceImportBatch`/`SapInvoice`/`SapInvoiceLine` rows
directly (not through Milestone 5's CSV import pipeline, and always
setting `sapDocEntry`, unlike Milestone 6A's own fixture, since this
milestone's CSV import resolves a credit note's base invoice by
DocEntry preferentially), so it needs only an admin user and the
`DEMO-CUST-001` customer already seeded.

**Honesty note**: this test file, like every gated DB-integration test
in this project, has not been run against a real database from inside
this sandbox — `@prisma/client` here is a stub that throws when
constructed (see PROGRESS.md's "Sandbox-only blocker"). It was written
to the same standard as `tests/invoice-claims-db.integration.test.ts`
and independently checked against the real source of every function/
field/signature it calls (`lib/returns-credits/*`,
`lib/invoice-claims/create-claim.ts`, `lib/invoice-claims/claim-
resolution.ts`, `prisma/schema.prisma`) — but treat it as unverified
until you actually run it.

### Manual test script (via the UI)

1. From an existing `APPROVED` or `PARTIALLY_RESOLVED` invoice claim
   (file one per Milestone 6A's §22 manual test script if you don't
   have one, and approve a resolution on it), open
   `/invoice-claims/<id>`. Confirm you now see **Physical returns** and
   **Credit notes** sections (empty at first) and a **Returns &
   credit notes** panel with a **Record physical return** button.
2. If the claim's approved resolution was **Physical Return Required**:
   record a return (condition **Damaged**, received quantity matching
   what was approved). Confirm the claim's status advances to
   **Resolved** automatically — you never set that status yourself.
3. If the approved resolution was a credit-bearing one (**Partial
   Credit Recommended** / **Full Credit Recommended** / **Pricing
   Correction Required**): while signed in as a plain SALESPERSON,
   confirm the **Record credit note** button does not appear (or, if
   you call the API directly, `POST /api/invoice-claims/<id>/credit-
   notes` returns `403`). Sign in as a SALES_MANAGER or ADMINISTRATOR
   and record a credit note for an amount matching the approved credit
   amount. Confirm the claim auto-advances to **Partially Resolved**
   (if the decision was Partial Credit) or **Resolved** (Full Credit/
   Pricing Correction), and the claim's **Financial exposure** section
   now shows a real, non-zero **Actual SAP credited** figure and a
   **Credit shortfall** of `0.0000`.
4. Open **Returns & Credits** in the sidebar (`/returns-credits`).
   Confirm the credit note you just recorded appears, already
   **Manually matched** to the claim from step 3.
5. Go to `/returns-credits/import`, upload a small CSV with headers
   `DocEntry,DocNum,BaseDocEntry,Amount` and one data row referencing
   the `DocEntry` of a real imported SAP invoice (from
   `/invoice-reconciliation`) that has exactly one outstanding
   credit-bearing claim against it. Map the columns, validate, and
   confirm the preview shows 1 new credit note with its base invoice
   **Resolved**. Confirm and import; confirm the result shows
   **Auto-matched to a claim: 1**.
6. Repeat step 5 against a base invoice that has **two** outstanding
   credit-bearing claims. Confirm the import succeeds but the credit
   note lands **Unmatched** (visible in the `/returns-credits` queue
   filtered to **Unmatched**) rather than being guessed.
7. Open that unmatched credit note's detail page
   (`/returns-credits/<id>`). As a SALES_MANAGER/ADMINISTRATOR, use
   **Match to claim** to pick one of the two candidate claims by hand,
   with a note explaining why. Confirm it becomes **Manually matched**
   and the chosen claim's status reflects the newly-recorded amount.
   Then use **Reopen (unlink)** and confirm it goes back to
   **Unmatched**.
8. Try to record a return or a credit note against a claim that is
   still **Open** or **Under Investigation** (no approved resolution
   yet). Confirm the UI/API refuses with a clear message rather than
   silently allowing it.

### 23a. Undoing this migration

**This is destructive** — it drops the 3 new tables and the 2 new
enum types. No existing enum was modified, so there's no "recreate the
enum type" step needed. Back up first:

```powershell
pg_dump -Fc -d <your-database-name> -f backup-before-undo-milestone-6b.dump
```

```sql
ALTER TABLE "ClaimReturn" DROP CONSTRAINT "ClaimReturn_claimId_fkey";
ALTER TABLE "ClaimReturn" DROP CONSTRAINT "ClaimReturn_claimLineId_fkey";
ALTER TABLE "ClaimReturn" DROP CONSTRAINT "ClaimReturn_creditNoteId_fkey";
ALTER TABLE "ClaimReturn" DROP CONSTRAINT "ClaimReturn_receivedById_fkey";
ALTER TABLE "CreditNote" DROP CONSTRAINT "CreditNote_importBatchId_fkey";
ALTER TABLE "CreditNote" DROP CONSTRAINT "CreditNote_sapInvoiceId_fkey";
ALTER TABLE "CreditNote" DROP CONSTRAINT "CreditNote_claimId_fkey";
ALTER TABLE "CreditNote" DROP CONSTRAINT "CreditNote_recordedById_fkey";
ALTER TABLE "CreditNote" DROP CONSTRAINT "CreditNote_matchedById_fkey";
ALTER TABLE "CreditNoteImportBatch" DROP CONSTRAINT "CreditNoteImportBatch_uploadedById_fkey";

DROP TABLE "ClaimReturn";
DROP TABLE "CreditNote";
DROP TABLE "CreditNoteImportBatch";

DROP TYPE "CreditNoteMatchStatus";
DROP TYPE "ReturnCondition";
```

Apply the reversible part the same way as previous rollbacks (`psql`,
a GUI client, or `npx prisma db execute --file
.\rollback-milestone-6b.sql --schema prisma/schema.prisma`), then
revert `prisma/schema.prisma` to remove the same changes and run `npx
prisma generate` again. Also tell Prisma's migration history about the
rollback:

```powershell
npx prisma migrate resolve --rolled-back 20261111120000_add_returns_credit_notes
```

## 24. Milestone 7: Quotations Management

This migration is purely additive: 2 new enums (`QuotationStatus`,
`QuotationEventType`), 3 new tables (`Quotation`, `QuotationLine`,
`QuotationEvent`), and one new value (`QUOTATION`) added to the
existing `OrderSource` enum. No existing table, column, or enum value
is removed or changed. As with every previous milestone's migration, it
cannot be validated or generated in the build sandbox — run these for
real on your machine.

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_quotations_management

# 2. Regenerate the Prisma client so it knows about Quotation,
#    QuotationLine, QuotationEvent, their 2 new enums, and the new
#    OrderSource.QUOTATION value
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test

# 4. Confirm a real production build succeeds now that the client
#    actually knows about these models (the sandbox could not get past
#    its own Google Fonts network block to even reach this phase — see
#    PROGRESS.md's Milestone 7 honest verification results)
npm run build
```

If `prisma migrate dev` reports schema drift because you've been
running against the hand-written SQL already, use `migrate deploy`
instead:

```powershell
npx prisma migrate deploy
npx prisma generate
```

### Run this milestone's real database acceptance tests

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

This runs the new `tests/quotations-db.integration.test.ts` alongside
every pre-existing gated integration test. It builds its own `Product`/
`TaxCode` fixtures (`isDemo: true`) rather than depending on a specific
seeded catalogue item, and covers: decimal-exact line/quotation totals
on creation (hand-verified figures, confirming discount is applied
before VAT); rejecting an unlisted line with no description and a
catalogued line referencing an unknown product, writing nothing; every
DRAFT line add/update/remove path correctly recomputing the stored
quotation totals, then hard-blocked the instant the quotation is
issued; issuing refused with zero lines and refused a second time;
recording the customer's ACCEPTED/REJECTED response (confirming
ACCEPTED never silently creates a `CustomerOrder`); cancellation
allowed from DRAFT/ISSUED/ACCEPTED(no order yet)/EXPIRED but blocked
the moment a quotation has already been converted into a real order; a
full convert-to-order cycle, confirming a second call against the same
quotation returns the identical order (`alreadyConverted: true`) rather
than ever creating a second one; a full revision cycle (new DRAFT row
copied verbatim, the old row's status frozen and excluded from the
default list query, re-revision blocked on both the now-superseded old
row and the new DRAFT row); revision-history resolution from either the
lineage's root id or any later revision's id; manual `expireQuotation`
refused while still valid and the system-wide `sweepExpiredQuotations`
sweep correctly leaving a still-valid quotation untouched; and the
dual-write `QuotationEvent`/`AuditEvent` audit trail across a full
create→issue→accept sequence. Everything it creates (`Quotation`/
`QuotationLine`/`QuotationEvent`/the test `Product`/`TaxCode`, plus any
`CustomerOrder` created by the conversion tests) is cleaned up in
`afterAll` in an order that respects every new foreign key
(`QuotationEvent`/`QuotationLine` before `Quotation`, and every
`Quotation` row before the `CustomerOrder` rows it may reference via
`convertedOrderId`). It needs only an admin user and the
`DEMO-CUST-001` customer already seeded.

**Honesty note**: this test file, like every gated DB-integration test
in this project, has not been run against a real database from inside
this sandbox — `@prisma/client` here is a stub that throws when
constructed (see PROGRESS.md's "Sandbox-only blocker"). It was written
to the same standard as `tests/returns-credits-db.integration.test.ts`
and independently checked against the real source of every function/
field/signature it calls (`lib/quotations/*`, `prisma/schema.prisma`)
— but treat it as unverified until you actually run it.

### Set up the scheduled expiry sweep (optional, but recommended)

`npm run quotations:expire` runs `sweepExpiredQuotations()` once and
exits — it is not a long-running process. Without a schedule, an
`ISSUED` quotation whose validity date has passed still shows correctly
as overdue everywhere the UI computes it live (the dashboard's
"due for follow-up" figure, the detail page's warning banner), but its
stored `status` column only actually flips to `EXPIRED` the next time
someone opens its detail page and clicks **Mark expired**, or the next
time this script runs. Running it daily keeps the stored `status`
column itself accurate for anyone querying the database directly
(reports, SAP exports, etc.), not just for anyone using the app.

Using Windows Task Scheduler:

1. Open **Task Scheduler** → **Create Task…**
2. **General** tab: name it `SalesFlow - Expire Quotations`, select
   "Run whether user is logged on or not."
3. **Triggers** tab → **New…** → Daily, pick a time after midnight
   (e.g. 00:15), so a quotation that expired "today" is swept promptly.
4. **Actions** tab → **New…** → Program/script: `npm.cmd`; Arguments:
   `run quotations:expire`; Start in: the full path to this project's
   repository root (e.g. `C:\SalesFlow`).
5. **Conditions** tab: untick "Start the task only if the computer is
   on AC power" if this runs on a machine that might be on battery.
6. Save, then right-click the task → **Run** once to confirm it
   completes without error before relying on the schedule.

Equivalent one-line `schtasks` command (run as Administrator, adjust
the path):

```powershell
schtasks /create /tn "SalesFlow - Expire Quotations" /tr "npm.cmd run quotations:expire" /sc daily /st 00:15 /ru SYSTEM
```

### Manual test script (via the UI)

1. Open **Quotations** in the sidebar (`/quotations`). Confirm the
   dashboard shows summary cards (Total/Draft/Issued-awaiting-response/
   Accepted/Rejected+Expired/Due-for-follow-up) and an empty list.
2. Click **New Quotation**. Pick a customer, set a quotation date and a
   validity date a week out, add one catalogued line (search for a real
   SAP product) and one line marked **Unlisted / requested item** with
   a free-text description. Save. Confirm you land on the new
   quotation's detail page, status **Draft**, with both lines and
   correct totals (check the VAT/discount math against the product's
   own catalogue price and VAT code).
3. On the detail page, edit a line's quantity, add a second catalogued
   line, then remove it again. Confirm the totals update correctly
   after each change.
4. Click **Issue to customer**. Confirm the status becomes **Issued**
   and every DRAFT-only editing control (add/edit/remove line, header
   edit) disappears. Try `PATCH /api/quotations/<id>` directly (e.g.
   via a REST client) and confirm it's refused with `409`.
5. Click **Record customer response**, choose **Accepted**. Confirm the
   status becomes **Accepted** and no `CustomerOrder` was created (check
   `/orders` — nothing new).
6. Click **Convert to order**. Confirm you land on a real new order's
   detail page with matching lines. Go back to the quotation and click
   **Convert to order** again (or call the API directly a second time);
   confirm it returns the *same* order, not a second one.
7. On this now-converted, Accepted quotation, confirm the **Cancel
   quotation** button is no longer offered (or, calling the API
   directly, `POST /api/quotations/<id>/cancel` returns `409`).
8. Create a second quotation, issue it, and click **Create revision**.
   Confirm you land on a new **Draft** quotation with the same
   quotation number and revision 2, identical lines/totals copied over.
   Go back to the original (revision 1)'s detail page and confirm it
   shows an amber "superseded" banner linking to the new revision, and
   that it no longer appears in the default `/quotations` list (filter
   by its quotation number — only revision 2 shows).
9. Create a third quotation, issue it, then edit its validity date
   directly in the database (or just wait) to a date in the past.
   Confirm the detail page shows a red "eligible for expiry" banner and
   a **Mark expired** button; click it and confirm the status becomes
   **Expired**. Separately, run `npm run quotations:expire` from a
   terminal against another past-dated issued quotation and confirm it
   reports the quotation as expired without you clicking anything.
10. Open `/quotations/<id>/print` for any quotation. Confirm it renders
    a clean, letterhead-style printable page with no sidebar/nav chrome,
    a **Print** button (hidden from the printed output itself), and —
    for a DRAFT/CANCELLED/REJECTED/EXPIRED/superseded quotation — a
    clearly visible banner explaining its status is not current.

### 24a. Undoing this migration

**This is destructive** — it drops the 3 new tables and the 2 new enum
types, and removing the `QUOTATION` value from `OrderSource` requires
recreating that enum type (Postgres has no simple "remove enum value").
Back up first:

```powershell
pg_dump -Fc -d <your-database-name> -f backup-before-undo-milestone-7.dump
```

```sql
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_customerId_fkey";
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_customerContactId_fkey";
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_preparedById_fkey";
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_salespersonId_fkey";
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_issuedById_fkey";
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_respondedById_fkey";
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_cancelledById_fkey";
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_supersededById_fkey";
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_convertedById_fkey";
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_previousRevisionId_fkey";
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_convertedOrderId_fkey";
ALTER TABLE "QuotationLine" DROP CONSTRAINT "QuotationLine_quotationId_fkey";
ALTER TABLE "QuotationLine" DROP CONSTRAINT "QuotationLine_productId_fkey";
ALTER TABLE "QuotationEvent" DROP CONSTRAINT "QuotationEvent_quotationId_fkey";
ALTER TABLE "QuotationEvent" DROP CONSTRAINT "QuotationEvent_actorId_fkey";

DROP TABLE "QuotationLine";
DROP TABLE "QuotationEvent";
DROP TABLE "Quotation";

DROP TYPE "QuotationEventType";
DROP TYPE "QuotationStatus";

-- Only if nothing in CustomerOrder.source uses 'QUOTATION' (check first:
-- SELECT COUNT(*) FROM "CustomerOrder" WHERE source = 'QUOTATION';):
ALTER TYPE "OrderSource" RENAME TO "OrderSource_old";
CREATE TYPE "OrderSource" AS ENUM ('EMAIL', 'WHATSAPP', 'MANUAL', 'PDF', 'IMAGE', 'EXCEL', 'CSV');
ALTER TABLE "CustomerOrder" ALTER COLUMN "source" TYPE "OrderSource" USING ("source"::text::"OrderSource");
DROP TYPE "OrderSource_old";
```

Apply the reversible part the same way as previous rollbacks (`psql`, a
GUI client, or `npx prisma db execute --file
.\rollback-milestone-7.sql --schema prisma/schema.prisma`), then revert
`prisma/schema.prisma` to remove the same changes and run `npx prisma
generate` again. Also tell Prisma's migration history about the
rollback:

```powershell
npx prisma migrate resolve --rolled-back 20261111150000_add_quotations_management
```

## 25. Milestone 8: Validation and Approvals

This migration is purely additive: 2 new enums beyond the ones listed
below are actually 4 (`ApprovalRequestStatus`, `ApprovalModule`,
`ApprovalActionType`, `ApprovalEventType`) plus `NotificationType`, and
4 new tables (`ApprovalPolicy`, `ApprovalRequest`, `ApprovalEvent`,
`Notification`). No existing table, column, or enum value is removed
or changed, and the legacy, unused Milestone 0
`ProductVerification`/`PriceDecision`/`OrderApproval` tables and their
enums are deliberately left untouched — this migration neither reuses
nor removes them (see ROADMAP.md's "never conflate" entry). As with
every previous milestone's migration, it cannot be validated or
generated in the build sandbox — run these for real on your machine.

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_validation_and_approvals

# 2. Regenerate the Prisma client so it knows about ApprovalPolicy,
#    ApprovalRequest, ApprovalEvent, Notification, and their 5 new enums
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test

# 4. Confirm a real production build succeeds now that the client
#    actually knows about these models (the sandbox could not get past
#    its own Google Fonts network block to even reach this phase — see
#    PROGRESS.md's Milestone 8 honest verification results)
npm run build
```

If `prisma migrate dev` reports schema drift because you've been
running against the hand-written SQL already, use `migrate deploy`
instead:

```powershell
npx prisma migrate deploy
npx prisma generate
```

### Run this milestone's real database acceptance tests

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

This runs the new `tests/approvals-db.integration.test.ts` alongside
every pre-existing gated integration test. It creates its own two
`SALES_MANAGER` test users directly via `prisma.user.create` (`isDemo:
true`) rather than `lib/users.ts`'s `createUser`, which hardcodes
`isDemo: false`, and covers: a policy-blocked quotation issue creating
a `PENDING` approval request; self-approval refused when the same user
prepared and would decide the same quotation; a cross-manager approval
succeeding; re-issuing after approval succeeding unconditionally;
deciding an already-decided request returning `409`; rejection with a
mandatory reason, confirming the resulting notification; duplicate-
submission prevention (a second issue attempt while one request is
already `PENDING` also returns `409`, and exactly one `ApprovalRequest`
row exists); a concurrent-decision race (`Promise.all` on approve and
reject against the same request) confirmed to let exactly one through
and 409 the other; a discount lowered back under threshold auto-
cancelling the stale `PENDING` request and letting the next issue
through unconditionally; a discount raised again after that
cancelling the old request and creating a new one chained to it via
`previousRequestId`/`rootRequestId` pointing at the original; withdraw
restricted to the original requester (403 for anyone else); cancel
restricted to `ADMINISTRATOR`; and role-eligibility enforcement (a
`SALES_MANAGER` refused 403 on a policy requiring `ADMINISTRATOR`,
an `ADMINISTRATOR` succeeding on the same policy). Everything it
creates (`ApprovalEvent`/`ApprovalRequest`/`ApprovalPolicy`, its own
two test users, and any `Quotation`/`QuotationLine` it needs to drive
the scenarios) is cleaned up in `afterAll` in FK-respecting
leaves-first order. It needs only an admin user and the
`DEMO-CUST-001` customer already seeded.

**Honesty note**: this test file, like every gated DB-integration test
in this project, has not been run against a real database from inside
this sandbox — `@prisma/client` here is a stub that throws when
constructed (see PROGRESS.md's "Sandbox-only blocker"). It was written
to the same standard as `tests/quotations-db.integration.test.ts` and
independently checked against the real source of every function/
field/signature it calls (`lib/approvals/*`, `prisma/schema.prisma`)
— but treat it as unverified until you actually run it.

### Manual test script (via the UI)

1. Log in as the seeded `ADMINISTRATOR` and open **Approvals** in the
   sidebar (`/approvals`). Confirm the summary counters row renders
   (Pending / Awaiting my decision / Submitted by me / Overdue /
   Approved / Avg turnaround) and, with no requests yet, an empty list.
2. Click through to **Approval policies** (`/approvals/policies`).
   No policy is seeded by default (`prisma/seed.ts` was not extended
   for this milestone), so the list should be empty at first. Create a
   new policy: action type **Quotation discount exceeds threshold**,
   threshold **10%**, required approver role **Sales Manager**,
   active. Save and confirm it appears in the list with no "Not yet
   enforced" badge. Then create a second policy with action type
   **Order value exceeds threshold** and confirm that one *does* show
   the **Not yet enforced** badge.
3. As a `SALESPERSON` or `SALES_MANAGER`, create a quotation
   (`/quotations/new`) with at least one line discounted above 10%.
   Save as DRAFT, then click **Issue to customer**. Confirm issuing is
   refused and the quotation detail page now shows an amber "pending
   approval" banner linking to a new approval request.
4. Follow that link to `/approvals/<id>`. Confirm the detail page shows
   the submitted discount value, the requester, and (if you edit the
   quotation's discount back down below 10% and look again) that the
   request is auto-**Cancelled** with a system reason once the
   underlying value no longer exceeds the threshold.
5. Raise the discount back above 10% and attempt to issue again.
   Confirm a *new* approval request is created and that its detail page
   shows it chained to the original (same lineage, via
   `previousRequestId`/`rootRequestId` — visible in the event history
   if you added that to the detail page's display, or confirmable via
   `GET /api/approvals/<id>`).
6. Log in as a different user with the `SALES_MANAGER` role (not the
   one who prepared the quotation) and open the same request. Confirm
   **Approve**/**Reject** buttons are visible and working; approving
   should flip the quotation's own blocked-issue state so **Issue to
   customer** now succeeds. Confirm the bell icon in the sidebar footer
   for the *requester's* account shows an unread notification, and that
   opening it and clicking the notification marks it read and navigates
   to the approval request.
7. Log back in as the original requester (the quotation's preparer) and
   confirm that, before it was decided, they could not approve/reject
   their own request even if also a `SALES_MANAGER` (unless the
   policy's "allow requester to self-approve" box was ticked when you
   created it in step 2) — try `POST /api/approvals/<id>/approve`
   directly and confirm it's refused.
8. On a still-`PENDING` request you submitted yourself, click
   **Withdraw**, confirm it moves to **Withdrawn** and disappears from
   anyone's "awaiting my decision" tab. On a different `PENDING`
   request, log in as the `ADMINISTRATOR` and click **Cancel**; confirm
   a `SALES_MANAGER` attempting the same `POST
   /api/approvals/<id>/cancel` directly gets a `403`.
9. Confirm that creating an `ApprovalPolicy` with action type
   **Order value exceeds threshold** and saving a Customer-PO/order
   purely as normal (`/orders/new` or however orders are created in
   your deployment) never triggers any approval request, regardless of
   the order's value — this action type is deliberately framework-ready
   only, per the explicit scope decision recorded in PROGRESS.md and
   ROADMAP.md.

### 25a. Undoing this migration

**This is destructive** — it drops the 4 new tables and the 5 new enum
types. Back up first:

```powershell
pg_dump -Fc -d <your-database-name> -f backup-before-undo-milestone-8.dump
```

```sql
ALTER TABLE "ApprovalPolicy" DROP CONSTRAINT "ApprovalPolicy_createdById_fkey";
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_quotationId_fkey";
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_customerOrderId_fkey";
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_previousRequestId_fkey";
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_policyId_fkey";
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_requestedById_fkey";
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_decidedById_fkey";
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_withdrawnById_fkey";
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_cancelledById_fkey";
ALTER TABLE "ApprovalEvent" DROP CONSTRAINT "ApprovalEvent_approvalRequestId_fkey";
ALTER TABLE "ApprovalEvent" DROP CONSTRAINT "ApprovalEvent_actorId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";

DROP TABLE "ApprovalEvent";
DROP TABLE "ApprovalRequest";
DROP TABLE "ApprovalPolicy";
DROP TABLE "Notification";

DROP TYPE "ApprovalEventType";
DROP TYPE "ApprovalActionType";
DROP TYPE "ApprovalModule";
DROP TYPE "ApprovalRequestStatus";
DROP TYPE "NotificationType";
```

Apply the reversible part the same way as previous rollbacks (`psql`, a
GUI client, or `npx prisma db execute --file
.\rollback-milestone-8.sql --schema prisma/schema.prisma`), then revert
`prisma/schema.prisma` to remove the same changes and run `npx prisma
generate` again. Also tell Prisma's migration history about the
rollback:

```powershell
npx prisma migrate resolve --rolled-back 20261111180000_add_validation_and_approvals
```

## 26. Milestone 9: SAP Business One Integration

This migration is purely additive: 8 new enum types
(`IntegrationProvider`, `IntegrationMode`, `IntegrationSyncJobType`,
`IntegrationSyncJobStatus`, `IntegrationTrigger`,
`IntegrationOperationType`, `IntegrationOperationStatus`,
`IntegrationErrorCategory`) and 3 new tables
(`IntegrationConnection`, `IntegrationSyncJob`,
`IntegrationOperation`). No existing table, column, or enum value is
removed or changed. As with every previous milestone's migration, it
cannot be validated or generated in the build sandbox — run these for
real on your machine.

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_sap_integration

# 2. Regenerate the Prisma client so it knows about
#    IntegrationConnection, IntegrationSyncJob, IntegrationOperation,
#    and their 8 new enums
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test

# 4. Confirm a real production build succeeds (the sandbox could not
#    get past its own Google Fonts network block to even reach this
#    phase -- see PROGRESS.md's Milestone 9 honest verification results)
npm run build
```

If `prisma migrate dev` reports schema drift because you've been
running against the hand-written SQL already, use `migrate deploy`
instead:

```powershell
npx prisma migrate deploy
npx prisma generate
```

### Configure the environment

Add to `.env.local` (see the updated `.env.example`):

```
SAP_B1_PROVIDER=""
SAP_B1_PASSWORD=""
```

Leave both blank until `docs/sap-integration/discovery-checklist.md` is
fully complete. With `SAP_B1_PROVIDER` unset (or anything other than
exactly `"live"`), every sync and submission in this milestone runs
against the deterministic mock adapter — this is the correct, safe
default for all normal use, demos, and the manual test script below.

### Run this milestone's real database acceptance tests

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

This runs the new `tests/sap-order-outbox-db.integration.test.ts`
alongside every pre-existing gated integration test. It reuses a
pre-existing `Customer`/`Product` with the mock adapter's own fixture
codes (`CUS-0001`/`ITM-0001`) if one is already present, or creates its
own `isDemo: true` rows otherwise, and covers: `checkOrderEligibility`
blocking a non-quotation order with `NOT_FROM_QUOTATION`; a quotation-
converted order with a mapped customer/product/price returning
`eligible: true` with a correctly-shaped submission; `submitOrderToSap`
succeeding end-to-end and being idempotent on resubmission (exactly one
`IntegrationOperation` row); the `TIMEOUT` → `UNCERTAIN` →
`reconcileUncertainOperation` → `SUCCEEDED` path (spec section 7.2's
central scenario); and the `UNCERTAIN` → reconciliation-not-found →
`resolveUncertainOperation` → `FAILED` path, confirming the resulting
`AuditEvent`. Everything it creates
(`IntegrationOperation`/`CustomerOrder`/`OrderLine`/`Quotation`, and
its own demo `Customer`/`Product` only if it had to create them) is
cleaned up in `afterAll`. It needs only an `ADMINISTRATOR` user already
seeded.

**Honesty note**: this test file, like every gated DB-integration test
in this project, has not been run against a real database from inside
this sandbox — `@prisma/client` here is a stub that throws when
constructed (see PROGRESS.md's "Sandbox-only blocker"). It was written
to the same standard as `tests/approvals-db.integration.test.ts` and
independently checked against the real source of every function/field/
signature it calls (`lib/integrations/sap/*`, `prisma/schema.prisma`)
— but treat it as unverified until you actually run it.

### Manual test script (via the UI, mock adapter)

1. Log in as the seeded `ADMINISTRATOR` and open **SAP Integration** in
   the sidebar (`/integrations/sap`). Confirm the dashboard loads and
   shows the connection as not yet configured/`MOCK` mode, with no
   sync history yet.
2. Open **Settings** from that page (`/integrations/sap/settings`).
   Confirm there is no password field anywhere on this page. Enter a
   placeholder base URL/company DB/username (these don't need to be
   real while `SAP_B1_PROVIDER` is unset — every call still goes to the
   mock adapter) and save. Confirm the change is reflected on reload
   and that a corresponding `AuditEvent`
   (`SAP_INTEGRATION_CONNECTION_UPDATED`) was recorded.
3. Click **Test connection**. Confirm it reports success immediately
   (the mock adapter's `testConnection` never fails) and that the
   dashboard's "last tested" timestamp updates.
4. Click **Sync now** for Products, then for Customers. Confirm each
   creates a new `IntegrationSyncJob` row visible in the dashboard's
   sync history, with a `COMPLETED` status and a summary count, and
   that the mock adapter's 4 fixture products / 2 fixture customers
   actually land in `/products`/`/customers` (via the existing
   Milestone 1 import pipeline underneath).
5. Create a quotation (`/quotations/new`) for a customer whose
   `sapCustomerCode` is `CUS-0001` (one of the two just synced), with a
   line for the product whose `sapItemCode` is `ITM-0001`, and carry it
   through to **Accepted**, then **Convert to order**
   (`convertQuotationToOrder`). Open the resulting order
   (`/orders/[id]`). Confirm the new "SAP Business One" panel shows
   status **Ready** and a **Submit to SAP** button.
6. Click **Submit to SAP**. Confirm the panel updates to **Synced**
   with a SAP document reference, and that
   `/integrations/sap`'s operations table shows a `SUCCEEDED` row for
   this order. Click **Submit to SAP** again (or re-POST
   `/api/orders/[id]/sap-submit` directly) and confirm it returns the
   *same* document reference rather than creating a second one.
7. Create a second quotation-converted order the same way, but first
   edit its `CustomerOrder.reference` directly in the database (or via
   whatever path is convenient) to include the literal substring
   `__SIMULATE_TIMEOUT__` — this is the mock adapter's own documented
   test-only sentinel (see `lib/integrations/sap/mock-adapter.ts`'s
   module comment), never reachable through any normal UI input.
   Submit it; confirm the panel/operations table show **Uncertain**,
   not Failed. As an `ADMINISTRATOR`, click **Reconcile** on that
   operation; confirm it resolves to **Synced** (the mock "finds" the
   order it secretly recorded despite the simulated timeout) —
   demonstrating spec section 7.2's central guarantee that a lost
   response is never silently treated as a rejection.
8. Repeat step 7 with `__SIMULATE_UNCERTAIN_LOST__` instead. Confirm
   **Reconcile** this time reports not-found, and that **Resolve** is
   the only remaining action; choose "confirm not created" and confirm
   the row moves to **Failed** with your notes recorded, and that a
   `SAP_UNCERTAIN_SUBMISSION_RESOLVED` `AuditEvent` was created.
9. As a `SALESPERSON`, confirm `/integrations/sap` and
   `/integrations/sap/settings` both redirect away (`ADMINISTRATOR`/
   `SALES_MANAGER`-only and `ADMINISTRATOR`-only respectively), but
   that the SAP panel on an order they can see still shows its status
   (view-only, no Submit button for a `SALESPERSON`).
10. Confirm a manually-entered (non-quotation) order's SAP panel always
    shows **Not ready** with the `NOT_FROM_QUOTATION` reason, regardless
    of its status or value — this is the explicit, documented scope
    boundary, not a bug.

### 26a. Undoing this migration

**This is destructive** — it drops the 3 new tables and the 8 new enum
types. Back up first:

```powershell
pg_dump -Fc -d <your-database-name> -f backup-before-undo-milestone-9.dump
```

```sql
ALTER TABLE "IntegrationConnection" DROP CONSTRAINT "IntegrationConnection_updatedById_fkey";
ALTER TABLE "IntegrationSyncJob" DROP CONSTRAINT "IntegrationSyncJob_triggeredById_fkey";
ALTER TABLE "IntegrationOperation" DROP CONSTRAINT "IntegrationOperation_syncJobId_fkey";
ALTER TABLE "IntegrationOperation" DROP CONSTRAINT "IntegrationOperation_customerOrderId_fkey";

DROP TABLE "IntegrationOperation";
DROP TABLE "IntegrationSyncJob";
DROP TABLE "IntegrationConnection";

DROP TYPE "IntegrationErrorCategory";
DROP TYPE "IntegrationOperationStatus";
DROP TYPE "IntegrationOperationType";
DROP TYPE "IntegrationTrigger";
DROP TYPE "IntegrationSyncJobStatus";
DROP TYPE "IntegrationSyncJobType";
DROP TYPE "IntegrationMode";
DROP TYPE "IntegrationProvider";
```

Apply the reversible part the same way as previous rollbacks (`psql`, a
GUI client, or `npx prisma db execute --file
.\rollback-milestone-9.sql --schema prisma/schema.prisma`), then revert
`prisma/schema.prisma` to remove the same changes and run `npx prisma
generate` again. Also tell Prisma's migration history about the
rollback:

```powershell
npx prisma migrate resolve --rolled-back 20261111200000_add_sap_integration
```

## 27. Milestone 10: Communication Channels & Fulfilment

This migration is purely additive: 6 new enum types (`MessageChannel`,
`MessageIntakeStatus`, `OutboundMessageType`, `OutboundMessageStatus`,
`DispatchStatus`, `DeliveryOutcome`), 2 new values added to the
existing `NotificationType` enum (`CHANNEL_INTAKE_RECEIVED`,
`OUTBOUND_MESSAGE_FAILED`), and 7 new tables (`MessageIntake`,
`MessageAttachment`, `OutboundMessage`, `DispatchRecord`,
`DispatchLine`, `DeliveryRecord`, `DeliveryLine`). No existing table,
column, or enum value is removed or changed. As with every previous
milestone's migration, it cannot be validated or generated in the
build sandbox — run these for real on your machine.

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_communications_and_fulfilment

# 2. Regenerate the Prisma client so it knows about MessageIntake,
#    MessageAttachment, OutboundMessage, DispatchRecord, DispatchLine,
#    DeliveryRecord, DeliveryLine, and their 6 new enums
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test

# 4. Confirm a real production build succeeds (the sandbox could not
#    get past its own Google Fonts network block to even reach this
#    phase -- see PROGRESS.md's Milestone 10 honest verification results)
npm run build
```

If `prisma migrate dev` reports schema drift because you've been
running against the hand-written SQL already, use `migrate deploy`
instead:

```powershell
npx prisma migrate deploy
npx prisma generate
```

### Configure the environment

Add to `.env.local` (see the updated `.env.example`):

```
CHANNEL_EMAIL_PROVIDER=""
CHANNEL_WHATSAPP_PROVIDER=""
CHANNEL_EMAIL_API_KEY=""
CHANNEL_EMAIL_FROM_ADDRESS=""
CHANNEL_WHATSAPP_PHONE_NUMBER_ID=""
CHANNEL_WHATSAPP_ACCESS_TOKEN=""
CHANNEL_EMAIL_WEBHOOK_SECRET=""
CHANNEL_WHATSAPP_WEBHOOK_SECRET=""
```

Leave all eight blank until you actually have a real transactional-
email provider account and/or an approved WhatsApp Business Account —
this project invents neither. With both provider switches unset (or
anything other than exactly `"live"`), every outbound send in this
milestone runs against the deterministic mock adapter (recorded as
`SENT` immediately), and both inbound webhook routes refuse every
request with a 503 — this is the correct, safe default for all normal
use, demos, and the manual test script below. Log messages by hand
instead, via the "Log a message manually" form on
`/communications/inbox`.

### Run this milestone's real database acceptance tests

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

This runs the two new gated test files alongside every pre-existing
gated integration test:

- `tests/fulfilment-db.integration.test.ts` — the full dispatch →
  depart → deliver lifecycle on a fully-picked-and-authorized demo
  order; `createDispatchRecord` refusing to over-dispatch or to
  dispatch an order that isn't `READY_TO_INVOICE`; a partial dispatch
  correctly reducing `getOrderFulfilmentStatus`'s outstanding quantity
  by exactly the dispatched amount, with the remainder still available
  for a second dispatch; cancelling a still-`PLANNED` dispatch giving
  its quantity back to the outstanding pool; a departed dispatch
  refusing to be cancelled; `recordDelivery` enforcing
  `accepted + rejected === dispatched` and requiring a rejection reason
  wherever `rejectedQuantity > 0`; and a second delivery outcome for
  the same dispatch being refused (`DeliveryRecord.dispatchRecordId`
  is `@unique`).
- `tests/channels-intake-review-db.integration.test.ts` —
  `recordInboundMessage`'s idempotent dedup on a redelivered
  `externalMessageId`; rejecting an empty sender address and an
  oversized attachment; every review action refusing once a message
  has already been reviewed, and refusing to mark a message as a
  duplicate of itself; and `convertMessageIntakeToPoIntake` actually
  calling the existing, unmodified `createPoIntake` pipeline,
  producing a real `OrderDocument` attributed to the reviewer (never
  the message), and refusing a second conversion attempt.

It needs only an `ADMINISTRATOR` user already seeded (the fulfilment
test additionally needs one `DEMO-CUST-*` customer, same precondition
as `tests/picking-db.integration.test.ts`). Everything either test
creates is marked `isDemo: true` and cleaned up in `afterAll`.

**Honesty note**: both test files, like every gated DB-integration
test in this project, have not been run against a real database from
inside this sandbox — `@prisma/client` here is a stale stub that does
not know these 7 models exist at all (see PROGRESS.md's "Honest
verification results"). They were written to the same standard as
`tests/picking-db.integration.test.ts` and independently checked
against the real source of every function/field/signature they call
(`lib/fulfilment/*`, `lib/channels/intake-review.ts`,
`prisma/schema.prisma`) — but treat them as unverified until you
actually run them.

### Manual test script (via the UI, mock adapters)

1. Log in as any seeded user and open **Message Inbox** in the sidebar
   (`/communications/inbox`). Confirm the queue is empty (or shows
   only pre-existing demo data) and the "Log a message manually" form
   is collapsed by default.
2. Click **Log a message manually**, choose "Phone / in person", enter
   a customer email/phone/name and a short message body, and submit.
   Confirm a new row appears in the `RECEIVED` tab immediately.
3. Open that message and try each review action in turn: **Ignore**
   (with a reason), confirming the status becomes `IGNORED` and the
   action buttons disappear (already reviewed); on a *second*, freshly
   logged message, try **Convert** instead — confirm it produces a
   real PO-intake document (check the existing `/orders` → PO review
   queue, or wherever converted documents land in your build) and that
   the message's own status becomes `CONVERTED` with a visible link to
   the resulting document.
4. `curl` or Postman the WhatsApp webhook's GET handshake
   (`/api/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=anything&hub.challenge=123`)
   with `CHANNEL_WHATSAPP_WEBHOOK_SECRET` still unset. Confirm a `403`.
   `POST` anything to either webhook route with both secrets unset;
   confirm a `503` "...is not configured on this deployment" — neither
   webhook ever silently accepts an unsigned request.
5. Open **Communications** in the sidebar (`/communications`) — should
   be empty initially. Create and issue a quotation
   (`/quotations/new` → Issue), then open `/communications` again:
   confirm a new `QUOTATION_ISSUED` row appears with status `SENT`
   (the mock email adapter "sends" and records it immediately) and
   that its rendered body text includes the quotation number and
   total.
6. Convert that quotation to an order, authorize picking on it (same
   workflow as Milestone 3), then check `/communications` again:
   confirm `ORDER_CONFIRMATION` and `PICKING_UPDATE` rows both appear.
7. Open the resulting order's fulfilment page (`/fulfilment/[id]`) —
   the dispatch/delivery panel should now be visible under the
   existing picking panel. Create a dispatch for less than the full
   authorized quantity on at least one line; confirm the panel's
   outstanding-quantity figure drops by exactly that amount. Record
   departure (optionally with a vehicle/courier reference); confirm a
   `DISPATCH_NOTIFICATION` row appears on `/communications`.
8. Record the delivery outcome: accept everything on one line and
   split accepted/rejected (with a reason) on another. Confirm the
   dispatch moves to **Delivered**, a `DELIVERY_EXCEPTION` (not
   `DELIVERY_CONFIRMATION`) row appears on `/communications` since at
   least one line was rejected, and a "File a claim" link is offered
   for the rejected line (opens `/invoice-claims/new` — it does **not**
   create a claim automatically).
9. Open `/deliveries` (the sidebar's "Dispatch & Delivery" entry — no
   longer a dead link). Confirm it lists orders that are
   `READY_TO_INVOICE` or have an in-flight dispatch, and that the
   order from steps 7–8 drops off the list once fully dispatched and
   delivered.
10. As a `SALESPERSON`, open `/communications` and confirm the Resend
    button is absent (or the underlying `POST
    /api/communications/[id]/resend` returns 403) on any `FAILED` row
    — Resend is `SALES_MANAGER`/`ADMINISTRATOR`-only. Confirm every
    other action in this script (intake review, dispatch, delivery)
    is available to a `SALESPERSON` too — none of this milestone's
    operational actions have a dedicated role requirement.

### 27a. Undoing this migration

**This is destructive** — it drops the 7 new tables and the 6 new enum
types, and removes the 2 added `NotificationType` values (Postgres
cannot drop individual enum values in place; see below). Back up
first:

```powershell
pg_dump -Fc -d <your-database-name> -f backup-before-undo-milestone-10.dump
```

```sql
ALTER TABLE "MessageIntake" DROP CONSTRAINT "MessageIntake_customerId_fkey";
ALTER TABLE "MessageIntake" DROP CONSTRAINT "MessageIntake_customerContactId_fkey";
ALTER TABLE "MessageIntake" DROP CONSTRAINT "MessageIntake_reviewedById_fkey";
ALTER TABLE "MessageIntake" DROP CONSTRAINT "MessageIntake_resultingOrderDocumentId_fkey";
ALTER TABLE "MessageIntake" DROP CONSTRAINT "MessageIntake_linkedOrderId_fkey";
ALTER TABLE "MessageIntake" DROP CONSTRAINT "MessageIntake_linkedQuotationId_fkey";
ALTER TABLE "MessageIntake" DROP CONSTRAINT "MessageIntake_duplicateOfId_fkey";
ALTER TABLE "MessageAttachment" DROP CONSTRAINT "MessageAttachment_messageIntakeId_fkey";
ALTER TABLE "OutboundMessage" DROP CONSTRAINT "OutboundMessage_customerId_fkey";
ALTER TABLE "OutboundMessage" DROP CONSTRAINT "OutboundMessage_customerContactId_fkey";
ALTER TABLE "OutboundMessage" DROP CONSTRAINT "OutboundMessage_relatedOrderId_fkey";
ALTER TABLE "OutboundMessage" DROP CONSTRAINT "OutboundMessage_relatedQuotationId_fkey";
ALTER TABLE "OutboundMessage" DROP CONSTRAINT "OutboundMessage_relatedDispatchRecordId_fkey";
ALTER TABLE "OutboundMessage" DROP CONSTRAINT "OutboundMessage_relatedDeliveryRecordId_fkey";
ALTER TABLE "OutboundMessage" DROP CONSTRAINT "OutboundMessage_triggeredById_fkey";
ALTER TABLE "OutboundMessage" DROP CONSTRAINT "OutboundMessage_lastResentById_fkey";
ALTER TABLE "DispatchRecord" DROP CONSTRAINT "DispatchRecord_orderId_fkey";
ALTER TABLE "DispatchRecord" DROP CONSTRAINT "DispatchRecord_pickingSessionId_fkey";
ALTER TABLE "DispatchRecord" DROP CONSTRAINT "DispatchRecord_createdById_fkey";
ALTER TABLE "DispatchRecord" DROP CONSTRAINT "DispatchRecord_departedById_fkey";
ALTER TABLE "DispatchRecord" DROP CONSTRAINT "DispatchRecord_cancelledById_fkey";
ALTER TABLE "DispatchLine" DROP CONSTRAINT "DispatchLine_dispatchRecordId_fkey";
ALTER TABLE "DispatchLine" DROP CONSTRAINT "DispatchLine_orderLineId_fkey";
ALTER TABLE "DeliveryRecord" DROP CONSTRAINT "DeliveryRecord_dispatchRecordId_fkey";
ALTER TABLE "DeliveryRecord" DROP CONSTRAINT "DeliveryRecord_recordedById_fkey";
ALTER TABLE "DeliveryLine" DROP CONSTRAINT "DeliveryLine_deliveryRecordId_fkey";
ALTER TABLE "DeliveryLine" DROP CONSTRAINT "DeliveryLine_dispatchLineId_fkey";

DROP TABLE "DeliveryLine";
DROP TABLE "DeliveryRecord";
DROP TABLE "DispatchLine";
DROP TABLE "DispatchRecord";
DROP TABLE "OutboundMessage";
DROP TABLE "MessageAttachment";
DROP TABLE "MessageIntake";

DROP TYPE "DeliveryOutcome";
DROP TYPE "DispatchStatus";
DROP TYPE "OutboundMessageStatus";
DROP TYPE "OutboundMessageType";
DROP TYPE "MessageIntakeStatus";
DROP TYPE "MessageChannel";
```

`NotificationType`'s 2 added values (`CHANNEL_INTAKE_RECEIVED`,
`OUTBOUND_MESSAGE_FAILED`) cannot be dropped in place — Postgres has no
`ALTER TYPE ... DROP VALUE`. If no `Notification` row ever used either
value (true immediately after this rollback, since the tables that
created them are now gone), rebuild the type instead:

```sql
CREATE TYPE "NotificationType_new" AS ENUM (/* every value from the
  CREATE TYPE "NotificationType" statement BEFORE this milestone's
  migration, in the same order -- copy it from
  prisma/migrations/20261111180000_add_validation_and_approvals/migration.sql */);
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
DROP TYPE "NotificationType";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
```

Apply the reversible part the same way as previous rollbacks (`psql`, a
GUI client, or `npx prisma db execute --file
.\rollback-milestone-10.sql --schema prisma/schema.prisma`), then
revert `prisma/schema.prisma` to remove the same changes and run `npx
prisma generate` again. Also tell Prisma's migration history about the
rollback:

```powershell
npx prisma migrate resolve --rolled-back 20261111220000_add_communications_and_fulfilment
```

## 28. Milestone 11: Operational Business Intelligence (BI)

This migration is purely additive: one new nullable column
(`CustomerOrder.salespersonId`), its FK onto `User`, two new indexes
(`CustomerOrder_salespersonId_idx` and `CustomerOrder_isDemo_status_idx`),
and a one-time data backfill of **existing** rows only (`UPDATE
"CustomerOrder" SET "salespersonId" = "createdById" WHERE "salespersonId"
IS NULL` — there is no reliable record of who the true assigned
salesperson was for orders created before this migration, so
`createdById` is used as the best available, non-invented approximation;
every *new* order gets a real, non-approximated value). No existing
table, column, enum, or constraint is removed or changed, and no
environment variables are added — this milestone introduces no new
external integration.

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_order_salesperson

# 2. Regenerate the Prisma client so it knows about
#    CustomerOrder.salespersonId
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test

# 4. Confirm a real production build succeeds (the sandbox could not
#    get past its own Google Fonts network block to even reach this
#    phase -- see PROGRESS.md's Milestone 11 honest verification results)
npm run build
```

If `prisma migrate dev` reports schema drift because you've been
running against the hand-written SQL already, use `migrate deploy`
instead:

```powershell
npx prisma migrate deploy
npx prisma generate
```

### Run this milestone's real database acceptance tests

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

This runs the new gated test file, `tests/reporting-db.integration.test.ts`
(14 tests), alongside every pre-existing gated integration test:

- `export-csv` helpers — pure `buildCsv`/`flattenToKeyValueRows`/
  `csvResponseHeaders` assertions against synthetic data (no database
  fixtures needed, but gated here to keep the file's imports simple).
- Sales-pipeline/fulfilment-intelligence — `ordersAwaitingFulfilment`
  only counting orders actually at `APPROVED`/`PICKING` (never an order
  already moved past that window by picking authorization), and the
  dispatched-quantity-≠-delivered-quantity invariant on a partially-
  picked, partially-dispatched order.
- The 5 list-shaped management reports' status-filter applicability —
  `listOrdersAwaitingFulfilment`'s `orderStatus` narrowing *within* its
  own status definition; `listPickingShortages`'/`listDeliveryExceptions`'
  `fulfilmentStatus` applied as `PickingSessionStatus`/`DeliveryOutcome`
  respectively, including the "value from the wrong enum is a silent
  no-op, never a thrown error" case; demo-data exclusion; pagination.
- Communications-monitoring — `intake.totalReceived` structurally equal
  to the sum of `intake.byChannel[].count`, and `outbound.failed`
  incrementing consistently with `listCommunicationFailures`.
- Financial-exposure — a USD claim and a ZWG claim kept as two separate,
  never-summed rows in `exposureByCurrency[]`.

It needs only an `ADMINISTRATOR` user already seeded (same precondition
as every other gated test file in this project). Everything either test
creates is marked `isDemo: true`.

**Honesty note**: this test file, like every gated DB-integration test
in this project, has not been run against a real database from inside
this sandbox — `@prisma/client` here is a stale stub that does not know
`CustomerOrder.salespersonId` or several of this milestone's own query
shapes exist at all (see PROGRESS.md's "Honest verification results").
It was written to the same standard as `tests/fulfilment-db.integration.
test.ts`/`tests/invoice-claims-db.integration.test.ts` and independently
checked against the real source of every function/field/signature it
calls (`lib/picking/*`, `lib/reporting/*.ts`, `prisma/schema.prisma`) —
but treat it as unverified until you actually run it. The 21 tests in
the companion file, `tests/reporting-filters.test.ts`, have no such
caveat: they are unconditional and were actually run in this sandbox
(21/21 passing).

### Manual test script (via the UI)

1. Log in as a `SALESPERSON` and open the home dashboard (`/`). Confirm
   it now shows real figures (not the previous milestone's hardcoded
   mock numbers) — pull a KPI from it and cross-check it by eye against
   `/orders` or `/quotations`.
2. Open **Reports** in the sidebar (`/reports`). Confirm all 4
   operational view cards are visible (Sales pipeline, Fulfilment,
   Financial exposure, Communications) and, as a `SALESPERSON`, that
   the "Management reports" card is **absent**.
3. Open `/reports/pipeline`. Set a date range covering some seeded
   orders; confirm the funnel counts (`requestsReceived` →
   `quotationsIssued` → `ordersReceived`) and that no conversion rate
   looks like it is dividing two different-dated populations against
   each other (check a known pair of figures by hand against `/orders`
   if unsure).
4. Open `/reports/fulfilment`. Confirm `dispatchedQuantity` and any
   `outstandingDeliveryQuantity` are reported as separate figures, never
   one standing in for "delivered."
5. Open `/reports/financial-exposure`. Confirm the "Exposure by
   currency" table shows USD and ZWG (if both exist in your seed data)
   as two separate rows, never summed into one total.
6. Open `/reports/communications`. Confirm the channel-mode cards show
   `MOCK` (unless you've configured real `CHANNEL_EMAIL_PROVIDER`/
   `CHANNEL_WHATSAPP_PROVIDER` values from Milestone 10) and that
   `intake.byChannel[]`'s counts sum to the header total.
7. On any of the 4 operational pages, apply a filter via the filter bar
   (date range, customer, or — on pipeline/fulfilment — salesperson),
   submit, and confirm the URL's query string updates and the results
   narrow accordingly with **no page reload flash of unfiltered data**
   (this surface has zero client JS — it's a plain `<form method="GET">`
   per page load). Click **Export CSV**; confirm a CSV downloads with a
   `recordReportExport` audit row (check `/admin` or your audit log
   viewer if you want to confirm the write).
8. Log in as an `ADMINISTRATOR` or `SALES_MANAGER`. Open
   `/reports/management`; confirm all 9 report rows are listed. Open
   **Outstanding orders**; confirm its first column links to
   `/orders/[id]` for a real order. Apply the `orderStatus` filter to
   one specific status and confirm every remaining row actually has
   that status.
9. Still as `SALES_MANAGER`/`ADMINISTRATOR`, open **Operational summary**
   and switch between the Daily/Weekly/Monthly period links; confirm the
   figures change and the URL's `period` query parameter updates.
10. Log back in as a `SALESPERSON` and try navigating directly to
    `/reports/management` and `/reports/management/outstanding-orders`
    by URL. Confirm both redirect to `/reports` — the restriction is
    enforced by the page itself (and by the underlying
    `/api/reports/management/*` routes), not just by hiding the sidebar
    link.
11. Create a new order (not via quotation conversion) as a
    `SALESPERSON`; confirm it is assigned that salesperson as its
    `salespersonId` (check `/reports/pipeline` filtered to that
    salesperson, or inspect the order record directly). Convert a
    quotation that has a *different* salesperson into an order; confirm
    the resulting order's `salespersonId` matches the **quotation's**
    salesperson, not whoever clicked "Convert."

### 28a. Undoing this migration

This migration is additive-only and easy to reverse — one column, two
indexes, one FK:

```powershell
pg_dump -Fc -d <your-database-name> -f backup-before-undo-milestone-11.dump
```

```sql
ALTER TABLE "CustomerOrder" DROP CONSTRAINT "CustomerOrder_salespersonId_fkey";
DROP INDEX "CustomerOrder_salespersonId_idx";
DROP INDEX "CustomerOrder_isDemo_status_idx";
ALTER TABLE "CustomerOrder" DROP COLUMN "salespersonId";
```

Apply it the same way as previous rollbacks (`psql`, a GUI client, or
`npx prisma db execute --file .\rollback-milestone-11.sql --schema
prisma/schema.prisma`), then revert `prisma/schema.prisma` to remove the
same `salespersonId` field/relation/indexes and run `npx prisma generate`
again. Also tell Prisma's migration history about the rollback:

```powershell
npx prisma migrate resolve --rolled-back 20261112080000_add_order_salesperson
```

## 29. Milestone 12: Sales Performance Intelligence

**No new migration this milestone.** Every column and table this
milestone's reporting logic depends on (`CustomerOrder.salespersonId`,
`Quotation.salespersonId`, `AuditEvent.afterData`) already existed after
Milestone 11 — attribution confidence is derived live from them, never
stored. The one schema-adjacent change is that `AuditEvent.afterData`
(already a free-form `Json` column) now sometimes carries a new
`salespersonAssignment` sub-object on `ORDER_CREATE`/`QUOTATION_CREATED`
events; this needs no migration since the column's type never changed.

```powershell
# 1. Regenerate the Prisma client (picks up nothing new in the schema
#    itself, but keeps the client in step with every other milestone's
#    convention of regenerating after a round of changes)
npx prisma generate

# 2. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test

# 3. Confirm a real production build succeeds (the sandbox could not
#    get past its own Google Fonts network block to even reach this
#    phase -- see PROGRESS.md's Milestone 12 honest verification results)
npm run build
```

### Run this milestone's real database acceptance tests

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

This runs the new gated test file, `tests/sales-performance-db.integration.test.ts`,
alongside every pre-existing gated integration test:

- Attribution classification via a real DB round trip — an order with a
  real `salespersonAssignment` provenance record classifies as
  `VERIFIED`; one with none classifies as one of the `UNVERIFIED_*`
  tiers depending on the creator's role at creation time; a quotation-
  converted order is classified from its **source quotation's own**
  event, not its own `ORDER_CREATE` event.
- The full lost-sales confirmation lifecycle (picking → authorize →
  record decision → confirm lost sale) attributed back to the order's
  salesperson and currency via the real `UnfulfilledDemand`/
  `LostSaleRecord` join.
- A `getSalesPerformanceReport` plumbing smoke test — confirms the
  composite report actually assembles without error against a small
  real fixture set.
- The `currency` filter regression test — confirms
  `getSalesRevenueReport` now actually narrows by `SapInvoice.currencyCode`
  (the gap this milestone found and fixed in `lib/reporting/sales-revenue-queries.ts`).

It needs only an `ADMINISTRATOR` user already seeded (same precondition
as every other gated test file in this project). Everything either test
creates is marked `isDemo: true`.

**Honesty note**: this test file, like every gated DB-integration test
in this project, has not been run against a real database from inside
this sandbox — this sandbox's `@prisma/client` is a stale stub (see
PROGRESS.md's "Honest verification results"). It was written to the
same standard as `tests/reporting-db.integration.test.ts` and
independently checked against the real source of every function/field/
signature it calls (`lib/lost-sales/*`, `lib/reporting/*.ts`,
`prisma/schema.prisma`) — including correcting two wrong field names
caught by reading the schema directly (`SapInvoiceImportBatch`'s real
required fields, and `SapInvoice.sapDocNum`/`rawSourceData`, not
`sapInvoiceNumber`) — but treat it as unverified until you actually run
it. The 84 unconditional unit tests added this milestone
(`tests/attribution.test.ts`, `tests/customer-activity.test.ts`,
`tests/sales-revenue.test.ts`, the extended `tests/reporting-filters.test.ts`,
and `tests/m12-acceptance-criteria.test.ts`) have no such caveat: they
were actually run in this sandbox and pass (full suite: 657 passed, 118
skipped, 0 failed).

### Manual test script (via the UI)

1. Log in as a `SALESPERSON` and open `/orders/new`. Confirm the
   **Salesperson** picker starts genuinely blank (no name pre-selected)
   with an explicit "Unassigned" option, rather than defaulting to your
   own name. Submit an order with the picker left blank; confirm the
   created order's `salespersonId` is `null` (check it directly, or
   confirm it does not appear under any salesperson's figures on
   `/reports/sales-performance`).
2. Create a second order, this time explicitly picking a salesperson
   from the dropdown (even if it's yourself). Confirm this order's
   `salespersonId` is set and that, as shown in step 6 below, it
   classifies as `VERIFIED` rather than one of the `UNVERIFIED_*` tiers.
3. Open `/quotations/new`. Confirm the **Salesperson** field also starts
   blank (no longer pre-filled to your own name) and is a required
   dropdown (`Quotation.salespersonId` stays a required DB field).
4. Open the PO-intake review flow (`/orders/intake/[id]/review` for a
   pending intake) and confirm its own Salesperson picker is also
   blank, not pre-filled.
5. Log in as an `ADMINISTRATOR` or `SALES_MANAGER` and open
   `/reports/sales-performance`. Confirm it is **not** visible in the
   Reports index, and the `/reports/sales-performance` URL itself
   redirects away, when visited as a `SALESPERSON`.
6. On the management account, open `/reports/sales-performance` and
   check the **Attribution confidence** table: confirm the order from
   step 2 (explicit pick) counts toward `VERIFIED`, and the order from
   step 1 (left blank) counts toward `UNASSIGNED`.
7. Check the **SAP invoice line value by currency and salesperson**
   table: confirm USD and ZWG (if both exist in your seed data) appear
   as two separate top-level sections, never summed into one total, and
   that the label reads "SAP invoice line value," never "revenue."
8. Check the **Lost sales by salesperson** panel: confirm quantities are
   the headline figures and the estimated-value-by-currency rows are
   clearly marked as estimates, with rows missing an estimate excluded
   from the sum rather than shown as zero.
9. Check the **Quotation-to-order conversion by salesperson** table:
   confirm the rates shown match what you'd get by filtering
   `/reports/pipeline` to that one salesperson directly (same
   underlying `getSalesPipelineReport` call, just run once per
   salesperson here).
10. Apply the new **Currency** filter (type a 3-letter code into the
    free-text field, e.g. `USD`) on `/reports/sales-performance` and
    confirm the revenue and lost-sales-value tables narrow to that
    currency. Apply the new **Lost sale reason** status filter and
    confirm only matching lost-sale rows remain. Click **Export CSV**
    and confirm the download contains all 5 sections (attribution,
    revenue, lost sales, pipeline, summary).

## 30. Milestone 13: Customer Intelligence

**No migration this milestone.** Every table and column this
milestone's reporting logic reads (`SapInvoice`/`SapInvoiceLine`,
`InvoiceClaim`/`ClaimReturn`/`CreditNote`, `Product`, `CustomerOrder`,
`Quotation`, `LostSaleRecord`, `DeliveryRecord`) already existed after
Milestone 12. Both new surfaces are read-only reporting over that
existing data.

```powershell
# 1. Regenerate the Prisma client (no schema change, but keeps the
#    client in step with every other milestone's own convention)
npx prisma generate

# 2. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test

# 3. Confirm a real production build succeeds (the sandbox could not
#    get past its own Google Fonts network block to even reach this
#    phase -- see PROGRESS.md's Milestone 13 honest verification results)
npm run build
```

### Run this milestone's real database acceptance tests

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

This runs the new gated test file,
`tests/customer-intelligence-db.integration.test.ts`, alongside every
pre-existing gated integration test. It needs an `ADMINISTRATOR` user
and at least two seeded customers (`DEMO-CUST-001`/`DEMO-CUST-002`)
already present (same precondition pattern as every other gated test
file in this project) — if either is missing, the file logs which and
self-skips cleanly rather than failing. Everything it creates is marked
`isDemo: true` and cleaned up in `afterAll`. Covered in this file:

- Qualifying-invoice rules at customer-level grouping (cancelled/
  reversed exclusion, no-usable-date exclusion, a fully-credited
  invoice still qualifying) — and that two customers' values never mix.
- The credit-note union path: claim-linked credit notes (via the real
  claim → resolution → approval → manual-credit-note lifecycle) and
  directly invoice-linked credit notes (`claimId: null`, mirroring a
  Milestone 6B CSV-import UNMATCHED row) both counted, verified
  non-double-counting via a cumulative lower-bound assertion against
  seeded demo data.
- Open-claims-count as-of approximation, and historical as-of-date
  reproducibility (a `dateTo` in the past bounds recency correctly even
  when a later invoice exists).
- Product-purchasing query-layer wiring — distinct-invoice frequency
  vs. line count, mixed-unit-of-measure separation, unmatched-product
  retention.
- Returns grouped by `ReturnCondition`, via the real `recordClaimReturn`
  lifecycle (`GOOD_RESALABLE` and `DAMAGED`).
- The management overview's minimum-activity toggle.

**Honesty note**: this test file, like every gated DB-integration test
in this project, has not been run against a real database from inside
this sandbox — this sandbox's `@prisma/client` is a stale stub (see
PROGRESS.md's "Honest verification results"). Treat it as unverified
until you actually run it. The 39 new unconditional unit/access-control
tests added this milestone (`tests/customer-revenue.test.ts`,
`tests/customer-purchasing.test.ts`, `tests/customer-recency.test.ts`,
`tests/customer-segmentation.test.ts`, `tests/customer-intelligence-access.test.ts`)
have no such caveat: they were actually run in this sandbox and pass
(full suite: 696 passed, 131 skipped, 0 failed).

### Manual test script (via the UI)

1. Log in as a `SALESPERSON`. Open `/customers` and click the new
   **"360 profile"** link on any customer's row. Confirm it opens
   `/customers/[id]` without being redirected (all three roles can
   reach this page).
2. On the Customer 360 profile, confirm each section renders: account
   identity; SAP invoice line value by currency; invoice history
   (first/last/frequency/interval); product purchasing table; lost
   sales; commercial health (claims, returns by condition, actual
   credit notes shown both in-period and all-time-cumulative); a
   **separate** "Delivery outcomes" card explicitly labelled
   "operational signal, not a commercial dispute"; orders with
   salesperson attribution; quotations; and a data-quality legend at
   the bottom.
3. Still logged in as `SALESPERSON`, try navigating directly to
   `/reports/customer-intelligence`. Confirm you are redirected to
   `/reports` (the page-level convenience redirect — not the actual
   security boundary, which is server-side on the API route).
4. Log in as a `SALES_MANAGER` or `ADMINISTRATOR`. Open `/reports` and
   confirm the new **"Customer Intelligence"** tile is visible, and
   that it opens `/reports/customer-intelligence` successfully.
5. On the overview, confirm the **Population** toggle defaults to
   "All eligible customers" (every customer shown, including any with
   zero qualifying invoices in the selected period). Click "Only active
   in period" and confirm the customer count in the rankings table
   narrows accordingly, with the query string updating
   (`minimumActivityOnly=true`) and the page number resetting.
6. Confirm the rankings table shows, per customer: SAP invoice line
   value by currency with a rank **within that currency** (never a
   cross-currency rank); purchase frequency with its own rank; days
   since last qualifying invoice with its own rank (or "No qualifying
   invoice on record" where that's genuinely true); and a calculated
   open-claims count. Confirm there is **no** combined score or tier
   column anywhere on this page.
7. Click a customer's name in the rankings table and confirm it links
   through to that customer's own Customer 360 profile (step 2).
8. Click **Export CSV** on the overview and confirm the download
   contains all filtered customers (not just the current page) across
   its 3 sections (customers, revenue-by-currency, summary). Click
   **Export CSV** on a Customer 360 profile and confirm its download
   contains all 8+ profile sections for that one customer.
9. On a customer with at least one invoice claim that has both a
   claim-linked credit note AND a directly-imported credit note (no
   claim) recorded against their invoices, confirm the Customer 360
   profile's "Actual credit notes" figures include both, with no
   value appearing twice, and that these numbers are shown with
   clearly distinct labelling from Milestone 6B/6A's own whole-business
   claim exposure figures elsewhere in the app (they are related but
   not identical — see `docs/milestones/m13-metric-definitions.md` §7).

## 31. Milestone 14: Product Intelligence

**No migration this milestone.** Every table and column this
milestone's reporting logic reads (`SapInvoice`/`SapInvoiceLine`,
`InvoiceClaim`/`ClaimReturn`/`CreditNote`, `Product`, `LostSaleRecord`,
`DispatchRecord`/`DispatchLine`/`DeliveryRecord`/`DeliveryLine`)
already existed after Milestone 13. Both new surfaces are read-only
reporting over that existing data.

```powershell
# 1. Regenerate the Prisma client (no schema change, but keeps the
#    client in step with every other milestone's own convention)
npx prisma generate

# 2. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test

# 3. Confirm a real production build succeeds (the sandbox could not
#    get past its own Google Fonts network block to even reach this
#    phase -- see PROGRESS.md's Milestone 14 honest verification results)
npm run build
```

### Run this milestone's real database acceptance tests

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

This runs the new gated test file,
`tests/product-intelligence-db.integration.test.ts`, alongside every
pre-existing gated integration test. It needs an `ADMINISTRATOR` user
already present (same precondition pattern as every other gated test
file in this project) — if missing, the file logs which and self-skips
cleanly rather than failing. Everything it creates is marked
`isDemo: true` and cleaned up in `afterAll`, in FK-respecting order
(`lostSaleRecord`/`customerDecisionEvent`/`unfulfilledDemand` deleted
**before** `pickingLine`/`pickingSession`, since `UnfulfilledDemand`'s
own FKs onto those two are `onDelete: Restrict`). Covered in this file:

- Dimensions 1–4 (SAP invoice line value by currency, invoiced
  quantity by UoM, invoice frequency, distinct purchasing customers)
  for both a matched product and an unmatched SAP item code — the
  unmatched one never hidden, `productMasterMatched: false`.
- Dimension 5 (lost-sales ranking) via the full real picking →
  authorize → customer-decision → confirm-lost-sale lifecycle,
  verifying `UnfulfilledDemand.sapItemCodeSnapshot`/`productId` are
  captured correctly at the moment of unavailability.
- Dimension 6 (claim/return activity): a single-product claim (via the
  real claim → resolution → approval lifecycle) vs. a multi-product
  claim on a two-line invoice, verifying the inclusive `claimCount` and
  the separate `multiProductClaimCount` bucket.
- Dimension 7 (actual credit-note values): a claim-linked credit note
  on a single-product claim counted correctly per currency; a credit
  note on a multi-product claim excluded from every product's total
  and counted in `unattributableCreditNoteCount` instead.
- Dimension 8 (delivery rejections) — **the one genuinely new risk this
  milestone introduced**: the full real dispatch → depart → deliver
  lifecycle with a partial rejection, verifying both the Product 360
  fulfilment summary and the overview's rejection ranking correctly
  find the rejection through the `DispatchLine.createdAt`-based fix
  (there is no `DispatchRecord.dispatchedAt` field).
- Dimension 9 (declining activity) — a verified 10-day current/previous
  period pair showing a real decline, and a separate test confirming a
  product with zero previous-period activity is never shown as a
  fabricated 100% decline.
- Dimension 10 (master-data quality) — an unmatched item, a matched
  item with no `category`, and a fully-complete item that is correctly
  **not** flagged. No `rank` field appears anywhere on this dimension.
- `getProductProfile`/`getProductById` full assembly, including the
  null-return case for a nonexistent id, and a composite smoke test on
  `getProductIntelligenceOverview` confirming all 10 dimensions are
  present under their own keys with no `compositeScore`/`overallRank`
  field anywhere.

**Honesty note**: this test file, like every gated DB-integration test
in this project, has not been run against a real database from inside
this sandbox — this sandbox's `@prisma/client` is a stale stub (see
PROGRESS.md's "Honest verification results"). Treat it as unverified
until you actually run it. The new unconditional unit/access-control
tests added this milestone (`tests/product-segmentation.test.ts`,
`tests/product-revenue.test.ts`, `tests/product-insights.test.ts`,
`tests/product-commercial-health.test.ts`,
`tests/product-purchasing.test.ts`, `tests/product-intelligence-access.test.ts`,
plus the `tests/reporting-filters.test.ts` fix) have no such caveat:
they were actually run in this sandbox and pass (full suite: 765
passed, 145 skipped, 0 failed).

### Manual test script (via the UI)

1. Log in as a `SALESPERSON`. Open `/products` and click any product's
   row to open its slide-over panel, then click the new **"View full
   product profile"** button. Confirm it opens `/products/[id]` without
   being redirected (all three roles can reach this page).
2. On the Product 360 profile, confirm each section renders: identity
   (including SAP item code and master-data match status); SAP invoice
   line value by currency; invoiced quantity by unit; invoice frequency
   and distinct purchasing customers; lost sales; commercial health
   (claims, returns, actual credit notes by currency); delivery/
   rejection outcomes; and any deterministic insights (or none, if the
   product has too little history).
3. Still logged in as `SALESPERSON`, try navigating directly to
   `/reports/product-intelligence`. Confirm you are redirected to
   `/reports` (the page-level convenience redirect — the real security
   boundary is server-side on the API route).
4. Log in as a `SALES_MANAGER` or `ADMINISTRATOR`. Open `/reports` and
   confirm the new **"Product Intelligence"** tile is visible, between
   the Customer Intelligence and Management Reports tiles, and that it
   opens `/reports/product-intelligence` successfully.
5. On the overview, confirm all 10 dimensions render as separate
   sections, each with its own ranking — confirm there is **no**
   combined score or tier column anywhere on this page, and that the
   10th ("incomplete/unmatched master data") section has no rank
   column at all.
6. Try the new `productCategory`/`productSearch`/`sapItemCode` filter
   fields on the filter bar — confirm each is free text (no fixed
   dropdown) and that all three are optional (leaving them blank still
   returns full results, per Milestone 12's own "optional filter"
   lesson).
7. Click a product's row in any of the overview's ranked tables and
   confirm it links through to that product's own Product 360 profile
   (step 2) — except the 10th dimension's unmatched rows, which have no
   profile to link to.
8. Click **Export CSV** on the overview and confirm the download
   contains all filtered products across all 10 sections (not just the
   current page). Click **Export CSV** on a Product 360 profile and
   confirm its download contains every profile section for that one
   product.
9. On a product with both a single-product claim/credit-note and a
   known multi-product claim touching its SAP item code, confirm the
   inclusive claim count on the overview differs from (is higher than
   or equal to) the attribution-gated credit-note total, and that this
   distinction is documented, not silently reconciled — see
   `docs/milestones/m14-metric-definitions.md` §4.

## 32. Milestone 15: Decision Intelligence

This migration is purely additive: 5 new enum types (`DecisionCategory`,
`DecisionPriority`, `DecisionConfidence`, `DecisionRecommendationStatus`,
`DecisionRecommendationEventType`) and 2 new tables
(`DecisionRecommendation`, `DecisionRecommendationEvent`). No existing
table, column, or enum value is removed or changed. As with every
previous milestone's migration, it cannot be validated or generated in
the build sandbox — run these for real on your machine.

```powershell
# 1. Apply the migration
npx prisma migrate dev --name add_decision_intelligence

# 2. Regenerate the Prisma client so it knows about
#    DecisionRecommendation, DecisionRecommendationEvent, and their
#    5 new enums
npx prisma generate

# 3. Confirm everything else still passes against the real client
npx tsc --noEmit
npm run lint
npm test

# 4. Confirm a real production build succeeds (the sandbox could not
#    get past its own Google Fonts network block to even reach this
#    phase -- see PROGRESS.md's Milestone 15 honest verification results)
npm run build
```

If `prisma migrate dev` reports schema drift because you've been
running against the hand-written SQL already, use `migrate deploy`
instead:

```powershell
npx prisma migrate deploy
npx prisma generate
```

### Run this milestone's real database acceptance tests

```powershell
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

This runs the new gated test file,
`tests/decision-intelligence-db.integration.test.ts`, alongside every
pre-existing gated integration test. It needs an `ADMINISTRATOR` user
already present (same precondition pattern as every other gated test
file in this project) — if missing, the file logs which and self-skips
cleanly rather than failing. **Unlike every other gated test file in
this project, this one's own fixtures are created with `isDemo: false`,
not `isDemo: true`** — documented explicitly in the file's own header
comment and necessary because `evaluateAndSyncDecisionRecommendations`
always forces `includeDemo: false` when generating recommendations, so
an `isDemo: true` fixture would simply never be seen by the rule
engine. Everything this file creates is explicitly deleted in `afterAll`
(events before the parent recommendation, before the synthetic
currency-code credit notes), rather than relying on
`scripts/remove-demo-data.ts`'s normal sweep. Covered in this file:

- Recommendation creation and dedupe-on-regeneration — running
  `evaluateAndSyncDecisionRecommendations` twice against the same
  underlying data produces the same single row (by `dedupeKey`), never
  a duplicate.
- The full lifecycle: self-transition rejection for every status, a
  complete `OPEN → ACKNOWLEDGED → RESOLVED → reopen` walk verifying
  `resolvedAt` is set on `RESOLVED` and cleared on reopen, illegal-
  transition rejection, and full event-history preservation across 5
  events.
- Regeneration-never-resets-lifecycle: a fifth event is added via a
  fresh `ACKNOWLEDGED` call and regeneration is confirmed to add none
  of its own, and to never touch the already-set lifecycle fields.
- Detail/list/overview surfacing of a real persisted recommendation.
- A dedicated proof test for the demo-exclusion rule: seeded demo
  (`isDemo: true`) credit-note data in a synthetic currency never
  produces a `COMMERCIAL_CREDIT_NOTE_BACKLOG_BY_CURRENCY` recommendation,
  while the equivalent non-demo fixture does.

**Honesty note**: this test file, like every gated DB-integration test
in this project, has not been run against a real database from inside
this sandbox — this sandbox's `@prisma/client` is a stale stub (see
PROGRESS.md's "Honest verification results"). Treat it as unverified
until you actually run it. The new unconditional unit/access-control
tests added this milestone (`tests/decision-priority.test.ts`,
`tests/decision-types.test.ts`, `tests/decision-rules.test.ts`,
`tests/decision-recommendations.test.ts`,
`tests/decision-intelligence-access.test.ts`, plus the
`tests/reporting-filters.test.ts` fix) have no such caveat: they were
actually run in this sandbox and pass (full suite: 875 passed, 158
skipped, 0 failed).

### Manual test script (via the UI)

1. Log in as a `SALESPERSON`. Try navigating directly to
   `/reports/decision-intelligence`. Confirm you are redirected to
   `/reports` (the page-level convenience redirect — the real security
   boundary is server-side on the API route).
2. Log in as a `SALES_MANAGER` or `ADMINISTRATOR`. Open `/reports` and
   confirm the new **"Decision Intelligence"** tile is visible, and
   that it opens `/reports/decision-intelligence` successfully.
3. On the overview, confirm the executive summary metric cards, the
   category/priority/confidence breakdowns, and the priority attention
   queue all render, and that the queue contains only CRITICAL/HIGH
   recommendations.
4. Try the new `decisionCategory`/`priority`/`recommendationStatus`
   filter dropdowns on the filter bar — confirm each is a fixed
   enum-backed dropdown (not free text), and that leaving them unset
   still returns the full, unfiltered result.
5. Click a recommendation's row and confirm it opens the detail page
   with its explanation, confidence basis, recommended next action,
   evidence metrics, and any source-record links (Customer/Product/
   Quotation/Order) — confirm each link opens the correct real page.
6. On the detail page, change the recommendation's status (e.g.
   `OPEN → ACKNOWLEDGED`) via the status panel. Confirm the page
   refreshes with the new status and the status-history timeline grows
   by one event. Try an illegal transition is not offered (the panel
   only shows the recommendation's own valid next statuses).
7. Click **Export CSV** on the overview and confirm the download
   contains every filtered recommendation (not just the current
   screen's page).
8. Confirm there is **no** combined score or tier column anywhere on
   either page — every recommendation shows its own independent
   priority and confidence, never a blended number.
9. Trigger a page reload (regenerating the catalogue) on a
   recommendation you changed the status of in step 6. Confirm its
   status, note, and history are unchanged by the regeneration — only
   a fresh rule evaluation that still fires updates its evidence/
   `lastEvaluatedAt`, never its lifecycle state.

## 33. Milestone 16: Production Readiness & Go-live

This is an audit-and-harden milestone, not a feature milestone — there
is no new schema feature to exercise through the UI. What changed on
your machine and needs a real run:

### A dead, out-of-order migration was deleted

`prisma/migrations/20261110140630_add_invoice_reconciliation/` has been
**removed**. It altered a column on `SapInvoiceLine` before the table
existed (the chronologically later
`20261110190000_add_invoice_reconciliation/` migration is the one that
actually creates it) — a fresh `prisma migrate deploy` against any
database that has never seen this project's migrations would have
failed outright on it. **Before running any migration against a real
database, check first whether that specific database already has this
migration applied:**

```powershell
npx prisma migrate status
```

- If the deleted migration does **not** appear as applied, proceed
  normally — `npx prisma migrate deploy` (or `migrate dev` on a fresh
  dev database) will simply never see it, which is correct.
- If it **does** appear as applied on some real database somewhere,
  **do not** just copy this repository's migration folder over —
  resolve it properly instead:

```powershell
npx prisma migrate resolve --applied 20261110140630_add_invoice_reconciliation
```

  then confirm the schema already matches what the later
  `20261110190000_add_invoice_reconciliation` migration would have
  produced (it should, since that is the migration that actually ran
  the real `CREATE TABLE`). See
  `docs/production/DATABASE-BACKUP-AND-RECOVERY.md` §1 for the full
  writeup.

```powershell
# Regenerate the client as usual after any migration-folder change
npx prisma generate
npx tsc --noEmit
npm run lint
npm test
```

### New: a true liveness endpoint

`GET /api/health/live` is new this milestone — unlike the existing
`GET /api/health`, it does **not** touch the database, so it tells you
whether the Node process itself is up even when Postgres is
unreachable. Confirm both locally:

```powershell
npm run dev
# in a second terminal
curl http://localhost:3000/api/health/live
curl http://localhost:3000/api/health
```

`/api/health/live` should return `200` with `status: "alive"` even
before a database connection is configured. `/api/health` additionally
now reports `version`/`buildId`/`environment` — `buildId` will show
`"unknown"` locally unless you set a `BUILD_ID` environment variable,
which is expected and matches what
`docs/production/OPERATIONS-HANDBOOK.md` §3 documents.

### New: site-wide security headers

Open your browser's network inspector against any page (e.g.
`http://localhost:3000/login`) and confirm the response carries
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Content-Security-Policy`, `Strict-Transport-Security`,
`Referrer-Policy`, and `Permissions-Policy`. These are new this
milestone (`next.config.ts`'s `headers()`) — before M16 the only
security header anywhere in the app was a per-route `nosniff` on file
downloads.

### Full validation re-run

```powershell
npm ci
npx prisma generate
npx tsc --noEmit    # expect 674 errors -- see below
npm run lint        # expect clean
npm test            # expect 875 passed / 158 skipped / 0 failed
npm run build
```

The 674 `tsc` errors are **not new** — they are the exact,
category-for-category and file-for-file pre-existing baseline this
milestone's own audit confirmed against every prior milestone's
documentation (see PROGRESS.md's Milestone 16 section). If your real
run (with a working `@prisma/client`, unlike this sandbox's stub)
shows a meaningfully different number, something has changed that
this milestone's audit did not account for — investigate before
assuming it is sandbox noise.

### Where to find the rest of this milestone's work

Nothing else in this milestone needs a manual UI walkthrough — it is
documentation, configuration, and defect fixes. Start with
`docs/milestones/MILESTONE-16-DELIVERY-REPORT.md` for the full
findings and the acceptance matrix, then `docs/production/` for the
detailed reference documents (architecture, environment variables,
security review, backup/recovery, deployment runbook,
rollback/incident response, operations handbook, go-live checklist,
and the UAT plan to actually execute against your own staging
environment before go-live).
