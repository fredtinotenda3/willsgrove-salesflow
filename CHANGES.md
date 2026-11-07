# Milestone 0 — Changes

Every file added, modified, or deleted to build Milestone 0, with the reason
for each. Grouped by area. No files were deleted.

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

Per your approved scope: dashboard counts and settings/users only. Orders pages, stock, and reports are **unchanged** and stay visibly labelled demo/prototype — they were not touched.

| File | Change | Reason |
|---|---|---|
| `app/page.tsx` (dashboard) | Modified | Added `export const instant = false` (Next.js 16's documented escape hatch for a page that reads the session at request time ahead of being restructured behind `<Suspense>` for Cache Components — see the Next.js docs citation in the file's comment). Added the real `getCurrentUser()`/redirect check. Replaced the hardcoded stat array with real counts from `getDashboardOrderCounts()`. Removed the fabricated trend badges (e.g. "+12%") rather than inventing fake percentages against real numbers. |
| `app/settings/page.tsx` | Modified | Users & Roles panel now reads/writes real data via `/api/users`: loading/error states, admin-gated "Add User" button, one-time temporary-password display with a copy button, self-deactivation prevented in the UI, `mustChangePassword` badge. Workspace/Processing/Notifications panels are unchanged (still prototype, as approved). **A real cascading-render bug was found and fixed here** — see "Issues found and fixed" below. |
| `app/components/sidebar.tsx` | Modified | Fixed a real bug: the active-link highlight used a naive check that always lit up "Dashboard"; replaced with a correct `usePathname()`-based check (exact match for `/`, prefix match otherwise). Removed the hardcoded fake "12" Orders badge. Added a real user badge (fetches `/api/auth/session`) and a working logout menu. |

## Tests

| File | Status |
|---|---|
| `tests/csrf.test.ts` | 7/7 passing. |
| `tests/password.test.ts` | 11/11 passing. |
| `tests/rate-limit.test.ts` | 9/9 passing. |
| `tests/content-sniff.test.ts` | 12/12 passing. |
| `tests/http.test.ts` | 20/20 passing. |
| `tests/order-validation.test.ts` | **Fails to import in this sandbox** — see PROGRESS.md. Not a code defect; expected to pass unmodified once `prisma generate` runs on a real machine. |
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
