# Fix Report — Personnel/Vehicle Status-Change TypeScript Errors

## 1. Root cause (identical in both files)

`prisma/schema.prisma` declares `statusChangedById` as a genuine nullable
scalar FK column on both `Personnel` and `Vehicle`, backing a named relation:

```prisma
statusChangedById String?
statusChangedAt   DateTime? @db.Timestamptz(6)
statusChangedBy   User?     @relation("PersonnelStatusChanger", fields: [statusChangedById], references: [id], onDelete: Restrict)
```

(Same shape on `Vehicle`, relation named `"VehicleStatusChanger"`.)

For a model with a declared relation like this, Prisma Client generates
**two different update-input types**:

- `Prisma.PersonnelUpdateInput` ("checked") — exposes the relation only as a
  nested-write object (`statusChangedBy?: { connect?: ...; disconnect?: ...; ... }`),
  **not** the raw FK scalar.
- `Prisma.PersonnelUncheckedUpdateInput` — exposes the raw FK scalar
  (`statusChangedById?: string | null`) directly, bypassing the relation.

Both files declared their `data` object against the **checked** type:

```ts
const data: Prisma.PersonnelUpdateInput = {};   // lib/personnel.ts:126
const data: Prisma.VehicleUpdateInput = {};     // lib/vehicles.ts:122
```

...and then assigned the raw scalar anyway:

```ts
data.statusChangedById = actorId;   // not a member of the checked type
```

This type-checks as an error only once a real generated `@prisma/client` is
present — this sandbox's own stub client types most Prisma-derived objects
as `{}`/`any`-ish, so the distinction between the checked and unchecked
update-input shapes never surfaces here. It is entirely consistent with
`FINAL-IMPLEMENTATION-REPORT.md`'s own finding (delivered immediately before
this fix) that this sandbox's 760 `tsc` errors are a different, broader
category (missing/empty Prisma namespace members) — this TS2551 pair is not
among them, and was invisible until checked against a real generated
client, exactly as reported.

## 2. Exact correction made in each file

**`lib/personnel.ts`, inside `updatePersonnel`'s status-change branch:**

```diff
  data.status = input.status;
- data.statusChangedById = actorId;
+ data.statusChangedBy = { connect: { id: actorId } };
  data.statusChangedAt = new Date();
```

**`lib/vehicles.ts`, inside `updateVehicle`'s status-change branch:**

```diff
  data.status = input.status;
- data.statusChangedById = actorId;
+ data.statusChangedBy = { connect: { id: actorId } };
  data.statusChangedAt = new Date();
```

No other line in either file was touched. `actorId` is a required,
non-nullable `string` parameter on both `updatePersonnel`/`updateVehicle`,
so `connect: { id: actorId }` is always well-formed here — there is no
code path in either function where the status-change branch runs without a
real actor, so no null/undefined handling for the relation was needed.

## 3. Why this is compatible with the schema and the generated client

`connect: { id: actorId }` is the standard Prisma nested-relation write for
a to-one relation on the "checked" update input — it sets the same
underlying `statusChangedById` column that the direct scalar assignment
would have, through the type-safe path the schema's relation declaration
is designed for. It requires no schema change, no migration, and produces
the identical row in the database: a `User.id` value in the
`statusChangedById` column. This was verified both by reasoning about
Prisma's generated-type contract and directly against this codebase's own
existing test, `updatePersonnel records statusChangedById/At only when
status actually changes` in `tests/settings-db.integration.test.ts`, which
reads the persisted value back with `prisma.personnel.findUniqueOrThrow()`
(no `select`, so every scalar column including `statusChangedById` comes
back) and asserts `afterChange.statusChangedById === adminId` — that
assertion is unchanged and is not affected by switching the write from a
scalar assignment to a relation `connect`, since both produce the same
column value. `onDelete: Restrict` on the relation is also unaffected —
`connect` does not alter delete-behavior semantics, it only performs the
write.

