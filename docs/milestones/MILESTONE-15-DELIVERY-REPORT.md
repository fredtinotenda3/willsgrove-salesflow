# Milestone 15 Delivery Report — Decision Intelligence

Built from your attached full specification, under your explicit
implementation authorization — the "M15 — Decision Intelligence / Full
Implementation Authorisation and Engineering Instructions" document,
containing the literal instructions: "This is an implementation
authorisation, not a request for another proposal or architecture
document... Do not stop after producing a specification," "Proceed with
full implementation now... Do not stop after inspection. Do not ask me
to approve another specification," and "M15 is complete only when the
implementation, recommendation lifecycle, tests, documentation and ZIP
delivery are finished." Delivered per your "continue where you left
off / return only zip of changed files" instruction. This report is the
spec-structured record of what was built and the honest state of
verification — see `docs/milestones/PROGRESS.md`'s Milestone 15 section
for the full design-decision rationale this report summarizes, and
`docs/milestones/m15-metric-definitions.md` for the authoritative
definition of every figure and rule this surface shows.

## 1. Scope recap

A new, management-only **Decision Intelligence** surface
(`/reports/decision-intelligence`) over existing M1/M5–M10/M12–M14
data, plus **one new, genuinely additive schema migration** (unlike
M13/M14, which were zero-schema-change) — a deterministic recommendation
engine and its persistence/lifecycle layer:

1. An **executive overview** — decision summary, priority attention
   queue (CRITICAL/HIGH only), and category/priority/confidence
   breakdowns, all derived from documented, explainable rules, never
   intuition.
2. A **16-rule catalogue** across five categories (SALES, CUSTOMER,
   PRODUCT, COMMERCIAL_EXPOSURE, OPERATIONAL), every rule reusing an
   EXISTING M8/M9/M12/M13/M14 calculation or classifier — never a
   second, parallel computation of a figure another milestone already
   owns.
3. A **recommendation lifecycle** (OPEN → ACKNOWLEDGED/IN_PROGRESS →
   RESOLVED/DISMISSED, both re-openable) with stable dedupe identity
   across regeneration, full history, and authenticated/audited status
   mutations.
4. A **decision-detail page** per recommendation — explanation,
   evidence metrics, source-record links (Customer/Product/Quotation/
   Order), confidence basis, recommended next action, and a full status
   timeline.

The authorization document was exhaustive and prescriptive (exact rule
thresholds would have been over-specification for a document of this
kind, but every classification *principle*, every lifecycle state,
every testing and documentation requirement, was specified in detail),
so this round proceeded directly to full implementation, with the
small number of genuinely open threshold choices (e.g. the exact dollar
floor for a "material" decline) made as documented, structural,
non-arbitrary cutoffs and recorded in
`docs/milestones/m15-metric-definitions.md` rather than left as an
unstated assumption.

## 2. What was actually built

### Schema (the one new migration this milestone)

`prisma/migrations/20261113060000_add_decision_intelligence/` adds:

- `DecisionCategory`, `DecisionPriority`, `DecisionConfidence`,
  `DecisionRecommendationStatus`, `DecisionRecommendationEventType` enums.
