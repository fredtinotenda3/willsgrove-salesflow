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
- A small set of clearly-labelled demo products, customers, and orders
  (all `isDemo: true`), built by calling the same `createCustomer()` /
  `createOrder()` functions the real API uses.

Safe to re-run — it upserts by natural key rather than inserting
duplicates.

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
`isDemo: false`) or any real data you've created since.

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

4. **Create a real order.** Go to Orders → "Receive New Order".
   - Pick "Upload Document" and choose any PDF or image file on your
     computer (or pick "Paste Message" and type a couple of lines
     instead — either is fine for this test).
   - Search for and select a customer (the demo data seeded a handful —
     type a few letters of a name to find one).
   - Fill in at least one order line: a product description, a quantity
     (e.g. `10`), and a unit (e.g. `KG` or `EA`). Leave everything else
     blank.
   - Click "Submit Order".
   - ✅ You land on an "Order Received" screen showing a real order
     reference like `ORD-20261107-A1B2C3D4`.
   - ✅ If you attached a file, it says "Document uploaded successfully"
     (give it a few seconds first — it shows "Uploading document..."
     while that's in progress).

5. **Find the order in the list.** Go back to Orders.
   - ✅ The order you just created is in the list, with the right
     customer name and reference.
   - ✅ Its status reads "Received" and its amount reads **"Pending
     pricing"** — that's correct, not a bug. Pricing and approval are a
     later milestone, not built yet.
   - ✅ The four summary cards at the top of this page now include your
     new order in their counts.

6. **Open the order.** Click its reference (or the eye icon) to open the
   detail page.
   - ✅ You see an amber notice explaining that verification/pricing/
     approval isn't built yet — this is an honest "not built" notice,
     not an error.
   - ✅ Your line item is listed with the quantity and unit you entered.
   - ✅ If you attached a document in step 4, it's listed with a
     "Download" button — click it and confirm the file you originally
     uploaded downloads correctly (same file, opens fine).
   - ✅ "Status History" shows one entry: "Order Received", with your
     name and the current date/time.

7. **Confirm Stock and Reports are still clearly demo.** Open each from
   the sidebar.
   - ✅ Both are still visibly labelled as demo/prototype data — they are
     **not** wired to the real database in this milestone, by design.

8. **Log out and back in.** Use the sidebar's user menu to log out, then
   log back in with the **new** password you set in step 1 (not the
   original seeded one).
   - ✅ This confirms the password change really was saved, and that
     logging in and out works correctly.

If every step above matched its ✅, the real, non-demo parts of this
milestone (login, forced password change, user management, order intake
with a real file upload, and the order list/detail views) are working
end to end against your real database.

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
