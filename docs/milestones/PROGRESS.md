# Milestone 0 — Progress

Status: **built, and verified against four real-machine runs so far**
(your `git status`/`npm test`/`tsc`/`lint`/`build` output, Node confirmed
**v20.20.2**). The first run found real issues — all fixed, see "Milestone 0
fix" below. The second run, against that fix, came back **fully clean on
`tsc`/`lint`/`npm test` (69/69)** and found exactly one more real,
previously-unknown bug — a `crypto.randomUUID()` prerender error in
`app/orders/new/page.tsx` — now also fixed. See "Milestone 0 fix round 2"
below, including an important correction to this document's own earlier
"Compiled successfully" claim. Round 3 built your six-item "real SAP
catalogue / combinable order intake" instruction against that confirmed-clean
round-2 baseline. The third real run, against round 3, found two real
bugs — a `P2028` transaction-timeout crash in `npm run db:remove-demo`,
and the one remaining pre-existing lint error — both fixed in round 4,
along with an explanation (not a code fix) for that run's 16 `tsc`/`build`
errors and the vitest version question. **The fourth real run, against
round 4 — your manual test script this time, not just the automated
checks — found one more real, previously-unknown bug**: manual-entry order
creation failed with HTTP 500 because `orderDate`/`requestedDeliveryDate`
were passed to Prisma as bare "YYYY-MM-DD" strings, which Prisma's
`DateTime` parser rejects outright. Now fixed in round 5, below, with a
shared conversion helper, 21 new unit tests, a UTC-explicit display fix,
a full codebase audit for the same bug class, and an honest explanation
of why no test before this round could have caught it. One sandbox-only
blocker remains for everything in this repo that depends on a real
generated Prisma client (detailed below), and the sandbox can never reach
the build's static-generation phase at all, by any workaround tried — this
remains true in round 5, unchanged.

## Scope delivered (per your "Approved with changes" instruction)

- Dashboard: real order counts (`total`, `pendingVerification`,
  `awaitingFulfilment`, `completedDeliveries`), demo rows excluded.
- Settings → Users & Roles: real, backed by `/api/users`. User creation is
  administrator-only. Workspace/Processing/Notifications panels are
  unchanged prototype, as approved.
- Stock and Reports: **untouched**, still visibly labelled demo/prototype.
- Orders UI (`/orders`, `/orders/[id]`, `/orders/new`): wired to the real
  Order APIs in the "Milestone 0 fix" round below, per your explicit
  instruction — real list/detail/create, a real order-lines editor, and
  real PO file upload. The fake verification/pricing/approval workflow that
  used to live on the detail page (no backing API this milestone —
  `ProductVerification`/`PriceDecision`/`OrderApproval` have no routes yet)
  was removed and replaced with an honest "not built yet" notice rather
  than left as non-functional interactive UI. See CHANGES.md for the
  per-file detail.
- `isDemo: false` by default on every model that gets seeded data
  (`User`, `Customer`, `CustomerLocation`, `Product`, `CustomerOrder`,
  `OrderLine`); every seeded row is `isDemo: true`; real reports/queries
  (`listOrders`, `getDashboardOrderCounts`) exclude demo rows by default;
  `npm run db:remove-demo` is the one-command removal script.
- `proxy.ts` is optimistic-only (redirect-if-no-cookie); every route
  handler, Server Action, and the dashboard Server Component re-checks
  authorization itself via `lib/auth/current-user.ts`, directly against the
  database, on every request.
- CSRF protection (`SameSite=Lax` + `Origin`/`Referer` check) on every
  cookie-authenticated mutating route, with tests.
- Seeded admin password comes from `SEED_ADMIN_PASSWORD` (env var, never
  hardcoded), `mustChangePassword: true` forces a change at first login. No
  default password exists anywhere in this zip.
- Storage directory is `STORAGE_LOCAL_DIR`, an absolute path meant to live
  outside the project folder, configured in `.env.local` (git-ignored).
- `POST /api/orders/[id]/documents` — original PO upload through the
  storage layer with content-type sniffing, a 20MB size limit, a checksum,
  and an audit event; download via the authorized `GET /api/files/[id]`.
- `SETUP-WINDOWS.md` — PowerShell execution-policy notes, exact migration
  and seed commands, how to undo the migration. Round 3 adds a 12-step
  manual, non-developer test script covering the real catalogue import and
  all three order-intake modes below.
