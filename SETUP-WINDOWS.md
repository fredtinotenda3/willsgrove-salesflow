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
