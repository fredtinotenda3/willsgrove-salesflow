# Milestone 0 — Changes

Every file added, modified, or deleted to build Milestone 0, with the reason
for each. Grouped by area. No files were deleted.

**This file now covers five rounds**: the original Milestone 0 build
(sections below, built and verified only in the sandbox), the first
"Milestone 0 fix" round (made after your real Windows machine's first
`git status`/`npm test`/`tsc`/`lint`/`build` output came back), "Milestone 0
fix (round 3)" — your six numbered instructions on the real SAP catalogue
and combinable order intake — "Milestone 0 fix (round 4)": two real bugs
your round-3 real-machine run found (a transaction-timeout crash in
`npm run db:remove-demo`, and the one remaining pre-existing lint error),
plus an explanation of the 16 `tsc`/`build` errors and the vitest version
question — and this newest **"Milestone 0 fix (round 5)"** (see that
section near the end): a real, previously-unknown bug your manual test
script's step 5 found — `orderDate`/`requestedDeliveryDate` passed as bare
"YYYY-MM-DD" strings straight into Prisma `DateTime` fields, which Prisma
rejects outright — now fixed with a shared, unit-tested conversion helper,
a UTC-explicit display fix, a full codebase audit for the same bug class,
and an honest explanation of why nothing before this round could have
caught it. The original sections are left as they were written —
including two test-count mistakes in this file itself, corrected rather
than quietly edited away, with a note at each one — so you can see exactly
what changed between rounds and why.

## Database / Prisma

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | Modified | Added `Session` model; added `isDemo Boolean @default(false)` (+ index) to `User`, `Customer`, `CustomerLocation`, `Product`, `CustomerOrder`, `OrderLine`; added `User.mustChangePassword`; added `CustomerOrder.idempotencyKey` (unique) and the order-timing columns `receivedAt`/`extractedAt`/`reviewedAt`/`approvedAt`/`handedToSapAt`/`invoicedAt`. |
| `prisma/migrations/20261107070000_milestone_0_foundations/migration.sql` | Added | The migration for the schema change above. Purely additive: `ADD COLUMN` with defaults, one `CREATE TABLE` (`Session`), new indexes. No column drops, renames, or type changes — safe to run against a database that already has real data. |
| `prisma.config.ts` | Modified | Added `migrations.seed`, pointed at `tsx --conditions=react-server prisma/seed.ts` (see "server-only fix" below for why the flag is required). |
| `prisma/seed.ts` | Added | Seeds exactly one real account (the administrator, from `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`) plus a clearly-labelled set of demo products/customers/orders, all with `isDemo: true`, built by calling the same `createCustomer()`/`createOrder()` functions the real API uses (never a parallel insert path). Idempotent — safe to re-run. |
| `scripts/remove-demo-data.ts` | Added | One-command, one-transaction deletion of every `isDemo: true` row, in FK-safe order, with an audit event recording what was removed. Run with `npm run db:remove-demo`. |

## Auth (session, password, CSRF, rate limiting)