- **Round 3**: `prisma/seed.ts` no longer creates any placeholder products —
  demo orders now look up real, already-imported SAP products
  (`isDemo: false`) and skip gracefully if the catalogue hasn't been
  imported yet. New Order (`/orders/new`) now supports three **combinable**
  intake modes on one order — manual lines via a catalogue search (by SAP
  code, name, or barcode), pasted PO text/message (new
  `CustomerOrder.originalSourceText` column, additive migration), and
  multiple uploaded PO files — with zero manual lines now a valid,
  intentional state for the latter two. See CHANGES.md's "round 3" section
  for full per-file detail.

## Build / lint / typecheck / test results — reported honestly

This section now covers four real runs plus round 5's sandbox results:
what your first real-machine run confirmed or contradicted, the sandbox
results after that fix round, what your second real-machine run (against
that fix) confirmed, contradicted, and found newly, round 3's own sandbox
results, your third real run against round 3 (two real bugs, fixed in
round 4, plus two things explained rather than fixed), round 4's own
sandbox results, your fourth real run against round 4 — this time
including the manual test script, not just the automated checks — which
found one more real bug (below), and round 5's own sandbox results
(not yet real-machine-confirmed).

### Milestone 0 fix round 5 — your fourth real run (manual test script), and this round's response

- **Real bug, fixed**: manual-entry order creation (manual test script
  step 5) failed with HTTP 500 —
  `Invalid value for argument 'orderDate': premature end of input.
  Expected ISO-8601 DateTime.` `orderDate`/`requestedDeliveryDate` were
  passed to Prisma as bare "YYYY-MM-DD" strings; Prisma's `DateTime`
  parser requires a full ISO-8601 datetime (with a time component) or a
  `Date` object, never a bare date. New `lib/dates.ts` converts
  "YYYY-MM-DD" to UTC midnight before either field reaches
  `tx.customerOrder.create()` (`lib/orders.ts`), and the inverse for
  reading one back out. `lib/order-validation.ts`'s own date-shape check
  now shares the same, stricter validity check (see below) instead of its
  own weaker one.
- **A second, latent bug caught while building this fix, not reported by
  you**: the pre-existing Zod validation for `orderDate`/
  `requestedDeliveryDate` would have accepted "2026-02-30" as valid —
  JS's `Date` constructor silently rolls invalid calendar days forward
  (to 2 March) instead of rejecting them, and the old check only tested
  for `NaN`, which that rollover never produces. `lib/dates.ts`'s
  `isValidDateOnlyString` catches this by round-tripping the parsed date
  back to a string and requiring an exact match; `lib/order-validation.ts`
  now uses it.
- **UI fix (your item 3)**: `lib/order-display.ts`'s `formatOrderDate` —
  used by both `/orders` and `/orders/[id]` — now passes
  `timeZone: "UTC"` explicitly. Without it, a date stored as UTC midnight
  displays as the *previous* calendar day for any viewer west of UTC.
  `formatOrderDateTime` (real timestamps — receivedAt, document uploads,
  status-history entries) is deliberately untouched: local-time display
  is correct there, not a bug.
- **Codebase audit (your item 2)**: confirmed `orderDate`/
  `requestedDeliveryDate` are the *only* `@db.Date` fields in the entire
  schema, and the only date-only string accepted by any validator in the
  project. Every other `DateTime` field is a real timestamp set via
  `new Date()`/`now()` in code, never from a user string. Customers,
  locations, product import, and stock have no date-only input fields at
  all. `prisma/seed.ts` sets both fields to a literal `null` (unaffected).
  There is no order-editing endpoint yet (`app/api/orders/[id]/route.ts`
  is `GET`-only), so `createOrder()` was and remains the only write path.
  One similar-looking pattern was found and deliberately left alone:
  `app/reports/page.tsx` has the same "no explicit UTC" shape, but
  Reports is explicitly out-of-scope demo/prototype data — fixing it
  would have been unauthorized scope creep. See CHANGES.md's round-5
  section for the full file-by-file list of what was checked.
- **Tests (your item 4)**: `tests/dates.test.ts` — 21 new, unconditional
  unit tests against the new helper directly (including the exact date
  from your bug report, a leap year, the same date in a non-leap year,
  and the Feb-30-style rollover bug above). **A real-database integration
  test was also added** — `tests/orders-db.integration.test.ts`, which
  genuinely calls `createOrder()` against a real database with your exact
  payload shape — but it's off by default everywhere, including on your
  machine, because this sandbox's `@prisma/client` stub throws when
  merely constructed (same limitation as always), so every Prisma import
  in that file is a dynamic, in-test-body import specifically so the
  suite can be skipped here without crashing `npm test`. Run it on your
  machine with `RUN_DB_INTEGRATION_TESTS=1 npm test` (after `npm run
  db:seed` has run at least once). A short manual check is also given in
  CHANGES.md as a no-env-var alternative.
