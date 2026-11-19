# IMPLEMENTATION REPORT — Real Business Data Onboarding, Customer Pricing, Lost Sales Redesign and Invoice Claims Implementation

**Round:** 5 (Phases 1–10, spec parts A–G)
**Scope documents supplied:** the round's own spec (pasted, see disclosure below), plus three real business-data workbooks: `Prices.xlsx`, `List_of_Business_Partners.xlsx`, `Items_List.xlsx`.

---

## 0. Disclosure: spec text availability during Phase 8–10

This round's work spans several separate working sessions. Partway through (after Phase 7, before Phase 8), a context compaction occurred, and the literal text of the original pasted specification became unrecoverable for the remainder of the round — confirmed by exhaustively checking every uploaded attachment available in the session (none contained Round 5's content) and the session's own stored transcript (it held only a prior summary, not the original pre-compaction messages).

From that point on (Phase 8, Phase 9, and this report), work proceeded from the task tracker's own detailed, section-numbered descriptions of what each phase must do (which paraphrase the spec accurately enough to act on) plus direct, grounded inspection of the actual codebase — never from reconstructed or guessed spec wording. Every place this affected a judgment call is disclosed inline, in that phase's own code comments and in this report, rather than silently papered over. Phases 1–7 were completed before this gap and are reported from the work itself.

---

## 1. What this round changed, in one paragraph

Willsgrove's real business data (customer master, SAP price lists, item master) is now onboarded into the application through validated, idempotent, human-confirmed import pipelines instead of ad hoc/broken ones. Customers can be assigned a real SAP price list, and that assignment now feeds lost-sale value estimation. The obsolete "Customer Decision" workflow was removed in favor of fully automatic lost-sale recording — both from supply shortages at picking time (already existing automation, extended) and, new this round, from goods confirmed lost via a returned invoice claim (damaged/expired/otherwise unsellable, as opposed to resalable). That new "Source C" loss figure is surfaced everywhere the existing claims-exposure (Source A) and supply-shortage (Source B) figures already were — the financial exposure report, its CSV export, and the management dashboard — with an explicit, honest warning that it can describe the *same* claim as Source A and must never be summed with it. Navigation was corrected to match the business's current terminology. Nothing destructive was done to the database at any point; every migration is additive and hand-verified (this sandbox cannot run `prisma generate`/`validate`).

---

## 2. Phase-by-phase summary

### Phase 1 — Repository + business-data audit (task #206)
Extracted the round's zip, inspected the Prisma schema, the existing customer-decision code, lost-sales code, invoice-claims code, and the existing (broken) customer-master-import service, plus all three supplied Excel workbooks, to produce a grounded data inventory before any code changed.

### Phase 2 — Diagnose customer-master-import CSV failure (task #207)
Compared the real `List_of_Business_Partners.xlsx` row-by-row against the CSV the import pipeline expected, traced the actual import code path, and identified the exact root cause of the failure (not assumed).

### Phase 3 — Reliable customer master import (task #208)
Rebuilt the customer-master-import pipeline: preview, validation, idempotency, new/updated/skipped/rejected counts, a confirmation step, an audit record, and `isDemo=false` for every real row.