Only one gap existed: `Vehicle`'s equivalent status-change path had no
regression coverage proving the same thing for `updateVehicle`. A second,
symmetrical test — `updateVehicle records statusChangedById/At only when
status actually changes` — was added immediately after the existing
`updateVehicle` tests in the same file, mirroring the Personnel test
exactly (no-op status change leaves `statusChangedAt` null; a real change
stamps both `statusChangedById` and `statusChangedAt`). This is the only
test file touched, and the only test added.

## 4. Verification commands actually executed

```powershell
npx prisma generate
npx prisma validate
npx tsc --noEmit
npx eslint lib/personnel.ts lib/vehicles.ts tests/settings-db.integration.test.ts
npx vitest run
npx next build
```

(`npm run lint` and `npm run build` map to `eslint`/`next build` in this
project's `package.json`; the commands above were run directly to scope the
lint check to the touched files and to capture `next build`'s raw output.)

## 5. Actual results of each verification

- **`npx prisma generate` / `npx prisma validate`:** both failed in this
  sandbox with `Error: Failed to fetch sha256 checksum at
  https://binaries.prisma.sh/... - 403 Forbidden`. This is the same
  sandbox-network-allowlist block documented in every prior report in this
  engagement (`binaries.prisma.sh` is not reachable from here) — it is not
  a consequence of this fix, and `app/layout.tsx`/`prisma/schema.prisma`
  were not touched. **This means the primary acceptance criterion below
  (`tsc --noEmit` against a real generated client) could not be
  independently re-verified end-to-end in this sandbox** — only reasoned
  about from the schema and Prisma's documented type-generation rules,
  plus the absence of any `statusChangedById`-related error in this
  sandbox's own `tsc` run (see below). **This must be re-run against the
  real generated client in the user's own Windows environment before this
  fix is considered fully proven**, per the acceptance criterion in the
  task.
- **`npx tsc --noEmit`:** ran against this sandbox's stub `@prisma/client`
  (the only client available here). Result: 760 errors, identical in every
  bucket (464 TS7006 / 126 TS2694 / 104 TS2339 / 42 TS2305 / 9 TS2345 / 9
  TS2322 / 6 TS18046) to the count in `FINAL-IMPLEMENTATION-REPORT.md`,
  delivered immediately before this fix — meaning **zero new errors and
  zero regressions**, and critically, **zero occurrences of
  `statusChangedById` anywhere in the output** (checked directly with
  `grep -n "statusChangedById"` — no matches). Because this sandbox's stub
  client never surfaced the original TS2551 pair in the first place (see
  §1), this result confirms the fix introduces no new problem but cannot,
  on its own, confirm the original two errors are gone in a real
  environment — that confirmation can only come from running `tsc --noEmit`
  in the user's own Windows setup, which is why it remains the task's
  stated primary acceptance criterion.
- **`npx eslint lib/personnel.ts lib/vehicles.ts tests/settings-db.integration.test.ts`:**
  clean — 0 errors, 0 warnings.
- **`npx vitest run`:** 60 test files passed, 950 tests passed, 25 files /
  208 tests skipped, 0 failures. The skipped count is exactly 1 higher than
  this engagement's last report (207 → 208) — the one new
  `updateVehicle` status-change test, which correctly self-skips via this
  project's existing `describe.skipIf(!RUN_DB_INTEGRATION_TESTS)` convention
  (no live Postgres instance is reachable from this sandbox). It has not
  executed against a real database in this session; run
  `RUN_DB_INTEGRATION_TESTS=1 npx vitest run` against a real database to
  exercise it, alongside the existing Personnel test in the same file.
- **`npx next build`:** failed with 2 errors, both
  `next/font: Failed to fetch Geist[...] from Google Fonts` on
  `app/layout.tsx` — the same `fonts.googleapis.com` sandbox-network block
  documented in every prior report in this engagement. `app/layout.tsx` was
  not touched by this fix, and the failure occurs during root-layout
  module evaluation, before the build reaches any file this fix changed.
  Not run successfully in this sandbox for the same reason as every prior
  milestone's build attempt; this should be re-run on a machine with normal
  internet access before relying on it.

## Files changed

- `lib/personnel.ts` (1 line)
- `lib/vehicles.ts` (1 line)
- `tests/settings-db.integration.test.ts` (one new test added, mirroring an
  existing one; nothing else in the file was changed)