| File | Change | Reason |
|---|---|---|
| `lib/auth/password.ts` | Added | `hashPassword`/`verifyPassword` (bcrypt), `checkPasswordStrength` (rejects short/trivial/oversized passwords), `generateTemporaryPassword` (CSPRNG via `crypto.randomInt`, excludes visually-ambiguous characters) — used for the seeded admin's one-time credential and for every admin-created user. |
| `lib/auth/session.ts` | Added | DB-backed sessions: a signed JWT cookie carrying only a session id (`jose`, HS256, keyed by `AUTH_SECRET`); every read re-verifies the signature and re-checks the `Session` row (expiry, revocation) and the user's `status` against the database — nothing is trusted from a cached claim. `createSession`/`resolveSession`/`revokeSession`/`revokeAllSessionsForUser`/`pruneExpiredSessions`. |
| `lib/auth/current-user.ts` | Added | The actual authorization boundary. `getCurrentUser()`/`requireUser()`/`requireUserOrResponse()` — every route handler, Server Action, and the dashboard Server Component call one of these directly; none of them assume `proxy.ts` already checked anything. |
| `lib/auth/cookies.ts` | Added | `setSessionCookie`/`clearSessionCookie` — centralizes the cookie attributes (`httpOnly`, `sameSite: "lax"`, `secure` in production) so login/logout/change-password can't drift from each other. |
| `lib/auth/csrf.ts` | Added | `verifyCsrfOrigin()` — the second CSRF layer (`SameSite=Lax` is the first). Checks the `Origin` header (falling back to `Referer`) against `APP_BASE_URL` on every cookie-authenticated mutating request; fails closed if `APP_BASE_URL` is unset. Covered by `tests/csrf.test.ts` (7 tests). |
| `lib/auth/rate-limit.ts` | Added | In-memory sliding-window rate limiter. `checkRateLimit`, `loginRateLimitKey` (keyed by IP + normalized email), `LOGIN_RATE_LIMIT` (8 attempts / 10 minutes). Covered by `tests/rate-limit.test.ts`. **Known limitation, documented here rather than hidden**: in-memory means limits reset on process restart and aren't shared across multiple server instances — fine for a single-instance deployment, not sufficient once this runs behind more than one app process (would need Redis or similar at that point). |
| `lib/auth/validation.ts` | Added | `loginSchema`, `changePasswordSchema` (zod), `normalizeEmail`. |
| `proxy.ts` | Added | The **optimistic-only** check: redirects to `/login` when a protected page request has no session cookie at all, so a signed-out visitor gets a fast redirect instead of a flash of protected UI. Explicitly documented in its own comments as not the security boundary — it never verifies the cookie, never touches the database, and every real check happens again in `lib/auth/current-user.ts`. |
| `app/login/page.tsx` | Added | Sign-in form; posts to `/api/auth/login`; redirects to `/change-password` when the account's `mustChangePassword` is set, otherwise to `?next=` or `/`. |
| `app/change-password/page.tsx` | Added | Change-password form, reachable by any authenticated user; used both for the seeded admin's forced first change and for voluntary changes later. |
| `app/api/auth/login/route.ts` | Added | `POST` — CSRF check, zod validation, rate limit (by IP+email), constant-shaped "incorrect email or password" response (doesn't reveal which part was wrong or whether the email exists), creates the session, sets the cookie. |
| `app/api/auth/logout/route.ts` | Added | `POST` — CSRF check, revokes the session row, clears the cookie. |
| `app/api/auth/session/route.ts` | Added | `GET` — "who am I" endpoint for client components (sidebar user badge, change-password's forced-flow check). |
| `app/api/auth/change-password/route.ts` | Added | `POST` — CSRF check, requires authentication (deliberately not role-restricted — it's how `mustChangePassword` gets cleared), verifies the current password, enforces strength on the new one, revokes every *other* session for that user (keeps the current one so the user isn't logged out by their own change), audit-logs the event. |

## Storage + order document upload

| File | Change | Reason |
|---|---|---|
| `lib/storage/types.ts` | Added | `StorageDriver` interface and `StoredFile` type — storage is a swappable abstraction, not hard-coded to the filesystem. |
| `lib/storage/local-disk-driver.ts` | Added | The one implemented driver. Storage keys are server-generated random UUIDs (never derived from the uploaded filename), and every path is validated to stay inside the configured root before any filesystem access — defense against path traversal even if the key validation elsewhere were ever bypassed. |
| `lib/storage/content-sniff.ts` | Added | Hand-rolled magic-byte content sniffing (PDF, JPEG, PNG, zip-based/xlsx, text) so an upload's *actual* type is checked against its claimed `Content-Type`, not just trusted. Covered by `tests/content-sniff.test.ts` (12 tests). **A real bug was found and fixed while writing those tests** — see "Issues found and fixed" below. |
| `lib/storage/index.ts` | Added | `getStorageDriver()` factory reading `STORAGE_DRIVER` (only `"local"` implemented this milestone), cached singleton. |
| `app/api/orders/[id]/documents/route.ts` | Added | `POST` — CSRF check, auth check, order-exists check, 20MB size limit, content-sniffed and validated before storing, stored via the storage driver, `OrderDocument` row + `AuditEvent` created in one transaction; if the DB write fails, the already-written file is deleted so storage and database can't drift apart. |
| `app/api/files/[id]/route.ts` | Added | `GET` — auth check, looks up the file by `OrderDocument` id (never by storage key, which is never exposed to the client), serves the bytes with a correctly-encoded `Content-Disposition` (ASCII fallback + RFC 5987 for non-ASCII filenames). |

## Orders and Users (APIs + validation)

| File | Change | Reason |
|---|---|---|
| `lib/order-validation.ts` | Added | zod schemas for order creation: decimal-as-string quantities (never floats), date-only strings, optional `idempotencyKey`. |
| `lib/orders.ts` | Added | `createOrder()` — generates a unique `ORD-<date>-<hex>` reference with retry-on-collision, honors `idempotencyKey` (including a race-safe path: a `P2002` unique-violation from two near-simultaneous identical requests is caught and the *other* request's row is returned rather than erroring), creates the order + lines + initial status history + audit event in one transaction. Deliberately leaves money fields (`subtotal`/`taxTotal`/`total`/`lineTotal`) null — those represent Willsgrove-approved amounts a later milestone's price-decision workflow sets, never auto-computed from customer-submitted prices. Accepts an `options?: { isDemo?: boolean }` third parameter used **only** by `prisma/seed.ts` — `isDemo` is not part of the public zod input type, so it cannot be set through the HTTP API. |
| `lib/order-queries.ts` | Added | `listOrders()` (excludes `isDemo` rows by default), `getOrderById()`, and `getDashboardOrderCounts()` — the function behind the dashboard's real stat cards. See "Open items" below for the documented, best-effort meaning of `awaitingFulfilment`. |
| `app/api/orders/route.ts` | Added | `GET` (list) / `POST` (create) — any authenticated user; zod-validated; CSRF-checked on `POST`. |
| `app/api/orders/[id]/route.ts` | Added | `GET` (detail, with lines/documents/status history). |
| `lib/user-validation.ts` | Added | zod schemas for user creation and status updates, against the real `UserRole`/`RecordStatus` enums. |
| `lib/users.ts` | Added | `createUser()` (generates a temporary password, hashes it, sets `mustChangePassword: true`, audit-logs it, returns the plaintext temporary password **once** — it is never retrievable again); `updateUserStatus()` (rejects self-deactivation with a 409); `revokeSessionsIfDeactivated()`; `listUsers()`. |
| `app/api/users/route.ts` | Added | `GET` (list — any authenticated user, matching the existing Settings UI which shows the directory to everyone) / `POST` (create — **administrator-only**, per your explicit instruction; CSRF-checked). |
| `app/api/users/[id]/route.ts` | Added | `PATCH` (status toggle — administrator-only, CSRF-checked). |
| `lib/customers.ts` | Modified | `createCustomer()` gained an `options?: { isDemo?: boolean }` second parameter, set on both the `Customer` row and its nested `locations.create` — same "library-function-only, not in the public zod type" pattern as orders, so the public API can never create a demo row. |

## Hardening existing routes (defense in depth)

Per your instruction that `proxy.ts` is optimistic-only and every route handler must re-check authorization and CSRF itself, the following pre-existing routes were hardened. None of their business logic changed.

| File | Change |
|---|---|
| `app/api/customers/route.ts` | Added `requireUserOrResponse()` (GET+mutating) and `verifyCsrfOrigin()` (mutating only). |
| `app/api/customers/[id]/route.ts` | Same. |
| `app/api/customers/[id]/locations/route.ts` | Same. |
| `app/api/customers/[id]/locations/[locationId]/route.ts` | Same. |
| `app/api/products/route.ts` | Same. |
| `app/api/products/import/route.ts` | Same. |
| `app/api/products/import/preview/route.ts` | Added `requireUserOrResponse()` only — no CSRF check, documented inline, because this endpoint performs no database writes (it's a dry-run preview). |

## UI rewired to real data

Per your approved scope for the *original* Milestone 0 build: dashboard
counts and settings/users only. Orders pages, stock, and reports were
**unchanged** in this round and stayed visibly labelled demo/prototype.
(The orders pages were wired to real data in the "Milestone 0 fix" round,
per your fix-round instruction — see that section below. Stock and reports
are still untouched/demo, as instructed.)

| File | Change | Reason |
|---|---|---|
| `app/page.tsx` (dashboard) | Modified | Added `export const instant = false` (Next.js 16's documented escape hatch for a page that reads the session at request time ahead of being restructured behind `<Suspense>` for Cache Components — see the Next.js docs citation in the file's comment). Added the real `getCurrentUser()`/redirect check. Replaced the hardcoded stat array with real counts from `getDashboardOrderCounts()`. Removed the fabricated trend badges (e.g. "+12%") rather than inventing fake percentages against real numbers. |
| `app/settings/page.tsx` | Modified | Users & Roles panel now reads/writes real data via `/api/users`: loading/error states, admin-gated "Add User" button, one-time temporary-password display with a copy button, self-deactivation prevented in the UI, `mustChangePassword` badge. Workspace/Processing/Notifications panels are unchanged (still prototype, as approved). **A real cascading-render bug was found and fixed here** — see "Issues found and fixed" below. |
| `app/components/sidebar.tsx` | Modified | Fixed a real bug: the active-link highlight used a naive check that always lit up "Dashboard"; replaced with a correct `usePathname()`-based check (exact match for `/`, prefix match otherwise). Removed the hardcoded fake "12" Orders badge. Added a real user badge (fetches `/api/auth/session`) and a working logout menu. |

## Tests

**Correction (see "Milestone 0 fix" section below):** the two counts marked
with a strikethrough were simply miscounted when this table was first
written — written from memory rather than recounted against the actual file.
Your real terminal's test run caught it (its own summary line is the ground
truth: `Tests 2 failed | 57 passed (59)` across the 5 files that could even
import in the sandbox's Node, which is exactly 7+10+8+12+20+2 = 59).

| File | Status |
|---|---|
| `tests/csrf.test.ts` | 7/7 passing. |
| `tests/password.test.ts` | ~~11/11 passing~~ → **10/10 passing.** |
| `tests/rate-limit.test.ts` | ~~9/9 passing~~ → **8/8 passing.** |
| `tests/content-sniff.test.ts` | 12/12 passing. |
| `tests/http.test.ts` | 20/20 passing. |
| `tests/order-validation.test.ts` | **Fails to import in this sandbox** — see PROGRESS.md. Not a code defect; expected to pass unmodified once `prisma generate` runs on a real machine. (Originally 2 tests; rewritten with 12 in the fix round below.) |
| `vitest.config.mts` | Added (renamed from a `.ts` draft) — path alias + the `react-server` export condition fix (see below). |

## Config / tooling

| File | Change | Reason |
|---|---|---|
| `package.json` | Modified | Added `server-only` dependency, `tsx` devDependency, `engines.node: ">=20.9.0"` (Next.js 16's own minimum — see PROGRESS.md re: your Node version), scripts `db:seed`, `db:remove-demo`, `test`. |
| `.env.example` | Added | Every environment variable the code actually reads (verified by grepping for every `process.env.*` reference), each with a placeholder or a generation instruction — no real secret anywhere in it. |
| `.gitignore` | Modified | Added `!.env.example` immediately after the pre-existing `.env*` rule. Without it, `.env.example` itself would be silently git-ignored (it matches `.env*`) and never committed — which would break the setup flow in `SETUP-WINDOWS.md` (`Copy-Item .env.example .env.local` needs the template to actually be in the repo). Found by checking the gitignore rule against the new file, not assumed to be fine. |

## Issues found and fixed during this milestone

These were caught by actually running the code (tests, `tsc`, `next build`, `npm run db:seed`), not assumed to work — per your "report honestly" instruction, they're listed here rather than silently folded in.

1. **`server-only` package was never actually installed**, even though 8 files imported it. `npm install server-only` alone was not enough: the package's own code throws unless the module resolver sets Next's `"react-server"` export condition, which only Next's own bundler sets automatically. This would have broken your real `npm run db:seed` / `npm run db:remove-demo` commands (they run via `tsx`, not through Next). Fixed by adding `--conditions=react-server` to those commands and to `prisma.config.ts`'s `migrations.seed`, and `ssr.resolve.conditions: ["react-server"]` to `vitest.config.mts`.
2. **`app/api/files/[id]/route.ts`**: `new NextResponse(data, ...)` where `data` is a Node `Buffer` is a genuine TypeScript error (`Buffer` isn't a `BodyInit`). Fixed with `new NextResponse(new Uint8Array(data), ...)`.
3. **`lib/storage/content-sniff.ts`**: the text-detection heuristic treated any byte `>= 0x80` as "printable" without checking it was valid UTF-8, so an arbitrary binary blob made of high bytes (tested with `0xCAFEBABE`) was misclassified as `"text"` and would have been accepted as a `text/csv` upload. Found by its own test suite, not assumed correct. Fixed with strict UTF-8 decoding (`TextDecoder("utf-8", { fatal: true })`, using `{ stream: true }` so a multi-byte sequence truncated only by the 2048-byte sample window doesn't cause a false rejection).
4. **`app/settings/page.tsx`**: the mount effect called `loadUsers()` directly, an async function whose first two statements (`setUsersLoading(true)`, `setUsersError(null)`) ran synchronously before its first `await` — a real cascading-render pattern (caught by `eslint-plugin-react-hooks`' `set-state-in-effect` rule, not dismissed as a false positive). Fixed by extracting a pure `fetchUsersList()` with no `setState` calls; the mount effect now only sets state inside the `.then()` continuation, and `loadUsers()` (unchanged) is kept for the two event-handler call sites where resetting the loading/error flags on refresh is genuinely wanted.
5. **`.gitignore`**: its existing `.env*` rule would have silently excluded the new `.env.example` from version control. Fixed by adding `!.env.example` immediately after it.

## Milestone 0 fix (after your real-machine run)

Everything below was built and verified against your actual terminal output
(`git status`, `npx prisma generate`/`migrate deploy`/`migrate status`,
`npm run db:seed`, `npm test`, `npx tsc --noEmit`, `npm run lint`,
`npm run build`, and your confirmed `node -v`: **v20.20.2**), per your
4-item fix instruction. This delivery contains **only the files changed in
this round** — not the full Milestone 0 file set again.

### Orders pages wired to the real APIs (your item 1)

| File | Change | Reason |
|---|---|---|
| `app/orders/page.tsx` | Rewritten | Was fully hardcoded (`initialOrders` array, a fake status type including `"Picking"`/`"Dispatched"`/`"Delivered"` — none of which exist in `OrderStatus`). Now fetches `GET /api/orders` with search/status-filter/pagination wired to real query params, maps to the real 7-value `OrderStatus` enum, shows `total` as "Pending pricing" when null instead of inventing an amount. The 4 summary cards are 4 cheap (`pageSize=1`) calls to the same endpoint reading only `pagination.totalItems` — real counts, no new API route, no fabricated numbers. |
| `app/orders/[id]/page.tsx` | Rewritten | Was gated behind `isKnownOrder = orderReference === "PO-219246"` with a fake, non-functional "verification workflow" (`markVerified`/`flagDiscrepancy`/`prepareApproval`, `alert()` stubs) that had no backing API — `ProductVerification`/`PriceDecision`/`OrderApproval` exist in the schema but no route handler was built for them this milestone. Rewritten as an **async Server Component** (not a Client Component) that receives `params` directly and calls `getOrderById()` — same pattern already used by the dashboard (`app/page.tsx`), with `export const instant = false` for the same reason. This also sidesteps the fatal `useParams()` outside `<Suspense>` build error your log showed, by removing the client hook entirely rather than working around it. The fake workflow is replaced with a real, honest read-only view (customer, line items, documents with working download links, status history) plus a clearly-labelled notice that verification/pricing/approval isn't built yet. |
| `app/orders/new/page.tsx` | Rewritten | Was fully hardcoded: 7 fake customer names in a `<select>`, a file picker that never uploaded anything, **no order-lines editor at all** (meaning it could never have created a real order — `createOrderSchema` requires at least one line), and `handleSubmit` just ran client validation and `alert()`ed. Rewritten with: a real customer search against `GET /api/customers`, a location picker populated from `GET /api/customers/[id]` once a customer is chosen, a genuine order-lines editor (add/remove rows; description/quantity/unit required, matching `orderLineInputSchema` exactly; optional SAP product search/link against `GET /api/products`; optional customer price), real submission to `POST /api/orders` (with an `idempotencyKey` so a dropped-response retry can't create a duplicate order, and field-level validation errors surfaced per line), and — per your explicit instruction — upload of the original PO file via `POST /api/orders/{id}/documents` *after* order creation succeeds, with honest success/failure reporting and a retry button if the upload fails. A pasted message (when "Paste Message" is chosen instead of a file) is saved verbatim into the order's internal notes, clearly labelled — there is no backend that extracts order lines from free text in this milestone, so it is never pretended to populate the line editor. |
| `lib/order-display.ts` | Added | Single source of truth for mapping the real `OrderStatus`/`OrderSource`/`VerificationStatus`/`DocumentType` enums to UI labels/colours/formatters, shared by all three pages above (and a safe `orderSourceLabel()` helper, since the list page receives `source` as a plain string over the wire). Extracted specifically so the three pages can't drift out of sync with each other or with the schema the way three independent copies of the same status map eventually would. |

**A real routing decision, flagged explicitly**: the orders list now links to
`/orders/{id}` (the database id), not `/orders/{reference}` (the human
`ORD-...` string), because `GET /api/orders/[id]` already looks up by the
Prisma id and changing that API wasn't in scope for this fix. The human
reference is shown prominently on the page itself; only the URL is opaque.

### Real build and tooling errors fixed (your item 4 / "fix all the errors shown on terminal")

1. **Vitest 5.1.0 cannot run on Node 20 at all** — this was my own tooling
   mistake, not a sandbox artifact. `npm view vitest@5.1.0 engines` confirms
   it declares `"^22.12.0 || ^24.0.0 || >=26.0.0"`. On your Node 20.20.2,
   this didn't just fail a test — it crashed Vitest's own reporter
   (`TypeError: Map.groupBy is not a function`, since `Map.groupBy` needs
   Node 22+) whenever a test failed, which is why your terminal showed a
   reporter crash instead of the two tests' actual failure details. **Fixed**
   by downgrading to `vitest@^4.1.12` (`engines: "^20.0.0 || ^22.0.0 ||
   >=24.0.0"`, confirmed via `npm view`) and realigning `@types/node` from
   `^22.9.0` to `^20.19.0` to match your actual runtime.
2. **`tests/order-validation.test.ts`'s one real (non-import-failure)
   assertion failure was my own test bug**, not a schema bug: the test used
   placeholder field names (`quantity`) instead of the schema's real ones
   (`originalProductDescription`, `requestedQuantity`, `requestedUnitCode`).
   Confirmed by reading `lib/order-validation.ts` directly — the schema was
   correct. **Fixed** by rewriting the test file properly (2 tests → 12:
   5 for `createOrderSchema`, 7 for `orderLineInputSchema`).
3. **`tests/password.test.ts`'s hash/verify round-trip genuinely timed out**
   at ~5042ms against Vitest's 5000ms default — not a bug in
   `SALT_ROUNDS = 12` (a correct, standard production bcrypt cost factor
   that should not be weakened just to make a test faster), but a real gap
   between the sandbox's faster CPU and your machine's. **Fixed** with
   `testTimeout: 20000` in `vitest.config.mts`, applied once, globally,
   rather than touching the cost factor.
4. **`app/api/health/route.ts` genuinely printed "Database health check
   failed... Can't reach database server" during your `next build`.**
   This went through two attempts, reported here honestly rather than only
   showing the final answer:
   - *First attempt (wrong):* added `export const dynamic = "force-dynamic"`,
     reasoning that Next's Cache Components build step was treating the
     bare `GET()` as a static-evaluation candidate. **This was incorrect and
     was caught by actually running `npm run build` against it before
     delivery** — Next 16's Cache Components model (`next.config.ts`:
     `cacheComponents: true`) rejects the legacy `dynamic` route segment
     config outright: `Route segment config "dynamic" is not compatible
     with nextConfig.cacheComponents. Please remove it.` It would not have
     built at all.
   - *Second attempt (correct, confirmed by a real build)*: removed the
     `dynamic` export entirely. Per Next's own migration guide, shipped in
     this exact version of the package
     (`node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md`,
     "Route Handlers (GET)"): under Cache Components, a `GET` handler is
     request-time by default and only needs `"use cache"` to opt **into**
     caching — the inverse of the pre-16 model `force-dynamic` assumed. This
     route's uncached `prisma.$queryRaw` call already makes it
     request-time-only with zero config. Verified with a real `next build`
     (worked around only the sandbox's separate, pre-existing Google Fonts
     network block to see past it) — Turbopack now reports **"Compiled
     successfully"**, with no error for this route.
5. **`/orders/[id]` had a second, separate fatal build error in your log**:
   `Next.js encountered URL data \`useParams()\` in a Client Component
   outside of \`<Suspense>\``. Rewriting the page as a Server Component (see
   the orders-pages table above) removes the client hook this error was
   about entirely, rather than working around it with a `<Suspense>`
   wrapper. Confirmed fixed by the same real `next build` run as above —
   no error for this route either.
6. **`npm install` crashed** with `Cannot read properties of null (reading
   'edgesOut')` (a known `@npmcli/arborist` bug) when resolving the
   downgraded vitest's peer dependencies against the *old* lockfile.
   **Fixed properly this time**: rather than telling you to add
   `--legacy-peer-deps` (which I'd only tentatively suggested before,
   flagged as possibly sandbox-specific and unverified), I regenerated
   `package-lock.json` from scratch (`rm -rf node_modules && npm install`)
   and confirmed a **plain** `npm install` against the regenerated lockfile
   works cleanly with no flag needed. `package-lock.json` is included in
   this delivery for exactly that reason — ship it, don't regenerate it
   yourself, or you may hit the same Arborist crash resolving the version
   change again.
7. **Four real `react-hooks/set-state-in-effect` lint errors**, introduced
   by me while writing the new `app/orders/page.tsx` and
   `app/orders/new/page.tsx` (caught by `npm run lint` before delivery, not
   after). Each was an effect that called `setState` synchronously in its
   body with no real external interaction — e.g. an effect whose entire job
   was `setPage(1)` derived from two other state values, and early-return
   branches that reset state no component actually reads while that branch
   is active. **Fixed** by removing the derived-state effect (resetting
   `page` directly at the two places `activeStatus`/`search` actually
   change) and deferring every remaining `setState` call past a `.then()`/
   `setTimeout` callback boundary, the same pattern already used to fix
   `app/settings/page.tsx` in the original Milestone 0 round.
8. **This file's own test-count table had two miscounts** (`password.test.ts`
   said 11/11, really 10; `rate-limit.test.ts` said 9/9, really 8) — simple
   errors made writing documentation from memory instead of recounting
   against the file. **Corrected above with a strikethrough**, not silently
   edited, per your "reconcile the test count" instruction.
9. **`app/orders/new/page.tsx` failed `next build` on your real machine**
   with `Next.js encountered the unstable value \`crypto.randomUUID()\` in a
   Client Component`, at the "Generating static pages" step — a build phase
   *later* than anything the previous round's sandbox verification reached
   (see "Your real-machine confirmation run" below for why). Root cause: Next
   16's Cache Components prerendering treats `crypto.randomUUID()` the same
   as `Math.random()`/`Date.now()`/`new Date()` — "unstable synchronous IO"
   that fails the build if it's evaluated while a route's initial render is
   captured for the static shell. **Being inside a Client Component does not
   exempt it** — Next still prerenders a Client Component's first render as
   part of that shell, which is exactly what the error message is saying.
   Two call sites, both in this one file (a `grep` across the whole `app/`
   tree found no others):
   - `newLine()`'s default `key: crypto.randomUUID()`, used as the initial
     value for `useState<LineDraft[]>([newLine()])` — evaluated at prerender
     time. **Fixed** by giving `newLine()` an optional `key` parameter and
     seeding the first row with a fixed string (`"initial-line"`) instead;
     `addLine()`'s later calls still generate a real random key, safely,
     because that call only ever happens inside a client `onClick` handler,
     never during prerender.
   - `const idempotencyKey = useRef(crypto.randomUUID())` — evaluated
     directly in the component body. **Fixed** by initializing the ref to
     `""` and filling in the real UUID inside a `useEffect(() => {...}, [])`,
     which only ever runs client-side, post-hydration — never during
     server-side prerender. Mutating `.current` inside an effect doesn't
     trigger React's `react-hooks/set-state-in-effect` rule either (that
     rule is about `useState` setters; a ref mutation causes no re-render).

### Test count, reconciled (your item 3)

Your terminal's own summary line is the ground truth: `Tests  2 failed | 57
passed (59)`. That's **59**, and it reconciles exactly: 7 (csrf) + 10
(password) + 8 (rate-limit) + 12 (content-sniff) + 20 (http) + 2
(order-validation, as it was written at the time you ran it) = 59. The 2
"failed" were the reporter-crash-masked bcrypt timeout and my own
order-validation test bug, both fixed above (see items 2 and 3).

After this fix round, `order-validation.test.ts` has grown from 2 tests to
12 (the rewrite in item 2 above), so the real total going forward is **69**:
7 + 10 + 8 + 12 + 20 + 12. In the sandbox, 57 of those 69 ran and passed
(the same 5 files as before); `order-validation.test.ts` still cannot even
import here, for the same pre-existing, documented reason (the Prisma stub
doesn't export runtime enum values) — expected to run and pass, unmodified,
on your machine where `prisma generate` actually runs.

### Your real-machine confirmation run (second round)

You ran the delivered "Milestone 0 fix" zip on your actual machine and sent
the terminal output back. The good news first, because it's substantial:

- **`npm test`: 69/69 passing, exactly as predicted** — `http` (20),
  `order-validation` (12), `csrf` (7), `rate-limit` (8), `content-sniff`
  (12), `password` (10). This confirms the vitest downgrade, the rewritten
  `order-validation.test.ts`, and the `testTimeout: 20000` fix all work
  correctly for real, not just in the sandbox.
- **`npx tsc --noEmit`: 0 errors.** Confirms the entire 51→55-error set from
  both rounds really was 100% attributable to the sandbox's Prisma stub, as
  predicted.
- **`npm run lint`: clean**, except the one pre-existing error in
  `app/products/import/page.tsx` that this milestone never touched — also
  exactly as predicted.
- One **transient** `P1001: Can't reach database server` error during
  `npx prisma migrate deploy` against your Neon database, which then
  succeeded (`Database schema is up to date!`) when you immediately re-ran
  `npx prisma migrate status`. This reads as a one-off network or
  cold-start blip against Neon's pooled connection, not a code defect —
  nothing in this delivery touches connection handling, and it didn't
  recur. Worth knowing about if it happens again and *doesn't* clear up on
  a retry, but not something I changed anything for.

Then `npm run build` reached further than it ever has — past "Compiled
successfully", past the TypeScript phase, into "Generating static pages"
— and failed there on the `crypto.randomUUID()` error described in item 9
above. That's now fixed in this file.

**An important correction to this document's own earlier claim.** The
previous round's "Build: `npm run build`" section (further up this
document, and in `docs/milestones/PROGRESS.md`) reported Turbopack
"Compiled successfully" as evidence the health-route and `/orders/[id]`
fixes were confirmed working. That's true as far as it goes, but it
overstated what had actually been checked: "Compiled successfully" is
Turbopack's bundling stage, not the later "Generating static pages"
(prerendering) stage — the exact stage this `crypto.randomUUID()` bug lives
in. In this sandbox, that stage has never once been reachable, through two
rounds and two different diagnostic workarounds this time: with the
Google-Fonts network block worked around, the build still stops at the
TypeScript-check phase on the Prisma-stub errors (same 55 as `tsc` reports
directly); stacking a *second*, more aggressive diagnostic workaround
(`typescript.ignoreBuildErrors: true`, tried and reverted — never shipped,
since it would silently hide real type errors) gets past that wall only to
hit a harder one immediately after, in "Collecting page data": the
`@prisma/client` stub doesn't just fail type-checking, it **throws when
actually constructed** (`new PrismaClient()`), and nearly every API route
constructs it at module scope via `lib/prisma.ts`. So this sandbox cannot
reach the static-generation phase at all, by any workaround — which means
no claim about that phase, past or future, should be taken as sandbox-
verified. What *is* verified this round, by actually running it: `tsc`,
`lint`, and `vitest` all re-confirmed clean against the new fix (same
baseline as before, zero regressions, zero new errors in the touched
file), and the fix follows Next's own documented pattern for this exact
error class. But whether `/orders/new` now actually passes "Generating
static pages" can only be confirmed by your next real `npm run build` —
not claimed here as already proven.

### Documentation

| File | Change |
|---|---|
| `SETUP-WINDOWS.md` | Added section 9, "Manual test script (no coding required)" — an 8-step click-through checklist for a non-developer to verify the running app (login, forced password change, user management, creating a real order with a file upload, finding and opening it, confirming stock/reports are still demo) separately from the existing `npm test`/`tsc`/`lint`/`build` developer commands. Updated the Node version line from "unconfirmed" to the now-confirmed v20.20.2. Renumbered the old section 9 ("Undoing the migration") to section 10. |
| `CHANGES.md` | This file — the "Milestone 0 fix" section, the newest `crypto.randomUUID()` fix (item 9), the "Your real-machine confirmation run" section, and the test-count corrections. |
| `docs/milestones/PROGRESS.md` | Updated — see that file directly for the current, consolidated status. |

## Milestone 0 fix (round 3 — real SAP catalogue, combinable order intake)

Your six numbered instructions, in order. Confirmed on your previous real
run: `npm run db:seed` created real demo data, `npm test` passed 69/69,
`tsc` and `build` both passed cleanly, and login works in the browser --
this round builds on that confirmed-working base, not a guess.

### 1. Demo products removed from the seed; demo orders reference real, already-imported products

- **`prisma/schema.prisma` / `lib/product-import.ts` already had the right
  shape for this** -- `Product.isDemo` defaults to `false` and the import
  route never sets it, so every row imported via Products → Import was
  already real, never demo, before this round. What was wrong was
  `prisma/seed.ts`: it created six placeholder `DEMO-0001`..`DEMO-0006`
  products (fictional SAP codes, fictional names) purely so it would have
  *something* to put on demo orders.
- **Fixed**: `prisma/seed.ts`'s `DEMO_PRODUCTS` array and `seedProducts()`
  function are gone entirely. In their place, `pickRealProductsForDemoOrders()`
  looks up up to 6 real, active, already-imported products
  (`isDemo: false`, ordered by `sapItemCode`) and `seedOrders()` now
  builds its demo order lines from those -- real SAP item codes, real
  item names, nothing invented. If fewer than 3 real products are found
  (e.g. on a brand-new database where the catalogue hasn't been imported
  yet), `main()` skips seeding demo orders and prints a plain console
  message explaining why and what to do (import the catalogue, then
  re-run `npm run db:seed`) -- it does **not** throw and abort the whole
  seed run, since the admin account and demo customers have nothing to do
  with products and should still seed normally.
- **"Provide a safe way to remove existing demo products without
  touching real ones"**: this already existed and didn't need building.
  `scripts/remove-demo-data.ts`'s product deletion is
  `tx.product.deleteMany({ where: { isDemo: true } })` -- scoped to demo
  rows only, confirmed by re-reading it this round. A real order line that
  happens to reference a demo product (only possible if you'd manually
  linked one via the catalogue search before removing it) isn't deleted
  by this script, since it only clears demo-flagged order lines; that
  real line's `productId` is set to `null` instead, via the schema's
  existing `onDelete: SetNull` on `OrderLine.product` -- no crash, no
  orphaned foreign key. **No changes made to this script** -- it was
  already correct; see SETUP-WINDOWS.md section 7 for the now-explicit
  documentation of this.
- **If your database already has the old `DEMO-0001`..`DEMO-0006`
  products** (from running the pre-round-3 seed script): `npm run
  db:remove-demo` clears them out, along with the demo orders/lines that
  referenced them, in one transaction; re-running `npm run db:seed`
  afterward recreates the demo customers and orders fresh, this time
  referencing your real catalogue. See SETUP-WINDOWS.md section 6 for the
  exact walkthrough.

### 2. Orders list/detail pages re-verified against the real APIs

Re-read `app/orders/page.tsx` and `app/orders/[id]/page.tsx` end to end
this round: **both were already fully wired to the real `/api/orders`
endpoints with no hardcoded arrays and no `alert()` stubs** -- that work
was genuinely completed in the first "Milestone 0 fix" round, not just
claimed. Two small additions were needed for this round's new zero-line,
combinable-intake orders (see item 3):
- `app/orders/[id]/page.tsx`: the Order Lines table now shows an explicit
  "No line items yet" empty state instead of rendering a table with no
  rows, when `order.lines.length === 0` -- with different copy depending
  on whether a pasted message or document exists to review.
- `app/orders/[id]/page.tsx`: a new "Original Message" card (styled like
  the existing "Internal Notes" card) shows `order.originalSourceText`
  verbatim when present, right after the Documents section.

### 3. New Order: three combinable intake modes

This was the largest change this round -- `app/orders/new/page.tsx` was
restructured so manual lines, a pasted message, and uploaded file(s) are
three **independent, optional, combinable** inputs rather than a
"pick one" toggle:

- **(a) Manual entry.** Unchanged in spirit from round 1 -- customer
  picker (`/api/customers`), PO reference/date fields, and a line editor
  with a catalogue search that matches by **SAP code, name, or barcode**
  (this was already true of `/api/products`'s search -- see
  `lib/product-queries.ts`'s `listProducts`, which `OR`s across
  `sapItemCode`, `itemName`, and `barcode` -- the UI's search placeholder
  now says so explicitly instead of just "Search SAP products...").
  **New**: a line only counts as "started" (and gets validated/submitted)
  once something's been typed or picked into it -- see `isLineBlank()` /
  `getStartedLines()` -- so the one blank row shown by default doesn't
  force a line onto an order submitted purely via (b) or (c) below.
- **(b) Pasted PO text or message.** Previously this was smuggled into
  `internalNotes` with a "Customer message (as submitted):" prefix --
  functional, but wrong: `internalNotes` is staff-only commentary, and
  mixing the customer's own words into it made that field do two jobs.
  **Fixed properly**: a new `CustomerOrder.originalSourceText` column
  (see "Schema" below) holds the pasted text verbatim, completely
  separate from `internalNotes`. The textarea is now always visible
  (not behind a toggle) and independent of the file-upload box next to it.
- **(c) Uploaded PO file(s).** Previously a single file via a
  mutually-exclusive radio choice. **Fixed**: the file input now accepts
  **multiple** files (`<input type="file" multiple>`), added
  incrementally (each pick adds to the list rather than replacing it,
  with a remove button per file), uploaded sequentially after order
  creation via `POST /api/orders/[id]/documents` (unchanged route, called
  once per file) with independent per-file status (`idle` / `uploading` /
  `success` / `error`) and a per-file retry button on the "Order Received"
  screen.
- **Combinable, as instructed**: client-side validation
  (`validateClientSide()`) now requires *at least one of* a started line,
  non-blank pasted text, or a selected file -- not all three, not
  mutually exclusive. An order with zero manual lines (pure paste and/or
  pure file) is a valid, expected outcome, not an error.
- **"No AI extraction yet... orders from (b) and (c) wait for review or
  manual lines"**: `createOrderSchema.lines` dropped its `.min(1)` --
  see "Schema" below for the reasoning on why the empty-order guard lives
  client-side, not server-side, for this specific case.

### Schema: `CustomerOrder.originalSourceText`

- **`prisma/schema.prisma`**: new nullable `originalSourceText String?`
  column on `CustomerOrder`, documented inline with the same
  "preserve the customer's own words verbatim" rationale already applied
  to `OrderLine.originalProductDescription`.
- **New migration**: `prisma/migrations/20261109080000_add_order_original_source_text/migration.sql`
  -- a single additive `ALTER TABLE ... ADD COLUMN` (nullable, no default
  needed), safe to run against a database with existing rows, same as
  every migration in this project so far.
- **`lib/order-validation.ts`**: `createOrderSchema` gained
  `originalSourceText: z.string().trim().max(5000).nullable().optional()`,
  and `lines` lost its `.min(1, "At least one order line is required.")`
  -- now just `.max(200)`. This is a deliberate, commented decision: the
  schema does **not** add a cross-field "must have lines OR text" rule,
  because mode (c) (file-only) creates the order *before* the file is
  uploaded (the document endpoint needs an order id to attach to), so at
  the moment this schema runs there is no reliable server-side way to
  know "a file is on its way." The real guard against a genuinely empty
  submission (no lines, no text, no file at all) lives in the client's
  `validateClientSide()`, which is the only place that actually knows
  whether a file is queued.
- **`lib/orders.ts`**: `createOrder()` now persists
  `originalSourceText: input.originalSourceText ?? null` and records
  `hasOriginalSourceText` in the `ORDER_CREATE` audit event's `afterData`.
- **`lib/order-queries.ts`**: `getOrderById()`'s select and mapped return
  value both include `originalSourceText` (list view unchanged -- it's a
  detail-page field, not a summary one).

### 4. Item codes stay text everywhere

Audited this round, no changes needed: `Product.sapItemCode` is `String`
in the schema (not `Int`), `OrderLine.sapItemCodeSnapshot` is `String?`,
and a repo-wide search for `Number(...)`/`parseInt(...)`/`parseFloat(...)`
anywhere near a code/barcode field (`grep`, checked against every `.ts`/
`.tsx` file) found none. `lib/product-import.ts`'s CSV import and
`lib/product-queries.ts`'s search both already treat `sapItemCode` and
`barcode` as opaque strings throughout. This was already correct; this
round only confirms it, since the real catalogue (test-data/sap-items-list.csv,
7,540 rows) has SAP codes that are numeric-looking strings like `"8104"`
and `"9336"` -- exactly the case that a stray `Number()` or `parseInt()`
would silently corrupt (leading zeros lost, or an all-numeric code
treated as an integer) if it existed anywhere.

### 5. Manual test script updated

`SETUP-WINDOWS.md` section 9 ("Manual test script") expanded from 8 steps
to 12, covering what's new this round: importing the real catalogue
(step 4), creating an order via manual entry with the catalogue search
tried against a name, a SAP code, and a barcode (step 5), a
pasted-message-only order with zero lines (step 6), a file-only order
with **two** files uploaded and both showing "Uploaded" independently
(step 7), checking the new "No line items yet" and "Original Message"
UI on the orders those produced (step 9), and running `npm run
db:remove-demo` and confirming the real catalogue survives untouched
while demo rows disappear (step 11). Section 6 (seeding) and section 7
(removing demo data) also gained explanatory paragraphs about the new
real-catalogue-lookup behaviour -- see "1." above.

### 6. Verification run this round, reported honestly

- **`tsc --noEmit`: 56 errors** (up from the already-confirmed-sandbox-only
  55) -- the one new error is `RecordStatus` joining the same
  already-documented "`@prisma/client` has no exported member" line in
  `prisma/seed.ts` that `OrderSource`/`OrderStatus` were already on (that
  import line now imports 3 stub-missing names instead of 2). Zero errors
  in any file this round's logic actually touched
  (`app/orders/new/page.tsx`, `app/orders/[id]/page.tsx`,
  `lib/order-validation.ts`, `lib/orders.ts`, `lib/order-queries.ts`) --
  grep-confirmed. All 56 are the same single root cause as before: the
  sandbox's `@prisma/client` stub.
- **`npm run lint`: clean**, except the same one pre-existing,
  untouched-this-round error in `app/products/import/page.tsx`.
- **`npm test` (Vitest)**: 57/57 non-`order-validation` tests still pass;
  `order-validation.test.ts` still fails to *import* here for the same
  pre-existing sandbox-only reason (the stub doesn't export runtime enum
  values) -- unchanged. **Important**: this round's schema change
  (`lines` no longer requires at least 1) made one of that file's
  **existing tests assert the now-wrong behaviour** --
  `"rejects a payload with zero order lines"` expected `success: false`,
  which would have been a real, embarrassing regression on your machine
  if shipped as-is. Caught and fixed before delivery: that test is
  rewritten to expect `success: true` (zero lines is now a deliberate,
  valid case), and five new tests were added covering the
  zero-lines-with-text case, zero-lines-with-neither case,
  `originalSourceText` accepted, `originalSourceText` over 5000 chars
  rejected, and more than 200 lines rejected. `tests/order-validation.test.ts`
  now has **16 tests** (up from 12), bringing the real total across the
  suite to **73**, not 69 -- see CHANGES.md's earlier "Test count,
  reconciled" section for the arithmetic this adds to:
  7 (csrf) + 10 (password) + 8 (rate-limit) + 12 (content-sniff) +
  20 (http) + 16 (order-validation) = 73.
- **`npm run build`**: same sandbox limitation as last round, re-confirmed
  rather than assumed -- with the Google-Fonts workaround, Turbopack
  reports **"Compiled successfully"** (confirms no syntax/JSX errors in
  any of this round's new code), then the build stops at the TypeScript
  phase on the same Prisma-stub error set `tsc` reports directly. As
  documented in `docs/milestones/PROGRESS.md`'s "Sandbox-only blocker"
  section (from last round, still accurate), this sandbox cannot reach
  the "Generating static pages" phase at all, by any workaround --
  nothing about the prerender phase is claimed as verified here; your
  next real `npm run build` is what actually confirms this round's pages
  build cleanly end to end.

## Milestone 0 fix (round 4 — your round-3 real-machine run)

Your round-4 message reported, against the round-3 delivery: `npx prisma
migrate deploy` (4 migrations found, none pending), `npm run db:remove-demo`
**failing** with a `P2028` transaction-timeout error, `npm test` (73/73
passing), `tsc --noEmit` (16 real errors), `npm run lint` (1 error), and
`npm run build` (compiles, then fails the same 16-error TypeScript check).
Two of those are real bugs, now fixed. The other two are explained below,
with evidence, rather than patched with code that would have been guessing.

### Real bug #1: `npm run db:remove-demo` — `P2028` transaction timeout (your item 1 ask)

- **What happened, per your paste**: the script's interactive transaction
  hit Prisma's *default* 5-second timeout on the 8th of 12 sequential
  deletes (`tx.stockSnapshotLine.deleteMany`), with the error reporting
  "5315ms passed" against a 5000ms budget — a real, reproducible timing
  bug against your pooled Neon endpoint, not a flake.
- **Fixed**: `scripts/remove-demo-data.ts` now passes
  `{ timeout: 60_000, maxWait: 10_000 }` as the second argument to
  `prisma.$transaction()` — the exact values you suggested. 60s is well
  above the slowest observed run (12 round trips to a cold-started pooled
  endpoint); 10s `maxWait` (how long to wait for a free connection from the
  pool before giving up) is kept short so a genuinely stuck pool still
  fails fast rather than hanging.
- **Why not reduce round trips by running deletes in parallel instead**,
  as your message also suggested: several of the 12 deletes *could* run
  concurrently with no dependency between them (e.g. `productVerification`
  and `priceDecision` both only depend on `orderLine.isDemo`), but Prisma's
  own documentation explicitly warns against issuing concurrent queries
  against the *same* interactive-transaction client — all of them share one
  underlying database connection, which isn't guaranteed safe for concurrent
  use. Doing that would trade a timeout bug (annoying, but safe -- nothing
  gets corrupted, the whole transaction just rolls back) for a
  harder-to-reproduce race condition (unsafe). Raising the timeout is the
  fix Prisma's own docs recommend for a transaction that's simply slower
  than the default budget, so that's what this does; the deletes stay
  sequential and the deletion order (and the comment explaining why it
  matters) is unchanged.
- **Confirmed scope, as you asked**: every `deleteMany` in this script is
  still either `where: { isDemo: true }` directly, or scoped through a
  relation to a demo row (`orderLine: { isDemo: true }`,
  `order: { isDemo: true }`, `product: { isDemo: true }`,
  `user: { isDemo: true }`) — unchanged from before this fix. Nothing about
  the timeout fix touches *what* gets deleted, only how long the
  transaction is allowed to take.
- **One sandbox-only `tsc` detail, checked rather than assumed**: adding
  the second argument to `prisma.$transaction()` here surfaces
  `scripts/remove-demo-data.ts(49,12): error TS7006: Parameter 'tx'
  implicitly has an 'any' type` in this sandbox's `tsc` output. Checked
  before assuming it was new: the exact same "`tx` implicitly has an `any`
  type" error already exists on every other `$transaction` call site in
  this project untouched this round -- `lib/users.ts`, `lib/customers.ts`,
  `lib/locations.ts`, `lib/orders.ts`,
  `app/api/auth/change-password/route.ts`,
  `app/api/orders/[id]/documents/route.ts`, and `prisma/seed.ts` all show
  it too. That confirms this is the same pre-existing, sandbox-only
  Prisma-stub limitation (the stub's `$transaction` method doesn't type its
  callback parameter at all) as every other `tsc` error in this project --
  not something this fix introduced. It's exactly why the full-project
  `tsc --noEmit` error count stayed at 56, unchanged, after this fix.

### Real bug #2: the one remaining lint error (your item: "also fix the lint error")

- `app/products/import/page.tsx`'s `readJson()` helper returned
  `Promise<any>` — the one pre-existing `@typescript-eslint/no-explicit-any`
  error this project has carried since round 1 (always flagged, never
  fixed, since it was in a file this delivery hadn't otherwise touched).
  You asked for it directly this round, so it's fixed now.
- **Fixed**: replaced the bare `any` with a named `ApiResponseBody` type --
  the error-envelope shape (`success?`, `message?`, `errors?`,
  `errorCount?`, `errorsTruncated?`, `duplicateCodes?`) both API calls in
  this file share on failure, intersected with `Record<string, unknown>`
  since the two success shapes (`Preview`, `ImportResult`) differ and
  aren't part of the envelope type itself. The two `body as Preview` /
  `body as ImportResult` casts on the success path became
  `body as unknown as Preview` / `body as unknown as ImportResult` -- the
  standard, explicit way to tell TypeScript "trust me on this shape" without
  going through `any`, since `ApiResponseBody` and `Preview`/`ImportResult`
  don't structurally overlap enough for a direct cast.
- **Verified, not assumed**: ran `npx eslint app/products/import/page.tsx`
  directly after the fix -- clean, zero output. Ran `npx tsc --noEmit` and
  grepped the output for this file's path -- zero matches (it was zero
  before too, for this file specifically; the fix didn't introduce any new
  type error here). Full-project `npx tsc --noEmit` error count: unchanged
  at 56 (same root cause as before, see "Explained, not a bug" below) --
  confirms this fix touched nothing it shouldn't have. `npm run lint` is
  now **fully clean, zero errors**, for the first time across all four
  rounds. `npm test`: 57/57 (plus the one known sandbox-only import
  failure), unchanged.

### Explained, not a bug: the 16 `tsc`/`build` errors

**These are not a defect in the round-3 delivery, and nothing was changed
in response to them.** Here's the evidence and the one-line fix on your
end.

All 16 errors reduce to a single cause: `node_modules/.prisma/client`'s
generated TypeScript types, as of when you ran `tsc`, did not yet include
`CustomerOrder.originalSourceText`. That one unrecognized property inside
the `select` object in `lib/order-queries.ts` is enough to make Prisma's
generic return-type inference for the *entire* query collapse to the bare
scalar model shape (no relations) -- which is exactly the error pattern
in your paste: `originalSourceText` itself is flagged as unknown, and then
`customer`, `customerLocation`, `createdBy`, `lines`, `documents`, and
`statusHistory` are *all* separately flagged as not existing on the
inferred return type, even though none of those relations changed this
round. One missing field, sixteen cascading errors -- not sixteen separate
problems.

The evidence that your database and schema are actually fine: your own
`npx prisma migrate deploy` output said "4 migrations found... No pending
migrations to apply" -- meaning the round-3 migration (adding
`originalSourceText`) is already applied to your database. The only piece
not yet in sync is the **generated client** your app code imports from.

**Why**: [Prisma's own documentation](https://docs.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production)
states plainly that `migrate deploy` "does not reset the database or
generate artifacts (such as Prisma Client)" -- generating the client is a
separate command, by design (`migrate deploy` is meant for CI/production
pipelines where you call `prisma generate` as its own build step, often
before `migrate deploy` runs). `migrate dev`, which you'd typically use
locally, does trigger generation automatically -- `migrate deploy` doesn't.
Nothing in your paste shows a `npx prisma generate` call being run after
`schema.prisma` picked up the round-3 field, so the client in
`node_modules/.prisma/client` is almost certainly still the one generated
before `originalSourceText` existed.

**The fix, on your machine, is one command**: run `npx prisma generate`,
then re-run `npx tsc --noEmit` and `npm run build`. No files in this zip
address this, because there's nothing in the repository to fix -- the
`schema.prisma` and migration file your round-3 delivery shipped are
correct and already applied; the generated client just needs regenerating
to match.

### Explained, not a bug: the vitest version question

You asked which version `package.json` specifies now, and whether you need
to run `npm install`. Checked directly, both against this round's files:

- `package.json`: `"vitest": "^4.1.12"`.
- `package-lock.json`: locked at exactly `4.1.12` (`packages["node_modules/vitest"].version`).

Both already reflect the downgrade from the earlier round, correctly, in
this delivery. **Your `npm test` output printing "RUN v5.1.0" means the
copy of vitest actually installed in your `node_modules` right now is still
5.1.0** -- `package.json` and `package-lock.json` only describe what
*should* be installed; `npm install` is the step that makes `node_modules`
match them, and nothing in your paste shows that command having been run
since the downgrade was delivered.

**One thing worth flagging honestly rather than glossing over**: an earlier
round of this project claimed "Vitest 5.1.0 was never going to run on your
Node 20.20.2 -- it requires Node 22.12+/24+/26+", based on that version's
declared `engines` field. Checked just now against the npm registry
directly: `vitest@5.1.0` declares `engines.node: "^22.12.0 || ^24.0.0 ||
>=26.0.0"` (confirms Node 20 is outside its declared support), while
`vitest@4.1.12` declares `"^20.0.0 || ^22.0.0 || >=24.0.0"` (matches this
project's own `engines.node: ">=20.9.0"`). So the *claim about what 5.1.0
declares* holds up. But an `engines` mismatch is advisory, not a runtime
enforcement -- npm only warns on it by default (it doesn't block execution
unless `engine-strict` is set), so if 5.1.0 was already sitting in your
`node_modules` from before, it can still run under Node 20.20.2 in some
code paths and fail in others, which matches what was actually seen
before: a crash in a specific reporter path, not everywhere. Your round-4
run showing 73/73 clean under "v5.1.0" doesn't prove 5.1.0 is safe here
generally, only that this particular run didn't hit whatever broke before.
**Recommendation, not required**: run `npm install` to sync `node_modules`
to the `4.1.12` this project's test suite has actually been verified
against across every round so far, rather than relying on 5.1.0 continuing
to not hit its broken path. No files changed for this -- there's nothing
to fix in the repository; the fix (if you want it) is on your machine.

### One more thing noticed in your paste, not asked about, flagged anyway

`git add -A; git commit -m "Before round 3"` failed with `error: unknown
switch `;'` -- not a bug in this project, a shell syntax note: `cmd.exe`
(which your prompt, `C:\Users\Accounts\Desktop\willsgrove-salesflow>`, is)
doesn't treat `;` as a command separator the way PowerShell or a Unix shell
does, so the whole line was passed to `git add` as one argument list, and
git choked on the stray `-A;` and `git` that followed. Run them as two
separate lines, or use `&&` (`git add -A && git commit -m "..."`), which
`cmd.exe` does support. Net effect: that commit did not happen, so your
working tree was still uncommitted going into the rest of this round's
commands -- worth committing once this round's two file changes are in,
so you have a clean checkpoint before round 5.

## Milestone 0 fix (round 5 — orderDate/requestedDeliveryDate HTTP 500)

Your round-5 report: round 4 fully verified (`prisma generate`, `tsc`,
`lint`, 73/73 tests, `build`, `db:remove-demo`, `db:seed` all pass) --
and then manual test step 5 (create an order with manual lines) failed
with HTTP 500, server log showing `Invalid value for argument
'orderDate': premature end of input. Expected ISO-8601 DateTime.` This is
a real, previously-unknown bug. Fixed, audited, and tested below, item by
item against your five numbered instructions.

### Root cause

`CustomerOrder.orderDate` and `.requestedDeliveryDate` are
`DateTime? @db.Date` (prisma/schema.prisma) -- date-only Postgres columns.
`lib/order-validation.ts`'s `dateOnlyString` Zod schema validates that an
incoming value is SHAPED like "YYYY-MM-DD" and names a real calendar date
-- but has no `.transform()`, so its inferred TYPE stays a plain `string`.
`lib/orders.ts`'s `createOrder()` passed that string straight through:
`orderDate: input.orderDate ?? null`. Prisma's `DateTime` fields accept a
JS `Date` object or a full ISO-8601 **datetime** string (with a time
component) -- never a bare ISO-8601 **date** string -- so a validated,
correctly-shaped "2026-11-09" still fails at the database driver level
with exactly the error in your log.

### Item 1: shared conversion helper + fix, with unit tests

- **New file: `lib/dates.ts`.** Two conversions plus the validity check
  both now share: `isValidDateOnlyString(value)`, `dateOnlyStringToUtcDate(value)`
  (string -> `Date` at UTC midnight, throws on anything invalid, `null` for
  `null`/`undefined`), and `utcDateToDateOnlyString(date)` (the inverse, for
  reading a `@db.Date` column back out). UTC midnight is the only
  representation of a date-only value that can't be shifted onto a
  different calendar day by whatever timezone the Node process or the
  database connection happens to be running in -- a `@db.Date` column has
  no time-of-day or timezone of its own.
- **`lib/orders.ts`**: `orderDate`/`requestedDeliveryDate` now go through
  `dateOnlyStringToUtcDate(input.orderDate)` /
  `dateOnlyStringToUtcDate(input.requestedDeliveryDate)` before reaching
  the `tx.customerOrder.create()` call -- the one place either value
  actually reaches Prisma.
- **`lib/order-validation.ts`**: `dateOnlyString`'s `.refine()` now calls
  the same `isValidDateOnlyString` rather than its own, weaker inline
  check (`!Number.isNaN(new Date(...).getTime())`). That inline check had
  its own latent bug, caught while building this fix: JS's `Date`
  constructor silently rolls an invalid calendar day like "2026-02-30"
  forward to 2 March instead of producing `NaN`, so the old check would
  have accepted "2026-02-30" as a valid order date. `isValidDateOnlyString`
  catches this by round-tripping the parsed date back to a "YYYY-MM-DD"
  string and requiring an exact match -- "2026-02-30" parses, rolls to
  "2026-03-02", doesn't match, and is correctly rejected. The schema's
  inferred TYPE is unchanged (`string | null | undefined` -- no
  `.transform()`), by design: the string-to-`Date` conversion stays in
  `lib/orders.ts`, the one place it's actually needed, not in validation.
- **Unit tests**: `tests/dates.test.ts`, 21 tests, unconditional (run in
  every environment, including this sandbox) -- the exact date from your
  bug report ("2026-11-09"), a leap day (2028-02-29, valid) and the same
  date a year earlier (2026-02-29, invalid -- 2026 isn't a leap year),
  invalid-shape strings, an out-of-range month and day, year boundaries
  (Jan 1 / Dec 31), null/undefined handling for both directions, and a
  round-trip check (`dateOnlyStringToUtcDate` then `utcDateToDateOnlyString`
  returns the original string) for every date used elsewhere in this
  round's tests.

### Item 2: codebase audit for the same bug class

Searched for every place a date-only value could reach Prisma, not just
the two already known. What was checked, and what was found:

- **Every `@db.Date` field in the schema**: exactly two,
  `CustomerOrder.orderDate` and `.requestedDeliveryDate` -- confirmed by
  grepping `prisma/schema.prisma` directly. Every other `DateTime` field
  in the schema is `@db.Timestamptz(6)` (a full timestamp, not a
  date-only value) and is set with `new Date()`/`now()` in code, never
  from a user-submitted string -- `User`/`Session.createdAt`/`expiresAt`/
  `revokedAt` (`lib/auth/session.ts`), `CustomerOrder.receivedAt`/
  `extractedAt`/`reviewedAt`/`approvedAt`/`handedToSapAt`/`invoicedAt`,
  `Product.importedAt` (`lib/product-import.ts`, set via `new Date()`),
  `StockSnapshot.snapshotAt`/`importedAt`. Confirmed none of these take a
  bare date-only string as input anywhere in the codebase.
- **Every `z.string()` validator across every API route**, grepped for
  anything date-related: `lib/order-validation.ts`'s `dateOnlyString` is
  the *only* one accepting a date-only string anywhere in this project.
  `lib/customer-validation.ts`, `lib/location-validation.ts`, and
  `lib/user-validation.ts` have no date fields at all -- `Customer` and
  `CustomerLocation` (schema.prisma) carry no `@db.Date`/`DateTime` field
  that isn't `createdAt`/`updatedAt`.
- **`prisma/seed.ts`**: sets `orderDate`/`requestedDeliveryDate` to a
  literal `null` for demo orders (never a string) -- not affected by this
  bug, confirmed by grep. Its other `DateTime` write
  (`[timingField]: new Date()`, for status-history timing) is already a
  real `Date` object.
- **Order editing**: `app/api/orders/[id]/route.ts` is `GET`-only --
  there is no update/PATCH endpoint for `orderDate`/`requestedDeliveryDate`
  yet, so `createOrder()` in `lib/orders.ts` is the only write path for
  either field. Nothing else to fix on the write side.
- **Products, stock**: `lib/product-import.ts`'s CSV import has no date
  columns in the SAP catalogue (`CODE`, `ITEM DESCRIPTION`, `BARCODE`,
  `ITEM GROUP` only) and sets `importedAt` via `new Date()`.
  `StockSnapshot`/`StockSnapshotLine` have no real create path anywhere
  in the app yet (grepped -- only `scripts/remove-demo-data.ts` references
  them, for cleanup) -- Stock remains the already-documented
  demo/prototype module with nothing real to audit here.
- **One similar pattern, found and deliberately left alone**:
  `app/reports/page.tsx:145` does
  `new Date(\`${date}T00:00:00\`).toLocaleDateString(...)` -- the same
  "no explicit UTC" shape as the bug fixed below, on a locally-constructed
  mock date. Not touched: Reports is explicitly out-of-scope demo/prototype
  data (per `docs/milestones/PROGRESS.md`'s existing scope), not a real
  `orderDate` value, so fixing it here would be unauthorized scope
  creep. Flagging it now in case Reports becomes real in a future
  milestone.

### Item 3: UI displays date-only values in UTC

- **`lib/order-display.ts`**: `formatOrderDate()` -- the function both
  `app/orders/page.tsx` and `app/orders/[id]/page.tsx` use to display
  `orderDate`/`requestedDeliveryDate` -- now passes `timeZone: "UTC"` to
  `toLocaleDateString()`. Without it, a date stored as UTC midnight
  (`2026-11-09T00:00:00.000Z`) displays in the *viewer's* local timezone,
  which rolls it back to the previous calendar day for anyone west of
  UTC (e.g. "8 Nov" in a UTC-5 browser). `timeZone: "UTC"` pins the
  display to the exact calendar day that was stored, for every viewer,
  regardless of where they are.
- **Deliberately not applied to `formatOrderDateTime`** (same file): that
  one formats real timestamps -- `receivedAt`, a document's upload time,
  a status-history entry's `createdAt` -- where showing the viewer's own
  local time is correct, intended behaviour, not the bug being fixed here.
  Conflating the two would have been a different, worse bug (hiding when
  something actually happened from the person looking at it).
- **The input side needed no fix**: `app/orders/new/page.tsx`'s date
  fields are plain `<input type="date">` elements, which produce and
  consume "YYYY-MM-DD" with no timezone semantics of their own -- the
  shift only ever happened on the *display* side, reading a stored UTC
  instant back out through the local clock.

### Item 4: tests against the real database path

- **`tests/orders-db.integration.test.ts`** -- new, and genuinely runs
  `createOrder()` against a real database through a real generated
  `@prisma/client`, with the exact payload shape from your bug report
  (manual entry, `orderDate: "2026-11-09"`, `requestedDeliveryDate:
  "2026-11-12"`, one line). **Off by default in every environment,
  including yours**, for one concrete, stated reason: this sandbox's
  `@prisma/client` is a stub that throws when merely *constructed* (see
  "why this wasn't caught" below) -- every import of it is therefore
  written as a dynamic `await import(...)` *inside* the test body, never
  a static top-of-file import, specifically so this suite can be skipped
  in this sandbox without crashing `npm test` just by existing. On your
  machine, where a real client exists, run it with:

  ```
  RUN_DB_INTEGRATION_TESTS=1 npm test
  ```

  after `npm run db:seed` has run at least once (it looks up an existing
  admin and customer rather than creating its own, and skips itself with
  a console message, not a failure, if neither exists). It writes one
  `isDemo: true` row and deletes it itself in `afterAll`.
- **Confirmed safe in this sandbox**: ran `npm test` after adding it --
  reports `1 skipped`, not a crash or a failure, and the sandbox-only
  `order-validation.test.ts` import failure is unchanged. Full test count
  this round: 78 passed + 1 skipped (was 73 passed last round;
  +21 from `tests/dates.test.ts`, the new integration test's single `it()`
  counted as skipped, not run, here).
- **Short manual check, if you'd rather not set the env var**: in the
  browser, create a new order via manual entry -- set Order Date to
  today and Requested Delivery Date to a few days out, add one line,
  submit. Confirm (a) you land on the success screen, not an HTTP 500,
  and (b) opening that order's detail page shows the *same* two dates you
  entered, not shifted by a day either way.

### Item 5: why round 3's tests, and the sandbox, didn't catch this

Two separate, compounding reasons:

1. **The existing tests never called `createOrder()` at all.**
   `tests/order-validation.test.ts`'s tests call `createOrderSchema.safeParse(...)`
   directly -- they check that Zod accepts or rejects a payload shape, and
   stop there. None of them invoke `createOrder()`, so none of them ever
   reach the `tx.customerOrder.create()` call where the raw string
   actually meets Prisma's DateTime parser. Zod's `dateOnlyString` was
   only ever asked "is this shaped like a date," never "will Prisma's
   database driver accept this string for a DateTime column" -- those are
   different questions, and nothing in round 3 (or any round before this
   one) asked the second one.
2. **TypeScript can't express the difference, so `tsc` had nothing to
   flag.** Prisma's generated input type for a `DateTime` field is
   `Date | string` -- it does not, and structurally cannot, distinguish
   "a string containing a full ISO-8601 datetime" from "a string
   containing only a date" at the type level; both are simply `string`.
   `input.orderDate` (typed `string | null | undefined` by Zod) is
   therefore perfectly type-compatible with Prisma's expected input type,
   and `tsc --noEmit` reported zero errors on this line in every round
   before this one, in the sandbox and on your machine alike. This is a
   runtime value-FORMAT bug, not a type bug -- exactly the category static
   type-checking is structurally unable to catch.

On top of both: this sandbox's `@prisma/client` has been a non-functional
stub since round 1 (throws when constructed -- see
`docs/milestones/PROGRESS.md`'s "Sandbox-only blocker"), so no code path
anywhere in this project that actually calls a real Prisma query against
a real database has ever been exercisable here, in any round, for any
reason -- not just this one. The *only* way this specific bug could have
surfaced before your manual click-through is a test that does what
`tests/orders-db.integration.test.ts` now does: actually calls
`createOrder()` against a real database. That test exists now, for next
time, even though -- for the same sandbox reason -- it can only verify
itself on your machine, not here.

# Milestone 1 — Master data from SAP

Built from your two real attachments (`sap-items-list.csv` — your actual
461.8KB SAP item export, 7,540 rows, 4 columns: `CODE, ITEM DESCRIPTION,
BARCODE, ITEM GROUP` — and invoice `HRE580108`, 6 Nov 2026, customer
`HREC0D677` / TM Supermarkets Chinhoyi North, line item `0228` / Baby
Marrow 250G Punnet / 10 PNT @ 0.45 USD / VAT 0.00 / total 4.50 USD), per
your instruction: *"these are exactly products i export from sap... here
is the invoice from sap, so return only a zip of fixed files before i
move to: PO → SAP lines. Kill the retyping."* This is the corrected
Milestone 1 (your Master Build Prompt's real Milestone 1 — "Master data
from SAP" — not the pricing/approval workflow I incorrectly proposed
first and you rejected).

**Confirmed from your real item export**: it has no unit, pack-size, VAT,
or price columns at all — only `CODE`/`ITEM DESCRIPTION`/`BARCODE`/`ITEM
GROUP`. That settles an open question from the Milestone 1 report: unit
and pack size cannot be parsed out of 7,540 inconsistently-formatted
description strings reliably enough to trust, so they come from a new,
separate SAP export instead (documented below), not from text-parsing.

## Database / Prisma

- `prisma/schema.prisma` — additive only, no column dropped, no type or
  nullability change on anything existing:
  - `Product` gains `unitOfMeasure`, `packSize`,
    `isVariableWeight` (default `false`), `vatCode` (plain string, same
    pattern as `sapItemCode` — not an FK, so the tax-code importer and
    the item-master importer never block on each other's import order),
    plus the `priceListEntries` relation and a `vatCode` index.
  - `Customer` gains `tin`, `vatNumber`, `currencyCode`,
    `paymentTermsCode`, `branchCode`, `storeCode`, `creditLimit`,
    `creditHold` (default `false`), `priceListId` (nullable FK, `SetNull`
    on delete), plus the `contacts` relation and `priceListId`/`storeCode`
    indexes.
  - New model `TaxCode` (`code` unique, `description`, `ratePercent
    Decimal(5,2)`, `isDemo`) — no incoming foreign keys.
  - New model `PriceList` (`code` unique, `name`, `currencyCode`,
    `isDemo`) with `entries`/`customers` relations.
  - New model `PriceListEntry` — one row per item per list, with
    `validFrom`/`validTo`: a price change is a new row, never an edit of
    history, because an order needs "the price in effect on the order's
    date," not just "the current price." `productId` is nullable with
    `onDelete: SetNull` and `sapItemCodeSnapshot` preserves the SAP code
    even once a product is deleted (same pattern as `OrderLine`'s
    snapshot columns). FK to `PriceList` is `onDelete: Restrict`.
  - New model `CustomerContact` — `onDelete: Restrict` from `Customer`,
    same as `CustomerLocation`.
- `prisma/migrations/20261109090000_add_sap_master_data/migration.sql` —
  hand-written (this sandbox cannot reach `binaries.prisma.sh` to run
  `prisma generate`/`validate`/`migrate dev` — see
  `docs/milestones/PROGRESS.md`'s "Sandbox-only blocker," unchanged since
  round 1). Written by hand to match your existing migrations' exact
  naming conventions (verified against all four prior migration files):
  `{Table}_{col}_key` for unique indexes, `{Table}_{col}_idx` for
  indexes, `{Table}_{col}_fkey` for foreign keys, `ON DELETE
  RESTRICT/SET NULL ON UPDATE CASCADE`. **You must run `npx prisma
  generate` for real on your machine before any of this code executes
  against a database** — see SETUP-WINDOWS.md's new section 11.

## New: SAP master-data importers (four, all preview-then-confirm)

Each follows the exact pattern already shipped and tested in Milestone 0
(`lib/product-import.ts` / `app/api/products/import/{route,preview/route}.ts`
/ `app/products/import/page.tsx`): upload → server-side preview with
new/changed/unchanged counts and validation errors → explicit confirm →
`AuditEvent` written → done. A shared tokenizer (`lib/csv-parser.ts`,
copied out of the existing, already-shipped `lib/sap-product-csv.ts`)
backs all four; `lib/sap-product-csv.ts` itself is untouched, so nothing
about the already-tested product importer changes.

- **Tax codes** — `lib/sap-tax-code-csv.ts`, `lib/tax-code-import.ts`,
  `app/api/tax-codes/import/{route,preview/route}.ts`,
  `app/tax-codes/import/page.tsx`. Columns: `TAX_CODE, DESCRIPTION,
  RATE_PERCENT`. Rate is kept as a decimal-shaped **string**, never
  parsed to a JS number, because Prisma's `Decimal` input accepts a
  string directly and this is the one value in this whole milestone
  where float rounding would actually matter.
- **Item master extension** — `lib/sap-item-master-csv.ts`,
  `lib/item-master-import.ts`,
  `app/api/item-master/import/{route,preview/route}.ts`,
  `app/item-master/import/page.tsx`. Columns: `CODE, UNIT_OF_MEASURE,
  PACK_SIZE, VARIABLE_WEIGHT, TAX_CODE`. **Only extends existing
  products — never creates one.** A `CODE` not already in your product
  table is reported as unmatched (not silently dropped, not a hard
  block), since this import's job is to fill in fields on rows that
  already exist from the Milestone 0 product import.
- **Price lists** — `lib/sap-price-list-csv.ts`, `lib/price-list-import.ts`,
  `app/api/price-lists/import/{route,preview/route}.ts`,
  `app/price-lists/import/page.tsx`. Columns: `PRICE_LIST_CODE,
  PRICE_LIST_NAME, CURRENCY, ITEM_CODE, UNIT_PRICE, VALID_FROM,
  VALID_TO` — one row per item per list (denormalized). Rejects a
  `PRICE_LIST_CODE` redefined with a different name/currency partway
  through the same file. An `ITEM_CODE` not in your products is reported
  as unmatched and the entry is still saved with `productId: null`
  (`sapItemCodeSnapshot` preserved) rather than dropped, since the SAP
  export is the source of truth, not your current product table.
  Executes as two sequential transactions (lists, then entries) rather
  than one `$transaction([...])` array, because an array of operations
  can't reference an id a prior operation in the same array produced.
- **Customer master** — `lib/sap-customer-master-csv.ts`,
  `lib/customer-master-import.ts`,
  `app/api/customers/master-import/{route,preview/route}.ts`,
  `app/customers/master-import/page.tsx`. 18 columns: `CUSTOMER_CODE,
  CUSTOMER_NAME, TIN, VAT_REG, CURRENCY, PRICE_LIST_CODE, PAYMENT_TERMS,
  BRANCH_CODE, STORE_CODE, CREDIT_LIMIT, CREDIT_HOLD, ADDRESS_LINE1,
  CITY, PHONE, EMAIL, CONTACT_NAME, CONTACT_EMAIL, CONTACT_PHONE`.
  Unlike the item-master import, this one **can create new customers**
  (customer master data has no Milestone-0 placeholder rows to extend).
  Updating an *existing* customer only touches Customer-level fields —
  it never overwrites that customer's locations or contacts, so a
  hand-edited address or contact survives a re-import. Only a brand-new
  customer gets an inline location/contact created from the CSV row.
  Confirmed no route collision with the existing
  `app/api/customers/{route,[id]/route}.ts`. Runs inside one
  `prisma.$transaction(async (tx) => {...})`, sequential (not
  `Promise.all`), for the same reason `scripts/remove-demo-data.ts`
  already documents: concurrent queries on one interactive-transaction
  client are unsafe.

## New: catalogue health report

- `lib/catalogue-health.ts` — refactored into a pure function,
  `analyzeCatalogueHealth(products)`, plus a thin async wrapper,
  `computeCatalogueHealth()`, that loads Prisma dynamically
  (`await import("@/lib/prisma")`) and calls the pure function. The split
  is what makes this unit-testable in this sandbox despite the broken
  stub Prisma client (see "Sandbox-only blocker").
- `app/api/catalogue/health/route.ts` (GET, read-only, no CSRF check —
  matches this codebase's existing convention for read-only routes) and
  `app/catalogue/health/page.tsx`.
- Computes, against your real catalogue: blank descriptions,
  duplicate-description groups (with the rows each one affects),
  non-barcode values that landed in the `BARCODE` column, codes at risk
  of losing a leading zero, and how many products are still missing a
  unit or VAT code (i.e. haven't been through the item-master import
  yet). Confirmed against your real 7,540-row export: 7 blank
  descriptions; 58 duplicate-description groups covering 117 rows (59
  "extra" rows beyond the first occurrence); 159 non-barcode `BARCODE`
  values (including item `8028`'s `BARCODE` of literally `"Deli"`, and
  Excel-mangled scientific-notation values like `"4.06214E+12"`); 999
  leading-zero codes; zero duplicate `CODE` values; 34 distinct `ITEM
  GROUP` values.

## Docs + sample files (so your SAP administrator can produce the real exports)

- `docs/sap-exports/{tax-codes,item-master-extension,price-lists,customer-master}.csv.md`
  — exact column layouts, one per importer, each one explicit about
  which values are confirmed real (item `0228`, customer `HREC0D677`)
  versus illustrative placeholders your SAP administrator needs to
  replace with real exports. **No real tax-code or price-list export was
  ever provided** — those two layouts are my own design, per your Master
  Build Prompt's own instruction to "define and document the exact CSV
  column layouts, with sample files, so my SAP administrator can produce
  them." Flagging this plainly rather than presenting them as confirmed.
- `test-data/sample-{tax-codes,item-master-extension,price-lists,customer-master}.csv`
  — the four sample files the docs point to; item `0228` and customer
  `HREC0D677` rows in each are real, grounded in your invoice; the rest
  are illustrative.

## Tests

- `tests/{tax-code-import,item-master-import,price-list-import,customer-master-import,catalogue-health}.test.ts`
  — unit tests for each new parser/pure function, including your real
  `0228`/`HREC0D677` data and the real catalogue-health numbers above.
- `tests/acceptance-item-0228.test.ts` — your own stated acceptance
  criterion, run literally: reads all four real sample CSVs off disk and
  chains the four parsers together (no database needed, so it runs
  unconditionally in this sandbox) to confirm unit `PNT`, price `0.45`
  USD, VAT `0.00`, line total `4.50` for 10 units of item `0228` against
  customer `HREC0D677` — exactly matching invoice `HRE580108`.
- Result: **125 passed, 1 skipped** (the pre-existing opt-in DB
  integration test), **1 pre-existing failure** — see "Issues found and
  fixed" below; it is not caused by this milestone's changes.

## Wiring

- `app/components/sidebar.tsx` — added a new "SAP MASTER DATA" nav
  section (Tax Codes Import, Item Master Import, Price Lists Import,
  Customer Master Import) and a "Catalogue Health" link under Insights.
  Note: the Milestone 0 product importer (`/products/import`) still has
  no sidebar link either, same as before this round — that's a
  pre-existing gap from Milestone 0, out of this milestone's approved
  scope, flagged here rather than fixed silently.
- `scripts/remove-demo-data.ts` — extended for the four new models, each
  cleaned up by its own `isDemo` flag: `CustomerContact` deleted before
  `Customer` (`onDelete: Restrict`), `PriceListEntry` deleted before
  `PriceList` (`onDelete: Restrict`), `TaxCode` deleted independently (no
  incoming foreign keys at all).

## Issues found and fixed during this milestone

- **My own bug, caught by my own test**: `lib/sap-tax-code-csv.ts`'s
  original `RATE_PATTERN = /^\d{1,3}(\.\d{1,2})?$/` allowed any value up
  to `999.99`, not the documented 0–100 range — a regex can't express
  "at most 3 integer digits AND the value is ≤ 100" (`"150.00"` matches
  `\d{1,3}` exactly as validly as `"15.00"`). Caught by
  `tests/tax-code-import.test.ts`'s "rejects a rate outside 0-100" case
  failing on the first `vitest run`. Fixed by splitting it into a
  shape-only `RATE_SHAPE_PATTERN` plus a real numeric range check,
  `isRatePercentInRange()`. Re-ran the full suite after the fix — this is
  the only genuine defect found in this round; everything else below is
  the pre-existing sandbox blocker.
- **Confirmed pre-existing and unrelated**: `tests/order-validation.test.ts`
  fails with `Cannot convert undefined or null to object` inside
  `z.nativeEnum(OrderSource, ...)`, because this sandbox's stub
  `@prisma/client` doesn't export `OrderSource` (or any real model/enum)
  at all — re-ran it in isolation and got the identical failure before
  touching anything in this milestone. Same documented blocker as below,
  not something this round introduced or could fix from inside the
  sandbox.
- **`npx tsc --noEmit` comparison, done properly rather than assumed**: I
  diffed a fresh, untouched copy of the round-5 baseline against this
  round's working copy. Baseline: 56 error lines, all in pre-existing
  files (`lib/customers.ts`, `lib/orders.ts`, `lib/users.ts`,
  `lib/order-queries.ts`, `lib/product-queries.ts`,
  `lib/customer-queries.ts`, `lib/locations.ts`,
  `lib/order-validation.ts`, `lib/customer-validation.ts`,
  `lib/user-validation.ts`, `scripts/remove-demo-data.ts`,
  `prisma/seed.ts`, and others), caused by the stub client typing every
  Prisma model and query result as `any`/`{}` with zero real exports
  (confirmed directly: `node_modules/.prisma/client/default.d.ts`
  literally reads `export declare const PrismaClient: any`). This
  round: 67 error lines — the 11-line delta is entirely in
  `lib/customer-master-import.ts` and `lib/price-list-import.ts`, and
  every one of those 11 is the exact same `TS7006` (implicit-any
  callback parameter) / `TS2339` (property missing on `{}`) shape as the
  56 pre-existing ones. No new error category. This is the same
  sandbox-only blocker, not a defect in this round's code, and will
  disappear identically to the other 56 the moment `prisma generate` runs
  for real on your machine (which you need to do anyway now, since the
  schema has four new models no generated client — stub or real —
  currently knows about).
- **Real lint error found and fixed** (not sandbox-related):
  `app/catalogue/health/page.tsx` originally called `load()` directly in
  a `useEffect` body, which calls `setLoading`/`setError` synchronously
  within the effect — `react-hooks/set-state-in-effect` flagged this
  correctly. Fixed by deferring the call through `Promise.resolve().then(...)`,
  the same pattern `app/orders/page.tsx` already uses for its own initial
  load. `npm run lint` is clean after the fix.

## Milestone 1 fix (round 2 — your real `tsc`/`migrate dev`/`build` run)

Your real machine caught 4 real `tsc` errors that this sandbox's broken stub
Prisma client structurally cannot catch (see "Sandbox-only blocker" in
`docs/milestones/PROGRESS.md`) — `npx prisma generate`/`migrate dev` both
ran clean on your end, `npm run lint` was clean, but `npx tsc --noEmit` and
`npm run build` both failed with the identical error in all 4 new
importers: `afterData: {...}` (the Json payload for the `AuditEvent`
audit-trail record each import writes) failed with `Type '{...}' is not
assignable to type 'NullableJsonNullValueInput | InputJsonValue |
undefined'` / `Index signature for type 'string' is missing in type
'{...}[]'`.

**Root cause, confirmed by direct reproduction against Prisma's real
(non-generated, non-stub) runtime type definitions** — not guessed, not
papered over with a cast: `ExistingTaxCodeSnapshot`, `ExistingItemMasterSnapshot`,
`ExistingCustomerMasterSnapshot`, and `ListDefinition` were each declared as
a named `export interface X { ... }` and then embedded, unmodified, as a
nested value (`before: change.current`, or `incoming: ListDefinition`)
inside the object literal passed to `AuditEvent.afterData`. This is a
genuine, narrow TypeScript quirk, verified with isolated before/after
repros using Prisma's actual shipped `InputJsonObject`/`InputJsonValue`
types (`node_modules/@prisma/client/runtime/library.d.ts`), not the broken
per-schema generated stub: a value typed via a named `interface` is **not**
structurally assignable to `Prisma.InputJsonObject` (which carries a
`[Key in string]?: InputJsonValue` index signature) even when every
property it declares is already a plain JSON-safe primitive — but a `type`
alias for the byte-for-byte identical shape **is** assignable, with zero
cast needed. `lib/product-import.ts` (Milestone 0, already shipped and
tested clean on your machine across 5 rounds) was never hit by this because
its equivalent snapshot type, `ExistingProductSnapshot`, happens to already
be declared with `export type X = {...}`, not `export interface X {...}`.

**Fix**: changed exactly these four declarations from `interface` to
`type` — nothing else:
- `lib/tax-code-import.ts`: `ExistingTaxCodeSnapshot`
- `lib/item-master-import.ts`: `ExistingItemMasterSnapshot`
- `lib/customer-master-import.ts`: `ExistingCustomerMasterSnapshot`
- `lib/price-list-import.ts`: `ListDefinition`

No behavior, no field, no runtime shape changed — this is a type-level
fix only. I verified it four separate ways before sending it back: for each
of the four files, I built a standalone reproduction using the *exact* real
type names and shapes from that file, imported Prisma's real (not stub,
not generated-per-schema) `InputJsonValue` type, and confirmed `tsc`
reports zero errors with the `type` fix and the exact same error you saw
without it. I also tried (and discarded) an `as Prisma.InputJsonObject`
cast as a first pass — it would have worked too, but a cast that silences
a real structural check is worse engineering than fixing the actual
declaration, so I reverted it once the real root cause was confirmed.

This is a real defect class this sandbox's broken stub client structurally
cannot surface — flagging for your awareness, not as an excuse: any future
code that builds a `Json`-field payload (`afterData`/`beforeData` on
`AuditEvent`, or any other `Json` column) embedding a named `interface` as
a nested value, rather than a `type` alias or a plain inline literal, will
hit this same error the moment it's checked against your real generated
client — the sandbox will never catch it. `lib/customers.ts`/`lib/locations.ts`
(pre-existing, already shipped) sidestep it entirely by typing their
before/after diffs as `Record<string, string | null>`, which has an
explicit index signature and is safe either way.

# Milestone 2A — PO intake, document storage, classification, extraction

Per your approved, revised Milestone 2 report: no SAP pricing anywhere in
this sub-build (price fields are traceability-only, never read for a
pricing decision); the real goal this sub-build serves is getting a
customer PO — Excel, CSV, PDF, image, or pasted WhatsApp/email text — into
the system as a stored document with its header/lines extracted into a
structured, versioned, auditable shape, deterministically wherever
possible. Matching to SAP item codes, human review, and the Excel/CSV/
clipboard handover are explicitly out of scope here — Milestones 2B and 2C.

## Database / Prisma

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | Modified | Additive only. `OrderSource` gains `PDF`, `IMAGE`, `EXCEL`, `CSV`. Four new enums: `DocumentClassification`, `DocumentIntakeStatus`, `ExtractionProvider`, `ExtractionRunStatus`. `OrderDocument` gains `sourceChannel`, `classification`, `status` (default `RECEIVED`), `documentGroupId`/`pageNumber` (reserved, unused by any code path yet), and the `extractionRuns` relation. New model `ExtractionRun` — one append-only row per extraction attempt, carrying provider/model/promptVersion, timing, status, `extractedHeader`/`extractedLines`/`rawResponse` (all `Json`), `errorMessage`, and the existing `isDemo` convention. See `docs/milestones/PROGRESS.md`'s Milestone 2A section for the full rationale, including the deliberate deviation from my own earlier report (extending `OrderDocument` instead of a parallel `PurchaseOrderDocument` model, once I'd actually read the real current schema). |
| `prisma/migrations/20261109100000_add_po_intake_extraction/migration.sql` | Added | Hand-written (this sandbox cannot run `prisma generate`/`migrate dev`), matching the schema change above exactly: `ALTER TYPE ... ADD VALUE` ×4 (one statement per value), `CREATE TYPE` ×4, `ALTER TABLE OrderDocument ADD COLUMN` ×5 (all nullable or defaulted), `CREATE TABLE ExtractionRun`, indexes, FK. Purely additive — no column drops, renames, or type narrowing; safe against a database that already has real `OrderDocument` rows. |

## New: extraction engine (`lib/extraction/`)

| File | Change | Reason |
|---|---|---|
| `lib/extraction/schema.ts` | Added | `PO_EXTRACTION_SCHEMA_VERSION`, `extractionLineSchema`/`extractionHeaderSchema`/`extractionResultSchema` (zod), `validateExtractionResult()`. The one versioned shape every extraction path must produce before anything is persisted. Every field a document might simply not state is nullable with no fallback other than `null` — "never invent a quantity, unit, price, customer, or date" is enforced at the type level, not just by convention. Quantities/prices are decimal-as-string (same pattern as `lib/order-validation.ts`), never a JS number. |
| `lib/extraction/provider.ts` | Added | `ExtractionInput` (discriminated union: document/image/text), `ExtractionProviderOutcome`, `ExtractionProviderImpl` — the one interface every provider (mock, Anthropic) implements, so `lib/extraction/router.ts` never needs to know which concrete provider it's calling. |
| `lib/extraction/providers/mock-fixtures.ts` | Added | Four canned, schema-valid fixtures for document/image input: "default", "baby-marrow-variants" (four distinct pack sizes/preparations of one vegetable, deliberately never merged — exercises the never-merge-pack-sizes rule end to end), "missing-quantity", "unrelated-document". |
| `lib/extraction/providers/mock.ts` | Added | `MockExtractionProvider` (works with zero API key, per your requirement) + `parsePastedText()` — a **real** deterministic regex-based line parser for pasted text (leading/trailing quantity patterns like `"10 Baby Marrow 250g"` / `"Tomatoes x5"`), not a canned fixture, so dev/test/demo pasted-text runs exercise genuine parsing logic. Document/image input returns one of the four fixtures above, selectable via `fixtureKey`. |
| `lib/extraction/providers/anthropic.ts` | Added | `AnthropicExtractionProvider`, using the real, actually-installed `@anthropic-ai/sdk@1.6.0`'s native structured output (`messages.parse()` + `output_config.format: zodOutputFormat(extractionResultSchema)`), verified against this project's real installed SDK types. Server-side only; reads `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` from the environment, never hardcoded; bounded retries (default 2) and timeout (default 60s) passed to the SDK client. The system prompt directly encodes the Milestone 2 brief's product-identification rules (never invent a value, preserve exact wording, never merge pack sizes, flag anything ambiguous). `createAnthropicProvider()` returns `null` (never throws) with no key configured, so callers fall back to mock cleanly. **Real and callable; not yet verified against a live API key** — see PROGRESS.md. |
| `lib/extraction/deterministic/shared.ts` | Added | `resolvePoColumns()` (loose, regex-based header-synonym matching for a customer's own spreadsheet layout — deliberately different from Milestone 1's strict `checkHeaders()` exact-match policy for fixed SAP exports), `sanitizeDecimalCell()`, `buildLinesFromRows()`. Shared by both the CSV and Excel deterministic parsers so the column-matching and row-building logic exists exactly once. |
| `lib/extraction/deterministic/csv.ts` | Added | `parseCustomerPoCsv()` — reuses the low-level tokenizer from Milestone 1's `lib/csv-parser.ts` rather than a third hand-rolled CSV state machine. Never calls an AI provider. |
| `lib/extraction/deterministic/excel.ts` | Added | `parseCustomerPoExcel()`, `cellToText()` — reads a customer's `.xlsx` PO using `exceljs`, first worksheet only, header row matched loosely via `resolvePoColumns()`. Never calls an AI provider. |
| `lib/extraction/router.ts` | Added | `dispatchExtraction()` — the single dispatch point from "a document/text arrived on channel X" to "here is its extraction outcome." EXCEL/CSV always go deterministic; PDF/IMAGE/EMAIL/WHATSAPP go through `selectAiProvider()` (Anthropic when a key is configured and `EXTRACTION_PROVIDER` isn't forced to `"mock"`, otherwise mock). Imports `OrderSource`/`ExtractionProvider` from `@prisma/client` as **types only** and uses plain string literals for every runtime value — see "Issues found and fixed," below. |

## New: PO intake orchestration, API, and UI

| File | Change | Reason |
|---|---|---|
| `lib/po-intake.ts` | Added | `createPoIntake()` (file upload or pasted-text submission → stored `OrderDocument` → dispatched extraction, all in one call), `reExtractPoDocument()` (re-runs extraction against the original stored bytes, creating a new `ExtractionRun` row rather than overwriting the previous one), `runExtraction()`, `storeBytes()`, `sniffedTypeToChannel()`. Pasted text is encoded as UTF-8 bytes and stored through the same `StorageDriver` as any file upload, so every `OrderDocument` row has real stored bytes/checksum/storage key regardless of channel. The file's channel is derived from **sniffed byte signatures** (`lib/storage/content-sniff.ts`, Milestone 0, reused unchanged), never a client-claimed MIME type. No Postgres transaction is held open across the extraction call — document creation, extraction, and recording the outcome are three separate transactions/calls. Every extraction path's output is re-validated against `validateExtractionResult()` at runtime before being persisted, regardless of its TypeScript type. Same type-only-import fix as `router.ts` — see "Issues found and fixed," below. |
| `lib/po-intake-queries.ts` | Added | `listPoIntakeDocuments()`, `getPoIntakeDocumentDetail()` — read-side queries for the list/detail API routes and the UI page. |
| `app/api/po-intake/route.ts` | Added | `GET` (list) and `POST` (file upload via `multipart/form-data`, or a JSON paste submission) — the entry point for both intake flows. |
| `app/api/po-intake/[id]/route.ts` | Added | `GET` — document detail, including every extraction run and its structured output. |
| `app/api/po-intake/[id]/re-extract/route.ts` | Added | `POST` — re-run extraction for an existing document. |
| `app/orders/intake/page.tsx` | Added | PO intake UI: upload-or-paste form, document list, and a detail panel showing every extraction attempt's structured header/lines, with warnings surfaced per line. |
| `app/components/sidebar.tsx` | Modified | Added a "PO Intake" entry (new `Inbox` icon) under WORKSPACE, after "New Order". |
| `lib/http.ts` | Modified | Pulled `sanitizeFileName()` out of `app/api/orders/[id]/documents/route.ts`'s private copy into this shared module, so `app/api/po-intake/route.ts` doesn't need a second, duplicate implementation. |
| `app/api/orders/[id]/documents/route.ts` | Modified | Import changed to `sanitizeFileName` from `@/lib/http`; the now-redundant local copy of the function was removed. No behavior change. |
| `.env.example` | Modified | Added a documented block for `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `EXTRACTION_PROVIDER`. |

## Dependencies

| File | Change | Reason |
|---|---|---|
| `package.json` / `package-lock.json` | Modified | Real `npm install exceljs@4.4.0 @anthropic-ai/sdk@1.6.0 --save --no-audit --no-fund` against the real npm registry (not hand-edited) — `exceljs` for reading customer Excel POs now and writing the Milestone 2C handover later (one Excel library for the whole project), `@anthropic-ai/sdk` for the real extraction provider. |

## Tests

| File | Change | Reason |
|---|---|---|
| `tests/extraction-schema.test.ts` | Added | 8 tests against `validateExtractionResult()` — schema-version mismatch, invalid decimal shape, null-quantity acceptance, unrecognized classification, empty description, zero-line `UNRELATED` document, invalid calendar date. |
| `tests/mock-extraction-provider.test.ts` | Added | Tests for `parsePastedText()` (leading/trailing quantity, no-guess-when-absent, multi-line splitting, blank-line skipping, verbatim preservation) and `MockExtractionProvider` (provider labelling, schema-valid output, empty-text → `UNRELATED`, fixture selection, unknown-fixture fallback). |
| `tests/deterministic-csv-parser.test.ts` | Added | 8 tests against `parseCustomerPoCsv()` — header synonyms, unit-vs-unit-price disambiguation, unparseable-quantity flagging (never guessing), blank-description skipping, missing-description-column failure, empty-file failure, leading-zero preservation. |
| `tests/deterministic-excel-parser.test.ts` | Added | 5 tests against `parseCustomerPoExcel()`, building real in-memory `.xlsx` buffers via `exceljs` itself rather than needing checked-in binary fixtures — real round-trip parsing, numeric-cell-as-decimal-string, blank-row skipping, missing-column failure, corrupted-buffer failure. |
| `tests/acceptance-po-intake-deterministic.test.ts` | Added | Milestone 2A's end-to-end acceptance test, from the approved report's own acceptance criteria. Chains the real `dispatchExtraction()` — the exact function `lib/po-intake.ts` calls for every live upload/paste — across CSV, Excel, and pasted-WhatsApp-text submissions of the same order: CSV/Excel report `provider: "DETERMINISTIC"` (never reaching an AI provider), a leading-zero code embedded in free text survives untouched, a WhatsApp message with no key configured falls back to `provider: "MOCK"` and never guesses a missing quantity, and two different pack sizes of "Baby Marrow" stay as two distinct lines. Needs no database, so it runs unconditionally in the sandbox. |

## Issues found and fixed during this milestone

- **Prisma-enum-as-runtime-value, caught before any test ran, not after**:
  the first drafts of `lib/extraction/router.ts` and `lib/po-intake.ts`
  imported `OrderSource`/`ExtractionProvider`/`DocumentClassification`/
  `DocumentIntakeStatus`/`ExtractionRunStatus` as runtime values from
  `@prisma/client` and dereferenced members like `OrderSource.EXCEL`.
  Verified directly (`node -e "console.log(require('@prisma/client').OrderSource)"`
  → `undefined`) that this sandbox's stub client exports every one of
  these as `undefined` — the same root cause as the pre-existing,
  already-accepted `tests/order-validation.test.ts` failure. Rather than
  accept a second category of sandbox-only test failures for brand-new
  code with no genuine need to touch the broken stub, both files now
  import these as **types only** (`import type {...}`) and use plain
  string literals (`"EXCEL"`, `"DETERMINISTIC"`, etc.) for every runtime
  value — correct, not just a workaround, since Prisma's generated enum
  field types are string-literal unions, not nominal class instances.
  Fixed before writing a single test against either file; confirmed by
  the fact that all four new provider/parser test files and the
  acceptance test pass cleanly in this sandbox once the fix was in place.
  On your real machine, with a real generated client, the original code
  would also have worked — this exists purely so this sandbox's own
  `vitest` run is informative rather than blocked, and is good practice
  regardless.
- **`exceljs`'s own type declarations conflict with modern `@types/node`,
  real and machine-independent** (not sandbox-related): `exceljs`'s
  `index.d.ts` declares a bogus ambient global `interface Buffer extends
  ArrayBuffer {}` that merges with `@types/node`'s real, generic
  `Buffer<TArrayBuffer>` global interface, making every call to
  `workbook.xlsx.load(buffer)` a type error — `tsconfig.json`'s
  `skipLibCheck: true` doesn't help, because it only skips checking
  *inside* `.d.ts` files, not usage sites in ordinary `.ts` files. This
  would occur on your real machine too, with the same `exceljs@4.4.0`.
  Fixed with a single, narrowly-scoped, commented `as any` cast at the one
  call site in `lib/extraction/deterministic/excel.ts` (casting to the
  bare `Buffer` identifier doesn't help — it resolves to the exact same
  broken merged type the function already expects).
- **Test-file typing bug, also machine-independent**:
  `tests/extraction-schema.test.ts`'s `validResult()` helper had no return
  type annotation, so TypeScript inferred `extractedQuantity: string` from
  its `"10"` literal rather than the schema's real `string | null`,
  breaking a later test that assigns `null` to it. Fixed by annotating
  `validResult(): ExtractionResult`.
- **Real lint error found and fixed** (not sandbox-related):
  `app/orders/intake/page.tsx` had two `useEffect` hooks loading data on
  mount/selection change; the first correctly used the project's
  established `void Promise.resolve().then(() => load())` pattern (to
  avoid calling `setState` synchronously within the effect body) but the
  second (triggered on `selectedId` change) called `loadDetail()`
  directly, which `react-hooks/set-state-in-effect` correctly flagged.
  Fixed to match the first effect's pattern. `npm run lint` is clean after
  the fix.
- **Sandbox `tsc`/`build` delta, fully accounted for**: this round's
  standalone `npx tsc --noEmit` went from the pre-existing 67 error lines
  to 77 (+10), every one of those 10 in the same two pre-existing
  sandbox-stub categories already seen throughout this project
  (`TS2305`/`TS7006`), now additionally hit by `lib/extraction/router.ts`
  (2), `lib/po-intake.ts` (7), and `lib/po-intake-queries.ts` (1). No new
  error category anywhere. `npm run build`'s Turbopack bundling stage
  reports "Compiled successfully"; its own TypeScript-check phase hits
  the sandbox's long-standing Google Fonts network block, and — verified
  with the same temporary diagnostic font-swap technique used in earlier
  rounds, reverted immediately after and confirmed byte-identical to the
  original `app/layout.tsx` — the identical 77-error sandbox-stub set as
  standalone `tsc`, nothing new in the build phase specifically. Your
  next real `npm run build` is what actually confirms this past the point
  this sandbox can reach.

# Milestone 2B — Matching, aliases, duplicate detection, human review

Per your approved three-sub-build sequence: turn each Milestone 2A
`ExtractionRun`'s stored header/lines into a real `CustomerOrder`, through
a human review workspace — deterministic customer/product matching with
alias learning, duplicate-order detection, and an explicit confirm step.
No Excel/CSV handover document, no multi-store splitting, no repeat-order
detection — those remain Milestone 2C, not started. Full rationale for
every design decision below is in `docs/milestones/PROGRESS.md`'s
Milestone 2B section; this file lists every file and the reason for it.

## Database / Prisma

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | Modified | Additive only. `DocumentIntakeStatus` gains `CONFIRMED`. Two new enums: `ExtractedLineStatus`, `ExtractedLineMatchSource`. New model `ExtractedOrderLine` — one real row per extracted line, with its own computed/human product match and review decision (see PROGRESS.md for the full field list). New models `ProductAlias`/`CustomerAlias` — human-confirmed free-text-to-real-record mappings, each `Cascade`-deleting on its `Customer`/`Product` FK (never `SetNull` — see PROGRESS.md for why that would be a real bug). `User`/`Customer`/`Product`/`OrderLine`/`ExtractionRun` each gain the new inverse relations these models need. |
| `prisma/migrations/20261109140000_add_matching_review_aliases/migration.sql` | Added | Hand-written, matching the schema change above exactly: `ALTER TYPE ... ADD VALUE`, 2× `CREATE TYPE`, 3× `CREATE TABLE`, all plain indexes, **two hand-added partial unique indexes** on `ProductAlias` (`WHERE "customerId" IS NULL` / `WHERE "customerId" IS NOT NULL` — not expressible in `schema.prisma`'s DSL; see PROGRESS.md), one plain unique index on `CustomerAlias`, and every foreign key. Purely additive — no column drops, renames, or type narrowing. |

## New: matching engine (`lib/matching/`)

| File | Change | Reason |
|---|---|---|
| `lib/matching/normalize.ts` | Added | `normalizeMatchText()`, `tokenize()`, `diceCoefficient()`, `selectConfidentMatch()` — the one shared text-normalization/scoring module used identically by alias storage, alias lookup, and both fuzzy matchers. Deliberately keeps digits and pack-size/unit words (never strips them) — see PROGRESS.md for why that's what prevents different pack sizes from being merged. `selectConfidentMatch` is the one "confident and unambiguous" decision, factored out so `product-matcher.ts`/`customer-matcher.ts` can't drift apart on it. |
| `lib/matching/aliases.ts` | Added | `lookupProductAlias()`/`lookupCustomerAlias()` (customer-specific alias always checked before a global one), `recordProductAlias()`/`recordCustomerAlias()` (find-or-create-or-repoint: re-pointing an alias to a new target resets `timesConfirmed` to 1 rather than incrementing a now-superseded count). |
| `lib/matching/product-matcher.ts` | Added | `matchProductDescription()` — alias lookup first, then Dice-coefficient fuzzy scoring against up to 50 DB-narrowed active `Product` candidates, with an exact-SAP-item-code-token floor of 0.95. `FUZZY_CONFIDENT_THRESHOLD`/`FUZZY_AMBIGUITY_GAP` are an honest, documented, unverified assumption (no real calibration data yet). |
| `lib/matching/customer-matcher.ts` | Added | `matchCustomerHeader()`/`buildCustomerSearchText()` — the same two-stage approach mirrored for `Customer` (`name`/`storeCode`/`sapCustomerCode`). |

## New: review workspace (`lib/review/`, API, UI)

| File | Change | Reason |
|---|---|---|
| `lib/review/duplicate-check.ts` | Added | `checkForDuplicates()` — same document checksum already an order, or same customer + PO reference on a non-cancelled/non-rejected order. Computed fresh on every read, never cached. |
| `lib/review/confirm-review-validation.ts` | Added | `confirmReviewSchema`/`lineDecisionSchema` (zod) for `POST .../review/confirm`'s request body. Reuses `decimalString`/`dateOnlyString` from `lib/order-validation.ts` rather than a second, drift-prone copy. |
| `lib/review/build-review-session.ts` | Added | `getOrBuildReviewSession()` — idempotently materializes one `ExtractedOrderLine` per extracted line the first time a document's review workspace is opened (a concurrent duplicate materialization attempt is caught via the table's own unique constraint and treated as a benign race, never an error), computes the customer match once and reuses it for every line's product match, and assembles the full session including fresh duplicate warnings. |
| `lib/review/confirm-review.ts` | Added | `confirmReviewSession()` — the one action that creates the order. Requires an explicit decision for every materialized line, at least one acceptance, a resolved quantity/unit on every accepted line, and `acknowledgeDuplicate: true` on a fresh duplicate hit. In one transaction: creates the order via `lib/orders.ts`'s new `createOrderCore()`, links each accepted line's `resultingOrderLineId`, marks excluded lines, confirms the `OrderDocument`, learns a `ProductAlias` per accepted line and a `CustomerAlias` for the resolved customer, and writes a `PO_REVIEW_CONFIRMED` audit event. |
| `app/api/po-intake/[id]/review/route.ts` | Added | `GET` — opens/builds the review session. |
| `app/api/po-intake/[id]/review/confirm/route.ts` | Added | `POST` — CSRF check, zod validation, calls `confirmReviewSession()`, surfaces field errors and duplicate warnings on 400/409. |
| `app/orders/intake/[id]/review/page.tsx` | Added | The review workspace UI: customer search/override with alias-text capture, editable order header fields, duplicate-warning display with an explicit acknowledge checkbox, per-line product search/override with quick-pick candidates, accept/exclude toggles with an optional exclusion reason, and the confirm action. Reuses the existing `GET /api/customers?search=`/`GET /api/products?search=` list endpoints rather than adding new search routes. |
| `app/orders/intake/page.tsx` | Modified | Added a `CONFIRMED` status badge and a "Review & confirm" / "View review" button linking to the new review workspace once a document is `EXTRACTED`/`CONFIRMED`; updated the page's intro copy (matching/review is no longer "Milestone 2B, not yet built" — it's this page's own neighbor now). |

## Modified: order creation (shared with the public API)

| File | Change | Reason |
|---|---|---|
| `lib/orders.ts` | Modified | Extracted `createOrder()`'s `CustomerOrder`/`OrderLine`/`OrderStatusHistory`/`AuditEvent` creation logic into a standalone exported `createOrderCore(tx, reference, input, createdById, isDemo)` that takes an already-open transaction client, so `confirmReviewSession()` can reuse it inside its own transaction (Prisma's interactive transactions can't nest). `createOrder()` now just opens a transaction and calls it. Also exported `TRANSACTION_OPTIONS`, `isUniqueViolation()`, `generateOrderReference()` (previously module-private) for the same reuse. No behavior change to `createOrder()`'s own public contract. |
| `lib/order-validation.ts` | Modified | Narrowed the public `/api/orders` create schema's `source` field from all 7 `OrderSource` values (`z.nativeEnum(OrderSource)`) to exactly `["EMAIL", "WHATSAPP", "MANUAL"] as const` — a genuine least-privilege fix on its own merits (the manual-entry endpoint should never accept a client's unearned claim of `source: "EXCEL"`/`"PDF"`/etc.), found while defining `confirmReviewSession`'s wider internal-only `OrderCreationInput` type. Exported `decimalString`/`optionalDecimalString`/`dateOnlyString` (previously module-private) for reuse by `lib/review/confirm-review-validation.ts`. |

## Tests

| File | Change | Reason |
|---|---|---|
| `tests/matching-normalize.test.ts` | Added | 21 unconditional unit tests (no `@prisma/client` dependency anywhere in its import graph) — `normalizeMatchText`/`tokenize`/`diceCoefficient` (including the never-merge-pack-sizes property) and `selectConfidentMatch`'s exact confidence-threshold/ambiguity-gap boundaries. |
| `tests/matching-review-db.integration.test.ts` | Added | This milestone's acceptance test — 7 tests, gated behind `RUN_DB_INTEGRATION_TESTS=1` like `tests/orders-db.integration.test.ts` (same one reason: no real `@prisma/client` in this sandbox). Alias record/lookup and re-pointing; alias priority over fuzzy scoring; duplicate detection on both signals; the full build-review → idempotent-reopen → confirm (with a manual override) → real `CustomerOrder`/alias/audit-event chain; the already-confirmed guard; the acknowledge-duplicate gate; the all-lines-excluded rejection. **Run this on your own machine** after `npm run db:seed` to get real coverage of this milestone's core deliverable. |
| `tests/order-validation.test.ts` | Modified | Comment-only update: the file's top-of-file note describing a permanently-accepted sandbox-only failure no longer applies, now that `lib/order-validation.ts`'s `OrderSource` narrowing (above) removed the file's only runtime dependency on the broken stub. No assertions changed. |

## Issues found and fixed during this milestone

- **A genuine security/correctness fix with a sandbox side-benefit, not a
  workaround applied for sandbox reasons**: `lib/order-validation.ts`'s
  `source: z.nativeEnum(OrderSource)` on the public, manual-entry
  `/api/orders` endpoint accepted all 7 `OrderSource` values, including
  the four upload-channel values (`PDF`/`IMAGE`/`EXCEL`/`CSV`) that make
  no sense for a human typing an order in directly — a client could claim
  `source: "EXCEL"` with no document behind it at all. Narrowed to
  `["EMAIL", "WHATSAPP", "MANUAL"]`. Found while working out what
  `confirmReviewSession`'s wider, internal-only `OrderCreationInput` type
  needed to allow that the public-facing type correctly should not. As a
  side effect (not the reason for the fix), this also removed
  `tests/order-validation.test.ts`'s only runtime dependency on this
  sandbox's broken `@prisma/client` stub — a test that has been this
  project's one permanently-accepted sandbox-only failure since round 1
  now passes cleanly here too, confirmed by re-running it in isolation
  before touching anything else.
- **The `ProductAlias` partial-unique-index requirement, caught by
  reasoning about the constraint before writing the migration, not
  after**: "one global alias per text" and "one per-customer alias per
  (customer, text)" need to coexist as two independent unique
  constraints — neither Prisma's `@@unique` nor a single composite index
  can express "unique on (customerId, normalizedText) OR unique on just
  normalizedText-when-customerId-is-null" as one declaration, and
  Prisma's schema DSL has no `WHERE` clause for a partial index at all.
  Solved with two hand-written partial unique indexes directly in the
  migration SQL (documented in both the migration and the model's own
  schema comment, so a future auto-generated migration touching this
  table doesn't silently drop them).
- **Sandbox `tsc` delta, fully accounted for**: standalone `npx tsc
  --noEmit` went from the pre-2B baseline of 93 error lines to 100 (+7,
  all `TS7006` "implicitly has an `any` type" on `tx`/array-map
  parameters inside the new `tests/matching-review-db.integration.test.ts`,
  whose types collapse through the same broken `Prisma.TransactionClient`
  stub every other integration test in this project already hits) on top
  of +16 in the library/route/page files themselves (same two
  pre-existing `TS2305`/`TS7006` sandbox-stub categories, confirmed by
  diffing the error-code histogram before and after). No new error
  category anywhere. `npm run lint` is clean. `npx vitest run`: 200
  passed, 8 skipped (up from 163 passed/1 skipped at the end of Milestone
  2A), zero failures. `npm run build` reaches the same pre-existing
  Google Fonts network block as every previous milestone's build attempt
  — unrelated to any 2B code.
- A first draft of `tests/matching-review-db.integration.test.ts` used
  BigInt literal syntax (`10n`) for `OrderDocument.fileSize` — this
  project's `tsconfig.json` targets `ES2017`, which doesn't support
  BigInt literals (`TS2737`). Fixed to `BigInt(10)`, matching the pattern
  already used in `lib/po-intake.ts`.
- Two `react/no-unescaped-entities` lint errors in the new review
  workspace page (`app/orders/intake/[id]/review/page.tsx`, two literal
  apostrophes in copy text) — fixed with `&apos;`. `npm run lint` is
  clean after the fix.

# Milestone 2C — SAP handover, multi-store splitting, repeat orders

The final sub-build of the approved 2A/2B/2C sequence: manual, per-order
handover generation (Excel/CSV/clipboard, official SAP descriptions),
splitting one submitted document into several confirmed orders when it
names several different store-customers, and one-click re-ordering from
an existing order. Full rationale for every design decision below is in
`docs/milestones/PROGRESS.md`'s Milestone 2C section; this file lists
every file and the reason for it.

## Database / Prisma

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | Modified | Additive only. New `HandoverFormat` enum (`EXCEL`/`CSV`/`CLIPBOARD`). New model `OrderHandover` — one append-only row per generation attempt, never overwritten/deduplicated; `storageKey`/`originalFileName`/`mimeType`/`fileSize` all nullable (a `CLIPBOARD` handover has no stored file). `CustomerOrder` gains the `handovers` inverse relation; `User` gains `generatedHandovers`. |
| `prisma/migrations/20261109150000_add_order_handover/migration.sql` | Added | Hand-written, matching the schema change exactly: `CREATE TYPE "HandoverFormat"`, `CREATE TABLE "OrderHandover"`, two plain indexes (`orderId`, `isDemo`), two foreign keys (`ON DELETE RESTRICT ON UPDATE CASCADE`). Purely additive. |

## New: handover generation (`lib/handover/`, API, UI)

| File | Change | Reason |
|---|---|---|
| `lib/handover/build-handover-rows.ts` | Added | `buildHandoverRows(orderId)` — the single source of truth every format renders from. Three-way fallback per line (live `Product` join → `sapItemCodeSnapshot` → no match), never silently drops a line (an unmatched/snapshot-only line gets a non-null `note`). Always rebuilt fresh from current data, never cached. |
| `lib/handover/format-rows.ts` | Added | `rowsToCsvText()`/`rowsToClipboardText()` — pure text formatting, zero `@prisma/client` dependency (the row type comes in via `import type` only), so unconditionally unit-testable. CSV: comma-separated, header row, CRLF endings, proper quoting. Clipboard: tab-separated, no header, no quoting, excludes the original customer wording. |
| `lib/handover/generate-handover.ts` | Added | `generateHandover(orderId, actorId, format)` — manual, per-order. Builds an `.xlsx` via `exceljs` for `EXCEL`, plain text for `CSV`/`CLIPBOARD` (both from the exact same `buildHandoverRows` output). One transaction: creates the `OrderHandover` row, sets `CustomerOrder.handedToSapAt` once only (`updateMany` guarded on `handedToSapAt: null`), writes an `ORDER_HANDOVER_GENERATED` audit event. Orphaned storage bytes are deleted on any post-write failure. Refuses (409) only for a `CANCELLED`/`REJECTED` order — deliberately **not** gated on `OrderStatus.APPROVED` (see PROGRESS.md: no approval workflow exists anywhere in this project yet). |
| `lib/handover/queries.ts` | Added | `listOrderHandovers(orderId)` — the past-handovers list, with a computed `downloadUrl` (`null` for `CLIPBOARD`) and `fileSize` coerced from `BigInt` to `Number` for JSON. |
| `app/api/orders/[id]/handover/route.ts` | Added | `GET` — lists handovers. `POST` — CSRF check, zod-validated `{ format }`, calls `generateHandover()`, 201 on success. |
| `app/api/orders/[id]/handover/[handoverId]/download/route.ts` | Added | `GET` — mirrors `GET /api/files/[id]`'s exact pattern; `handoverId` is the `OrderHandover` row id, never a storage key. Never reachable for a `CLIPBOARD` handover (no stored file). |
| `app/orders/[id]/handover-panel.tsx` | Added | The one client-rendered "island" on the otherwise-Server-Component order detail page: Generate Excel/CSV/Copy-to-clipboard buttons, a past-handovers list with download links, clipboard copy via `navigator.clipboard.writeText`. |
| `app/orders/[id]/page.tsx` | Modified | Embedded `HandoverPanel`; added a "Repeat this order" link (`/orders/new?repeatFrom=<id>`) to the title row. |

## Modified: multi-store splitting (`lib/review/`)

| File | Change | Reason |
|---|---|---|
| `lib/review/confirm-review-validation.ts` | Modified | `lineDecisionSchema` gains one new, additive, optional field: `customerId` — omitted means "this line belongs to the document-level default customer" (today's exact behavior, unchanged); set only when a line belongs to a *different* store. Comment-only clarification added to the top-level `customerId` field explaining it's now the *default*. |
| `lib/review/confirm-review.ts` | Modified | Groups accepted lines by their effective customer (`decision.customerId ?? input.customerId`); creates one `CustomerOrder` per group, atomically, in the same single transaction (all or none); the primary group (`input.customerId`'s, or the first group if every line was reassigned away from it) keeps the top-level `orderId`/`orderReference` fields exactly as before — a new `orders: [{ orderId, orderReference, customerId }, ...]` array is added alongside, backward-compatible with every existing single-store caller. Every *other* distinct customer referenced by an override is validated to exist before the transaction opens. Duplicate detection now runs once per distinct group customer (`SAME_CUSTOMER_PO_REFERENCE` is customer-scoped), deduplicating the document-scoped `SAME_DOCUMENT_CHECKSUM` warning down to at most one; still all-or-nothing (409 if any group has an unacknowledged warning). `customerLocationId` only ever applies to the primary group. `ProductAlias` learning for an accepted line now uses that line's own effective customer, not the document-level default. |
| `app/api/po-intake/[id]/review/confirm/route.ts` | Modified | Passes through the new `orders` array in the JSON response, alongside the unchanged `orderId`/`orderReference`/`acceptedLineCount`/`excludedLineCount` fields. |
| `app/orders/intake/[id]/review/page.tsx` | Modified | Each accepted line gets an "Assign to a different store" control (a second, independent customer-search picker) that shows a "Different store: `<name>`" chip once set, with a clear button. The confirm success banner shows a list of every created order (with its own customer label) when the document was actually split, or the single order as before otherwise. |

## New / modified: repeat orders

| File | Change | Reason |
|---|---|---|
| `app/orders/new/page.tsx` | Modified | Reads `?repeatFrom=<orderId>` via `window.location.search` directly inside a `useEffect` (not `useSearchParams()`, to avoid its Suspense-boundary requirement on this `"use client"` page). Fetches the original order and its customer, then pre-fills source/customer/delivery address/lines (product search boxes show `sapItemCodeSnapshot` as a pragmatic placeholder — no single-product-lookup endpoint exists). `customerPoReference`/`internalNotes`/`orderDate`/`requestedDeliveryDate` are deliberately left blank. The existing customer-locations-loading effect gets one small additive tweak (`pendingRepeatLocationIdRef`) to prefer the original order's own location over its own default-location fallback, consumed once. |

## Tests

| File | Change | Reason |
|---|---|---|
| `tests/handover-format-rows.test.ts` | Added | 7 unconditional unit tests (no `@prisma/client` dependency) — exact CSV header/CRLF/quoting behavior, that an unmatched line always still gets a row in both formats, and the empty-order edge case. |
| `tests/handover-db.integration.test.ts` | Added | 5 tests, gated behind `RUN_DB_INTEGRATION_TESTS=1`: the three-way fallback never drops a line; `generateHandover(EXCEL)` produces a real, `exceljs`-readable `.xlsx`, an append-only `OrderHandover` row, and sets `handedToSapAt` exactly once (not re-set by a later, different-format generation); `generateHandover(CSV)`'s stored content matches `buildHandoverRows`/`rowsToCsvText` exactly; `generateHandover(CLIPBOARD)` stores nothing but returns the clipboard text; generation is refused for a cancelled order. |
| `tests/matching-review-db.integration.test.ts` | Modified | One new test added (now 8 in this file): a document with two lines, one tagged with a different store customer, confirms into two separate `CustomerOrder`s in one call — verifies the backward-compatible `orderId` aliasing, that `OrderDocument.orderId` points only at the primary order, that each `ExtractedOrderLine` links to its own order's own line, and that the reassigned line's `ProductAlias` is learned against the split customer. |

## Issues found and fixed during this milestone

- **A pre-existing, dashboard-metric-implied gate deliberately NOT
  added**: `lib/order-queries.ts`'s own dashboard metric filters on
  `{ status: APPROVED, handedToSapAt: null }`, implying handover
  generation is eventually meant to require `OrderStatus.APPROVED` — but
  no code anywhere in this project sets that status yet (no approval
  workflow exists). Adding that gate now would make this entire feature
  permanently unusable. Generation is refused only for
  `CANCELLED`/`REJECTED` orders instead; documented explicitly as an open
  item in PROGRESS.md rather than silently worked around either way.
- **The same `exceljs`/`@types/node` `Buffer` conflict already fixed on
  Milestone 2A's read side recurs on this milestone's write side** —
  `workbook.xlsx.writeBuffer()`'s declared return type is `exceljs`'s own
  bogus ambient `Buffer`-extends-`ArrayBuffer` interface, not
  `@types/node`'s real one. Fixed with the exact same narrowly-scoped,
  commented `eslint-disable-next-line @typescript-eslint/no-explicit-any`
  cast already used in `lib/extraction/deterministic/excel.ts`.
- **Sandbox `tsc` delta, fully accounted for**: standalone `npx tsc
  --noEmit` went from the 2B-end baseline of 100 error lines to 105 (+5,
  all in the exact same pre-existing `TS7006` "implicitly has an `any`
  type" sandbox-stub category already documented in every previous
  milestone — confirmed by diffing the full error-code-and-location
  histogram line by line before and after this round's changes). No new
  error category anywhere. `npm run lint` is clean. `npx vitest run`: 207
  passed, 14 skipped (up from 200 passed/8 skipped at the end of
  Milestone 2B), zero failures. `npm run build` reaches the same
  pre-existing Google Fonts network block as every previous milestone's
  build attempt — unrelated to any 2C code.

# Milestone 3A — Changes (warehouse picking, SAP Invoice Handover Specification stage 1 of 4)

Every file added or modified to build stage 3A. No files were deleted.
See `docs/milestones/PROGRESS.md`'s Milestone 3A section for the full
design rationale and honest verification results, and
`docs/milestones/ROADMAP.md` for the master 0–3D status table.

## Database / Prisma

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | Modified | Added `OrderStatus.PICKING`/`READY_TO_INVOICE`; added `PickingSessionStatus` enum; added `PickingSession`/`PickingLine` models; added `OrderHandover.pickingSessionId`/`reference` (both nullable); added the matching inverse relation fields on `User`, `CustomerOrder`, and `OrderLine`. All additive — see PROGRESS.md for exactly why each piece exists. |
| `prisma/migrations/20261110060000_add_picking_sessions/migration.sql` | Added | The migration for the schema change above. Purely additive: `ALTER TYPE ... ADD VALUE`, two `CREATE TABLE`s, two nullable `ADD COLUMN`s on `OrderHandover`, new indexes/FKs. No column drops, renames, or type changes — safe to run against a database that already has real data (see SETUP-WINDOWS.md §15's rollback warning about the enum values specifically, though). |

## `lib/picking/` (new)

| File | Change | Reason |
|---|---|---|
| `lib/picking/validation.ts` | Added | Zod schema for the record-line request body; pure, exact (`BigInt`-based, not floating-point) decimal arithmetic — `exceedsRequested`/`fullyAccountsFor`. Zero `@prisma/client` dependency, so unconditionally unit-testable. |
| `lib/picking/start-picking.ts` | Added | `startPickingSession(orderId, actorId)` — creates a `PickingSession` + one `PickingLine` per order line (snapshotting `requestedQuantity`), moves the order to `PICKING`. Refuses a cancelled/rejected/lineless order and a second concurrent session. |
| `lib/picking/record-picked-line.ts` | Added | `recordPickedLine(...)` — records a line's found/unavailable split while its session is `IN_PROGRESS`; rejects overcounting immediately, allows partial entry. |
| `lib/picking/complete-picking.ts` | Added | `completePickingSession(...)` — marks a session `COMPLETED` once every line fully accounts for its requested quantity; names which lines don't yet, if any. |
| `lib/picking/authorize-picking.ts` | Added | `authorizePickingSession(...)` — marks a `COMPLETED` session `AUTHORIZED`, moves the order to `READY_TO_INVOICE`. Role-agnostic by design — the route restricts this to `SALES_MANAGER`/`ADMINISTRATOR`. |
| `lib/picking/queries.ts` | Added | `getLatestPickingSessionForOrder`/`getPickingSessionDetail` — read-only session+lines lookups for the new `GET` routes and the future 3B UI. |

## API routes (new)

| File | Change | Reason |
|---|---|---|
| `app/api/orders/[id]/picking/route.ts` | Added | `GET` (latest session for this order) / `POST` (start a new one). |
| `app/api/orders/[id]/picking/[sessionId]/lines/[lineId]/route.ts` | Added | `PATCH` — record one line's found/unavailable split. |
| `app/api/orders/[id]/picking/[sessionId]/complete/route.ts` | Added | `POST` — complete a session. |
| `app/api/orders/[id]/picking/[sessionId]/authorize/route.ts` | Added | `POST` — authorize a session; restricted to `SALES_MANAGER`/`ADMINISTRATOR`. |

## Display helpers

| File | Change | Reason |
|---|---|---|
| `lib/order-display.ts` | Modified | Added `PICKING`/`READY_TO_INVOICE` to `ORDER_STATUSES`/`ORDER_STATUS_LABELS`/`ORDER_STATUS_STYLES` — the existing order list/detail pages now show a correct badge and filter tab for these statuses with no further code change. |

## Tests

| File | Change | Reason |
|---|---|---|
| `tests/picking-validation.test.ts` | Added | 14 unconditional unit tests for `lib/picking/validation.ts`'s schemas and exact decimal arithmetic. |
| `tests/picking-db.integration.test.ts` | Added | 6 tests, gated behind `RUN_DB_INTEGRATION_TESTS=1`: the full start → record → complete → authorize lifecycle against the spec's worked example, every refusal path, and the re-pick-after-authorization case. |

## Documentation

| File | Change | Reason |
|---|---|---|
| `docs/milestones/ROADMAP.md` | Added | The single master cross-milestone roadmap you asked for — status of every milestone 0 through the proposed 3D, known pre-existing placeholders, and an explicit "things to never conflate" section (picking vs. the separate pricing-verification workflow; `StockSnapshot` vs. a picking session). Updated after every milestone from here on. |
| `docs/milestones/PROGRESS.md` | Modified | Added the Milestone 3A section (design rationale, what was built, honest verification results, open items). |
| `CHANGES.md` | Modified | This section. |
| `SETUP-WINDOWS.md` | Modified | Added §15 (apply migration, regenerate client, run the new DB-integration tests, a curl-based manual test script since there's no UI yet, and the rollback procedure). |

# Milestone 3B — Changes (picking UI, SAP Invoice Handover Specification stage 2 of 4)

Every file added or modified to build stage 3B. No files were deleted,
no schema/migration change this round. See `docs/milestones/PROGRESS.md`'s
Milestone 3B section for the full design rationale and honest
verification results, and `docs/milestones/ROADMAP.md` for the master
0–3D status table.

## `lib/picking/`

| File | Change | Reason |
|---|---|---|
| `lib/picking/queries.ts` | Modified | Added `listPickingQueue(options)` — the `/fulfilment` list's query: every live `CustomerOrder` (not `DRAFT`/`CANCELLED`/`REJECTED`) not yet handed to SAP (`handedToSapAt IS NULL`), paginated, oldest first. Deliberately queries `CustomerOrder` directly rather than `PickingSession`, so an order that hasn't had picking started yet still appears. |

## `/fulfilment` UI (new)

| File | Change | Reason |
|---|---|---|
| `app/fulfilment/page.tsx` | Added | The picking queue list — a plain Server Component (no client-side search/filter, by design), paginated via `listPickingQueue`. Wires up the sidebar's previously-dead "Picking & Fulfilment" nav entry. |
| `app/fulfilment/[id]/page.tsx` | Added | The per-order picking workstation — Server Component guards (session/valid-id/order-exists), a "not eligible for picking" message for dead-status orders, otherwise renders `PickingPanel`. Computes `canAuthorize` server-side and passes only that boolean down (new pattern for this project). Links back to the full order detail page rather than duplicating its content. |
| `app/fulfilment/[id]/picking-panel.tsx` | Added | The one Client Component — drives start/record/complete/authorize against 3A's API, mirroring `handover-panel.tsx`'s established conventions (always re-fetch after a mutation, inline error text, `readJson()` helper). Four UI states keyed off the latest `PickingSessionDetail`'s status. |

## Documentation

| File | Change | Reason |
|---|---|---|
| `docs/milestones/ROADMAP.md` | Modified | Marked 3B done; added its change-log entry. |
| `docs/milestones/PROGRESS.md` | Modified | Added the Milestone 3B section (design rationale, what was built, honest verification results, open items — including that session abandon/cancel is still not built). |
| `CHANGES.md` | Modified | This section. |
| `SETUP-WINDOWS.md` | Modified | Added §16 — a browser-based manual test script walking through the actual `/fulfilment` UI now that it exists, superseding 3A's curl-only script for this purpose (the curl script in §15 still works and is left as-is for anyone who prefers it or is testing the API directly). |

# Milestone 3C — Changes (Invoice Handover rework, SAP Invoice Handover Specification stage 3 of 4)

Every file added or modified to build stage 3C. No files were deleted.
**Honesty note**: this round's session did not have the spec's literal
text in context (compacted away in an earlier session) — the exact
column/header names below are a best-reasoned reconstruction from this
project's own prior wording (`ROADMAP.md`'s 3C scope line), not
re-verified against the spec directly. See `docs/milestones/PROGRESS.md`'s
Milestone 3C section for the full design rationale, that note in full,
and honest verification results, and `docs/milestones/ROADMAP.md` for
the master 0–3D status table.

## Database / Prisma

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | Modified | `OrderHandover.reference` gains `@unique` (safe: Postgres never treats two `NULL`s as colliding, and every pre-3C row has `reference = NULL`). Softened the `HandoverFormat` enum's SAP-grid-compatibility overclaim comment. No other schema change -- `pickingSessionId` already existed, unused, since Milestone 3A. |
| `prisma/migrations/20261110170000_add_handover_reference_unique/migration.sql` | Added | One `CREATE UNIQUE INDEX`. No column type, nullability, or data change -- safe to run against a database that already has real `OrderHandover` rows. |

## `lib/handover/` (reworked)

| File | Change | Reason |
|---|---|---|
| `lib/handover/build-handover-rows.ts` | Modified | Hard-blocks (409) unless the order is `READY_TO_INVOICE`; sources `quantity` from the order's most recent `AUTHORIZED` `PickingSession`'s `PickingLine.foundQuantity`, never `OrderLine.requestedQuantity`; omits a 100%-unavailable line entirely (`omittedLineCount` returned, never silent); adds `pickingSessionId`/`authorizedByName`/`authorizedAt` to the returned order info for the richer header/traceability. |
| `lib/handover/generate-handover.ts` | Modified | Adds `generateHandoverReference()` (mirrors `lib/orders.ts`'s `generateOrderReference()`, same collision-retry loop); Excel header gains the Handover Reference and picking-authorization traceability fields; Excel's product table is now the spec's 4 columns (SAP Item Code, Description, Quantity, Unit) with a separate "Lines needing attention before processing" section for anything flagged; records `pickingSessionId`+`reference` on the created `OrderHandover` row; result shape gains `reference`/`omittedLineCount`. |
| `lib/handover/format-rows.ts` | Modified | CSV/clipboard rewritten to the same 4-column layout; CSV additionally appends the "Lines needing attention" exceptions section (clipboard does not -- nowhere for it to go once pasted). |
| `lib/handover/queries.ts` | Modified | `listOrderHandovers` now also selects/returns each handover's `reference`, so the UI can show it. |

## UI (`app/orders/[id]/`)

| File | Change | Reason |
|---|---|---|
| `app/orders/[id]/handover-panel.tsx` | Modified | Takes a new `readyToInvoice: boolean` prop (derived server-side, same pattern as 3B's `canAuthorize`) and disables the three Generate buttons with an inline explanation when false -- UX only, the real gate is server-side. Shows each past handover's reference. Softened the clipboard-copy success message's SAP-grid-compatibility overclaim. |
| `app/orders/[id]/page.tsx` | Modified | Passes `readyToInvoice={order.status === "READY_TO_INVOICE"}` to `HandoverPanel`. |

## Tests

| File | Change | Reason |
|---|---|---|
| `tests/handover-format-rows.test.ts` | Modified | Rewritten for the 4-column layout and the new CSV exceptions section; 8 unconditional unit tests (was 7). |
| `tests/handover-db.integration.test.ts` | Modified | Fixture now drives the real `lib/picking/*` lifecycle via a new `pickAndAuthorizeFully()` helper before generating a handover; new assertions for the hard gate (before picking, mid-pick), `omittedLineCount`, the generated Handover Reference, and `pickingSessionId`; cleanup now also deletes each test order's `PickingSession` rows first (`onDelete: Restrict`). 6 gated tests (was 5). |

## Documentation

| File | Change | Reason |
|---|---|---|
| `docs/milestones/ROADMAP.md` | Modified | Marked 3C done; added its change-log entry, including the same honesty note. |
| `docs/milestones/PROGRESS.md` | Modified | Added the Milestone 3C section (honesty note, design rationale, what was built, honest verification results, open items). |
| `CHANGES.md` | Modified | This section. |
| `SETUP-WINDOWS.md` | Modified | Added §17 (apply the migration, regenerate the client, run the reworked DB-integration tests, and a manual test script walking through the now-gated Generate buttons on `/orders/[id]`). |

# Milestone 3D — Changes (tests, docs, verification — final stage of the SAP Invoice Handover Specification)

No new behavior this round -- a coverage and consistency pass closing
out the 3A-3D stage breakdown. No files were deleted, no schema change.
See `docs/milestones/PROGRESS.md`'s Milestone 3D section for the full
detail (including the formal write-up of session abandon/cancel as a
known, accepted limitation) and `docs/milestones/ROADMAP.md` for the
master 0-3D status table, now fully ✅ for Milestone 3.

## Tests

| File | Change | Reason |
|---|---|---|
| `tests/picking-queries-db.integration.test.ts` | Added | 3 gated tests closing the zero-coverage gap on `lib/picking/queries.ts`'s `listPickingQueue` (3B) and `getLatestPickingSessionForOrder`/`getPickingSessionDetail` (3A) -- none had any test coverage, direct or indirect, before this round. |
| `tests/handover-db.integration.test.ts` | Modified | Added 1 gated test for `lib/handover/queries.ts`'s `listOrderHandovers` (touched in 3C, never directly tested): each handover's `reference`, and a download link only for a stored format, never `CLIPBOARD`. |

## Documentation

| File | Change | Reason |
|---|---|---|
| `docs/milestones/ROADMAP.md` | Modified | Marked 3D done -- Milestone 3 (SAP Invoice Handover Specification) is now fully ✅ end to end. Added its change-log entry. |
| `docs/milestones/PROGRESS.md` | Modified | Added the Milestone 3D section: the coverage gap found and closed, the doc-consistency re-check (no drift found), honest verification results, and the formal write-up of session abandon/cancel as a known limitation rather than a silently-dropped item. |
| `CHANGES.md` | Modified | This section. |
| `SETUP-WINDOWS.md` | Modified | Added §18 -- how to run the two new/changed test files, and a short note consolidating "what Milestone 3 actually ships with" (and what it deliberately doesn't -- session abandon/cancel). |

# Milestone 3 completion — Changes (Warehouse Assembly Form & Partial Availability)

A follow-on completion/correction stage for Milestone 3, against a
fuller written specification. Audited 3A–3D first per that spec's own
instruction; partial availability, quantity validation, and handover
sourcing were already fully correct (nothing listed here touches them).
No files were deleted, no schema change, no new migration. See
`docs/milestones/PROGRESS.md`'s "Milestone 3 completion" section for the
full audit findings, design rationale, and honest verification results.

## `lib/` (new + modified)

| File | Change | Reason |
|---|---|---|
| `lib/picking/validation.ts` | Modified | Added `classifyAvailability()` and its `AvailabilityStatus` type -- the one shared definition of Fully/Partially/Completely-Unavailable/Pending, reused by the `/fulfilment` UI. Still a pure function, no `@prisma/client` import. |
| `lib/order-queries.ts` | Modified | `getOrderById`'s per-line select gains `product.sapItemCode`/`itemName`; the returned line objects gain `productSapItemCode`/`officialProductDescription`. Purely additive -- the three existing callers are unaffected. |
| `lib/company-info.ts` | Added | Willsgrove's name/address/tagline for a document meant to be printed on paper, mirroring `app/settings/page.tsx`'s existing (mocked) workspace identity rather than inventing new values. |
| `lib/assembly-form/resolve-line.ts` | Added | Pure three-way SAP item code/description fallback for the printed form (live product → order-time snapshot → customer's own wording) -- mirrors, rather than shares, `build-handover-rows.ts`'s equivalent logic, since that file reads from a `PickingLine`, not a plain `OrderLine`, and this round didn't want to risk modifying an already-shipped, already-tested 3C file this sandbox can't re-verify end to end. |

## UI

| File | Change | Reason |
|---|---|---|
| `app/orders/[id]/assembly-form/page.tsx` | Added | The printable Warehouse Assembly Form itself -- company ID, customer/PO/order-reference/date, a 7-column product table (SAP code, official description, requested qty, unit, blank Found, blank Unavailable) built from `getOrderById` + `resolveAssemblyFormLine`, assembler name/date/signature fields, a remarks box. Performs zero writes of any kind -- no `PickingSession` query, no mutation -- so "printing can't start picking" is structural, not just a convention. 404s for a non-existent, cancelled, or rejected order, or one with no lines. |
| `app/orders/[id]/assembly-form/print-button.tsx` | Added | The one Client Component the printable page needs -- `window.print()` has no server equivalent. `print:hidden` so the Print/Back bar never appears in the printed output itself. |
| `app/orders/[id]/page.tsx` | Modified | Adds a "Print Warehouse Assembly Form" link (opens the new route in a new tab), visible once the order has lines and isn't cancelled/rejected. |
| `app/fulfilment/[id]/picking-panel.tsx` | Modified | Adds an "Availability" column -- a colored badge per line from `classifyAvailability()`, computed off the session's own saved quantities (never an unsaved input value). |

## Tests

| File | Change | Reason |
|---|---|---|
| `tests/picking-validation.test.ts` | Modified | +6 unconditional tests for `classifyAvailability` -- the spec's own Examples A/B/C, the `PENDING` case, decimal precision, malformed input. |
| `tests/assembly-form-resolve-line.test.ts` | Added | 4 unconditional tests for `resolveAssemblyFormLine`'s three-way fallback. |
| `tests/assembly-form-db.integration.test.ts` | Added | 2 gated tests: `getOrderById`'s new fields resolve correctly against a real DB for all three match states; reading the assembly-form data repeatedly creates zero `PickingSession` rows and never changes the order's status. |
| `tests/handover-db.integration.test.ts` | Modified | +1 gated test reproducing the spec's "Example D" verbatim (five lines, mixed availability) -- classification, handover's exact expected quantities (`10`/`5`/`8`, two lines excluded), and an explicit assertion that `OrderLine.requestedQuantity` is unchanged by picking. |

## Documentation

| File | Change | Reason |
|---|---|---|
| `docs/milestones/ROADMAP.md` | Modified | Added the "3+" completion row and its change-log entry. |
| `docs/milestones/PROGRESS.md` | Modified | Added the "Milestone 3 completion" section: what was audited and found already correct, what was actually built and why, what was deliberately not touched, honest verification results, and the explicit end-to-end workflow confirmation the completion spec asks for. |
| `CHANGES.md` | Modified | This section. |
| `SETUP-WINDOWS.md` | Modified | Added §19 -- how to run the new/changed test files, and a manual browser script for printing the assembly form and confirming the new Availability badges on `/fulfilment`. |

# Milestone 4 — Changes (Lost-Sales Management)

New feature built on top of Milestones 0–3 (+completion): tracking what
the warehouse couldn't supply, what the customer decided to do about it,
and genuine, separately-confirmed lost sales, with the spec's central
rule ("never automatically classify unavailable products as lost sales")
enforced structurally. No existing file's behavior changes except the
one additive integration line into `authorizePickingSession`. See
`docs/milestones/PROGRESS.md`'s Milestone 4 section for the full
architecture assessment, design rationale, and honest verification
results (including the newly-confirmed sandbox-level reason `prisma
generate` cannot run here).

## Schema / migration

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | Modified | 5 new enums (`CustomerDecisionType`, `DecisionSource`, `UnfulfilledDemandStatus`, `LostSaleReason`, `LostSaleValueSource`) and 3 new models (`UnfulfilledDemand`, `CustomerDecisionEvent`, `LostSaleRecord`). Purely additive inverse-relation fields added to `Product`/`CustomerOrder`/`OrderLine`/`PickingSession`/`PickingLine` — no new column on any existing table. |
| `prisma/migrations/20261110180000_add_lost_sales_management/migration.sql` | Added | Hand-authored (this sandbox cannot run `prisma migrate dev`), matching the schema exactly: 5 `CREATE TYPE`, 3 `CREATE TABLE`, 11 indexes, 8 foreign keys. No existing table/column/enum value touched. |

## `lib/lost-sales/` (new module)

| File | Change | Reason |
|---|---|---|
| `lib/lost-sales/validation.ts` | Added | Pure core: decision-type/source/status/reason value lists, `WHOLE_REMAINDER_DECISION_TYPES`, zod schemas, the quantity-bucket math (`computeUndecidedQuantity`, `computeLostSaleConsumption`, `decisionTypeToBucket`), and the 6-state status derivation (`deriveUnfulfilledDemandStatus`). Imports `decimalStringSchema`/`parseScaledDecimal` from `lib/picking/validation.ts` rather than duplicating byte-identical arithmetic. |
| `lib/lost-sales/resolve-fields.ts` | Added | Pure three-way SAP-code/description resolution for the original demand and any substitute product, mirroring `lib/assembly-form/resolve-line.ts`'s established fallback order. |
| `lib/lost-sales/create-unfulfilled-demand.ts` | Added | `createUnfulfilledDemandsForSession()` — called from inside `authorizePickingSession`'s own transaction; creates one `UnfulfilledDemand` per `PickingLine` left with `unavailableQuantity > 0`, always starting at `PENDING_DECISION` with every bucket zero. |
| `lib/lost-sales/estimate-value.ts` | Added | `resolveEstimatedLostSaleValue()` — order line's own approved price first, then the customer's price list; returns `null` rather than ever inventing a figure. |
| `lib/lost-sales/record-decision.ts` | Added | `recordCustomerDecision()` — validates the quantity against whatever is undecided right now (never a stale client-supplied figure), updates the correct bucket, derives the new status, writes an audit event. No dedicated role. |
| `lib/lost-sales/confirm-lost-sale.ts` | Added | `confirmLostSale()` — the one and only path that can set `confirmedLostQuantity`, drawing first from the cancelled bucket and then from outstanding where needed. Role-agnostic itself; gated only at the route. |
| `lib/lost-sales/queries.ts` | Added | `listUnfulfilledDemands`, `getUnfulfilledDemandDetail`, `parseUnfulfilledDemandListQuery`, `getLostSalesReportSummary` — section 7's reporting figures, deliberately kept as distinct labelled numbers rather than one blended "lost sales" figure. |
| `lib/lost-sales/display.ts` | Added | Pure label/style maps for the UI, no `@prisma/client` import — safe for Client Components. |

## Integration with Milestone 3

| File | Change | Reason |
|---|---|---|
| `lib/picking/authorize-picking.ts` | Modified | One additive call, `await createUnfulfilledDemandsForSession(tx, sessionId, actorId)`, added inside the existing transaction right after the pre-existing `PICKING_SESSION_AUTHORIZED` audit event. Nothing else in this file changes. |

## API routes (new)

| File | Change | Reason |
|---|---|---|
| `app/api/lost-sales/route.ts` | Added | `GET` — list, any authenticated user. |
| `app/api/lost-sales/[id]/route.ts` | Added | `GET` — detail with full history, any authenticated user. |
| `app/api/lost-sales/[id]/decisions/route.ts` | Added | `POST` — record a customer decision. CSRF-checked, any authenticated user (no dedicated role, same as picking's start/record/complete). |
| `app/api/lost-sales/[id]/confirm-lost/route.ts` | Added | `POST` — confirm a lost sale. CSRF-checked, `SALES_MANAGER`/`ADMINISTRATOR` only via `requireUserOrResponse`. |
| `app/api/lost-sales/reports/route.ts` | Added | `GET` — section 7's reporting summary, any authenticated user. |

## UI (new)

| File | Change | Reason |
|---|---|---|
| `app/lost-sales/page.tsx` | Added | List page: 3 stat tiles, status-filter pills, a full data table, plain query-string pagination — section 6's required list. |
| `app/lost-sales/[id]/page.tsx` | Added | Detail page: identification, status badge, 7-tile quantity summary, the `DecisionPanel` client island, decision history, confirmed lost-sale records. `canConfirmLost` computed server-side and passed down as a plain boolean, never the user object. |
| `app/lost-sales/[id]/decision-panel.tsx` | Added | Client island — record-a-decision form (with debounced substitute-product search against the existing `/api/products` endpoint) and, only when `canConfirmLost`, a confirm-lost-sale form. Calls `router.refresh()` on success rather than managing local state optimistically. |
| `app/components/sidebar.tsx` | Modified | New "Lost Sales" entry under Operations (`TrendingDown` icon) linking to `/lost-sales` — added fresh, since (unlike `/fulfilment`/`/deliveries`) there was no pre-existing dead placeholder for it. |

## Tests

| File | Change | Reason |
|---|---|---|
| `tests/lost-sales-validation.test.ts` | Added | 36 unconditional tests covering every pure function in `lib/lost-sales/validation.ts` and `resolve-fields.ts` directly. All passing. |
| `tests/lost-sales-db.integration.test.ts` | Added | 8 gated tests against a real database, covering the full lifecycle end to end (creation, every decision type, substitution, outstanding-to-lost conversion, original-PO immutability, audit history, reporting). Follows this project's established DB-integration-test conventions exactly; not yet run against a real database from this sandbox — see PROGRESS.md's honest verification results. |

## Documentation

| File | Change | Reason |
|---|---|---|
| `docs/milestones/ROADMAP.md` | Modified | Added the Milestone 4 row (renumbered the previously-"4+" deferred rows to "5+"), its "never conflate" entry, and its change-log entry. |
| `docs/milestones/PROGRESS.md` | Modified | Added the full Milestone 4 section: architecture assessment, design rationale for the quantity-bucket model and every decision this milestone made, what was built, what was deliberately not touched, tests, honest verification results, and the explicit nine-step acceptance-criterion confirmation the spec's closing section asks for. |
| `CHANGES.md` | Modified | This section. |
| `SETUP-WINDOWS.md` | Modified | Added §20 — apply the new migration, regenerate the Prisma client, run the new gated test file, and a manual test script walking through recording decisions and confirming a lost sale via the UI. |

# Milestone 5 — Changes (SAP Invoice Reconciliation)

New feature built on top of Milestones 0–4: importing real SAP Business
One invoice exports (CSV), matching them to SalesFlow orders by exact
SAP item code, reconciling authorized vs. invoiced quantity per order
line (never clamped, never guessed), and a manual reconciliation
workspace for every ambiguous or exceptional case, fully audited. SAP
remains the sole system of record for invoice numbers, prices, VAT, and
totals — SalesFlow never computes or overrides any of them, only
reconciles quantities. No existing file's behavior changes except the
one real, unrelated bug fixed in the import wizard's own JSX gating
(see PROGRESS.md). See `docs/milestones/PROGRESS.md`'s Milestone 5
section for the full architecture assessment, design rationale, and
honest verification results.

## Schema / migration

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | Modified | 3 new enums (`InvoiceLineMatchStatus`, `InvoiceLineMatchMethod`, `InvoiceReconciliationStatus`) and 3 new models (`SapInvoiceImportBatch`, `SapInvoice`, `SapInvoiceLine`). Purely additive inverse-relation fields added to `User`/`Customer`/`CustomerOrder`/`OrderLine` — no new column on any existing table. |
| `prisma/migrations/20261110190000_add_invoice_reconciliation/migration.sql` | Added | Hand-authored (this sandbox cannot run `prisma migrate dev`), matching the schema exactly: 3 `CREATE TYPE`, 3 `CREATE TABLE`, 15 indexes, 8 foreign keys. No existing table/column/enum value touched. |

## `lib/invoice-reconciliation/` (new module)

| File | Change | Reason |
|---|---|---|
| `lib/invoice-reconciliation/csv.ts` | Added | Pure: target-field lists, column-mapping suggestion/validation, CSV parsing for preview and for the real apply pass, cancelled/reversed detection by keyword, grouping rows into invoices by `DocEntry` (preferred) or `DocNum`. |
| `lib/invoice-reconciliation/reconcile.ts` | Added | Pure: `computeOrderLineReconciliation()` (the four worked examples exactly, signed remainder, never clamped) and `deriveInvoiceReconciliationStatus()` (header-level status from a cancelled flag plus every line's match/over-invoicing state). |
| `lib/invoice-reconciliation/matching.ts` | Added | Pure: `matchInvoiceLineToOrder()` — exact SAP item code only, returns `null` on zero or multiple qualifying candidates rather than guessing; flags `causesOverInvoicing` when a match's quantity exceeds the candidate's remaining capacity. |
| `lib/invoice-reconciliation/match-invoice.ts` | Added | DB: batched candidate-order gathering, `runAutoMatchForInvoice()` (threads a running per-invoice quantity delta), `getAuthorizedQuantity()`/`getInvoicedQuantity()` (always read live, never stored), `recomputeInvoiceHeaderStatus()` (rebuilds the header status and `matchedOrderId` convenience field from scratch after every line-state change). |
| `lib/invoice-reconciliation/plan-import.ts` | Added | DB-querying, zero-write: `planSapInvoiceImport()` (duplicate detection against existing rows and within the same file, customer-code resolution) and `readSapInvoiceCsvUpload()` (CSV-only upload validation, documented as a deliberate scope decision). |
| `lib/invoice-reconciliation/execute-import.ts` | Added | DB, single transaction (120s/15s timeout): creates the import batch, every new invoice and its lines, then a second pass runs matching + header-status recomputation for every newly-created invoice, then one `AuditEvent` for the whole batch. |
| `lib/invoice-reconciliation/manual-actions.ts` | Added | DB: `manuallyMatchInvoiceLine`, `markInvoiceLineCannotLink`, `reopenInvoiceLineMatch`, `rerunAutoMatchForInvoice`, `setInvoiceReconciliationNote` — every one snapshots before-state, updates, recomputes the header status, and writes a full before/after `AuditEvent`. Role-agnostic by design; gated only at the route. |
| `lib/invoice-reconciliation/queries.ts` | Added | Read-only: list/detail/candidate-order-lines/import-history/reports, mirroring `lib/lost-sales/queries.ts`'s structure. `getInvoiceReconciliationReports()` buckets order lines into fully/partially/awaiting/over-invoiced plus unmatched-invoice and reconciliation-exception lists. |
| `lib/invoice-reconciliation/display.ts` | Added | Pure label/style maps for the UI, no `@prisma/client` import — safe for Client Components. |

## API routes (new)

| File | Change | Reason |
|---|---|---|
| `app/api/invoice-reconciliation/import/preview/route.ts` | Added | `POST` — two-stage stateless preview (headers+suggested mapping, or full plan with a confirmed mapping). Any authenticated user. |
| `app/api/invoice-reconciliation/import/confirm/route.ts` | Added | `POST` — CSRF-checked, double-submit guarded (`409` on a changed file), writes via `executeSapInvoiceImport`. Any authenticated user. |
| `app/api/invoice-reconciliation/route.ts` | Added | `GET` — reconciliation queue list. |
| `app/api/invoice-reconciliation/[id]/route.ts` | Added | `GET` — invoice detail with live authorized/invoiced/remaining per line. |
| `app/api/invoice-reconciliation/[id]/candidate-orders/route.ts` | Added | `GET` — outstanding authorized order lines for the invoice's matched customer, for the manual-match picker. |
| `app/api/invoice-reconciliation/[id]/note/route.ts` | Added | `POST` — invoice-level reconciliation note. `SALES_MANAGER`/`ADMINISTRATOR` only. |
| `app/api/invoice-reconciliation/[id]/rerun-match/route.ts` | Added | `POST` — re-run automatic matching for an invoice's unmatched lines. `SALES_MANAGER`/`ADMINISTRATOR` only. |
| `app/api/invoice-reconciliation/lines/[id]/match/route.ts` | Added | `POST` — manually match one line to a chosen order/order line, with a required explanation. `SALES_MANAGER`/`ADMINISTRATOR` only. |
| `app/api/invoice-reconciliation/lines/[id]/cannot-link/route.ts` | Added | `POST` — mark a line as having nothing to do with SalesFlow, with a required explanation. `SALES_MANAGER`/`ADMINISTRATOR` only. |
| `app/api/invoice-reconciliation/lines/[id]/reopen/route.ts` | Added | `POST` — reopen a previous match/cannot-link decision, with a required reason. `SALES_MANAGER`/`ADMINISTRATOR` only. |
| `app/api/invoice-reconciliation/reports/route.ts` | Added | `GET` — the reconciliation reports summary. |
| `app/api/invoice-reconciliation/import-history/route.ts` | Added | `GET` — list of past import batches. |

## UI (new)

| File | Change | Reason |
|---|---|---|
| `app/invoice-reconciliation/page.tsx` | Added | Reconciliation queue list: status filter chips, table, pagination, links to import and reports. |
| `app/invoice-reconciliation/import/page.tsx` | Added | 3-stage import wizard: read columns → confirm mapping → review plan → confirm. Fixed this round: the plan-review section (including the "Confirm and import" button) was gated so that it disappeared the instant the import started — see PROGRESS.md's "real bug found and fixed." |
| `app/invoice-reconciliation/[id]/page.tsx` | Added | Invoice detail: header fields, lines table with authorized/invoiced/remaining/status, the `ReconciliationPanel` per line (only for `SALES_MANAGER`/`ADMINISTRATOR`), and the reconciliation-note form. |
| `app/invoice-reconciliation/[id]/reconciliation-panel.tsx` | Added | Client island — per-line match/cannot-link/reopen actions, fetching candidate order lines on demand. `router.refresh()` on success, no optimistic local state. |
| `app/invoice-reconciliation/[id]/reconciliation-note-form.tsx` | Added | Client island — invoice-level note textarea + save. |
| `app/invoice-reconciliation/reports/page.tsx` | Added | Reports page: stat tiles, the four order-line buckets, unmatched-invoice and reconciliation-exception tables. |
| `app/components/sidebar.tsx` | Modified | New "Invoice Reconciliation" entry under Operations (`Receipt` icon) linking to `/invoice-reconciliation` — added fresh, since there was no pre-existing dead placeholder for it. |

## Tests

| File | Change | Reason |
|---|---|---|
| `tests/invoice-reconciliation.test.ts` | Added | 28 unconditional tests covering every pure function in `csv.ts`/`reconcile.ts`/`matching.ts` directly. All passing. One self-found test bug (header/data-row column mismatch) fixed by actually running the suite. |
| `tests/invoice-reconciliation-db.integration.test.ts` | Added | 12 gated tests against a real database, covering the full lifecycle end to end (import, matching by SAP item code, the four quantity-reconciliation worked examples, over-invoicing, ambiguous-match manual resolution with full audit history, cancelled-invoice exclusion, multi-currency, multi-order invoices, original-record immutability, reports). Follows this project's established DB-integration-test conventions exactly; not yet run against a real database from this sandbox — see PROGRESS.md's honest verification results. |

## Documentation

| File | Change | Reason |
|---|---|---|
| `docs/milestones/ROADMAP.md` | Modified | Added the Milestone 5 row (renumbered the previously-"5+" deferred rows to "6+"), its "never conflate" entries, and its change-log entry. |
| `docs/milestones/PROGRESS.md` | Modified | Added the full Milestone 5 section: architecture assessment, design rationale for every decision (derive-don't-store, running-tally matching, cancelled-invoice exclusion, CSV-only scope, date-parsing conservatism), what was built, what was deliberately not touched, the one real bug found and fixed, tests, honest verification results, and the explicit nine-step acceptance-criterion confirmation. |
| `CHANGES.md` | Modified | This section. |
| `SETUP-WINDOWS.md` | Modified | Added §21 — apply the new migration, regenerate the Prisma client, run the new gated test file, and a manual test script walking through importing a sample invoice CSV and resolving an ambiguous match via the UI. |

## Milestone 6A — Invoice Claims Management

Stage 1 of 2 of the Invoice Claims Management & Returns/Credit Notes
specification. 6B (Returns / Credit Notes) is explicitly deferred
until this stage is reviewed. See `docs/milestones/PROGRESS.md`'s
Milestone 6A section for the full architecture assessment, design
rationale, and honest verification results.

## Schema / migration

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | Modified | 5 new enums (`InvoiceClaimCategory`, `InvoiceClaimPriority`, `InvoiceClaimStatus`, `ClaimLineDisputeType`, `ClaimResolutionDecision`) and 4 new models (`InvoiceClaim`, `InvoiceClaimLine`, `ClaimResolution`, `InvoiceClaimAttachment`). Purely additive inverse-relation fields on `SapInvoice`/`SapInvoiceLine`/`CustomerOrder`/`Customer`/`User` — no new column on any existing table. |
| `prisma/migrations/20261111000000_add_invoice_claims_management/migration.sql` | Added | Hand-authored (this sandbox cannot run `prisma migrate dev`), matching the schema exactly: 5 `CREATE TYPE`, 4 `CREATE TABLE`, their indexes and foreign keys (`Restrict` on every FK into `SapInvoice`/`SapInvoiceLine`/`CustomerOrder`/`Customer`/`User`). No existing table/column/enum value touched. |

## `lib/invoice-claims/` (new module)

| File | Change | Reason |
|---|---|---|
| `lib/invoice-claims/validation.ts` | Added | Pure: the 5 fixed enums, the exhaustive `CLAIM_STATUS_TRANSITIONS` adjacency graph, `validateClaimStatusTransition()`, `isConcludedStatus()`, the exhaustive `resolutionDecisionToClaimStatus()` mapping, quantity/amount validators, zod schemas. No `@prisma/client` import. |
| `lib/invoice-claims/queries.ts` | Added | DB, read-only: `getAlreadyClaimedQuantity`/`getAlreadyClaimedTotal` (live aggregates, never a stored running total), `listInvoiceClaims`, `getClaimDetail`, `listClaimLinesForInvoiceLine`. |
| `lib/invoice-claims/create-claim.ts` | Added | DB: `generateClaimReference()` and `createInvoiceClaim()` — validates invoice/customer/order/assignee existence and every line's quantities/amount both before and inside the transaction (race-safety), creates the claim + lines, batch-fills display snapshots, audits. |
| `lib/invoice-claims/claim-lifecycle.ts` | Added | DB: `changeClaimStatus()` — validates the transition, inline-checks the actor's role only when the specific transition requires approval, sets `resolvedAt`/`closedAt`, audits. |
| `lib/invoice-claims/claim-resolution.ts` | Added | DB: `recordClaimResolution`, `approveClaimResolution`, `rejectClaimResolution` — append-only resolution history, defensive re-validation of the transition even though the route layer already gates approval/reject by role, each audited. |
| `lib/invoice-claims/attachments.ts` | Added | DB + storage: `uploadClaimAttachment()` (content-sniffed, storage-cleanup on any DB-write failure) and `getClaimAttachmentForDownload()`, reusing the existing storage driver and content-sniffing helpers unchanged. |
| `lib/invoice-claims/display.ts` | Added | Pure label/style maps, no `@prisma/client` import — safe for Client Components. |
| `lib/invoice-claims/financial.ts` | Added | Pure/DB mix: `computeClaimLineDisputedValue()` (always from the real SAP `unitPrice`, never the customer's claimed price), `computeClaimFinancialSummary()` (six structurally distinct exposure figures, `actualSapCreditedAmount` always `null` this stage), `computeExposureByCurrency()` (never converts). |
| `lib/invoice-claims/dashboard.ts` | Added | DB: `getInvoiceClaimsDashboard()` — status/category/priority/customer/product/department breakdowns, average resolution time, repeat-complaint customers, exposure by currency. |

## API routes (new)

| File | Change | Reason |
|---|---|---|
| `app/api/invoice-claims/route.ts` | Added | `GET` list + `POST` create. Any authenticated user. |
| `app/api/invoice-claims/[id]/route.ts` | Added | `GET` — claim detail + financial summary. |
| `app/api/invoice-claims/[id]/status/route.ts` | Added | `POST` — change status. Open to any authenticated user; role checked inline only for transitions that require approval. |
| `app/api/invoice-claims/[id]/resolutions/route.ts` | Added | `POST` — record a resolution. Any authenticated user. |
| `app/api/invoice-claims/[id]/resolutions/[resolutionId]/approve/route.ts` | Added | `POST` — approve a resolution. `SALES_MANAGER`/`ADMINISTRATOR` only. |
| `app/api/invoice-claims/[id]/resolutions/[resolutionId]/reject/route.ts` | Added | `POST` — reject a resolution. `SALES_MANAGER`/`ADMINISTRATOR` only. |
| `app/api/invoice-claims/[id]/attachments/route.ts` | Added | `POST` — multipart attachment upload. Any authenticated user. |
| `app/api/invoice-claims/attachments/[id]/route.ts` | Added | `GET` — attachment download. Dedicated route, not folded into `app/api/files/[id]/route.ts`. |
| `app/api/invoice-claims/dashboard/route.ts` | Added | `GET` — the dashboard summary. |

## UI (new)

| File | Change | Reason |
|---|---|---|
| `app/invoice-claims/page.tsx` | Added | Claims queue: status filter pills, search, pagination, customer drill-down from the dashboard. |
| `app/invoice-claims/new/page.tsx` | Added | Server shell + auth check for claim creation. |
| `app/invoice-claims/new/new-claim-form.tsx` | Added | Client island: invoice search, line selection with per-line dispute-type toggle, customer resolution, category/priority/assignee/communication notes, submits to `/api/invoice-claims`. |
| `app/invoice-claims/[id]/page.tsx` | Added | Claim detail: header, financial-exposure metrics, disputed-lines table, attachments, append-only resolution history with a 6B-follow-up hint. |
| `app/invoice-claims/[id]/claim-actions-panel.tsx` | Added | Client island: change-status, record-resolution, approve/reject, attachment upload. |
| `app/invoice-claims/dashboard/page.tsx` | Added | Status/category/customer/product/department breakdowns, exposure-by-currency table, average resolution time, repeat complaints. |
| `app/components/sidebar.tsx` | Modified | New "Invoice Claims" entry under Operations (`FileWarning` icon) linking to `/invoice-claims` — added fresh, no pre-existing dead placeholder for it. |

## Other changes

| File | Change | Reason |
|---|---|---|
| `lib/invoice-reconciliation/queries.ts` | Modified | Added an optional `search` parameter to `listSapInvoices()` (filters `sapDocNum`/`customerName`/`matchedCustomer.name`, case-insensitive) — a small, backward-compatible extension needed directly by the claim-creation form's invoice picker, not unrelated refactoring. |
| `scripts/remove-demo-data.ts` | Modified | New leaves-first deletion block (`InvoiceClaimAttachment` → `ClaimResolution` → `InvoiceClaimLine` → `InvoiceClaim`) inserted before the existing SAP-invoice deletion block, since the new tables' `Restrict` FKs would otherwise block demo-data cleanup. |

## Tests

| File | Change | Reason |
|---|---|---|
| `tests/invoice-claims.test.ts` | Added | 26 unconditional tests covering every pure function in `validation.ts` directly — including the test that caught a real transition-graph bug (`AWAITING_INTERNAL_ACTION` was missing `"RESOLVED"`), fixed before delivery. All passing. |
| `tests/invoice-claims-db.integration.test.ts` | Added | 6 gated tests against a real database: claim creation + quantity dispute, live-aggregate rejection of a second claim once a line's remaining quantity is exhausted, amount-only dispute, full resolution lifecycle (record → reject → record → approve), direct transition-graph enforcement, and a financial summary confirming the actual-SAP-credited figure stays `null`/unavailable. Follows this project's established DB-integration-test conventions exactly; not yet run against a real database from this sandbox — see PROGRESS.md's honest verification results. |

## Documentation

| File | Change | Reason |
|---|---|---|
| `docs/milestones/ROADMAP.md` | Modified | Marked Milestone 6 (Invoice Claims Management) in progress / its 6A stage done, added its "never conflate" entry, and its change-log entry. |
| `docs/milestones/PROGRESS.md` | Modified | Added the full Milestone 6A section: architecture assessment, design rationale (recommendation-vs-executed-action, the exhaustive transition graph, live already-claimed aggregates, append-only resolutions, snapshot-vs-live, six-figure financial exposure), what was built, what was deliberately not touched (the 6B boundary), the one real bug found and fixed, tests, honest verification results, and acceptance-criterion confirmation. |
| `CHANGES.md` | Modified | This section. |
| `SETUP-WINDOWS.md` | Modified | Added §22 — apply the new migration, regenerate the Prisma client, run the new gated test file, and a manual test script walking through filing a claim and taking it through resolution via the UI. |

## Milestone 6B — Returns & Credit Notes

Stage 2 of 2 of the Invoice Claims Management & Returns/Credit Notes
specification, built per your own explicit instruction to start it
without waiting for a separate review round on 6A. See
`docs/milestones/PROGRESS.md`'s Milestone 6B section for the full
design rationale and honest verification results.

## Schema / migration

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | Modified | 2 new enums (`ReturnCondition`, `CreditNoteMatchStatus`) and 3 new models (`ClaimReturn`, `CreditNote`, `CreditNoteImportBatch`). Reuses `InvoiceLineMatchMethod` (Milestone 5) as-is for `CreditNote.matchMethod`. Purely additive inverse-relation fields on `User`/`SapInvoice`/`InvoiceClaim`/`InvoiceClaimLine` — no new column on any existing table. |
| `prisma/migrations/20261111120000_add_returns_credit_notes/migration.sql` | Added | Hand-authored (this sandbox cannot run `prisma migrate dev`), matching the schema exactly: 2 `CREATE TYPE`, 3 `CREATE TABLE`, their indexes and foreign keys (`Restrict` on every FK into `User`/`SapInvoice`/`InvoiceClaim`/`InvoiceClaimLine`/`CreditNote`). No existing table/column/enum value touched. |

## `lib/returns-credits/` (new module)

| File | Change | Reason |
|---|---|---|
| `lib/returns-credits/validation.ts` | Added | Pure: `ReturnCondition`/`CreditNoteMatchStatus` enums, `returnConditionRequiresDetail()`, zod input schemas. No `@prisma/client` import. |
| `lib/returns-credits/status-recompute.ts` | Added | Pure: `determineAutoAdvanceTarget()` — the full decision matrix for auto-advancing a claim's status once an actual return/credit note is recorded, covering all four credit-bearing/return decision shapes. Two dead, impossible comparisons (`TS2367`) caught and fixed via `tsc` before delivery. No `@prisma/client` import, unit-testable in isolation. |
| `lib/returns-credits/apply-status-recompute.ts` | Added | DB: `recomputeClaimStatusAfterActuals()` — gathers live inputs (latest approved resolution, live credit-note sum, received-return count), calls the pure decision function, then defensively re-validates against `validateClaimStatusTransition()` before writing (throwing, not silently skipping, on an impossible edge) and delegates the actual write to 6A's `applyValidatedClaimStatusChange()`. |
| `lib/returns-credits/matching.ts` | Added | Pure: `matchCreditNoteToClaim()` — conservative claim-level matching (exactly one qualifying candidate or `null`, never a guess), mirroring `lib/invoice-reconciliation/matching.ts`'s own philosophy. No `@prisma/client` import. |
| `lib/returns-credits/match-credit-note.ts` | Added | DB: `runAutoMatchForCreditNote()` — gathers candidate claims against a credit note's resolved base invoice (each with its own live actual-credited total), calls the pure matcher, writes the match and recomputes the newly-linked claim's status. |
| `lib/returns-credits/csv.ts` | Added | Pure: SAP credit-note CSV column mapping (`CREDIT_NOTE_TARGET_FIELDS`, suggestion patterns), preview parsing, row validation (only `docNum`/`amount` required), and grouping of flattened export rows into one credit note per document (header-level `amount` taken from the first row only, never summed). |
| `lib/returns-credits/plan-import.ts` | Added | DB, read-only: `readCreditNoteCsvUpload()`, `planCreditNoteImport()` — chunked dedupe lookup against existing `CreditNote` rows and chunked base-invoice resolution against already-imported `SapInvoice` rows, never writing anything. |
| `lib/returns-credits/execute-import.ts` | Added | DB, transactional: `executeCreditNoteImport()` — creates every planned `CreditNote` row, then a second pass auto-matching each against its candidate claims, audited. |
| `lib/returns-credits/returns.ts` | Added | DB: `generateReturnReference()`/`recordClaimReturn()` — gated on the claim already having an approved resolution, validates condition/quantity, creates the `ClaimReturn` row, audits, and triggers the status recompute. Role-agnostic by design (any authenticated user). |
| `lib/returns-credits/credit-notes.ts` | Added | DB: `recordCreditNoteManually()`, `manuallyMatchCreditNote()`, `markCreditNoteCannotLink()`, `reopenCreditNoteMatch()` — the manual single-record entry path and the manual-reconciliation actions for an imported credit note. Role-agnostic at the lib layer; `SALES_MANAGER`/`ADMINISTRATOR`-only enforcement lives entirely in the route layer. |
| `lib/returns-credits/display.ts` | Added | Pure label/style maps for `ReturnCondition`/`CreditNoteMatchStatus`, no `@prisma/client` import — safe for Client Components. |
| `lib/returns-credits/queries.ts` | Added | DB, read-only: `listClaimReturns`, `listCreditNotesForClaim`, `listCreditNotes` (the reconciliation queue, paginated/filterable), `getCreditNoteDetail`, `listClaimsForInvoice` (the full, unfiltered candidate set for the manual-match picker), `listCreditNoteImportBatches`. |

## API routes (new)

| File | Change | Reason |
|---|---|---|
| `app/api/invoice-claims/[id]/returns/route.ts` | Added | `GET` list + `POST` record a physical return. Any authenticated user. |
| `app/api/invoice-claims/[id]/credit-notes/route.ts` | Added | `GET` list (any user) + `POST` record a credit note manually (`SALES_MANAGER`/`ADMINISTRATOR` only). The claim id always comes from the URL, never the body — any `claimId` in the request body is overwritten before validation. |
| `app/api/returns-credits/import/preview/route.ts` | Added | `POST` — two-stage stateless preview (headers, then plan). `SALES_MANAGER`/`ADMINISTRATOR` only. |
| `app/api/returns-credits/import/confirm/route.ts` | Added | `POST` — re-plans and writes, with a double-submit guard comparing the fresh plan's counts against the operator's confirmed preview. `SALES_MANAGER`/`ADMINISTRATOR` only. |
| `app/api/returns-credits/import-history/route.ts` | Added | `GET` — past import batches. Any authenticated user. |
| `app/api/returns-credits/credit-notes/route.ts` | Added | `GET` — the reconciliation queue, filterable. Any authenticated user. |
| `app/api/returns-credits/credit-notes/[id]/route.ts` | Added | `GET` — one credit note's detail. Any authenticated user. |
| `app/api/returns-credits/credit-notes/[id]/candidate-claims/route.ts` | Added | `GET` — every claim against the credit note's resolved base invoice, for the manual-match picker. Any authenticated user. |
| `app/api/returns-credits/credit-notes/[id]/match/route.ts` | Added | `POST` — manual match to a claim. `SALES_MANAGER`/`ADMINISTRATOR` only. |
| `app/api/returns-credits/credit-notes/[id]/cannot-link/route.ts` | Added | `POST` — mark unlinkable. `SALES_MANAGER`/`ADMINISTRATOR` only. |
| `app/api/returns-credits/credit-notes/[id]/reopen/route.ts` | Added | `POST` — reopen back to `UNMATCHED`. `SALES_MANAGER`/`ADMINISTRATOR` only. |

## UI (new)

| File | Change | Reason |
|---|---|---|
| `app/returns-credits/page.tsx` | Added | The credit-note reconciliation queue: match-status filter pills, paginated table, links to the import wizard and import history. |
| `app/returns-credits/[id]/page.tsx` | Added | One credit note's detail, with a `CreditNotePanel` action island for match/cannot-link/reopen. |
| `app/returns-credits/[id]/credit-note-panel.tsx` | Added | Client island: manual match (loads candidate claims), cannot-link, reopen. |
| `app/returns-credits/import/page.tsx` | Added | The 3-stage SAP credit-note CSV import wizard (upload → map columns → validate/preview → confirm), mirroring `app/invoice-reconciliation/import/page.tsx`'s own shape. |
| `app/returns-credits/import-history/page.tsx` | Added | Read-only list of past import batches. |
| `app/invoice-claims/[id]/returns-credits-panel.tsx` | Added | Client island on the claim detail page: record-physical-return (any user) and record-credit-note-manually (`SALES_MANAGER`/`ADMINISTRATOR`, re-enforced server-side) forms. |
| `app/invoice-claims/[id]/page.tsx` | Modified | New "Physical returns" and "Credit notes" read-only sections; the financial-exposure grid now shows a live "Actual SAP credited" figure and a new "Credit shortfall" metric in place of 6A's static "Pending Milestone 6B" placeholder; `ReturnsCreditsPanel` wired in above `ClaimActionsPanel`. |
| `app/components/sidebar.tsx` | Modified | New "Returns & Credits" entry under Operations (`Undo2` icon) linking to `/returns-credits` — added fresh, no pre-existing dead placeholder for it. |

## Other changes

| File | Change | Reason |
|---|---|---|
| `lib/invoice-claims/financial.ts` | Modified | `actualSapCreditedAmount` is now a live sum of real `CreditNote.amount` rows (no longer 6A's placeholder `null`), `actualCreditDataAvailable` is now always `true`; added `actualCreditShortfall` and `actualExceedsApproved` (flags, never clamps, SAP crediting more than was approved), and `CurrencyExposureBucket` gained the same live `actualSapCreditedAmount` roll-up. |
| `scripts/remove-demo-data.ts` | Modified | New leaves-first deletion block (`ClaimReturn` → `CreditNote` → `CreditNoteImportBatch`) inserted before the existing Milestone 6A deletion block, since the new tables' `Restrict` FKs would otherwise block demo-data cleanup; their counts added to the audit event and the summary output. |

## Tests

| File | Change | Reason |
|---|---|---|
| `tests/returns-credits.test.ts` | Added | 42 unconditional tests: the full `determineAutoAdvanceTarget()` decision matrix (every decision shape, every current-status guard, the never-escalate-partial and never-clamp-the-excess rules), `matchCreditNoteToClaim()`'s ambiguous/exact-match/no-remaining-exposure cases, and the CSV column-mapping/validation/grouping logic. All passing. |
| `tests/returns-credits-db.integration.test.ts` | Added | 8 gated tests against a real database, driving claims to `APPROVED` through the real Milestone 6A lifecycle rather than writing status by hand: physical-return auto-resolution; full-credit auto-resolution with the financial summary checked; partial-credit never escalating to resolved; an over-credit flagged, never clamped; CSV import auto-matching the single outstanding candidate; CSV import landing `UNMATCHED` on an ambiguous (two-qualifying-claim) case; a full manual match/cannot-link/reopen cycle; and both `recordClaimReturn`/`recordCreditNoteManually` refusing to act on a claim with no approved resolution. Follows this project's established DB-integration-test conventions exactly; not yet run against a real database from this sandbox — see PROGRESS.md's honest verification results. |
| `tests/invoice-claims-db.integration.test.ts` | Modified | Updated one 6A test's assertions: `actualSapCreditedAmount`/`actualCreditDataAvailable` are no longer asserted `null`/`false` (that was 6A's honest placeholder, now intentionally superseded by 6B) — now asserts the live `"0.0000"`/`true`/`"0.0000"`/`false` values for a claim with no credit note recorded yet. |

## Documentation

| File | Change | Reason |
|---|---|---|
| `docs/milestones/ROADMAP.md` | Modified | Marked Milestone 6B (Returns & Credit Notes) done, added two new "never conflate" entries (approved-vs-actual-credited amount; the status auto-advance ratchet), and its change-log entry. |
| `docs/milestones/PROGRESS.md` | Modified | Added the full Milestone 6B section: design rationale (recording vs. executing in SAP, the auto-advance ratchet, claim-level matching granularity, manual entry + CSV import), what was built, honest verification results, and acceptance-criterion confirmation. |
| `CHANGES.md` | Modified | This section. |
| `SETUP-WINDOWS.md` | Modified | Added §23 — apply the new migration, regenerate the Prisma client, run the new gated test file, and a manual test script walking through recording a return/credit note, the CSV import wizard, and manual reconciliation via the UI. |

## Milestone 7 — Quotations Management

Built from your attached full specification (15 numbered sections) in
one pass. See `docs/milestones/PROGRESS.md`'s Milestone 7 section for
the full design rationale, known UI limitation, and honest verification
results.

## Schema / migration

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | Modified | 2 new enums (`QuotationStatus`, `QuotationEventType`), 3 new models (`Quotation`, `QuotationLine`, `QuotationEvent`), and one new value (`QUOTATION`) added to the existing `OrderSource` enum. Purely additive inverse-relation fields on `User`/`Customer`/`CustomerContact`/`Product`/`CustomerOrder` — no new column on any existing table besides the one enum value. |
| `prisma/migrations/20261111150000_add_quotations_management/migration.sql` | Added | Hand-authored (this sandbox cannot run `prisma migrate dev`), matching the schema exactly: 1 `ALTER TYPE ... ADD VALUE`, 2 `CREATE TYPE`, 3 `CREATE TABLE`, their indexes and foreign keys (`Restrict` on every FK into `Customer`/`User`/`Quotation`/`CustomerOrder`, `SetNull` on `customerContactId`/`productId`). No existing table/column/enum value removed or changed. |

## `lib/quotations/` (new module)

| File | Change | Reason |
|---|---|---|
| `lib/quotations/validation.ts` | Added | Pure: the 6-status `QUOTATION_STATUS_TRANSITIONS` adjacency graph, `validateQuotationStatusTransition()`, `isTerminalQuotationStatus`/`isRevisableStatus`/`isConvertibleStatus`/`isEditableStatus`, `validatePositiveQuantity`/`validateValidityWindow`/`isEligibleForExpiry`, `percentStringSchema`, and every zod input schema. No `@prisma/client` import. |
| `lib/quotations/calculations.ts` | Added | `server-only`, DB-adjacent: `computeQuotationLineAmounts()`/`computeQuotationTotals()` — exact `Prisma.Decimal` arithmetic, discount applied before VAT, quotation totals defined as the straight sum of already-rounded line amounts. |
| `lib/quotations/create.ts` | Added | DB: `generateQuotationNumber()`, `resolveQuotationLines()` (shared with `edit.ts` — validates/snapshots/calculates every line identically whichever module calls it), `createQuotation()` with reference-collision retry. |
| `lib/quotations/edit.ts` | Added | DB: `updateQuotationHeader`, `updateQuotationFollowUp` (deliberately not DRAFT-gated — follow-up scheduling stays meaningful on an ISSUED quotation awaiting a response), `addQuotationLine`/`updateQuotationLine`/`removeQuotationLine` (each recomputing and storing the quotation's totals). Every function but the follow-up one hard-blocks on any status other than DRAFT. |
| `lib/quotations/issue.ts` | Added | DB: `issueQuotation()` — validates the transition and that at least one line exists. |
| `lib/quotations/respond.ts` | Added | DB: `respondToQuotation()` — records the customer's ACCEPTED/REJECTED decision as a fact; never creates a `CustomerOrder` as a side effect. |
| `lib/quotations/cancel.ts` | Added | DB: `cancelQuotation()` — validates the transition, then reads `convertedOrderId` directly to block cancelling an already-converted quotation (a data-fact check the transition graph itself can't express). |
| `lib/quotations/revise.ts` | Added | DB: `reviseQuotation()` — copies header+lines byte-for-byte into a new DRAFT row, supersedes the original in the same transaction. |
| `lib/quotations/convert-to-order.ts` | Added | DB: `convertQuotationToOrder()` — reuses `lib/orders.ts`'s `createOrderCore` directly; doubly guarded against duplicate orders (an app-level `convertedOrderId` pre-check plus a `QUO-CONVERT-<id>` idempotency key), both the order and the quotation's own link written in one transaction. |
| `lib/quotations/expiry.ts` | Added | DB: `expireQuotation()` (one quotation, audited) and `sweepExpiredQuotations()` (every eligible `ISSUED` quotation system-wide, called by `scripts/expire-quotations.ts`) — both call the same `isEligibleForExpiry()` check, so neither can drift from the other. |
| `lib/quotations/display.ts` | Added | Pure label/style maps for `QuotationStatus`/`QuotationEventType`, no `@prisma/client` import — safe for Client Components. |
| `lib/quotations/queries.ts` | Added | DB, read-only: `listQuotations` (excludes `supersededAt: { not: null }` by default), `getQuotationById`, `listQuotationRevisions`/`getQuotationRevisionHistory` (resolves from either the root or any later revision's id), `getQuotationDashboardCounts` (value-by-status grouped by currency, never summed across currencies). |

## API routes (new)

| File | Change | Reason |
|---|---|---|
| `app/api/quotations/route.ts` | Added | `GET` list + `POST` create. Any authenticated user. |
| `app/api/quotations/dashboard/route.ts` | Added | `GET` — dashboard counts. |
| `app/api/quotations/[id]/route.ts` | Added | `GET` detail + `PATCH` header edit (DRAFT-only, enforced in the lib layer). |
| `app/api/quotations/[id]/lines/route.ts` | Added | `POST` — add a line (DRAFT-only). |
| `app/api/quotations/[id]/lines/[lineId]/route.ts` | Added | `PATCH` update / `DELETE` remove a line (DRAFT-only). |
| `app/api/quotations/[id]/follow-up/route.ts` | Added | `PATCH` — follow-up date/notes. Deliberately separate from the header-edit route; not DRAFT-gated. |
| `app/api/quotations/[id]/issue/route.ts` | Added | `POST` — issue to the customer. |
| `app/api/quotations/[id]/respond/route.ts` | Added | `POST` — record the customer's accept/reject decision. |
| `app/api/quotations/[id]/cancel/route.ts` | Added | `POST` — cancel, with a required reason. |
| `app/api/quotations/[id]/revise/route.ts` | Added | `POST` — create a new revision, returns its id/number. |
| `app/api/quotations/[id]/convert-to-order/route.ts` | Added | `POST` — convert into a real order, returns the order id/reference and whether it was already converted. |
| `app/api/quotations/[id]/expire/route.ts` | Added | `POST` — the manual per-quotation counterpart to the scheduled sweep script. |
| `app/api/quotations/[id]/revisions/route.ts` | Added | `GET` — the full revision history for this quotation's lineage. |
| Every route above | — | `requireUserOrResponse()` with no role array — same tier as order creation; `verifyCsrfOrigin` on every mutating route; `isValidId` on every path param. |

## UI (new)

| File | Change | Reason |
|---|---|---|
| `app/quotations/page.tsx` | Added | Dashboard + paginated list: summary cards (fetched once, not re-fetched per filter), status tabs, debounced search, salesperson/currency/date filters, a value-by-status-and-currency card never summed across currencies or labelled revenue. |
| `app/quotations/new/page.tsx` | Added | Server shell + auth check for quotation creation. |
| `app/quotations/new/new-quotation-form.tsx` | Added | Client island: customer search, header fields, a per-line builder toggling between SAP-catalogue product search and a free-text unlisted-item description. Uses a module-level line-key counter rather than `crypto.randomUUID()` to avoid Next 16's Cache Components prerendering restriction (same fix `app/orders/new/page.tsx` already uses). |
| `app/quotations/[id]/page.tsx` | Added | Detail page: fields grid, superseded/eligible-for-expiry banners, lines table with totals, customer-response/cancellation sections, revision-history list, event-history timeline, renders `QuotationActionsPanel`. |
| `app/quotations/[id]/quotation-actions-panel.tsx` | Added | Client island: DRAFT line add/edit/remove, issue, record response, cancel, revise, convert-to-order, manual expire, follow-up scheduling — each gated by the quotation's own status/`isSuperseded`/`hasConvertedOrder` props, `router.refresh()` after every successful mutation. |
| `app/quotations/[id]/print/page.tsx` | Added | The printable quotation document: zero-write Server Component, A4 print CSS, company identity from `lib/company-info.ts` — mirrors `/orders/[id]/assembly-form` exactly. A cautionary banner shows for any non-current (DRAFT/CANCELLED/REJECTED/EXPIRED/superseded) status rather than hiding the page outright. |
| `app/quotations/[id]/print/print-actions.tsx` | Added | The print page's one client island (`window.print()`), `print:hidden` so it never appears in the printed output. |
| `app/components/sidebar.tsx` | Modified | New "Quotations" entry in the WORKSPACE section, next to "PO Intake" — a quotation is the pre-order sales step, not an operational/fulfilment concern. |

## Other changes

| File | Change | Reason |
|---|---|---|
| `scripts/expire-quotations.ts` | Added | One-command script calling `sweepExpiredQuotations()`, mirroring `scripts/remove-demo-data.ts`'s own `main()`/`.catch()`/`.finally()` shape — meant to be run on a real schedule (Windows Task Scheduler/cron; see SETUP-WINDOWS.md §24). |
| `package.json` | Modified | Added the `quotations:expire` script entry. |
| `scripts/remove-demo-data.ts` | Modified | New deletion block (`QuotationEvent` → `QuotationLine` → `Quotation`) inserted at the very start of the transaction, before the existing `CustomerOrder` deletion block — `Quotation.convertedOrderId` is a `Restrict` FK onto `CustomerOrder`, so this group must run first; their counts added to the audit event and the summary output. |

## Tests

| File | Change | Reason |
|---|---|---|
| `tests/quotations.test.ts` | Added | 78 unconditional tests: the full 6×6 status-transition matrix, every terminal/revisable/convertible/editable predicate, quantity/validity-window/expiry-eligibility checks, and every zod schema's accept/reject boundary (including the catalogued-vs-unlisted XOR). All passing. |
| `tests/quotations-db.integration.test.ts` | Added | 13 gated tests against a real database, building its own `Product`/`TaxCode` fixtures: decimal-exact totals on create (hand-verified figures, discount before VAT); rejection of an unlisted line with no description and a catalogued line against an unknown product; every DRAFT line-edit path recomputing totals, then blocked once issued; issuing refused with zero lines or twice; accept/reject responses (confirming ACCEPTED never creates an order); cancellation allowed until converted, then blocked; a full convert-to-order cycle confirmed idempotent on repeat; a full revision cycle (new DRAFT row, old row frozen and excluded from default listings, re-revision blocked both ways); revision-history resolution from either the root or a later revision's id; manual expire + the system-wide sweep, each leaving a still-valid quotation untouched; and the dual-write `QuotationEvent`/`AuditEvent` trail. Follows this project's established DB-integration-test conventions exactly; not yet run against a real database from this sandbox — see PROGRESS.md's honest verification results. |

## Documentation

| File | Change | Reason |
|---|---|---|
| `docs/milestones/ROADMAP.md` | Modified | Added Milestone 7's row, a "never conflate" entry (a quotation vs. the order it may eventually become), and its change-log entry. |
| `docs/milestones/PROGRESS.md` | Modified | Added the full Milestone 7 section: design rationale (no 7th status, revision-as-new-row, no automatic pricing approval, live-computed expiry, doubly-guarded idempotent conversion, catalogued-vs-unlisted structural distinction, no new RBAC role, print-ready HTML in place of a PDF), what was built, the known UI limitation, honest verification results, and acceptance-criterion confirmation. |
| `CHANGES.md` | Modified | This section. |
| `SETUP-WINDOWS.md` | Modified | Added §24 — apply the new migration, regenerate the Prisma client, run the new gated test file, set up the scheduled expiry script, and a manual test script walking through the full create→issue→respond→revise→convert lifecycle via the UI. |

## Milestone 8 — Validation and Approvals

Built from your attached full specification (14 numbered sections) in
one pass. Customer-PO/order-value approval is framework-ready only —
by your explicit instruction — with no live gate wired into order
creation. See `docs/milestones/PROGRESS.md`'s Milestone 8 section for
the full design rationale and honest verification results.

## Schema / migration

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | Modified | 2 new enums (`ApprovalRequestStatus`-adjacent types, `NotificationType`), 4 new models (`ApprovalPolicy`, `ApprovalRequest`, `ApprovalEvent`, `Notification`), and new inverse-relation fields on `User`/`Quotation`/`CustomerOrder`. No existing column changed type or became non-nullable. |
| `prisma/migrations/<timestamp>_add_validation_and_approvals/migration.sql` | Added | Hand-authored (this sandbox cannot run `prisma migrate dev`), matching the schema exactly: new enum types, 4 `CREATE TABLE`s, their indexes and foreign keys (`Restrict` on `ApprovalRequest.quotationId`/`customerOrderId`/`previousRequestId` and on `ApprovalEvent.approvalRequestId`, `SetNull` on `ApprovalRequest.policyId`, `Cascade` on `Notification.userId`). No existing table/column/enum value removed or changed. |

## `lib/approvals/` and `lib/notifications/` (new modules)

| File | Change | Reason |
|---|---|---|
| `lib/approvals/validation.ts` | Added | Pure: the 6-status transition matrix, every zod input schema, threshold evaluation (most-restrictive-wins across overlapping active policies), self-approval/role-eligibility predicates, submitted-values snapshot matching. No `@prisma/client` import. |
| `lib/approvals/policies.ts` | Added | `server-only`, DB: `createApprovalPolicy`/`updateApprovalPolicy`, both audited. |
| `lib/approvals/policy-queries.ts` | Added | DB, read-only: `listApprovalPolicies`, `getApprovalPolicyById`, `ENFORCED_ACTION_TYPES` (currently only `QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD` — the UI's "Not yet enforced" badge is driven directly from this set). |
| `lib/approvals/requests.ts` | Added | DB: `approveApprovalRequest`/`rejectApprovalRequest`/`withdrawApprovalRequest`/`cancelApprovalRequest` — every one an atomic `updateMany({ where: { id, status: "PENDING" } })` race guard, eligible-approver/blocked-decider checks, `ApprovalEvent` + `AuditEvent` + notification on every decision. |
| `lib/approvals/queries.ts` | Added | DB, read-only: `listApprovalRequests` (status/module/mine filters), `getApprovalRequestById`, `getApprovalDashboard` (pending/awaiting-my-decision/submitted-by-me/overdue/approved/avg-turnaround counters), `getLiveApprovalRequestForQuotation` (drives the quotation-detail banner). |
| `lib/approvals/quotation-gate.ts` | Added | DB: `checkAndRequireQuotationApproval` (the one mandatory integration point — called from `issueQuotation`), `invalidateStaleApprovalRequests` (called from every DRAFT line-edit function so a discount change can both auto-clear a now-unnecessary pending request and trigger a fresh one), `buildSnapshot`. |
| `lib/approvals/display.ts` | Added | Pure label/style maps for `ApprovalRequestStatus`/`ApprovalModule`/`ApprovalActionType`, no `@prisma/client` import — safe for Client Components. |
| `lib/notifications/create.ts` | Added | DB: fires on submit (to every eligible approver)/approve/reject/withdraw (to the requester). |
| `lib/notifications/queries.ts` | Added | DB, read-only: `listNotificationsForUser`, `getUnreadNotificationCount`. |
| `lib/notifications/mark-read.ts` | Added | DB: `markNotificationRead` (ownership-checked), `markAllNotificationsRead`. |

## API routes (new)

| File | Change | Reason |
|---|---|---|
| `app/api/approvals/route.ts` | Added | `GET` — list, with status/module/mine filters. |
| `app/api/approvals/[id]/route.ts` | Added | `GET` — detail, including submitted-values snapshot and event history. |
| `app/api/approvals/[id]/approve/route.ts` | Added | `POST` — approve, role-gated to the policy's eligible approver roles. |
| `app/api/approvals/[id]/reject/route.ts` | Added | `POST` — reject, mandatory reason. |
| `app/api/approvals/[id]/withdraw/route.ts` | Added | `POST` — requester-only. |
| `app/api/approvals/[id]/cancel/route.ts` | Added | `POST` — `ADMINISTRATOR`-only. |
| `app/api/approval-policies/route.ts` | Added | `GET` list + `POST` create, `SALES_MANAGER`/`ADMINISTRATOR` only. |
| `app/api/approval-policies/[id]/route.ts` | Added | `GET` single + `PATCH` update, same role gate. |
| `app/api/notifications/route.ts` | Added | `GET` — the caller's own feed + unread count, no role restriction. |
| `app/api/notifications/[id]/read/route.ts` | Added | `POST` — mark one read, ownership enforced in the lib layer. |
| `app/api/notifications/mark-all-read/route.ts` | Added | `POST` — mark all read for the caller. |
| Every route above | — | `requireUserOrResponse()` (with a role array where noted); `verifyCsrfOrigin` on every mutating route; `isValidId` on every path param; body parsing via the project's own `readJsonObject` convention. |

## UI (new)

| File | Change | Reason |
|---|---|---|
| `app/approvals/page.tsx` | Added | List + dashboard: All/Pending-my-decision/Submitted-by-me tabs, status/module filter chips, summary counters row. |
| `app/approvals/[id]/page.tsx` | Added | Detail: submitted-values-vs-current-values comparison table (changed fields highlighted), full event history, renders `ApprovalActionsPanel`. |
| `app/approvals/[id]/approval-actions-panel.tsx` | Added | Client island: Approve/Reject/Withdraw/Cancel, each gated by the viewer's actual eligibility, inline reason textarea, `router.refresh()` after a successful decision. |
| `app/approvals/policies/page.tsx` | Added | `SALES_MANAGER`/`ADMINISTRATOR`-only policy CRUD, redirects everyone else to `/approvals`. |
| `app/approvals/policies/policies-panel.tsx` | Added | Client island: create/edit form, policy list with active/inactive toggle and an explicit "Not yet enforced" badge on `ORDER_VALUE_EXCEEDS_THRESHOLD` policies. |
| `app/components/notification-bell.tsx` | Added | Client island in the sidebar footer: 30-second unread-count poll, dropdown with mark-read/mark-all-read. |
| `app/components/sidebar.tsx` | Modified | New "Approvals" entry in the WORKSPACE section, next to "Quotations"; notification bell added to the footer next to the Settings link. |
| `app/quotations/[id]/page.tsx` | Modified | Amber "pending approval" banner (via `getLiveApprovalRequestForQuotation`) linking straight to the live request. |
| `app/quotations/[id]/quotation-actions-panel.tsx` | Modified | The issue action's error path now links to the blocking approval request when issuing is refused. |

## Other changes

| File | Change | Reason |
|---|---|---|
| `scripts/remove-demo-data.ts` | Modified | New deletion block (`ApprovalEvent` → `ApprovalRequest` → `ApprovalPolicy`, plus the independent `Notification` cleanup) inserted at the very start of the transaction, before even the existing Milestone 7 `Quotation` block — `ApprovalRequest.quotationId`/`customerOrderId` are `Restrict` FKs onto `Quotation`/`CustomerOrder`, so this group must run first; their counts added to the audit event and the summary output. |

## Tests

| File | Change | Reason |
|---|---|---|
| `tests/approvals.test.ts` | Added | 79 unconditional tests: the full status-transition matrix, every zod schema's accept/reject boundary, threshold evaluation (most-restrictive-wins, array-order independence), snapshot matching, self-approval/role-eligibility predicates. All passing. |
| `tests/approvals-db.integration.test.ts` | Added | 12 gated tests against a real database, building its own `SALES_MANAGER` test users directly via Prisma: policy-blocked issue creating a `PENDING` request, self-approval block, cross-manager approval, re-issue-after-approval, re-decide-after-decided (409), reject with mandatory reason plus the resulting notification, duplicate-submission prevention, the concurrent-decision race (`Promise.all`, exactly one succeeds), staleness auto-clear and staleness-resubmission-chaining (`previousRequestId`/`rootRequestId`), requester-only withdraw, admin-only cancel, and role-eligibility enforcement. Follows this project's established DB-integration-test conventions exactly; not yet run against a real database from this sandbox — see PROGRESS.md's honest verification results. |

## Documentation

| File | Change | Reason |
|---|---|---|
| `docs/milestones/ROADMAP.md` | Modified | Added Milestone 8's row and its change-log entry. |
| `docs/milestones/PROGRESS.md` | Modified | Added the full Milestone 8 section: design rationale, what was built, the known/documented Customer-PO/order non-enforcement decision, and honest verification results. |
| `CHANGES.md` | Modified | This section. |
| `SETUP-WINDOWS.md` | Modified | Added §25 — apply the new migration, regenerate the Prisma client, run the new gated test file, and a manual test script walking through policy creation, a quotation-discount approval request, decision, and the notification bell. |
| `MILESTONE-8-DELIVERY-REPORT.md` | Added | The spec-structured delivery report: architecture, models/migrations, policy/default rules, workflows affected, role/permission matrix, API routes, UI pages, audit/notification behaviour, tests + results, known limitations (including the Customer-PO/order non-enforcement decision), exact Windows PowerShell commands. |

## Milestone 9 — SAP Business One Integration

Built from your attached full specification (25 numbered sections) in
one pass, delivered silently per your "return only a zip" instruction.
Only quotation-converted orders are SAP-submission-eligible — by
explicit, documented scope decision, not an oversight. No real SAP
credentials, endpoint, or company database were ever guessed or used.
See `docs/milestones/PROGRESS.md`'s Milestone 9 section for the full
design rationale and honest verification results.

## Schema / migration

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | Modified | 7 new enums (`IntegrationProvider`, `IntegrationMode`, `IntegrationSyncJobType`, `IntegrationSyncJobStatus`, `IntegrationTrigger`, `IntegrationOperationType`, `IntegrationOperationStatus`, `IntegrationErrorCategory`), 3 new models (`IntegrationConnection`, `IntegrationSyncJob`, `IntegrationOperation`), and new inverse-relation fields on `User`/`CustomerOrder`. No existing column changed type or became non-nullable. |
| `prisma/migrations/20261111200000_add_sap_integration/migration.sql` | Added | Hand-authored (this sandbox cannot run `prisma migrate dev`), matching the schema exactly: 8 enum types, 3 `CREATE TABLE`s, their indexes and foreign keys (`Restrict` on `IntegrationOperation.syncJobId`/`customerOrderId` and `IntegrationConnection.updatedById`/`IntegrationSyncJob.triggeredById`). No existing table/column/enum value removed or changed. |

## `lib/integrations/sap/` (new module)

| File | Change | Reason |
|---|---|---|
| `types.ts` | Added | The `SapAdapter` contract every business module depends on exclusively; `SapAdapterError` with per-category default retryability. No `@prisma/client` import. |
| `config.ts` | Added | `server-only`. The three-gate deployment-mode/credential resolution (`getSapDeploymentMode`, `resolveSapLiveCredentials`, `canUseLiveSapAdapter`), `sanitizeSapErrorMessage` (credential/Authorization-header/Bearer-token redaction before any error is stored or shown). |
| `connection.ts` | Added | `server-only`, DB: singleton-per-provider `IntegrationConnection` CRUD (`getOrCreateConnection`, `updateConnection` — audited, `recordConnectionTestResult`, `recordConnectionHealthCheck`). |
| `idempotency.ts` | Added | Pure: `buildSapSalesOrderIdempotencyKey`, mirroring `lib/quotations/convert-to-order.ts`'s own deterministic-key convention. |
| `mock-adapter.ts` | Added | Deterministic `MockSapAdapter` — fixed fixture catalogue, idempotent `createSalesOrder`, three documented simulation sentinels for the NETWORK_UNAVAILABLE / lost-response-TIMEOUT / never-reached-SAP-TIMEOUT paths, `resetMockSapAdapterState` for test isolation. No `@prisma/client` import. |
| `real-adapter.ts` | Added | `server-only`. `ServiceLayerAdapter` against SAP B1's public Service Layer object model — session/cookie management, single 401-retry, 30s `AbortController` timeout correctly categorized as `TIMEOUT`. Extensively marked **unverified against a real tenant** throughout. |
| `get-adapter.ts` | Added | `server-only`, DB. `getSapAdapter()` — the single choke point every caller uses; `isSapRunningInMockMode()`. |
| `sync-job.ts` | Added | `server-only`, DB. `runIntegrationSyncJob` — the shared `IntegrationSyncJob` lifecycle wrapper (PENDING→RUNNING→COMPLETED/FAILED/PARTIAL) every sync type below uses. |
| `product-sync.ts` / `customer-sync.ts` | Added | `server-only`, DB. Each: fetch from the adapter, hand the result to the existing `lib/product-import.ts`/`lib/customer-master-import.ts` plan/execute functions verbatim. Scheduled-compatible (`triggeredById` may be `null`). |
| `invoice-sync.ts` / `credit-note-sync.ts` | Added | `server-only`, DB. Each: fetch from the adapter, hand the result to the existing `lib/invoice-reconciliation/*`/`lib/returns-credits/*` plan/execute functions verbatim. MANUAL-only — `uploadedById` is required. |
| `order-eligibility.ts` | Added | `server-only`, DB. `checkOrderEligibility` — the central scope decision: only quotation-converted orders with a mapped customer/products and a resolved price are eligible; every blocker reason is explicit and named. |
| `order-outbox.ts` | Added | `server-only`, DB. `submitOrderToSap`/`retrySubmission`/`reconcileUncertainOperation`/`resolveUncertainOperation` — the full PENDING→PROCESSING→SUCCEEDED/FAILED/UNCERTAIN state machine, always resubmitting the same immutable `submittedSnapshot`. |
| `queries.ts` | Added | `server-only`, DB, read-only. `getSapDashboardSummary`, `listIntegrationOperations`, `getIntegrationOperationById`, `getOrderIntegrationStatus` — all computed live, never cached. |
| `display.ts` | Added | Pure label/formatting helpers. No `@prisma/client` import — safe for Client Components. |
| `validation.ts` | Added | zod schemas: `updateSapConnectionSchema`, sync-job-slug validation, `sinceQuerySchema`, `resolveUncertainOperationSchema`. |

## API routes (new)

| File | Change | Reason |
|---|---|---|
| `app/api/integrations/sap/connection/route.ts` | Added | `GET` (ADMINISTRATOR/SALES_MANAGER) + `PATCH` (ADMINISTRATOR) — connection configuration, never reads or returns the password. |
| `app/api/integrations/sap/connection/test/route.ts` | Added | `POST` (ADMINISTRATOR) — tests the connection, records the result. |
| `app/api/integrations/sap/sync/[jobType]/route.ts` | Added | `POST` (ADMINISTRATOR) — manual `products`/`customers`/`invoices`/`credit-notes` sync, always `trigger: "MANUAL"`. |
| `app/api/integrations/sap/dashboard/route.ts` | Added | `GET` (ADMINISTRATOR/SALES_MANAGER) — the dashboard summary. |
| `app/api/integrations/sap/operations/route.ts` | Added | `GET` (ADMINISTRATOR/SALES_MANAGER) — filtered operations list. |
| `app/api/integrations/sap/operations/[id]/retry/route.ts` | Added | `POST` (ADMINISTRATOR/SALES_MANAGER) — resubmits a FAILED row's immutable snapshot. |
| `app/api/integrations/sap/operations/[id]/reconcile/route.ts` | Added | `POST` (ADMINISTRATOR/SALES_MANAGER) — read-only lookup-by-external-reference on an UNCERTAIN row. |
| `app/api/integrations/sap/operations/[id]/resolve/route.ts` | Added | `POST` (ADMINISTRATOR) — the authorised human decision on an UNCERTAIN row reconciliation alone couldn't settle. |
| `app/api/orders/[id]/sap-submit/route.ts` | Added | `POST` (ADMINISTRATOR/SALES_MANAGER) — submits one order; `checkOrderEligibility`'s own business rules are the real authorization-relevant gate. |
| `app/api/orders/[id]/sap-status/route.ts` | Added | `GET` (any authenticated role) — live integration status for one order. |
| Every route above | — | `requireUserOrResponse()` with the role array noted; `verifyCsrfOrigin` on every mutating route; `isValidId` on every path param; body parsing via the project's own `readJsonObject` convention. |

## UI (new)

| File | Change | Reason |
|---|---|---|
| `app/integrations/sap/page.tsx` | Added | Dashboard Server Component: connection health, per-job-type last-sync summaries, manual sync triggers. |
| `app/integrations/sap/sap-operations-panel.tsx` | Added | Client island: operations table with retry/reconcile/resolve actions, client-gated and server-re-enforced. |
| `app/integrations/sap/settings/page.tsx` | Added | ADMINISTRATOR-only connection-configuration page. |
| `app/integrations/sap/settings/sap-connection-form.tsx` | Added | Client form — never displays or accepts a password field. |
| `app/orders/[id]/sap-integration-panel.tsx` | Added | Self-fetching client island: integration status + a "Submit to SAP" button, visible only when eligible and the viewer's role permits. |
| `app/components/sidebar.tsx` | Modified | New "SAP Integration" entry in the existing "SAP MASTER DATA" section. |
| `app/orders/[id]/page.tsx` | Modified | Renders `SapIntegrationPanel` immediately after the existing handover panel. |

## Other changes

| File | Change | Reason |
|---|---|---|
| `scripts/remove-demo-data.ts` | Modified | New `integrationOperations`/`integrationSyncJobs` deletion (expected 0-row no-ops today — no demo-seeding path creates either), added to the audit event and summary output, for forward-compatibility. |
| `scripts/sap-sync.ts` | Added | Standalone scheduled-sync script (`npm run sap:sync`, mirrors `scripts/expire-quotations.ts`'s own convention) — product + customer sync only. |
| `package.json` | Modified | New `sap:sync` script entry. |
| `.env.example` | Modified | Documents `SAP_B1_PROVIDER` and `SAP_B1_PASSWORD`. |

## Tests

| File | Change | Reason |
|---|---|---|
| `tests/sap-mock-adapter.test.ts` | Added | 16 unconditional tests: fixture catalogue, idempotent resubmission, validation rejections, all three simulation sentinels (including the critical lost-response TIMEOUT case), `SapAdapterError` default-retryable mapping. All passing. |
| `tests/sap-config.test.ts` | Added | 13 unconditional tests: deployment-mode resolution, live-credential resolution, `canUseLiveSapAdapter`, `sanitizeSapErrorMessage` (caught and drove the fix for a real redaction bug — see PROGRESS.md). All passing. |
| `tests/sap-idempotency.test.ts` | Added | 3 unconditional tests: deterministic idempotency-key shape. All passing. |
| `tests/sap-order-outbox-db.integration.test.ts` | Added | 5 gated tests against a real database (mock adapter): `checkOrderEligibility`'s blocker/eligible-submission paths, `submitOrderToSap`'s happy path + idempotent resubmission, the TIMEOUT→UNCERTAIN→reconciliation→SUCCEEDED path, and the UNCERTAIN→not-found→human-resolve→FAILED path with its `AuditEvent`. Follows this project's established DB-integration-test conventions exactly; not yet run against a real database from this sandbox — see PROGRESS.md's honest verification results. |

## Documentation

| File | Change | Reason |
|---|---|---|
| `docs/sap-integration/discovery-checklist.md` | Added | The Bulawayo-HQ-facing checklist of exactly what must be confirmed/granted (Service Layer access, service-account permissions, data-mapping confirmation, idempotency support, volumes/rate limits, go-live sequencing) before `SAP_B1_PROVIDER=live` is ever set anywhere but a test environment. |
| `docs/milestones/ROADMAP.md` | Modified | Milestone 9's row moved from "⏳ Deferred" to "✅ Done"; two new "never conflate" entries; change-log entry. |
| `docs/milestones/PROGRESS.md` | Modified | Added the full Milestone 9 section: design rationale, what was built, known/documented limitations, the one real bug found and fixed, and honest verification results. |
| `CHANGES.md` | Modified | This section. |
| `SETUP-WINDOWS.md` | Modified | Added §26 — apply the new migration, regenerate the Prisma client, run the new gated test file, and a manual test script walking through connection configuration, a mock sync, and a quotation-converted order's SAP submission. |
| `MILESTONE-9-DELIVERY-REPORT.md` | Added | The spec-structured delivery report with the 15 required disclosures: architecture, adapter contract, security/config model, sync behaviour, outbox/idempotency design, RBAC matrix, API routes, UI, tests + results, known limitations (including the SAP-submission-eligibility scope boundary and the never-verified-against-real-SAP caveat), the discovery checklist, and exact Windows PowerShell commands. |

## Milestone 10 — Communication Channels & Fulfilment

Built from your attached full specification in one pass, delivered
silently per your "return only changed files" instruction. No external
WhatsApp/email integration is invented or pretended to be connected —
both real send adapters and both webhook signature-verification paths
fail safe to mock/refused by default. Three concrete deviations from
the original plan sketch (routes nested under `/orders/[id]` rather
than a top-level `/dispatches` collection; the inbox and the outbound
log built as two separate pages rather than one page with panels
embedded on `/quotations/[id]`/`/orders/[id]`; no
`/communications/settings` page) are documented, not hidden. See
`docs/milestones/PROGRESS.md`'s Milestone 10 section for the full
design rationale, what was actually built vs. planned, two real bugs
found and fixed, and honest verification results.

## Schema / migration

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | Modified | 6 new enums (`MessageChannel`, `MessageIntakeStatus`, `OutboundMessageType`, `OutboundMessageStatus`, `DispatchStatus`, `DeliveryOutcome`), 2 new values on the existing `NotificationType` enum (`CHANNEL_INTAKE_RECEIVED`, `OUTBOUND_MESSAGE_FAILED`), 7 new models (`MessageIntake`, `MessageAttachment`, `OutboundMessage`, `DispatchRecord`, `DispatchLine`, `DeliveryRecord`, `DeliveryLine`), and new inverse-relation fields on `User`/`Customer`/`CustomerContact`/`CustomerOrder`/`Quotation`/`OrderDocument`/`PickingSession`. No existing table, column, or enum value removed, renamed, or retyped. |
| `prisma/migrations/20261111220000_add_communications_and_fulfilment/migration.sql` | Added | Hand-authored (this sandbox cannot run `prisma migrate dev`), matching the schema exactly: 6 enum types, 2 `ALTER TYPE ... ADD VALUE` statements, 7 `CREATE TABLE`s, their indexes and foreign keys. No existing table/column/enum value removed or changed. |

## `lib/channels/` (new module — inbound intake)

| File | Change | Reason |
|---|---|---|
| `types.ts` | Added | The send-only `ChannelAdapter` contract, mirroring `lib/integrations/sap/types.ts`'s own shape. No `@prisma/client` import. |
| `config.ts` | Added | `server-only`. The two-channel deployment-mode/credential resolution (`getEmailDeploymentMode`, `getWhatsAppDeploymentMode`, `resolveEmailLiveCredentials`, `resolveWhatsAppLiveCredentials`, `canUseLiveEmailAdapter`, `canUseLiveWhatsAppAdapter`), webhook-secret getters, `sanitizeChannelErrorMessage`. |
| `get-adapter.ts` | Added | `server-only`. The single choke point every caller uses to get the email/WhatsApp adapter, mock-by-default. |
| `webhook-security.ts` | Added | HMAC verification for the generic email provider's shared-secret scheme and WhatsApp's `X-Hub-Signature-256`. |
| `email/mock-adapter.ts` / `email/real-adapter.ts` | Added | Deterministic mock (records + returns success) and a Postmark/SendGrid-shaped, **unverified against any real provider** real adapter. |
| `whatsapp/mock-adapter.ts` / `whatsapp/real-adapter.ts` | Added | Deterministic mock and a WhatsApp Business Cloud API-shaped, **unverified against any real Meta app** real adapter. |
| `whatsapp/media.ts` | Added | `server-only`. `fetchWhatsAppMedia` — downloads an inbound WhatsApp attachment via the real API only when live credentials are configured; otherwise never called (the webhook records a placeholder note instead, per spec's "never pretend WhatsApp is connected"). |
| `match-customer.ts` | Added | `server-only`, DB, read-only. `matchCustomerForAddress` — exact email match against `Customer.email`/`CustomerContact.email`, normalized-phone match for WhatsApp; suggested only, never auto-linked. |
| `intake-review.ts` | Added | `server-only`, DB. `recordInboundMessage` (idempotent on `externalMessageId`, stores attachments via the existing `lib/storage`), `convertMessageIntakeToPoIntake` (calls the EXISTING, unmodified `createPoIntake` — see Milestone 2A), `linkMessageIntakeToOrder`/`linkMessageIntakeToQuotation`/`ignoreMessageIntake`/`markMessageIntakeDuplicate`. Every review action refuses once a message has left `RECEIVED`. |
| `queries.ts` | Added | `server-only`, DB, read-only. `listMessageIntakes`. |

## `lib/communications/` (new module — outbound log)

| File | Change | Reason |
|---|---|---|
| `templates.ts` | Added | Pure plain-text message-body renderers, one per `OutboundMessageType`. No `@prisma/client` import. |
| `dispatcher.ts` | Added | `server-only`, DB. `attemptSend` — resolves the adapter via `get-adapter.ts`, sends, records `SENT`/`FAILED` + `lastErrorMessage` (sanitized), never throws out of a route. |
| `send.ts` | Added | `server-only`, DB. `resolveRecipient`, the 6 `queue*Message` functions (one per customer-facing event this milestone sends), `resendOutboundMessage`, `sweepStuckQueuedMessages` (documented as available but not scheduled anywhere). Every queue function is idempotent via a deterministic `idempotencyKey`. |
| `queries.ts` | Added | `server-only`, DB, read-only. `listOutboundMessages`, `getOutboundMessageDetail`. |

## `lib/fulfilment/` (new module — dispatch/delivery)

| File | Change | Reason |
|---|---|---|
| `decimal.ts` | Added | Pure, exact bigint-scaled decimal arithmetic (`sumDecimalStrings`, `formatScaledDecimal`, `clampedDifference`), extending `lib/picking/validation.ts`'s own convention unchanged (imported, not copied). No `@prisma/client` import. |
| `validation.ts` | Added | zod request schemas for the dispatch/delivery API routes, reusing `decimalStringSchema` from `lib/picking/validation.ts`. No `@prisma/client` import. |
| `queries.ts` | Added | `server-only`, DB, read-only. `getOrderFulfilmentStatus` (the one additive outstanding-quantity definition, summed across every `AUTHORIZED` `PickingSession` and every non-`CANCELLED` `DispatchRecord`), `listDispatchRecordsForOrder`, `getDispatchRecordDetail`, `listDispatchQueue` (builds out the previously-dead `/deliveries` link). |
| `dispatch.ts` | Added | `server-only`, DB. `createDispatchRecord` (validates against live outstanding quantity), `departDispatchRecord`, `cancelDispatchRecord` (only before departure — a departed dispatch is resolved via delivery, never cancelled). |
| `delivery.ts` | Added | `server-only`, DB. `recordDelivery` — one `DeliveryRecord` per `DispatchRecord` (`@unique`), enforces `accepted + rejected === dispatched` per line and a rejection reason wherever `rejectedQuantity > 0`; moves the dispatch to `DELIVERED` in the same transaction. Never creates an `InvoiceClaim`. |

## API routes (new)

| File | Change | Reason |
|---|---|---|
| `app/api/channels/email/webhook/route.ts` | Added | `POST` — inbound email, signature-verified only when `CHANNEL_EMAIL_WEBHOOK_SECRET` is set; refuses with 503 while unset. |
| `app/api/channels/whatsapp/webhook/route.ts` | Added | `GET` (Meta's one-time subscription handshake) + `POST` (inbound message), `X-Hub-Signature-256`-verified; refuses with 503 while `CHANNEL_WHATSAPP_WEBHOOK_SECRET` is unset. |
| `app/api/channels/manual-intake/route.ts` | Added | `POST` (any authenticated role) — the always-available manual-logging fallback. |
| `app/api/channels/intake/route.ts` | Added | `GET` (any authenticated role) — the review queue list, filterable by status. |
| `app/api/channels/intake/[id]/route.ts` | Added | `GET` (any authenticated role) — one message's full detail; converts `MessageAttachment.fileSize` (`BigInt`) to `Number` before responding. |
| `app/api/channels/intake/[id]/attachments/[attachmentId]/route.ts` | Added | `GET` (any authenticated role) — downloads one attachment's stored bytes. |
| `app/api/channels/intake/[id]/{convert,link,ignore,duplicate}/route.ts` | Added | `POST` (any authenticated role) — the four review actions. |
| `app/api/communications/route.ts` | Added | `GET` (any authenticated role) — the outbound log, filterable by status/channel. |
| `app/api/communications/[id]/route.ts` | Added | `GET` (any authenticated role) — one `OutboundMessage`'s detail. |
| `app/api/communications/[id]/resend/route.ts` | Added | `POST` (`SALES_MANAGER`/`ADMINISTRATOR`) — resends a `FAILED` row's immutable rendered body. |
| `app/api/orders/[id]/fulfilment/route.ts` | Added | `GET` (any authenticated role) — `getOrderFulfilmentStatus` for one order. |
| `app/api/orders/[id]/dispatch/route.ts` | Added | `POST` (any authenticated role) — creates a dispatch. |
| `app/api/orders/[id]/dispatch/[dispatchId]/route.ts` | Added | `GET` (any authenticated role) — one dispatch's detail, including its delivery outcome if recorded. |
| `app/api/orders/[id]/dispatch/[dispatchId]/depart/route.ts` | Added | `POST` (any authenticated role) — records departure; triggers `queueDispatchNotificationMessage`. |
| `app/api/orders/[id]/dispatch/[dispatchId]/cancel/route.ts` | Added | `POST` (any authenticated role) — cancels a `PLANNED` (not yet departed) dispatch. |
| `app/api/orders/[id]/dispatch/[dispatchId]/delivery/route.ts` | Added | `POST`, multipart/form-data (any authenticated role) — records the delivery outcome with optional proof photo/signature; triggers `queueDeliveryOutcomeMessage`. |
| Every route above | — | `requireUserOrResponse()` with the role array noted; `verifyCsrfOrigin` on every mutating route; `isValidId` on every path param. |
| `app/api/quotations/[id]/issue/route.ts` | Modified | Non-blocking `queueQuotationIssuedMessage` call after the existing `issueQuotation` succeeds — the existing lib transaction is untouched. |
| `app/api/quotations/[id]/respond/route.ts` | Modified | Non-blocking `queueQuotationResponseAcknowledgedMessage` call, same pattern. |
| `app/api/quotations/[id]/convert-to-order/route.ts` | Modified | Non-blocking `queueOrderConfirmationMessage` call, guarded on `!result.alreadyConverted`. |
| `app/api/orders/[id]/picking/[sessionId]/authorize/route.ts` | Modified | Non-blocking `queuePickingUpdateMessage` call after authorization succeeds; `RouteContext` widened to carry the order id alongside the session id. |

## UI (new)

| File | Change | Reason |
|---|---|---|
| `app/communications/inbox/page.tsx` | Added | Server Component: the `MessageIntake` review queue, filterable by status, with the manual-intake form. |
| `app/communications/inbox/manual-intake-form.tsx` | Added | Client island — the always-available "Log a message manually" form. |
| `app/communications/inbox/[id]/page.tsx` | Added | Server shell for one message's review page. |
| `app/communications/inbox/[id]/review-panel.tsx` | Added | Client island — the full review-action UI (convert/link/duplicate/ignore). |
| `app/communications/page.tsx` | Added | Server Component: the outbound `OutboundMessage` log, filterable by status. |
| `app/communications/resend-button.tsx` | Added | Client island — the Resend action on a `FAILED` row. |
| `app/deliveries/page.tsx` | Added | Server Component: builds out the previously-dead sidebar link — the dispatch/delivery queue. |
| `app/fulfilment/[id]/dispatch-panel.tsx` | Added | Client island — create/depart/cancel a dispatch, record a delivery outcome with proof upload. |
| `app/fulfilment/[id]/page.tsx` | Modified | Renders `DispatchPanel` after the existing `PickingPanel` conditional block. |
| `app/components/sidebar.tsx` | Modified | New "Message Inbox" entry (WORKSPACE) and "Communications" entry (OPERATIONS); the pre-existing "Dispatch & Delivery" → `/deliveries` entry is now a live link rather than a dead one. |

## Other changes

| File | Change | Reason |
|---|---|---|
| `scripts/remove-demo-data.ts` | Modified | New `messageIntakes`/`outboundMessages`/`deliveryRecords`/`dispatchRecords` deletion group, placed FIRST in the transaction (ahead of even the Milestone 8 group) since `MessageIntake`/`DispatchRecord` carry `Restrict` FKs onto `CustomerOrder`/`Quotation`/`OrderDocument`, all deleted later in the script. Added to the audit event and summary output. |
| `.env.example` | Modified | Documents `CHANNEL_EMAIL_PROVIDER`/`CHANNEL_WHATSAPP_PROVIDER` (kill switches), `CHANNEL_EMAIL_API_KEY`/`CHANNEL_EMAIL_FROM_ADDRESS`, `CHANNEL_WHATSAPP_PHONE_NUMBER_ID`/`CHANNEL_WHATSAPP_ACCESS_TOKEN`, and `CHANNEL_EMAIL_WEBHOOK_SECRET`/`CHANNEL_WHATSAPP_WEBHOOK_SECRET`. |

## Tests

| File | Change | Reason |
|---|---|---|
| `tests/fulfilment-decimal.test.ts` | Added | 16 unconditional tests: exact-sum/round-trip/clamping behavior of `lib/fulfilment/decimal.ts`, including a genuine `BigInt`-literal/ES2017-target bug this suite's own `tsc` run caught and drove the fix for (see PROGRESS.md). All passing. |
| `tests/fulfilment-validation.test.ts` | Added | 14 unconditional tests: every zod schema's accept/reject boundary in `lib/fulfilment/validation.ts`. All passing. |
| `tests/communications-templates.test.ts` | Added | 9 unconditional tests: every message-body renderer in `lib/communications/templates.ts`, asserting the facts that matter (identifiers/amounts present, correct branch wording) rather than exact prose. All passing. |
| `tests/fulfilment-db.integration.test.ts` | Added | 4 gated tests against a real database: the full dispatch→depart→deliver lifecycle, `getOrderFulfilmentStatus`'s additive outstanding-quantity math across a partial dispatch and a cancellation, and `recordDelivery`'s accepted+rejected validation. Follows this project's established DB-integration-test convention exactly; not yet run against a real database from this sandbox. |
| `tests/channels-intake-review-db.integration.test.ts` | Added | 4 gated tests against a real database: `recordInboundMessage`'s idempotent dedup on `externalMessageId`, every review action's "already reviewed" refusal, and `convertMessageIntakeToPoIntake` actually calling the existing `createPoIntake` pipeline and producing a real `OrderDocument` attributed to the reviewer. Not yet run against a real database from this sandbox. |

## Documentation

| File | Change | Reason |
|---|---|---|
| `docs/milestones/ROADMAP.md` | Modified | Milestone 10's row added as "✅ Done"; the old "6+ Dispatch & delivery — Deferred" row removed (superseded); 4 new "never conflate" entries; the stale `/deliveries` dead-link note corrected; change-log entry. |
| `docs/milestones/PROGRESS.md` | Modified | Added the "What was actually built" section (correcting the plan's model count and three route/UI deviations), "One real bug found and fixed this round" (two bugs), and honest verification results. |
| `CHANGES.md` | Modified | This section. |
| `SETUP-WINDOWS.md` | Modified | Added §27 — apply the new migration, regenerate the Prisma client, configure the channel environment variables, run the new gated test files, and a manual test script walking through intake review, outbound messaging, and the dispatch/delivery lifecycle. |

## Milestone 11 — Operational Business Intelligence (BI)

Built from your attached 17-section full specification, after four
approved `AskUserQuestion` decisions at the architecture gate: (1) both
`app/page.tsx` and `app/reports/page.tsx`'s mock data are replaced with
real M11-backed data; (2) the operational views (`/reports/pipeline`,
`/reports/fulfilment`, `/reports/financial-exposure`,
`/reports/communications`) stay open to all three roles, while the 9
named management reports under `/reports/management` are
`SALES_MANAGER`/`ADMINISTRATOR`-only, enforced server-side; (3) a real
`salespersonId` column was added to `CustomerOrder` (additive migration)
rather than approximating "salesperson" from `createdById`; (4) exports
are CSV plus browser-print, with no PDF-generation dependency added.

The one architectural decision this milestone turned on, documented once
in `docs/milestones/m11-metric-definitions.md` §6 rather than re-derived
per file: a status-equality filter (`orderStatus`/`fulfilmentStatus`/
`quotationStatus`/`claimStatus`/`communicationStatus`) is wired into a
report only when that report's own output does not already break every
row down by that exact status — applied for real on the four list-shaped
management reports that need it (`outstanding-orders`,
`awaiting-fulfilment`, `picking-shortages`, `delivery-exceptions`),
deliberately withheld from every aggregate/funnel report and the other
five management-report summaries, where it would silently collapse an
already-visible breakdown to one number. A second, narrower fix was
self-caught before any test ran: `startPickingSession`/
`authorizePickingSession` always move an order's status forward
(to `PICKING`, then unconditionally to `READY_TO_INVOICE`) regardless of
whether a shortage occurred, so a test needing an order parked at
`APPROVED`/`PICKING` cannot be built by running the full picking lifecycle
and must create the order directly at that status instead — the DB
integration test fixtures below were rewritten accordingly before they
were ever run.

No fabricated or estimated figures appear anywhere in this surface: every
number is either a real aggregate/count (`Actual`), a derivation of two
or more real numbers (`Calculated`), a real-but-not-yet-settled figure
(`Provisional`), or reported honestly as absent (`Missing`) — never
defaulted to zero. `docs/milestones/m11-metric-definitions.md` is the
single authoritative definition of every figure the `/reports/*` surface
shows.

### Schema / migration

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | Modified | Added `CustomerOrder.salespersonId String?` (nullable — unlike `Quotation.salespersonId`, which is required, because the column is new and the schema allows `NULL` for defensive/future-proofing purposes only; no code path in this codebase creates a `CustomerOrder` without one after this migration), its `salesperson User?` relation (`onDelete: Restrict`, named `OrderSalesperson` to avoid colliding with `Quotation`'s own `QuotationSalesperson` relation), and two supporting indexes: `@@index([salespersonId])` and `CustomerOrder_isDemo_status_idx` on `(isDemo, status)` (the operational-dashboard/pipeline reports' most common query shape). |
| `prisma/migrations/20261112080000_add_order_salesperson/migration.sql` | Added | Additive-only: one nullable column, two indexes, one FK, plus a one-time data backfill — `UPDATE "CustomerOrder" SET "salespersonId" = "createdById" WHERE "salespersonId" IS NULL`. There is no reliable record of who the *actual* assigned salesperson was for orders created before this migration, so `createdById` (whoever created the order record) is used as the best available, non-invented approximation — exactly the same default `lib/orders.ts`'s `createOrderCore` now applies to every *new* order when no better value is supplied, so old and new orders populate the column the same way. No existing column, constraint, or table is altered or dropped. |

### lib/reporting/ (new module)

| File | Change | Reason |
|---|---|---|
| `lib/reporting/types.ts` | Added | Shared `ReportFilters`, `PaginationParams`, `PaginatedResult<T>`, `DataQuality` and `QualifiedMetric<T>` types, with the per-field comments that say exactly which filters a given report honors and why — the single place that contract is stated instead of re-derived per function. |
| `lib/reporting/filters.ts` | Added | `parseReportFilters`/`parsePagination` (the one central, synchronous, zero-Prisma-dependency validation point for every report route — a malformed query string becomes a clean 400 here, never an unhandled 500 downstream); `defaultDateRange`, `dateRangeToTimestampFilter` (exclusive upper bound, for `@db.Timestamp` columns), `dateRangeToDateOnlyFilter` (inclusive both ends, for `@db.Date` columns), `demoWhere`. `orderStatus`/`quotationStatus`/`claimStatus` are validated here against their real enums; `fulfilmentStatus`/`communicationStatus` are deliberately passed through unvalidated because each maps onto more than one schema enum depending on which report consumes it. |
| `lib/reporting/filter-options.ts` | Added | Builds the shared customer/salesperson dropdown option lists (capped at `FILTER_OPTION_CAP` = 500 rows) for `ReportFilterBar`. Product is deliberately given no dropdown at all (7,500+ catalogue rows) and a plain exact-ID text input instead, per the spec's "never load an entire table into the browser." |
| `lib/reporting/export-csv.ts` | Added | `csvField`/`buildCsv` (RFC 4180-safe field quoting), `recordReportExport` (export audit logging), `flattenToKeyValueRows` (turns a nested summary object into metric/value rows — reused as-is by the management-report detail UI so the CSV and the on-screen table are guaranteed to show literally the same figures), `csvResponseHeaders`. |
| `lib/reporting/access.ts` | Added | `requireManagementReportAccess` = `requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"])`, the one server-side role gate every `/api/reports/management/*` route and the `/reports/management/*` pages both call — never a UI-only restriction. |
| `lib/reporting/sales-pipeline.ts` | Added | `getSalesPipelineReport` — the full request→quotation→order funnel, every rate computed within one single, consistently-dated cohort (never two independently-dated populations divided against each other — see the file's own top comment for the worked counter-example the spec explicitly warns against), plus lifecycle-transition bottleneck averages computed only over records that have both of the relevant timestamps. |
| `lib/reporting/fulfilment-intelligence.ts` | Added | `getFulfilmentIntelligenceReport` — six distinct quantities (ordered/available/shortage/dispatched/accepted+rejected/outstanding-in-transit) never blended into each other, so dispatched is structurally never reported as delivered and a completed pick is never reported as a completed delivery. |
| `lib/reporting/financial-exposure.ts` | Added | `getFinancialExposureReport` — wraps the existing M6A invoice-claims dashboard and M5 invoice-reconciliation reports (both whole-business, right-now totals by their own original design) plus a new, genuinely filterable returns-and-credit-notes summary; `exposureByCurrency[]` is kept per-currency and never summed across currencies. |
| `lib/reporting/communications-monitoring.ts` | Added | `getCommunicationsMonitoringReport` — intake and outbound-message monitoring where `totalReceived` and `byChannel[]` always share the identical `where` clause (structurally guaranteed never to drift apart), and `deliveryReceiptsSupported` is always reported as `false` rather than mislabelling a successful send attempt as a confirmed delivery. |
| `lib/reporting/operational-dashboard.ts` | Added | `getOperationalDashboardSummary` — the single combined feed behind `app/page.tsx`'s home dashboard, replacing its previous mock data. |
| `lib/reporting/management-reports.ts` | Added | The 9-report catalogue (`MANAGEMENT_REPORT_CATALOGUE`), `isManagementReportId`, `runManagementReport` dispatcher, `applicableEnumFilter`/`asAndClauses` helpers (an out-of-range enum value for a given report's status filter is treated as "not applicable" — silently not applied, never a thrown error and never a filter that forces zero rows), and the 5 list-shaped reports' own query/pagination/CSV-column logic (`LIST_REPORT_CSV_COLUMNS`). |

### API routes (new)

| Route | Method | Access |
|---|---|---|
| `app/api/reports/sales-pipeline/route.ts` + `.../export/route.ts` | GET | All 3 roles |
| `app/api/reports/fulfilment/route.ts` + `.../export/route.ts` | GET | All 3 roles |
| `app/api/reports/financial-exposure/route.ts` + `.../export/route.ts` | GET | All 3 roles |
| `app/api/reports/communications/route.ts` + `.../export/route.ts` | GET | All 3 roles |
| `app/api/reports/operational-dashboard/route.ts` | GET | All 3 roles |
| `app/api/reports/management/route.ts` | GET | `SALES_MANAGER`/`ADMINISTRATOR` only |
| `app/api/reports/management/[reportId]/route.ts` + `.../export/route.ts` | GET | `SALES_MANAGER`/`ADMINISTRATOR` only, via `requireManagementReportAccess` |

### UI (new)

| File | Change | Reason |
|---|---|---|
| `app/reports/_components/ui.tsx` | Added | Shared `PageHeader`, `SectionCard`, `MetricCard`, `EmptyState`, `Pagination` building blocks reused by every report page, matching the existing dashboard visual language rather than inventing a new one. |
| `app/reports/_components/filter-bar.tsx` | Added | `ReportFilterBar` — the one reusable, zero-client-JS (`<form method="GET">`) filter bar (date range, customer, product, salesperson, status) every report page composes from, each page opting in only to the filters its own report actually honors. |
| `app/reports/_components/search-params.ts` | Added | `toFlatSearchParams`/`toURLSearchParams`/`ReportSearchParams` helpers shared by every page's plain-link pagination and CSV-export-link construction. |
| `app/reports/pipeline/page.tsx` | Added | Sales pipeline/order-intelligence operational view (spec §4). |
| `app/reports/fulfilment/page.tsx` | Added | Picking/fulfilment intelligence operational view (spec §5). |
| `app/reports/financial-exposure/page.tsx` | Added | Invoice claims/financial-exposure operational view (spec §6) — KPI tiles, claims-by-status, exposure-by-currency (never summed), invoice reconciliation, returns & credit notes. |
| `app/reports/communications/page.tsx` | Added | Communications/exception-monitoring operational view (spec §7) — channel-mode cards, intake-by-channel, outbound KPIs, exception drill-down links. |
| `app/reports/management/page.tsx` | Added | The 9-report management catalogue, role-gated identically to the existing `app/approvals/policies/page.tsx` precedent. |
| `app/reports/management/[reportId]/page.tsx` | Added | The generic management-report viewer — a per-report filter config stating exactly which filters apply and why, a period selector for `operational-summary`, and either a `flattenToKeyValueRows`-driven metric table (summary-kind reports) or a paginated, CSV-column-driven table with order drill-down links (list-kind reports). |
| `app/reports/page.tsx` | Modified | Mock data replaced with the real reports index/landing page, linking out to the 4 operational views and (role-permitting) the management catalogue. |
| `app/page.tsx` | Modified | Home dashboard's mock data replaced with `getOperationalDashboardSummary`. |

### Other changes

| File | Change | Reason |
|---|---|---|
| `lib/orders.ts` | Modified | `OrderCreationInput` gained an optional `salespersonId`; `createOrder` now persists it (`input.salespersonId ?? createdById`, preserving the pre-M11 fallback behaviour for any caller that doesn't pass one). |
| `lib/quotations/convert-to-order.ts` | Modified | A converted order now threads the source quotation's own `salespersonId` through to the new `CustomerOrder`, so pipeline continuity (`requests → quotations → orders`) stays attributed to the same salesperson across the whole funnel rather than silently resetting to whoever clicked "convert." |
| `scripts/remove-demo-data.ts` | No change | Checked explicitly: `CustomerOrder.salespersonId` is a nullable, `onDelete: Restrict` FK onto `User`. Demo-data removal deletes `CustomerOrder` rows, never `User` rows, so this FK can never block that deletion order — no update needed. |
| `lib/reporting/management-reports.ts`, `app/api/reports/management/route.ts` | Modified | Caught while writing this documentation set: both files' own header comments said "the 11 named management reports" — stale from an earlier draft of the catalogue; `MANAGEMENT_REPORT_CATALOGUE` has always actually had 9 entries. Corrected the comment text in both files (no behavioural change). |

### Tests

| File | Change | Reason |
|---|---|---|
| `tests/reporting-filters.test.ts` | Added | 21 unconditional unit tests (no `RUN_DB_INTEGRATION_TESTS` gate needed — `lib/reporting/filters.ts` is the one `lib/reporting/*.ts` file with no `@prisma/client` import anywhere in its graph) covering full/partial/malformed filter parsing, the centrally-validated `orderStatus`/`quotationStatus`/`claimStatus` enums, the deliberately-unvalidated `fulfilmentStatus`/`communicationStatus` pass-through, pagination bounds, and the date-range helpers' inclusive/exclusive-bound behaviour. All 21 passing. |
| `tests/reporting-db.integration.test.ts` | Added | 14 tests gated behind `RUN_DB_INTEGRATION_TESTS=1` (every other `lib/reporting/*.ts` file imports `@/lib/prisma`, whose module-top-level `new PrismaClient()` call cannot run against this sandbox's stub client) — covering `export-csv` helpers, the sales-pipeline/fulfilment-intelligence quantity vocabulary, the 4 list-reports' status-filter applicability (including the "not applicable" no-op case and demo-data exclusion), communications-monitoring consistency, and financial-exposure's never-summed per-currency exposure. Confirmed to self-skip cleanly (14 skipped) with the flag unset, rather than silently passing or erroring. One fixture bug was caught and fixed before any test ran: 4 of the tests originally used a full pick→complete→authorize fixture for assertions that actually needed an order parked at `APPROVED`/`PICKING`, which `authorizePickingSession` always moves past — replaced with a direct `createOrderWithStatus` fixture that bypasses the picking lifecycle entirely. |

### Documentation

| File | Change | Reason |
|---|---|---|
| `docs/milestones/m11-metric-definitions.md` | Added | The authoritative catalogue of every figure the `/reports/*` surface shows — the four data-quality labels, the never-mix-date-cohorts principle, each report module's quantity/rate definitions, and the status-filter-applicability decision rationale, referenced by short comments in `lib/reporting/*.ts` rather than re-explained at each call site. |
| `docs/milestones/ROADMAP.md` | Modified | Milestone 11's row added as "✅ Done"; the stale "6+ Reporting/funnel metrics — Deferred" row removed (superseded); 4 new "never conflate" entries (date-cohort mixing, dispatched-vs-delivered, picking-completion-vs-delivery-completion, per-currency exposure summing); change-log entry. |
| `docs/milestones/PROGRESS.md` | Modified | Added the Milestone 11 section: design rationale, what was built, the self-discovered status-filter-applicability architecture decision, the picking-status fixture bug caught before any test ran, and honest verification results (test counts, tsc/eslint results, and the unverifiable `npm run build`/`prisma generate`/DB-integration-test caveats, each explicitly named rather than silently skipped). |
| `CHANGES.md` | Modified | This section. |
| `SETUP-WINDOWS.md` | Modified | Added §28 — apply the new `20261112080000_add_order_salesperson` migration, regenerate the Prisma client, run the two new test files, and a manual test script walking through the `/reports/*` surface (operational views, CSV export, the management catalogue and a drill-down). |
| `MILESTONE-11-DELIVERY-REPORT.md` | Added | The spec-structured delivery report. |