### Phase 4 — Customer-specific pricing + pricing management (tasks #209, #216, #217, #218)
- **4a** — `lib/sap-price-list-xlsx.ts`: reads the real 7-sheet `Prices.xlsx` directly via `exceljs`. Each sheet's `priceListCode` is *derived* from the mode of its own "Base Price List" column, never hardcoded; item codes are normalized against the real `Items_List.xlsx` CODE format; blank-price rows are skipped, never fabricated as zero; the small number of `Manual='Y'` anomaly rows are trusted as-is (confirmed they don't equal `Base Price × Factor`, so re-deriving them would be wrong). Wired into the existing plan/execute import engine alongside the pre-existing CSV path — preview/confirm human-in-the-loop flow unchanged.
- **4b** — Customer Pricing management page: `priceListId` assignment (assign/unassign), audited, with a clean 400 on an unknown price-list id rather than a 500. A first draft of this page's footer copy overstated how the price list is used; corrected after grepping the real consumer (only lost-sale value estimation reads it today — new orders are not yet priced from it).
- **4c** — Integration tests plus a genuine latent bug found and fixed in the *pre-existing*, unmodified import engine: price comparison used raw string equality against a `Decimal(18,4)` column, so a trailing-zero price (`"0.70"` vs. the DB's `"0.7"`) would have been marked "changed" on every future re-import forever — a real `Prices.xlsx` row confirmed this wasn't theoretical. Fixed with `Prisma.Decimal(...).equals(...)`, this codebase's own established exact-decimal pattern, for both the CSV and xlsx import paths.
- Final Phase 4 verification: `tsc` 780 (same stub-driven categories only), `eslint` clean, `vitest` 964 passed / 2 pre-existing unrelated failures.

### Phase 5 — Remove Customer Decision + automatic shortage lost sales (task #210)
Fully removed the Customer Decision workflow from UI, API, and schema (migration `20261116140000_remove_customer_decision_workflow`), and implemented fully automatic shortage-based lost-sales creation at picking time — no human decision step remains for this path.

### Phase 6 — Returned-claim lost sales + Invoice Claims Management (task #211)
Investigated first and found that Invoice Claims Management and Returns & Credit Notes were *both already fully built* in an earlier milestone (predating this round) — confirmed via `docs/milestones/PROGRESS.md` and direct code reads — and that a separate, unrelated "Final Operational Enhancements" feature only tags delivery-outcome reasons and touches nothing about returns or lost sales.

Implemented automatic lost-sales recognition hooked into the existing `recordClaimReturn()`, using the already-recorded `ReturnCondition` (GOOD_RESALABLE vs. DAMAGED/EXPIRED/OTHER) as the concrete signal for genuine loss:
- New model `ClaimReturnLostSale` (1:1 with `ClaimReturn`), deliberately **not** a reuse of `LostSaleRecord` (whose `unfulfilledDemandId` is a required FK into picking-time lineage a returned claim has none of — reusing it would mean either relaxing that column's meaning or fabricating a synthetic picking record, both rejected).
- Price/value **never invented**: null unless the return is scoped to a specific claim line *and* that line's real, already-invoiced `SapInvoiceLine.unitPrice` is on record; value = that real price × the actual received quantity, never the customer's disputed price or disputed quantity.
- Surfaced on the existing `/invoice-claims/[id]` page (no new page needed).
- Migration `20261117090000_add_claim_return_lost_sales` — entirely additive, hand-verified against the schema model (see §4).

### Phase 7 — Claims analytics (task #212)
Investigated first and confirmed `lib/reporting/financial-exposure.ts` — which already implements an explicit "never blend separate lost-sales figures into one number" Source A (claims exposure) / Source B (supply shortage) split — is the correct, established home for this new figure, not a new page.

Added **Source C** (confirmed loss from returned goods): a new `getReturnedGoodsLostSalesValue()` query, wired into the financial-exposure report, its UI (now 3 columns), its CSV export, and a new management-only dashboard KPI tile. The module comment, the report's `note` string, and the KPI's `definition` field all carry the same explicit warning: **Source C is not a third independent pool addable to A + B** — it can describe the *same* claim Source A already covers, just measured from the return's own confirmed condition rather than the dispute's claimed value, so summing it with Source A for the same claim would double-count.

### Phase 8 — Navigation corrections (task #213)
Task wording used "Operations"/"Sales Management" terminology not literally present in the codebase's own section names ("SALES OPERATIONS", "FULFILMENT", "AFTER-SALES"), and the original spec text for this section was the first casualty of the mid-round compaction (§0). Investigated directly: no "Delivered Orders" duplicate existed anywhere under a sales-facing section (so half the requirement was already satisfied); grounded the rest on the most literal, internally-consistent reading — pairing "Delivered Orders" (already under FULFILMENT) with "Invoice Claims Management" under one common target.

Renamed the "FULFILMENT" sidebar section to "OPERATIONS" and moved "Invoice Claims" into it from "AFTER-SALES" (positioned after "Delivered Orders"). Nothing else in AFTER-SALES was touched, since nothing else was named by the task. The reasoning and the spec-text caveat are documented directly in `sidebar.tsx`'s own module comment.

### Phase 9 — Migrations, permissions, regression tests (task #214)
- **Migrations**: confirmed the one schema change this round (Phase 6's `ClaimReturnLostSale`) has its migration, and hand-verified it column-by-column and FK-by-FK against the schema model (this sandbox cannot run `prisma validate`/`generate` — see §4).
- **RBAC/permissions**: confirmed, by direct source inspection, that every new surface this round inherits an *existing*, unchanged permission boundary rather than needing a new one — the automatic `ClaimReturnLostSale` creation runs inside an already-gated transaction; the new "Confirmed Loss (Returned Goods)" KPI tile correctly carries `visibility: "management"`, which `app/page.tsx` enforces server-side (`kpi.visibility === "all" || isManagement`); the financial-exposure report and its export sit behind their existing auth check; the Phase 8 nav move carries no `roles` restriction, consistent with the destination page's own (any authenticated user). No RBAC gap or regression was found.
- **Tests**: extended the existing end-to-end dashboard-orchestration integration test with explicit assertions that the new KPI tile is actually produced by the real orchestration path and carries `visibility: "management"`, plus the same regression guard on its two sibling tiles. This follows the project's own established convention (there is no dedicated permissions-test file anywhere in this codebase; access control is tested at the route/function level) rather than inventing new test infrastructure.

### Phase 10 — Final verification + packaging (task #215, this report)
See §4 (verification) and §5 (delivery contents) below.

---

## 3. Database changes this round

Two migrations, both reviewed in order; both are **purely additive or purely removing a feature's own tables/columns** — no change to any other existing table, column type, nullability, or enum value:

| Migration | Effect |
|---|---|
| `20261116140000_remove_customer_decision_workflow` | Removes the obsolete Customer Decision workflow's own schema (Phase 5). |
| `20261117090000_add_claim_return_lost_sales` | Adds the new `ClaimReturnLostSale` table, its 4 indexes (1 unique), and its 5 restrict-on-delete foreign keys (Phase 6). Hand-verified column-for-column and FK-for-FK against `prisma/schema.prisma`'s own model this round, since `npx prisma validate`/`generate` both return `403 Forbidden` in this sandbox (pre-existing, documented network restriction, unrelated to this round). |

**No destructive operation was run or attempted against any database this round.** No `DATABASE_URL` was available in this sandbox at any point; no reset script, migration-reset, or production import was executed.

---

## 4. Final verification (exact results, this session)

| Check | Result |
|---|---|
| `npx eslint .` (repo-wide) | **Clean** — 0 errors, 0 warnings. |
| `npx tsc --noEmit` | **788 errors** — entirely the pre-existing, already-documented baseline caused by this sandbox's non-functional `@prisma/client` stub (every Prisma-typed field resolves to `any`/`{}`, which cascades into a stable, previously-characterized set of TS2694/TS2339/TS7006 errors; see `docs/milestones/PROGRESS.md`'s Milestone 16 section for how this baseline was first established). Tracked category-by-category through every phase of this round; **zero new error categories introduced**, only new instances within already-known categories, each traced to an exact new file/line. |
| `npx vitest run` (full suite) | **964 passed / 229 skipped / 2 failed** (1195 total; 62 passed / 1 failed test files of 92). The 2 failures are `tests/acceptance-item-0228.test.ts`, pre-existing and unrelated — a missing fixture file (`ENOENT` on `test-data/sample-customer-master.csv`), confirmed by inspection to be untouched by any work in this round. |
| `npm run build` (`next build`) | **Fails**, at the identical, pre-existing `next/font/google` Google Fonts network wall already documented in this project since early milestones (`next.config.ts`'s own comment references it) — re-confirmed this round to be unrelated to any file this round touched. This sandbox's outbound network access is allowlisted and does not reach `fonts.googleapis.com`. |
| `npx prisma validate` / `generate` | Blocked by the same `403 Forbidden` network restriction documented since early milestones. Every migration this round was instead hand-verified against the schema (see §3). |
| DB-integration tests (`RUN_DB_INTEGRATION_TESTS=1`) | **Not run** — no `DATABASE_URL` was available in this sandbox. Every new test this round follows this project's existing `describe.skipIf(!RUN_DB_INTEGRATION_TESTS)` convention and is registered, correctly skipped, and ready to run in an environment with a real seeded database. |

One unrelated item surfaced by `npm run build`'s own tooling, not by this round's work: an npm/Next CLI prompt recommending `next upgrade --agent=security`. This was **not** run — it is an unrequested dependency/framework upgrade outside this round's scope and outside this session's authorization to perform unapproved changes. It is noted here for Willsgrove's own consideration, not acted on.

---

## 5. Delivery contents

This ZIP contains **only files created or modified during this round** (76 files), established mechanically by comparing each file's modification time against this round's extraction baseline (every unmodified file in the project shares one identical baseline timestamp from extraction; every file below has a later one) — not from memory or an assumed list. No `node_modules`, `.next`, `.git`, `tsconfig.tsbuildinfo` (TypeScript's own incremental build cache), `.env*` file, or credential is included.

- **Schema & migrations**: `prisma/schema.prisma`, both migrations listed in §3.
- **Application code**: `app/**` (pages + API routes touched this round — customer master import, price-list import/pricing, lost sales, invoice claims, financial-exposure report, sidebar), `lib/**` (customer, price-list, lost-sales, reporting, returns-credits modules touched this round).
- **Tests**: every `tests/*.ts` file created or extended this round (unit and DB-integration).
- **`package-lock.json`**: reflects a dependency added earlier in this round (e.g. `exceljs` for the xlsx price-list parser).
- **`business-data/customer-master-import.csv`**: the validated, real-data CSV produced during Phase 2/3's customer-master-import work, derived from the supplied `List_of_Business_Partners.xlsx`. **Flagged explicitly here because it is real customer business data embedded in this delivery's file set** (not fabricated — produced by the verified Phase 2/3 conversion from the real source workbook) — Willsgrove should handle this file per its own data-handling policy and confirm it is not needed in the delivered form before it leaves their hands, since this report's scope does not include that policy decision.

No script file (`scripts/*.ts`) was created or modified this round — none is included because none changed.

---

## 6. Known limitations and recommended next steps for Willsgrove

1. **Run the DB-integration suite against a real seeded database** (`npm run db:seed` then `RUN_DB_INTEGRATION_TESTS=1 npm test`) before go-live — this sandbox never had a live database, so this round's new tests (and every pre-existing one) have only ever been verified as correctly *written and skipped*, never executed against real Postgres.
2. **Run `npx prisma validate` and `npx prisma generate` in an environment with real network access** before deploying — this sandbox's `403` block on `binaries.prisma.sh` meant every migration this round was verified by hand-reading SQL against the schema, which is a lower bar than the tool's own validation.
2a. Apply both migrations listed in §3, in order, to the target database with `prisma migrate deploy`; run `prisma migrate status` first if there is any chance either has already been partially applied elsewhere.
3. **Decide on `Customer Pricing`'s current scope**: as documented in Phase 4b, a customer's assigned price list is not yet used to price new orders — only to estimate lost-sale value. If Willsgrove expects order pricing to be driven by this assignment, that is separate, not-yet-built scope.
4. **Review `business-data/customer-master-import.csv`** per §5 before this delivery is shared further.
5. The `next upgrade --agent=security` recommendation surfaced by this round's own build attempt (§4) was deliberately left for Willsgrove to evaluate and run themselves, not executed here.
