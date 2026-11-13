# Milestone 15 — Decision Intelligence: metric definitions

This document records, in one place, exactly what every Milestone 15
figure means, how it is computed, and which documented limitation
applies to it — the same reason `m11/m12/m13/m14-metric-definitions.md`
do: so a manager reading `/reports/decision-intelligence` can trust what
a recommendation means without reading the rule code, and so a future
engineer changing this code knows which rule is deliberate and which is
an honestly-documented workaround.

## 1. Why this milestone exists

Milestones 11–14 gave Willsgrove SalesFlow operational, sales,
customer- and product-level reporting, but every one of those reports
is a human reading numbers and deciding what matters. Milestone 15
closes that gap with a **deterministic recommendation engine**: a
documented, explainable rule catalogue that scans the SAME existing
M9–M14 data and surfaces what needs a decision-maker's attention —
never an LLM call, never a fabricated number, never an intuition-based
judgment. Every recommendation traces to a named rule, a rule version,
and the exact evidence that fired it.

Two structural guarantees hold throughout this milestone, stated once
here rather than repeated at every section:

- **No new source-of-truth calculation.** Every rule's input is fetched
  by composing the EXISTING M11–M14 query functions and rules (SAP
  invoice-line qualifying-invoice logic, M12's attribution-confidence
  classifier, M13's customer revenue/recency rules, M14's product
  revenue/commercial-health rules) — never a second, parallel
  computation of a figure another milestone already owns.
- **No composite score.** Every recommendation carries its own
  independent `priority` (CRITICAL/HIGH/MEDIUM/LOW/INFORMATIONAL) and
  `confidence` (HIGH/MEDIUM/LOW/INSUFFICIENT_DATA) — there is no
  blended "risk score," "health score," or ranking number anywhere in
  this milestone's schema, evidence payload, or UI.

## 2. Priority and confidence: documented, structural cutoffs — never intuition

Per spec section 3.2's explicit requirement ("priorities derived from
documented, explainable rules — never intuition-based"), every priority
and confidence value in this milestone comes from one of a small number
of named, reusable classification functions in
`lib/reporting/decision-priority.ts`:

- **`classifyDeclinePriority(declinePercent)`** — HIGH at ≥ 75% decline,
  MEDIUM at ≥ 40%, LOW otherwise. **Never returns CRITICAL** — a
  decline, however severe, is still read as a trend to investigate, not
  an active incident; CRITICAL is reserved for the two rules below
  where a backlog or exposure figure is itself already an active
  operational/financial event (`OPERATIONAL_APPROVAL_BOTTLENECK`,
  `COMMERCIAL_CLAIM_EXPOSURE_BY_CURRENCY`).
- **`classifyRepeatedCountPriority(count, highThreshold)`** — HIGH at or
  above the rule's own documented `highThreshold`, MEDIUM below it (the
  rule's own "fire" floor has already been checked by the caller before
  this runs).
- **`percentDecline(current, previous)`** — returns `null` (never a
  fabricated 100%) when `previous` is zero or negative; otherwise
  `((previous - current) / previous) * 100`, clamped so a current value
  that INCREASED never reports as a negative "decline."
- **`buildDedupeKey(ruleId, primaryEntityKey)`** — `"${ruleId}:${primaryEntityKey}"`,
  the stable identity that survives regeneration (see section 5 below).
- **`sortForPriorityQueue`/`sortCandidatesByPriority`** — priority rank
  first (CRITICAL highest), confidence rank as the tie-break, then
  detection time — deterministic, reproducible ordering with no random
  or LLM-influenced component.

Every rule function in `lib/reporting/decision-rules.ts` additionally
documents, in its own comment, the **confidence basis** for its
classification — carried through unchanged into
`evidence.confidenceBasis` on the persisted recommendation, so a
manager never has to take a confidence label on faith.

## 3. The 16-rule catalogue (spec section 4)

Every rule is a pure function (`lib/reporting/decision-rules.ts`): it
takes already-fetched plain data and returns zero or one
`RecommendationCandidate` — no database access, no LLM, no randomness.
`lib/reporting/decision-recommendations.ts`'s `evaluateAllDecisionRules`
runs every rule independently over its own input slice; one rule firing
or not firing never affects another's output (unit-tested directly in
`tests/decision-recommendations.test.ts`).

### SALES (reuses Milestone 12 exactly — never re-derives)

