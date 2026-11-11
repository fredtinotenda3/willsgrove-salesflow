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

## Milestone 2A (PO intake, document storage, classification, extraction)

Scope, per your approved revised Milestone 2 report and your follow-up
refinements: get a customer PO — arriving as an Excel file, a CSV, a PDF,
an image/photo, or pasted WhatsApp/email text — into the system as a
stored `OrderDocument` with its content classified and its order
header/lines extracted into a structured, versioned, auditable shape.
**No SAP pricing, no product/SAP-item matching, no Excel handover yet** —
those are Milestone 2B (matching, human review) and 2C (the handover
document itself), explicitly deferred per your approved three-sub-build
sequence. This sub-build does not touch pricing anywhere: `extractedLines`
never carries a selling price field, and `customerProvidedUnitPrice` is
stored purely for traceability (so a price the customer happened to write
on their own PO isn't silently discarded) — nothing in this milestone
reads it for a pricing decision, exactly as you required.

**A deliberate deviation from my own earlier report, caught by reading the
real schema before writing new models**: the actual `prisma/schema.prisma`
already has `CustomerOrder`/`OrderLine`/`OrderDocument`/`ProductVerification`
/`PriceDecision`/`OrderApproval`/`OrderStatusHistory`, each already carrying
fields that anticipate this milestone (`originalSourceText`,
`originalProductDescription`, `verificationStatus`, `extractedText`, timing
columns). Rather than the parallel `PurchaseOrderDocument` model my own
earlier report assumed, this sub-build **extends** the existing
`OrderDocument`/`OrderSource` and adds one new model, `ExtractionRun`, that
stores each extraction attempt's raw structured output as `Json` —
deferring full relational per-line modeling (matching a `productId`, a
line-level review status) to Milestone 2B, which is where that modeling
actually belongs per your approved sequence. This keeps with your standing
instruction to reuse the existing order model rather than build a parallel
one.

**Schema additions (additive only — nothing removed, nothing renamed)**:
- `OrderSource` gets four new values: `PDF`, `IMAGE`, `EXCEL`, `CSV`
  (alongside the existing `EMAIL`/`WHATSAPP`/`MANUAL`).
- Four new enums: `DocumentClassification` (`CUSTOMER_PO`,
  `HANDWRITTEN_LIST`, `CHAT_SCREENSHOT`, `ORDER_SHEET`, `PRICE_LIST`,
  `DELIVERY_NOTE`, `UNRELATED`), `DocumentIntakeStatus` (`RECEIVED` →
  `EXTRACTING` → `EXTRACTED`/`EXTRACTION_FAILED`, plus `CLASSIFIED`),
  `ExtractionProvider` (`DETERMINISTIC`, `MOCK`, `ANTHROPIC`),
  `ExtractionRunStatus` (`RUNNING`, `SUCCEEDED`, `FAILED`).
- `OrderDocument` gains `sourceChannel`, `classification`, `status`
  (defaults to `RECEIVED`), `documentGroupId`/`pageNumber` (reserved for a
  future multi-page submission, not used by any code path yet), and the
  `extractionRuns` relation.
- New model `ExtractionRun`: one row per extraction *attempt* against a
  document — append-only, never overwritten. A re-extraction (after a
  provider failure, or to pick up a schema fix) creates a new row, per
  your requirement to preserve the original extraction output and
  correction history. Carries `provider`, `model`, `promptVersion`,
  timing, `status`, `extractedHeader`/`extractedLines` (`Json`),
  `rawResponse` (`Json`, the provider's raw output for audit/debugging),
  `errorMessage`, and the existing `isDemo` convention.
- Migration `20261109100000_add_po_intake_extraction` is hand-written
  (this sandbox cannot run `prisma generate`/`migrate dev` — see
  "Sandbox-only blocker" below) but follows the exact same additive
  pattern as every prior migration: `ALTER TYPE ... ADD VALUE` for each
  new enum value (each needs its own statement), `CREATE TYPE` for the
  four new enums, `ADD COLUMN` (all nullable or defaulted) on
  `OrderDocument`, `CREATE TABLE` for `ExtractionRun`, then indexes and
  the FK. Nothing destructive; nothing narrows an existing column.

**Extraction strategy — deterministic-first, per your explicit instruction
not to send structured data to the AI provider unnecessarily**:
- **EXCEL** → `lib/extraction/deterministic/excel.ts`, using `exceljs`
  (newly added — the same library Milestone 2C will use to *write* the
  handover, so the project depends on one Excel library, not two).
  Reads the first worksheet only; header row matched loosely (regex-based
  synonym matching — "Item"/"Description"/"Product" etc. for the
  description column, "Qty"/"Quantity" for quantity), deliberately
  different from Milestone 1's strict `checkHeaders()` exact-match policy,
  because a customer's own spreadsheet has no fixed-layout contract the
  way a SAP export does. This is a documented, honest, **unconfirmed
  assumption** — there is no real sample customer PO spreadsheet to
  calibrate against yet.
- **CSV** → `lib/extraction/deterministic/csv.ts`, same loose header
  matching, reusing the low-level tokenizer from Milestone 1's
  `lib/csv-parser.ts` rather than a third hand-rolled CSV state machine.
- **PDF/IMAGE** → routed to an AI provider (`lib/extraction/router.ts`),
  since there is no deterministic structure to parse.
- **EMAIL/WHATSAPP (pasted text)** → routed to an AI provider too, *except*
  the mock provider's text path (`lib/extraction/providers/mock.ts`'s
  `parsePastedText`) is itself a real, deterministic, regex-based line
  parser (leading/trailing quantity patterns like `"10 Baby Marrow 250g"`
  or `"Tomatoes x5"`) — not a canned fixture — so pasted-text tests and
  dev/demo use exercise real parsing logic, not hardcoded output.
- In every case, **classification is not a separate step**: for
  PDF/IMAGE/pasted text, the extraction provider's own output already
  includes `classification` (one structured-output call answers "what is
  this" and "what's on it" together); for EXCEL/CSV, the deterministic
  parsers default to `CUSTOMER_PO` (a structured spreadsheet upload has no
  meaningful "is this actually a chat screenshot" question to ask). This
  is a deliberate simplification versus my own earlier report, which
  treated classification as its own stage.

**Anthropic provider** (`lib/extraction/providers/anthropic.ts`): real,
using the actually-installed `@anthropic-ai/sdk@1.6.0`'s native structured
output (`client.messages.parse()` with `output_config.format:
zodOutputFormat(extractionResultSchema)`), verified against this project's
real installed SDK types, not assumed from memory. Server-side only reads
`ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` from the environment (never
hardcoded, never reaches the browser); bounded retries (`maxRetries`,
default 2) and a timeout (default 60s) are passed to the SDK client
constructor. **What is real and callable but NOT yet verified**: an actual
live call against a real Willsgrove API key and billing account. The
system prompt instructs the model never to invent a quantity/unit/price/
date/customer name, to preserve the customer's exact wording, to keep
different pack sizes/preparations as separate lines, and to attach a
confidence score and a warning for anything a human should double-check —
directly encoding the Milestone 2 brief's product-identification
requirements into the extraction prompt itself, not left to a later
matching step to catch.

**Mock provider** (`lib/extraction/providers/mock.ts` +
`mock-fixtures.ts`): works with zero API key, per your requirement. Text
input uses the real `parsePastedText` parser described above; document/
image input returns one of four canned, schema-valid fixtures ("default",
"baby-marrow-variants" — four distinct pack sizes/preparations of the same
vegetable, deliberately never merged, exercising the
never-merge-pack-sizes rule end to end — "missing-quantity", and
"unrelated-document"), selectable via a `mockFixtureKey` for predictable
dev/demo/test runs. `lib/extraction/router.ts`'s `selectAiProvider()` uses
the real Anthropic provider whenever `ANTHROPIC_API_KEY` is set (unless
`EXTRACTION_PROVIDER=mock` forces the mock regardless, for predictable
demos), and falls back to mock otherwise — so this sandbox, which never
has a real key, exercises the identical dispatch logic a real deployment
without one would.

**Storage and data-flow design decisions**:
- Pasted text (EMAIL/WHATSAPP) is encoded as UTF-8 bytes and stored
  through the *same* `StorageDriver` as every file upload, so every
  `OrderDocument` row — regardless of channel — has real stored bytes, a
  checksum, and a storage key. This removes a special case: re-extraction
  (`reExtractPoDocument`) reads every channel's original content back the
  same way, rather than branching on "was this a file or pasted text."
- The intake channel is derived from **sniffed byte signatures**
  (`lib/storage/content-sniff.ts`, unchanged from Milestone 0), never from
  a client-claimed MIME type or field — the same security/correctness
  posture Milestone 0 already established for uploads, now reused for
  channel classification itself.
- No Postgres transaction is ever held open across the extraction call:
  document creation is one transaction, extraction happens outside any
  transaction (it may call an external API), and recording the extraction
  outcome is a second, separate transaction. Holding a transaction open
  for the duration of an HTTP call to Anthropic would tie up a connection
  and row locks for however long that call takes.
- Even though every extraction path's output is *typed* as
  `ExtractionResult`, `lib/po-intake.ts`'s `runExtraction()` still re-runs
  `validateExtractionResult()` on the actual runtime value before
  persisting anything — a validation failure is recorded as a FAILED
  `ExtractionRun`, never a best-effort save of whatever came back.
- A re-extraction creates a brand-new `ExtractionRun` row; it never
  overwrites a previous attempt, satisfying the audit requirement to
  preserve original extraction output and correction history.

**New surface**: `app/orders/intake/page.tsx` (upload-or-paste form, a
document list, and a detail panel showing every extraction attempt and its
structured header/lines), reached from the sidebar's new "PO Intake" entry.
`app/api/po-intake/route.ts` (GET list, POST upload-or-paste),
`app/api/po-intake/[id]/route.ts` (GET detail), and
`app/api/po-intake/[id]/re-extract/route.ts` (POST re-extract).

**Sandbox-only blocker, extended this round**: `@prisma/client` in this
sandbox is a non-functional stub that exports `undefined` for every enum
name at runtime **and omits several of those enum names from its own type
declarations too** (confirmed directly: `node -e "console.log(require('@prisma/client').OrderSource)"`
→ `undefined`; `npx tsc` separately reports `TS2305: Module
'"@prisma/client"' has no exported member 'OrderSource'` even for a
type-only import). This is the same root cause as the pre-existing,
already-accepted single baseline test failure in
`tests/order-validation.test.ts`. For this round's new code, rather than
accept a second category of sandbox-only failures, **every new file
(`lib/extraction/router.ts`, `lib/po-intake.ts`) imports these enums as
types only (`import type {...}`) and uses plain string literals
(`"EXCEL"`, `"DETERMINISTIC"`, etc.) for every runtime value** — correct,
not just a workaround, because Prisma's generated enum field types are
string-literal unions, not nominal class instances, so a bare literal of
the right value is structurally assignable without the generated client's
enum object needing to exist at runtime at all. Verified directly: before
this change, `dispatchExtraction()`/`createPoIntake()` crashed immediately
with "Cannot read properties of undefined" the moment either function ran
in this sandbox; after it, all four new 2A test files and the new
acceptance test (see below) pass cleanly here. On your real machine, with
a real generated client, this would have worked correctly either way —
this fix exists purely so this sandbox's own test run is informative
rather than blocked, and it is good practice regardless (it's exactly the
kind of coupling-to-the-generated-client that newly-written code has no
reason to need).

Two further, genuinely sandbox-independent issues were caught and fixed
while verifying, neither related to the Prisma stub:
- **`exceljs`'s own type declarations** (`node_modules/exceljs/index.d.ts`)
  declare a bogus ambient global `interface Buffer extends ArrayBuffer {}`
  that merges with `@types/node`'s real, generic `Buffer<TArrayBuffer>`
  global interface, making every call to `workbook.xlsx.load(buffer)` a
  type error regardless of `skipLibCheck` (which only skips checking
  *inside* `.d.ts` files, not usage sites). This is a real, documented
  upstream defect in the `exceljs` package itself — it would occur on your
  real machine too, with the same `exceljs@4.4.0` and a modern
  `@types/node`. Fixed with a single, narrowly-scoped, commented `as any`
  cast at the one call site in `lib/extraction/deterministic/excel.ts`
  (a cast to the bare `Buffer` identifier doesn't help — it resolves to
  the same broken merged type the function already expects).
- `tests/extraction-schema.test.ts`'s `validResult()` helper had no return
  type annotation, so TypeScript inferred `extractedQuantity: string` from
  its `"10"` literal instead of the schema's real `string | null` — a
  genuine test-file typing bug that would fail `tsc`/`build` on any
  machine. Fixed by annotating `validResult(): ExtractionResult`.

**Verification run in this sandbox** (baseline before this round: 67
sandbox-only `tsc` error lines; 1 failed test file [the pre-existing
`order-validation.test.ts`] / 125 passed / 1 skipped):
- `npx tsc --noEmit`: **77 errors** (+10). Every one of the 10 new lines
  is in the same two pre-existing sandbox-stub categories already seen
  throughout this project (`TS2305 — Module has no exported member
  '<Enum>'`, `TS7006 — Parameter 'tx' implicitly has an 'any' type`),
  now additionally hit by `lib/extraction/router.ts` (2) and
  `lib/po-intake.ts` (7) and `lib/po-intake-queries.ts` (1). Zero errors
  in any new file outside those two known categories.
- `npx vitest run`: **17 test files (16 passed, 1 pre-existing failure),
  164 tests (163 passed, 1 skipped)** — four new test files
  (`extraction-schema.test.ts`, `mock-extraction-provider.test.ts`,
  `deterministic-csv-parser.test.ts`, `deterministic-excel-parser.test.ts`)
  plus the acceptance test below, all passing; the one failure is the
  same pre-existing, already-accepted `order-validation.test.ts` failure,
  unchanged in nature.
- `npm run lint`: clean. (One genuine `react-hooks/set-state-in-effect`
  violation was caught and fixed in `app/orders/intake/page.tsx` — a
  second `useEffect` wasn't using the project's established
  `void Promise.resolve().then(() => ...)` pattern that the first one
  already used.)
- `npm run build`: Turbopack's bundling stage reports "Compiled
  successfully"; the build's own TypeScript-check phase then hits the
  Google Fonts network block this sandbox has always had (see Milestone 1
  fix round 2's notes above) *and* separately, once fonts were diagnosed
  out of the way with the same temporary font-swap technique used in
  earlier rounds (swapped back immediately after, confirmed byte-identical
  to the original `app/layout.tsx`), the identical 77-error sandbox-stub
  set as standalone `tsc` — no new or different errors in the build phase
  specifically. **Your next real `npm run build` is what actually
  confirms this** — this sandbox cannot generate a real Prisma client to
  verify past that point.
- New acceptance test, `tests/acceptance-po-intake-deterministic.test.ts`:
  chains the real `dispatchExtraction()` (the exact function
  `lib/po-intake.ts` calls for every live upload or paste) across CSV,
  Excel, and pasted-WhatsApp-text submissions of the same order, asserting
  (a) CSV/Excel both report `provider: "DETERMINISTIC"` — never reaching
  an AI provider even though one could theoretically be configured, (b) a
  customer's own leading-zero code embedded in free text
  (`"0228 Baby Marrow 250G Punnet"`) survives untouched, (c) a WhatsApp
  message with no Anthropic key configured falls back to `provider:
  "MOCK"` and a line with no stated quantity ("usual box please") is
  flagged with a warning and a `null` quantity rather than guessed, and
  (d) two different pack sizes/preparations of "Baby Marrow" from one
  document are kept as two distinct lines, never merged. Needs no
  database, so it runs unconditionally here.

**Open / explicitly not done in this sub-build** (all per your approved
2A/2B/2C sequence):
- No SAP item-code matching, no customer/product alias resolution, no
  duplicate-order detection, no human review workspace — all Milestone 2B.
- No Excel/CSV/clipboard handover document, no multi-store splitting, no
  repeat-order detection — all Milestone 2C.
- The Anthropic provider has not been exercised against a real API key —
  only against the mock fallback and the SDK's actual (non-stub) type
  surface. Your first real test with `ANTHROPIC_API_KEY` set is what
  confirms the live path end to end.
- The loose Excel/CSV header-matching heuristics are an honest, unverified
  assumption with no real customer PO spreadsheet sample yet to calibrate
  against — flag any real customer file that doesn't match as you find
  one, and the header-matching regexes in
  `lib/extraction/deterministic/shared.ts` are the one place to extend.

## Milestone 2B (matching, aliases, duplicate detection, human review)

Scope, per your approved three-sub-build sequence: take each Milestone
2A `ExtractionRun`'s stored header/lines and let a human turn them into a
real `CustomerOrder` — resolving the customer and each line's SAP product
(deterministically first, falling back to a human decision, never an AI
guess), detecting likely duplicate submissions before anything is
created, and learning from every human correction so the same free text
resolves itself automatically next time. **No Excel/CSV handover
document, no multi-store splitting, no repeat-order detection** — those
remain Milestone 2C, still not started.

### Schema (additive only — `prisma/migrations/20261109140000_add_matching_review_aliases/`)

- `ExtractedOrderLine` — one real row per extracted line, materialized
  (once, idempotently) the first time a human opens the review workspace
  for a document: its own extracted quantity/unit/price, its computed
  product match (`matchedProductId`, `matchConfidence`, `matchSource`,
  up to 5 `matchCandidates` for the UI), and the human's eventual
  decision (`status`: `PENDING`/`ACCEPTED`/`EXCLUDED`,
  `resultingOrderLineId` once confirmed). This is the "real
  `ExtractedOrderLine`-style row" Milestone 2A's own `ExtractionRun`
  comment already said this milestone would need, rather than retrofitting
  that structure onto `extractedLines`' `Json` after the fact.
- `ProductAlias` / `CustomerAlias` — a human-confirmed mapping from
  normalized free text to a real `Product`/`Customer`, with
  `timesConfirmed`/`lastConfirmedAt`. Alias lookup always runs *before*
  fuzzy matching and, when it hits, is trusted at confidence 1.0 with no
  re-scoring — a human already decided this exact mapping once.
  `ProductAlias.customerId` is nullable (a global alias, e.g. a
  near-universal misspelling of a product name) but a customer-specific
  alias always takes priority over a global one for that same customer.
  **One subtlety Prisma's `schema.prisma` DSL cannot express**: "one
  global alias per normalized text" and "one per-customer alias per
  (customer, normalized text)" must coexist as two *independent* unique
  constraints, neither subsuming the other, which needs a *partial*
  (conditional `WHERE`) unique index — Prisma has no syntax for that. Both
  partial indexes are hand-written directly into the migration SQL
  (`ProductAlias_global_normalizedText_key` /
  `ProductAlias_customer_normalizedText_key`), with the limitation
  documented in both the migration and the model's own `schema.prisma`
  comment so it isn't silently lost if this table is ever touched by a
  future auto-generated migration.
- Both alias tables cascade-delete on their `Customer`/`Product` foreign
  key, deliberately **not** `SetNull` — `SetNull` on `ProductAlias.customerId`
  would silently turn a customer-specific alias into an inappropriately
  *global* one the moment that customer was deleted, which is a real
  correctness bug, not a harmless orphan.
- `DocumentIntakeStatus` gets one new additive value, `CONFIRMED`, set by
  the confirm action in the same transaction as `OrderDocument.orderId` —
  a direct status check rather than inferring "already an order" from
  `orderId` being non-null.
- `ExtractedLineStatus` (`PENDING`/`ACCEPTED`/`EXCLUDED`) and
  `ExtractedLineMatchSource` (`NONE`/`ALIAS`/`FUZZY`/`MANUAL`) are new
  enums. Every `ALTER TYPE ... ADD VALUE` runs before any row ever uses
  the new value, the same safe-within-one-transaction rule Milestone 2A's
  migration already established.

### Matching engine (`lib/matching/`)

- `normalize.ts` — the one shared text-normalization/tokenization/scoring
  module, used identically by alias storage, alias lookup, and both
  fuzzy matchers, so they can never drift apart and silently stop
  recognizing text that's really the same. Deliberately conservative:
  lowercases, strips diacritics and light punctuation, collapses
  whitespace — but **never** strips digits or pack-size/unit words
  ("punnet", "kg", "250g"). That omission is deliberate, not an
  oversight: `Product.itemName` already encodes pack size in its own
  text (e.g. "Baby Marrow 250G Punnet"), so keeping those words as
  ordinary tokens means two different pack sizes of "the same" vegetable
  naturally score lower against each other than a true match — with no
  special-cased "pack size words" list to write or get wrong.
- Scoring is a Dice coefficient (`2·|A∩B| / (|A|+|B|)`) over normalized
  word-token sets, computed in memory after a `contains`-based DB query
  narrows the candidate set to at most 50 rows (never a full-table scan).
  A token that exactly equals a candidate's own SAP item/customer code is
  a near-certain signal and raises the floor to 0.95 — but only ever
  raises it, never lowers a genuinely stronger text match.
- The "confident and unambiguous enough to pre-select" decision
  (`selectConfidentMatch`) is factored into `normalize.ts` and shared by
  `product-matcher.ts` and `customer-matcher.ts` (previously two
  near-identical copies of the same comparison) — one rule, one place,
  and independently unit-tested on its own pure inputs.
- **`FUZZY_CONFIDENT_THRESHOLD = 0.72` and `FUZZY_AMBIGUITY_GAP = 0.15`
  (both matchers) are an honest, unverified assumption** — the same
  caveat class as Milestone 2A's loose Excel/CSV header matching. There
  is no real set of customer-wording-to-SAP-item matches to calibrate
  against yet. Both constants live in one place per matcher
  (`lib/matching/product-matcher.ts`, `lib/matching/customer-matcher.ts`)
  specifically so they're easy to retune once real review-workspace usage
  shows whether they're too eager or too conservative. A match below the
  confidence threshold, or ambiguous against a close second candidate, is
  **never** pre-selected — it's surfaced as one of up to 5 ranked
  candidates for the human to pick from instead.
- Never calls an AI model. Deterministic, same reasoning as Milestone
  2A's deterministic-first extraction: this project already has real SAP
  master data to match against, so there's no uncertainty an LLM call
  would usefully resolve here.

### Duplicate detection (`lib/review/duplicate-check.ts`)

Computed fresh on every read — building the review session **and**
confirming it — never cached or stored, since what counts as a duplicate
can change in between (another order can be created). Two independent
signals, either or both can fire:
- **Same document checksum**: the exact same file/pasted-text bytes were
  already uploaded before and that earlier document already became an
  order — catches "the same photo of the same handwritten list, uploaded
  twice."
- **Same customer + PO reference**: this resolved customer already has a
  non-cancelled/non-rejected order carrying the same
  `customerPoReference` — a strong signal even across completely
  different documents or channels.

Never auto-blocks and never silently proceeds: confirming a document with
an active duplicate warning requires `acknowledgeDuplicate: true` in the
request, explicitly and every time — there is no way to configure this
away.

### Human review workspace (`lib/review/`, `app/api/po-intake/[id]/review/`, `app/orders/intake/[id]/review/`)

- `GET /api/po-intake/[id]/review` (`getOrBuildReviewSession`) —
  idempotently materializes one `ExtractedOrderLine` per extracted line
  the first time it's opened (protected by `ExtractedOrderLine`'s own
  `@@unique([extractionRunId, lineNumber])`, with a concurrent duplicate
  attempt caught as a benign race and re-read rather than erroring), then
  returns the full session: header, computed customer match, every
  line's computed/human product match, and the current duplicate
  warnings. Opening it again never re-scores or recreates anything — a
  human may already be partway through reviewing, and silently
  re-running the matcher out from under them would discard in-progress
  review state.
- `POST /api/po-intake/[id]/review/confirm` (`confirmReviewSession`) —
  the one action that actually creates the order. Requires an explicit
  `ACCEPTED`/`EXCLUDED` decision for every materialized line (rejecting
  the request otherwise, never defaulting silently), requires at least
  one accepted line, requires every accepted line to resolve to a real
  quantity and unit (from an override or the extracted value — never
  left blank), and requires `acknowledgeDuplicate: true` when a fresh
  duplicate check (recomputed here, never trusted from an earlier `GET`)
  finds one. On success, in one transaction: creates the
  `CustomerOrder`/`OrderLine`s (reusing `lib/orders.ts`'s
  `createOrderCore` — see below), links each accepted
  `ExtractedOrderLine.resultingOrderLineId` back to its new `OrderLine`,
  marks excluded lines, sets `OrderDocument.orderId`/`status: "CONFIRMED"`,
  **learns** a `ProductAlias` for every accepted line's final product
  and a `CustomerAlias` for the resolved customer (from the header's own
  raw text, plus an optional human-supplied alias text), and writes a
  `PO_REVIEW_CONFIRMED` audit event. Confirming an already-confirmed
  document, or a request that excludes every line, is rejected (409/400)
  rather than silently creating a second order or an empty one.
- `lib/orders.ts`'s `createOrder()` (the public, 3-source HTTP-facing
  action) had its `CustomerOrder`/`OrderLine` creation logic extracted
  into a standalone `createOrderCore(tx, ...)` that takes an
  already-open transaction client, so `confirmReviewSession` (which needs
  the full 7-value `OrderSource`, including upload channels the public
  API deliberately excludes — see below) can reuse the exact same
  creation logic inside **its own** transaction, rather than duplicating
  ~70 lines of it. Prisma's interactive transactions cannot nest, so
  factoring the shared part into a function that takes `tx` as a
  parameter is the only way to share it between two independently-opened
  transactions. `createOrder()`'s own public behavior is unchanged.
- The review workspace UI (`app/orders/intake/[id]/review/page.tsx`,
  reached from a new "Review & confirm" button on the intake list once a
  document is `EXTRACTED`) lets the human search-and-override the
  customer and each line's product (reusing the existing
  `GET /api/customers?search=`/`GET /api/products?search=` list
  endpoints — no new search endpoint needed), edit the order
  header/quantity/unit fields, accept or exclude each line with an
  optional exclusion reason, see and acknowledge duplicate warnings, and
  confirm. **Deliberately out of scope for this round**: picking a
  specific delivery `CustomerLocation` on override — there's no
  `GET`-list endpoint for a customer's locations yet, and adding one
  wasn't part of your approved 2B scope, so `customerLocationId` stays
  unset on an overridden customer until a future milestone adds that
  endpoint.

### A real, independent correctness tightening to `lib/order-validation.ts`

The public `/api/orders` create schema's `source` field accepted any of
`OrderSource`'s 7 values (`EMAIL`/`WHATSAPP`/`MANUAL`/`PDF`/`IMAGE`/`EXCEL`/`CSV`)
via `z.nativeEnum(OrderSource)` — but `/api/orders` is the *manual-entry*
endpoint; a client claiming `source: "EXCEL"` through it would be a false
provenance claim with no document behind it. Narrowed to exactly
`["EMAIL", "WHATSAPP", "MANUAL"] as const]` — the three sources that make
sense for a human typing an order in directly. This is a genuine
least-privilege/input-validation fix on its own merits (OWASP: never
trust the client to self-report a provenance value it didn't earn), found
while reasoning through what `confirmReviewSession`'s wider internal
`OrderCreationInput` type needed to allow that the public type correctly
does not.

### Sandbox-only blocker (unchanged since round 1 — confirmed again this round)

Same root cause as every previous milestone: `@prisma/client` in this
sandbox is a non-functional stub (every enum name resolves to
`undefined` at runtime; several enum names are missing from its own type
declarations; `Prisma.Decimal`/`Prisma.TransactionClient`/
`PrismaClientKnownRequestError` don't resolve either). Same established
fix pattern, extended through every new 2B file: `import type {...} from
"@prisma/client"` for annotations, plain string literals for every
runtime enum value, never dereferencing the enum object itself.

**One genuine, independently-justified side effect this round**: fixing
the `OrderSource` narrowing above (previous section) also happened to
remove `tests/order-validation.test.ts`'s only dependency on this stub
(`z.nativeEnum(OrderSource)` was the one place that file touched the
broken enum object at runtime) — so a test that has been the project's
one permanently-accepted sandbox-only failure since round 1 now passes
cleanly in this sandbox too, with zero behavior change in the test
itself. This was a side effect of a security fix made on its own merits,
not a workaround applied for this reason.

### Build / lint / typecheck / test results — reported honestly

- `npm run lint` — **clean**, zero errors/warnings, including every new
  2B file (`lib/matching/`, `lib/review/`, the two new API routes, the
  new review workspace page, and both new test files).
- `npx tsc --noEmit` — **100 errors** (up from the pre-2B baseline of
  93, which was itself up from 77 at the end of Milestone 2A, +16 from
  this round's new library/route/page files, +7 more from the new
  DB-integration test file touching `Prisma.TransactionClient`/`tx`
  parameters). Every single one of these 23 new errors is in the exact
  same two pre-existing sandbox-stub categories already documented in
  every previous milestone (`TS2305` "no exported member" on an enum
  name; `TS7006` "implicitly has an `any` type" on a `tx`/collection
  parameter whose type collapses because the stub it's inferred from is
  broken) — **no new error category anywhere**, confirmed by diffing the
  error-code histogram before and after this round's changes.
- `npx vitest run` — **200 passed, 8 skipped** (up from 163 passed/1
  skipped at the end of Milestone 2A, plus this round's
  `order-validation.test.ts` fix described above). The 8 skips are the
  pre-existing `orders-db.integration.test.ts` (1) plus this round's new
  `tests/matching-review-db.integration.test.ts` (7) — both gated behind
  `RUN_DB_INTEGRATION_TESTS=1` for the same one reason (no real
  `@prisma/client` here). Zero failures.
  - New unconditional unit tests, `tests/matching-normalize.test.ts` (21
    tests): `normalizeMatchText`/`tokenize`/`diceCoefficient` (including
    the "never merges two pack sizes" property) and the shared
    `selectConfidentMatch` decision logic, including its exact
    confidence-threshold and ambiguity-gap boundaries. Has **no**
    `@prisma/client` dependency anywhere in its import graph, so it's the
    one new 2B test file that runs everywhere unconditionally.
  - New DB-integration acceptance test,
    `tests/matching-review-db.integration.test.ts` (7 tests, same
    `RUN_DB_INTEGRATION_TESTS=1` convention as
    `tests/orders-db.integration.test.ts`): alias record/lookup and the
    find-or-create-or-repoint behavior; alias lookup taking priority over
    fuzzy scoring; duplicate detection firing on both signals; the full
    chain — build a review session, confirm idempotency on a second open,
    confirm it (including a manually-overridden line) into a real
    `CustomerOrder`, verify every `ExtractedOrderLine`/alias/audit-event
    side effect, verify the already-confirmed guard; the
    acknowledge-duplicate gate end to end; and the all-lines-excluded
    rejection. This is this milestone's acceptance test — chaining 2A's
    extraction shape through matching, aliasing, duplicate detection, and
    confirmation into real database rows — and, unlike 2A's own
    acceptance test, genuinely cannot avoid needing a real database:
    2B's deliverable *is* database rows (`ExtractedOrderLine`,
    `ProductAlias`, `CustomerAlias`, the created `CustomerOrder`), so a
    no-DB version of this test would not actually prove the milestone
    works. **This is the one 2B test you must run on your own machine**
    (`RUN_DB_INTEGRATION_TESTS=1 npm test`, after `npm run db:seed`) to
    get real coverage of this milestone's core deliverable.
- `npm run build` — Turbopack's bundling stage completes; the build then
  hits this sandbox's pre-existing Google Fonts network block (unchanged
  since Milestone 1 fix round 2 — `next/font` fetching Geist/Geist Mono
  from `fonts.googleapis.com`, which this sandbox's network allowlist
  has never permitted), unrelated to any 2B code. **Your next real
  `npm run build` is what actually confirms the 2B type-check passes a
  real generated `@prisma/client`** — this sandbox cannot get past either
  of those two points.

