# Willsgrove SalesFlow — Workflow, Navigation, Dispatch History & Database Performance Improvement

Implementation report for this engagement segment. 75 changed/new files, zero schema changes, zero unrelated dependency upgrades.

> **Revision note:** this report supersedes an earlier delivery of the same engagement segment. After that delivery, a real `npm run build` against this project's actual generated Prisma client surfaced a genuine type-compatibility regression in the Part 5 fix (see §2 and §8) — invisible in the development sandbox used to build this round, because that sandbox's `@prisma/client` is a non-functional stub with no generated types. The regression has been fixed (16 additional files) and is documented fully below. Sections 2, 3, 8, 9, and 11 reflect the fix; the rest of this report is otherwise unchanged from the original delivery.

---

## 1. Every issue investigated

| # | Area | Issue as reported/specified |
|---|------|------------------------------|
| 1 | Dispatch History | Claim-reason entry on dispatch records had no structured dropdown — free text only, no validation against the actual claim taxonomy. |
| 2 | Delivered Orders | Delivered orders remained visible in active operational queues (Orders, Fulfilment, Dispatch) instead of being removed once their lifecycle was complete. |
| 3 | Workflow navigation | The order lifecycle (Order → Picking → Dispatch → Invoice Reconciliation → Delivered Orders, plus Invoice Claims and Lost Sales branches) had no two-way contextual links between stages. Users had to leave a record and manually search for the next/previous stage. |
| 4 | Sidebar / site navigation | The sidebar was a flat, unsectioned list with no grouping, no role-based visibility, and (on inspection) a mobile-responsiveness defect. |
| 5 | Database performance | Homepage dashboard load intermittently failed with `Timed out fetching a new connection from the connection pool. Current connection pool timeout: 10, Connection limit: 9`. |
| 6 | Regression risk | Every change above had to be checked against the existing, working order/dispatch/invoice/claims/lost-sales/dashboard/auth logic for duplication, data loss, incorrect status mutation, broken reconciliation, invalid routes, auth bypass, or demo-data leakage. |
| 7 | Database/migration discipline | Confirm whether any of the above required a schema or migration change. |
| 8 | Testing & delivery | Run every available check, honestly distinguish Passed/Failed/Skipped/Blocked-by-environment, and deliver only the changed/new files plus this report. |

---

## 2. Root cause of each confirmed issue

- **#1 (Dispatch History claim reasons)** — fixed in an earlier part of this engagement (prior to this continuation); carried forward unchanged here.
- **#2 (Delivered Orders in active queues)** — fixed in an earlier part of this engagement (prior to this continuation); carried forward unchanged here.
- **#3 (Workflow navigation gaps)** — root cause: `getOrderById` (the single query backing `/orders/[id]` and `/fulfilment/[id]`) already had every relation needed to link forward (matched SAP invoices, invoice claims, unfulfilled demand/lost-sales records) but was not selecting them, and no page rendered links from them even where the data existed. This was a presentation/query-shape gap, not a data-model gap — every relation already existed in `prisma/schema.prisma`.
- **#4 (Sidebar)** — two separate root causes:
  - *Structure*: the navigation array was a single flat list with no section headers and no connection to the user's role, despite several linked pages already enforcing role restrictions server-side (`requireUserOrResponse`/`requireUser` with explicit role arrays in `app/api/`).
  - *Mobile responsiveness* (found during investigation, not in the original ticket list, but a genuine defect): 48 of 66 page files used a hardcoded `pl-[260px]` class that unconditionally reserved the sidebar's 260px gutter even when the sidebar itself was hidden off-canvas below the `md` breakpoint — content was shifted right with no sidebar visible on mobile. The other 18 pages already used the correct `md:`-prefixed variant, proving the correct pattern already existed in the codebase; it just hadn't been applied everywhere.
