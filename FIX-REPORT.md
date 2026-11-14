# Fix Report — 18 TypeScript Errors + Build Prerendering Error (Willsgrove SalesFlow)

Root-caused and fixed against the repository zip you supplied. Every fix is explained below with the actual schema/code evidence it's based on, not just the error message. No `@ts-ignore`, `@ts-nocheck`, `any`, or weakened compiler settings were used anywhere.

**Update:** after your re-run confirmed all 18 TypeScript errors were fixed (`prisma generate`/`validate`/`migrate status` all passing, `lint` clean, `tsc --noEmit` clean, `vitest` 875/158/0 -- thank you for running the real confirmation, exactly as flagged as needed in the first pass of this report), `npm run build` progressed much further and hit a different, unrelated failure during static-page generation on `/invoice-claims/new`: a Next.js 16 Cache Components prerendering error. Section **I** below covers that fix; sections A-H are unchanged from the first pass.

**Update 2:** your next build log showed two things. First, two non-fatal `prisma:error`/"Database health check failed" lines from `/api/health` during static-page generation -- investigated and found to need **no fix** (see section **K**: this is expected build-time behavior this project's own `CHANGES.md` already documents and deliberately chose not to suppress). Second, a **fatal** error that did stop the build: `useParams()` used in a Client Component outside `<Suspense>`, on `/orders/intake/[id]/review`. Section **J** covers that fix. Sections A-I are unchanged.

**Update 3:** this round's report was a browser console error rather than a terminal transcript: `eval() is not supported in this environment... React requires eval() in development mode`, seen in `next dev`. Root cause and fix are in section **L**. Sections A-K are unchanged.

## A. `lib/channels/intake-review.ts` — 4 errors (1 root cause)

**Root cause:** `MessageIntake` has explicit `@relation(fields: [...], references: [...])` relations (`linkedOrder`, `linkedQuotation`, `duplicateOf`, etc.), which means Prisma generates two different update-input shapes for it: a **checked** one (`MessageIntakeUpdateInput`) that only exposes the *relation* fields, and an **unchecked** one (`MessageIntakeUncheckedUpdateInput`) that exposes the *scalar foreign-key* fields (`linkedOrderId`, `linkedQuotationId`, `duplicateOfId`) directly. `finishReview`'s `extra` parameter was typed as the checked variant, but every call site passes scalar FK literals (`{ linkedOrderId: orderId }`, etc.) — the unchecked shape. That mismatch is also what produced the `customer`-relation error at the old line 296: merging the wrongly-typed `extra` into the update's `data` object pulled in a checked-only `customer?: CustomerUpdateOneWithoutMessageIntakesNestedInput` property that doesn't belong in an otherwise-unchecked object (this file's `reviewedById` scalar FK already uses unchecked only).

**Fix:** changed `extra`'s type from `Prisma.MessageIntakeUpdateInput` to `Prisma.MessageIntakeUncheckedUpdateInput`. No other code changed — `linkMessageIntakeToOrder`, `linkMessageIntakeToQuotation`, `markMessageIntakeDuplicate`, `ignoreMessageIntake`, the audit-event write, and every status transition are untouched.

**Why this is correct, not a workaround:** the rest of this same function (`reviewedById: reviewerId`) was *already* relying on the unchecked shape; the type annotation was simply wrong for what the function actually does. Confirmed directly against `prisma/schema.prisma`'s `MessageIntake` model (both the scalar FK fields and the named relations are declared there).

## B. `lib/invoice-reconciliation/match-invoice.ts` — 6 errors (1 root cause)

**Root cause:** `const ELIGIBLE_ORDER_STATUSES = ["READY_TO_INVOICE"] as const;` produces a `readonly ["READY_TO_INVOICE"]` tuple. Prisma's `OrderStatusFilter.in` expects a *mutable* `OrderStatus[]`, which a readonly array is never assignable to in TypeScript (even though `READY_TO_INVOICE` is itself a perfectly valid `OrderStatus` — confirmed against the enum in `prisma/schema.prisma`). That single type failure in the `where` clause made `findMany`'s overload resolution fall back to a less-specific signature, which is why `orders`'s inferred element type lost its `select`-narrowed shape and reported `pickingSessions` (a real, valid relation on `CustomerOrder` — confirmed in the schema) as "does not exist," cascading into the implicit-`any` errors on the `line` callback parameters that follow.