1. **`SALES_UNVERIFIED_ATTRIBUTION_CONCENTRATION`** — a salesperson whose
   share of UNVERIFIED-attribution orders (M12's own
   `AttributionConfidence` classifier — never a re-derived confidence
   figure) is unusually high. Minimum sample 5 orders (below that,
   no recommendation — too small a base to classify); HIGH-confidence
   band only reachable past 50%/80% share thresholds (MEDIUM/HIGH
   priority), and **confidence is capped at MEDIUM always** — this rule
   flags a pattern worth investigating, never a verified fact about a
   named salesperson's conduct, per spec section 3.3's "never treat
   unverified attribution as verified" instruction.
2. **`SALES_UNRESOLVED_QUOTATIONS_BACKLOG`** — a salesperson with ≥ 3
   quotations past `validUntil` and still `ISSUED` as of the reporting
   date (floor 3, HIGH at ≥ 8). **Never treats a quotation or order as
   realised revenue** — this counts open commitments, not booked sales.

### CUSTOMER (reuses Milestone 13 exactly)

3. **`CUSTOMER_DECLINING_VALUE`** — a customer's SAP invoice line value
   in a currency has declined vs. the immediately preceding period of
   equal duration (M13's own per-currency decline computation). A
   $500 materiality floor (same currency units, never converted)
   excludes a real-but-too-small-to-act-on decline; 40%/75% decline
   bands map to MEDIUM/HIGH priority (never CRITICAL — see section 2).
4. **`CUSTOMER_REPEATED_CLAIMS_RETURNS`** — floor 2 combined
   claims+returns, HIGH at ≥ 4.
5. **`CUSTOMER_UNRESOLVED_QUOTATIONS`** — floor 1 expired-and-still-ISSUED
   quotation, HIGH at ≥ 3.
6. **`CUSTOMER_INSUFFICIENT_RECENT_ACTIVITY`** — **always INFORMATIONAL**
   priority. Confidence is `INSUFFICIENT_DATA` when the customer has no
   order history at all (there is nothing to measure "recency" against);
   otherwise HIGH confidence, reusing M13's own 180-day recency
   threshold. The explanation text explicitly states this is "an
   observation, not a churn or inactivity classification" — per spec
   section 3.4's "never label a customer lost/inactive without an
   explicit documented rule," this rule documents a fact (days since
   last qualifying invoice) and deliberately stops short of inventing a
   churn label the data doesn't support.

### PRODUCT (reuses Milestone 14 exactly)

7. **`PRODUCT_DECLINING_ACTIVITY`** — same 40%/75% decline-band
   structure as rule 3, applied to a product's per-currency SAP invoice
   line value, with a $300 materiality floor.
8. **`PRODUCT_REPEATED_CLAIMS_RETURNS`** — floor 2, HIGH at ≥ 4. **Never
   implies a quality defect** — the explanation states this is a claim/
   return VOLUME observation, consistent with M14's own "never assume
   returns = defective" rule.
9. **`PRODUCT_SIGNIFICANT_LOST_DEMAND`** — floor 10 units of confirmed
   `LostSaleRecord` quantity (never an inferred lost sale), HIGH at ≥
   50. **Quantity only — no estimated monetary value is ever
   calculated** for a lost sale, per spec section 3.5's "never recommend
   purchase quantities without inventory evidence" and M14's own
   "never fabricate a lost-revenue dollar figure" discipline.