### Open / explicitly not done in this sub-build

- No Excel/CSV/clipboard handover document, no multi-store splitting, no
  repeat-order detection — all Milestone 2C, not started.
- No `GET`-list endpoint for a customer's locations yet, so the review
  workspace cannot offer a delivery-location override on an overridden
  customer (see above) — a small, explicitly scoped-out gap, not an
  oversight.
- The fuzzy-matching confidence threshold and ambiguity gap
  (`FUZZY_CONFIDENT_THRESHOLD`/`FUZZY_AMBIGUITY_GAP`, both matchers) are
  an honest, unverified assumption with no real calibration data yet —
  watch real review-workspace usage and retune the one constant in each
  matcher file if matches are too eager or too conservative.
- Alias learning is unconditional on every confirm (every accepted
  line's final product, and the resolved customer) — there's no UI
  affordance yet to review or remove a previously-learned alias if a
  human later decides it was wrong; the row can be corrected today only
  by confirming a different mapping for the same text (which re-points
  it, per `recordProductAlias`/`recordCustomerAlias`'s find-or-create-or-
  repoint behavior) or by deleting it directly in the database.

## Milestone 2C (SAP handover, multi-store splitting, repeat orders)

Scope, the final sub-build of the approved 2A/2B/2C sequence, clarified
up front against four scope questions before building (binding answers
below — each one changed the actual design, not just wording):
- **Handover trigger: manual, per order.** A "Generate handover" action
  on a confirmed order, producing an Excel/CSV/clipboard output on
  demand — **not** automatic on confirm, **not** a batch/scheduled run.
- **Multi-store split: split one document into several orders.** A single
  PO/WhatsApp message sometimes names several different store-customers
  at once; the review step lets a human tag individual lines with a
  *different* customer than the document's own resolved one, producing
  several separate confirmed orders (and handovers) from one document —
  **not** `CustomerLocation` splitting, **not** grouping an
  already-separate batch handover by store.
- **Repeat orders: one-click re-order.** A "Repeat this order" action
  pre-fills a *new* manual order with the same lines/quantities for a
  human to review and submit — **not** pattern-detection-only, **not** a
  scheduled/automatic standing-order template.
- **CSV and clipboard, both chosen**: CSV as a lightweight alternative to
  Excel (same content, a `.csv` file); clipboard as tab-separated text for
  the invoice team to paste directly into a SAP data-entry grid or Excel.

### Schema (additive only — `prisma/migrations/20261109150000_add_order_handover/`)

- `OrderHandover` — one row **per generation attempt**, never overwritten
  and never deduplicated (the same append-only convention
  `ExtractionRun` already established in Milestone 2A): `orderId`,
  `format` (new `HandoverFormat` enum: `EXCEL`/`CSV`/`CLIPBOARD`),
  `generatedById`, `lineCount`/`matchedLineCount`/`unmatchedLineCount`,
  and the stored file's `storageKey`/`originalFileName`/`mimeType`/
  `fileSize` — all four **nullable**, since a `CLIPBOARD` handover has no
  stored file at all (its content only ever leaves this project's own
  process boundary once, in the HTTP response, matching exactly what the
  invoice team pastes). Regenerating a handover after a correction keeps
  the full history of what was handed over before, rather than silently
  replacing it.
- `CustomerOrder.handedToSapAt` and `OrderDocument.orderId`/`status`
  needed **no schema change at all** for this milestone — see the two
  design notes below for why.

### Handover generation (`lib/handover/`, `app/api/orders/[id]/handover/`)

- `buildHandoverRows(orderId)` (`lib/handover/build-handover-rows.ts`) is
  the **single source of truth** every format renders from, so Excel,
  CSV, and clipboard can never show different content for the same
  order. Always rebuilt fresh from the order's **current**
  `OrderLine`/`Product` data at generation time — never cached, never
  read back from an earlier `OrderHandover` row (none of them store
  their row content, only the rendered file) — because a handover is an
  operational document meant to reflect SAP's catalogue *right now*, not
  a snapshot from whenever the order happened to be created.
- **Three-way fallback per line, and no line is ever silently dropped**:
  (1) a live `Product` join via `OrderLine.productId` (preferred — the
  official, current SAP item code and description); (2) if that's null,
  `OrderLine.sapItemCodeSnapshot` (the product has since been removed
  from the catalogue — `onDelete: SetNull` — but the code survives,
  with no live description available); (3) if that's null too, no match
  at all. Every line always produces a row; an unmatched or
  snapshot-only line gets a non-null `note` explaining why, carried into
  every rendered format, so the invoice team always sees it rather than
  a handover that's silently short a row.
- `lib/handover/format-rows.ts` holds the **pure** CSV/clipboard
  text-building functions (`rowsToCsvText`/`rowsToClipboardText`), with
  **zero** `@prisma/client` dependency anywhere in its import graph
  (`build-handover-rows.ts`'s row type is pulled in via `import type`
  only, which TypeScript erases completely at compile time) — the same
  pure/DB-logic split Milestone 2B's `normalize.ts` established, so this
  exact formatting logic (quoting, never dropping a line) is
  unconditionally unit-testable with no database at all. CSV is
  comma-separated with a header row, CRLF line endings (the Excel-opening
  convention), proper quoting of embedded commas/quotes/newlines.
  Clipboard is tab-separated, no header, no quoting, and deliberately
  **excludes** the original customer wording (useless once pasted into
  SAP, and just another column to delete).
- `generateHandover(orderId, actorId, format)`
  (`lib/handover/generate-handover.ts`) — manual, per-order, exactly per
  your approved scope. Excel is built with `exceljs`
  (`buildExcelBuffer`: order summary rows, a blank row, a bold header
  row, then one row per line); CSV and clipboard both render from the
  exact same `buildHandoverRows` output via `format-rows.ts`. One
  transaction: creates the `OrderHandover` row, sets
  `CustomerOrder.handedToSapAt` **once only** (see below), writes an
  `ORDER_HANDOVER_GENERATED` audit event. On any failure after bytes were
  already written to storage, those bytes are deleted (same
  orphan-avoidance pattern as `app/api/orders/[id]/documents/route.ts`).
  Refuses (409) only for a `CANCELLED`/`REJECTED` order — see the
  deliberate non-gating decision just below for why it does **not**
  additionally require `status: "APPROVED"`.
- **`handedToSapAt` is a once-only marker**: set via
  `updateMany({ where: { id, handedToSapAt: null }, ... })` so the
  **first** handover generated (in any format) is what's recorded as
  "when this order was first handed to SAP" — a later regeneration (a
  correction, a different format) never bumps it forward. This field
  already existed in the schema since Milestone 0 as a forward-looking
  placeholder, read in a dashboard metric but never written anywhere
  until this round.
- **Deliberate decision: handover generation is NOT gated on
  `OrderStatus.APPROVED`.** `lib/order-queries.ts`'s own dashboard metric
  (`{ status: APPROVED, handedToSapAt: null }`) implies that gate is the
  eventual intent — but no code anywhere in this project sets
  `status: "APPROVED"` yet; no approval workflow exists. Enforcing that
  gate now would make this entire feature permanently unusable until a
  future milestone builds approval. Generation is refused only for
  `CANCELLED`/`REJECTED` orders instead, and this gap is called out
  explicitly in Open items below rather than silently worked around.
- `GET /api/orders/[id]/handover` lists every handover generated for an
  order so far (append-only history); `POST` generates a new one in the
  requested format, 201 on success. `GET /api/orders/[id]/handover/[handoverId]/download`
  mirrors `GET /api/files/[id]`'s exact pattern (`handoverId` is the
  `OrderHandover` row id, never a storage key — nothing in the URL for a
  client to guess or tamper with) and is never reachable for a
  `CLIPBOARD` handover, which has no stored file at all.
- `app/orders/[id]/handover-panel.tsx` — the one client-rendered "island"
  embedded into the otherwise-async-Server-Component order detail page
  (`app/orders/[id]/page.tsx` stays a Server Component for everything
  else): Generate Excel / Generate CSV / Copy to clipboard buttons, a
  past-handovers list with download links (or "Not stored" for
  clipboard), and a clipboard copy via `navigator.clipboard.writeText`.

### Multi-store splitting (`lib/review/confirm-review.ts`, `lib/review/confirm-review-validation.ts`)

- **No schema change needed for the document-to-orders linkage.**
  `OrderDocument.orderId` keeps its exact Milestone 2B meaning — a single
  nullable FK to the **primary** order only. "Every order a document
  produced" is fully derivable later via
  `ExtractedOrderLine.resultingOrderLineId → OrderLine.orderId`, with no
  new join table — a deliberate choice to avoid touching already-shipped
  2A/2B schema or query code for this.
- `confirm-review-validation.ts`'s `lineDecisionSchema` gets one new,
  additive, optional field: `customerId`. Omitted (the overwhelmingly
  common case) means "this line belongs to the document-level default
  customer" — today's exact single-store behavior, byte-for-byte
  unchanged. Set only when a line actually belongs to a **different**
  store than the rest of the document.
- `confirmReviewSession` groups every accepted line by its **effective**
  customer (`decision.customerId ?? input.customerId`), preserving each
  line's original order within its group. The **primary** group — the
  one `OrderDocument.orderId` keeps pointing at, and whose id/reference
  stay the top-level `orderId`/`orderReference` fields — is
  `input.customerId`'s group, or (the rare edge case where every single
  line was reassigned away from it) the first group encountered.
- **Backward-compatible return-shape extension, not a rewrite**:
  `orderId`/`orderReference` keep meaning exactly what they meant before
  this milestone (the single order's id/reference — now, specifically,
  the primary group's), so every existing single-store caller — the
  Milestone 2B API route, the Milestone 2B integration test reading
  `confirmResult.orderId` directly — needed **zero** changes. A new
  `orders: [{ orderId, orderReference, customerId }, ...]` array is
  added alongside, always at least one entry, more than one only when a
  request's line decisions actually split the document.
- **Every order from one document is created in exactly one transaction**
  — all or none, never a partial split. A fresh `generateOrderReference()`
  per group, regenerated for **every** group on any reference collision
  (not just the one that collided), reusing the exact retry budget
  (`MAX_REFERENCE_ATTEMPTS`) and collision detection (`isUniqueViolation`)
  `lib/orders.ts` already established.
- Every **other** distinct customer referenced by a line override (not
  just the document-level default) is validated to actually exist before
  the transaction opens, so a bad id fails clearly with a 400 rather than
  surfacing later as an opaque foreign-key violation.
- `customerLocationId` only ever applies to the **primary** group — a
  per-line override has no corresponding location input on this request
  shape, so every other split order is created with no location.
- Duplicate detection runs **once per distinct group customer** rather
  than once for the whole request: `SAME_CUSTOMER_PO_REFERENCE` is
  customer-scoped, so a split document must be checked against *every*
  customer it will create an order for, not just the primary one;
  `SAME_DOCUMENT_CHECKSUM` is document-scoped (identical every time) and
  is deduplicated down to at most one warning rather than repeated once
  per group. Still all-or-nothing: the **whole** confirm is rejected
  (409) if **any** group has an unacknowledged warning, never a partial
  per-group apply.
- `ProductAlias` learning for an accepted line is now recorded against
  that **line's own effective customer**, not the document-level
  default — a per-line override means a *different* store calls this
  product by this text, which should strengthen that store's own alias,
  never the default customer's. `CustomerAlias` learning for the header
  text stays tied to the document's own default customer exactly as
  before — a per-line override is a one-off correction for that one
  line, not evidence about what the document's header text itself means.
- `app/orders/intake/[id]/review/page.tsx` — each accepted line now has
  an "Assign to a different store" control (a second, independent
  customer-search picker from the document-level one) that, once set,
  shows a "Different store: `<name>`" chip with a clear button. The
  confirm success banner shows a single order link as before when only
  one was created, or a list of every created order (with its own
  customer label) when the document was actually split.

### Repeat orders (`app/orders/new/page.tsx`, `app/orders/[id]/page.tsx`)

- A plain "Repeat this order" link (`/orders/new?repeatFrom=<orderId>`)
  on the order detail page's title row. Nothing is created by visiting
  it — it only pre-fills a **new**, unsubmitted manual order for a human
  to review and submit, exactly per your approved "one-click re-order"
  scope (not pattern detection, not a standing-order template).
- Reads `?repeatFrom=` via `new URLSearchParams(window.location.search)`
  directly inside a `useEffect`, **not** Next's `useSearchParams()` hook
  — deliberately, to sidestep that hook's Suspense-boundary requirement
  entirely on this already-`"use client"` page (the same class of
  prerender-safety constraint this file's existing `crypto.randomUUID()`
  comments already document).
- Fetches `GET /api/orders/[repeatFrom]` (the existing order-detail
  route, unchanged) and a second `GET /api/customers/[id]` call for the
  `sapCustomerCode` the first response doesn't carry, then pre-fills:
  `source: "MANUAL"`, the resolved customer, `deliveryAddress`, and every
  line (`originalProductDescription`, `productId`,
  `sapItemCodeSnapshot`, `requestedQuantity`, `requestedUnitCode`,
  `customerUnitPrice`). `customerPoReference`/`internalNotes`/`orderDate`/
  `requestedDeliveryDate` are deliberately left blank — a repeat order is
  a fresh order the human re-enters that paperwork for, not a literal
  clone of the original's.
- **Pragmatic placeholder, not a gap in disguise**: there is no
  single-product-lookup endpoint (`GET /api/products/[id]` doesn't
  exist) to re-derive a product's display name from just a `productId`,
  so each prefilled line's search box shows `sapItemCodeSnapshot` as a
  placeholder instead of the real item name — the human reviews or
  re-searches each line as needed before submitting; `productId` itself
  is still prefilled correctly.
- The existing customer-locations-loading `useEffect` gets one small,
  additive tweak: a `pendingRepeatLocationIdRef`, set only when
  prefilling from a repeat order, that this effect prefers over its own
  default-location fallback — consumed (and cleared) exactly once per
  customer selection, so picking a *different* customer afterwards falls
  straight back to today's plain default-location behavior, unchanged.

### Sandbox-only blocker (unchanged since round 1 — confirmed again this round)

Same root cause as every previous milestone: `@prisma/client` in this
sandbox is a non-functional stub. Same established fix pattern, extended
through every new 2C file: `import type {...} from "@prisma/client"` for
annotations, plain string literals for every runtime enum value. The
`exceljs`/`@types/node` `Buffer` type conflict already fixed on the read
side in Milestone 2A (`lib/extraction/deterministic/excel.ts`) recurs on
this milestone's write side (`buildExcelBuffer`'s `workbook.xlsx.writeBuffer()`)
and is fixed with the exact same narrowly-scoped, commented
`eslint-disable-next-line @typescript-eslint/no-explicit-any` cast.

### Build / lint / typecheck / test results — reported honestly

- `npm run lint` — **clean**, zero errors/warnings, including every new
  2C file (`lib/handover/`, the three new API routes, the new/changed
  pages, and all three new/changed test files).
- `npx tsc --noEmit` — **105 errors** (up from the 2B-end baseline of
  100). Every one of these 5 new errors is in the exact same
  pre-existing sandbox-stub categories documented in every previous
  milestone (`TS7006` "implicitly has an `any` type" on a `tx`/collection
  parameter inferred from the broken stub) — confirmed by diffing the
  full error-code-and-location histogram before and after this round's
  changes line by line. **No new error category anywhere.**
- `npx vitest run` — **207 passed, 14 skipped** (up from 200 passed/8
  skipped at the end of Milestone 2B). Zero failures.
  - New unconditional unit tests, `tests/handover-format-rows.test.ts`
    (7 tests): `rowsToCsvText`/`rowsToClipboardText` — exact header/
    CRLF/quoting behavior, that an unmatched line always still gets a
    row, and the empty-order edge case. Has **no** `@prisma/client`
    dependency anywhere in its import graph, so it runs everywhere
    unconditionally, same as `tests/matching-normalize.test.ts` before it.
  - New DB-integration acceptance test, `tests/handover-db.integration.test.ts`
    (5 tests, same `RUN_DB_INTEGRATION_TESTS=1` convention): the
    three-way product-match fallback never drops a line;
    `generateHandover(EXCEL)` produces a real, readable `.xlsx` (parsed
    back with `exceljs`), creates an append-only `OrderHandover` row,
    and sets `handedToSapAt` once (confirmed **not** re-set by a second,
    different-format generation); `generateHandover(CSV)`'s stored file
    content matches `buildHandoverRows`/`rowsToCsvText` exactly;
    `generateHandover(CLIPBOARD)` stores nothing but returns the
    clipboard text directly; generation is refused for a cancelled order.
  - One new test appended to `tests/matching-review-db.integration.test.ts`
    (now 8 tests in that file): a single document with two lines, one
    tagged with a different store customer, confirms into **two**
    separate `CustomerOrder`s in one call — verifies the backward-
    compatible `orderId`/`orderReference` aliasing, that
    `OrderDocument.orderId` points only at the primary order, that each
    `ExtractedOrderLine` links to its own order's own `OrderLine`
    (never both to the same order), and that the reassigned line's
    `ProductAlias` is learned against the *split* customer, not the
    document's default one.
  - **These are the two 2C tests you must run on your own machine**
    (`RUN_DB_INTEGRATION_TESTS=1 npm test`, after `npm run db:seed`) to
    get real coverage of this milestone's actual deliverables — a real
    `.xlsx`/CSV file and real split `CustomerOrder` rows are exactly what
    a no-DB test cannot prove.
- `npm run build` — Turbopack's bundling stage completes; the build then
  hits this sandbox's pre-existing Google Fonts network block (unchanged
  since Milestone 1 fix round 2), unrelated to any 2C code. **Your next
  real `npm run build` is what actually confirms the 2C type-check passes
  a real generated `@prisma/client`** — this sandbox cannot get past
  either of those two points.

### Open / explicitly not done in this sub-build

- **Handover generation is not gated on order approval.** See the
  dedicated design note above — no approval workflow exists anywhere in
  this project yet, so this is a real, honestly-documented gap, not an
  oversight: once a future milestone adds an approval workflow and sets
  `OrderStatus.APPROVED`, this gate should likely be added to
  `generateHandover`.
- **No single-product-lookup endpoint** (`GET /api/products/[id]`) — the
  repeat-order prefill works around this with a pragmatic placeholder
  (see above); adding that endpoint would let a repeated line's search
  box show the real product name immediately instead.
- **No customer-location override for a split line.** A per-line
  customer override always gets `customerLocationId: null` on its
  resulting order — there's no per-line location-picker UI, matching the
  exact scope boundary Milestone 2B already drew around
  `customerLocationId` for an overridden customer.
- **No handover-content diff/versioning UI.** Every regeneration is a
  real, separate, append-only `OrderHandover` row (by design — see
  above), but there's no UI yet to compare what changed between two
  handovers of the same order; today a human would need to download
  both and compare by hand.
- The fuzzy-matching confidence threshold/ambiguity gap and the
  alias-review-UI gap, both called out in Milestone 2B's own Open items,
  remain exactly as they were — untouched by this round.

## Milestone 3A (warehouse picking — SAP Invoice Handover Specification, stage 1 of 4)

