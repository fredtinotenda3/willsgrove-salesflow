# Milestone 0 — Progress

Status: **built, and now verified against two real-machine runs** (your
`git status`/`npm test`/`tsc`/`lint`/`build` output, Node confirmed
**v20.20.2**). The first run found real issues — all fixed, see "Milestone 0
fix" below. The second run, against that fix, came back **fully clean on
`tsc`/`lint`/`npm test` (69/69)** and found exactly one more real,
previously-unknown bug — a `crypto.randomUUID()` prerender error in
`app/orders/new/page.tsx` — now also fixed. See "Milestone 0 fix round 2"
below, including an important correction to this document's own earlier
"Compiled successfully" claim. One sandbox-only blocker remains for
everything in this repo that depends on a real generated Prisma client
(detailed below), and it turns out to be harder than first described —
see that section for why the sandbox can never reach the build's
static-generation phase at all, by any workaround tried.

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
  and seed commands, how to undo the migration.

## Build / lint / typecheck / test results — reported honestly

This section now covers three runs: what your first real-machine run
confirmed or contradicted, the sandbox results after that fix round, and
what your second real-machine run (against that fix) confirmed, contradicted,
and found newly.

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