- **Why this wasn't caught before (your item 5)**: explained in full in
  CHANGES.md's round-5 section. Short version: the existing tests
  validate the Zod *schema* shape, never actually call `createOrder()`,
  so none of them ever reach the Prisma call where this fails; and
  Prisma's generated type for a `DateTime` field is `Date | string`,
  which cannot distinguish "a full datetime string" from "a bare date
  string" at the type level, so `tsc` had structurally nothing to flag —
  this is a runtime value-format bug, not a type bug.
- **Verification this round**: full-project `npx tsc --noEmit` error
  count unchanged at 56 (same pre-existing Prisma-stub root cause; zero
  new errors in any file this round touched or added). `npm run lint`
  fully clean. `npm test`: **78 passed, 1 skipped** (was 73 passed last
  round; +21 from `tests/dates.test.ts`; the new integration test
  registers as skipped, not run, here, exactly as designed).

### Milestone 0 fix round 4 — your third real run, and this round's response

- **Real bug, fixed**: `npm run db:remove-demo` crashed with `P2028`
  ("Transaction already closed... timeout 5000ms, however 5315ms passed")
  on the 8th of 12 sequential deletes in its interactive transaction,
  against your pooled Neon endpoint. `scripts/remove-demo-data.ts` now
  passes `{ timeout: 60_000, maxWait: 10_000 }` to `prisma.$transaction()`.
  Deletes stay sequential (not parallelized) — Prisma's own docs warn
  against concurrent queries sharing one interactive-transaction
  connection, and a timeout is a safer failure mode than a connection race.
  Scope re-confirmed unchanged: every delete is still `isDemo: true` or
  relation-scoped to a demo row.
- **Real bug, fixed**: the one pre-existing `@typescript-eslint/no-explicit-any`
  error in `app/products/import/page.tsx` (`readJson(): Promise<any>`),
  flagged every round since round 1 but never asked for until now. Replaced
  with a named `ApiResponseBody` envelope type; the two success-path casts
  became `as unknown as Preview` / `as unknown as ImportResult`. `npm run
  lint` is now **fully clean** for the first time across all four rounds.
- **Explained, not a code bug**: the 16 `tsc`/`build` errors in your paste
  all trace to one cause — the generated `@prisma/client` TypeScript types
  on your machine don't yet include `originalSourceText` (confirmed: your
  own `migrate deploy` output shows the round-3 migration is already
  applied to the database — it's specifically the *generated client* that's
  stale, not the schema or the database). This is expected, not a defect:
  [Prisma's docs](https://docs.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production)
  state `migrate deploy` "does not reset the database or generate artifacts
  (such as Prisma Client)" — `prisma generate` is a separate, required step
  whenever `schema.prisma` changes, and nothing in your paste shows it being
  run after the round-3 schema update. **Fix: run `npx prisma generate`,
  then re-run `tsc`/`build`.** Nothing in this zip addresses this because
  there's nothing in the repository to fix.
- **Explained, not a code bug**: you asked which vitest version
  `package.json` specifies and whether `npm install` is needed. Checked
  directly: `package.json` and `package-lock.json` both already specify
  `4.1.12`, correctly, in this delivery. Your run printing "RUN v5.1.0"
  means the vitest actually sitting in your `node_modules` right now is
  still 5.1.0 — `npm install` is the step that syncs `node_modules` to what
  the manifest/lockfile say, and nothing in your paste shows it having run
  since the earlier downgrade. See CHANGES.md's round-4 section for the
  full reasoning, including an honest note on an earlier round's
  "5.1.0 was never going to run on Node 20.20.2" claim versus your run's
  73/73 clean pass under v5.1.0 — the registry-confirmed `engines` mismatch
  is real, but `engines` is advisory, not an execution block, so this
  round's clean run doesn't contradict that engines data, it just means
  this particular run didn't hit whatever crashed before.
- **Verification this round**: `npx eslint app/products/import/page.tsx`
  clean; `npx tsc --noEmit` grepped for that file's path, zero matches (and
  the full-project error count is unchanged at 56, confirming nothing new
  was introduced); `npm run lint` fully clean project-wide; `npm test`
  57/57 (plus the one known sandbox-only import failure, unchanged).

### Milestone 0 fix round 3 — sandbox results

- **`tsc --noEmit`: 56 errors** (up from 55) — the one new error is
  `RecordStatus` joining the already-documented "`@prisma/client` has no
  exported member" line in `prisma/seed.ts`, same root cause as every other
  error in this count. Zero errors in any file this round's logic actually
  touched.