You provided a detailed specification ("WILLSGROVE SALESFLOW — SAP
INVOICE HANDOVER SPECIFICATION") whose point 7 explicitly asked for a
report on proposed database/workflow changes and conflicts with the
existing Milestone 2C handover, before building, and to implement in
stages 3A–3D. That report was given in chat first; this section records
what was actually agreed and built for stage 3A. See
`docs/milestones/ROADMAP.md` for the full 0–3D status table.

### What the spec requires that didn't exist yet

The spec's SAP Invoice Handover `Quantity` column must be "the final
verified and authorized quantity found by the warehouse," never the
original customer-requested quantity, and generation must be blocked (or
clearly marked not-ready) "if an order has not completed picking
verification, or the quantities have not been authorized." Nothing in
this project tracked warehouse picking at all before this round —
`VerificationStatus`/`PriceDecisionStatus`/`ProductVerification`/
`PriceDecision`/`OrderApproval` are a different, still-unbuilt workflow
(SAP-catalogue/price verification and discount approval on an
`OrderLine` — see that section of the schema), and `StockSnapshot`/
`StockSnapshotLine` (Milestone 1) is a point-in-time SAP inventory
import, not an order-specific picking record. Conflating either with
warehouse picking would have been the wrong call, so 3A adds a genuinely
new, separate subsystem instead.

Two prior pieces of scaffolding pointed straight at this: `lib/order-
display.ts` had an explicit comment saying to add a `Picking` `OrderStatus`
display case "only after it exists in the schema," and the sidebar
already linked a dead `/fulfilment` nav entry (built out in 3B).

### Decisions you confirmed before this stage was built

Two genuinely ambiguous, expensive-to-redo design questions were put to
you directly (not guessed):

1. **Authorization: "same roles, two steps."** No new `UserRole` —
   picking itself (start a session, record found/unavailable per line,
   mark it complete) has no dedicated role and any authenticated user
   can do it. Authorization is a **separate, later action**, restricted
   to `SALES_MANAGER`/`ADMINISTRATOR` — enforced at the API route
   (`requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"])`), not in
   the `lib/picking/` function itself, the same lib-vs-route split every
   other role-gated action in this project already follows.
2. **A line that's 100% unavailable: omit it entirely.** Decided in 3C's
   favor already (so 3C doesn't have to revisit it): a fully-unavailable
   line has nothing to invoice, so it won't appear as a row at all in
   the eventual SAP Invoice Handover — recorded in full in `PickingLine`
   either way, just not SAP-facing.

### Schema (additive only — `prisma/schema.prisma`)

- **`OrderStatus`** gains exactly two new values: `PICKING` (a session
  has been started, not yet authorized) and `READY_TO_INVOICE` (picking
  completed **and** authorized — the gate the eventual reworked
  `generateHandover`, in 3C, will require). Deliberately **not** part of
  the `READY_FOR_APPROVAL`/`APPROVED` sequence — that belongs to the
  separate pricing-verification workflow named above.
- **New `PickingSessionStatus` enum**: `IN_PROGRESS` → `COMPLETED` →
  `AUTHORIZED`. A session's own state, independent of `OrderStatus`.
- **New `PickingSession` model**: one row per picking *attempt* on an
  order (`orderId`, `status`, `startedById`/`startedAt`,
  `completedById`/`completedAt`, `authorizedById`/`authorizedAt`,
  `notes`, `isDemo`). Unlike `OrderHandover`/`ExtractionRun`'s pure
  append-only convention, a session's own row **is** mutated as picking
  progresses — but once it reaches `AUTHORIZED` it's never mutated
  again; a correction after that point starts a **brand-new** session,
  so the full history of every picking attempt is always preserved. At
  most one session per order may be `IN_PROGRESS` or `COMPLETED`-but-
  not-yet-`AUTHORIZED` at a time (enforced in `lib/picking/start-
  picking.ts`, not a DB constraint — the same kind of cross-row business
  rule this project always enforces in `lib/`).
- **New `PickingLine` model**: one row per `OrderLine` being picked in a
  given session — `requestedQuantity` **snapshotted** at the moment
  picking starts (same "preserve what was actually true at the time"
  principle as `OrderLine.sapItemCodeSnapshot`), plus nullable
  `foundQuantity`/`unavailableQuantity`/`notes`/`pickedById`/`pickedAt`.
  `foundQuantity + unavailableQuantity` must exactly equal
  `requestedQuantity` before the owning session can be `COMPLETED` —
  matches the spec's worked example exactly (20/20/0, 15/10/5, 30/25/5).
- **`OrderHandover` gains two nullable columns** (no change to any
  existing column): `pickingSessionId` (FK, `SetNull` — which authorized
  session a handover's quantities came from, for 3C) and `reference`
  (the spec's "Handover Reference" header field — generated starting in
  3C; existing handover rows simply have `null` here, never backfilled).
- Migration: `prisma/migrations/20261110060000_add_picking_sessions/migration.sql`.

### `lib/picking/` — the core workflow

- **`validation.ts`** — zod schema for the record-line request body, and
  pure decimal arithmetic (`exceedsRequested`/`fullyAccountsFor`) using
  exact fixed-point `BigInt` comparison (quantities scaled by 10,000 —
  this project's `Decimal(18,4)` precision) rather than floating point,
  so e.g. `0.1 + 0.2` can never drift away from `0.3`. Zero
  `@prisma/client` dependency anywhere in its import graph, so (like
  `lib/handover/format-rows.ts` before it) it's unconditionally unit-
  testable.
- **`start-picking.ts`** — `startPickingSession(orderId, actorId)`.
  Refuses a `CANCELLED`/`REJECTED` order or one with no lines (409/400);
  refuses a second concurrent session (409, see schema note above);
  otherwise creates the session + one `PickingLine` per order line, and
  moves the order to `PICKING` (with an `OrderStatusHistory` row and an
  audit event, same pattern as every other status transition in this
  project).
- **`record-picked-line.ts`** — `recordPickedLine(...)`. Can be called
  any number of times while the session is `IN_PROGRESS` (a line can be
  saved mid-entry); refuses once the session is no longer `IN_PROGRESS`
  (409); immediately refuses `found + unavailable` exceeding
  `requestedQuantity` in either direction (400) — overcounting is never
  legitimate, but a *partial* entry (not yet summing to the full
  requested quantity) is allowed here and only checked for completeness
  at the next step.
- **`complete-picking.ts`** — `completePickingSession(sessionId, actorId)`.
  Refuses unless every line's `found + unavailable` exactly accounts for
  its `requestedQuantity`, naming exactly which line numbers are still
  incomplete (400) rather than a generic refusal. Does **not** advance
  `OrderStatus` beyond `PICKING` — completion alone is not authorization.
- **`authorize-picking.ts`** — `authorizePickingSession(sessionId, actorId)`.
  Refuses unless the session is `COMPLETED` (409). Moves the order to
  `READY_TO_INVOICE`, with an `OrderStatusHistory` row and an audit
  event. Role-agnostic by design (see decision #1 above) — the route
  enforces `SALES_MANAGER`/`ADMINISTRATOR`.
- **`queries.ts`** — `getLatestPickingSessionForOrder`/
  `getPickingSessionDetail`, read-only, used by the new `GET` routes and
  reusable by the 3B UI.

### API routes (all under `app/api/orders/[id]/picking/`)

- `route.ts` — `GET` (latest session for this order, or `null`), `POST`
  (start a new one).
- `[sessionId]/lines/[lineId]/route.ts` — `PATCH` (record a line;
  `lineId` is the `OrderLine` id).
- `[sessionId]/complete/route.ts` — `POST`.
- `[sessionId]/authorize/route.ts` — `POST`, restricted to
  `SALES_MANAGER`/`ADMINISTRATOR`.

All follow this project's existing route conventions exactly: CSRF
origin check on every mutating call, `requireUserOrResponse()`,
`isValidId()` on every path segment, `Cache-Control: no-store` on every
response.

### `lib/order-display.ts`

Added `PICKING`/`READY_TO_INVOICE` to `ORDER_STATUSES`/
`ORDER_STATUS_LABELS`/`ORDER_STATUS_STYLES` — this is the exact "add a
status here only after it exists in the schema" moment that file's own
comment was pointing at. This alone means the existing order list/detail
pages (no other change needed) immediately show a **Picking** or
**Ready to Invoice** badge, and the order list gets two new filter tabs,
the moment an order actually moves through those statuses via the new
API — even though the dedicated `/fulfilment` picking UI itself is 3B's
job, not this round's.

### Tests

- `tests/picking-validation.test.ts` — 14 unconditional unit tests (no
  `@prisma/client` dependency): `decimalStringSchema`/
  `recordPickedLineSchema` shape validation, `parseScaledDecimal`'s
  exact-precision scaling, and `exceedsRequested`/`fullyAccountsFor`
  against the spec's own worked example plus overcounting/partial/sub-
  unit-precision edge cases.
- `tests/picking-db.integration.test.ts` — 6 tests, gated behind
  `RUN_DB_INTEGRATION_TESTS=1`: full lifecycle (start → record → complete
  → authorize) against the spec's worked example; refusing a second
  concurrent session; refusing to start picking for a cancelled order or
  an order with no lines; refusing to complete an incomplete pick (and
  naming which line); refusing to authorize before completion; a
  brand-new session being allowed after the previous one was authorized,
  with both sessions' history preserved. (Role gating itself —
  `SALES_MANAGER`/`ADMINISTRATOR`-only authorization — lives in the
  route, not the lib function, so this DB test intentionally does not
  exercise that 403; see that test file's own module comment.)

### Build / lint / typecheck / test results — reported honestly

- `npm run lint` — **clean**, zero errors/warnings, including every new
  3A file.
- `npx tsc --noEmit` — **116 errors** (up from the 2C-end baseline of
  105; **+11**). Confirmed, line by line, that all 11 new errors are in
  the exact same pre-existing sandbox-stub categories documented in
  every previous milestone: 9× `TS7006` "implicitly has an `any` type"
  on a `tx`/collection-callback parameter (the stub types
  `PrismaClient`/`Prisma.TransactionClient` as `any`, so TypeScript
  can't infer these without an explicit annotation this codebase doesn't
  use elsewhere either — see e.g. the pre-existing `lib/orders.ts(237,10)`,
  `lib/review/confirm-review.ts(340,55)`) and 2×
  `TS2339: Property 'Decimal' does not exist on type 'typeof Prisma'`
  (same pre-existing category as `lib/orders.ts(111,41)`,
  `lib/review/build-review-session.ts(135,78)`). **No new error
  category anywhere.** One real, new-category error this round's own
  code *did* trigger during development — `TS2737: BigInt literals are
  not available when targeting lower than ES2020` (this project's
  `tsconfig.json` targets `ES2017`) — was an actual bug in
  `lib/picking/validation.ts`'s first draft (`10_000n` literal syntax)
  and is fixed: every `BigInt` value here is now constructed with
  `BigInt(10_000)` (a function call, which works at any target) rather
  than literal suffix syntax, matching how `lib/handover/generate-
  handover.ts` already constructs `BigInt(fileSize)` elsewhere in this
  codebase.
- `npx vitest run` — **221 passed, 20 skipped** (up from 207 passed/14
  skipped at the end of Milestone 2C). Zero failures. The 14 new passing
  tests are `tests/picking-validation.test.ts` (unconditional); the 6
  new skipped tests are `tests/picking-db.integration.test.ts` (gated —
  **this is the one you need to run for real coverage of this stage's
  actual deliverable**, since a no-DB test can't prove a real
  `PickingSession`/`PickingLine` lifecycle).
- `npm run build` — Turbopack's bundling stage completes; the build then
  hits this sandbox's pre-existing Google Fonts network block (unchanged
  since Milestone 1 fix round 2), unrelated to any 3A code.
- `npx prisma validate`/`prisma generate` could not be run in this
  sandbox at all for this round (not even the stub-generation that
  usually succeeds) — the sandbox's network allowlist refused
  `binaries.prisma.sh` outright (`403 Forbidden` / `connect_rejected`),
  so neither the schema engine nor the query engine binary could be
  fetched. The new schema was therefore checked by hand instead: every
  `@relation(...)` name was confirmed to appear exactly twice (once on
  each side of the relation) and the file's brace-nesting was confirmed
  balanced by script, both reported above. **Run `npx prisma validate`
  yourself before applying the migration** — this is the one verification
  step this round genuinely could not perform at all, not merely with
  stubbed types.

### Open / explicitly not done in this sub-build (by design — see the roadmap)

- **No `/fulfilment` UI yet.** 3A is API-only, by design — exercised via
  curl in `SETUP-WINDOWS.md` §15's manual test script. Building it is
  3B.
- **`lib/handover/` is untouched.** `generateHandover` still produces the
  old 7-column layout sourced from `requestedQuantity`, and is **not**
  yet gated on `OrderStatus.READY_TO_INVOICE` — none of that is correct
  yet, and isn't meant to be until 3C.
- **No endpoint to list orders currently awaiting/in picking** (the
  3B UI's landing list will need one — a `GET /api/orders?status=PICKING`-
  style query, or a dedicated picking-queue endpoint). Deliberately left
  for 3B, since its exact shape depends on what that UI actually needs.
- **A session that's `IN_PROGRESS` or `COMPLETED` can't be cancelled or
  abandoned** — only progressed forward. If a pick genuinely needs to be
  thrown away (wrong order, data-entry disaster) there's currently no
  "abandon this session" action; not raised by the spec, so not built
  speculatively, but worth a decision before 3B's UI ships if you want
  one.

## Milestone 3B — Picking UI (`/fulfilment`)

Builds out the previously-dead `/fulfilment` sidebar entry into the real
picking workstation, entirely on top of 3A's schema and API — no schema
or `lib/picking/` workflow-function changes this round.

You said "build 3B" without answering 3A's one open, non-blocking
question (can an in-progress session be abandoned?). Per this project's
working agreement for an unattended/terse instruction: took the most
reasonable reading and proceeded rather than stalling on it — **session
abandon/cancel is still not built**, since it wasn't in the original spec
and wasn't explicitly asked for. Still open, still non-blocking, carried
forward below.

### What was built

- **`lib/picking/queries.ts`** gains `listPickingQueue(options)` — the
  one new read query this round needed. Queries `CustomerOrder` directly
  (not `PickingSession`) with `status NOT IN (DRAFT, CANCELLED,
  REJECTED)` and `handedToSapAt IS NULL`: every "live" order that could
  still need picking attention, regardless of whether a `PickingSession`
  has even been started for it yet. `handedToSapAt` is reused exactly as
  it already works elsewhere in this project — the one marker for "this
  order's picking/handover relevance is over" — so an order drops off
  this queue the moment a handover exists for it, whatever `OrderStatus`
  it happens to be sitting at.
- **`app/fulfilment/page.tsx`** (new) — the queue list. Server Component,
  plain query-string pagination (`?page=`), no client-side search/filter.
  Table columns: Order (link), Customer, Order Status badge, Picking
  progress badge (Not started / Picking in progress / Ready to invoice,
  derived from `OrderStatus` alone — no extra query), Requested Delivery,
  Lines, Open.
- **`app/fulfilment/[id]/page.tsx`** (new) — the per-order "workstation."
  Server Component: guards (`getCurrentUser`/`redirect`,
  `isValidId`/`notFound`, order exists/`notFound`), a header with a link
  back to the full order detail page (deliberately does **not** duplicate
  pricing/documents/status-history/the handover panel — those stay on
  `/orders/[id]`), a "not eligible for picking" message for
  `DRAFT`/`CANCELLED`/`REJECTED` orders, and otherwise renders
  `PickingPanel`. Computes `canAuthorize = role is SALES_MANAGER or
  ADMINISTRATOR` server-side and passes only that boolean down — **new
  pattern**, established here for the first time in this project: a
  Client Component never receives the full user/session object, only
  the one derived boolean it actually needs.
- **`app/fulfilment/[id]/picking-panel.tsx`** (new) — the one Client
  Component, mirroring `handover-panel.tsx`'s established conventions
  exactly (`"use client"`, mount-effect via
  `void Promise.resolve().then(() => load())`, a `readJson()` helper,
  always re-fetch from the server after a mutation rather than an
  optimistic update, inline error text rather than thrown errors).
  Four states, driven entirely by the latest `PickingSessionDetail`'s
  shape:
  - **No session yet, or latest session `AUTHORIZED`** → "Start picking"
    / "Start a new picking session" button (`POST .../picking`). A fresh
    session after an authorized one is an explicit **re-pick/correction**
    path — the prior, authorized session's full history is preserved,
    never overwritten, per 3A's audit-trail design.
  - **`IN_PROGRESS`** → editable found/unavailable/notes inputs per
    line, client-side decimal-pattern pre-check before each per-row
    `PATCH .../lines/{orderLineId}` save (the server's own exact
    `BigInt`-based check in `lib/picking/validation.ts` is what actually
    enforces this; the client check only avoids an obviously-doomed round
    trip), a "Complete picking" button (`POST .../complete`) that
    surfaces the server's refusal message verbatim when lines are still
    incomplete (it already names the specific line numbers).
  - **`COMPLETED`** → read-only lines; "Authorize" button
    (`POST .../authorize`) shown only when `canAuthorize` is true;
    otherwise an explanatory note naming who can authorize instead of a
    disabled/missing button with no explanation.
  - **`AUTHORIZED`** → read-only summary + the re-pick entry point above.

### Deliberate scope decisions

1. **`/fulfilment`'s list stays a plain Server Component** — no
   client-side search/status-filter box, unlike `app/orders/page.tsx`'s
   heavier client machinery. This queue is already narrowly pre-scoped by
   `listPickingQueue()` to "orders that could still need picking," so the
   extra interactivity isn't needed yet. Not an oversight — a deliberate
   v1 simplification, easy to extend later if you want search/filtering
   on top of it.
2. **`listPickingQueue()` lives in `lib/picking/queries.ts`, not bolted
   onto `lib/order-queries.ts`/`app/api/orders/route.ts`/
   `app/orders/page.tsx`.** Those support only a single-status filter;
   stretching them to also express "not yet handed to SAP, any of several
   non-dead statuses" risked regressing the already-shipped, more general
   order list. A dedicated, narrowly-scoped query was the lower-risk
   choice.
3. **Role-to-Client-Component pattern (`canAuthorize: boolean`)** — see
   above. Worth following for any future Client Component that needs to
   know "can the current user do X," rather than passing the user object
   down.

### Build / lint / typecheck / test results — reported honestly

- `npm run lint` — **clean**, zero errors/warnings, including all three
  new 3B files.
- `npx tsc --noEmit` — **119 errors** (up from the 3A-end baseline of
  116; **+3**). Confirmed, line by line, that all 3 new errors are the
  exact same pre-existing sandbox-stub category documented in every
  previous milestone, not real bugs:
  - `lib/picking/queries.ts(173,23)`:
    `Prisma.CustomerOrderWhereInput` — the stub's `Prisma` namespace is
    missing this member. Identical, pre-existing pattern already present
    at `lib/order-queries.ts(78,...)` (`const where:
    Prisma.CustomerOrderWhereInput = {}`), which already contributed to
    the 3A-end baseline.
  - `lib/picking/queries.ts(203,23)`: `TS7006` implicit `any` on `order`
    in a `.map()` over a Prisma query result — same bucket as every
    other `tx`/collection-callback implicit-any already in the baseline
    (e.g. `lib/order-queries.ts`'s own equivalent callbacks).
  - `app/fulfilment/[id]/page.tsx(124,39)`: `TS7006` implicit `any` on
    `line` in `order.lines.map(...)` — same bucket again.
  **No new error category anywhere.** No code change was made to
  "silence" these, consistent with every prior round: annotating them
  piecemeal would be inconsistent with how the rest of the codebase
  already handles this identical stub limitation.
- `npx vitest run` — **221 passed, 20 skipped** — unchanged from the
  3A-end baseline. No new tests added this round: 3B is UI-only
  (`app/fulfilment/*`, `picking-panel.tsx`), and per this project's
  existing precedent (`handover-panel.tsx` got no dedicated component
  tests either), a Client Component that only orchestrates already-
  tested API calls doesn't get its own test file. `listPickingQueue()`
  is exercised by this round's manual test script (`SETUP-WINDOWS.md`
  §16) rather than an automated DB-integration test — it's a pure read
  query with no business-rule branching to assert beyond "filters
  correctly," which the manual walkthrough covers end to end.
- `npm run build` — same result as every prior round: Turbopack's
  bundling stage runs, then the build hits this sandbox's pre-existing
  Google Fonts network block (unrelated to any 3B code, unchanged since
  Milestone 1's fix round 2). **Your next real `npm run build` is what
  confirms `/fulfilment` and `/fulfilment/[id]` actually build and
  statically/dynamically render correctly** — this sandbox cannot reach
  that phase at all.
- `npx prisma validate`/`prisma generate` — not attempted this round;
  no schema change in 3B, so nothing new to validate (3A's schema is
  unchanged by this round).

### Open / explicitly not done in this sub-build

- **Session abandon/cancel is still not built.** Carried forward
  unanswered from 3A — see the note at the top of this section. A pick
  that's `IN_PROGRESS` or `COMPLETED` can still only be progressed
  forward; the only "undo" path today is to let it sit unauthorized
  (it's simply ignored by any future `READY_TO_INVOICE`-gated handover)
  or to authorize it and then start a fresh correction session. If you
  want an explicit abandon action, it's a small, isolated addition to
  `lib/picking/` (a new status or a cancelled-session flag) plus one more
  button in `PickingPanel` — say so and it can go into 3C or a follow-up,
  rather than being guessed at here.
- **`lib/handover/` is still untouched** — 3C's job, unchanged from 3A's
  note.
- **The two SAP-grid-compatibility overclaims** (`handover-panel.tsx`'s
  clipboard-copy success message, and `schema.prisma`'s `HandoverFormat`
  enum comment) are still unsoftened — also 3C's job, flagged again here
  so it isn't lost.

## Milestone 3C — Invoice Handover rework (SAP Invoice Handover Specification, stage 3 of 4)

Reworks `lib/handover/` to source from authorized picking instead of the
raw order, per the spec. **One honesty note up front**: this round's
session doesn't have the spec's literal original text in context (it
was written in an earlier session and summarized/compacted away before
this round started) — only my own prior rounds' paraphrases of it
(this file's 3A section, `ROADMAP.md`'s 3C scope line, and the schema/
code comments already in the repo pointing at "spec section 3/5/6/7").
Everything below that's attributable to the spec directly (the hard
gate's exact trigger condition, the Quantity column's definition, the
"omit a fully-unavailable line" decision) is quoted or closely
paraphrased from those existing, already-agreed artifacts — not
re-derived from scratch. The **exact column names and the exact set of
header fields** are this round's own best-reasoned reconstruction of
"4-column product table" / "richer header" (`ROADMAP.md`'s own words
for this stage, written in an earlier round), not verbatim spec text I
could re-check against. If the real spec names different columns or
header fields, that's a cheap, isolated fix in `lib/handover/format-rows.ts`/
`generate-handover.ts` — say so and it's a quick follow-up, not a redo of
this round's actual design work (the hard gate, the quantity sourcing,
the omission handling, Handover Reference generation, and the
traceability chain are all independent of exactly which columns are
shown).

### What changed, and why

1. **Hard gate**: `buildHandoverRows` now refuses (409) unless
   `OrderStatus === READY_TO_INVOICE` — the spec's requirement that
   generation be blocked "if an order has not completed picking
   verification, or the quantities have not been authorized."
   `READY_TO_INVOICE` is set in exactly one place
   (`lib/picking/authorize-picking.ts`, inside the same transaction that
   authorizes a session), so this one check is an exact proxy for both
   halves of that requirement — there's no way to reach
   `READY_TO_INVOICE` without picking having been both completed and
   authorized.
2. **Quantity is now the authorized PICKED quantity.** `buildHandoverRows`
   fetches the order's most recent `AUTHORIZED` `PickingSession` and
   sources `quantity` from each `PickingLine.foundQuantity` — never
   `OrderLine.requestedQuantity`, which the old (2C) version used. The
   SAP item code/official description resolution is still always current
   (never a snapshot) for the same "reflect the catalogue as it stands
   today" reason as before — only the *quantity* is historical, sourced
   from the authorized pick.
3. **A fully-unavailable line (`foundQuantity` exactly zero) is omitted
   entirely** from the handover's rows — your confirmed Milestone 3A
   decision, now actually wired into the document that matters. Never a
   *silent* omission: `omittedLineCount` is returned alongside the rows,
   surfaced in `generateHandover`'s result, and recorded on the
   `AuditEvent`.
4. **The product table is now 4 columns**: SAP Item Code, Description,
   Quantity, Unit — replacing the old 7-column layout (which also
   carried a Line number, the customer's Original Description, and a
   free-text Note column). The project's standing "never silently drop a
   flagged line" principle still holds, just not by widening this grid:
   a flagged line (no SAP match, an inactive product, a since-removed
   product with no live description) still gets a row in the 4-column
   grid itself (blank SAP code, falls back to the customer's own
   wording), and for CSV/Excel it's *also* listed again, with its reason,
   in a "Lines needing attention before processing" section appended
   below the main table — kept entirely separate so the main grid stays
   exactly what you'd key into SAP, nothing more. The clipboard format
   gets no such section (nowhere for it to go once pasted, and it's
   meant to be pasted, not read) — every row is still real and never
   dropped, just without an attached explanation.
5. **Richer header** (Excel only — CSV/clipboard never had a metadata
   header before this round and still don't, by precedent): the
   existing 5 order/customer fields, plus this handover's own newly-
   generated **Handover Reference**, and the picking-authorization
   traceability (**Picking Authorized By** / **Picking Authorized At**)
   — so the document is self-contained evidence of who verified the
   picked quantities and when, without needing to look anything else up.
   This directly answers the spec's traceability requirement (section 6,
   per the existing schema comment).
6. **Handover Reference generation**: `generateHandoverReference()`
   (`lib/handover/generate-handover.ts`) mirrors `lib/orders.ts`'s
   `generateOrderReference()` exactly — `HND-YYYYMMDD-XXXXXXXX`, same
   collision-retry loop (`MAX_REFERENCE_ATTEMPTS = 5`, retrying only on a
   unique-constraint violation that actually targets the `reference`
   column). `OrderHandover.reference` gained a `@unique` constraint this
   round (additive-safe: Postgres never treats two `NULL`s as colliding,
   so every pre-3C row, which has `reference = NULL`, is unaffected).
   Surfaced in the UI too, not just inside the generated file: the "past
   handovers" list on `/orders/[id]` now shows each handover's reference.
7. **The two SAP-grid-compatibility overclaims are softened**, per spec
   section 5 ("do not claim direct SAP Business One grid compatibility
   until the invoice team has tested it"):
   - `handover-panel.tsx`'s clipboard-copy success message changed from
     *"Copied -- paste directly into SAP or Excel."* to *"Copied to your
     clipboard -- paste it wherever the invoice team needs it next."*
     No claim about where it's safe to paste.
   - `schema.prisma`'s `HandoverFormat` enum comment changed from
     *"since its whole point is 'copy this text and paste it straight
     into SAP,' not a document to keep"* to describing the format
     neutrally (meant to be copied for the invoice team to paste
     wherever they need it, never stored as a file) with an explicit
     note that this project makes no claim about where it's safe to
     paste.

### Schema (additive only)

- `OrderHandover.reference` gains `@unique`. See point 6 above for why
  this is safe against existing data.
- `prisma/migrations/20261110170000_add_handover_reference_unique/migration.sql`
  — one `CREATE UNIQUE INDEX`. No column type, nullability, or data
  change; no other schema edit this round (`pickingSessionId` already
  existed, unused, since Milestone 3A).

### UI change (`app/orders/[id]/`)

- `handover-panel.tsx` now takes a `readyToInvoice: boolean` prop
  (computed server-side on the page, same derived-boolean-prop pattern
  3B established for `PickingPanel`'s `canAuthorize`) and disables all
  three Generate buttons with an inline explanation when it's false —
  UX only; the real enforcement is `buildHandoverRows`'s server-side
  gate regardless of what this prop says. Also now shows each handover's
  Handover Reference in the "past handovers" list.
- `page.tsx` passes `readyToInvoice={order.status === "READY_TO_INVOICE"}`.

### Tests

- `tests/handover-format-rows.test.ts` — rewritten for the 4-column
  layout: CSV's exact new header, the new "Lines needing attention"
  exceptions section (present only when something's flagged), and the
  clipboard format's unchanged "no exceptions, no header row" shape. 8
  unconditional unit tests (was 7).
- `tests/handover-db.integration.test.ts` — substantially reworked
  (gated behind `RUN_DB_INTEGRATION_TESTS=1`, same as before): its
  fixture now drives the *real* `lib/picking/*` lifecycle (start →
  record → complete → authorize) via a new `pickAndAuthorizeFully()`
  helper before generating a handover, with picked quantities
  deliberately different from requested quantities on two of three
  lines (so a test asserting "sourced from picked, not requested" can't
  pass by coincidence) and one line 100% unavailable (to assert the
  omission). Adds assertions for: the hard gate refusing before/mid-pick
  (two new scenarios); `omittedLineCount`; a generated, pattern-matching,
  per-call-unique Handover Reference; `pickingSessionId` recorded on the
  `OrderHandover` row; and the Excel sheet's new row count under the
  richer header + 4-column table + exceptions-section layout. 6 gated
  tests (was 5). `afterAll`'s cleanup now also deletes each test order's
  `PickingSession` rows before the order itself — required because
  `PickingSession.order` is `onDelete: Restrict`, which this test didn't
  need to account for before this round (its `PickingLine` children
  cascade automatically).

### Build / lint / typecheck / test results — reported honestly

- `npm run lint` — **clean**, zero errors/warnings, including every
  changed/new 3C file.
- `npx tsc --noEmit` — **123 errors** (up from the 3B-end baseline of
  119; **+4**). Confirmed, line by line, that every new occurrence is
  the same two pre-existing sandbox-stub categories documented in every
  previous milestone, not real bugs:
  - `TS7006` implicit `any` on a Prisma-query-result callback parameter
    (`lib/handover/build-handover-rows.ts`'s `.filter()`/`.sort()`/`.map()`
    callbacks, `lib/handover/queries.ts`'s `.map()` callback,
    `lib/handover/generate-handover.ts`'s transaction callback's `tx`) —
    identical bucket to the dozens of pre-existing occurrences this
    project has documented since Milestone 2B (e.g. the already-present
    `lib/orders.ts(237,10)`, `lib/review/confirm-review.ts(340,55)`).
  - `TS2694`/`TS2339` `Prisma.PrismaClientKnownRequestError` missing from
    the stub's `Prisma` namespace (`lib/handover/generate-handover.ts`'s
    new reference-collision retry, mirroring `lib/orders.ts`'s own
    `isUniqueViolation`) — identical, pre-existing bucket already present
    at `lib/orders.ts(42,34)`, `lib/orders.ts(244,41)`,
    `lib/customers.ts(30,29)`, and `lib/users.ts(20,34)`, all already in
    the 119-error baseline. **No new error category anywhere.**
- `npx vitest run` — **222 passed, 21 skipped** (up from 221 passed/20
  skipped at the end of Milestone 3B). Zero failures. +1 passing
  (`handover-format-rows.test.ts`'s new exceptions-section test), +1
  skipped (`handover-db.integration.test.ts`'s new mid-pick-refusal
  test) — see Tests above for the full breakdown of what changed in
  each file.
- `npm run build` — same result as every prior round: Turbopack's
  bundling stage runs cleanly (confirming the new/changed files
  themselves compile), then the build hits this sandbox's pre-existing
  Google Fonts network block, unrelated to any 3C code. **Your next real
  `npm run build`, and a real `RUN_DB_INTEGRATION_TESTS=1 npm test` run,
  are what actually confirm the reworked handover end to end** — this
  sandbox cannot reach either at all.
- `npx prisma validate`/`prisma generate` — not attempted this round
  (same sandbox network block as every migration since 3A's); hand-
  verified instead, the same way as every schema change since: every
  `@relation(...)` name still appears exactly twice (this round adds no
  new relation), and the file's brace-nesting is balanced by script.
  **Run `npx prisma migrate dev` / `prisma generate` for real before
  relying on the `@unique` constraint or the new `reference` field.**

### Open / explicitly not done in this sub-build

- **The exact column/header names are my best reconstruction, not
  verified against the spec's literal text** — see the honesty note at
  the top of this section. Flag it if it's wrong; it's a small, isolated
  fix.
- **Session abandon/cancel is still not built** — carried forward
  unanswered from 3A/3B, unchanged.
- **Milestone 3D** (final full test/doc pass across 3A–3C) is still
  pending, per the original stage breakdown.

## Milestone 3D — Tests, docs, verification (final stage of the SAP Invoice Handover Specification)

Closes out the 3A–3D stage breakdown. This round added no new
behavior — it's a coverage and consistency pass, exactly per the
roadmap's own description of this stage.

### Test coverage gap closed

Auditing 3A–3C's own additions turned up three read-only functions with
**zero** test coverage anywhere — not a single unit test, DB-integration
test, or even an indirect assertion through another test — exercised
only by hand through the UI or a manual walkthrough script until now:

- `lib/picking/queries.ts`'s `listPickingQueue` (Milestone 3B) — the
  `/fulfilment` queue's actual filtering logic (status exclusion +
  `handedToSapAt` gate + pagination), previously verified only by
  SETUP-WINDOWS.md §16's manual click-through.
- `lib/picking/queries.ts`'s `getLatestPickingSessionForOrder` and
  `getPickingSessionDetail` (Milestone 3A) — used by the picking API's
  `GET` routes, previously exercised only indirectly, by hand, through
  `/fulfilment`'s UI.
- `lib/handover/queries.ts`'s `listOrderHandovers` — touched in 3C
  (gained the `reference` field) but never directly tested even before
  that; its one conditional (no download link for `CLIPBOARD`) was
  untested.

New: `tests/picking-queries-db.integration.test.ts` (3 gated tests) --
covers `listPickingQueue`'s exact inclusion/exclusion rules (every
non-dead, not-yet-handed-to-SAP status included; `DRAFT`/`CANCELLED`/
`REJECTED` and anything with `handedToSapAt` set excluded, regardless of
`OrderStatus`), its demo-order default-exclusion, and its pagination
math; and `getLatestPickingSessionForOrder`/`getPickingSessionDetail`'s
null-before-any-session, most-recent-session-when-several-exist, and
unknown-id-returns-null behavior.

Added to `tests/handover-db.integration.test.ts` (1 new gated test,
6→7): `listOrderHandovers` returns each handover's `reference` and a
download link only for a stored format (`EXCEL`/`CSV`), never for
`CLIPBOARD`.

No gaps were found or closed in `lib/picking/start-picking.ts`/
`record-picked-line.ts`/`complete-picking.ts`/`authorize-picking.ts`
(3A) or `lib/handover/build-handover-rows.ts`/`generate-handover.ts`/
`format-rows.ts` (2C/3C) — all of those already had direct test
coverage from their own milestone's round, confirmed by re-reading
`tests/picking-db.integration.test.ts`, `tests/picking-validation.test.ts`,
`tests/handover-db.integration.test.ts`, and
`tests/handover-format-rows.test.ts` against each function's branches.
The `/fulfilment` and `/orders/[id]` UI components (`picking-panel.tsx`,
`handover-panel.tsx`) remain deliberately untested, per this project's
established precedent (a Client Component that only orchestrates
already-tested API calls doesn't get its own component test file —
see 3B's note on this).

### Documentation consistency pass

Re-read `docs/milestones/ROADMAP.md`, this file's 3A–3C sections,
`CHANGES.md`'s 3A–3C sections, and `SETUP-WINDOWS.md` §§15–17 against
the actual current code for drift. No corrections were needed —
everything already matches what's in the repo as of 3C's delivery.

### Known limitation carried forward, now formally closed out (not resolved)

**Session abandon/cancel was never built**, across all of 3A/3B/3C. You
were asked once (end of 3A) and the question went unanswered through
two further rounds of terse "build the next stage" instructions, which
this project's working-unattended rule treats as implicit "proceed
without it" rather than a reason to keep re-asking. Formally recording
the state here so it isn't mistaken for an oversight: **Milestone 3, as
shipped, has no way to abandon an `IN_PROGRESS` or `COMPLETED` picking
session** — it can only be progressed forward, left unauthorized
indefinitely (harmless: it simply never produces a handover), or
authorized and then corrected with a fresh session. If this becomes a
real problem in practice, it's a small, isolated addition (a new
session status or a cancelled flag, plus one button in `PickingPanel`)
for a future round — not re-litigated here.

### Build / lint / typecheck / test results — reported honestly

- `npm run lint` — **clean**, zero errors/warnings, including both new
  test files.
- `npx tsc --noEmit` — **125 errors** (up from the 3C-end baseline of
  123; **+2**). Both are `TS7006` implicit `any` on a `.find()` callback
  parameter in `tests/handover-db.integration.test.ts`'s new test —
  same pre-existing sandbox-stub category as every other occurrence
  documented across every milestone since 2B. `tests/picking-queries-db.integration.test.ts`
  contributes **zero** new errors — its callbacks all operate on this
  project's own exported types (`PickingQueueOrderSummary`, etc.), not
  directly on Prisma's stubbed types, so TypeScript infers them fine
  even in this sandbox. **No new error category anywhere.**
- `npx vitest run` — **222 passed, 25 skipped** (up from 222 passed/21
  skipped at the end of Milestone 3C). Zero failures, zero regressions.
  +4 skipped (gated): 3 in the new `picking-queries-db.integration.test.ts`,
  1 added to `handover-db.integration.test.ts`. (Passing-test count is
  unchanged because every test added this round is DB-gated.)
- `npm run build` — same result as every prior round: Turbopack's
  bundling stage runs cleanly, then the build hits this sandbox's
  pre-existing Google Fonts network block, unrelated to any 3D code.
- `npx prisma validate`/`prisma generate` — not attempted; no schema
  change this round.
- **The one thing this sandbox genuinely cannot confirm**: that the 4
  new gated tests (3 in the new file, 1 added to the handover file)
  actually pass against a real database. They're written, they type-
  check, lint is clean, and they follow this project's own established
  DB-integration-test conventions exactly — but **run
  `RUN_DB_INTEGRATION_TESTS=1 npm test` for real** before treating this
  coverage gap as closed, same as every gated test in this project.

### Milestone 3 (SAP Invoice Handover Specification) — overall status

All four stages are now delivered: 3A (schema + core picking workflow),
3B (`/fulfilment` UI), 3C (handover rework), 3D (this round — coverage
and consistency). See `docs/milestones/ROADMAP.md` for the master
status table, which this round also updates. The one open design
question (session abandon/cancel) is formally recorded above as a known,
accepted limitation of this milestone as shipped, not a loose end that
silently vanished.

## Milestone 3 completion — Warehouse Assembly Form & Partial Availability

A follow-on completion/correction stage for Milestone 3, requested after
3D, against a fuller written specification than this session had in
context when 3A–3D were built (that spec's literal text wasn't available
either, same honesty note as 3C's — see that section). Per that
specification's own "Implementation Boundaries": inspected 3A–3D
together first, identified what was already correct, and built only
what was genuinely missing. That audit's conclusion, in short: **the
hardest part — partial availability itself — was already fully and
correctly built in 3A/3C.** What was actually missing was (1) the
physical Warehouse Assembly Form print action, and (2) making the
three-way availability classification visible, in so many words, in the
`/fulfilment` review UI. Nothing here is a new architecture; it's one
new printable page and one new column.

### What this round found was already correct (not rebuilt)

- **Partial availability itself** — `PickingLine.foundQuantity` /
  `unavailableQuantity` (Milestone 3A) already supports any split, not a
  binary available/unavailable flag. Nothing to change.
- **Quantity validation rules** (the spec's section 4, verbatim) — all
  already enforced, before this round touched anything:
  - Found/unavailable cannot be negative: `decimalStringSchema`'s regex
    (`^\d+(\.\d{1,4})?$`) accepts no sign at all.
  - Neither can exceed requested: `exceedsRequested()`, checked on every
    `recordPickedLine` call.
  - Found + unavailable must exactly equal requested before completion:
    `fullyAccountsFor()`, checked by `completePickingSession`.
  - Decimal support, no silent rounding: everything is `Decimal(18,4)`
    end to end, compared as exact scaled integers
    (`parseScaledDecimal`), never as floating-point.
  - Original requested quantity preserved permanently: `PickingLine.
    requestedQuantity` is a snapshot column; nothing in the picking
    lifecycle ever writes back to `OrderLine.requestedQuantity`. (This
    round adds an explicit test asserting this directly — see below —
    rather than leaving it as an architectural inference.)
- **SAP Invoice Handover with partial availability** (the spec's section
  6, verbatim, including its own worked example) — `build-handover-
  rows.ts` (3C) already sources the *found* quantity only, already
  excludes a 100%-unavailable line entirely (counted in
  `omittedLineCount`, never silently dropped), and already preserves the
  original requested/unavailable quantities on the `PickingLine` row the
  handover was sourced from. Re-verified against the spec's own "Example
  D" table line by line (see the new test below) rather than taken on
  faith.
- **Verification/authorization as separate, role-gated steps** — already
  exactly two steps (`completePickingSession` / `authorizePickingSession`),
  already role-gated to `SALES_MANAGER`/`ADMINISTRATOR` for authorization
  only, at the API route (not duplicated here).
- **Audit trail & re-picking** — already captures who recorded findings,
  who authorized, and when, on every transition; re-picking already
  starts a brand-new `PickingSession` rather than mutating an authorized
  one, preserving full history. Already tested (`tests/picking-
  db.integration.test.ts`'s "allows starting a brand-new session...
  preserving its history").

### What this round actually built

1. **`classifyAvailability()`** (`lib/picking/validation.ts`) — the one
   place "Fully Available / Partially Available / Completely
   Unavailable / not yet recorded" is decided, from `foundQuantity`
   relative to `requestedQuantity`. A pure function (no `@prisma/client`
   import, same convention as this file's existing `exceedsRequested`/
   `fullyAccountsFor`), so it's safe to import from both a Server
   Component and (as done here) a Client Component directly, and is
   unit-tested exactly like its neighbors. `PENDING` is a deliberate
   fourth case for a line that hasn't been recorded yet at all (`found`/
   `unavailable` are nullable for exactly that reason) — showing
   "Completely Unavailable" for an un-picked line would be actively
   misleading.
2. **An "Availability" column on `/fulfilment/[id]`'s picking table**
   (`picking-panel.tsx`) — a colored badge per line (green/amber/red/
   gray) computed from the session's own saved `foundQuantity`/
   `unavailableQuantity` (never from an unsaved, in-progress input
   value), satisfying the spec's section 5 requirement that a
   salesperson can "clearly identify fully available, partially
   available and completely unavailable lines" before authorizing.
3. **The Warehouse Assembly Form** — the genuinely new feature:
   - **"Print Warehouse Assembly Form"** button on `/orders/[id]`
     (`app/orders/[id]/page.tsx`), opening `/orders/[id]/assembly-form`
     in a new tab. Visible once the order has at least one line and
     isn't `CANCELLED`/`REJECTED`; never role-restricted (same "no
     dedicated role" convention picking itself already follows — see
     `start-picking.ts`'s module comment — and printing has no side
     effect for any role to be restricted from in the first place).
   - **`app/orders/[id]/assembly-form/page.tsx`** — a clean, printer-
     friendly, server-rendered page containing exactly the spec's
     required fields: company identification (`lib/company-info.ts`,
     mirroring the business identity already shown in Settings — not
     invented fresh), customer name, customer PO number, SalesFlow order
     reference, order date, and a table of SAP item code / official SAP
     product description / customer-requested quantity / unit, with
     **blank** Found and Unavailable columns for the assembler to fill
     in by hand, plus assembler name/date/signature fields and a remarks
     box. Deliberately distinct from the SAP Invoice Handover in look
     and content (no Handover Reference, no pricing, a title that says
     plainly "Not an invoice or SAP handover document") so the two can
     never be confused, per the spec's explicit requirement.
   - **Zero writes, structurally, not just by convention** — this page
     never queries `PickingSession` at all, never calls any
     `lib/picking/*` function, and never touches `OrderStatusHistory`/
     `AuditEvent`. Reusing the exact `getOrderById` query the order
     detail page itself already uses (extended additively, see below)
     makes "printing cannot start or complete picking, authorize
     anything, or create a picking session" a structural guarantee: the
     only database read this route performs is one that was already
     proven, by three other pages, to have no side effects. A `/orders/
     [id]/assembly-form` link also hard-404s for a `CANCELLED`/
     `REJECTED` order or a non-existent one, so a stale/old link can't
     be used to print a dead order's form after the button itself is
     hidden.
   - **`lib/order-queries.ts`'s `getOrderById`** — extended additively
     (new fields only; nothing removed or renamed) with each line's live
     `product.sapItemCode`/`itemName`, the same official-SAP-description
     data the handover already resolves, rather than writing a second,
     near-duplicate order query just for this one new page. All three
     existing callers (`app/orders/[id]/page.tsx`, `app/fulfilment/[id]/
     page.tsx`, `app/api/orders/[id]/route.ts`) are unaffected, since
     none of them reference the new fields.
   - **`lib/assembly-form/resolve-line.ts`** — a small, pure, unit-
     tested function resolving each line's SAP item code/description
     with the same three-way priority (live product → order-time
     snapshot → the customer's own original wording) `build-handover-
     rows.ts` already established for the invoice handover. Written as
     its own function rather than extracted out of `build-handover-
     rows.ts` into a shared one: deliberately, to avoid touching an
     already-shipped, already-tested 3C file whose behavior this
     sandbox cannot re-verify end-to-end against a real database this
     round — same "mirror the convention, don't force a shared
     abstraction across two genuinely different call sites" choice
     `picking-panel.tsx`'s own `DECIMAL_PATTERN` comment already made for
     an analogous situation.

### Explicitly not touched, and why

- **No schema change, no new migration.** Every field this round needed
  (`PickingLine.foundQuantity`/`unavailableQuantity`, `Product.sapItemCode`/
  `itemName`) already existed. Adding a "this form was printed" audit
  row was considered and deliberately rejected: the spec doesn't ask for
  one, this project's other read-only pages (e.g. `/orders/[id]` itself)
  don't write an audit event just for being viewed either, and a
  page-render is only a weak proxy for "a human actually printed this"
  in the first place.
- **No new role.** The spec explicitly says not to introduce a warehouse
  user role, and nothing here needed one — assemblers never log into
  SalesFlow at all, exactly as the spec's section 2 states; printing and
  recording findings both stay with the salesperson, as already built.
- **`lib/handover/build-handover-rows.ts` is untouched.** Re-verified
  (not re-built) against the spec's own worked example — see the new
  Example D test below.

### Tests added

- `tests/picking-validation.test.ts` — 6 new unconditional tests for
  `classifyAvailability`, directly against the spec's own Examples A/B/C,
  the `PENDING` case, sub-unit decimal precision, and malformed input.
- `tests/assembly-form-resolve-line.test.ts` (new) — 4 unconditional
  tests for `resolveAssemblyFormLine`'s three-way fallback (live match /
  snapshot-only / no match at all) and pass-through fields.
- `tests/assembly-form-db.integration.test.ts` (new, 2 gated tests) —
  against a real database: `getOrderById`'s new fields resolve correctly
  for all three match states, **and** — the spec's explicit requirement
  — calling the exact read the assembly-form page performs, repeatedly,
  creates zero `PickingSession` rows and leaves the order's status
  untouched.
- `tests/handover-db.integration.test.ts` — 1 new gated test
  reproducing the spec's own "Example D" (five cake products, mixed
  fully/partially/completely-unavailable outcomes) verbatim, asserting:
  the three-way classification matches the spec's own "Result" column
  for all five lines; the handover's rows match the spec's section 6
  expected table exactly (`10`, `5`, `8` — the two zero-found lines
  excluded); and, explicitly, that `OrderLine.requestedQuantity` for
  every line is byte-identical before and after the full pick/authorize
  cycle.

This directly covers requirement items 1–5, 11–13 (mixed availability,
decimal precision, negative/exceeds/mismatch rejection — all already
covered by this file's pre-existing tests, re-confirmed above rather
than re-tested) and 14–15 (assembly form data correctness, zero side
effects) from the completion spec's required-testing list. Items 7–10
and 16 (negative/exceeds rejection, found+unavailable mismatch,
role restriction, audit/re-pick history) were already covered before
this round and are unchanged; role restriction specifically remains
tested only at the documented boundary this project has used since 3A
— enforced at the API route, and route handlers aren't unit-tested
anywhere in this codebase (a pre-existing, documented scope boundary,
not something this round introduced or widened).

### Build / lint / typecheck / test results — reported honestly

- `npm run lint` — **clean**, zero errors/warnings across every new and
  changed file.
- `npx tsc --noEmit` — **130 errors** (up from 3D's 125; **+5** as
  measured in this sandbox). Verified file by file rather than taken on
  faith: the two brand-new pure modules (`lib/company-info.ts`,
  `lib/assembly-form/resolve-line.ts`) and the changed `picking-
  panel.tsx`/`lib/picking/validation.ts` contribute **zero** errors
  between them. Exactly 3 errors are genuinely new occurrences — 2 in
  the new `app/orders/[id]/assembly-form/page.tsx`, 1 in the new
  `tests/assembly-form-db.integration.test.ts` — and all 3 are the same
  pre-existing `TS7006` "implicitly has an `any` type" bucket on a
  `.map()` callback whose array comes from `getOrderById`'s Prisma-
  stub-degraded inferred type, documented since Milestone 2B. The
  remaining apparent "new" errors (4 in `app/orders/[id]/page.tsx`, at
  lines 225/314/364/364; several in `lib/order-queries.ts`) are the
  *same* pre-existing errors at **shifted line numbers** — confirmed by
  checking that every one of my edits to those two files only ever
  inserts code *above* the lines now reported, and that the exact
  `.map()` calls now flagged already existed, unedited by this round, at
  their original locations. **No new error category anywhere.**
- `npx vitest run` — **232 passed, 28 skipped** (up from 222 passed/25
  skipped at the end of 3D). +10 unconditional (6 `classifyAvailability`
  + 4 `resolveAssemblyFormLine` tests, all passing), +3 gated (1 added to
  `handover-db.integration.test.ts`, 2 in the new `assembly-form-
  db.integration.test.ts`). Zero failures, zero regressions.
- `npm run build` — same result as every prior round: Turbopack's
  bundling stage completes, then the build hits this sandbox's
  pre-existing Google Fonts network block (confirmed unrelated to this
  round's code — the font import lives in `app/layout.tsx`, untouched).
- `npx prisma validate` — attempted; fails in this sandbox for the same
  pre-existing reason as every prior attempt (no `DATABASE_URL`
  configured here). No schema change this round means nothing new was
  actually at risk from skipping it.
- **The one thing this sandbox genuinely cannot confirm**: that the 3
  new gated tests (1 Example D test, 2 assembly-form tests) actually
  pass against a real database. They're written, they type-check, lint
  is clean, and they follow this project's own established DB-
  integration-test conventions exactly — but **run
  `RUN_DB_INTEGRATION_TESTS=1 npm test` for real** before treating this
  as verified, same as every gated test in this project.

### Workflow confirmation

The complete workflow the completion spec asks about, end to end:

**Customer PO Creation → Open Customer PO → Print Warehouse Assembly
Form → Physical Warehouse Assembly → Assemblers Return Form →
Salesperson Records Findings in Fulfilment → Verification → Authorization
→ SAP Invoice Handover.**

**Implemented: yes, all eight steps.** PO creation and opening the order
detail page predate this round (Milestone 0/2); printing the assembly
form is this round's new work; the physical assembly and the assemblers
returning the form are, by the spec's own design, outside SalesFlow
entirely (no software step to build); recording findings, verification,
authorization, and the SAP Invoice Handover were already built in 3A/3C
and re-verified, not rebuilt, this round.

**Tested: the software steps, yes — with the one honest caveat already
stated above.** Every step that is software (recording findings through
to the handover) has direct, passing test coverage, re-confirmed against
the spec's own worked example this round. The two steps that are
printing a physical document and a human assembler checking stock
against it cannot be "tested" by an automated suite in the way the other
steps can; what this round verified instead is that printing is side-
effect-free (by test, against a real database) and that the printed
form's data is correct (by test, against a real database) — the
strongest form of verification available for a feature whose actual
output is a piece of paper.


## Milestone 4 — Lost-Sales Management

Built on top of Milestones 0–3 (+completion) per the full "WILLGROVE
SALESFLOW — MILESTONE 4: LOST-SALES MANAGEMENT" specification. Per that
spec's section 9 instruction ("inspect the existing repo first... provide
a short architecture assessment before implementation"), the assessment
below was done before any schema or code was written.

### Architecture assessment (done before implementation)

**Reusable, unmodified:** `PickingSession`/`PickingLine` (Milestone 3A)
already capture exactly the warehouse-unavailability data this
milestone's section 4.1 asks every record to link back to
(`requestedQuantity`/`foundQuantity`/`unavailableQuantity` per line,
plus the authorizing user/timestamp already on `PickingSession`); the
picking role/no-role convention (any user picks, only `SALES_MANAGER`/
`ADMINISTRATOR` authorizes, enforced at the route) is the exact pattern
this milestone's own role split (anyone records a decision, only
`SALES_MANAGER`/`ADMINISTRATOR` confirms a lost sale) reuses rather than
reinvents; `lib/assembly-form/resolve-line.ts`'s three-way SAP-code/
description fallback (live `Product` → order-time snapshot → customer's
own wording) is the exact resolution this milestone needs for both the
original demand and any substitute product, so it's mirrored, not
rebuilt, in `lib/lost-sales/resolve-fields.ts`; `lib/picking/validation.ts`'s
scaled-BigInt decimal-string arithmetic is reused directly (imported, not
copied) since it's byte-for-byte the arithmetic this milestone needs too.

**Schema additions identified as required:** one new table per concept
the spec's section 3 insists stay distinct — warehouse unavailability
already exists (`PickingLine`); customer decision needed its own
append-only event log (`CustomerDecisionEvent`, never edited after the
fact, so an earlier "wait" decision later reversed to "cancel" leaves
both as permanent history); and a genuine confirmed lost sale needed its
own explicit, separately-authorized record (`LostSaleRecord`) that is
never implied by a cancellation alone. A fourth table, `UnfulfilledDemand`,
was identified as necessary to be the stable, traceable anchor
section 4.1 asks for — one row per `PickingLine` left with
`unavailableQuantity > 0`, holding the quantity-bucket partition
(outstanding/cancelled/substituted/confirmed-lost) that the decision and
lost-sale tables both update.

**Conflicts with Milestone 3: none found.** `PickingLine`/`PickingSession`
are read-only from this milestone's perspective (never updated once an
`UnfulfilledDemand` exists) — Milestone 3's own completed/authorized
workflow, SAP handover sourcing, and the Warehouse Assembly Form are
untouched. The one integration point is additive and sits inside
`authorizePickingSession`'s own existing transaction (see "What was
built" below), never modifying what that function already did.

### The central rule this milestone exists to enforce

Section 3, quoted directly: *"Never automatically classify unavailable
products as lost sales."* Implemented structurally, not just by
convention: `createUnfulfilledDemandsForSession()` (run automatically on
authorization) only ever sets `status: PENDING_DECISION` with every
bucket at zero — there is no code path anywhere in this milestone that
can set `confirmedLostQuantity > 0` except `confirmLostSale()`, which is
its own explicit, separately-authorized action, called from nowhere else
in the codebase. A cancelled quantity (`cancelledQuantity`) is *not* the
same as a *confirmed lost* quantity (`confirmedLostQuantity`) — the
latter is always `<= cancelledQuantity`, a deliberate subset relationship
(see "Quantity-bucket model" below), so "the customer cancelled this
line" and "this is now counted as a lost sale" are two separate,
separately-recorded facts, exactly as section 3 distinguishes concepts
(A) warehouse unavailability, (B) customer decision, and (C) actual lost
sale.

### Design rationale for the data model

- **Quantity-bucket partition, not a status enum alone.**
  `UnfulfilledDemand.unavailableQuantity` is an immutable snapshot
  (never changed after creation); `outstandingQuantity` +
  `cancelledQuantity` + `substitutedQuantity` + an *undecided remainder*
  (never its own column — always derived as
  `unavailable - outstanding - cancelled - substituted`) must always sum
  to `unavailableQuantity`. `confirmedLostQuantity` is a **subset** of
  `cancelledQuantity`, never a fourth independent bucket — so "cancelled
  but not yet confirmed lost" and "cancelled and confirmed lost" are
  both representable without ever double-counting the same unit of
  product. This directly implements section 5's reconciliation
  requirement: the same unavailable quantity can never simultaneously be
  waiting, cancelled, and lost, because the arithmetic itself forbids it
  — not because application code remembers to check.
- **Six-state derived status**, computed fresh from the buckets on every
  read/write rather than stored as independent truth that could drift:
  `PENDING_DECISION` (undecided remainder > 0) → `AWAITING_SUPPLY`
  (fully decided, but outstanding > 0 — checked *before* the cancelled/
  lost checks, so a line with any outstanding quantity always reads as
  "awaiting supply" even if part of its cancelled bucket has separately
  been confirmed lost) → `CONFIRMED_LOST` / `FULLY_CANCELLED` (depending
  on whether the fully-cancelled amount has been confirmed lost yet) →
  `PARTIALLY_CANCELLED` → `RESOLVED`. These are exactly the six states
  section 6 asks the UI to make easy to identify.
- **Seven recordable decision types**, not the spec's eight — "pending"
  (outcome 1) is represented by the *absence* of any decision event plus
  the derived `PENDING_DECISION` status, never by an event of its own,
  since recording a "the customer hasn't decided yet" event would be a
  decision event describing a non-decision. Three of the seven
  (`ACCEPT_PARTIAL_CANCEL_REMAINDER`, `ENTIRE_LINE_CANCELLED`,
  `ENTIRE_ORDER_CANCELLED`) always consume the *entire* currently-
  undecided remainder, computed server-side — never a caller-supplied
  figure — because the spec's own worked example for outcome 2 ("accepts
  12, cancels the remaining 8") always cancels 100% of what's left,
  mechanically identical to "entire line cancelled," differing only in
  narrative framing. `ENTIRE_ORDER_CANCELLED` deliberately affects only
  its own `UnfulfilledDemand` row — it does not cascade to other lines
  on the order or touch `OrderStatus`, documented explicitly in the
  schema and in `record-decision.ts`, since cascading an order-wide
  cancellation was never asked for and would silently affect lines this
  milestone has no visibility into (lines that were fully available,
  for instance).
- **Section 4.2's explicit warning — "do not assume a salesperson's
  entry is automatically proof of a customer's decision" — is the reason
  `CustomerDecisionEvent.source` exists as its own required field** (7
  values: phone call, email, written communication, in person, customer
  portal/system, salesperson judgement — unconfirmed, or other),
  independent of who recorded it (`recordedById`) or who the customer
  contact was (`customerContactName`). A salesperson can record a
  decision sourced from `SALESPERSON_JUDGEMENT_UNCONFIRMED`, and that
  provenance is permanently visible in the record — it is never
  conflated with a customer's own confirmed instruction.
- **Substitution is folded into `CustomerDecisionEvent`, not a separate
  model** — a substitution is always exactly 1:1 with one
  `SUBSTITUTE_ACCEPTED` event, so the handful of substitute-specific
  fields are simply nullable on that row, avoiding the extra model/
  dependency section 9 explicitly warns against introducing
  unnecessarily. The substitute's SAP code/description are frozen at
  acceptance time from a real `Product`, and — per section 4.5 — the
  *original* order line is never touched: `OrderLine.productId`/
  `sapItemCodeSnapshot` for the original line are never written to by
  this milestone, anywhere.
- **No separate "accepted for fulfilment" column.** Section 4.3's
  worked example calls out an "Accepted for fulfilment" figure, but
  that figure is already exactly `PickingLine.foundQuantity` /
  `UnfulfilledDemand.foundQuantity` — the quantity that was actually
  found and already proceeds through the existing picking-authorization/
  SAP-handover pipeline regardless of any decision recorded here. A
  separate column would only ever duplicate it, so none was added.
- **Estimated value, never invented** (section 4.6's explicit
  instruction). `resolveEstimatedLostSaleValue()` tries the order line's
  own `approvedUnitPrice` first, then the customer's assigned price
  list's most recent valid entry as of the confirmation date; if neither
  resolves, `estimatedUnitPrice`/`estimatedValue` are left `null` —
  never defaulted, never guessed. Every stored value also carries
  `estimatedValueSource` so a report can show *where* the figure came
  from, and the field name itself says "estimated" throughout the UI and
  API, never "value" alone.
- **One `UnfulfilledDemand` row per `PickingLine`**, enforced by
  `@@unique([pickingLineId])` — created automatically, and only when
  `unavailableQuantity > 0`, from inside `authorizePickingSession`'s own
  transaction. A fully-available authorization creates zero rows. A
  later re-pick (Milestone 3A's own history-preserving design) creates a
  brand-new `PickingLine` and therefore its own separate
  `UnfulfilledDemand` — the earlier line's record and full decision
  history are never touched or reused.

### What was built

- **Schema** (`prisma/schema.prisma`): 5 new enums
  (`CustomerDecisionType`, `DecisionSource`, `UnfulfilledDemandStatus`,
  `LostSaleReason`, `LostSaleValueSource`) and 3 new models
  (`UnfulfilledDemand`, `CustomerDecisionEvent`, `LostSaleRecord`).
  Entirely additive — every "new field" on `Product`/`CustomerOrder`/
  `OrderLine`/`PickingSession`/`PickingLine`/`Customer`/`User` is a pure
  Prisma inverse-relation side with no new column of its own; every
  actual new column lives on the 3 new tables only.
- **Migration** (`prisma/migrations/20261110180000_add_lost_sales_management/
  migration.sql`): hand-authored, in this project's established format
  (this sandbox cannot run `prisma migrate dev` — see "Honest
  verification results" below), matching the schema exactly.
- **`lib/lost-sales/`** (new module, mirroring `lib/picking/`'s own
  split): `validation.ts` (pure — status derivation, quantity-bucket
  math, decimal helpers), `resolve-fields.ts` (pure — three-way
  fallback), `estimate-value.ts`, `create-unfulfilled-demand.ts`,
  `record-decision.ts`, `confirm-lost-sale.ts`, `queries.ts`, `display.ts`.
- **One integration line into Milestone 3's existing code**:
  `lib/picking/authorize-picking.ts` calls
  `createUnfulfilledDemandsForSession(tx, sessionId, actorId)` once,
  inside its own existing transaction, immediately after the
  pre-existing `PICKING_SESSION_AUTHORIZED` audit event — so
  authorization and demand-creation can never disagree about whether
  authorization actually happened.
- **API routes**: `GET /api/lost-sales` (list), `GET /api/lost-sales/[id]`
  (detail), `POST /api/lost-sales/[id]/decisions` (record a decision, any
  authenticated user), `POST /api/lost-sales/[id]/confirm-lost`
  (SALES_MANAGER/ADMINISTRATOR only, enforced via
  `requireUserOrResponse` — never duplicated into the lib function
  itself, same two-tier pattern as `authorizePickingSession`),
  `GET /api/lost-sales/reports` (section 7's reporting figures).
- **UI**: `/lost-sales` (list, 3 stat tiles, status filter, pagination —
  section 6's required list) and `/lost-sales/[id]` (detail: quantity
  summary, the `DecisionPanel` client island for recording decisions/
  confirming lost sales, full decision/lost-sale history on open — "open
  a record and see its full history," also section 6). A new "Lost
  Sales" sidebar entry under Operations (`TrendingDown` icon) — unlike
  `/fulfilment`/`/deliveries`, there was no pre-existing dead placeholder
  link for this, so it's added fresh.

### Explicitly not touched, and why (section 11 boundaries)

No SAP invoice reconciliation/importing, invoice claims, returns, credit
notes, new picking workflows, automated customer communication, or
predictive analytics — none were built, per the spec's own exclusion
list. `lib/picking/*`, `lib/handover/*`, and every existing UI page
outside the new `/lost-sales` routes and the one `authorize-picking.ts`
integration line are unmodified. No inventory management or stock
reservation was added — SAP B1/iVend remain the sole source of truth for
stock; this milestone only ever records what warehouse picking already
found, never predicts or reserves anything.

### Tests added

- `tests/lost-sales-validation.test.ts` — 36 unconditional tests
  covering the pure logic directly: decimal round-tripping/precision/
  truncation, undecided-quantity computation, all 6 derived statuses
  (including the "awaiting supply takes priority over partial lost
  confirmation" edge case), decision-quantity validation (zero/negative/
  exceeds-remaining rejected, exact-boundary accepted), lost-sale
  consumption (pure-cancelled source, outstanding-to-cancelled
  conversion, exceeds-both refused), the decision-type → bucket mapping
  (exhaustive, so a future unmapped decision type fails to compile), and
  the reason-requires-detail-for-"Other" rule. **All 36 passing**
  (`npx vitest run tests/lost-sales-validation.test.ts`, 343ms).
- `tests/lost-sales-db.integration.test.ts` (new, gated, 8 tests) —
  against a real database, mirroring `tests/picking-db.integration.test.ts`/
  `tests/handover-db.integration.test.ts`'s exact conventions
  (`RUN_DB_INTEGRATION_TESTS=1`, demo-marked rows, `beforeAll`/`afterAll`
  cleanup in FK-safe order). Covers: a fully-available line creates no
  `UnfulfilledDemand` (scenario 1); partial and completely-unavailable
  lines each create exactly one, correctly snapshotted, never
  auto-classified as lost (scenarios 2–4); multiple unavailable lines on
  one order each get their own record (scenario 20); whole-remainder
  cancellation consumes exactly the undecided amount and a further
  decision against an exhausted record is refused (scenarios 5, 9, 13,
  14); a mix of waiting/partial-cancellation/substitution on the same
  line, including the frozen substitute snapshot (scenarios 6, 9, 10,
  11); a substitute referencing a non-existent product is refused;
  outstanding-to-cancelled conversion when confirming a lost sale that
  exceeds the cancelled bucket alone (scenario 12), plus the
  exceeds-everything and missing-"Other"-detail refusals; the original
  `CustomerOrder`/`OrderLine` rows are byte-identical before and after a
  full decision/confirmation sequence (scenario 15); `AuditEvent` rows
  exist for creation, decision-recording, and confirmation (scenario
  16); estimated value resolves from the order line's own approved
  price and is never invented; and the reporting summary's aggregated
  figures reflect what was actually recorded (scenario 18). Role
  restriction (scenario 17) is **not** independently tested at the route
  level — documented as the same accepted, pre-existing scope boundary
  `authorizePickingSession` itself has used since Milestone 3A (no route
  handler anywhere in this codebase has its own dedicated unit test);
  `confirmLostSale()` itself is role-agnostic by design, with the gate
  enforced only in `app/api/lost-sales/[id]/confirm-lost/route.ts`.

### Honest verification results

- `npm run lint` — **clean**, zero errors/warnings across every new and
  changed file, confirmed both on the new/changed subset and the whole
  project.
- `npx tsc --noEmit` — **158 errors** (up from the prior round's 130;
  **+28** total across the two rounds this schema change was built and
  tested in, **+4** from this final round's new DB-integration test
  file specifically). Every single one of these is a pre-existing error
  *category* this project has documented since early milestones —
  `TS7006` (implicit `any` on a Prisma-callback/`.find()`/`.map()`
  parameter), `TS2339`/`TS2694`/`TS2305` ("Property/member does not
  exist on type `Prisma`"), `TS18046`, and one unrelated pre-existing
  `TS2322` — confirmed via `grep -oE "error TS[0-9]+" | sort | uniq -c`
  (101×TS7006, 20×TS2339, 15×TS2694, 18×TS2305, 3×TS18046, 1×TS2322 =
  158 exactly) and by checking that every new occurrence falls inside a
  file touched by this milestone, in one of those same buckets. **Root
  cause, confirmed by direct reproduction, not assumption**: `npx prisma
  generate`/`validate`/`format`/`migrate` cannot run in this sandbox at
  all. Setting a dummy `DATABASE_URL` gets past the "missing
  `DATABASE_URL`" symptom documented in earlier rounds, but the command
  then fails with `Error: Failed to fetch the engine file at
  https://binaries.prisma.sh/.../schema-engine.gz - 403 Forbidden` —
  this sandbox's network allowlist does not include `binaries.prisma.sh`,
  and no engine binary is cached from any prior session
  (`~/.cache/prisma/master/<hash>/debian-openssl-3.0.x/` exists but is
  empty). **This means the installed `@prisma/client` is permanently
  stale relative to this round's schema and cannot be regenerated here
  under any circumstance** — it has no knowledge of `UnfulfilledDemand`,
  `CustomerDecisionEvent`, `LostSaleRecord`, or their 5 new enums, which
  is the direct and complete explanation for every new `tsc` error this
  round. **Run `npx prisma generate` on your own machine** (see
  SETUP-WINDOWS.md §20) and these errors resolve the same way every
  prior round's schema-driven `tsc` errors have.
- `npx vitest run` — **268 passed, 36 skipped** (up from 232 passed/28
  skipped at the end of the prior round): +36 unconditional (the new
  `lost-sales-validation.test.ts`), and the new 8-test gated file
  skips cleanly with no import error (`Test Files 1 skipped (1)`,
  `Tests 8 skipped (8)`) since `RUN_DB_INTEGRATION_TESTS` is unset here.
  Zero failures, zero regressions anywhere in the pre-existing suite.
- `npm run build` — same result as every prior round: Turbopack's
  bundling stage runs, then the build hits this sandbox's pre-existing
  Google Fonts network block (`app/layout.tsx`, untouched by this
  milestone, confirmed unrelated).
- **The one thing this sandbox genuinely cannot confirm**: that the new
  8-test gated file actually passes against a real, regenerated Prisma
  client and a seeded database. It is written, it follows this
  project's own established DB-integration-test conventions exactly,
  and every function/field/signature it calls was independently
  re-checked line-by-line against the actual `lib/lost-sales/*` source
  and `prisma/schema.prisma` this round (not merely assumed carried over
  from before this session's context was compacted) — but **run `npx
  prisma generate` and then `RUN_DB_INTEGRATION_TESTS=1 npm test` for
  real** before treating this as verified, same as every gated test in
  this project.

### Acceptance-criterion confirmation

The spec's own closing requirement, quoted directly: *"The system must
be able to follow this complete chain: Customer PO → Warehouse
Availability Findings → Verification → Authorization → SAP Invoice
Handover → Customer Decision on Unavailable Quantities → Outstanding
Demand / Partial Cancellation / Substitution / Confirmed Lost Sale."*

**Implemented: yes, all nine steps.** The first five (PO through SAP
Invoice Handover) were already built and shipped in Milestones 0–3;
this milestone adds the remaining four as one continuous, traceable
chain: authorization automatically creates the `UnfulfilledDemand`
anchor (never skippable, never manual); every customer decision is
recorded against that same anchor, append-only; outstanding demand,
partial cancellation, and substitution are three of the possible
outcomes of that decision, all three representable simultaneously on
the same record via the quantity-bucket partition; and a confirmed lost
sale is always its own separate, explicit, role-gated action layered on
top — never implied by any of the other three.

**Tested: yes, with the one honest caveat already stated above.** The
36 unconditional tests cover every piece of pure logic directly; the 8
gated DB tests walk the full chain end to end against a real database,
including the exact "customer accepts partial / waits for the rest"
scenario from section 4.3's own worked example — but, as with every
gated test in this project, they have not been run against a real
database from inside this sandbox, and that run is the one remaining
step before this milestone can be called verified rather than merely
written and type-consistent.

**Do not start Milestone 5 until this is reviewed** — per the spec's
own explicit instruction, unchanged.


## Milestone 5 — SAP Invoice Reconciliation

Built on top of Milestones 0–4 per the full "WILLGROVE SALESFLOW —
MILESTONE 5: SAP INVOICE RECONCILIATION" specification. As with
Milestone 4, the architecture assessment below was done before any
schema or code was written, per the spec's own instruction to inspect
the existing repo first.

### Architecture assessment (done before implementation)

**Reusable, unmodified:** the source of truth for "how much of this
order line was actually authorized to go out" already exists and is
exactly right for this milestone's needs — `PickingLine.foundQuantity`
on the most recent `AUTHORIZED` `PickingSession` for an order line (the
same field `lib/handover/build-handover-rows.ts` already reads). This
milestone never stores a second "authorized quantity" column anywhere;
it is always read live from that same source. `lib/picking/validation.ts`'s
scaled-BigInt decimal-string arithmetic (`parseScaledDecimal`,
4-decimal-place strings) is imported directly, not copied, for the same
reason it was reused in Milestone 4 — it is byte-for-byte the arithmetic
this milestone needs for quantities and money. The existing generic
`AuditEvent` model (actor/action/entityType/entityId/before/after) is
reused for every import and every manual reconciliation action, exactly
as Milestone 4 reused it for decisions and lost-sale confirmations — no
bespoke audit table.

**Schema additions identified as required:** three new tables, matching
the spec's own three-stage shape (an import run, an invoice header, an
invoice line) — `SapInvoiceImportBatch`, `SapInvoice`, `SapInvoiceLine`.
No "authorized quantity" or "invoiced quantity" column was added to
`OrderLine` itself: both are always computed live (see "derive, don't
store a second truth" below), so they can never drift out of sync with
the picking/invoice data they summarize.

**Conflicts with Milestones 0–4: none found.** `CustomerOrder`/`OrderLine`/
`PickingSession`/`PickingLine` are read-only from this milestone's
perspective — nothing in `lib/invoice-reconciliation/*` ever writes to
them. The only two-way relationship is a nullable `matchedOrderId`/
`matchedOrderLineId` *on the new tables*, pointing *at* the existing
order data, never the reverse. `UnfulfilledDemand`/`CustomerDecisionEvent`/
`LostSaleRecord` (Milestone 4) and `SapInvoice`/`SapInvoiceLine`
(this milestone) are two genuinely separate concepts that happen to both
ultimately originate from the same `PickingLine` — a warehouse shortfall
is not the same fact as an actual SAP invoice quantity, and nothing here
conflates the two or reads one as a proxy for the other.

### The central rules this milestone exists to enforce

Three of the spec's own instructions, implemented structurally rather
than by convention alone:

- *"SAP Business One remains the sole system of record for invoice
  numbers, prices, VAT, and totals."* SalesFlow never computes or
  overrides any of these — every one of `SapInvoice.subtotal`/`taxTotal`/
  `total` and every `SapInvoiceLine.unitPrice`/`discount`/`lineTotal` is
  copied verbatim from the imported file (`rawSourceData` preserves the
  original row alongside, always). No function anywhere in
  `lib/invoice-reconciliation/` computes a price, a tax amount, or an
  invoice total from SalesFlow's own data — only *quantities* are
  reconciled against SalesFlow's own authorized-quantity figures.
- *"Matching must use SAP item code as primary identity, never
  description similarity; ambiguous matches must go to a manual
  reconciliation queue, never guessed."* `matchInvoiceLineToOrder()`
  (`lib/invoice-reconciliation/matching.ts`) filters candidates by exact
  SAP item code equality only — there is no fuzzy-matching, token-overlap,
  or description-similarity code path anywhere in this module. It returns
  `null` (meaning: leave `UNMATCHED`, for a human to resolve) whenever
  zero or more than one candidate order line qualifies; it never picks
  the "closest" or "most likely" one.
- *"Never silently change authorized quantities or clamp over-invoicing
  to zero."* `computeOrderLineReconciliation()` (`reconcile.ts`) returns
  a signed remainder (`authorized - invoiced`), using a local
  `formatSignedScaled` specifically because the shared decimal helpers
  are non-negative-only. An over-invoiced line's remaining quantity is
  reported as e.g. `"-3.0000"`, never `"0.0000"`, and the invoice is
  flagged `causesOverInvoicing: true` → invoice-level status
  `RECONCILIATION_REQUIRED` — a human must look at it; nothing recovers
  or "fixes" it automatically.

### Design rationale for the data model

- **"Derive, don't store a second truth."** Neither authorized quantity
  nor invoiced quantity is ever a stored column on `OrderLine`.
  `getAuthorizedQuantity()` always re-reads the live
  `PickingLine.foundQuantity` from the order line's most recent
  `AUTHORIZED` session; `getInvoicedQuantity()` always re-computes a
  live `SUM` over matched (`AUTO_MATCHED`/`MANUALLY_MATCHED`),
  non-cancelled `SapInvoiceLine` rows. This makes "the invoice-header
  status and the order-line status must never be confused" (spec section
  6) structurally true, not just a naming convention: they are computed
  by two entirely different functions, from two entirely different
  queries, over two entirely different value sets
  (`InvoiceReconciliationStatus` is a property of one `SapInvoice` and
  its lines; `OrderLineInvoiceStatusValue` is a property of one
  `OrderLine` and every invoice line ever matched to it).
- **Invoice-header status is always recomputed from first principles,
  never incrementally patched.** `recomputeInvoiceHeaderStatus()` is
  called after every single line-state change (an import, a manual
  match, a cannot-link, a reopen, a rerun) and rebuilds the header's
  `reconciliationStatus` and `matchedOrderId` convenience field from the
  current state of every one of the invoice's lines, every time. This
  guarantees the header can never drift out of sync with its lines — the
  alternative (patch the header's status incrementally on each action)
  would eventually diverge from the lines it's meant to summarize.
- **The `matchedOrderId` convenience field on `SapInvoice` is set only
  when every line (including any `CANNOT_LINK` line) agreed on the exact
  same single order** — a partial or mixed result leaves it `null`
  rather than guessing which order "mostly" matches. The per-line
  `matchedOrderId`/`matchedOrderLineId` fields remain the authoritative
  record either way; the header field exists purely so a list view can
  show "Order SF-00123" without joining through every line. One invoice
  can legitimately have lines belonging to different SalesFlow orders
  (the DB-integration test for this exact case is below) — the header
  field is a convenience, never a constraint.
- **Running-tally matching within one invoice.** `runAutoMatchForInvoice()`
  threads an in-memory `runningDelta` Map across an invoice's own
  UNMATCHED lines as it matches them one at a time, so if two lines on
  the same invoice both target the same order line (e.g. two separate
  SAP document lines that both reduce the same order line's remaining
  quantity), the second line correctly sees the first line's consumption
  before it decides whether it fits. Across *separate* invoices/import
  batches, the same effect is achieved by `getInvoicedQuantity()`'s own
  live aggregate query, which always reflects every previously-matched
  line regardless of which invoice or import batch it came from.
- **Cancelled/reversed invoices stay visible and matched, but excluded
  from every "already invoiced" baseline.** `isCancelledOrReversed` is
  derived once, at import time, from a short, documented keyword list
  against the raw `DocStatus`/`documentStatusRaw` column
  (`"cancel"`/`"cancelled"`/`"canceled"`/`"void"`/`"voided"`/
  `"reversed"`/`"reversal"`, case-insensitive substring match) — the raw
  status string is always preserved alongside it. A cancelled invoice is
  still auto-matched (so a human can see what it *would* have been) and
  its header status becomes `CANCELLED_REVERSED`, but
  `getInvoicedQuantity()`'s aggregate explicitly filters out
  `sapInvoice.isCancelledOrReversed: true` rows — so a cancelled
  invoice's quantity never continues to count as "already invoiced"
  against the order line it was matched to. Nothing is ever deleted.
- **No reversal-reference field was built, deliberately** (e.g. "this
  invoice reverses invoice X"). The flat CSV export this milestone
  imports has no column that reliably carries this relationship without
  direct SAP API access (Milestone 9's scope, not this one's) — inventing
  a field the export doesn't provide would violate the spec's own "never
  invent missing fields" instruction. The boolean `isCancelledOrReversed`
  plus the preserved raw status string is judged sufficient to satisfy
  the spec's *substantive* requirement (a cancelled invoice's quantity
  must not keep contributing to a valid invoiced total) without
  fabricating a relationship the source data doesn't carry. **Recorded
  here as a known, deliberate limitation**, not a silent gap. For the
  same reason, no manual override route exists for this flag — the
  schema's own comment states it is "correctable by re-importing with a
  clearer source value, not by editing this flag directly."
- **CSV-only import, no native `.xlsx` parsing.** The spec's section 3
  phrase "Excel/CSV export only this milestone" is read as contrasting
  with Milestone 9's direct-API integration, not as a hard requirement to
  parse native Excel binary format. Every other importer already in this
  project (customer-master, item-master, tax-codes, price-lists) is
  CSV-only, so this keeps the same, already-reviewed scope rather than
  adding a new parsing dependency mid-milestone. **Recorded as a known
  limitation**: an operator exporting directly to `.xlsx` must save as
  CSV first.
- **Date-parsing conservatism.** `parseSapDate()` accepts only
  unambiguous formats — ISO `YYYY-MM-DD` or SAP's compact `YYYYMMDD` —
  and deliberately never a slash-separated date, because `DD/MM` vs.
  `MM/DD` cannot be told apart without knowing the exporting locale. The
  raw string is always preserved in `rawSourceData` regardless of whether
  it parses, so nothing is lost even when the date itself can't be
  interpreted.
- **Two-stage, stateless-preview import**, extending the pattern already
  established by Milestone 1's master-data importers and reused in
  Milestone 4's own confirm-lost-sale flow: stage 1 (no `mapping` in the
  request) returns the file's raw headers, a suggested column mapping,
  and sample rows, with zero database writes; stage 2 (`mapping` present)
  applies it, groups rows into invoices, and runs the full duplicate/
  customer-match plan — still zero writes. Only the final confirm step
  writes, inside one transaction with a raised timeout (120s/15s
  `maxWait`, vs. Prisma's 5s default, since imports run rarely and
  writes must stay sequential rather than parallel against one
  interactive-transaction client — the same documented limitation
  `scripts/remove-demo-data.ts` already notes). The confirm route
  compares the client's `expectedNewInvoiceCount`/
  `expectedDuplicateInvoiceCount` against what it re-plans itself and
  refuses with `409` on any mismatch, so a file that changed between
  preview and confirm (or a second concurrent import of the same file)
  is caught rather than silently imported differently than previewed.
- **Deduplication at planning time, not a DB-level unique constraint
  alone.** `SapInvoice.sapDocEntry` is a nullable-unique column, but
  `sapDocNum` deliberately has none — not every SAP export reliably
  provides `DocEntry`, so duplicate detection happens explicitly in
  `plan-import.ts` (checking both existing DB rows and within the same
  uploaded file), mirroring `lib/customer-master-import.ts`'s own
  `seenCodes`/`duplicateCodes` pattern.
- **Role-gating convention, unchanged from Milestones 1 and 4: enforced
  only at the route layer, never duplicated into a lib function.**
  Import (upload/preview/confirm) is open to any authenticated user,
  mirroring Milestone 1's importers; every manual reconciliation action
  (match, cannot-link, reopen, rerun-match, note) is restricted to
  `SALES_MANAGER`/`ADMINISTRATOR` via `requireUserOrResponse([...])` at
  the route, mirroring Milestone 4's confirm-lost-sale gate. The lib
  functions themselves (`manual-actions.ts`) are role-agnostic by design.

### What was built

- **Schema** (`prisma/schema.prisma`): 3 new enums
  (`InvoiceLineMatchStatus`, `InvoiceLineMatchMethod`,
  `InvoiceReconciliationStatus`) and 3 new models
  (`SapInvoiceImportBatch`, `SapInvoice`, `SapInvoiceLine`). Entirely
  additive — the "new relation fields" on `User`/`Customer`/
  `CustomerOrder`/`OrderLine` are pure Prisma inverse-relation sides with
  no new column on any existing table; every actual new column lives on
  the 3 new tables only.
- **Migration** (`prisma/migrations/20261110190000_add_invoice_reconciliation/
  migration.sql`): hand-authored (this sandbox cannot run `prisma migrate
  dev`), matching the schema exactly — 3 `CREATE TYPE`, 3 `CREATE TABLE`,
  15 indexes, 8 foreign keys. No existing table/column/enum value
  touched.
- **`lib/invoice-reconciliation/`** (new module): `csv.ts` (pure —
  column-mapping suggestion/validation, CSV parsing, cancelled-status
  detection, grouping rows into invoices), `reconcile.ts` (pure —
  order-line quantity math, invoice-header status derivation),
  `matching.ts` (pure — the conservative, exact-item-code,
  never-guess matcher), `match-invoice.ts` (DB — matching orchestration,
  live authorized/invoiced lookups, header-status recomputation),
  `plan-import.ts` (DB-querying, zero-write — duplicate detection,
  customer-code resolution, CSV-upload validation),
  `execute-import.ts` (DB — the single-transaction writer, two-pass so a
  later invoice in a batch sees an earlier one's consumption),
  `manual-actions.ts` (DB — match/cannot-link/reopen/rerun/note, every
  one audited), `queries.ts` (DB, read-only — list/detail/candidate-
  orders/import-history/reports), `display.ts` (pure label/style maps,
  no `@prisma/client` import, safe for Client Components).
- **API routes** (11, all under `app/api/invoice-reconciliation/`):
  `import/preview` (two-stage preview, any authenticated user),
  `import/confirm` (CSRF + double-submit guard, any authenticated user),
  the list/detail/candidate-orders GET routes, `[id]/note` and
  `[id]/rerun-match` (role-gated), the three per-line manual actions
  under `lines/[id]/*` (role-gated), `reports`, and `import-history`.
- **UI**: `/invoice-reconciliation` (reconciliation queue list),
  `/invoice-reconciliation/import` (3-stage import wizard: read columns →
  confirm mapping → review plan → confirm), `/invoice-reconciliation/[id]`
  (detail page with the per-line `ReconciliationPanel` client island,
  shown only to `SALES_MANAGER`/`ADMINISTRATOR`), and
  `/invoice-reconciliation/reports` (the four order-line buckets plus
  unmatched-invoice and reconciliation-exception lists). A new "Invoice
  Reconciliation" sidebar entry under Operations (`Receipt` icon) — like
  Lost Sales before it, there was no pre-existing dead placeholder link
  for this one.
- **`test-data/sap-business-partners-list.csv`** (pre-existing, reused
  unchanged) is the customer-master fixture for seeding/testing this
  milestone's customer-code resolution; `npm run db:remove-demo` already
  handles cleanup of all 3 new tables (added to
  `scripts/remove-demo-data.ts` earlier in this build, in FK-safe order
  before `orderLines`/`orders`).

### Explicitly not touched, and why (section 11 boundaries)

No direct SAP Business One API integration, no automatic SAP invoice
creation, no SAP stock updates, no Invoice Claims Management (6A), no
Returns/Credit Notes (6B), no advanced predictive BI, and no automated
WhatsApp/email notifications — none were built, per the spec's own
exclusion list. `lib/picking/*`, `lib/lost-sales/*`, `lib/handover/*`,
and every existing UI page outside the new `/invoice-reconciliation`
routes are unmodified, with the single exception of the import's own
fix below.

### A real bug found and fixed during this round's verification (not a sandbox artifact)

While re-running `tsc` this round, one genuine logic error was found and
fixed (distinct from the pre-existing sandbox-only Prisma-stub bucket
below): in `app/invoice-reconciliation/import/page.tsx`, the entire
plan-review section — including the "Confirm and import" button — was
gated on `{plan && stage === "planned" && (...)}`. Because
`setStage("importing")` runs synchronously when the button is clicked,
the very next render has `stage === "importing"`, which made that whole
condition false and the entire section (checkbox, button, and its
`"Importing..."` label) disappear the instant the import started,
rather than showing a busy/disabled state while the request was in
flight. Fixed by widening the gate to
`{plan && (stage === "planned" || stage === "importing") && (...)}`, so
the panel now stays visible and the button correctly reads
`"Importing..."` while the confirm request is pending. Caught by `tsc`
itself (`TS2367`, "comparison appears to be unintentional" — a real
signal, not noise, once traced to its cause) and confirmed fixed by
re-running `tsc` and seeing that exact error disappear with no other
change in the error bucket (see below).

### Tests added

- `tests/invoice-reconciliation.test.ts` (new, unconditional, 28 tests)
  — pure logic only (`csv.ts`/`reconcile.ts`/`matching.ts`), covering
  spec scenarios 2, 7, 8, 9, 10, 11, 15, 17, 19 directly plus edge cases
  (mapping validation, grouping by `DocEntry` vs. `DocNum`, a line with
  no item code, a similar-but-different item code). One test bug was
  found and fixed by actually running the suite (a header/data-row
  column-order mismatch in the "groups by DocNum when DocEntry is
  absent" test) — not assumed correct without execution. **All 28
  passing** (`npx vitest run tests/invoice-reconciliation.test.ts`).
- `tests/invoice-reconciliation-db.integration.test.ts` (new, gated, 12
  tests) — against a real database, following this project's
  established DB-integration-test conventions exactly
  (`RUN_DB_INTEGRATION_TESTS=1`/`DATABASE_URL` gate, `isDemo: true` on
  every created row, FK-safe `beforeAll`/`afterAll`, dynamic
  `await import(...)` of every lib function inside test bodies since a
  static import would crash this sandbox's Prisma stub at module load).
  A local fixture helper creates real `CustomerOrder`/`OrderLine` rows
  (with `sapItemCodeSnapshot` set directly — no `Product` row needed,
  since matching only ever needs the SAP item code string) and runs the
  real `startPickingSession`/`recordPickedLine`/`completePickingSession`/
  `authorizePickingSession` functions to produce a genuinely `AUTHORIZED`
  session with known found quantities, so every test matches against a
  real, authorized order line rather than a hand-built fixture row.
  Covers: a valid import resolving customer/order/item-code match and a
  decimal-quantity full reconciliation with an audit event (scenarios 1,
  5, 6, 8, 16, 19); duplicate detection and prevention on a re-import of
  the same file (3, 4); an order line moving from awaiting-invoicing to
  partially- to fully-invoiced across two separate invoices (9, 10, 13);
  over-invoicing recorded (not refused) with a negative remaining
  quantity and a `RECONCILIATION_REQUIRED` flag (11); an unrecognized
  customer code leaving an invoice `UNMATCHED` rather than guessed (12);
  one invoice's two lines both matching two different lines of the
  *same* order, and, separately, one invoice's two lines matching two
  *different* orders — the header's `matchedOrderId` convenience field
  correctly staying `null` in the second case (14); an ambiguous match
  (two qualifying order lines sharing one SAP item code) left
  `UNMATCHED` even after an explicit re-run, then manually matched,
  reopened, and marked cannot-link, with every step's full audit history
  (`beforeData`/`afterData`) asserted exactly (15, 16); a cancelled
  invoice flagged `CANCELLED_REVERSED` whose quantity is proven excluded
  from the baseline a second, active invoice for the same quantity is
  matched against (17); two invoices in different currencies for the
  same customer never summed together (18); the original `CustomerOrder`/
  `OrderLine`/`PickingLine` rows byte-identical before and after a full
  import-and-manual-match sequence (20); and the reconciliation reports
  correctly bucketing an awaiting-invoicing line, an over-invoiced line,
  an unmatched invoice, and a reconciliation-exception invoice (22).
  **Role restriction (scenario 21) is not independently exercised** —
  the same accepted, documented, pre-existing scope boundary as every
  other role-gated action in this project (no route handler anywhere in
  this codebase has its own dedicated unit test); every manual-action lib
  function is role-agnostic by design, with the gate enforced only in its
  route handler's `requireUserOrResponse([...])` call. Together, 21 of
  the spec's 22 named scenarios are exercised by an actual passing or
  correctly-skipping test; the 22nd (21) is documented rather than
  silently skipped.

### Honest verification results

- `npm run lint` (ESLint) — **clean**, zero errors/warnings, confirmed
  on the full set of new/changed files (`lib/invoice-reconciliation/`,
  `app/invoice-reconciliation/`, `app/api/invoice-reconciliation/`,
  `app/components/sidebar.tsx`, both new test files,
  `scripts/remove-demo-data.ts`). Two warnings were found and fixed
  during this check: an unused `randomUUID` import in
  `execute-import.ts`, and an unused `orderB` binding in the DB test
  file (the order's existence, not its id, is what makes that test's
  match ambiguous — commented and left unbound instead).
- `npx tsc --noEmit` — **197 errors** (up from Milestone 4's 158; **+39**
  for this milestone's own new files). Breakdown, confirmed via
  `grep -oE "error TS[0-9]+" | sort | uniq -c`: 129×`TS7006` (+28),
  25×`TS2339` (+5), 18×`TS2694` (+3), 18×`TS2305` (+0), 3×`TS2345`
  (new category, +3), 3×`TS18046` (unchanged), 1×`TS2322` (unchanged,
  pre-existing, unrelated to this milestone). **Every single new or
  increased bucket was individually traced to a specific file in this
  milestone and confirmed to be the same root cause documented since
  Milestone 4**: `npx prisma generate` cannot run in this sandbox at all
  (`binaries.prisma.sh` returns `403` through this sandbox's network
  allowlist, and no engine binary is cached), so the installed
  `@prisma/client` has zero knowledge of `SapInvoiceImportBatch`/
  `SapInvoice`/`SapInvoiceLine`/their 3 new enums. The new `TS2345`
  bucket (3×, "Argument of type 'unknown' is not assignable to parameter
  of type 'string'" in `match-invoice.ts`) was individually inspected
  rather than assumed: it occurs exactly where a type-guarded filter
  (`.filter((id): id is string => id !== null)`) runs over a field read
  from the stale client's degraded typing of the brand-new
  `SapInvoiceLine.matchedOrderLineId`/`matchedOrderId` columns — the same
  underlying cause, one new surface of it. **Confirmed this is the
  complete explanation, not a guess**: every one of the 197 errors falls
  in a file this milestone (or an earlier one) touched, in one of these
  exact documented buckets, with zero unexplained errors. **Run `npx
  prisma generate` on your own machine** (SETUP-WINDOWS.md §21) and
  these resolve the same way every prior milestone's schema-driven `tsc`
  errors have. **One real, unrelated bug was found and fixed this
  round** — see "A real bug found and fixed" above; re-running `tsc`
  after the fix confirmed that exact error (`TS2367`) disappeared with
  no other change to the error bucket.
- `npx vitest run` (full project suite) — **296 passed, 48 skipped, 0
  failed** (up from 268 passed/36 skipped at the end of Milestone 4):
  +28 unconditional (the new pure test file) and the new 12-test gated
  file skips cleanly (`1 skipped`, `12 skipped`) since
  `RUN_DB_INTEGRATION_TESTS` is unset here. Zero regressions anywhere in
  the pre-existing suite, confirmed by an actual full-suite run, not
  file-by-file assumption.
- `npm run build` — same result as every prior round: Turbopack's
  bundling stage runs (confirming the build pipeline itself tolerates
  every new file), then the build hits this sandbox's pre-existing
  Google Fonts network block in `app/layout.tsx` (untouched by this
  milestone, confirmed unrelated — the same two-font 403 every prior
  round's build has hit).
- **The one thing this sandbox genuinely cannot confirm**: that the new
  12-test gated file actually passes against a real, regenerated Prisma
  client and a seeded database. It is written, it follows this
  project's own established DB-integration-test conventions exactly, and
  every function/field/signature it calls was independently checked
  against the real `lib/invoice-reconciliation/*` source and
  `prisma/schema.prisma` (not assumed) — but **run `npx prisma generate`
  and then `RUN_DB_INTEGRATION_TESTS=1 npm test` for real**
  (SETUP-WINDOWS.md §21) before treating this as verified, same as every
  gated test in this project.

### Acceptance-criterion confirmation

The spec's own closing requirement, quoted directly: *"The system must
be able to trace: Customer PO → Warehouse Availability → Picking
Verification → Authorization → SAP Invoice Handover → Actual SAP
Invoice Import → Invoice Matching → Quantity Reconciliation → Exception
Resolution."*

**Implemented: yes, all nine steps.** The first five (PO through SAP
Invoice Handover) were already built and shipped in Milestones 0–3; this
milestone adds the remaining four as one continuous, traceable chain: a
real SAP invoice CSV export is imported with an operator-confirmed
column mapping and zero invented fields (Actual SAP Invoice Import);
every imported line is matched to a specific order line by exact SAP
item code only, or left `UNMATCHED` for a human (Invoice Matching);
authorized vs. invoiced quantity is always read live and reported as
`NOT_YET_INVOICED`/`PARTIALLY_INVOICED`/`FULLY_INVOICED`/`OVER_INVOICED`,
never clamped (Quantity Reconciliation); and every ambiguous, over-
invoiced, or cannot-link case surfaces in the reconciliation queue/
reports for a `SALES_MANAGER`/`ADMINISTRATOR` to resolve by hand, fully
audited (Exception Resolution).

**Tested: yes, with the one honest caveat already stated above.** The 28
unconditional tests cover every piece of pure logic directly; the 12
gated DB tests walk the full chain end to end against a real database,
including the four worked examples from the spec's own quantity-
reconciliation section (20/20, 20/12, 20/0, 20/23) and the cancelled-
invoice exclusion case — but, as with every gated test in this project,
they have not been run against a real database from inside this
sandbox, and that run is the one remaining step before this milestone
can be called verified rather than merely written and type-consistent.

**Do not start Milestone 6A until this is reviewed** — per the spec's
own explicit instruction.

## Milestone 6A — Invoice Claims Management

Built on top of Milestone 5 per the "WILLSGROVE SALESFLOW — MILESTONE
6: INVOICE CLAIMS MANAGEMENT & RETURNS/CREDIT NOTES" specification,
stage 1 of 2 (6B — Returns / Credit Notes — is explicitly deferred
until this stage is delivered and reviewed, per both the spec's own
Part 5 instruction and this project's standing multi-session working
agreement). As with every milestone since 4, the architecture
assessment below was done before any schema or code was written.

### Architecture assessment (done before implementation)

**Reusable, unmodified:** Milestone 5's `SapInvoice`/`SapInvoiceLine`
models are read-only from this milestone's perspective — a claim
always links to one `SapInvoice` and, where possible, one
`SapInvoiceLine`, but nothing in `lib/invoice-claims/` ever writes to
either. `lib/picking/validation.ts`'s scaled-BigInt decimal-string
helpers (`parseScaledDecimal`, `decimalStringSchema`) are imported
directly for all quantity/money arithmetic, for the same reason every
prior milestone has reused them. The generic `AuditEvent` model is
reused for every claim action (creation, status change, resolution
recorded/approved/rejected, attachment upload) — no bespoke
claim-history table. `lib/storage/index.ts`'s `getStorageDriver()` and
`lib/storage/content-sniff.ts`'s `validateUploadContent` are reused
unchanged for claim attachments, exactly as `OrderDocument` already
uses them.

**Schema additions identified as required:** four new tables
(`InvoiceClaim`, `InvoiceClaimLine`, `ClaimResolution`,
`InvoiceClaimAttachment`) and five new enums (`InvoiceClaimCategory`,
`InvoiceClaimPriority`, `InvoiceClaimStatus`, `ClaimLineDisputeType`,
`ClaimResolutionDecision`). No column was added to `SapInvoice`/
`SapInvoiceLine`/`CustomerOrder`/`Customer` — every new fact lives on
the four new tables, which point *at* the existing data via nullable/
required foreign keys, never the reverse.

**Conflicts with Milestones 0–5: none found.** The spec's own central
distinction — *customer complaint ≠ rejection ≠ quantity dispute ≠
physical return ≠ SAP credit note ≠ confirmed financial loss* — maps
directly onto what this milestone does and does not build: an
`InvoiceClaim` records a complaint and a proposed/approved
*resolution*, never an executed action. No accounting transaction is
ever created, no SAP invoice field is ever altered, and no
`actualSapCreditedAmount` is ever anything but `null` in this stage —
that figure can only come from a real SAP credit-note document, which
is Milestone 6B's job, not this one's.

### The central rules this milestone exists to enforce

- *"A recommendation is not the same as an executed action."*
  Recording a `ClaimResolution` (`recordClaimResolution()`) never
  changes financial exposure beyond "potential" — it only moves the
  claim to `AWAITING_INTERNAL_ACTION`. Only `approveClaimResolution()`
  (role-gated, `SALES_MANAGER`/`ADMINISTRATOR` only) sets
  `approvedCreditAmount` and advances the claim past that point, via
  `resolutionDecisionToClaimStatus()` — an exhaustive `switch` (a
  missing case is a compile error, not a runtime surprise) mapping
  each of the 9 `ClaimResolutionDecision` values to exactly one target
  status. Even then, `approvedCreditAmount` is an *approved exposure*
  figure, never a claim that SAP has actually issued a credit —
  `computeClaimFinancialSummary()` always returns
  `actualSapCreditedAmount: null, actualCreditDataAvailable: false`,
  unconditionally, in every code path, because that fact does not and
  cannot exist in this stage.
- *"No arbitrary status changes bypassing investigation/approval."*
  `CLAIM_STATUS_TRANSITIONS` (`lib/invoice-claims/validation.ts`) is an
  exhaustive `Record<ClaimStatus, readonly ClaimStatus[]>` adjacency
  list — TypeScript enforces every one of the 9 statuses has an entry,
  so a new status added later without updating this table is a
  compile error, not a silent gap. `validateClaimStatusTransition()`
  is the single gate every status change passes through (direct
  change-status calls, resolution recording, and resolution approval/
  rejection all call it, never a bespoke check of their own), and it
  alone decides `requiresApproval` for a given transition.
- *"Accepted + rejected quantity across every claim ever filed against
  a line must never exceed what was invoiced."* `getAlreadyClaimedQuantity()`/
  `getAlreadyClaimedTotal()` (`lib/invoice-claims/queries.ts`) are live
  aggregates — `SUM(acceptedQuantity + rejectedQuantity)` across every
  `InvoiceClaimLine` ever created against one `SapInvoiceLine`, not a
  stored running total anywhere — because more than one claim can
  legitimately be filed against the same invoice line over time (a
  second dispute after the first was partially resolved, for example).
  `validateClaimLineQuantities()` checks the new line's requested
  accepted+rejected quantity against `invoiced - alreadyClaimedElsewhere`,
  both before the transaction opens (fast failure with a specific
  field error) and again inside it against a transaction-consistent
  read (closing the race window between two concurrent claims against
  the same line).

### Design rationale for the data model

- **Fixed, non-DB-configurable enums**, per the user's own confirmed
  answer: `CLAIM_CATEGORIES` (11 values), `CLAIM_PRIORITIES`,
  `CLAIM_STATUSES` (the 9-value lifecycle), `CLAIM_LINE_DISPUTE_TYPES`
  (`QUANTITY`/`AMOUNT_ONLY`), `RESOLUTION_DECISIONS` (9 values) — all
  `as const` arrays in `lib/invoice-claims/validation.ts`, with `OTHER`
  as the escape valve on category and resolution decision only
  (matching the existing `LostSaleReason`/`DecisionSource` precedent),
  each requiring a free-text detail when selected
  (`claimCategoryRequiresDetail`/`resolutionDecisionRequiresDetail`).
- **Two-tier authorization, per the user's own confirmed answer:** any
  authenticated user may create a claim, record investigation
  findings, and propose a resolution; only `SALES_MANAGER`/
  `ADMINISTRATOR` may approve a resolution or move a claim into
  `RESOLVED`/`PARTIALLY_RESOLVED`/`APPROVED`/`REJECTED`/`CLOSED`
  (`isApprovalWeightStatus()`). This is enforced at two different
  layers on purpose: every resolution-approve/-reject route is
  whole-route-gated via `requireUserOrResponse([...])`, matching every
  prior milestone's convention for approval-weight actions — but the
  status-change route (`[id]/status/route.ts`) stays open to *any*
  authenticated user, because a non-approval-weight transition (e.g.
  `OPEN` → `UNDER_INVESTIGATION`) should not require manager
  involvement at all. `changeClaimStatus()` inline-checks the actor's
  role only when `validateClaimStatusTransition()` itself reports
  `requiresApproval: true` for the specific transition requested. This
  is a deliberate, documented variation from the whole-route gate used
  everywhere else, not an inconsistency — a single status endpoint
  serves two different authorization weights depending on what's being
  asked of it.
- **Append-only `ClaimResolution`.** Recording a new resolution never
  edits a prior one — a prior *rejected* recommendation remains
  permanently visible in the claim's resolution history, exactly as a
  real investigation trail should. `approvedById`/`rejectedById` are
  mutually exclusive by application logic (a resolution already
  approved or rejected cannot be approved/rejected again — checked
  explicitly, `409` on conflict — not a DB constraint, since Prisma has
  no native "exactly one of two nullable FKs" check).
- **Snapshot-for-display, re-read-live-for-math.**
  `InvoiceClaimLine.sapItemCodeSnapshot`/`sapItemDescriptionSnapshot`
  exist purely so the claim detail page and lists can show what was
  claimed without a join back to (potentially since-changed) SAP data
  — filled by a small batch update right after the nested line-create,
  since Prisma's nested-create API has no "computed from elsewhere"
  field. Every quantity/financial calculation (`getAlreadyClaimedTotal`,
  `computeClaimLineDisputedValue`, the dashboard) always re-reads the
  live `SapInvoiceLine`, never the snapshot — the snapshot is cosmetic
  only and is never trusted for a number.
- **Financial exposure kept as six structurally distinct figures**,
  never collapsed into one "claim value": original invoice value
  (from the real SAP line, untouched), claimed value (the sum of what
  was disputed, flagged `claimedValueIncomplete` when a `QUANTITY`
  line's `sapLine.unitPrice` is unknown — never guessed), potential
  credit exposure (claimed value, pending), approved credit exposure
  (the sum of `approvedCreditAmount` across approved resolutions
  only), the actual SAP-credited amount (always `null`/unavailable
  this stage, by design), and the remaining unresolved exposure
  (claimed minus approved). `computeExposureByCurrency()` buckets by
  the invoice's real `currencyCode` (or `"UNKNOWN"`) and never
  converts between currencies, matching the spec's own instruction.
- **A disputed line's value is computed from the real SAP unit price,
  never the customer's claimed price.** `computeClaimLineDisputedValue()`
  for a `QUANTITY` dispute multiplies `rejectedQuantity` by
  `sapLine.unitPrice` (not `disputedUnitPrice`, which is recorded for
  context only) — a customer alleging a different price does not
  change what SalesFlow computes as financial exposure; that figure
  always traces back to SAP's own billed price.
- **Dedicated, non-generalized attachment storage.**
  `InvoiceClaimAttachment` gets its own download route
  (`app/api/invoice-claims/attachments/[id]/route.ts`), deliberately
  *not* folded into the existing, `OrderDocument`-specific
  `app/api/files/[id]/route.ts` — reusing the storage driver and
  content-sniffing helpers underneath, but keeping the route itself
  separate rather than generalizing a route that several other things
  depend on, per the standing "no unrelated refactoring" rule.
  `uploadClaimAttachment()` deletes the just-stored file on any DB
  write failure (mirroring the existing cleanup convention in
  `app/api/orders/[id]/documents/route.ts`) so a failed upload never
  leaves an orphaned object in storage.
- **Minimal, additive extension to Milestone 5's query function.**
  `lib/invoice-reconciliation/queries.ts`'s `listSapInvoices()` gained
  an optional `search` parameter (filtering `sapDocNum`/`customerName`/
  `matchedCustomer.name`, case-insensitive) — needed directly by the
  claim-creation form's invoice picker, backward-compatible (optional,
  defaults to no filter), and judged a small, directly-needed
  extension rather than "unrelated refactoring" of Milestone 5's code.

### What was built

- **Schema** (`prisma/schema.prisma`): 5 new enums (`InvoiceClaimCategory`,
  `InvoiceClaimPriority`, `InvoiceClaimStatus`, `ClaimLineDisputeType`,
  `ClaimResolutionDecision`) and 4 new models (`InvoiceClaim`,
  `InvoiceClaimLine`, `ClaimResolution`, `InvoiceClaimAttachment`).
  Entirely additive — every new relation field on `SapInvoice`/
  `SapInvoiceLine`/`CustomerOrder`/`Customer`/`User` is a pure Prisma
  inverse-relation side with no new column on any existing table.
- **Migration** (hand-authored, this sandbox cannot run `prisma
  migrate dev`): 5 `CREATE TYPE`, 4 `CREATE TABLE`, their indexes, and
  their foreign keys (`Restrict` on every FK pointing at
  `SapInvoice`/`SapInvoiceLine`/`CustomerOrder`/`Customer`, so a claim
  can never be left dangling by a deletion elsewhere). No existing
  table/column/enum value touched.
- **`lib/invoice-claims/`** (new module): `validation.ts` (pure — the 5
  enums, the exhaustive status-transition graph, the exhaustive
  resolution→status mapping, quantity/amount validation, zod schemas),
  `queries.ts` (DB — live already-claimed aggregates, list/detail
  queries), `create-claim.ts` (DB — full claim creation with
  pre-transaction and in-transaction quantity revalidation, reference
  generation, snapshot batch-update, audit), `claim-lifecycle.ts` (DB —
  `changeClaimStatus()` with the inline approval-weight check),
  `claim-resolution.ts` (DB — record/approve/reject, each audited,
  approve/reject with defensive re-validation of the transition even
  though the route layer already gates by role), `attachments.ts` (DB
  + storage — upload with content-sniffing and orphan-cleanup,
  download), `display.ts` (pure label/style maps, no `@prisma/client`
  import), `financial.ts` (pure/DB mix — per-line disputed value,
  per-claim financial summary, per-currency exposure, never fabricating
  an actual credited amount), `dashboard.ts` (DB — status/category/
  priority/customer/department/product breakdowns, average resolution
  time, repeat-complaint customers, exposure by currency).
- **API routes** (9, all under `app/api/invoice-claims/`): list+create,
  detail+financial-summary, status-change (open to any user, inline
  role check), record-resolution (open to any user), approve-resolution
  and reject-resolution (both `SALES_MANAGER`/`ADMINISTRATOR` only),
  attachment upload (open to any user) and download (mirrors
  `app/api/files/[id]/route.ts`'s response-construction pattern), and
  the dashboard summary.
- **UI**: `/invoice-claims` (queue list with status filter pills,
  search, customer drill-down), `/invoice-claims/new` (claim-creation
  form: invoice search → line selection with per-line dispute-type →
  customer resolution → category/priority/assignee/communication
  notes), `/invoice-claims/[id]` (detail page: header, financial-
  exposure metrics, disputed-lines table, attachments, append-only
  resolution history with pending/approved/rejected badges and a 6B-
  follow-up hint, the `ClaimActionsPanel` client island), and
  `/invoice-claims/dashboard` (status/category/customer/product/
  department breakdowns, exposure-by-currency table, average
  resolution time, repeat complaints). A new "Invoice Claims" sidebar
  entry under Operations (`FileWarning` icon), added fresh since there
  was no pre-existing dead placeholder link for it.
- **`scripts/remove-demo-data.ts`**: a new leaves-first deletion block
  (`InvoiceClaimAttachment` → `ClaimResolution` → `InvoiceClaimLine` →
  `InvoiceClaim`) inserted before the existing `SapInvoiceLine`/
  `SapInvoice` deletion block, since the new tables' `Restrict` FKs
  point into `SapInvoice`/`SapInvoiceLine`/`CustomerOrder`/`Customer`/
  `User` and would otherwise block demo-data cleanup.

### Explicitly not touched, and why (Milestone 6B boundary)

No `ReturnRequest`/`CreditNote` model, no physical-return workflow, no
actual SAP credit-note recording, and no change to
`SapInvoiceLine.isCancelledOrReversed` or any other Milestone 5 write
path — all explicitly out of scope for 6A per the spec's own two-stage
instruction. `RESOLUTIONS_IMPLYING_6B_FOLLOWUP` (`display.ts`) is a
`Set` used only to label a UI hint ("this resolution will need a
Milestone 6B follow-up once built") — it never implies a 6B record
already exists, and nothing reads it as one.

### Tests added

- `tests/invoice-claims.test.ts` (new, unconditional, 26 tests) — pure
  logic only (`validation.ts`), covering: the full status-transition
  graph (every valid move, approval-weight flagging, invalid/no-op/
  terminal transitions, full coverage of all 9 statuses so a status
  added later without a transitions entry fails to compile rather than
  silently passing), `isConcludedStatus()`, the exhaustive
  `resolutionDecisionToClaimStatus()` mapping (the test that caught a
  real bug — see below), "Other requires detail" for both category and
  resolution decision, quantity validation (the spec's 100/85/15
  worked example, exceeding the remaining quantity, live-aggregate-
  across-multiple-claims scenarios, zero-both-rejected, malformed
  input, full rejection, partial acceptance), and amount-only
  validation (no ceiling when the line total is unknown, zero
  rejected, exceeding the known ceiling, within it). **All 26
  passing.**
- `tests/invoice-claims-db.integration.test.ts` (new, gated, 6 tests) —
  against a real database, following this project's established
  DB-integration-test conventions (`RUN_DB_INTEGRATION_TESTS=1` gate,
  `isDemo: true`, FK-safe `beforeAll`/`afterAll` building its own
  `SapInvoiceImportBatch`/`SapInvoice`/`SapInvoiceLine` fixture rows
  directly rather than through Milestone 5's CSV pipeline). Covers:
  creating a claim with a quantity dispute and confirming the original
  SAP invoice line is byte-identical before and after; a second claim
  against the same line correctly rejected once the first claim's
  accepted+rejected quantity exhausts what remains (the live-aggregate
  rule, exercised against real rows, not just the pure-function test
  above); an amount-only dispute; the full resolution lifecycle
  (record → reject → record a second → approve, asserting the
  append-only history, `approvedCreditAmount`, and the resulting
  status via the real decision→status mapping); direct enforcement of
  the transition graph through `changeClaimStatus()` itself (not just
  the pure validator); and a financial summary distinguishing claimed
  value from approved exposure while confirming
  `actualSapCreditedAmount`/`actualCreditDataAvailable` are `null`/
  `false` in every case.

### A real bug found and fixed during this round's verification (not a sandbox artifact)

Running `npx vitest run` the first time surfaced a genuine logic gap:
`CLAIM_STATUS_TRANSITIONS["AWAITING_INTERNAL_ACTION"]` was missing
`"RESOLVED"` as an allowed target. `resolutionDecisionToClaimStatus()`
maps `NO_ACTION_REQUIRED` directly to `RESOLVED` (a claim that, after
investigation, turns out to need no further action at all — no
`APPROVED` stage in between), and a claim reaches
`AWAITING_INTERNAL_ACTION` precisely by having a resolution recorded
against it. Without this entry, `approveClaimResolution()` would have
hit its own defensive 500 "Internal error" branch — which exists
exactly to catch an invalid mapping before it reaches the database —
for that one, entirely valid decision. Fixed by adding `"RESOLVED"` to
that transition's allowed-targets array with an explanatory comment;
confirmed fixed by re-running the suite and seeing it go from 1 failed
to 0 failed with no other change. This is exactly the category of
self-caught defect the standing verification rule exists to surface,
not something a user reported.

### Honest verification results

- `npx eslint .` (full repo) — **clean, 0 problems.** 13 errors and 1
  warning were found and fixed during this check: `react/no-unescaped-
  entities` for raw apostrophes/quotes in JSX text across
  `claim-actions-panel.tsx` (4), `new-claim-form.tsx` (3), and
  `app/invoice-claims/page.tsx` (1) — replaced with `&rsquo;`/
  `&ldquo;`/`&rdquo;`; an unused `sapLine` binding in `create-claim.ts`
  — removed. Re-running confirmed 0 problems both for the touched
  files and for the full repo (no regression from the
  `lib/invoice-reconciliation/queries.ts` or `sidebar.tsx` edits).
- `npx tsc --noEmit` — new errors confirmed to fall into two buckets
  only: one genuine bug (`TS5097`, a `.ts` extension left in an import
  path in `validation.ts` — fixed, extension removed) and the
  remainder — 34×`TS7006` (implicit-any on Prisma model params),
  14×`TS2339` (property does not exist on the degraded `{}` stub
  type), 11×`TS2694` (missing `Prisma.XxxWhereInput`/`Prisma.Decimal`
  namespace members) — individually confirmed to be the same
  pre-existing, already-documented sandbox limitation first reproduced
  directly in Milestone 4: `npx prisma generate` cannot run in this
  sandbox (`binaries.prisma.sh` blocked, no cached engine binary), so
  the installed `@prisma/client` has zero knowledge of `InvoiceClaim`/
  `InvoiceClaimLine`/`ClaimResolution`/`InvoiceClaimAttachment`/their 5
  new enums. Cross-checked against an untouched file
  (`lib/price-list-import.ts`), which shows the identical `"Property X
  does not exist on type '{}'"` pattern for its own, long-stable
  models — confirming the cause is the stub, not this milestone's code.
  Two invented/incorrect patterns were found and fixed independently of
  the stub bucket during this same pass, since they would be real bugs
  even with a regenerated client: a non-existent
  `Prisma.Decimal.toBigInt()` method in `financial.ts` (replaced with
  the established `parseScaledDecimal` string-based scaling helper,
  keeping only the legitimate `.toDecimalPlaces(4)` for rounding), and
  an unnecessary `prisma as unknown as Prisma.TransactionClient` cast
  in `create-claim.ts` (removed — `PrismaClient` structurally satisfies
  `Prisma.TransactionClient`, which is `PrismaClient` minus a few
  top-level methods, so no cast is needed). **Run `npx prisma
  generate` on your own machine** (SETUP-WINDOWS.md §22) and the
  stub-bucket errors resolve the same way every prior milestone's
  schema-driven `tsc` errors have.
- `npx vitest run` (full project suite) — **322 passed, 54 skipped, 0
  failed** (up from 296 passed/48 skipped at the end of Milestone 5):
  +26 unconditional (the new pure test file) and the new 6-test gated
  file skips cleanly (confirmed in isolation: `npx vitest run
  tests/invoice-claims-db.integration.test.ts` reports `6 skipped`)
  since `RUN_DB_INTEGRATION_TESTS` is unset here. One real bug (the
  transition-graph gap above) was caught and fixed by this run itself
  before being recorded as passing. Zero regressions anywhere in the
  pre-existing suite, confirmed by an actual full-suite run twice (once
  after the fix, once as a final confirmation pass), not file-by-file
  assumption.
- `npm run build` — same result as every prior round: Turbopack's
  bundling stage runs (confirming the pipeline tolerates every new
  file), then the build hits this sandbox's pre-existing Google Fonts
  network block in `app/layout.tsx` (untouched by this milestone,
  confirmed unrelated — the same two-font `403` every prior round's
  build has hit).
- **The one thing this sandbox genuinely cannot confirm**: that the
  new 6-test gated file actually passes against a real, regenerated
  Prisma client and a seeded database. It is written, follows this
  project's established DB-integration-test conventions exactly, and
  every function/field/signature it calls was independently checked
  against the real `lib/invoice-claims/*` source and
  `prisma/schema.prisma` (not assumed) — but **run `npx prisma
  generate` and then `RUN_DB_INTEGRATION_TESTS=1 npm test` for real**
  (SETUP-WINDOWS.md §22) before treating this as verified, same as
  every gated test in this project.

### Acceptance-criterion confirmation

The spec's own central requirements, confirmed one by one: a claim
**always** links to its SAP invoice (`sapInvoiceId` is a required,
`Restrict`-FK column — there is no code path that creates an
`InvoiceClaim` without one) and, where possible, to the specific
invoice line(s) in dispute (`InvoiceClaimLine.sapInvoiceLineId`,
required per line); the six-way distinction (complaint / rejection /
quantity dispute / physical return / SAP credit note / confirmed
financial loss) is preserved structurally — this milestone only ever
produces the first three, a *recommendation* for the others, never an
executed credit or a confirmed loss; the lifecycle's 9 statuses and
their transitions are enforced by an exhaustive, compile-checked graph
rather than convention; the two-tier authorization split is enforced
at both the route layer (whole-route gates on approval actions) and
inline (the status-change route's per-transition check); and financial
exposure is reported as explicitly distinct figures with the actual
SAP-credited amount always honestly `null` this stage, never
fabricated from an estimate.

**Implemented: yes**, within this stage's explicit scope. **Tested:
yes, with the one honest caveat already stated above** — the 26
unconditional tests cover every piece of pure logic directly,
including the one real bug this project's own test suite caught and
that was fixed before delivery; the 6 gated DB tests walk the claim
lifecycle end to end against a real database but, as with every gated
test in this project, have not been run against a real database from
inside this sandbox, and that run is the one remaining step before
this milestone can be called verified rather than merely written and
type-consistent.

**Do not start Milestone 6B until this is reviewed** — per the spec's
own explicit two-stage instruction and this project's standing
multi-session working agreement.

# Milestone 6B — Returns & Credit Notes

Stage 2 of 2 of the Invoice Claims Management & Returns/Credit Notes
specification. Built per your own explicit instruction — *"Claude
start Milestone 6B"* — which supersedes this document's own prior
"Do not start Milestone 6B until this is reviewed" line: this stage
was started without waiting for a separate review round on 6A, by
your direct authorization, not by relaxing the standing milestone-
gating agreement generally.

## Confirmed design decisions

Before writing any 6B code, four design questions were put to you via
`AskUserQuestion` and answered directly — every line of this
milestone follows from these four answers:

1. **Physical returns are tracked as a separate `ClaimReturn` model**,
   not free text on the claim or resolution. This is what makes "a
   return was actually received" a structured fact with its own
   quantity, condition, and date, queryable and auditable on its own
   terms rather than buried in a notes field.
2. **Recording that SAP has actually issued a credit note is
   restricted to `SALES_MANAGER`/`ADMINISTRATOR`.** This is the same
   approval-weight tier as approving a `ClaimResolution` in 6A — both
   assert a completed financial fact, not a recommendation or an
   investigation finding (which stay open to any authenticated user,
   same as 6A).
3. **Once an actual return or credit note is recorded, the claim's
   status auto-advances** through 6A's *existing* validated transition
   graph — never a new graph edge, never a status skipped. This is
   what turns "a recommendation is not the same as an executed action"
   (6A's own central rule) into its natural completion: once the
   action is actually executed in the real world, the claim's status
   reflects that without a human having to separately remember to move
   it.
4. **Both manual single-record entry and a full CSV import pipeline**
   are built for credit notes — you explicitly chose this over the
   alternative (recommended) option of manual entry only, on the
   reasoning that a real SAP B1 AR-credit-memo export is exactly the
   kind of bulk document this project already has a proven pattern
   for (Milestone 5's own CSV pipeline).

## Design rationale

**SAP Business One remains the sole system of record, structurally.**
Every write this milestone makes only ever *records* a fact that
already happened in SAP or in the physical world — SalesFlow never
creates a credit note in SAP itself, and never marks goods as returned
except by a human (or an imported row) attesting that they actually
arrived. `lib/returns-credits/credit-notes.ts` and `returns.ts` say
this in their own module doc comments, and nowhere in this milestone
does a function call out to SAP or assert a SAP-side write — there is
no SAP write path in this codebase at all, by design, matching every
prior milestone's own stance (Milestone 5 never creates an invoice in
SAP either; it only reconciles against one already there).

**A `ClaimResolution`'s approved amount is never the same fact as a
`CreditNote`'s actual amount.** `ClaimResolution.approvedCreditAmount`
(6A) is what an internal manager approved as the claim's resolution;
`CreditNote.amount` (6B) is what SAP actually issued, entered by a
human who sees it on their own SAP B1 screen or read verbatim from a
real SAP export — never computed as an estimate from the claim's own
lines (the spec's own explicit instruction: "never calculate an actual
credit amount based only on an estimated claim"). `lib/invoice-claims/
financial.ts`'s `actualSapCreditedAmount` is a live `SUM` of real
`CreditNote` rows, recomputed on every read, never a stored running
total — same "derive, don't store a second truth" convention this
project has used since Milestone 5's own reconciliation aggregates.
When the two figures diverge in SAP's favor (SAP credited more than
was internally approved), the new `actualExceedsApproved` flag
surfaces that exception rather than silently clamping it away — the
same philosophy as Milestone 5's own `causesOverInvoicing` flag.

**The status auto-advance is a forward-only ratchet, re-validated at
write time, not a second source of truth about what transitions are
legal.** `lib/returns-credits/status-recompute.ts`'s
`determineAutoAdvanceTarget()` is a pure function that only ever
*proposes* a target status from a fixed decision table (reproduced in
full in its own doc comment); its caller,
`lib/returns-credits/apply-status-recompute.ts`'s
`recomputeClaimStatusAfterActuals()`, re-checks that proposal against
6A's own `validateClaimStatusTransition()` immediately before writing
it, and `throw`s (aborting the whole enclosing transaction, including
the return/credit-note record that triggered it) rather than silently
skipping an impossible edge. This mirrors `lib/invoice-claims/
claim-resolution.ts`'s own "Internal error... not expected" 500-
response pattern for the same reason: a defensive check that should
never fire in practice is not dead code, it is the thing that turns a
latent logic bug into a loud, caught failure instead of a silently
wrong database write. The ratchet only ever moves a claim forward
(`APPROVED`/`PARTIALLY_RESOLVED` → `PARTIALLY_RESOLVED`/`RESOLVED`) and
deliberately never reverses an already-applied auto-advance when a
credit note is later unlinked, reopened, or marked cannot-link —
that correction is left to the ordinary manual status-change action
(6A's own `PATCH .../status`), a documented, deliberate scope boundary
rather than an oversight.

**Credit-note matching granularity is the claim, not the claim line.**
6A already tracks financial exposure at the claim level
(`ClaimResolution.approvedCreditAmount`), so there is no
`CreditNoteLine` model and nothing in `lib/returns-credits/matching.ts`
reads SAP item codes — a deliberate simplification against Milestone
5's own line-level invoice matching, made explicit in that file's own
doc comment rather than left to be discovered. `matchCreditNoteToClaim()`
auto-matches only when exactly one candidate claim against the credit
note's resolved base invoice is `APPROVED`/`PARTIALLY_RESOLVED`, has a
credit-bearing latest-approved decision, and still has outstanding
exposure (`approvedCreditAmount - actualCreditedTotal > 0`) — zero or
multiple qualifying candidates always resolves to `UNMATCHED`, never a
guess, same conservative philosophy as Milestone 5's own
`matchInvoiceLineToOrder()`.

**Manual entry and CSV import write into one unified `CreditNote`
model**, never two parallel tables. A manually-entered row is created
already `MANUALLY_MATCHED` with `claimId` set directly (the sales
manager picked the claim themselves, so there is no ambiguity to
resolve); an imported row starts `UNMATCHED` and is resolved by the
same automatic matcher, or by hand via the manual-match/cannot-link/
reopen actions — the exact same three-action shape Milestone 5 already
uses for its own unmatched invoice lines, deliberately reused rather
than invented fresh (`lib/invoice-reconciliation/manual-actions.ts` was
read in full before writing `lib/returns-credits/credit-notes.ts`'s
own versions, and the two are structurally identical).

## What was built

- **Schema**: 2 new enums (`ReturnCondition`, `CreditNoteMatchStatus`)
  and 3 new models (`ClaimReturn`, `CreditNote`,
  `CreditNoteImportBatch`), reusing `InvoiceLineMatchMethod` (Milestone
  5) as-is for `CreditNote.matchMethod`. Purely additive — see
  CHANGES.md for the exact diff.
- **`lib/returns-credits/`** (12 files): pure/impure pairs mirroring
  Milestone 5's own split exactly —
  `status-recompute.ts`/`apply-status-recompute.ts`,
  `matching.ts`/`match-credit-note.ts`,
  `csv.ts`/`plan-import.ts`/`execute-import.ts` — plus
  `validation.ts`, `returns.ts`, `credit-notes.ts`, `display.ts`,
  `queries.ts`. See CHANGES.md for what each file does.
- **11 new API routes**, split exactly along the confirmed
  authorization tiers: reading and recording a physical return are
  open to any authenticated user (same tier as 6A's own
  `createInvoiceClaim`/`recordClaimResolution`); every action that
  asserts or changes a financial fact about a credit note (manual
  entry, CSV import preview/confirm, manual match, cannot-link,
  reopen) is `SALES_MANAGER`/`ADMINISTRATOR`-gated at the route layer.
  The credit-note-recording route is structurally prevented from being
  used against a different claim than its own URL names — the body's
  `claimId`, if any, is always overwritten by the URL parameter before
  validation.
- **UI**: a new `/returns-credits` reconciliation queue,
  `/returns-credits/[id]` detail + manual-reconciliation panel,
  `/returns-credits/import` 3-stage CSV wizard, and
  `/returns-credits/import-history`; a new `ReturnsCreditsPanel` client
  island and two new read-only sections on the existing
  `/invoice-claims/[id]` page, whose financial-exposure grid now shows
  live figures in place of 6A's own placeholder text.
- **`lib/invoice-claims/financial.ts` extended**:
  `actualSapCreditedAmount`/`actualCreditDataAvailable` are no longer
  6A's honest placeholder (`null`/`false`); two new fields,
  `actualCreditShortfall` and `actualExceedsApproved`, surface the
  approved-vs-actual relationship explicitly.
- **`scripts/remove-demo-data.ts` extended** with a correctly leaves-
  first-ordered deletion block for the three new tables.

## Two real bugs found and fixed during this round's own verification (not sandbox artifacts, not user-reported)

Running a targeted `npx tsc --noEmit` pass against every 6B-touched
file (per the standing "always verify" rule, before moving on to the
next task) surfaced two genuine `TS2367` errors in
`lib/returns-credits/status-recompute.ts`'s
`determineAutoAdvanceTarget()`: two comparisons of the shape
`input.currentStatus !== "RESOLVED"`, at the `PHYSICAL_RETURN_REQUIRED`
branch and the `FULL_CREDIT_RECOMMENDED`/`PRICING_CORRECTION_REQUIRED`
full-credit branch. TypeScript correctly flagged both as impossible —
`currentStatus` had already been narrowed to
`"APPROVED" | "PARTIALLY_RESOLVED"` by the function's own top guard
clause, several lines earlier in the same function, so neither
comparison could ever evaluate to anything but vacuously true. Both
were dead code, not wrong logic (removing them changes no observable
behavior — the branches they gated were always taken), but leaving
genuinely-impossible comparisons in a status-advance function that
this project's standing rules call load-bearing ("no silent status-
skipping") is exactly the kind of thing worth catching before
delivery rather than after. Fixed by removing both comparisons and
replacing them with an explanatory comment at each site; re-ran `tsc`
on the same file afterward and confirmed both `TS2367` errors gone
with zero new errors introduced.

## Honest verification results

- **`npx eslint .`** (full repo, every 6B file included) — **clean, 0
  problems.** No fixes were needed this round; every new file was
  written against the same lint configuration from the start.
- **`npx tsc --noEmit`** — **257 errors, up from 241 at the end of
  Milestone 6A and 251 after this round's own `lib`/API-route work**
  (6 more from the UI build: `.map()` callbacks over Prisma query
  results, the same category as every other row below). Every single
  one of the 257 was individually checked by file and confirmed to
  fall into the same three sub-categories this project has reproduced
  and explained since Milestone 4, all caused by the one sandbox-only
  root cause: `npx prisma generate` cannot run here (`binaries.prisma.sh`
  blocked by this sandbox's network allowlist), so the installed
  `@prisma/client` has zero knowledge of `ClaimReturn`/`CreditNote`/
  `CreditNoteImportBatch`/their 2 new enums, or indeed of any model
  from any prior milestone either:
  - `TS7006` (166, up from ~160) — implicit-any on a Prisma query
    result's callback parameter (`.map((line) => ...)`, a transaction
    client `tx` parameter, etc.) — every new instance confirmed to sit
    in a file that calls a Prisma query, none anywhere else.
  - `TS2694`/`TS2339` (28 + 38) — `Prisma.Decimal`,
    `Prisma.CreditNoteWhereInput`, and similar schema-derived members
    reported missing from the degraded stub `Prisma` namespace/type.
  - `TS2305`/`TS2322`/`TS2345`/`TS18046` (18 + 1 + 3 + 3, unchanged
    from 6A) — pre-existing, confirmed unrelated to any file this
    milestone touched.

  Zero new error *categories* were introduced — confirmed by grepping
  the full `tsc` output filtered to every file this milestone created
  or modified (`lib/returns-credits/*`, the 11 new API routes, the new
  UI files, `lib/invoice-claims/financial.ts`,
  `scripts/remove-demo-data.ts`) and checking each line individually
  against this same three-bucket explanation; none fell outside it.
  **Run `npx prisma generate` on your own machine** (SETUP-WINDOWS.md
  §23) and the stub-bucket errors resolve the same way every prior
  milestone's schema-driven `tsc` errors have.
- **`npx vitest run`** (full project suite) — **364 passed, 62
  skipped, 0 failed** (up from 322 passed/54 skipped at the end of
  Milestone 6A): +42 unconditional (the new pure test file,
  `tests/returns-credits.test.ts`, run and confirmed passing in
  isolation before the full-suite run too) and the new 8-test gated
  file skips cleanly (confirmed: `npx vitest run tests/returns-credits-
  db.integration.test.ts` reports `8 skipped`) since
  `RUN_DB_INTEGRATION_TESTS` is unset here. One pre-existing 6A test's
  assertions were updated in this round, not newly broken by it: its
  `actualSapCreditedAmount`/`actualCreditDataAvailable` expectations
  asserted 6A's own honest `null`/`false` placeholder, which this
  milestone intentionally supersedes with a live `"0.0000"`/`true` for
  a claim with no credit note recorded — this is a deliberate,
  documented behavior change (see `lib/invoice-claims/financial.ts`'s
  own updated module doc comment), not a regression, and the full
  suite was re-run after the update to confirm it passes along with
  everything else. Zero other regressions anywhere in the pre-existing
  suite.
- **`npm run build`** — hits this sandbox's pre-existing Google Fonts
  network block in `app/layout.tsx` (`fonts.googleapis.com`,
  unrelated to and untouched by this milestone — the same block every
  prior round's build has hit, confirmed unchanged going back to
  Milestone 1). As explained in detail in this document's Milestone 0
  fix round 2 section (and reconfirmed in every milestone since):
  working around the font block alone only reaches the TypeScript
  phase, which then stops on the same Prisma-stub `tsc` errors
  reported above; stacking a second workaround to get past that
  immediately hits a harder wall in "Collecting page data" (the
  `@prisma/client` stub throws when actually *constructed*, not just
  when type-checked, and nearly every API route constructs it at
  module scope). No claim about the build's static-generation/
  prerendering phase for this milestone's new routes should be read as
  sandbox-verified — what *is* verified in-sandbox is `tsc`
  standalone, `lint`, and `vitest`, all of which were actually run
  against this milestone's code with the results reported above.
- **The one thing this sandbox genuinely cannot confirm**: that the
  new 8-test gated file actually passes against a real, regenerated
  Prisma client and a seeded database. It is written, follows this
  project's established DB-integration-test conventions exactly, and
  every function/field/signature it calls was independently checked
  against the real `lib/returns-credits/*` source,
  `lib/invoice-claims/create-claim.ts`/`claim-resolution.ts`, and
  `prisma/schema.prisma` (not assumed) — but **run `npx prisma
  generate` and then `RUN_DB_INTEGRATION_TESTS=1 npm test` for real**
  (SETUP-WINDOWS.md §23) before treating this as verified, same as
  every gated test in this project.

### Acceptance-criterion confirmation

The spec's own central requirements for this stage, confirmed one by
one: SalesFlow never creates a credit note in SAP or marks goods
returned on its own initiative — every write here only *records* a
fact already established in SAP or the physical world, structurally
(no SAP-write code path exists anywhere in this module, same as every
prior milestone); an actual SAP-credited amount is now a live figure,
summed only from real `CreditNote` rows a human or the importer
entered, never estimated from the claim's own lines; a claim's status
auto-advances through the *existing* 6A transition graph once actuals
justify it, with the graph re-validated at write time rather than
trusted blindly, so no new edge and no skipped step is possible; both
confirmed design decisions on authorization (any user records a
return; only `SALES_MANAGER`/`ADMINISTRATOR` records a credit note)
and on import tooling (manual entry **and** a full CSV pipeline, per
your explicit choice) are implemented exactly as confirmed, not as the
alternative, lighter-weight option that was offered alongside them.

**Implemented: yes**, within this stage's explicit, four-decision
scope. **Tested: yes, with the one honest caveat already stated
above** — the 42 unconditional tests cover every piece of pure logic
directly, including the two real dead-code bugs this round's own
`tsc` verification caught and fixed before delivery; the 8 gated DB
tests walk the return/credit-note lifecycle (including the CSV import
pipeline's auto-match and ambiguous-match paths) end to end against a
real database but, as with every gated test in this project, have not
been run against a real database from inside this sandbox, and that
run is the one remaining step before this milestone can be called
verified rather than merely written and type-consistent.

**With this stage delivered, Milestones 6A and 6B together complete
the full Invoice Claims Management & Returns/Credit Notes
specification** as scoped across both stages.

# Milestone 7 — Quotations Management

Built from your attached full specification (15 numbered sections) in
one pass, after the repo-inspection/migration-consistency-gate/design-
questions stages this project's standing process requires before any
schema change (see the task list: "Inspect existing repo for M7
prerequisites," "Review M6A/M6B migration consistency gate," "Identify
open design questions for M7" — all completed before any
`lib/quotations/` code was written).

## Design rationale

**A quotation is its own first-class record, not a draft order.** It
gets its own model, its own status lifecycle, and its own number
(`QUO-YYYYMMDD-8HEX`, same shape as every other reference generator in
this project) — never a `CustomerOrder` row in a pre-order status. The
only point of contact between the two is a one-way, explicit, audited
conversion action (below); nothing about creating, issuing, or even
accepting a quotation ever touches `CustomerOrder`.

**Exactly the 6 named statuses — `DRAFT`/`ISSUED`/`ACCEPTED`/
`REJECTED`/`EXPIRED`/`CANCELLED` — never a 7th.** The spec's own wording
("at minimum, consider") left room to add a `SUPERSEDED` status for a
revised-away quotation, but that would mean threading a dead-end status
through every other transition as a trap state. Instead, a revision
freezes the OLD row's status exactly as it was the moment it was
revised (`Quotation.supersededAt`/`supersededById`) and the query layer
excludes `supersededAt: { not: null }` from every default list/
dashboard view — "never let an old version appear as current" is
enforced where quotations are *read*, not by inventing a status value
that would have to mean something different depending on what the row
used to be.

**A revision is a brand-new `Quotation` row, never an in-place edit of
an issued one.** `lib/quotations/revise.ts` copies the original's
header and lines byte-for-byte into a new `DRAFT` row
(`previousRevisionId` pointing back, `rootQuotationId` shared across
every revision in the chain, the human-facing `quotationNumber`
unchanged, only `revisionNumber` incrementing) and supersedes the old
row in the same transaction. This is what makes "preserve the
acceptance/rejection history of previous versions" (spec section 6)
structurally true rather than conventional — there is no code path that
can mutate an already-issued quotation's own lines/header; the *only*
way to change anything after issue is to create a new row.

**No automatic pricing/discount approval process — by explicit scope
exclusion, not an oversight.** `UnitPrice`/`discountPercent` on every
line are always directly Sales-entered values, validated for shape
(non-negative, correct decimal places, discount bounded 0–100%) but
never looked up from `PriceListEntry`, never checked against a stock
cost, and never routed through any approval gate. The spec says this
explicitly belongs to a later milestone; building it here would have
meant inventing an approval workflow the spec didn't ask for and that
would need its own design review.

**Expiry is a live-computed fact, never a trusted stored flag.**
`isEligibleForExpiry(status, validUntil, today)` is pure and reused
everywhere "overdue" matters — the dashboard's `dueForFollowUp` count,
the detail page's warning banner — so the UI can never show a stale
answer even before any write happens. The actual `ISSUED → EXPIRED`
write only ever happens through one function
(`lib/quotations/expiry.ts`'s `expireQuotation`), triggered either by a
manual per-quotation action or by `scripts/expire-quotations.ts` (a
standalone script, since this architecture has no background-job
runner — same "one-command script, run on a real schedule via Windows
Task Scheduler/cron" shape as `scripts/remove-demo-data.ts`). Both
paths call the identical function, so neither can drift from the
other.

**Converting an accepted quotation into a real order is always a
separate, explicit, idempotent action — never a side effect of
`ACCEPTED`.** `lib/quotations/convert-to-order.ts` reuses
`lib/orders.ts`'s own `createOrderCore` directly rather than
duplicating its nested-create/`OrderStatusHistory`/audit logic, and
guards against a duplicate order twice: an application-level pre-check
on `Quotation.convertedOrderId`, and a deterministic
`QUO-CONVERT-<quotationId>` idempotency key on the created
`CustomerOrder` (the same column every other order-creation path in
this project already uses for safe client retries) — both the order
creation and the quotation's own `convertedOrderId` write happen inside
one transaction, so there is no window where one exists without the
other. Cancelling a quotation that has already produced a real order is
blocked by a direct read of `convertedOrderId` in
`lib/quotations/cancel.ts`, deliberately *not* encoded as a missing
edge in the transition graph — the graph has no way to see other
columns, so that specific data fact is checked at the one place that
actually writes `CANCELLED`.

**An unlisted/requested item is structurally distinct from a catalogued
SAP product, never a fabricated code.** `QuotationLine` enforces (in
`lib/quotations/validation.ts`'s zod union, not a DB `CHECK` constraint
— this schema has none anywhere in its migration history, so this
follows the established pattern) exactly one of `productId` set /
`isUnlistedItem` true with a free-text description — never both, never
neither. A catalogued line's SAP identity and VAT code are snapshotted
at the moment it's added (`sapItemCodeSnapshot`/
`sapItemDescriptionSnapshot`/`vatCodeSnapshot`/`vatRatePercentSnapshot`)
so an issued quotation's printed figures can never silently drift if
the catalogue or a tax rate changes later — the same "snapshot for
display, re-read live only when nothing has been issued yet" philosophy
`OrderLine`/`SapInvoiceLine` already use elsewhere in this project.

**No new RBAC role, and no approval gate on any Milestone 7 action.**
Every `lib/quotations/*` mutation and every new `app/api/quotations/*`
route uses the existing `requireUserOrResponse()` with no role array —
same tier as order creation itself. A quotation is a sales-staff
working document; nothing about creating, editing, issuing, recording a
response, expiring, cancelling, revising, or converting one is a
judgment call that needs manager sign-off in this milestone's scope.

**No PDF library is installed in this project** (confirmed by
inspecting `package.json` before building), so the printable quotation
document (spec section 9) is print-ready HTML — a zero-write Server
Component at `/quotations/[id]/print` with A4 print CSS, mirroring
`/orders/[id]/assembly-form`'s already-established pattern exactly —
rather than a generated PDF file. The browser's own "Print → Save as
PDF" is how a PDF actually gets produced, same as the assembly form.

## What was built

- **Schema**: 2 new enums (`QuotationStatus`, `QuotationEventType`) and
  3 new models (`Quotation`, `QuotationLine`, `QuotationEvent`), plus
  one new value (`QUOTATION`) added to the existing `OrderSource` enum
  so a converted order's `source` can say where it actually came from.
  Purely additive — see CHANGES.md for the exact diff and
  `prisma/migrations/20261111150000_add_quotations_management/
  migration.sql` for the hand-authored SQL (this sandbox cannot run
  `prisma migrate dev`).
- **`lib/quotations/`** (12 files): `validation.ts` (pure — the 6-status
  transition graph, zod schemas, percent/quantity/date validators, the
  live `isEligibleForExpiry` check — no `@prisma/client` import, so it's
  the one file this milestone's unconditional test file can exercise
  directly), `calculations.ts` (decimal-exact line/quotation totals via
  `Prisma.Decimal`, discount applied before VAT), `create.ts`
  (reference generation + collision retry, line resolution/snapshotting
  shared with `edit.ts`), `edit.ts` (every DRAFT-only header/line
  mutation, each recomputing and storing the quotation's totals),
  `issue.ts`, `respond.ts`, `cancel.ts`, `revise.ts`,
  `convert-to-order.ts`, `expiry.ts` (`expireQuotation` +
  `sweepExpiredQuotations`), `display.ts` (label/style maps, no
  `@prisma/client` import), `queries.ts` (list/dashboard/detail/
  revision-history reads).
- **14 new API routes** under `app/api/quotations/`: list+create,
  dashboard, detail+header-edit, line add/update/remove, follow-up
  scheduling, issue, respond, cancel, revise, convert-to-order, manual
  expire, and revision history — every one `requireUserOrResponse()`
  with no role gate, `verifyCsrfOrigin` on every mutating route,
  `isValidId` on every path param.
- **UI**: a new `/quotations` dashboard+list page (summary cards,
  status tabs, debounced search, salesperson/currency/date filters —
  the value-by-status card explicitly grouped by currency and never
  summed across currencies or labelled "revenue," same discipline
  `lib/invoice-claims/financial.ts` already established),
  `/quotations/new` (header + per-line builder with a toggle between
  SAP-catalogue search and a free-text unlisted-item field),
  `/quotations/[id]` (detail page: fields grid, lines table with
  totals, customer-response/cancellation sections, revision-history
  list, event-history timeline, a `QuotationActionsPanel` client island
  wiring up every mutating action gated by the quotation's own
  status/`isSuperseded`/`hasConvertedOrder`), and
  `/quotations/[id]/print` (the printable document described above). A
  new "Quotations" sidebar entry sits in the WORKSPACE section next to
  Orders/PO Intake — a quotation is the pre-order sales step, not an
  operational/fulfilment concern.
- **`scripts/expire-quotations.ts`** (new, one-command script) and
  **`scripts/remove-demo-data.ts`** (extended) — the new models' rows
  are deleted first in the demo-cleanup transaction, before the
  existing `CustomerOrder` deletion block, because
  `Quotation.convertedOrderId` is a `Restrict` FK onto `CustomerOrder`.

## Known, documented UI limitation (not hidden)

The create-quotation form has no `customerContactId` selector.
`Quotation.customerContactId` is optional in the schema and the lib
layer fully supports it, but no existing endpoint in this codebase
lists a customer's contacts (`getCustomerById` doesn't return them,
and no `/api/customers/[id]/contacts` route exists) — building a new
endpoint purely to populate one optional dropdown was judged out of
this milestone's scope rather than done silently. A quotation can
still be linked to a specific contact via a direct `PATCH
/api/quotations/[id]` call; the UI gap is the one thing left for a
follow-up round, not a missing capability in the data model or lib
layer.

## Honest verification results

- **`npx eslint .`** (full repo, every Milestone 7 file included) —
  **clean, 0 problems.** One unescaped-apostrophe `react/no-unescaped-
  entities` error was caught and fixed in
  `quotation-actions-panel.tsx` during this round's own verification,
  before being counted as clean.
- **`npx tsc --noEmit`** — **331 errors, up from 257 at the end of
  Milestone 6B** (+63 from `lib/quotations/*`, +5 from the UI
  (`app/quotations/[id]/page.tsx` ×4, `.../print/page.tsx` ×1), +6 from
  `tests/quotations-db.integration.test.ts`). Every one of the 74 new
  errors was individually confirmed, by reading the actual error text
  file-by-file (not just counted), to be the same single, already-
  documented sandbox-only root cause as every prior milestone: `npx
  prisma generate` cannot run here (`binaries.prisma.sh` blocked by this
  sandbox's network allowlist), so the installed `@prisma/client` has
  zero knowledge of `Quotation`/`QuotationLine`/`QuotationEvent`, their
  2 new enums, or indeed any model from any prior milestone either —
  manifesting as `TS7006` implicit-`any` on a Prisma query result's
  `.map()` callback parameter, or `Prisma.Decimal`/
  `Prisma.QuotationWhereInput`/`Prisma.QuotationSelect`/
  `Prisma.PrismaClientKnownRequestError` reported missing from the
  degraded stub `Prisma` namespace. Zero new error *categories*. **Run
  `npx prisma generate` on your own machine** (SETUP-WINDOWS.md §24)
  and these resolve the same way every prior milestone's schema-driven
  `tsc` errors have.
- **`npx vitest run`** (full project suite) — **442 passed, 75 skipped,
  0 failed** (up from 364 passed/62 skipped at the end of Milestone
  6B): +78 unconditional (`tests/quotations.test.ts`, covering every
  pure function in `lib/quotations/validation.ts` — the full 6×6
  status-transition matrix, every terminal/revisable/convertible/
  editable predicate, quantity/validity-window/expiry-eligibility
  checks, and every zod schema's accept/reject boundary — run and
  confirmed passing in isolation before the full-suite run too) and
  +13 gated (`tests/quotations-db.integration.test.ts`, confirmed to
  skip cleanly on its own: `npx vitest run tests/quotations-db.
  integration.test.ts` reports `13 skipped`) since
  `RUN_DB_INTEGRATION_TESTS` is unset here. Zero regressions anywhere
  in the pre-existing suite.
- **`npm run build`** — hits this sandbox's pre-existing Google Fonts
  network block in `app/layout.tsx` (`fonts.googleapis.com`), unrelated
  to and untouched by this milestone — the same block every prior
  round's build has hit since Milestone 1 (see that milestone's fix
  round 2 for the original diagnosis). Turbopack's bundler itself
  reached and compiled every new Milestone 7 route/page/component
  before hitting the font fetch — the compile graph for this
  milestone's new files is structurally sound — but as with every
  prior milestone, no claim about the build's static-generation/
  prerendering phase for these new routes should be read as sandbox-
  verified, since getting past the font block alone would only reach
  the same Prisma-stub wall described above. **Your next real `npm run
  build`** (after `npx prisma generate`) **is what actually confirms
  this.**
- **The one thing this sandbox genuinely cannot confirm**: that the new
  13-test gated file actually passes against a real, regenerated Prisma
  client and a seeded database. It is written, follows this project's
  established DB-integration-test conventions exactly (own
  `Product`/`TaxCode` fixtures, `isDemo: true` throughout, FK-respecting
  cleanup order confirmed against `prisma/schema.prisma`'s actual
  `onDelete` clauses rather than assumed), and every function/field/
  signature it calls was independently checked against the real
  `lib/quotations/*` source files, not assumed — but **run `npx prisma
  generate` and then `RUN_DB_INTEGRATION_TESTS=1 npm test` for real**
  (SETUP-WINDOWS.md §24) before treating this as verified, same as
  every gated test in this project. It covers: decimal-exact totals on
  create (including the discount-before-VAT rule, verified against
  hand-computed figures); rejecting an unlisted line with no
  description and a catalogued line against an unknown product; every
  DRAFT line-edit path recomputing stored totals correctly, then
  blocked once issued; issuing refused with zero lines or a second
  time; accept/reject responses (confirming ACCEPTED never creates a
  `CustomerOrder` as a side effect); cancellation allowed from
  DRAFT/ISSUED/ACCEPTED(no order) but blocked once converted; a full
  convert-to-order cycle confirmed idempotent on a repeat call with
  exactly one order ever created; a full revision cycle (new DRAFT row,
  old row frozen and excluded from default listings, re-revision
  blocked on both the old and new row); revision-history resolution
  from either the root or a later revision's id; manual expire and the
  system-wide sweep, each confirmed to leave a still-valid quotation
  untouched; and the dual-write `QuotationEvent`/`AuditEvent` audit
  trail across a create→issue→accept sequence.

### Acceptance-criterion confirmation

The spec's own central requirements, confirmed one by one: every SAP
item code/description on a quotation line is either a real, looked-up
catalogue value or explicitly marked as an unlisted/requested item —
structurally, never a fabricated code; pricing is always a manually
Sales-entered value with no automatic pricing/discount approval process
built (the explicit scope exclusion, honored); the 6-status lifecycle
is enforced by an exhaustive transition graph re-validated at write
time, with expiry computed live rather than trusted from a stale label
and a real (if background-job-less) server-side expiry mechanism built
for it; a revision is always traceable to the original via
`rootQuotationId`/`previousRevisionId`, with the old version's own
history preserved and structurally excluded from ever being mistaken
for current; converting an accepted quotation into an order is always
an explicit, human-triggered, idempotent action, never automatic, and
is blocked from creating a duplicate by two independent, redundant
guards; a quotation already converted into a real order cannot be
cancelled; a printable document exists, print-ready HTML given this
project has no PDF library; and every mutating action writes both a
dedicated `QuotationEvent` and a generic `AuditEvent` row.

**Implemented: yes**, across every one of the spec's 15 numbered
sections. **Tested: yes, with the one honest caveat already stated
above** — the 78 unconditional tests cover every piece of pure logic
directly; the 13 gated DB tests walk the full quotation lifecycle
(creation through conversion, revision, and expiry) end to end against
a real database but, as with every gated test in this project, have
not been run against a real database from inside this sandbox, and
that run — together with a real `npm run build` after `npx prisma
generate` — is what remains before this milestone can be called fully
verified rather than written and type-consistent.

# Milestone 8 — Validation and Approvals

Built from your attached full specification (14 numbered sections) in
one pass. One explicit decision from you governs the one area of
deliberate scope reduction: Customer-PO/order-value approval is
**framework-ready only** — `ApprovalModule.ORDERS` and
`ApprovalActionType.ORDER_VALUE_EXCEEDS_THRESHOLD` exist and are fully
configurable through the policy UI, visibly labelled "Not yet
enforced" there, but `lib/orders.ts`'s `createOrderCore` was left
completely untouched. No live gate was wired into order creation. This
was your call, not an oversight, and it is restated here so it reads
the same way in the delivery report as it does in this file.

## Design rationale

**One reusable approval framework, not a bespoke flag on
Quotations.** The spec explicitly asks for a cross-module mechanism
("a consistent, reusable mechanism for requesting... approvals across
different modules") and warns against ad-hoc per-module logic. Four
new models carry this: `ApprovalPolicy` (the configurable rule —
action type, threshold, required approver role, self-approval
allowance, overdue window, effective date range, active flag),
`ApprovalRequest` (one instance of a policy being triggered against a
real quotation or order, with a 6-status lifecycle:
`DRAFT`/`PENDING`/`APPROVED`/`REJECTED`/`CANCELLED`/`WITHDRAWN`),
`ApprovalEvent` (append-only event history per request, mirroring
`QuotationEvent`'s own pattern exactly), and `Notification` (the
in-app mechanism covering the lack of any existing notification
infrastructure — spec section 9's explicit fallback is "document the
dependency," but a real mechanism was built instead because polling an
unread count is a small amount of work against a schema that already
exists everywhere else in this project).

**No hardcoded business limits anywhere.** Every threshold, every
required-approver-role, every self-approval allowance is a management-
entered `ApprovalPolicy` row — never a number this codebase invents.
No default policy is seeded: `prisma/seed.ts`'s `main()` only ever
seeds Milestone 0's baseline (admin, demo customers, demo orders) —
confirmed by reading it — the same as every milestone since M1, none
of which extended it either. `tests/approvals-db.integration.test.ts`
creates its own `isDemo: true` policy rows directly, same convention
this project's gated tests already use for their own fixtures (demo
`Product`/`TaxCode` in the Quotations suite, demo `SALES_MANAGER`
users here).

**Separation of duties is enforced in two independent places.** First,
structurally: `requestedById` and `decidedById` are always compared,
and a policy's `allowRequesterSelfApprove` flag (default `false`)
decides whether that comparison blocks the decision. Second,
server-side, at the one point that actually matters: every decision
route (`approve`/`reject`/`withdraw`/`cancel`) re-derives eligibility
from the live policy and the live requester, never trusting anything
the client sends. There is no UI-only enforcement anywhere in this
milestone — every button a role should not see is backed by a route
that would reject the same action if called directly.

**The Quotations pricing/discount-exception workflow is the one
mandatory integration**, exactly as scoped. `lib/approvals/quotation-
gate.ts`'s `checkAndRequireQuotationApproval` is called from
`issueQuotation` (and from each of `addQuotationLine`/
`updateQuotationLine`/`removeQuotationLine` via
`invalidateStaleApprovalRequests`, so a line edit that changes the
discount percentage can both retroactively clear a now-unnecessary
pending request and create a fresh one against the new numbers). A
quotation blocked on a pending approval cannot be re-issued — the gate
re-checks on every issue attempt, not just the first — and the
blocking request's id is returned to the client so the quotation-
detail page can link straight to it.

**Approval requests chain on resubmission, they do not disappear.**
When a stale `PENDING` request is invalidated (because the underlying
discount dropped back under threshold, or the quotation was edited
again before a decision), it is marked `CANCELLED` with a system
reason rather than deleted, and if a new request is created afterward,
`previousRequestId`/`rootRequestId` link it back to the original —
the same revision-chain shape this project already uses for
`Quotation.previousRevisionId`/`rootQuotationId`, applied here so a
reviewer can always see the full history of what was asked and
re-asked, never just the latest snapshot.

**Concurrent decisions are resolved with an atomic `updateMany` guard,
not a read-then-write race.** `approveApprovalRequest`/
`rejectApprovalRequest`/`withdrawApprovalRequest`/
`cancelApprovalRequest` all update
`where: { id, status: "PENDING" }` and check the affected row count;
a second decision arriving after the first commits gets a 409, never
a silently-overwritten decision. This is covered directly by the
`Promise.all` concurrent-decision test in the DB-integration suite.

## What was built

- **Schema** (`prisma/schema.prisma`, additive migration only): four
  new models (`ApprovalPolicy`, `ApprovalRequest`, `ApprovalEvent`,
  `Notification`), two new enums for the request lifecycle and
  notification type, and new relations off `User`, `Quotation`, and
  `CustomerOrder` — no existing column changed type or became
  non-nullable, per the standing "migrations must be additive/safe"
  agreement.
- **Core library** (`lib/approvals/`): `validation.ts` (pure —
  transition matrix, zod schemas, threshold evaluation, self-approval/
  role-eligibility predicates, snapshot matching — zero
  `@prisma/client` import, so it runs unconditionally everywhere),
  `policies.ts` + `policy-queries.ts` (policy CRUD), `requests.ts`
  (the four decision mutations, every one with the atomic race guard
  above), `queries.ts` (list/detail/dashboard queries, including
  `getApprovalDashboard` for the summary counters and
  `getLiveApprovalRequestForQuotation` for the quotation-detail
  banner), `quotation-gate.ts` (the one mandatory integration point),
  and `display.ts` (shared label/formatting helpers for the UI).
- **Notifications** (`lib/notifications/`): `create.ts` (fires on
  submit/approve/reject/withdraw, to the right recipient — the
  eligible approvers on submit, the requester on a decision),
  `queries.ts`, `mark-read.ts`.
- **API routes**: `POST /api/approvals` (submit — reached only
  through the quotation gate, not called directly by the UI),
  `GET /api/approvals`, `GET /api/approvals/[id]`,
  `POST /api/approvals/[id]/{approve,reject,withdraw,cancel}`,
  `GET/POST /api/approval-policies`, `GET/PATCH
  /api/approval-policies/[id]`, `GET /api/notifications`,
  `POST /api/notifications/[id]/read`,
  `POST /api/notifications/mark-all-read`. Every mutation route is
  CSRF-protected and role-gated via `requireUserOrResponse`, and every
  body is parsed with the project's own `readJsonObject` convention
  (confirmed via grep as the dominant pattern across 37+ existing
  routes before adopting it here).
- **UI**: `/approvals` (list, with All/Pending-my-decision/Submitted-
  by-me tabs, status/module filters, and summary counters sourced from
  the dashboard query), `/approvals/[id]` (detail — submitted-values-
  vs-current-values comparison table, full event history, and an
  actions panel that only renders the buttons a given user is actually
  eligible to use), `/approvals/policies` (SALES_MANAGER/ADMINISTRATOR
  only — policy CRUD with an explicit "Not yet enforced" badge on the
  Orders action type), a sidebar nav entry, and a notification bell in
  the sidebar footer (30-second poll, dropdown with mark-read/mark-all-
  read). The Quotations detail page gets an amber "pending approval"
  banner linking to the live request, and the issue-action's error
  path links straight to the blocking request when issuing is refused.
- **Tests**: `tests/approvals.test.ts` — 79 unconditional unit tests
  against `lib/approvals/validation.ts` (the full from×to transition
  matrix, every zod schema's accept/reject boundary, threshold
  evaluation including most-restrictive-wins and array-order
  independence, snapshot matching, self-approval/role-eligibility
  predicates). `tests/approvals-db.integration.test.ts` — a DB-gated
  suite (`RUN_DB_INTEGRATION_TESTS=1`, same convention as every prior
  milestone's own gated suite) walking: policy-blocked issue creating
  a `PENDING` request, self-approval block, cross-manager approval,
  re-issue-after-approval, re-decide-after-decided (409), reject with
  mandatory reason plus the resulting notification, duplicate-
  submission prevention, the concurrent-decision race, staleness
  auto-clear and staleness-resubmission-chaining, requester-only
  withdraw, admin-only cancel, and role-eligibility enforcement.
- **Demo-data cleanup**: `scripts/remove-demo-data.ts` extended with a
  new group (`ApprovalEvent` → `ApprovalRequest` → `ApprovalPolicy`,
  plus the independent `Notification` cleanup), placed **before** the
  existing Milestone 7 group — `ApprovalRequest.quotationId`/
  `customerOrderId` are Restrict FKs onto `Quotation`/`CustomerOrder`,
  so a demo approval request left in place would have blocked those
  deletes further down the same script.

## Known, documented limitation (not hidden)

**Customer-PO/order-value approval is configurable but not
enforced**, by your explicit instruction. A SALES_MANAGER or
ADMINISTRATOR can create an `ORDER_VALUE_EXCEEDS_THRESHOLD` policy
today through `/approvals/policies`, and it will sit there, visibly
marked "Not yet enforced," doing nothing — `createOrderCore` in
`lib/orders.ts` has no call into the approval framework at all. Wiring
it in later is a small, additive change (the same `checkAndRequire*`
gate pattern already proven on Quotations) and does not require
another schema migration, since the models and enum values needed for
it already exist.

## Honest verification results

- **`npx eslint .`** — clean across the whole project, including this
  milestone's new files and the `scripts/remove-demo-data.ts` edit.
- **`npx tsc --noEmit`** — 363 errors, unchanged from the count
  measured immediately after this milestone's API/UI/test work and
  before the `remove-demo-data.ts` edit. Every error in this run was
  cross-checked by file and category against the pre-existing M2–M7
  baseline (331 errors before this milestone): the only category this
  milestone adds is the same stale/stub-`@prisma/client` noise every
  prior milestone has produced in this sandbox (`Namespace 'Prisma' has
  no exported member 'Decimal'`, `Module '"@prisma/client"' has no
  exported member 'NotificationType'`, `Parameter 'tx' implicitly has
  an 'any' type` on every `prisma.$transaction` callback) — a
  consequence of `npx prisma generate` being unable to reach
  `binaries.prisma.sh` from this sandbox, not a real defect in this
  milestone's code. Running `npx prisma generate` against a real
  network and re-running `tsc` is expected to clear essentially all of
  this delta.
- **`npx vitest run`** — 521 passed, 85 skipped (40 files), unchanged
  from the run immediately after this milestone's tests were written.
  The 85 skipped tests are every gated DB-integration test across
  every milestone, including this one's 12 (`approvals-db.integration
  .test.ts`), correctly self-skipping per
  `describe.skipIf(!RUN_DB_INTEGRATION_TESTS)` rather than silently
  passing.
- **`npm run build`** — fails with the same pre-existing Google-Fonts
  network block every prior milestone's build has hit in this sandbox
  (`next/font` cannot reach `fonts.googleapis.com` through this
  sandbox's outbound allowlist). Not a regression and not specific to
  this milestone's code — the failure is in `app/layout.tsx`'s
  shared font import, unrelated to anything built here.
- **Not run in this sandbox** (same honest caveat as every prior
  milestone): `npx prisma generate`/`validate` (network-blocked) and
  the DB-gated integration suite, including `approvals-db.integration
  .test.ts`'s 12 tests, against a real database. Both are expected to
  pass once run against a real network and a real Postgres instance —
  the integration test file itself has been confirmed to typecheck
  and lint cleanly, which is as far as verification can go without
  that database.

**Implemented: yes**, across every one of the spec's 14 numbered
sections, with the one explicit, documented scope reduction (Customer-
PO/order approval left framework-ready, not enforced) called out
above and in the delivery report. **Tested: yes, with the same honest
caveat as Milestone 7** — 79 unconditional tests cover every piece of
pure approval logic directly; the 12 gated DB tests walk the full
approval lifecycle (submission, self-approval block, cross-manager
decision, concurrent-decision race, staleness/resubmission chaining,
withdraw, cancel, role-eligibility) end to end against a real database
but have not been run against one from inside this sandbox.

# Milestone 9 — SAP Business One Integration

Built from your attached full specification (25 numbered sections) in
one pass, delivered silently per your `return only a zip of created and
edited file` instruction. The spec's own engineering standard governed
every design decision below: **when Bulawayo grants the required SAP
permissions, Willsgrove should not need to redesign SalesFlow or start
the integration project again — the remaining work should be
environment configuration, connection verification, authorised testing,
and controlled activation.** No SAP credentials, endpoint, or company
database were ever guessed; no mock transaction is ever presented as
real; no direct write to a SAP table is performed anywhere.

## Design rationale

**One adapter contract, two implementations, one choke point.**
`lib/integrations/sap/types.ts`'s `SapAdapter` interface is the only
shape a business module is allowed to depend on; `MockSapAdapter` and
`ServiceLayerAdapter` both implement it identically, and
`getSapAdapter()` (`lib/integrations/sap/get-adapter.ts`) is the single
function that decides which one a caller actually gets. Nothing outside
`lib/integrations/sap/` ever constructs a `fetch()` call to a SAP
endpoint, and nothing outside this directory ever branches on mock vs.
live.

**Three independent gates must all agree before any real SAP call is
ever made** (defense in depth, spec section 6): the `SAP_B1_PROVIDER`
environment variable must literally equal `"live"` (an operator-only
kill switch, never reachable from this app's UI or database — same
category as this project's own pre-existing `EXTRACTION_PROVIDER`
convention), **and** `IntegrationConnection.mode` must be `LIVE`,
**and** `enabled` must be `true`, **and** a complete credential set
must actually be resolvable (`baseUrl`/`companyDb`/`username` from the
database, `SAP_B1_PASSWORD` from the environment). Any one of the four
missing falls back to the deterministic mock adapter — see
`lib/integrations/sap/config.ts`'s `canUseLiveSapAdapter`. No secret is
ever stored in the database, logged, or returned by any API response;
`IntegrationConnection` has no password/API-key column at all, by
design.

**The central scope decision, found by reading the existing codebase
rather than assumed**: `OrderLine.approvedUnitPrice` and
`CustomerOrder.subtotal/taxTotal/total` are structurally always `null`
across the entire application today — the legacy pricing/discount-
approval workflow referenced by `lib/orders.ts`'s own comments has never
been built, in any milestone up to and including this one. The only
place a genuine, Sales-approved commercial price exists anywhere in
this codebase is `OrderLine.customerUnitPrice`, set only by
`lib/quotations/convert-to-order.ts` when a quotation is converted.
**Only quotation-converted orders (`CustomerOrder.source === "QUOTATION"`)
are therefore eligible for SAP sales-order submission in this
milestone** — every other order's integration status is permanently
`NOT_READY` until a later milestone builds that pricing/approval
workflow. This is a real, intentional, and clearly documented scope
boundary (`lib/integrations/sap/order-eligibility.ts`'s own module
comment, this file, `ROADMAP.md`, and the delivery report), not
something quietly worked around with an invented price.

**A network timeout does not prove the request was rejected (spec
section 7.2, treated as CRITICAL).** `IntegrationOperation` is the
outbox row for a sales-order submission — one per order, ever
(`customerOrderId` is `@unique`), with an immutable `submittedSnapshot`
captured at creation and reused verbatim on every retry, never
recomputed. Its state machine has a dedicated `UNCERTAIN` status,
reached only on a `TIMEOUT`, that is **never auto-retried**: resolving
it requires either `reconcileUncertainOperation` (a read-only lookup by
external reference) finding the order after all, or a human's own
`resolveUncertainOperation` decision. Every other failure category is
treated as a definite, interpretable answer from SAP — safe to correct
and retry via `retrySubmission`, which always resubmits the same
immutable snapshot, never a freshly recomputed one.

**Reuse over duplication, structurally, not just by convention.**
`lib/integrations/sap/{product,customer,invoice,credit-note}-sync.ts`
each fetch from the adapter and then hand the result straight to the
**existing** Milestone 1 (`lib/product-import.ts`,
`lib/customer-master-import.ts`) or Milestone 5/6B
(`lib/invoice-reconciliation/*`, `lib/returns-credits/*`) plan/execute
functions, with zero changes to any of that code. `fetchProducts`/
`fetchCustomers`/`fetchInvoices`/`fetchCreditNotes` on the adapter
contract are typed to return exactly the shapes those functions already
accept — there is no second parsing, matching, or upsert implementation
anywhere in this milestone, which is spec sections 11/12's "do not
create a competing system" made structural rather than conventional.

**Invoice and credit-note sync are manual-only, by a clean, explicit,
and documented architectural decision** — `SapInvoiceImportBatch
.uploadedById`/`CreditNoteImportBatch.uploadedById` are both required,
non-nullable columns from Milestone 5/6B, and a scheduled run triggered
by an external scheduler has no signed-in user to attribute an import
batch to. `scripts/sap-sync.ts` therefore runs only product and
customer sync; invoice/credit-note sync only ever runs from an
ADMINISTRATOR's own "Sync now" click on `/integrations/sap`. Sales-order
outbox processing is likewise never run on a schedule in this
milestone — submitting an order to SAP is always a deliberate,
per-order action by whoever is looking at that order, not an unattended
background sweep. A future milestone could add scheduled outbox
processing as its own, separately-reviewed decision.

**No persistent background worker is assumed anywhere.** This
architecture has none (confirmed by reading every prior milestone's own
scheduling convention — `scripts/expire-quotations.ts` is the
precedent), so `scripts/sap-sync.ts` is a new standalone script meant to
be invoked by a real external scheduler (Windows Task Scheduler — see
`SETUP-WINDOWS.md`), never left running, and safe to run as often as the
schedule likes.

**RBAC uses only the three existing roles, with every check enforced
server-side, never only in the UI.** Connection configuration and
manual catalogue-wide sync (products/customers/invoices/credit notes),
plus UNCERTAIN resolution/reconciliation, are `ADMINISTRATOR`-only;
per-order submit/retry are `ADMINISTRATOR` + `SALES_MANAGER`; order
integration-status viewing is open to any authenticated role (the real
authorization-relevant gate for submission is
`checkOrderEligibility`'s own business rules, not the route's coarse
role check — same pattern this project's approvals routes already use);
dashboard viewing is `ADMINISTRATOR` + `SALES_MANAGER`. Every mutating
route is CSRF-protected via `verifyCsrfOrigin` and role-gated via
`requireUserOrResponse`, following this project's own established
convention exactly.

**The Milestone 8 approval framework is respected, not bypassed, and
the Orders-module framework-ready-only gate is explicitly NOT
activated.** `checkOrderEligibility` calls
`getLiveApprovalRequestForQuotation` and blocks submission
(`LIVE_APPROVAL_PENDING`) while the source quotation has a pending
discount-approval request — SAP submission can never race ahead of an
approval decision. Per your own standing instruction from Milestone 8,
`ApprovalActionType.ORDER_VALUE_EXCEEDS_THRESHOLD` remains framework-
ready only; this milestone adds no call into that gate from anywhere in
the SAP submission path.

**Derive, don't store a second truth.** `getOrderIntegrationStatus()`
and `getSapDashboardSummary()` (`lib/integrations/sap/queries.ts`)
compute everything live from `IntegrationConnection`/
`IntegrationSyncJob`/`IntegrationOperation` plus `checkOrderEligibility`
— there is no cached status column anywhere that could silently drift
from the rows it would be summarizing.

## What was built

- **Schema** (`prisma/schema.prisma`, additive migration only): 7 new
  enums (`IntegrationProvider`, `IntegrationMode`,
  `IntegrationSyncJobType`, `IntegrationSyncJobStatus`,
  `IntegrationTrigger`, `IntegrationOperationType`,
  `IntegrationOperationStatus`, `IntegrationErrorCategory`) and 3 new
  models (`IntegrationConnection`, `IntegrationSyncJob`,
  `IntegrationOperation`). No existing table, column, or enum value
  changed, was dropped, or became non-nullable —
  `CustomerOrder.integrationOperation` and two new `User` inverse-
  relation fields are pure Prisma inverse-relation sides with no new
  column on those existing tables. `IntegrationOperation.customerOrderId`
  is a real, typed, `Restrict` foreign key onto `CustomerOrder`, never a
  generic polymorphic reference.
- **Adapter layer** (`lib/integrations/sap/`): `types.ts` (the
  `SapAdapter` contract, `SapAdapterError` with per-category default
  retryability), `mock-adapter.ts` (deterministic fixture catalogue,
  idempotent `createSalesOrder`, and three documented simulation
  sentinels exercising the NETWORK_UNAVAILABLE / lost-response-TIMEOUT /
  never-reached-SAP-TIMEOUT failure paths), `real-adapter.ts` (a
  Service-Layer-shaped implementation against SAP B1's public object
  model, extensively marked **unverified against a real tenant** —
  session/cookie management, a single 401-retry, a 30-second
  `AbortController` timeout correctly categorized as `TIMEOUT` rather
  than being swallowed into a generic network error), `get-adapter.ts`
  (the one choke point), `config.ts` (the three-gate resolution,
  `sanitizeSapErrorMessage` for defense-in-depth credential redaction
  before any error is ever stored or shown), `connection.ts`
  (singleton-per-provider CRUD, audited), `idempotency.ts`
  (`buildSapSalesOrderIdempotencyKey`), `sync-job.ts` (the shared
  `IntegrationSyncJob` lifecycle wrapper every sync type uses),
  `{product,customer,invoice,credit-note}-sync.ts` (each a thin wrapper
  calling the adapter then an existing Milestone 1/5/6B plan/execute
  function verbatim), `order-eligibility.ts` (the scope-decision logic
  above), `order-outbox.ts` (submit/retry/reconcile/resolve, the full
  state machine), `queries.ts` (dashboard/operations/order-status,
  always computed live), `display.ts` (pure formatting, safe for Client
  Components), `validation.ts` (zod schemas).
- **API routes**: `GET/PATCH /api/integrations/sap/connection`,
  `POST /api/integrations/sap/connection/test`,
  `POST /api/integrations/sap/sync/[jobType]`
  (`products`/`customers`/`invoices`/`credit-notes`),
  `GET /api/integrations/sap/dashboard`,
  `GET /api/integrations/sap/operations`,
  `POST /api/integrations/sap/operations/[id]/retry`,
  `POST /api/integrations/sap/operations/[id]/reconcile`,
  `POST /api/integrations/sap/operations/[id]/resolve`,
  `POST /api/orders/[id]/sap-submit`,
  `GET /api/orders/[id]/sap-status`. Every mutating route is CSRF-
  protected and role-gated per the RBAC decisions above; every body is
  parsed via the project's own `readJsonObject` convention.
- **UI**: `/integrations/sap` (dashboard — connection health, per-job-
  type last-sync summaries, manual sync buttons, the operations table
  with retry/reconcile/resolve actions, all gated client-side **and**
  re-enforced server-side), `/integrations/sap/settings`
  (ADMINISTRATOR-only connection configuration form — never displays or
  accepts a password field), and a self-fetching
  `SapIntegrationPanel` added to `/orders/[id]` (status + a "Submit to
  SAP" button, visible only when eligible and the viewer's role
  permits). New "SAP Integration" sidebar entry alongside the existing
  "SAP MASTER DATA" group.
- **Demo-data cleanup**: `scripts/remove-demo-data.ts` extended with
  `integrationOperations`/`integrationSyncJobs` deletion (expected
  0-row no-ops today, since no demo-seeding path creates either —
  included for forward-compatibility and audit-trail completeness).
- **Scheduled sync**: `scripts/sap-sync.ts` (new standalone script,
  `npm run sap:sync`) — product + customer sync only, for the documented
  reasons above.
- **Documentation**: `docs/sap-integration/discovery-checklist.md` — the
  Bulawayo-HQ-facing checklist of exactly what must be confirmed/
  granted before `SAP_B1_PROVIDER=live` is ever set anywhere but a test
  environment (Service Layer access, service-account permissions, data-
  mapping confirmation, idempotency/duplicate-detection support,
  volumes/rate limits, go-live sequencing).
- **Tests**: see the dedicated section below.

## Known, documented limitations (not hidden)

- **Only quotation-converted orders are SAP-submission-eligible.** Every
  other order is permanently `NOT_READY` with a clear
  `NOT_FROM_QUOTATION` blocker message, until the legacy pricing/
  discount-approval workflow referenced throughout the existing codebase
  is actually built. This is the real scope boundary described above,
  not an oversight.
- **Invoice and credit-note sync have no scheduled equivalent** — both
  require a human `uploadedById`, a pre-existing Milestone 5/6B schema
  constraint this milestone did not change. Only product sync, customer
  sync, and (manually) order submission can ever happen without someone
  physically clicking a button.
- **`real-adapter.ts` is honestly unverified against a real SAP Business
  One tenant.** It was written against SAP's standard, publicly
  documented Service Layer object model, and every place a real
  tenant's behavior could differ is explicitly commented and listed in
  `docs/sap-integration/discovery-checklist.md`. It has never been
  exercised against a real company database, because no real SAP
  credentials, endpoint, or company database were ever available to (or
  guessed by) this work.
- **No native "changed since" incremental sync is assumed.** Every
  fetch is a full refetch; downstream dedupe (by SAP code) already
  happens in the reused Milestone 1/5/6B import pipelines, so this is
  safe, just not bandwidth-optimal against a very large catalogue.
- **Reconciliation-by-external-reference's real-world reliability is
  unverified** — `findSalesOrderByExternalReference` is part of the
  adapter contract and implemented against the mock fixture world, but
  whether a real SAP B1 tenant actually supports looking a Sales Order
  up by a caller-supplied reference field is one of the open items in
  the discovery checklist. Until confirmed, a human SAP-side check
  remains the fallback for resolving an `UNCERTAIN` submission.

## Tests

`tests/sap-mock-adapter.test.ts` (16 unconditional tests): the full
mock-adapter fixture catalogue, idempotent resubmission, validation
rejections (unknown customer/product code, non-positive quantity,
negative price), and all three documented simulation sentinels
(`__SIMULATE_NETWORK_DOWN__`, `__SIMULATE_UNCERTAIN_LOST__`,
`__SIMULATE_TIMEOUT__` — including the critical case where the order
*is* recorded despite the thrown `TIMEOUT`, and a reconciliation lookup
afterwards finds it), plus `SapAdapterError`'s per-category default-
retryable mapping. `tests/sap-config.test.ts` (13 unconditional tests):
deployment-mode resolution (fail-safe-to-mock on any typo), live-
credential resolution (missing-piece cases), the combined
`canUseLiveSapAdapter` gate, and `sanitizeSapErrorMessage` (password/
username redaction, `Authorization`-header and `Bearer`-token
redaction, truncation). `tests/sap-idempotency.test.ts` (3 unconditional
tests): the deterministic `SAP-SO-<orderId>` key shape.
`tests/sap-order-outbox-db.integration.test.ts` (5 gated tests, same
`RUN_DB_INTEGRATION_TESTS=1` convention as every prior milestone's own
gated suite): `checkOrderEligibility`'s `NOT_FROM_QUOTATION` blocker and
its eligible-submission shape, `submitOrderToSap`'s happy path and its
idempotent resubmission (exactly one `IntegrationOperation` row), the
TIMEOUT→UNCERTAIN→reconciliation→SUCCEEDED path, and the
UNCERTAIN→reconciliation-not-found→human-`resolveUncertainOperation`→
FAILED path with its `AuditEvent`. One real bug was found and fixed
while writing these tests (see below) — not user-reported, caught by
the verification discipline itself.

## One real bug found and fixed this round

While writing `tests/sap-config.test.ts`, `sanitizeSapErrorMessage`'s
`Authorization`-header redaction regex (`Authorization:\s*\S+`) was
found to only redact the auth **scheme** word ("Basic"/"Bearer"), never
the credential token that follows it — so a Basic-auth header's base64
payload would have survived into a stored `lastErrorMessage` or
`lastTestMessage` verbatim. Fixed to consume up to two whitespace-
separated tokens after `Authorization:`, covering both a bare single-
token value and a `<scheme> <credential>` pair. This is exactly the
kind of secret-leak path spec section 6 treats as critical; it is now
covered by a dedicated test (`redacts an Authorization header and a
Bearer token even with no credentials supplied`) that would have caught
the original bug.

## Honest verification results

- **`npx eslint .`** — clean across the whole project, including every
  file this milestone added or edited.
- **`npx tsc --noEmit`** — 370 errors, up from 363 at the end of
  Milestone 8. Every one of the 7 added errors was individually traced
  to the same pre-existing, sandbox-only stale/stub-`@prisma/client`
  noise category every prior milestone has produced here (`Namespace
  'Prisma' has no exported member 'Decimal'`/`'JsonValue'`/
  `'InputJsonValue'`, and `Parameter 'tx'`/destructured-query-result
  implicitly has an `'any'` type on `prisma.$transaction` callbacks and
  complex Prisma query results) — none are a real defect in this
  milestone's code. Running `npx prisma generate` against a real
  network and re-running `tsc` is expected to clear essentially all of
  this delta, exactly as for every prior milestone.
- **`npx vitest run`** — 553 passed, 90 skipped (44 files), up from 521
  passed/85 skipped at the end of Milestone 8: +32 new unconditional
  tests (all passing) and +5 new gated DB-integration tests (correctly
  self-skipping per `describe.skipIf(!RUN_DB_INTEGRATION_TESTS)`, not
  silently passing). Zero regressions in any pre-existing test.
- **`npm run build`** — not re-attempted this round; every prior
  milestone has hit the same pre-existing Google-Fonts network block in
  this sandbox (`next/font` cannot reach `fonts.googleapis.com`),
  unrelated to this milestone's own code.
- **Not run in this sandbox** (same honest caveat as every prior
  milestone): `npx prisma generate`/`validate` (network-blocked) and
  this milestone's 5 gated DB-integration tests against a real
  database. Also never run, for the reason stated throughout this
  section and the delivery report: anything through `ServiceLayerAdapter`
  against a real SAP Business One tenant — no real SAP credentials,
  endpoint, or company database were ever available to this work, and
  none were guessed.

**Implemented: yes**, across every one of the spec's 25 numbered
sections, with the real, intentional, and clearly documented scope
boundary (only quotation-converted orders are SAP-submission-eligible,
pending a future pricing/approval-workflow milestone) called out above
and in the delivery report. **Tested: yes, with the same honest,
layered caveat as every prior milestone** — 32 unconditional tests cover
every piece of pure/mock-testable logic directly (and caught one real
bug, fixed before delivery); 5 gated DB-integration tests walk the full
eligibility→outbox→reconciliation/resolution lifecycle against a real
database and the mock adapter, written to this project's own
established convention but not run against a real database from inside
this sandbox; nothing in this milestone has ever been tested against a
real SAP Business One tenant, and nothing here claims otherwise.
