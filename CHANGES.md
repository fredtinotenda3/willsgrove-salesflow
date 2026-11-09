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