- `DecisionRecommendation` — the persisted recommendation row. Unique
  `dedupeKey` (the anti-duplicate identity), typed category/priority/
  confidence, an `evidence` JSON column (metrics + source records +
  confidence basis), optional FKs to `Customer`/`Product`/
  `User` (salesperson)/`Quotation`/`CustomerOrder` (all `onDelete:
  Restrict`), a plain non-FK `sapItemCode` (M14's own "display identity
  even when unmatched" convention), per-rule reporting period and
  optional `currencyCode` (null when the rule is not currency-specific
  — every currency-specific rule produces one row per currency
  instead), the full lifecycle status/note/actor/timestamp set, and
  `isDemo` (see §5 below for why this is currently always false).
- `DecisionRecommendationEvent` — an append-only child log mirroring
  `ApprovalEvent`'s own exact shape, one row per lifecycle transition.

### The pure rule engine (`lib/reporting/`)

Following the exact pure/Prisma-backed split M11–M14 established:

- **`decision-types.ts`** (pure types) — the category/priority/
  confidence/status enums (duplicated from, and kept byte-for-byte in
  sync with, the Prisma schema's own literals — deliberately, so the
  rule catalogue stays free of any `@prisma/client` import), the
  `DECISION_RECOMMENDATION_STATUS_TRANSITIONS` table and
  `isValidDecisionStatusTransition`, and the `RecommendationCandidate`/
  `DecisionEvidence`/`DecisionIntelligenceSummary` shapes every other
  module builds on.
- **`decision-priority.ts`** (pure) — `buildDedupeKey`,
  `classifyDeclinePriority`/`classifyRepeatedCountPriority` (the
  documented, structural priority cutoffs — see
  `m15-metric-definitions.md` §2), `percentDecline` (null-safe, never a
  fabricated decline from a zero baseline), and
  `sortForPriorityQueue`/`sortCandidatesByPriority` (deterministic
  priority-then-confidence-then-time ordering).
- **`decision-rules.ts`** (pure) — the full 16-rule catalogue. Every
  rule is a standalone, independently-testable function; see
  `m15-metric-definitions.md` §3 for every rule's exact thresholds and
  the existing M8/M12/M13/M14 calculation it reuses.
- **`decision-recommendations.ts`** (pure) — `evaluateAllDecisionRules`
  (runs the full catalogue over one `DecisionRuleRawInputs` bundle,
  rules never affecting one another) and
  `buildDecisionIntelligenceSummary` (the executive summary and
  CRITICAL/HIGH-only priority queue — no composite/blended score field
  anywhere in its output).
- **`decision-intelligence-validation.ts`** — the zod schema for the
  one mutation this milestone exposes
  (`updateDecisionRecommendationStatusSchema`: a valid status, an
  optional ≤2000-character note).

### The Prisma-backed layer (`decision-intelligence-queries.ts`)

- Fetches every rule's raw input by composing EXISTING M8/M9/M12/M13/
  M14 query shapes (qualifying-invoice rules, `AttributionConfidence`,
  customer recency, product commercial health, approval-overdue logic,
  etc.) — never re-deriving a calculation another milestone already
  owns.
- `evaluateAndSyncDecisionRecommendations` — runs the full catalogue
  then UPSERTS by `dedupeKey`: an existing row's `evidence`/`priority`/
  `confidence`/`lastEvaluatedAt` are refreshed, but `status` and every
  other lifecycle field are NEVER touched by regeneration (spec section
  5's anti-duplicate/preserve-history requirement). ALWAYS forces
  `includeDemo: false` for generation, regardless of the caller's own
  filters — see §5 below.
- `updateDecisionRecommendationStatus` — validates the transition via
  `isValidDecisionStatusTransition`, then writes the status change, a
  `DecisionRecommendationEvent`, and an `AuditEvent`, all inside one
  `prisma.$transaction` (spec section 6: reuse the EXISTING audit
  system, never a second one).
- `getDecisionIntelligencePageData` — a performance-focused addition
  that runs the (expensive) full rule-catalogue evaluation exactly
  ONCE and builds both the overview summary and the paginated
  recommendation list from the same evaluated candidate set, for the
  one page that needs both; `getDecisionIntelligenceOverview`/
  `listDecisionRecommendations` remain as independently-callable
  exports (each API route may be called standalone) and now share the
  same two extracted helpers internally rather than duplicating the
  assembly logic.
- `getDecisionRecommendationDetail`/`getDecisionRecommendationHistory`/
  `listAllDecisionRecommendationsForExport` complete the read surface.

### API routes (new)

| Route | Method | Access |
|---|---|---|
| `app/api/reports/decision-intelligence/route.ts` | GET | Overview summary. `requireManagementReportAccess` |
| `app/api/reports/decision-intelligence/recommendations/route.ts` | GET | Paginated/filtered recommendation list. Same access |
| `app/api/reports/decision-intelligence/recommendations/[id]/route.ts` | GET | Recommendation detail. Same access + `isValidId` |
| `app/api/reports/decision-intelligence/recommendations/[id]/history/route.ts` | GET | Full status-event history. Same access + `isValidId` |
| `app/api/reports/decision-intelligence/recommendations/[id]/status/route.ts` | POST | The one mutation. CSRF-origin check → `requireUserOrResponse(["SALES_MANAGER","ADMINISTRATOR"])` → `isValidId` → zod-validated body |
| `app/api/reports/decision-intelligence/recommendations/export/route.ts` | GET | CSV export of every filtered recommendation (never only the current page). Same access; records the export via the existing `recordReportExport` |

### UI

- **`app/reports/decision-intelligence/page.tsx`** — the overview:
  executive summary metric cards, category/priority/confidence
  breakdowns, the priority attention queue, the full filterable/
  paginated recommendation table, and a "related reports and records"
  section linking to Customer 360, Product 360, Sales Performance,
  Lost Sales, Invoice Claims, Returns & Credit Notes, Quotations,
  Orders, and Fulfilment — every link a real, verified existing route,
  never a placeholder.
- **`app/reports/decision-intelligence/[id]/page.tsx`** — the detail
  page: explanation, confidence basis, recommended next action, the
  evidence-metrics table, source-record links, and the full ordered
  status-history timeline.
- **`app/reports/decision-intelligence/[id]/status-panel.tsx`** — the
  one client component, driving the status-update mutation and
  refreshing the page on success.
- **`app/reports/_components/filter-bar.tsx`** — extended with three
  new optional dropdown filters (`decisionCategory`/`priority`/
  `recommendationStatus`), gated behind new `show*` props so no other
  report's filter bar changes shape.
- **`app/reports/page.tsx`** — a new "Decision Intelligence" nav tile,
  gated by the same `canSeeManagementReports` check every other
  management-only tile already uses.

## 3. Demo-data exclusion: a deliberate, stricter-than-usual rule (and the gap it almost left behind)

Because `DecisionRecommendation` rows are PERSISTED and SHARED (the
dedupe/history design the lifecycle depends on), generation ALWAYS
excludes demo data regardless of caller filters — stricter than every
M11–M14 report's own "excluded by default, opt-in via `includeDemo=true`"
convention, for the reason given in `m15-metric-definitions.md` §7:
a demo-sourced recommendation, once persisted, would keep reappearing
in every later non-demo read forever.

This produced a genuine, self-caught gap: `DecisionRecommendation`'s
own `isDemo` column and its `onDelete: Restrict` FKs onto `Customer`/
`Product`/`User`/`Quotation`/`CustomerOrder` mean
`scripts/remove-demo-data.ts` needed its own cleanup block for this
milestone's two new tables, correctly ordered AHEAD of every one of
those five entity types' own deletes — but the first pass at this
milestone's code had only documented that requirement in a comment,
without the actual cleanup block existing yet. Caught and fixed before
delivery: `DecisionRecommendationEvent` then `DecisionRecommendation`
are now deleted first in the transaction (ahead of even the Milestone
10 group, which was previously the earliest), filtered by `isDemo: true`
(expected to delete 0 rows today, for the same reason given above —
kept correctly ordered for if a future rule version ever needs
demo-inclusive generation).

## 4. A second real regression caught and fixed by actually running the full suite

Exactly the same shape of regression M14 caught in M13's filter test:
this milestone's own extension of `ReportFilters` (three new optional
fields — `decisionCategory`/`priority`/`recommendationStatus`) broke
the pre-existing `tests/reporting-filters.test.ts` "parses a full, valid
filter set" test's exact-equality assertion, which hadn't been updated
for the three new always-present (default-`null`) keys. Fixed properly,
per the spec's own "never weaken/skip/delete existing tests"
instruction: the three keys were added to the expected object, and one
new dedicated test case was added exercising the new fields' valid-
value acceptance and each one's independent enum-rejection (the same
centrally-validated treatment `orderStatus`/`quotationStatus`/
`claimStatus`/`lostSalesReason` already get).

