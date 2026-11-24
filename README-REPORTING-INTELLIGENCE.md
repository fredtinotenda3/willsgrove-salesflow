# Willsgrove SalesFlow — Reporting Intelligence & Management Action Recommendations

This ZIP contains only the files changed or created for this enhancement, at their original relative paths. Copy them over the project, then follow "Migration" below. Nothing else (no `node_modules`, build output, database files or env files) is included.

## 1. What was implemented

**A. Claims by standardised reason (one shared implementation, two pages)**
Both the Invoice Claims Dashboard (`/invoice-claims/dashboard`) and Lost Sales Analytics (`/lost-sales/analytics`) render the same `ReasonAnalyticsSection`, fed by the same calculation (`lib/lost-sales/unified-core.ts`):
- Claims by reason: ranked bar, count and % of all claims.
- Financial exposure by reason: one chart per currency (USD and ZWG never added), at the real invoice unit price.
- Rejected vs physically returned quantity by reason: two series, one chart per unit of measure.
- Reason trend: stacked distinct claims per day/week/month by claim date, real data only (empty periods are zero because none were recorded).
- Tooltips, legends, empty states, responsive grid. Only the real standardised reason values are used; lines with no reason or a legacy value get their own rows rather than being dropped.
- The claims dashboard gained a From/To date filter (by claim date) that applies to the new lost-sales and reason sections.

**B. Unified lost sales (six separate measures, never merged)**
Shown on both pages as `UnifiedLostSalesSummary`: unfulfilled demand, rejected after delivery, physically returned, confirmed lost, under dispute / pending, recovered / retained. Plus disputed value, credited, approved-not-yet-credited and concluded-unclassified. See rules below.

**C. Management intelligence on all nine reports**
Each report under `/reports/management/[reportId]` has a "Management intelligence" section: finding, evidence, business impact, recommended action, responsible function, priority, timeframe, expected outcome, how success is measured, and links to the relevant records. Rule parameters are listed on the page. Where data is too thin the section says "Insufficient evidence" and gives no advice; where nothing crosses a rule it says "No action indicated".

**D. Management Action Centre** (`/reports/management/actions`)
Aggregates the same findings (identical figures; one entry per topic when two reports raise the same thing) into: critical actions, high-priority operational problems, financial exposure, repeated shortages, recurring product rejection, recurring customer failures, other findings, previously acted-on items with outcomes, and insufficient-evidence notes. Managers can acknowledge, assign, start, complete (outcome required), dismiss (reason required) and reopen. Linked from the Reports hub and the Management Reports page.

## 2. Files

Changed: `app/api/reports/financial-exposure/export/route.ts`, `app/invoice-claims/dashboard/_components/claims-charts.tsx`, `app/invoice-claims/dashboard/page.tsx`, `app/lost-sales/analytics/page.tsx`, `app/reports/management/[reportId]/page.tsx`, `app/reports/management/page.tsx`, `lib/invoice-claims/reason-analytics.ts`, `lib/reporting/decision-dashboard.ts`, `lib/reporting/financial-exposure.ts`, `lib/reports/hub-groups.ts`, `prisma/schema.prisma`.

New: `app/api/management-actions/route.ts`, `app/reports/_components/reason-analytics-section.tsx`, `app/reports/_components/unified-lost-sales-summary.tsx`, `app/reports/management/_components/action-controls.tsx`, `app/reports/management/_components/intelligence-section.tsx`, `app/reports/management/actions/page.tsx`, `components/charts/claim-reason-charts.tsx`, `lib/lost-sales/unified-core.ts`, `lib/lost-sales/unified-queries.ts`, `lib/management-intelligence/{action-state,actions,facts,queries,rules,thresholds,types}.ts`, `prisma/migrations/20261124090000_add_management_actions/migration.sql`, and tests `unified-lost-sales`, `management-intelligence-rules`, `management-intelligence-facts`, `management-action-state`, `management-actions-service`, `management-actions-access`.

## 3. Calculation rules and source-of-truth decisions

