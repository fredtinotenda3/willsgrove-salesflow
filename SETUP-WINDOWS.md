# Windows Setup — Milestone 0

Written for PowerShell on Windows. Commands assume you're in the project
root unless noted.

## 0. Prerequisites

- **Node.js >= 20.9.0** (Next.js 16's own minimum — see
  `docs/milestones/PROGRESS.md` re: your actual version still being
  unconfirmed). Check with:
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

## 9. Undoing the migration

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