A separate bug was also caught and fixed in this milestone's OWN new
test file (`tests/decision-rules.test.ts`): an assertion that the
`CUSTOMER_INSUFFICIENT_RECENT_ACTIVITY` explanation text should NOT
contain the word "churn" was backwards — the rule's actual, correct
explanation intentionally states "...this is an observation, not a
churn or inactivity classification," so the word legitimately appears
as part of the disclaimer. Fixed to assert the disclaimer's presence
instead of the word's absence.

## 5. TypeScript inference fix: 6 genuine issues, correctly distinguished from sandbox noise

Running `tsc --noEmit` surfaced 4 genuine-looking `TS2322`/`TS2345`
type-mismatch errors in `decision-intelligence-queries.ts` (e.g.
`customerName: {}` not assignable to `string`). Root-caused to bare
`new Map(arr.map(x => [x.id, x.name]))` constructions (no explicit
generic parameters) that infer oddly when fed by the sandbox
`@prisma/client` stub's `any`-typed query results with no contextual
expected type — confirmed by contrast against this file's own
`resolveProductNames`-style correctly-annotated helpers, which don't
exhibit the issue. **Fixed** by adding explicit `<string, string>`/
`<string, number>` generics to all 6 affected call sites, per the
spec's own explicit instruction to identify and fix real M15-introduced
errors rather than blanket-classify everything as pre-existing noise.
Re-running `tsc` confirmed every `TS2322`/`TS2345` error cleared from
this milestone's own files.