- **Claim value** = rejected quantity × the real invoice unit price, exact 4-decimal arithmetic (no floats). Native claims without a SAP invoice use the order line's approved price, then the customer's PO price. The customer's own `disputedUnitPrice` is informational and is never used. AMOUNT_ONLY lines add their disputed amount but no quantity.
- **Currency** = SAP invoice currency, else order currency, else `UNKNOWN` (never guessed). Currencies are never added; quantities are added only within one unit of measure.
- **Rejected vs returned**: rejected quantity is the basis; physically returned is kept beside it (capped at rejected) and never added to it.
- **Unfulfilled demand** excludes superseded records. It has no currency column, so its value is shown in USD by a named constant (`UNFULFILLED_VALUE_CURRENCY`), and records with no price carry no value (counted and disclosed).
- **Confirmed lost** = shortage confirmed lost + returns found DAMAGED/EXPIRED/OTHER. A rejected quantity that was not returned stays "rejected / under dispute".
- **Under dispute** = disputed value of non-concluded claims (concluded = RESOLVED, REJECTED, CLOSED; APPROVED and PARTIALLY_RESOLVED are still open) less what SAP credit notes actually credited. An open claim is never a confirmed loss.
- **Recovered / retained** = REJECTED claims, or latest non-rejected resolution NO_ACTION_REQUIRED / CLAIM_REJECTED / PRICING_CORRECTION_REQUIRED. REPLACEMENT_APPROVED is shown separately. A concluded claim with no classifying decision is "unclassified", not guessed.
- **Credit notes** are shown separately from the disputed amount; claims where credit exceeds disputed value are counted and flagged.
- **Deduplication**: one claim counted once per measure; a claim with lines of several reasons counts under each reason (shares can exceed 100%, stated on the page). Unfulfilled demand and claim lines never overlap (unfulfilled quantity was never invoiced).
- OverSupply and Duplicates are included in rejected-after-delivery, tagged by their reason.
- The old A/B/C "Source" letters in user-facing labels and CSV headers are replaced by the descriptive names.
- **Recommendations**: deterministic rules over figures the reports already show (`lib/management-intelligence/rules.ts`), thresholds as named constants (`thresholds.ts`) shown as rule parameters, not targets. Priority maps to a review window (Critical: act today; High: 3 working days; Medium: 2 weeks; Low: monthly review). Nothing creates an operational transaction.
- **Access**: recommendations and the Action Centre are manager/administrator only, enforced server-side (`requireManagementReportAccess`, CSRF origin check, zod validation, `isValidId`). Reason charts and quantities are visible to all roles as before. Assignees must be active managers or administrators (the only roles that can open the Centre).
- **Audit**: every action operation writes an event row and an `AuditEvent` (`MANAGEMENT_ACTION_*`) in the same transaction as the change. Status changes are guarded against two managers moving the same action. The finding text and evidence snapshot are always recomputed on the server, never taken from the request.

**Deviation from the approved plan:** actions are tracked in a new small table (`ManagementAction`, `ManagementActionEvent`) rather than extending `DecisionRecommendation`. That table is regenerated by the Decision Intelligence rule sync and requires a rule id and reporting period, so sharing it would risk the sync overwriting assignments. Findings are not stored; a row exists only after a manager acts, holding the human decision and a snapshot of the evidence.

## 4. Migration (Windows PowerShell)

Additive only: two tables, three enums, no change to existing data.

```powershell
npx prisma migrate deploy
npx prisma generate
npm run build
```

No backfill is needed. To roll back, drop `ManagementActionEvent`, `ManagementAction` and the three enums (`ManagementFunction`, `ManagementActionStatus`, `ManagementActionEventType`).

## 5. Tests performed and results

Run in a sandbox without a database or Google Fonts access:
- `tsc --noEmit`: clean.
- `eslint .`: 3 errors, all pre-existing and untouched (`components/ui/carousel.tsx`, `components/ui/sidebar.tsx`, `hooks/use-mobile.ts`). No new lint findings.
- `vitest run`: 1189 passed, 2 failed, 259 skipped. The 2 failures are pre-existing (`tests/acceptance-item-0228.test.ts` needs a `test-data/` folder that is not in the project). The 259 skipped are database integration tests that need a live Postgres.
- 98 tests are new: unified lost-sales rules (26: invoice-price values, rejected vs returned, open/partial/resolved/rejected claims, credit notes vs disputed, currency separation, no double counting, reason ranking and trends), the nine report rule builders with real-finding and insufficient-data cases (38), facts mappers (6), action lifecycle and validation (9), tracking service with assignment, acknowledgement, audit and conflict guards (14), role and CSRF access on the API (5).
- `next build`: not completed here. It stops at fetching Google Fonts (sandbox has no internet), before any code of this change is built; TypeScript and lint are clean. Please run the build on your machine.

## 6. Known limitations

- **Not run against a real database or in a browser.** The new queries (`unified-queries.ts`, `actions.ts`) and pages are type-checked and their logic unit-tested, but the 259 DB integration tests, including `tests/claim-reason-analytics-db.integration.test.ts` (whose expectations still hold with the new invoice-price rule), could not run. Please run them and open both dashboards and the Action Centre once after deploying.
- **Partial resolution is exact only at claim level.** Resolutions and credit notes attach to the claim, not to a line, so the system does not allocate them across lines or reasons (no pro-rata guessing).
- **Unfulfilled demand value is USD by assumption** (no currency column exists).
- **Behaviour change in `getClaimReasonAnalytics`**: exposure now uses the invoice price, not the customer's disputed price; counts are distinct claims; lines with no reason appear as their own row.
- Claim analysis reads at most the most recent 5,000 claims; a notice is shown if that is exceeded.
- Order-age and customer-repeat rules read the oldest/most recent 200 rows of those reports; when that may truncate a count, the page says "at least" or "based on N of M rows".
- Lost-sales and claims recommendations use all dates (like those two reports); the other reports use their default 30-day window in the Action Centre. When a manager acts on a finding from a filtered report view, the finding is matched and snapshotted against that default view.
- The date filter on the claims dashboard applies only to the new lost-sales and reason sections; the older counts and tables on that page still show all claims.
- Thresholds are review lines, not business targets; adjust them in `lib/management-intelligence/thresholds.ts`.