10. **`PRODUCT_DELIVERY_REJECTIONS`** — floor 2 rejected-quantity events
    (M14's own `DispatchLine.createdAt`-based cohort view), HIGH at ≥ 5.
    **Never implies a quality issue** — a delivery rejection is an
    operational/logistics fact, not a product-defect classification
    (spec section 3.7: "never imply delivery failure = product-quality
    issue").
11. **`PRODUCT_INSUFFICIENT_MASTER_DATA`** — **always INFORMATIONAL**
    priority, **always INSUFFICIENT_DATA** confidence. Fires for an
    unmatched SAP item code (real invoice activity, no `Product` master
    row) or a matched product with no `category` — the same two cases
    M14's own master-data-quality dimension already surfaces, never a
    judgment about the product itself.

### COMMERCIAL_EXPOSURE (currency-separated, never combined, never double-counted)

12. **`COMMERCIAL_CLAIM_EXPOSURE_BY_CURRENCY`** — recorded claim exposure
    in one currency, banded at $500/$1,000/$5,000 → MEDIUM/HIGH/CRITICAL.
    **One recommendation per currency** — a claim exposure spanning two
    currencies produces two independent candidates, never a summed or
    converted total (spec section 3.6/7.2: "never combine currencies").
    This is one of exactly two rules in the whole catalogue that can
    reach CRITICAL (the other is `OPERATIONAL_APPROVAL_BOTTLENECK`) —
    both represent an already-active exposure or bottleneck, not a mere
    trend.
13. **`COMMERCIAL_CREDIT_NOTE_BACKLOG_BY_CURRENCY`** — an UNMATCHED
    (unresolved) credit-note backlog in one currency: fires at count ≥ 2
    OR amount ≥ $500 (either condition alone is enough — a small number
    of very large notes and a large number of small notes are both
    worth surfacing), HIGH at count ≥ 5. **Never counts a claim as an
    issued credit note, and never adds claim exposure to credit-note
    totals** — these are structurally separate figures throughout (spec
    section 3.6's "never count a claim as an issued credit note").

### OPERATIONAL (existing statuses/dates only — never a new event type)

14. **`OPERATIONAL_APPROVAL_BOTTLENECK`** — count of overdue
    `ApprovalRequest` rows (M8's existing SLA/overdue logic, never
    re-derived). Floor 1, HIGH at ≥ 5, **CRITICAL at ≥ 10** — the
    second of the two rules in this catalogue that can reach CRITICAL.
15. **`OPERATIONAL_UNFULFILLED_DEMAND_BACKLOG`** — count of open
    `UnfulfilledDemand` rows awaiting a customer decision. Floor 5, HIGH
    at ≥ 20.
16. **`OPERATIONAL_ORDERS_AWAITING_FULFILMENT`** — count of orders
    awaiting dispatch/delivery past the existing fulfilment-status
    model. Floor 5, HIGH at ≥ 20.

Rules 14–16 read EXISTING statuses and dates only (`ApprovalRequest`'s
own overdue computation, `UnfulfilledDemand.status`,
`CustomerOrder`/`DispatchRecord`'s own existing fulfilment lifecycle) —
no new event type, timestamp, or status value was added anywhere in
this milestone's schema to support them (spec section 3.7/7: "never
invent events").

## 4. The recommendation lifecycle (spec section 5)

`DecisionRecommendationStatus`: `OPEN → ACKNOWLEDGED/IN_PROGRESS/
RESOLVED/DISMISSED`, with `RESOLVED`/`DISMISSED` both re-openable back
to `OPEN` (a later rule re-evaluation, or a human, may determine the
underlying issue recurred or was dismissed in error) — see
`DECISION_RECOMMENDATION_STATUS_TRANSITIONS` in
`lib/reporting/decision-types.ts` for the exact, unit-tested transition
table. Self-transitions (`OPEN → OPEN`, etc.) are always rejected.

**Stable identity, never an uncontrolled duplicate.** Every
recommendation's `dedupeKey` is `"${ruleId}:${primaryEntityKey}"` —
regenerating the catalogue (every time the overview or list is loaded)
UPSERTS by this key: an existing row has its `evidence`/`priority`/
`confidence`/`lastEvaluatedAt` refreshed, but `status`/`statusNote`/
`statusById`/`statusAt`/`resolvedAt` are NEVER touched by regeneration
— only `updateDecisionRecommendationStatus` (the one authenticated,
audited mutation) changes lifecycle state. A recommendation whose rule
no longer fires is left in place with its last-known evidence rather
than deleted, since deleting it would destroy the history/
accountability trail section 6 requires; its `lastEvaluatedAt` simply
stops advancing.

## 5. Decision history and accountability (spec section 6) — reusing the EXISTING audit system

Every lifecycle mutation is recorded in TWO places, both existing
infrastructure, never a second parallel audit system invented for this
milestone:

- **`DecisionRecommendationEvent`** — a lightweight, append-only child
  log next to the stateful `DecisionRecommendation` parent, mirroring
  `ApprovalEvent`'s own exact shape (the established precedent for this
  pattern in this project). One row per `CREATED`/`REEVALUATED`/
  `ACKNOWLEDGED`/`STARTED`/`RESOLVED`/`DISMISSED`/`REOPENED` transition.
- **`AuditEvent`** — the project's single, existing, cross-milestone
  audit table. Every status mutation also writes an `AuditEvent` inside
  the SAME database transaction as the status change and the
  `DecisionRecommendationEvent` write (`prisma.$transaction`), so the
  three can never diverge.

## 6. Metrics and data-integrity rules (spec section 7)

- **SAP financial authority.** Every money figure a rule evaluates is
  sourced from the SAME qualifying-`SapInvoiceLine` rule M9–M14 already
  established — never a re-derived or independently-computed SAP total.
- **Currency separation, no invented exchange rates.** Every
  currency-denominated rule (3, 7, 12, 13) produces one recommendation
  PER CURRENCY; there is no cross-currency total, no assumed exchange
  rate, anywhere in this milestone.
- **Reuse, not re-derivation.** Sections 3's per-category notes above
  list, rule by rule, exactly which M12/M13/M14 query function or
  classifier each rule's input comes from.
- **Distinct claims/returns/credit-notes figures.** Rules 4/8 (claims+
  returns) and 12/13 (claim exposure vs. credit-note backlog) are never
  merged into one figure — see section 3's COMMERCIAL_EXPOSURE notes.
- **Business timezone and as-of date.** `resolveAsOfDate` (M13's own
  `lib/reporting/customer-recency.ts`, reused verbatim, never
  reimplemented) resolves the reporting "as of" date as `dateTo` when
  the caller supplied one, otherwise the current business date in
  `Africa/Harare` (`currentBusinessDateInHarare`) — never a bare UTC
  `new Date()`, which could read as the wrong calendar day while Harare
  (UTC+2) is still on the previous date. Used by every rule that needs
  "as of today" semantics (customer recency, quotation-expiry
  backlogs).
- **Data-freshness display.** Every recommendation's `lastEvaluatedAt`
  is shown on the detail page, so a manager can see exactly when a
  recommendation's evidence was last refreshed — never presented as
  live/real-time when it is in fact the last regeneration's snapshot.

## 7. Demo-data exclusion — a deliberate, documented departure from the M11–M14 convention

`evaluateAndSyncDecisionRecommendations` (and its internal
`fetchDecisionRuleRawInputs`) ALWAYS forces `includeDemo: false` when
generating recommendations, regardless of the caller's own
`filters.includeDemo`. This is STRICTER than every M11–M14 report's own
"excluded by default, opt-in via `includeDemo=true`" convention, for a
reason specific to this milestone: `DecisionRecommendation` rows are
PERSISTED and SHARED across every future read (the dedupe/history design
in section 4 above), so a demo-sourced recommendation, once created,
would keep reappearing in every later non-demo read forever, with no
natural point at which it stops being "current." Excluding demo data
unconditionally at generation time means `isDemo` on every
`DecisionRecommendation` row (derived from whether any linked
customer/product/salesperson/quotation/order is itself demo) is
currently always `false` — correct, not a bug: no demo-sourced
recommendation is ever created today. The column and the
`scripts/remove-demo-data.ts` cleanup block are both still kept, and
correctly ordered ahead of every entity they reference, purely for
schema completeness and for any future rule version that may need
demo-inclusive generation for test fixtures.

## 8. Access tier

- **`/reports/decision-intelligence`** and every API route under
  `app/api/reports/decision-intelligence/` — `requireManagementReportAccess()`:
  `SALES_MANAGER`/`ADMINISTRATOR` only (spec section 11). Enforced
  server-side on every route; the page-level redirect for a
  `SALESPERSON` is a UX convenience only, never the real boundary — the
  same standing rule every M11–M14 management report already follows.
- The one mutation route
  (`.../recommendations/[id]/status/route.ts`) additionally requires
  CSRF-origin verification (`verifyCsrfOrigin`) before role-gating, and
  uses `requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"])` —
  same role list, the mutation-route helper rather than the
  report-read helper, consistent with every other mutating route in
  this project.

## 9. Known, documented limitations

- **Rules never fabricate a priority above what their own documented
  band supports.** A decline, however severe, can reach HIGH but never
  CRITICAL (section 2) — CRITICAL is reserved for the two rules
  representing an already-active exposure/bottleneck, not a trend.
- **`SALES_UNVERIFIED_ATTRIBUTION_CONCENTRATION`'s confidence is capped
  at MEDIUM always**, regardless of how extreme the concentration —
  this rule can never produce a HIGH-confidence claim about a named
  salesperson's attribution quality, per spec section 3.3.
- **`PRODUCT_SIGNIFICANT_LOST_DEMAND` reports quantity only** — no
  estimated monetary value is ever calculated for a lost sale.
- **This file is cross-referenced from the code it describes** — see
  the top-of-file comments in `lib/reporting/decision-rules.ts`,
  `decision-priority.ts`, `decision-recommendations.ts`, and
  `decision-intelligence-queries.ts` for the exact same rules, stated
  again at the point of implementation.