- **`npm run lint`: clean**, except the same one pre-existing,
  untouched-this-round error in `app/products/import/page.tsx`.
- **`npm test` (Vitest): 57/57 non-`order-validation` tests pass**;
  `order-validation.test.ts` still fails to *import* here for the same
  sandbox-only reason. **Important, reported plainly rather than glossed
  over**: this round's schema change (order lines no longer require a
  minimum of 1) made one of that file's *existing* tests assert the
  now-wrong behaviour — `"rejects a payload with zero order lines"`
  expected `success: false`. Caught during my own review before delivery,
  not from your feedback (you haven't run this round yet). Fixed: that
  test now expects `success: true` and is renamed to explain why; five new
  tests were added alongside it. `order-validation.test.ts` is now 16
  tests (was 12), bringing the real total to **73** once this runs on your
  machine, not 69 — see CHANGES.md's round-3 section for the arithmetic.
- **`npm run build`**: same result as round 2's "Compiled successfully" at
  the Turbopack stage, then the same TypeScript-phase stop on the 56-error
  set above — the sandbox still cannot reach "Generating static pages" by
  any workaround (see "Sandbox-only blocker" below, unchanged). Your next
  real `npm run build` is what actually confirms this round's pages build
  end to end, same caveat as round 2's `crypto.randomUUID()` fix.

### What your second real run confirmed vs. contradicted

- **`tsc`: confirmed. 0 errors.** Matches this document's prediction exactly.
- **`lint`: confirmed.** Clean except the one pre-existing,
  untouched-this-milestone error in `app/products/import/page.tsx`.
- **`npm test`: confirmed. 69/69 passing** — `http` (20),
  `order-validation` (12), `csrf` (7), `rate-limit` (8), `content-sniff`
  (12), `password` (10). Confirms the vitest downgrade, the rewritten test
  file, and the `testTimeout` fix all hold up for real.
- **`build`: a genuine miss, caught and fixed.** Reached further than any
  previous run — past "Compiled successfully", past the TypeScript phase,
  into "Generating static pages" — and failed there with a
  `crypto.randomUUID()` prerender error in `app/orders/new/page.tsx`. Fixed
  this round; see CHANGES.md item 9. This is also the occasion for a
  correction to this document's own previous claim — see "Sandbox-only
  blocker" below, which now describes a harder limit than previously stated.
- **One transient infrastructure note, not a code issue**: `npx prisma
  migrate deploy` hit `P1001: Can't reach database server` against your
  Neon database, then `npx prisma migrate status` succeeded moments later.
  Reads as a one-off network/cold-start blip, not something this delivery
  changed anything for. Flagging it rather than staying silent, per usual
  practice here, not because it's believed to be a real problem.

### What your real run confirmed vs. contradicted

- **`tsc`: confirmed.** You saw 0 real errors once `prisma generate` ran —
  exactly matching this document's prediction that the (then) 51 sandbox
  errors were 100% attributable to the Prisma stub and would resolve
  themselves on a real machine.
- **`lint`: confirmed.** Your output matched the pre-existing error list
  this document predicted, same files, same lines.
- **`build`: partially confirmed, partially a genuine miss.** The Google
  Fonts block was correctly sandbox-only, as predicted. But the build then
  surfaced **two real, previously-unknown problems** that the sandbox could
  never have caught — the font block itself prevented the sandbox's build
  from ever reaching the page-data-collection/static-generation phase where
  they occur, even with the diagnostic font-swap experiment, which only got
  as far as the Prisma-stub wall. Both are now fixed — see "Milestone 0
  fix" below for the detail, including a first attempt at one of them that
  was itself wrong and caught before delivery.
- **`npm test`/Vitest: a genuine mistake on my part, not a sandbox
  limitation.** Vitest 5.1.0 was never going to run on your Node 20.20.2 —
  it requires Node 22.12+/24+/26+. This masked a real test bug and a real
  (if minor) test-timing gap behind a reporter crash instead of showing
  them plainly. This is on me, not the sandbox (which runs Node 22 and
  never would have hit this). Fixed — see below.

### Tests: `npm test` (Vitest), after the fix round

```
Test Files  1 failed | 5 passed (6)
     Tests  57 passed (57)
```

Same shape as before, now on `vitest@4.1.12` (Node-20-compatible) instead of
the broken `5.1.0`. 57 real tests pass across 5 files; `order-validation.test.ts`
still fails to **import** here, for the same sandbox-only reason (below) —
it now has 12 tests (rewritten from 2, see CHANGES.md), so the real total on
your machine is **69**, not 59. See CHANGES.md's "Test count, reconciled"
section for the exact arithmetic.

Any test needing a real `PrismaClient` instance is still not in this zip,
for the same reason as before — see "Open items" below for the same
recommended list, unchanged.

### Lint: `npm run lint`

Clean in everything touched this round. The pre-existing `app/orders/[id]/page.tsx`
and `app/orders/new/page.tsx` lint errors mentioned in the original version
of this document no longer apply — both files were rewritten this round and
are now clean. Four **new** real lint errors (`react-hooks/set-state-in-effect`)
were introduced while writing the new orders pages, caught by running
`npm run lint` before delivery, and fixed — see CHANGES.md, "Milestone 0
fix", item 7. One pre-existing error remains, in a file this round did not
touch: `app/products/import/page.tsx` (one `@typescript-eslint/no-explicit-any`).

### Type check: `tsc --noEmit`

55 errors (up from 51) — all still the one root cause: `@prisma/client`
exists in this sandbox only as a stub (see "Sandbox-only blocker" below).
The 4 new ones are in the rewritten `app/orders/[id]/page.tsx`
(implicit-`any` on `.map()` callback parameters whose element type comes
from `getOrderById()`'s Prisma-derived return type) — the exact same
category already present in `lib/order-queries.ts` itself for the same
fields. Zero errors in any file this round touched for any other reason.

### Build: `npm run build`

Still blocked by the sandbox's Google Fonts network block, as before — but
with that worked around (the same diagnostic font-swap, reverted before
delivery; `app/layout.tsx` is byte-identical to before the experiment),
**Turbopack now reports "Compiled successfully"**, with the build failing
only at the TypeScript check phase, on the same 55-error Prisma-stub set
above. Both real, previously-unknown build errors this fix round found
(the health-check route, and the `/orders/[id]` Suspense error) are
confirmed gone at the compile stage — see CHANGES.md for the detail,
including a first fix attempt that was wrong and was caught before
delivery by actually running the build against it.

## Sandbox-only blocker (will not occur on your machine)

**Prisma client could not be generated here.** `prisma generate` needs
`binaries.prisma.sh`, which this sandbox's network allowlist blocks. The
`@prisma/client` stub that ships without it only exports a `PrismaClient`
class that throws if constructed, and a minimal `Prisma` object with no
schema-derived enums or namespace types. This is the single root cause
behind every `tsc` error, the TypeScript-check build failure, and the one
test file that fails to import. **Now confirmed resolved on your machine for
`tsc`, `lint`, and `npm test`** (your second real run: 0 tsc errors, lint
clean, 69/69 tests) — the one remaining unconfirmed piece is the build's
later phases, addressed below.

**Correction, made honestly rather than quietly:** this document previously
said the build was "still blocked by the sandbox's Google Fonts network
block... with that worked around, Turbopack now reports 'Compiled
successfully'" and presented that as meaningful build verification. That
undersold how little it actually proved. "Compiled successfully" is
Turbopack's bundling stage — it says nothing about the later "Generating
static pages" (prerendering) stage, which is exactly where this round's
real `crypto.randomUUID()` bug lived (see CHANGES.md item 9), and which the
sandbox has now been confirmed, not just suspected, to be unable to reach
**at all**, through two different diagnostic workarounds:

1. Font block worked around (as before) → build proceeds to the TypeScript
   phase, then stops on the same Prisma-stub `tsc` errors reported above.
2. Stacking a second workaround on top (`typescript.ignoreBuildErrors: true`
   in `next.config.ts`, tried only as a diagnostic and reverted — never
   shipped, since silently hiding real type errors would be worse than the
   problem it works around) gets past that wall, but immediately hits a
   harder one in "Collecting page data": the `@prisma/client` stub doesn't
   just fail type-checking, it **throws when actually constructed**
   (`new PrismaClient()`, in `lib/prisma.ts`), and nearly every API route
   constructs it at module scope. There is no further workaround for that
   short of generating a real Prisma client, which this sandbox cannot do.

So: no claim in this document, past or future, about the build's
static-generation/prerendering phase should be read as sandbox-verified.
What *is* verified in-sandbox is Turbopack's compile stage, `tsc` standalone,
`lint`, and `vitest` — all of which were actually run against this round's
fix with zero regressions. Whether `/orders/new` passes "Generating static
pages" can only be confirmed by your next real `npm run build`.

The Google Fonts block is a separate, independent sandbox-only limitation —
not something to fix in code, and already confirmed irrelevant on your
machine (your build reached the font step and every error beyond it, real
or sandbox-only, without issue from fonts specifically).

## Open items — not resolved, deliberately

- **"Quantity keyed by staff" is still an open assumption, not confirmed.**
  Per your explicit instruction, this stays open until confirmed with
  invoicing, regardless of anything in any source document that might
  otherwise suggest it. `OrderLine.requestedQuantity` is keyed as entered;
  nothing in this milestone resolves or assumes an answer either way.
- **Node version: now confirmed** — v20.20.2, via your `node -v` output.
  `engines.node: ">=20.9.0"` in `package.json` already covers this.
- **Product verification, pricing and approval are not built yet.** The
  order detail page says this plainly now (see the orders-pages table in
  CHANGES.md) instead of showing non-functional interactive UI for it.
  `ProductVerification`/`PriceDecision`/`OrderApproval` exist in the schema
  with no API routes — flagging this as the next real piece of order
  workflow, not assuming it's covered.
- **`awaitingFulfilment` in the dashboard counts is a best-effort mapping**,
  not a confirmed business definition: `getDashboardOrderCounts()` counts
  orders where `status = APPROVED AND handedToSapAt IS NULL`, because the
  schema has no dedicated "fulfilled" status yet. Flagging this now rather
  than presenting it as settled.
- **In-memory rate limiting** (`lib/auth/rate-limit.ts`) works correctly
  for a single server process (tested — see `tests/rate-limit.test.ts`) but
  resets on restart and isn't shared across multiple instances. Fine for
  now; would need a shared store (Redis or similar) before running behind
  more than one app process.
- **Integration tests against a real database are not in this zip** — see
  "Tests" above for exactly which ones I'd recommend adding first once
  `prisma generate` works on your machine.
- **`npm run build`'s static-generation phase is still not sandbox-verified
  for `/orders/new` (or anything else).** The `crypto.randomUUID()` fix this
  round follows Next's own documented pattern exactly and is confirmed clean
  by `tsc`/`lint`/`vitest`, but — as explained in "Sandbox-only blocker"
  above — this sandbox cannot reach that build phase at all, by any
  workaround tried. Your next real `npm run build` is what actually confirms
  this fix, not anything in this zip.
- **The transient Neon `P1001` error** seen during `prisma migrate deploy`
  self-resolved on your immediate retry (`migrate status` succeeded).
  Flagged, not acted on — nothing here suggests it's a recurring problem,
  but worth a second look if it happens again without clearing up.
- **The "lines OR text OR file" guard for a non-empty order submission
  lives client-side only, by design, not oversight.** `createOrderSchema`
  (server) accepts zero lines unconditionally; `validateClientSide()`
  (client) is what actually requires at least one of a started line,
  pasted text, or a selected file. This is because a file-only order must
  be created (with zero lines, zero text) *before* the file can be
  uploaded to it — the documents endpoint needs an order id to attach to.
  If a stronger server-side guarantee is ever wanted (e.g. a background
  job that flags/cancels an order left with nothing attached after some
  time), that's a new, separate piece of work, not something this round
  does implicitly.
- **Test count is 94 once round 5 runs on your machine** (73 confirmed
  last round + 21 new, unconditional tests in `tests/dates.test.ts`), plus
  1 more — `tests/orders-db.integration.test.ts` — only if you opt in with
  `RUN_DB_INTEGRATION_TESTS=1`. See CHANGES.md's round-5 section for the
  reconciliation and why that one test is opt-in.
- **Resolved, confirmed by your round-4 real run**: the Prisma Client
  regeneration and vitest-sync items flagged after round 3 are both
  confirmed fixed on your machine — your round-5 report states `prisma
  generate`, `tsc`, `lint`, 73/73 tests, and `build` all passed cleanly
  against round 4. Left here, struck through in spirit rather than
  deleted, so the history of what broke and what fixed it stays visible:
  ~~Prisma Client needs regenerating (`npx prisma generate`)~~ and
  ~~`node_modules/vitest` needs syncing via `npm install`~~ — both done.
- **The new real-database integration test is opt-in, not run by
  default, even on your machine.** `tests/orders-db.integration.test.ts`
  needs `RUN_DB_INTEGRATION_TESTS=1 npm test` to actually run (and
  `npm run db:seed` to have been run at least once first) — a plain
  `npm test` reports it as skipped, not run, which is expected, not a
  regression. See CHANGES.md's round-5 section for why it's opt-in and
  the short manual check as a no-env-var alternative.
- **`app/reports/page.tsx` has the same "no explicit UTC" date-parsing
  shape** as the bug fixed this round (`new Date(\`${date}T00:00:00\`)`,
  then formatted without pinning to UTC), on a locally-constructed mock
  date. Deliberately not fixed — Reports remains explicitly out-of-scope
  demo/prototype data, not a real `orderDate` value — but flagged here in
  case Reports becomes real in a future milestone, so this isn't
  rediscovered from scratch then.

# Milestone 1 — Progress (Master data from SAP)

## Scope delivered

Exactly the scope from your Master Build Prompt's real Milestone 1
("Master data from SAP"), per your corrected definition — not the
pricing/approval workflow I incorrectly proposed first:

- Four preview-then-confirm importers: tax codes, item-master extension
  (unit/pack size/variable-weight/VAT code), price lists (per
  customer/group, with validity dates and currency), customer master
  (SAP code, TIN, VAT number, currency, price list, terms, contacts,
  addresses, branch, store code).
- `Product` and `Customer` schema extensions to hold the above.
- Documented CSV layouts + sample files, grounded in your two real
  attachments (the actual SAP item export and invoice `HRE580108`),
  so your SAP administrator has an exact target to produce.
- A catalogue health report against your real 7,540-row item export.
- Your stated acceptance test, run literally end-to-end at the logic
  level: item `0228`, 10 × 0.45 USD PNT = 4.50, VAT 0.00 — matches
  invoice `HRE580108` exactly.

See CHANGES.md's "Milestone 1" section for the full file-by-file list.

## Build / lint / typecheck / test results — reported honestly

- **`npm run lint`**: clean. Found and fixed one real issue along the
  way — `app/catalogue/health/page.tsx` was calling `setState`
  synchronously inside a `useEffect` body; fixed by deferring through
  `Promise.resolve().then(...)`, matching the pattern already used in
  `app/orders/page.tsx`.
- **`npx vitest run`**: 125 passed, 1 skipped (the pre-existing opt-in DB
  integration test, same as every prior round), 1 failed —
  `tests/order-validation.test.ts`, confirmed pre-existing and unrelated
  to this milestone (see below).
- **`npx tsc --noEmit`**: did the comparison properly rather than
  asserting it. A fresh, untouched copy of the round-5 baseline produces
  56 error lines in this sandbox, entirely in pre-existing files, all
  caused by the stub `@prisma/client` (see "Sandbox-only blocker" below
  — unchanged since round 1). This round's working copy produces 67.
  The 11-line delta is entirely in the two new files that do the
  heaviest Prisma querying (`lib/customer-master-import.ts`,
  `lib/price-list-import.ts`), and every one of those 11 lines is the
  same `TS7006`/`TS2339` shape (implicit-any callback parameter; property
  missing on `{}`) as the 56 pre-existing ones — no new error category
  introduced. This is the same sandbox-only blocker, not new defects.
- **`npx prisma generate` / `npx prisma validate` / `npx prisma migrate
  dev`**: still cannot run in this sandbox (network-restricted — `403
  Forbidden` fetching from `binaries.prisma.sh`, same as every prior
  round). The migration for this round
  (`prisma/migrations/20261109090000_add_sap_master_data/migration.sql`)
  was therefore hand-written, matching your existing migrations' naming
  conventions exactly (verified against all four prior migration files
  before writing this one). **You must run `npx prisma generate` and
  apply the migration for real on your machine** — see
  SETUP-WINDOWS.md's new section 11 — before any of this milestone's
  code can execute against a database.
- **`npm run build`**: not attempted in this sandbox, same reason as
  every prior round (this sandbox cannot reach that build phase at all).
  Your next real `npm run build` is what confirms this.

## Sandbox-only blocker (unchanged since round 1 — confirmed again this round)

Same blocker as every prior round, confirmed directly this time rather
than assumed: `node_modules/.prisma/client/default.d.ts` and
`index.d.ts` type the entire generated client as `any`
(`export declare const PrismaClient: any`, `export declare type
PrismaClient = any`, `Prisma.TransactionClient = any`), with zero real
model or enum exports — not `OrderStatus`, not `RecordStatus`, not the
four models this milestone adds. This is why `tsc` flags implicit-`any`
callback parameters and `{}`-typed query results throughout the
codebase, old files and new alike, and why
`tests/order-validation.test.ts` crashes on `z.nativeEnum(OrderSource,
...)` — `OrderSource` simply isn't exported by this stub. None of this
reflects a real code defect; it resolves identically to every other
instance of it the moment you run `npx prisma generate` for real.

## Open items — not resolved, deliberately

- **No real tax-code or price-list SAP export was ever provided.** Those
  two CSV layouts (`docs/sap-exports/tax-codes.csv.md` and
  `price-lists.csv.md`) are my own design, written per your Master Build
  Prompt's own instruction to document a layout "so my SAP administrator
  can produce them" — not a layout confirmed against a real SAP export,
  unlike the item-master and customer-master layouts, which are grounded
  in your real item CSV and invoice respectively. Flagging this plainly:
  these two need your SAP administrator's sign-off before they're
  trusted as final.
- **"One SAP customer code = one physical store" is confirmed for exactly
  one case** (`HREC0D677` = TM Chinhoyi North, from your invoice), not
  generalized. Whether every customer code in your real export maps this
  same way, or whether some customers have multiple stores under one
  code, is still open — the customer-master importer's `storeCode` field
  supports either answer, but doesn't assume one.
- **VAT varies per item — confirmed, not assumed.** The `TaxCode` table
  is a real lookup, and `Product.vatCode` is a plain string (same
  pattern as `sapItemCode`), not a flat constant, specifically so a
  future item with a different rate from `0228`'s 0% doesn't need a code
  change to support.
- **Item codes and customer codes are text, always — re-confirmed this
  round.** 999 of the real export's 7,540 codes start with a zero;
  every parser in this milestone keeps codes as strings end-to-end, with
  a dedicated test (`"preserves a leading-zero CODE as text, never
  coercing to a number"`) guarding it.
- **Pack size and unit cannot come from the existing item export —
  confirmed, not assumed.** Your real export has exactly 4 columns
  (`CODE, ITEM DESCRIPTION, BARCODE, ITEM GROUP`); there is no unit,
  pack-size, VAT, or price data in it at all. I deliberately did not
  build text-parsing of the 7,540 inconsistently-formatted description
  strings to guess at this — that would be unreliable in a way that's
  hard to detect after the fact. The item-master-extension CSV is a
  wholly separate export your SAP administrator needs to produce.
- **The catalogue-health numbers are a live read of your real catalogue,
  not a one-time snapshot.** They'll change as the item-master import
  fills in `unitOfMeasure`/`vatCode` on more products — "items without a
  unit/VAT code" is expected to trend toward zero as that import is run
  against your real item-master-extension export, not a bug if it
  doesn't start at zero.
- **PO → SAP lines (killing the retyping) is explicitly next, not
  started.** This milestone only lays the master-data foundation
  (units, VAT, prices, customer/price-list linkage) that an order-line
  preview needs to show a real unit/price/VAT/total — it does not yet
  build that preview itself. The acceptance test in this round
  (`tests/acceptance-item-0228.test.ts`) proves the data is all there and
  chains correctly; wiring it into an actual order-line entry screen is
  the next milestone's work.

## Milestone 1 fix (round 2 — real tsc/build failure, now fixed and verified)

Your real `npx prisma generate` and `npx prisma migrate dev --name
m1_master_data` both succeeded cleanly. `npm run lint` was clean. `npx tsc
--noEmit` and `npm run build` both failed with 4 real `TS2322` errors — one
per new importer — none of which this sandbox could have caught (see
"Sandbox-only blocker" above): the broken stub client accepts anything for
a Json field, so the real structural check Prisma's generated client
performs is invisible here until compiled for real.

**Root cause, confirmed by direct reproduction against Prisma's real
runtime types** (not guessed): four named `interface` declarations
(`ExistingTaxCodeSnapshot`, `ExistingItemMasterSnapshot`,
`ExistingCustomerMasterSnapshot`, `ListDefinition`) were each embedded
unmodified into an `AuditEvent.afterData` Json payload. A named `interface`
is not structurally assignable to Prisma's `InputJsonObject` (which
requires a string index signature) even when every field it declares is
already JSON-safe; a `type` alias for the identical shape is assignable,
with no cast needed. See CHANGES.md's "Milestone 1 fix (round 2)" for the
full explanation and why `lib/product-import.ts` was never exposed to this.

**Fixed**: the four declarations changed from `interface` to `type`,
nothing else. Verified with four standalone reproductions built from each
file's exact real type shapes, importing Prisma's actual (non-stub)
`InputJsonValue` type directly from `node_modules/@prisma/client/runtime/library.d.ts`
— each one now compiles clean; each one reproduced your exact error before
the fix. This sandbox's own `tsc`/`lint`/`vitest` were re-run after the fix
and are unchanged from before it (67 sandbox-only error lines, same 11-line
delta as before — removing the `interface`s didn't add or remove any
sandbox-only noise; 125 passed/1 skipped/1 pre-existing-unrelated failure).

**Open**: your next real `tsc --noEmit` and `npm run build` are what
actually confirm this fix — this sandbox cannot generate a real client to
verify it directly, only the isolated type-level reproduction above, which
is as far as verification can go without your machine.