## 6. Role / permission matrix

| Surface | Route(s) | Access |
|---|---|---|
| Decision Intelligence overview + detail | `app/reports/decision-intelligence/*`, `app/api/reports/decision-intelligence/route.ts`, `.../recommendations/*` (GET routes) | `SALES_MANAGER`/`ADMINISTRATOR` only (`requireManagementReportAccess`) |
| Status mutation | `app/api/reports/decision-intelligence/recommendations/[id]/status/route.ts` | Same two roles, via `requireUserOrResponse`, plus CSRF-origin verification |

Enforced server-side on every route; the page-level redirect for a
`SALESPERSON` is a UX convenience only, never the security boundary —
the same standing rule every M11–M14 management report already
follows.

## 7. Documented scope decisions

- **One new migration** — the first reporting milestone since M11 to
  need one, because recommendations must be PERSISTED (M11–M14 are all
  pure read-time aggregation over existing tables).
- **No composite score anywhere** — every recommendation's `priority`
  and `confidence` are independent fields; `buildDecisionIntelligenceSummary`'s
  own tests assert no `compositeScore`/`overallRiskScore` key exists.
- **Every rule reuses an existing M8/M9/M12/M13/M14 calculation** — see
  `m15-metric-definitions.md` §3's per-rule reuse notes.
- **Currencies are never combined** — every currency-specific rule
  produces one recommendation per currency.
- **Demo data is unconditionally excluded from generation**, stricter
  than every prior reporting milestone, for the reason in §3 above.
- **CRITICAL is reserved for exactly two rules** representing an
  already-active exposure/bottleneck (`COMMERCIAL_CLAIM_EXPOSURE_BY_CURRENCY`,
  `OPERATIONAL_APPROVAL_BOTTLENECK`) — a decline, however severe, never
  reaches CRITICAL.

## 8. Tests executed and results

- **110 new unconditional tests, plus 1 extending a pre-existing file**,
  all passing:
  - `tests/decision-priority.test.ts` (21), `tests/decision-types.test.ts`
    (8) — full coverage of the two foundational pure modules.
  - `tests/decision-rules.test.ts` (60) — one `describe` block per rule
    function across all 16 rules: below-floor no-fire, at-floor fire
    with correct priority/confidence, every documented boundary
    transition, dedupeKey/entity-reference correctness, and
    category-specific invariants ("never implies a quality issue,"
    "confidence capped at MEDIUM," "never combines currencies").
  - `tests/decision-recommendations.test.ts` (9) — the orchestrator:
    empty-input, independent per-rule evaluation, scalar-aggregate
    evaluation, union-not-merge of unrelated firing rules, and the
    summary's tallying/priority-queue-filtering/sorting/no-composite-
    score behavior.
  - `tests/decision-intelligence-access.test.ts` (11) — access-control
    tests exercising the REAL `requireManagementReportAccess()`/
    `requireUserOrResponse()` functions directly (mocking only session
    resolution), plus `isValidId` and the status-update zod schema.
  - `tests/reporting-filters.test.ts` — 1 new dedicated test case for
    the three new `ReportFilters` fields, plus the regression fix (§4).
- **A new gated DB-integration test file**
  (`tests/decision-intelligence-db.integration.test.ts`,
  `RUN_DB_INTEGRATION_TESTS=1`, 13 tests) covering recommendation
  creation + dedupe-on-regeneration, the full lifecycle (self-
  transition rejection, a complete status walk with `resolvedAt`
  handling, illegal-transition rejection, full event-history
  preservation), confirmation that regeneration never resets lifecycle
  state, detail/list/overview surfacing, and a dedicated proof test for
  the demo-exclusion rule (§3). Documents, in its own header comment,
  the one deliberate departure from this project's usual test-fixture
  convention: its fixtures must use `isDemo: false` (not the usual
  `isDemo: true`) to be visible to the rule engine at all, with explicit
  manual cleanup in `afterAll` since the normal demo-removal sweep
  would never catch them. Confirmed to self-skip cleanly with
  `RUN_DB_INTEGRATION_TESTS=1` set and no `DATABASE_URL` present — not
  actually run against a real database from inside this sandbox.
