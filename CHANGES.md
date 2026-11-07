# Milestone 0 — Changes

Every file added, modified, or deleted to build Milestone 0, with the reason
for each. Grouped by area. No files were deleted.

**This file now covers two rounds**: the original Milestone 0 build (sections
below, built and verified only in the sandbox), and the "Milestone 0 fix"
round (see that section near the end) made after your real Windows machine's
`git status`/`npm test`/`tsc`/`lint`/`build` output came back. The original
sections are left as they were written — including two test-count mistakes
in this file itself, corrected rather than quietly edited away, with a note
at each one — so you can see exactly what changed between rounds and why.

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
