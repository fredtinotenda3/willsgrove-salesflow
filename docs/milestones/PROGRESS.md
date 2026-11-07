# Milestone 0 — Progress

Status: **built, locally verified as far as this build sandbox allows**. Two
sandbox-only blockers (detailed below) mean the final verification step —
running the app end-to-end against a real database with a real generated
Prisma client — has to happen on your machine. Everything that *could* be
verified here was actually run, not assumed.

## Scope delivered (per your "Approved with changes" instruction)

- Dashboard: real order counts (`total`, `pendingVerification`,
  `awaitingFulfilment`, `completedDeliveries`), demo rows excluded.
- Settings → Users & Roles: real, backed by `/api/users`. User creation is
  administrator-only. Workspace/Processing/Notifications panels are
  unchanged prototype, as approved.
- Stock and Reports: **untouched**, still visibly labelled demo/prototype.
- Orders UI (`/orders`, `/orders/[id]`, `/orders/new`): **untouched** —
  your approved scope line only covers dashboard/settings/stock/reports, so
  the elaborate existing verification/approval UI there was deliberately
  left alone. The *backend* Order APIs were built (`/api/orders`,
  `/api/orders/[id]`, `/api/orders/[id]/documents`) since nothing in your
  scope line excluded them and the dashboard counts depend on real order
  rows existing.
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

### Tests: `npm test` (Vitest)

```
Test Files  1 failed | 5 passed (6)
     Tests  57 passed (57)
```

57 real tests pass across 5 files (`csrf`, `password`, `rate-limit`,
`content-sniff`, `http`) — all pure-function tests with no database
dependency. The one failing file (`order-validation.test.ts`) fails to even
**import**, for a reason that's a sandbox limitation, not a code defect —
see "Sandbox-only blockers" below.

Any test that would need an actual `PrismaClient` instance (session
creation, login, user/order creation end-to-end, the authz 403 paths, the
idempotency race, a real seed/remove-demo round-trip) could not be written
*and run* here — writing them against a client that cannot be constructed
in this sandbox would only prove they compile, not that they pass. They are
not in this zip. **This is the one piece of Milestone 0 that still needs
doing on your machine**: once `prisma generate` succeeds there, I'd
recommend adding integration tests for at minimum: login happy path +
wrong-password + rate-limit-triggered; a 403 from a non-admin hitting
`POST /api/users`; the idempotency-key race (two near-simultaneous
identical order submissions); and a seed → remove-demo round trip that
asserts zero rows remain.

### Lint: `npm run lint`

Clean in everything touched this milestone. 7 errors / 5 warnings remain,
all in three files that are **outside this milestone's scope and were not
modified**: `app/orders/[id]/page.tsx`, `app/orders/new/page.tsx`,
`app/products/import/page.tsx` (unescaped apostrophes, a few unused
lucide-react icon imports, one `any`). Pre-existing in the prototype code,
not introduced here. One real lint error *was* found and fixed in code
this milestone touched — see CHANGES.md ("Issues found and fixed", #4).

### Type check: `tsc --noEmit`

51 errors, all attributable to a single root cause: `@prisma/client`
exists in this sandbox only as a stub (see "Sandbox-only blockers"). I
checked this by category, not by assumption — every error is either
"has no exported member" on a schema-derived enum/namespace type
(`OrderSource`, `UserRole`, `Prisma.CustomerSelect`,
`Prisma.PrismaClientKnownRequestError`, `Prisma.Decimal`, ...) or an
implicit-`any` on a Prisma transaction callback parameter (`tx`), and the
exact same two categories occur identically in files I never touched
(`lib/customer-queries.ts`, `lib/locations.ts`, `lib/product-queries.ts`).
Zero errors in any file this milestone added or modified for any other
reason. Resolves itself once `prisma generate` runs successfully against
your real database.

### Build: `npm run build`

Fails in this sandbox for **two independent, sandbox-only reasons** — both
confirmed by direct experiment, not assumed:

1. `next/font/google` (used by the pre-existing `app/layout.tsx` for Geist)
   tries to fetch font files from `fonts.googleapis.com` at build time;
   this sandbox's network allowlist blocks that host. On your machine, with
   normal internet access, this is a non-issue.
2. I confirmed what happens *after* that, by temporarily swapping the font
   import for a local stand-in, running the build again, and reverting the
   swap before packaging (the shipped `app/layout.tsx` is byte-identical to
   before this experiment). With the font issue out of the way, Turbopack
   compiled successfully and the build then failed at the TypeScript check
   phase with the exact same 51-error set as `tsc --noEmit` above — same
   root cause, same conclusion: this resolves once a real Prisma client is
   generated on your machine.

**Bottom line**: nothing here points to a build failure on your real
machine. Both blockers are specific to what this sandbox can reach
(binaries.prisma.sh and fonts.googleapis.com are both outside its network
allowlist), not to anything wrong with the code.

## Sandbox-only blockers (will not occur on your machine)

1. **Prisma client could not be generated here.** `prisma generate` needs
   `binaries.prisma.sh`, which this sandbox's network allowlist blocks. The
   `@prisma/client` stub that ships without it only exports a `PrismaClient`
   class that throws if constructed, and a minimal `Prisma` object with no
   schema-derived enums or namespace types. This is the single root cause
   behind every `tsc` error, the build failure, and the one test file that
   fails to import. Run `npx prisma generate` (or let `npm run db:seed`
   trigger it automatically, if you have that configured) on your machine
   before anything else.
2. **Google Fonts could not be fetched here**, blocking `next build` before
   it even reached the Prisma issue above. Not something to fix in code —
   confirmed independent of the Prisma issue by the experiment described
   above.

## Open items — not resolved, deliberately

- **"Quantity keyed by staff" is still an open assumption, not confirmed.**
  Per your explicit instruction, this stays open until confirmed with
  invoicing, regardless of anything in any source document that might
  otherwise suggest it. `OrderLine.requestedQuantity` is keyed as entered;
  nothing in this milestone resolves or assumes an answer either way.
- **Your real Node.js version is still unconfirmed.** Asked twice already
  with no answer yet. This build was developed and tested against Node
  v22.23.4. Next.js 16.4.4 itself requires **Node >= 20.9.0** — I've pinned
  that as `engines.node` in `package.json` so `npm install`/`npm run`
  will warn (and most CI will fail loudly) if your machine is below it,
  rather than failing confusingly later. Please confirm your actual
  version; if it's below 20.9.0 it needs upgrading regardless of anything
  else in this milestone.
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