- **Full-project regression**: `npx vitest run` — **875 passed, 158
  skipped, 0 failed** (up from 765 passed / 145 skipped after Milestone
  14 — net +110 passed / +13 skipped, all new M15 tests). **Zero
  regressions in any pre-existing test** — the one pre-existing test
  that would have regressed (`tests/reporting-filters.test.ts`) was
  caught and properly fixed, as detailed in §4.

## 9. Honest `tsc` / lint / `prisma` / build results

- **`npx eslint .`** — clean across the whole project, including every
  file this milestone added or edited.
- **`npx tsc --noEmit`** — 674 errors (up from 630 after Milestone 14).
  The +44 isolate entirely to `decision-intelligence-queries.ts` (41)
  and the one new DB-integration test file (3) — confirmed by grep to
  fall ENTIRELY into the same pre-existing, sandbox-`@prisma/client`-
  stub categories already documented in every prior milestone
  (`TS2305` missing enum exports, `TS2694` missing `Prisma` namespace
  members, `TS7006` implicit-any on callback parameters fed by the
  stub's `any`-typed query results). **Zero new `TS2322`/`TS2345`
  errors** in any M15 file — the 4 genuine-looking mismatches found
  mid-round were real and were fixed (§5), not blanket-classified as
  noise; the 9 `TS2322` and 9 `TS2345` errors still present in the full
  project total are confirmed, by file, to be pre-existing M11–M14
  issues (`customer-insights-queries.ts`, `product-demand-queries.ts`,
  `product-insights-queries.ts`, `product-revenue-queries.ts`,
  `sales-performance.ts`, `match-invoice.ts`, `price-list-import.ts`,
  `quotations/create.ts`) — none in any file this milestone touched.
  Confirmed by grep that this milestone's own new page, API-route, and
  pure-module files carry **zero** type errors.
- **`npx prisma validate` / `npx prisma generate`** — could not run.
  Confirmed by direct reproduction this round (including past the
  `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` checksum-bypass env var) to
  be the identical `binaries.prisma.sh` 403-Forbidden network-egress
  block documented since Milestone 4 — the actual engine binary itself
  cannot be downloaded in this sandbox, not merely its checksum.
- **`npm run build`** — fails at the identical, pre-existing
  `next/font/google` Google Fonts network block, confirmed unrelated to
  any file this milestone touched (the failure occurs during
  root-layout module evaluation in `app/layout.tsx`, before any
  `/reports` route is ever reached).
- **Not run in this sandbox**: `npx prisma migrate dev`/`deploy` for
  the new migration, and this milestone's gated DB-integration tests
  against a real database — both blocked by the same documented
  sandbox restrictions above.

## 10. Non-goals honored

No LLM-fabricated recommendation anywhere — every candidate is produced
by a pure, hand-auditable function over already-fetched data. No
composite/blended score, no arbitrary scoring, no unsupported financial
calculation. No second audit system — every mutation reuses the
existing `AuditEvent` table. No currency ever combined or converted. No
claim ever counted as an issued credit note. No lost sale ever given an
estimated dollar value. No delivery rejection or return ever treated as
proof of a product-quality defect. No customer ever labelled
lost/inactive without the explicit, documented recency rule.

## Files changed

See `CHANGES.md`'s Milestone 15 section for the complete file-by-file
list: 1 new migration, 6 new `lib/reporting/` files, 1 additive edit to
`scripts/remove-demo-data.ts`, 6 new API routes, 3 new UI files plus 2
additive edits to existing pages, 6 new test files plus 1 additive edit
to an existing test file, and this documentation set.

## Exact Windows PowerShell commands

See `SETUP-WINDOWS.md`'s new Milestone 15 section for the full,
copy-pasteable sequence: applying the new migration, regenerating the
Prisma client, running the 5 new unconditional test files, the gated
DB-integration test file and its preconditions, and a manual test
script covering the overview, the detail page, the status mutation,
and CSV export.