**Fix:** `status: { in: [...ELIGIBLE_ORDER_STATUSES] }` — spread into a fresh mutable array at the one call site that needs it, rather than removing `as const` from the constant itself (which would lose its literal-narrowing elsewhere, not that it's used elsewhere today, but it's a reusable exported-style constant following this project's own established convention — see `CONCLUDED_CLAIM_STATUSES`, `QUOTATION_STATUSES`, etc. elsewhere in `lib/`). Fixing this one line resolved all 5 of the other reported errors as a direct cascade — confirmed: no other line in this file needed touching.

## C. `lib/reporting/export-csv.ts` — 1 error

**Root cause:** `recordReportExport`'s `filters: Record<string, unknown>` parameter was being written directly into `AuditEvent.afterData`, which Prisma types as `Prisma.InputJsonValue`. `Record<string, unknown>` isn't structurally assignable to that — `unknown` gives no guarantee the value is JSON-safe (and in practice several callers' filter objects *do* include raw `Date` values, e.g. `dateFrom`/`dateTo`, which also aren't valid `InputJsonValue` on their own).

**Fix:** added a small `toJsonValue()` helper that round-trips the value through real `JSON.stringify`/`JSON.parse` before handing it to Prisma, and used it at the one call site. This is the actual transformation a JSON column applies at the database boundary anyway (a `Date` becomes its ISO string via `toJSON()`, `undefined` keys drop out), made explicit and type-correct rather than papered over with a cast. The public `filters: Record<string, unknown>` parameter type is untouched, so none of the 11 existing call sites across `app/api/reports/**` needed changes.

## D. `lib/returns-credits/returns.ts` — 1 error

**Root cause:** `dateOnlyStringToUtcDate(value: string | null | undefined): Date | null` only returns `null` when its *input* is `null`/`undefined` (confirmed in `lib/dates.ts` — a malformed string throws, it never silently returns `null`). `RecordClaimReturnInput.receivedDate` (`lib/returns-credits/validation.ts`) is a required, Zod-regex-validated `string` — never `null`/`undefined` — so in practice this call can never actually return `null` here. But the function's general signature still says `Date | null`, and TypeScript can't see through that to the specific call site.

**Fix:** rather than a bare non-null assertion (which would silently break if `receivedDate` ever became optional later) or inventing a fallback date (explicitly disallowed), added an explicit guard that returns the same `{ ok: false, ... }` shape this function already uses for every other validation failure, with a comment explaining it's a defensive guard for an input the current type system can't quite express as unreachable — not a real code path today. The narrowed `receivedDate` (now `Date`) is used in the `ClaimReturn.create` call. No return-recording semantics changed.

## E–H. Test fixture/data errors — 6 errors across 4 files

- **`tests/customer-intelligence-db.integration.test.ts:364`** — `matchMethod: "DOC_ENTRY"` isn't a valid `InvoiceLineMatchMethod` (the enum is `AUTOMATIC | MANUAL` — confirmed in the schema; "DOC_ENTRY" is actually the name of a *CSV column-matching strategy* in `lib/invoice-reconciliation/csv.ts`, unrelated to this enum — likely where the mix-up came from). Changed to `"AUTOMATIC"`, which also matches the test's own comment ("mirrors Milestone 6B's own CSV-import path") and the `matchStatus: "AUTO_MATCHED"` already set alongside it. **Also found and fixed a second, masked defect in the same object literal**: `CreditNote.recordedById` is a required field (no default) that this fixture was missing entirely — TypeScript appears to have only surfaced the first incompatible property (`matchMethod`) and not separately flagged the missing one in the same diagnostic pass, but it is a genuine, independent defect that would fail at the database (`NOT NULL` violation) even once the enum value was fixed. Added `recordedById: adminId`, reusing this test's own existing seeded admin user — not a fabricated one.
- **`tests/picking-queries-db.integration.test.ts:91`** — the local `createOrder(status: string, ...)` helper took a plain `string`, not the real `OrderStatus` enum, even though every one of its 9 call sites already passes a valid literal (`"RECEIVED"`, `"PICKING"`, `"READY_TO_INVOICE"`, etc.). Added `import type { OrderStatus } from "@prisma/client"` (type-only, so it can't trip this file's own "never statically construct the stub client" rule — see its header comment) and retyped the parameter.
- **`tests/product-intelligence-db.integration.test.ts:514,546`** — both `CreditNote.create()` fixtures were missing the required `recordedById`. Added `recordedById: adminId` to both, reusing the test's existing seeded admin user (same pattern already used elsewhere in this repo, e.g. `tests/decision-intelligence-db.integration.test.ts`).
- **`tests/sap-order-outbox-db.integration.test.ts:57,165`** — `status: "CONFIRMED"` isn't a valid `OrderStatus` at all (the real enum: `DRAFT/RECEIVED/PENDING_VERIFICATION/READY_FOR_APPROVAL/APPROVED/PICKING/READY_TO_INVOICE/REJECTED/CANCELLED`). Checked `lib/integrations/sap/order-eligibility.ts`: the eligibility check this test exercises only blocks on `CANCELLED`/`REJECTED`, so the specific status otherwise doesn't affect either test's assertions. Used `"APPROVED"` — the closest valid status to "a normal, active order" — at both occurrences, preserving each test's intended scenario exactly.

## I. Build error — `/invoice-claims/new` prerendering failure

**Error:**
```
Error: Route "/invoice-claims/new": Next.js encountered uncached or runtime data during prerendering.
`fetch(...)`, `cookies()`, `headers()`, `params`, `searchParams`, or `connection()` accessed outside of <Suspense>
prevents the route from being prerendered...
```

**Root cause:** `app/invoice-claims/new/page.tsx` is an `async` Server Component that calls `getCurrentUser()` (`lib/auth/current-user.ts`) directly in its body, which itself calls `await cookies()` -- a per-request dynamic API. With this project's `cacheComponents: true` (`next.config.ts`), Next.js 16 tries to statically prerender every route's shell by default, and refuses to prerender one that touches a dynamic API outside a `<Suspense>` boundary.

This is **not a new problem invented by this fix** -- it's a pre-existing gap in just this one route. The project already has an established, working convention for it: **41 other authenticated pages** (`app/deliveries/page.tsx`, `app/lost-sales/page.tsx`, `app/quotations/[id]/page.tsx`, etc.) already declare `export const instant = false;` to opt out of static prerendering for exactly this reason -- confirmed by reading several of them directly. `/invoice-claims/new` was simply missing it.

**Investigation beyond the one reported route:** since Next.js's build stops at the *first* prerendering error rather than reporting every one, fixing this route alone risked just moving the failure to the next one. I checked every `page.tsx` in the app that calls any of `getCurrentUser()`, `getCurrentSession()`, `requireUser()`, `requireUserOrResponse()`, or reads `cookies()`/`headers()` directly (43 files total) against which ones already have `export const instant = false` (41 files). That left exactly **two** gaps:

- `app/invoice-claims/new/page.tsx` -- the one your build reported.
- `app/quotations/new/page.tsx` -- not yet reached by your build run (it would have failed next), same exact pattern (`getCurrentUser()` + `redirect()`, no `instant` export). Fixed proactively rather than waiting for a third round-trip.

**Fix:** added `export const instant = false;` to both files, in the same position (right after the file's header doc-comment, before the component) and with the same reasoning documented inline, matching the existing convention precisely. No other code in either file changed.

After this fix, every `page.tsx` in the app that touches a dynamic auth/cookie API now has the opt-out -- confirmed with the same cross-check script, zero remaining gaps.

## J. Build error — `/orders/intake/[id]/review` — `useParams()` outside `<Suspense>`

**Error:**
```
Error: Route "/orders/intake/[id]/review": Next.js encountered URL data `useParams()` in a
Client Component outside of `<Suspense>`. Accessing dynamic URL data in a Client Component
during prerendering requires <Suspense>...
  at useParams (...)
  at ReviewWorkspacePage (app\orders\intake\[id]\review\page.tsx:176:18)
```
This one **did** stop the build (unlike the health-check noise in section K).

**Root cause:** `app/orders/intake/[id]/review/page.tsx` was a `"use client"` page end to end, reading the document id via `next/navigation`'s `useParams()` hook at its top (`const params = useParams<{ id: string }>(); const documentId = params.id;`). Same underlying cause as the dynamic-API prerendering errors in section I -- Cache Components tries to prerender every route's static shell by default -- but a *different* dynamic primitive: this one is the client-side `useParams()` hook, not a server-side `cookies()`/`headers()` call, so `export const instant = false` (section I's fix) does not apply to it at all; that export only opts a route out of Server Component prerendering.

**This exact defect class already has a proven fix in this codebase.** `app/orders/[id]/page.tsx` hit the identical error previously (documented in its own header comment and in `CHANGES.md`, "Real build and tooling errors fixed," item 5) and was fixed by converting it from a `useParams()`-reading Client Component into an async Server Component that receives `params: Promise<{ id: string }>` directly -- which removes the client hook from the tree entirely rather than working around it with a `<Suspense>` wrapper (the error message's own suggested alternative).

**Why a straight copy of that fix doesn't fit here, and what was done instead:** `app/orders/[id]/page.tsx` could become a Server Component outright because its content is a server-rendered detail view (it fetches the order directly via `getOrderById()` and renders static HTML, with only two small interactive islands pulled out into their own Client Component files -- `handover-panel.tsx`, `sap-integration-panel.tsx`). The review workspace is the opposite: practically the entire 900-line file is interactive client state (picker search, per-line accept/exclude/override, the confirm submission, live duplicate-warning handling) that has to stay client-rendered. Turning the whole thing into a Server Component isn't an option, and wrapping a 900-line component in `<Suspense>` just to satisfy one hook call would be the kind of superficial "make the error go away" fix the original instructions explicitly rule out -- it doesn't address why the hook was there.

So this was split the same way the rest of this project already splits every other `[id]/page.tsx` route (`app/communications/inbox/[id]/page.tsx` + `review-panel.tsx`, `app/lost-sales/[id]/page.tsx` + `decision-panel.tsx`, `app/fulfilment/[id]/page.tsx` + `picking-panel.tsx`, etc. -- confirmed by reading several directly; every single `[id]/page.tsx` in this app follows this same shell/panel shape, with zero exceptions):

- **`app/orders/intake/[id]/review/page.tsx`** (rewritten) -- now a thin `async` Server Component: `getCurrentUser()`/`redirect("/login")`, then `await params` + `isValidId()`/`notFound()`, then renders `<ReviewWorkspace documentId={id} />`. No `useParams()` call anywhere in it. `export const instant = false` is kept, matching every other page in this shape.
- **`app/orders/intake/[id]/review/review-workspace.tsx`** (new file) -- the entire previous `page.tsx` body, unchanged line-for-line except: the `useParams()` import and call are removed, and the component now takes `documentId` as a plain prop instead of reading it itself. All state, effects, fetch calls (`/api/po-intake/[id]/review`, `.../review/confirm`), and UI markup are byte-for-byte identical to before.

**On the auth/id-validation check this adds:** the previous `page.tsx` had *no* server-side `getCurrentUser()`/`isValidId()` gate at all -- it relied entirely on the API routes it calls (`GET /api/po-intake/[id]/review`, `POST .../review/confirm`), both of which already enforce `requireUserOrResponse()` and `isValidId()` themselves (confirmed by reading `app/api/po-intake/[id]/review/route.ts` directly) and return a JSON error the client already renders via its existing `loadError` handling. So **no actual access-control gap is being closed or opened here** -- the real enforcement was, and remains, at the API layer. The page-level check added to the new `page.tsx` is the same redundant "belt the rest of this project already wears" pattern called out explicitly in e.g. `app/products/[id]/page.tsx`'s own comment ("the real access control lives server-side... this page's own getCurrentUser() check is... never the sole control") -- added here purely for consistency with every other route in this exact shape, not because anything was insecure without it. One small, honest UX change this does introduce: an unauthenticated visitor or a malformed id now gets a server redirect-to-login / 404 immediately, instead of a client-rendered fetch-error message. If you'd rather this page keep its previous no-server-gate behavior exactly, that's a one-line revert (drop the `getCurrentUser`/`isValidId` block from the new `page.tsx`) -- flagging the choice here rather than silently picking one.

**Proactive cross-check (same methodology as section I):** searched the entire `app/` tree for every remaining `useParams()` call (none left -- only the explanatory comments in this file and in `app/orders/[id]/page.tsx` mention the name now) and every `useSearchParams()` call, the sibling hook with the same Suspense requirement. Found two matches, both already safe: `app/login/page.tsx` already wraps its `useSearchParams()` call in `<Suspense>`; `app/orders/new/page.tsx` doesn't actually call the hook at all (its one text match is a comment explaining it deliberately reads `window.location.search` instead, specifically to avoid this exact Suspense requirement). Zero remaining gaps of either kind.

## K. Investigated, no fix needed — `/api/health` console errors during build

**What you saw:** two non-fatal lines during "Generating static pages" --
```
prisma:error Invalid `prisma.$queryRaw()` invocation: Can't reach database server at `...neon.tech:5432`
Database health check failed: ...
```
These did **not** stop the build (the fatal error in section J did).

**Investigated and left unchanged, deliberately.** `app/api/health/route.ts` already carries its own detailed header comment, and this project's `CHANGES.md` ("Real build and tooling errors fixed," item 4) documents the exact history: an earlier attempt added `export const dynamic = "force-dynamic"` to try to stop this route running at build time, that attempt was *reverted* because (a) it doesn't even build -- Cache Components rejects the legacy `dynamic` segment config outright -- and (b) it was conceptually wrong anyway: under Cache Components, a `GET` Route Handler is request-time by default and this route's uncached `prisma.$queryRaw` call already makes it request-time-only with zero config needed.

What you're seeing is Next's build-time route-classification pass: during "Generating static pages," Next probes each route once to determine whether it's static or dynamic. For this route, that one build-time probe runs against whatever database the *build machine* can reach (which, per your log, is not the Neon instance) -- the call throws, this route's own `try/catch` catches it exactly as designed, logs it via `console.error` (that's the line you saw), and returns its normal 503 "disconnected" response. Nothing is cached from that probe (there's no `"use cache"` directive on this route), so it has no effect on what the route actually returns to a real request once deployed, where the database *is* reachable. This is expected, already-understood, non-fatal build noise for an uncached, DB-dependent Route Handler under Cache Components -- not a defect, and not something this project's own history left unresolved by accident.

**No code change made.** Re-introducing `force-dynamic` (or any other attempt to "fix" this console output) would just repeat the mistake `CHANGES.md` already documents as wrong, for a problem that isn't actually a problem.

## L. Browser console error — `eval() is not supported in this environment` (`next dev`)

**Error:**
```
eval() is not supported in this environment. If this page was served with a
Content-Security-Policy header, make sure that `unsafe-eval` is included.
React requires eval() in development mode for various debugging features like
reconstructing callstacks from a different environment.
React will never use eval() in production mode

Next.js version: 16.4.4 (Turbopack)
```

**Root cause:** `next.config.ts`'s `headers()` (added in Milestone 16, spec section 4.4 — the global security-headers baseline) sends `Content-Security-Policy: ...; script-src 'self' 'unsafe-inline'; ...` on **every** response, including `next dev`. React's own development build calls `eval()` itself — not a bundler/HMR mechanism, but `react-dom`'s dev-mode instrumentation for reconstructing component stacks (its own error text says exactly this: "React requires eval() in development mode..."). A CSP whose `script-src` doesn't include `'unsafe-eval'` makes the browser block that call outright, which is this error, firing on every page in dev.

This is a real gap in this milestone's own CSP, not a new defect introduced by this fix round. `docs/production/SECURITY-REVIEW.md` section 4 already documents how the CSP was verified: "confirmed present via `curl`... `/login` rendered correctly, 200 OK, full page body." `curl` fetches the response and checks the header's value and the HTML body — it never loads the page in an actual browser, so it could not have exercised (or caught) a browser-side `eval()` block. The gap sat undetected until now because of *how* it was verified, not because it was overlooked in the code.

**Fix (`next.config.ts`):** `script-src` now conditionally appends `'unsafe-eval'`, gated on `process.env.NODE_ENV !== "production"`:
```ts
const isProduction = process.env.NODE_ENV === "production";
...
`script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
```
**Why this is correct, not a weakening:** the error message's own second line says it plainly — "React will never use `eval()` in production mode." The thing that needs `'unsafe-eval'` only exists in development. Scoping the relaxation to `NODE_ENV !== "production"` means the **production** CSP this project already reviewed and shipped is byte-for-byte unchanged (verified with a small standalone script reproducing the template-string logic for both branches — see verification table below); only `next dev` gets the one extra token it actually needs to run without a blocked `eval()` on every page. This is the standard, minimal fix for this well-known Next.js-plus-strict-CSP interaction — not a broadened production policy, and not a removal of the CSP.

**Docs updated for consistency:** `docs/production/SECURITY-REVIEW.md` section 4 now states the CSP's production value and its dev-only addition separately, and explains the `curl`-vs-browser verification gap, rather than quoting only the single policy string that was true before this fix.

**Proactive check:** confirmed no test or other config references the CSP string directly (`grep` across `tests/` and the repo for `Content-Security-Policy`/`script-src` — only `next.config.ts` and the two docs files above mention it), so nothing else needed updating for consistency.

## Verification results

Run from this environment, against the fixed code:

| Check | Result |
|---|---|
| `npx prisma generate` | **Could not run.** `Error: Failed to fetch sha256 checksum at https://binaries.prisma.sh/.../schema-engine.sha256 - 403 Forbidden`. This sandbox's outbound network access does not reach `binaries.prisma.sh` at all (confirmed by also trying `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`, which gets one step further and then fails the same way trying to fetch the actual engine binary). This is an environment limitation, not something introduced by these fixes. |
| `npx prisma validate` | **Could not run** — same network restriction (needs the schema-engine binary). |
| `npx prisma migrate status` | **Could not run** — no real PostgreSQL database is reachable from this environment. |
| `npm run lint` | **Pass.** Clean, exit 0, both before and after every round of these fixes, including a full-project run and targeted runs against the files changed in sections J and L. |
| `npx tsc --noEmit` | See the dedicated explanation below — **the specific 18 originally-reported errors are gone**, confirmed line-by-line, and the files touched in sections J and L produce **zero** errors of their own (`grep`-confirmed against the full `tsc` output). |
| `npx vitest run` | **Pass.** 875 passed / 158 skipped / 0 failed — identical to your own reported local result, unchanged after sections J and L (no test exercises either change directly). |
| `npm run build` | **Could not run at all in this environment** — fails immediately at font fetching (`next/font: error: Failed to fetch Geist from Google Fonts`, `https://fonts.googleapis.com` unreachable from this sandbox), before even reaching TypeScript-checking, let alone static-page generation. Confirmed again this round, unchanged. Your own environment is the only one that can confirm sections I and J's fixes, the same as every other check this sandbox can't run. Based on direct code inspection (not a successful build here), both fixes are grounded in this project's own established, already-working patterns (41 other routes for section I; `app/orders/[id]/page.tsx` and every other `[id]/page.tsx` + panel split for section J) — not a guess. |
| `next dev` | **Could not run at all in this environment either** — same `fonts.googleapis.com` block applies to `next dev`, not only `next build`. Section L's fix was instead verified by (a) reading the exact `isProduction`-gated template-string logic directly, and (b) reproducing that logic in a standalone Node script with `NODE_ENV` set both ways, confirming the dev-mode value gains exactly `'unsafe-eval'` and the production value is byte-for-byte identical to the one already documented and reviewed in `SECURITY-REVIEW.md` section 4. Your own environment is the only one that can confirm the console error is actually gone from a running `next dev` page. |

### Why `tsc --noEmit` needs an explanation here, not just a number

This sandbox has never had a real, network-fetched `@prisma/client` (the same `binaries.prisma.sh` restriction above also blocks `prisma generate` from producing one). What's installed instead is an essentially empty stub client with almost none of the real schema's model types — so `npx tsc --noEmit` here reports a large, pre-existing baseline of unrelated errors (hundreds, in categories like "module has no exported member X") that have nothing to do with these fixes and exist on a totally unmodified checkout too. Comparing *raw error counts* before/after is therefore not a meaningful check in this environment.

What **is** meaningful, and what I did instead: I confirmed, line-by-line, that none of your 18 originally-reported errors' exact locations still produce an error of the same kind. Specifically:

- All 4 `lib/channels/intake-review.ts` errors (old lines 257, 263, 276, 296) — gone.
- All 6 `lib/invoice-reconciliation/match-invoice.ts` errors (old lines 30, 54, 80, 81, 82) — gone.
- The `lib/reporting/export-csv.ts` error (old line 61) — gone.
- The `lib/returns-credits/returns.ts` error (old line 85) — gone.
- All 6 test-file errors (the two `recordedById` ones, the `DOC_ENTRY` one, the `createOrder(status: string)` one, and both `"CONFIRMED"` ones) — gone.

Three **new** errors appear in this sandbox's `tsc` output as a direct, understood side effect of these fixes, and all three are stub-client artifacts, not real problems:

- `lib/reporting/export-csv.ts`: two new `Prisma.InputJsonValue has no exported member` errors, because this file now references `Prisma.InputJsonValue` for the first time (in the new `toJsonValue` helper) and the stub's `Prisma` namespace doesn't export it. The *existing* code elsewhere in this codebase (e.g. `lib/channels/intake-review.ts`'s own `rawPayload?: Prisma.InputJsonValue`) already shows the identical error in this sandbox today, on code this fix didn't touch — confirming it's pre-existing-category noise, not something new in kind.
- `tests/picking-queries-db.integration.test.ts`: one new `Module "@prisma/client" has no exported member 'OrderStatus'` error, for the same reason — the stub doesn't export real enums at all. The identical import pattern (`import { OrderStatus } from "@prisma/client"`) is already used throughout this project's real application code (`lib/orders.ts`, `lib/order-queries.ts`, `lib/reporting/sales-pipeline.ts`, etc.) and works correctly against a real generated client — which is what your own environment has.

**Recommended authoritative check:** re-run `npx tsc --noEmit` and `npm run build` in your own environment (where `prisma generate` has actually succeeded against the real schema, per your earlier transcript). That is the only environment that can give a true zero-error confirmation for these specific fixes, and it's also the environment the original 18 errors came from.

### On the 158 skipped tests

Unchanged by this fix, and not represented as passing integration tests — they're off by design in *any* environment without `RUN_DB_INTEGRATION_TESTS=1` and a real database (see each `*-db.integration.test.ts` file's own header comment). They were skipped in your run too (your own transcript: "875 passed, 158 skipped"). Running them for real requires `RUN_DB_INTEGRATION_TESTS=1 npm test` against a real, seeded, non-production PostgreSQL database — not attempted here, and not safely attemptable without one (no database is reachable from this environment, and the instructions explicitly rule out pointing them at production data).

## What was deliberately not touched

- No migration, schema, or database change — nothing in this fix required one, and none was made, in any round.
- No test was deleted, skipped, or had its expectations weakened.
- No business rule, audit trail, or financial calculation changed, in any round. The one access-control-adjacent change is section J's new page-level auth/id check, called out explicitly there (with a one-line revert if you'd rather not have it) rather than silently folded in.
- No unrelated file, formatting, or refactor — the original pass changed exactly 8 files, matching the 8 files in the error report; section I added exactly the 2 files it describes; section J added exactly 1 new file (`review-workspace.tsx`) and rewrote exactly 1 existing one (`page.tsx`), both fully explained there; section K changed nothing at all (`app/api/health/route.ts` was read and deliberately left as-is); section L changed exactly `next.config.ts` (one conditional expression) plus `docs/production/SECURITY-REVIEW.md` (updated to match, not a new claim).
- `app/api/health/route.ts`'s `force-dynamic` config was **not** re-added — that would repeat a mistake this project's own `CHANGES.md` already documents as tried and reverted (see section K).
- The production `Content-Security-Policy` is unchanged — section L only widens the dev-mode `script-src`, gated strictly on `NODE_ENV !== "production"`.
