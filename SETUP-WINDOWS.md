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