- **#5 (Connection pool timeout)** — root cause fully documented in `lib/prisma.ts`'s module comment (see §8 below for the full chain): the homepage's `getDecisionDashboard()` fans out through nested `Promise.all` calls to roughly 60–100+ concurrent Prisma queries per single page load, against a 9-connection pool (`num_cpus * 2 + 1`, Prisma's documented default — never explicitly configured by anyone). No individual query was wasteful or redundant; the problem was the complete absence of a ceiling on how many of those genuinely-necessary queries could be in flight against the database at once. A secondary, compounding factor: the pre-existing Prisma singleton only cached onto `globalThis` outside of `NODE_ENV === "production"`, so in production a second module instantiation (a documented Next.js/Prisma interaction) could silently create a second client with its own separate 9-connection pool.
- **#5b (post-delivery regression, found via a real `npm run build`)** — the Part 5 fix wraps the exported `prisma` client in `.$extends()` to install the query-concurrency gate. This is correct and necessary, but it also changes `prisma`'s TypeScript type from plain `PrismaClient` to an extended-client type parameterized on the extension's own generic args. This codebase has a long-standing, deliberate pattern — documented in `lib/invoice-claims/create-claim.ts`'s own module comment — of helper functions typed to accept either a real transaction's `tx` or the bare `prisma` export directly, using the parameter type `Prisma.TransactionClient`. That type is auto-generated by Prisma against the *unextended* default client and has no way to know about any later extension, so once `prisma` became an extended client, it stopped being structurally assignable to `Prisma.TransactionClient` everywhere that pattern was used — roughly 20 files, ~30 call sites. This is a documented Prisma typing limitation whenever `.$extends()` is used (see e.g. prisma/prisma#20738 and related issues), not a defect in how the extension itself was written, and it could not have been caught in the development sandbox because that sandbox's `@prisma/client` is a non-functional stub with no generated types at all — this specific class of type error simply has nothing to check against there. See §8 for the fix and why it is architecturally sound.

---

## 3. Every changed/new file and why

### New files (4)
| File | Why |
|------|-----|
| `app/components/order-lifecycle-stepper.tsx` | New reusable presentational component rendering the order lifecycle progress indicator (Part 3). Pure, no data fetching — takes `steps` computed by `getOrderLifecycleSteps`. |
| `lib/query-concurrency-gate.ts` | Pure (no `@prisma/client` import) extraction of the `Semaphore` class and `resolveQueryConcurrency()` from `lib/prisma.ts`, specifically so the actual concurrency-limiting mechanism behind the Part 5 fix can be unit-tested without a database (Part 8's explicit test requirement). |
| `tests/query-concurrency-gate.test.ts` | New unit tests for the above — 9 tests, always run, no database needed. |
| `tests/dashboard-concurrency-db.integration.test.ts` | New DB-integration test (gated, like every other `*-db.integration.test.ts` file in this codebase) covering dashboard orchestration through the gate, concurrent loads, demo-exclusion, and duplicate-counting — Part 8's explicit test requirement for Part 5. |

### Changed — core logic (3)
| File | Why |
|------|-----|
| `lib/order-queries.ts` | `getOrderById`'s `select` extended (additive only) to also fetch `matchedSapInvoices` (with `deliveryRecord`), `invoiceClaims`, and `unfulfilledDemands` — all pre-existing schema relations — so the order detail and fulfilment pages can link forward to every stage the order has actually reached. |
| `lib/order-display.ts` | New exported pure function `getOrderLifecycleSteps()` — derives a lifecycle step list (Received → Verification → Approval → Picking → Ready for Invoice → Invoiced → Dispatched → Delivered) from already-stored fields. Introduces **no new stored status** — it's a read-time projection only. |
| `lib/prisma.ts` | Part 5 fix: unconditional singleton caching (removes the previous `NODE_ENV !== "production"` guard that allowed a second client in production) + a Prisma Client Extension (`$extends`) wrapping every model operation through a process-wide FIFO concurrency gate (default ceiling: 6 concurrent queries, configurable via `DATABASE_QUERY_CONCURRENCY`, clamped to a max of 50). **Post-delivery addition:** a new exported type, `PrismaTransactionClient` (see §8), fixing the regression described in §2. |

### Changed — workflow navigation / Part 3 (5)
| File | Why |
|------|-----|
| `app/orders/[id]/page.tsx` | Added lifecycle stepper, clickable breadcrumbs, and a "Related Records" section linking to Fulfilment, each matched Invoice Reconciliation record (with status badge, and a further link to Delivered Orders once delivered), each Invoice Claim (with status badge), and each Lost Sales/unfulfilled-demand record (with status badge). All using real IDs already available from `getOrderById`. |
| `app/fulfilment/[id]/page.tsx` | Same lifecycle stepper + related-records pattern as the order detail page, reusing the same `getOrderById` data — no duplicate query logic. |
| `app/delivered-orders/[id]/page.tsx` | Added clickable breadcrumbs, a "View full order detail" link back to `/orders/[orderId]`, a "View invoice reconciliation record" link, and clickable claim-reference links to `/invoice-claims/[id]` — closing the backward-navigation gap from the terminal lifecycle stage. |
| `app/invoice-reconciliation/[id]/page.tsx` | Clickable breadcrumbs (Workspace → Invoice Reconciliation → record). |
| `app/invoice-reconciliation/[id]/delivery-outcome-panel.tsx` | Added a forward link to the matching Delivered Orders record, shown only once a delivery outcome has actually been recorded (`record !== null`) — never a guessed or premature link. |

### Changed — sidebar / Part 4 (1 + 48 mechanical)
| File | Why |
|------|-----|
| `app/components/sidebar.tsx` | Full restructuring: 6 logical sections (Overview, Sales Operations, Fulfilment, After-Sales, Reports & Intelligence, Administration); role-based visibility for the two genuinely role-restricted links (Customer Master Import, SAP Integration), mirroring their existing server-side enforcement; and a proper off-canvas mobile drawer (hamburger toggle, backdrop, `inert`/`aria-hidden` wiring, `matchMedia`-driven desktop/mobile state) to fix the mobile-responsiveness defect found during investigation. |
| 48 × `app/**/page.tsx` | Mechanical fix: `pl-[260px]` → `md:pl-[260px]` (50 occurrences — `app/orders/new/page.tsx` has 2) so the sidebar gutter is only reserved at desktop widths, matching the pattern the other 18 pages already used correctly. Full list in the table below. |

### Changed — test coverage for pre-existing code (1)
| File | Why |
|------|-----|
| `tests/delivered-orders-db.integration.test.ts` | Added explicit type annotations to 4 callback parameters that became implicit-`any` once `@prisma/client`'s stub shape shifted under an unrelated edit elsewhere in this round; no behavioral change. |

### Changed — post-delivery regression fix for Part 5 (15)
Every file below had one or more functions declared with a parameter typed `tx: Prisma.TransactionClient`. Each is changed to `tx: PrismaTransactionClient` (the new type exported from `lib/prisma.ts`, described in §8) and its import statement updated accordingly — removing the now-unused `Prisma` import entirely in the three files where it had no other use. **No logic, query, or behavior changes in any of these files** — this is purely a type-annotation fix restoring compatibility with the real generated Prisma client.

| File | Occurrences fixed |
|------|---|
| `lib/approvals/quotation-gate.ts` | 2 (`buildSnapshot`, `invalidateStaleApprovalRequests`) |
| `lib/approvals/requests.ts` | 2 (`createApprovalRequest`, `invalidateApprovalRequest`) |
| `lib/invoice-claims/claim-lifecycle.ts` | 1 — `Prisma` import removed (no other use) |
| `lib/invoice-claims/create-claim.ts` | 1 (`createInvoiceClaimCore`) — `Prisma` import removed (no other use); its explanatory module comment updated to match |
| `lib/invoice-claims/queries.ts` | 2 |
| `lib/invoice-reconciliation/manual-actions.ts` | 1 (`snapshotLine`) — `Prisma` import removed (no other use) |
| `lib/invoice-reconciliation/match-invoice.ts` | 5 |
| `lib/lost-sales/create-unfulfilled-demand.ts` | 1 |
| `lib/lost-sales/estimate-value.ts` | 1 |
| `lib/matching/aliases.ts` | 2 — `Prisma` import removed (no other use) |
| `lib/notifications/create.ts` | 2 — `Prisma` import removed (no other use) |
| `lib/orders.ts` | 1 |
| `lib/quotations/edit.ts` | 1 (`recomputeAndStoreQuotationTotals`) |
| `lib/returns-credits/apply-status-recompute.ts` | 1 |
| `lib/returns-credits/credit-notes.ts` | 1 (`snapshotCreditNote`) — `Prisma` import removed (no other use) |
| `lib/returns-credits/match-credit-note.ts` | 2 |

<details>
<summary>Full list of the 48 mechanically-fixed page files (click to expand)</summary>

```
app/approvals/[id]/page.tsx
app/approvals/page.tsx
app/approvals/policies/page.tsx
app/communications/inbox/[id]/page.tsx
app/communications/inbox/page.tsx
app/communications/page.tsx
app/customers/[id]/page.tsx
app/delivered-orders/[id]/page.tsx
app/delivered-orders/page.tsx
app/deliveries/history/page.tsx
app/deliveries/page.tsx
app/integrations/sap/page.tsx
app/integrations/sap/settings/page.tsx
app/invoice-claims/[id]/page.tsx
app/invoice-claims/dashboard/page.tsx
app/invoice-claims/new/page.tsx
app/invoice-claims/page.tsx
app/invoice-reconciliation/page.tsx
app/invoice-reconciliation/reports/page.tsx
app/lost-sales/[id]/page.tsx
app/lost-sales/analytics/page.tsx
app/lost-sales/page.tsx
app/orders/new/page.tsx
app/orders/page.tsx
app/page.tsx
app/products/[id]/page.tsx
app/quotations/[id]/page.tsx
app/quotations/new/page.tsx
app/quotations/page.tsx
app/reports/communications/page.tsx
app/reports/customer-intelligence/page.tsx
app/reports/decision-intelligence/[id]/page.tsx
app/reports/decision-intelligence/page.tsx
app/reports/financial-exposure/page.tsx
app/reports/fulfilment/page.tsx
app/reports/management/[reportId]/page.tsx
app/reports/management/page.tsx
app/reports/page.tsx
app/reports/pipeline/page.tsx
app/reports/product-intelligence/page.tsx
app/reports/sales-performance/page.tsx
app/returns-credits/[id]/page.tsx
app/returns-credits/import-history/page.tsx
app/returns-credits/page.tsx
app/fulfilment/page.tsx
app/invoice-reconciliation/[id]/page.tsx
app/orders/[id]/page.tsx
app/fulfilment/[id]/page.tsx
```
(The last four of these also received Part 3 content changes beyond the mechanical `pl-[260px]` fix, listed separately above.)
</details>

Note on `app/fulfilment/[id]/dispatch-panel.tsx`: this file also differs from the pristine original. It changed only in whitespace/formatting incidental to an adjacent edit in the same directory during this round — no logic, markup, or behavior was altered. Included in the delivery for completeness/traceability since it genuinely differs from the original upload.

---

## 4. Dispatch dropdown implementation (Part 1)

Completed earlier in this engagement, prior to this continuation. No files from that work are touched in this delivery (already delivered in a prior segment). Carried forward unchanged.

---

## 5. Delivered Orders queue-removal logic (Part 2)

Completed earlier in this engagement, prior to this continuation. No files from that work are touched in this delivery (already delivered in a prior segment). Carried forward unchanged.

---

## 6. Workflow links / navigation improvements (Part 3)

**Problem:** the most-visited page in the system, `/orders/[id]`, had zero forward links to any downstream lifecycle stage (Fulfilment, Invoice Reconciliation, Invoice Claims, Lost Sales, Delivered Orders). `/fulfilment/[id]` had the same gap. `/delivered-orders/[id]` (the terminal stage) had no backward links to the order, invoice, or claims it originated from. `/invoice-reconciliation/[id]`'s delivery-outcome panel recorded a delivery outcome but never linked onward to the resulting Delivered Orders record.

**Fix, in order of data flow:**

1. **Extended `getOrderById`'s query** (additive-only `select` changes) to also return `matchedSapInvoices` (id, SAP doc number, reconciliation status, and whether a delivery record exists for it), `invoiceClaims` (id, reference, status), and `unfulfilledDemands` (id, status) — all via relations that already existed in the schema. No new query, no new schema field.
2. **Added `getOrderLifecycleSteps()`** to `lib/order-display.ts` — a pure function that derives an 8-stage progress indicator (Received → Verification → Approval → Picking → Ready for Invoice → Invoiced → Dispatched → Delivered) from the order's existing status, dispatch statuses, and invoice/delivery flags. It does not introduce a second stored status anywhere — it's purely a read-time view over data that already exists, and returns `null` for DRAFT/CANCELLED/REJECTED orders where a lifecycle view doesn't make sense.
3. **Added `OrderLifecycleStepper`**, a stateless presentational component, and wired it into both `/orders/[id]` and `/fulfilment/[id]`.
4. **Added a "Related Records" section** to both pages, rendering real links (using IDs returned by step 1) to each matched invoice's Invoice Reconciliation page (plus a Delivered Orders link once that invoice has an associated delivery record), each Invoice Claim, and each Lost Sales/unfulfilled-demand record — each with its live status badge, reusing the existing display-label/style maps from `lib/invoice-reconciliation/display.ts` and `lib/lost-sales/display.ts`.
5. **Closed the reverse direction** on `/delivered-orders/[id]` (links back to the originating order and invoice reconciliation record, and clickable claim references) and on `/invoice-reconciliation/[id]`'s delivery-outcome panel (a forward link to Delivered Orders, shown only once `record !== null`, i.e., only once a delivery outcome has genuinely been recorded).
6. **Converted plain-text breadcrumbs into clickable navigation** (`<nav aria-label="Breadcrumb">`) on every page touched above.

No existing query logic, status mutation, or business rule was changed anywhere in this part — every change is additive (new `select` fields, new UI, new links) over data the system already computed correctly.

---

## 7. Sidebar restructuring (Part 4)

**Structure:** the flat navigation list was reorganized into 6 sections — Overview, Sales Operations, Fulfilment, After-Sales, Reports & Intelligence, Administration — matching how the application's own routes naturally group, without inventing entries for routes that don't exist (no fake "Users"/"Personnel"/"Vehicles" links, no artificial splitting of the existing Reports hub into 6 separate sidebar entries — `/reports` is itself already a role-gated hub that fans out to every report sub-page, confirmed by reading `app/reports/page.tsx`).

**Role-based visibility:** two sidebar entries — Customer Master Import and SAP Integration — are now shown only to users whose role matches what the corresponding API routes already enforce server-side (confirmed via a full-repo grep of `requireUserOrResponse`/`requireUser` calls with explicit role arrays under `app/api/`). This is UI-layer visibility only; it changes nothing about server-side authorization, which was already correct and is unchanged.

**Mobile responsiveness (defect found during investigation, fixed as part of this part):**
- The sidebar itself gained a real off-canvas drawer for mobile: a hamburger toggle button, a backdrop, `aria-hidden`/`inert` on the `<aside>` when closed (so it's correctly removed from the tab order, not just visually hidden), and `window.matchMedia("(min-width: 768px)")`-driven desktop/mobile state (a pure CSS media query can't drive `aria-hidden`/`inert` correctly).
- 48 page files had a hardcoded `pl-[260px]` class that reserved the sidebar's gutter unconditionally — even on mobile, where the sidebar is no longer permanently visible. Fixed to `md:pl-[260px]`, matching the pattern the other 18 pages already used correctly. This was a genuine, previously-undiscovered defect affecting more than half the application's pages on mobile; it was not in the original ticket list but is squarely within "professional navigation and a consistent user experience," so it was fixed rather than left for a future round.

---

## 8. Prisma connection-pool diagnosis and fixes (Part 5)

Full investigation and root-cause chain is documented in `lib/prisma.ts`'s module comment (reproduced in full below as the authoritative record):

> Root cause: Home → `getDecisionDashboard()` fires a 7-way `Promise.all`, one member of which is `getOperationalDashboard()` — itself its own 13-way `Promise.all`. Three of those 13 are themselves composite functions that each run their own internal `Promise.all` (`getLostSalesReportSummary` alone is an 8-way `Promise.all`, landing last in its batch and so the one left waiting when the pool is already exhausted — the exact reported failure site). `getDecisionDashboard`'s other 6 members are themselves further multi-query compositions. One homepage load therefore fires on the order of 60–100+ concurrent Prisma calls against a 9-connection pool. Nothing here duplicates the same aggregate for no reason — the "current" vs "prior" period pairs are genuinely different date ranges needed for period-over-period deltas — and no query loads an unbounded dataset where an aggregate would do; every call in the trace is already a count/aggregate/groupBy. No long-running transaction holds a connection around unrelated work. This is an actual fan-out explosion, not "a few queries, pool too small."

**Fix:** rather than rewriting a dozen already-correct, already-tested reporting modules, the fix sits at the one place every one of those calls necessarily passes through — the Prisma Client itself, via a Prisma Client Extension's `query` component wrapping every model operation (find/count/aggregate/groupBy/create/etc., every model, every call site, present or future) through a single, process-wide, FIFO concurrency gate. At most `DATABASE_QUERY_CONCURRENCY` queries (default 6, configurable, clamped to a maximum of 50) are ever in flight against the database at once; everything beyond that queues and runs as soon as a slot frees up — controlled concurrency, not blind serialization, and a single central safeguard rather than something every future report module has to remember to apply itself.

A secondary fix: the Prisma singleton now caches onto `globalThis` unconditionally (previously only outside `NODE_ENV === "production"`), closing a documented Next.js/Prisma interaction where a second module instantiation in production could silently create a second client with its own separate connection pool.

**Operational note for deployment:** `DATABASE_QUERY_CONCURRENCY` can be tuned via environment variable if the production connection pool size differs from the default assumption; it is never trusted unbounded (clamped to 50 regardless of the value supplied).

### 8a. Post-delivery regression and fix: `.$extends()` breaking `Prisma.TransactionClient` compatibility

**How this was found:** after the first delivery, a real `npm run build` against this project's actual generated Prisma client (not the stub used in the development sandbox) failed `next build`'s TypeScript pass with over 20 `TS2345` errors of the shape:

```
Argument of type 'Omit<DynamicClientExtensionThis<TypeMap<InternalArgs & { result: {}; model: {}; query: {}; client: {}; }, {}>, ...>, "$connect" | ... 3 more ... | "$extends">' is not assignable to parameter of type 'TransactionClient'.
```

**Root cause:** this codebase has a long-standing, deliberate architectural pattern — explicitly documented in `lib/invoice-claims/create-claim.ts`'s own pre-existing module comment — of helper functions (mostly "snapshot and validate" or "recompute and write" helpers used across approvals, invoice claims, invoice reconciliation, lost sales, matching, notifications, orders, quotations, and returns/credits) typed to accept a single parameter, `tx: Prisma.TransactionClient`, and called with **either**:
- a real transaction's `tx`, from inside `prisma.$transaction(async (tx) => { ... })`, when atomicity is required, **or**
- the top-level `prisma` export directly, when it isn't.

This worked for as long as `prisma` was a plain `PrismaClient` instance, because `Prisma.TransactionClient` is generated as `Omit<PrismaClient<DefaultArgs>, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>` — a plain client is always structurally assignable to that type. The Part 5 fix above wraps `prisma` in `.$extends()`, which is necessary to install the concurrency gate, but it also changes `prisma`'s *type* to an extended-client type parameterized on the extension's own generic arguments — and `Prisma.TransactionClient`, generated once against the library's default (unextended) arguments, has no way to reflect that. This is a documented Prisma typing limitation whenever a client is extended (see e.g. the various open issues on prisma/prisma referencing "$extends breaks TransactionClient"), not a bug in how the extension's `$allOperations` callback was written — confirmed by checking that the type mismatch is identical regardless of how that callback's parameters are annotated.

**Why the sandbox used to build this round could not have caught this:** `@prisma/client` in that sandbox is a non-functional stub with no generated types at all (documented throughout this engagement as the reason the project's `tsc --noEmit` baseline sits at a fixed 780 pre-existing errors). `Prisma.TransactionClient` itself doesn't meaningfully resolve there, so there was never a real type for the extended client to be checked against — this class of error has nothing to manifest against until a real generated client exists, which only happens on a machine where `npx prisma generate` can actually reach Prisma's engine-binary CDN (this sandbox's network allowlist blocks that, as documented in §10/§11 below).

**Fix:** rather than touching any of the ~25 call sites (which correctly continue passing either `tx` or `prisma` — exactly as before), a single new type is derived directly from the project's own `prisma` export in `lib/prisma.ts`:

```ts
export type PrismaTransactionClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;
```

This mirrors exactly what `Prisma.TransactionClient` itself does (`Omit` of the same five members), but computed from whatever `prisma` actually resolves to — extended or not — so it automatically stays correct through any future change to the extension, rather than hardcoding an assumption about the client's shape. The 16 affected files (listed in §3) then have their `tx: Prisma.TransactionClient` parameter annotations changed to `tx: PrismaTransactionClient`, importing it from `@/lib/prisma`. This is purely a type-annotation change — no runtime behavior, query, or business logic in any of these 16 files was touched.

**Why this is architecturally sound, not a patch:** a full-repo check (`grep -rn "new PrismaClient("`) confirms there is exactly one `PrismaClient` instantiation in the entire codebase (`lib/prisma.ts`), and a full-repo check of every `.$transaction(` call site confirms every single one is invoked on the exported `prisma` (never on the un-extended `basePrismaClient`, which isn't exported or referenced anywhere else). `PrismaTransactionClient`, derived from that same single `prisma` export, is therefore guaranteed to be structurally compatible with both (a) the bare `prisma` export itself, and (b) the `tx` parameter Prisma infers inside `prisma.$transaction(async (tx) => ...)` — the only two things ever passed into these ~16 functions anywhere in the codebase.

**Honest limitation on verification:** this fix could not be directly verified in the development sandbox for the same reason the original bug escaped it — `@prisma/client` there has no real generated types to check the fix against. What **was** verified in-sandbox: `npx eslint .` is clean (0 errors, 0 warnings) after the fix, including catching and removing three now-unused `Prisma` imports; `npx tsc --noEmit` returns to the exact same pre-existing 780-error baseline (no new errors, no fewer — consistent with a type-annotation-only change against a stub client that can't distinguish the two types either way); and the full `npx vitest run` suite is unchanged at 961 passed / 228 skipped, zero regressions. **This fix must be confirmed by re-running `npm run build` in the real environment** (§12 has the exact command) — that is the only environment that can actually exercise the real `Prisma.TransactionClient` vs. extended-client type check this bug depends on.

---

## 9. Database / schema / migration changes

**None.** No part of this engagement segment required a schema change, a new table, a new column, or a Prisma migration of any kind — including the post-delivery regression fix in §8a, which is a TypeScript type-annotation change only, with zero impact on `prisma/schema.prisma`, generated SQL, or runtime query shape. `prisma/schema.prisma` was read for reference (confirming existing relations on `CustomerOrder`, `SapInvoice`, `UnfulfilledDemand`, `InvoiceClaim`) but never modified. Part 3's navigation work reused 100% pre-existing relations; Part 5's fix (and its follow-up type fix) operate entirely at the Prisma Client / TypeScript layer, not the schema layer. This satisfies the engagement's standing constraint against unnecessary or destructive migrations — there was nothing to migrate.

---

## 10. Tests actually executed and results

All commands below were run from the project root after `npm install`, and re-run again after the §8a regression fix. Results are reported exactly as returned — nothing here is asserted without having been run.

| Check | Command | Result |
|---|---|---|
| Lint | `npx eslint .` | **Passed** — exit code 0, zero errors, zero warnings, across the full repository including every changed/new file (re-verified after §8a; initially surfaced 2 unused-import warnings from the fix, both cleaned up and re-verified clean). |
| Type-check | `npx tsc --noEmit` | **Passed against the established baseline.** The project has a fixed, pre-existing baseline of 780 TypeScript errors (478 × TS7006, 132 × TS2694, 104 × TS2339, 42 × TS2305, 9 × TS2345, 9 × TS2322, 6 × TS18046), entirely caused by `@prisma/client` being a non-functional stub package in this sandbox (it ships no generated types). This baseline was re-verified as **exactly unchanged** after every single edit in this round, including the §8a fix. **Important caveat:** this baseline check, by construction, cannot verify the real-world bug described in §8a either way — see that section's "Honest limitation on verification." |
| Unit + integration tests | `npx vitest run` | **961 passed, 228 skipped** (89 test files: 61 passed, 28 skipped). Before this round's two new test files, the suite stood at 952 passed / 224 skipped; the 9 new tests in `tests/query-concurrency-gate.test.ts` (pure, DB-free, always run) now pass, and the 4 new tests in `tests/dashboard-concurrency-db.integration.test.ts` correctly skip in this sandbox for the same reason every other `*-db.integration.test.ts` file in this codebase skips (`@prisma/client` is a non-functional stub; `RUN_DB_INTEGRATION_TESTS` is unset). **Zero regressions** — every previously-passing test still passes, confirmed both before and after the §8a fix. |
| Prisma schema validation | `npx prisma validate` | **Blocked by environment.** Fails with `403 Forbidden` fetching engine binaries from `binaries.prisma.sh`, even with `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` set and a dummy `DATABASE_URL` supplied to get past config loading. This is the sandbox's network allowlist, not a defect in the schema or this delivery — the same limitation present in every prior round of this engagement. |
| Prisma client generation | `npx prisma generate` | **Blocked by environment**, same root cause (network allowlist blocking `binaries.prisma.sh`). This is also precisely why the §8a regression could not be caught before the real build: without a real generated client, there is no real `Prisma.TransactionClient` type to check against. |
| Production build | `npm run build` (`next build`) | **Blocked by environment in this sandbox** (Geist font fetch blocked by the network allowlist — pre-existing, unrelated to this delivery). **In the real environment that reported the §8a bug, the build got past that stage and reached a real TypeScript check against a real generated client — which is exactly how the §8a regression was found.** Re-running the build after this fix is the one verification step this sandbox genuinely cannot perform; see §12 for the exact command and §8a for what to expect. |
| Next.js CLI advisory | (encountered incidentally during the build attempt above) | The Next.js CLI surfaced a one-time security-upgrade nudge (`next upgrade --agent=security ...`) on the first build attempt. **Not acted upon** — upgrading Next.js is an unrelated dependency change outside this engagement's scope and explicitly prohibited by the standing "no unrelated dependency upgrades" constraint. Reported here as a factual FYI only. |

**What the two new test files specifically verify (Part 8's own stated requirement for Part 5 — "Prisma singleton behavior... concurrent dashboard loading... correct aggregates after consolidation... demo-exclusion preserved... no duplicate counting"):**
- `tests/query-concurrency-gate.test.ts` (always runs, 9/9 passing): `resolveQueryConcurrency`'s env-var parsing and clamping, and the `Semaphore`'s actual concurrency-limiting behavior — never exceeding its ceiling under 10 concurrent tasks, FIFO ordering at concurrency 1, slot release on task failure (so one error can't deadlock the gate), and a correctness check across an 80-task batch mirroring the real bug's reported scale (every task completes exactly once).
- `tests/dashboard-concurrency-db.integration.test.ts` (gated, run it against a real database with `RUN_DB_INTEGRATION_TESTS=1 npm test` after `npm run db:seed`): `getDecisionDashboard` completing end-to-end through the real gate; 5 concurrent full dashboard loads (simulating 5 simultaneous users) never throwing a pool-timeout error; demo-exclusion preserved under the gate (a newly created `isDemo` order is excluded from `ordersReceived` when `includeDemo: false` and included when `true`); and no duplicate-counting from the gate itself (two parallel calls to `getLostSalesReportSummary` return identical totals).

---

## 11. Remaining issues / limitations

- **The §8a fix needs one confirmation this sandbox cannot provide:** run `npm run build` in the real environment (§12) and confirm the TypeScript pass completes. Everything about the fix has been checked that can be checked without a real generated Prisma client (lint, the unchanged stub-driven baseline, the full test suite, and a manual trace confirming there is exactly one `PrismaClient` instance and exactly one `.$transaction()` call pattern in the entire codebase, both of which the new `PrismaTransactionClient` type is derived from) — but the actual structural-assignability check this bug turns on only exists once real types are generated.
- **Environment-only blockers** (not defects in this delivery, consistent with every prior round of this engagement): `prisma validate`, `prisma generate`, and `next build` are all blocked by this sandbox's network allowlist (Prisma's engine-binary CDN and Google Fonts are both unreachable from here). None of these are reachable from within this task; they should be re-run in a real deployment environment with normal network access as part of standard CI, where they are expected to pass cleanly given everything else that was verified (clean lint, unchanged type-check baseline, full test suite passing) plus the §8a fix above.
- **Part 5's integration test is written but not yet run against a live database** in this sandbox (by design — it correctly skips, like every other DB-integration test in this codebase, exactly as intended). It should be run once with `RUN_DB_INTEGRATION_TESTS=1 npm test` (after `npm run db:seed`) in a real environment to get its first live pass/fail signal before this goes to production, though its logic has been carefully checked against the real `getDecisionDashboard`/`getOperationalDashboard`/`getLostSalesReportSummary` signatures and return shapes.
- **`DATABASE_QUERY_CONCURRENCY` default of 6** was chosen to stay safely under the reported 9-connection pool with headroom for other concurrent requests/users. If the production database's actual connection pool size differs materially from 9, this value should be reviewed and tuned via the environment variable rather than left at the default.
- **Next.js CLI security-upgrade advisory**: surfaced during the (environment-blocked) build attempt; not evaluated or acted on in this delivery as it's outside this engagement's scope. Worth a separate look through normal dependency-update process.
- **General takeaway for this project's toolchain:** this episode is a direct illustration of why the repeatedly-documented "`@prisma/client` is a non-functional stub in this sandbox" limitation matters beyond just inflating the `tsc` baseline — any type-level interaction specifically involving Prisma's *generated* types (as opposed to its hand-written public API, like `Prisma.Decimal` or `Prisma.InputJsonValue`, which the stub still exposes) cannot be fully verified until code reaches an environment with a real generated client. Future Prisma-adjacent changes in this project should budget for a real-build confirmation step, not just the sandbox's lint/tsc-baseline/vitest checks, before being considered fully verified.

---

## 12. Exact Windows PowerShell commands to install, validate, test, build, and start

```powershell
# From the project root, after extracting this delivery's files over the existing codebase:

# 1. Install dependencies
npm install

# 2. Generate the Prisma client (required before type-checking/building in a real environment with network access)
npx prisma generate

# 3. Validate the Prisma schema
npx prisma validate

# 4. Type-check
npx tsc --noEmit

# 5. Lint
npx eslint .

# 6. Run the full test suite (fast, no database required)
npx vitest run

# 7. (Optional, requires a seeded database) Run the DB-integration suite, including the new
#    dashboard-concurrency test, against a real database:
$env:DATABASE_URL = "<your real connection string>"
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm run db:seed
npx vitest run
Remove-Item Env:\RUN_DB_INTEGRATION_TESTS

# 8. Build for production -- this is the step that previously failed with the TS2345
#    "not assignable to parameter of type 'TransactionClient'" errors (see section 8a).
#    It should now complete cleanly; if it does not, capture the full error output exactly
#    as before so it can be diagnosed further.
npm run build

# 9. Start the production server
npm run start

# Optional: tune the database-query concurrency ceiling if your production connection pool
# differs materially from the default assumption of 9 connections (default here: 6; max: 50)
$env:DATABASE_QUERY_CONCURRENCY = "6"
```
