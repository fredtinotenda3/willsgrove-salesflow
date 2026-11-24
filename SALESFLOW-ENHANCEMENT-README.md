# Willsgrove SalesFlow - enhancement drop

This ZIP contains **only changed and new files**, at their original relative paths. Unzip it over the project root. No migration, no new dependency, no env change.

## What was done (priority order)

| # | Item | Result |
|---|------|--------|
| 1 | Audit | Findings and flagged ambiguities below |
| A | Requested/found qty vs sales amount | Two new dual-axis charts on `/lost-sales/analytics` (quantity left axis, USD right axis). Per-product chart keeps each product in its own unit; the trend chart carries a mixed-unit footnote |
| B | Requested vs unavailable and sales impact | Existing trend charts kept; the new trend chart overlays lost value on quantity |
| C | Invoice Claims dashboard | KPI cards, composition-by-product chart (delivered / accepted / rejected / returned), reason chart, per-currency exposure chart. Stale "Pending 6B" cell replaced with real credited amounts. Claims are never presented as credit notes |
| D | Unfulfilled demands | "Repeated shortage" cards (3+ separate short orders in the period) in Needs Attention and the management pack |
| E | Performance history | Only real, existing data is used: period comparisons come from the existing reports. No history, targets or trends are invented; a missing prior value shows "n/a" |
| F | Record Invoice protection | Server-enforced. See below |
| G | Weekly/Monthly management pack | `/reports/management/pack`, Excel export, print-to-PDF layout |
| 3 | Reports hub | Executive overview, Needs Attention, six groups, all ten routes kept and role-filtered |
| 4 | KPI card system | `components/kpi/*` (default / comparison / status / target variants) |
| 5 | Charts | Compact opaque tooltips that never scroll; "$" for USD |
| 7 | Sidebar | Collapse to icons, persisted per browser, tooltips on hover and focus, mobile drawer unchanged |
| 6, 8 | Tables, design polish | Deliberately limited to the pages touched above |

### F. Record Invoice protection (server-enforced)
- Recording takes a row lock on the order (`SELECT ... FOR UPDATE`) inside the existing transaction, so concurrent submissions serialise; the second sees nothing left to invoice and is refused.
- After recording, the panel shows "Invoice recorded", the form is gone, and recorded invoices are listed. A form shows only while quantity remains, which keeps the existing **partial-invoice** rule (remaining = dispatched minus invoiced, per line). **Business-rule interpretation to confirm:** "disable after recording" is applied when nothing remains to invoice.
- Reset: `POST /api/orders/{id}/record-invoice/{invoiceId}/reset`, roles Sales Manager / Administrator, CSRF-checked, reason required (5-500 chars), confirmation dialog in the UI, audit event `INVOICE_RESET_NATIVE`. Refused if the invoice already has claims, credit notes or a delivery record, or is not a native recording, or is already reset.
- Reset reuses the existing `isCancelledOrReversed` flag (no schema change), so reports and claims registers already exclude it; `invoice-register.ts` now filters it explicitly.

### Access rules
The five management reports remain Sales Manager / Administrator. The hub hides them from salespeople (UX only); every page redirects and every API route calls `requireManagementReportAccess()`. The pack page and its export route are gated the same way, and exports are audited.

## Files

### Modified
- `app/api/orders/[id]/record-invoice/route.ts`
- `app/components/sidebar.tsx`
- `app/globals.css`
- `app/invoice-claims/dashboard/page.tsx`
- `app/lost-sales/analytics/_components/charts.tsx`
- `app/lost-sales/analytics/page.tsx`
- `app/orders/[id]/record-invoice-panel.tsx`
- `app/reports/management/page.tsx`
- `app/reports/page.tsx`
- `components/charts/rich-tooltip.tsx`
- `lib/invoice-claims/invoice-register.ts`
- `lib/invoice-recording/queries.ts`
- `lib/invoice-recording/record-native-invoice.ts`
- `lib/invoice-recording/validation.ts`
- `lib/reporting/decision-dashboard.ts`
- `tests/invoice-recording-db.integration.test.ts`

### New
- `app/api/orders/[id]/record-invoice/[invoiceId]/reset/route.ts`
- `app/api/reports/management/pack/export/route.ts`
- `app/invoice-claims/dashboard/_components/claims-charts.tsx`
- `app/reports/management/pack/page.tsx`
- `app/reports/management/pack/print-button.tsx`
- `components/charts/compact-tooltip.tsx`
- `components/charts/dual-axis-chart.tsx`
- `components/kpi/kpi-card.tsx`
- `components/kpi/kpi-sparkline.tsx`
- `lib/format/analytics.ts`
- `lib/invoice-claims/composition-queries.ts`
- `lib/invoice-claims/composition.ts`
- `lib/invoice-recording/reset-native-invoice.ts`
- `lib/kpi/from-dashboard.ts`
- `lib/kpi/kpi-logic.ts`
- `lib/reporting/management-pack-period.ts`
- `lib/reporting/management-pack-types.ts`
- `lib/reporting/management-pack-xlsx.ts`
- `lib/reporting/management-pack.ts`
- `lib/reports/hub-groups.ts`
- `lib/ui/sidebar-preference.ts`
- `tests/analytics-format.test.ts`
- `tests/claim-composition.test.ts`
- `tests/invoice-reset.test.ts`
- `tests/kpi-from-dashboard.test.ts`
- `tests/kpi-logic.test.ts`
- `tests/management-pack-period.test.ts`
- `tests/management-pack-xlsx.test.ts`
- `tests/report-hub-groups.test.ts`
- `tests/sidebar-preference.test.ts`

## Migrations
None. `prisma/schema.prisma` is untouched.

## Environment changes
None.

## Dependencies
None to add. (`exceljs`, `recharts`, `radix-ui` are already in package.json; no shadcn component needs installing.)

## Windows PowerShell

```powershell
# from the project root, after unzipping over it
npm install
npx prisma generate
npx prisma migrate deploy      # no new migrations; safe to run, keeps DB in step

# validate
npx tsc --noEmit
npm run lint
npm test

# run
npm run dev
```

Optional DB integration tests (need a disposable Postgres via `DATABASE_URL`; they include the new concurrency and reset tests):

```powershell
$env:DATABASE_URL = "postgresql://USER:PASS@localhost:5432/salesflow_test"
npm test -- invoice-recording-db
```

## Verification actually performed (sandbox)

| Check | Result |
|-------|--------|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 1091 passed, 2 failed, 259 skipped. The 2 failures (`acceptance-item-0228`) fail identically on the untouched baseline: they read `test-data/`, which is not in the ZIP you supplied |
| New unit tests | 9 files, all passing (reset rules, formatters, composition, KPI logic and mapper, hub grouping and role visibility, pack period maths, Excel workbook round-trip, sidebar preference) |
| `eslint .` | 3 errors, all in shadcn-generated files (`components/ui/carousel.tsx`, `components/ui/sidebar.tsx`, `hooks/use-mobile.ts`); identical on the baseline. None in changed files |
| DB integration tests | **Not run**: the sandbox cannot download Prisma engines or run Postgres. The new concurrency/reset tests are written but unexecuted. Please run them |
| `next build` | **Not run to completion**: it stops at the Google Fonts fetch (no network in the sandbox). Run `npm run build` locally |
| UI in a browser | **Not visually checked** (charts, sidebar, print layout). Please look at the pages listed below |

Pages to eyeball: `/reports`, `/invoice-claims/dashboard`, `/lost-sales/analytics`, `/reports/management/pack` (try Ctrl+P), an order's Record Invoice panel (record, then reset as a manager), and the sidebar collapse button.

## Manual configuration
None required. The sidebar preference is stored in the browser (`localStorage`), so it is per device. A collapsed sidebar briefly shows expanded on a full page load before the stored preference applies (client-side, avoids a hydration mismatch).

## Flagged, not silently changed
1. **Lost-sales value currency.** Those fields have no currency column; they are shown as **USD** via one constant (`LOST_SALES_VALUE_CURRENCY`). Confirm that matches the price lists.
2. **"Open claims" definition.** The operational dashboard counts four statuses (OPEN, UNDER_INVESTIGATION, AWAITING_CUSTOMER, AWAITING_INTERNAL_ACTION) but describes them as "not yet resolved, rejected or closed", which would also include APPROVED and PARTIALLY_RESOLVED. The new "unresolved" figures use *not RESOLVED/REJECTED/CLOSED*; the old counter is unchanged.
3. **`claimsFinancialExposure` KPI** is labelled open/unresolved but sums every claim. Unchanged; the new unresolved-exposure card is the status-correct figure.
4. **Two exposure bases.** The claim-reason analytics value disputed lines at the customer's `disputedUnitPrice`; `financial.ts` uses the real invoice price. The new composition and pack figures use invoice prices.
5. **N+1 queries** in `computeExposureByCurrency` (`lib/invoice-claims/financial.ts`). Left alone; worth batching if the claims table grows.
6. **Comparison windows.** The main dashboard compares against a sliding "previous N days"; the management pack compares against the previous *calendar* week/month. They can legitimately differ.
7. **PDF** is produced by the browser's Save as PDF from the print layout, not a server-side renderer, so no new dependency is needed.
8. `KpiCard` has no render test (react-dom/server cannot run under the project's `react-server` vitest condition); its logic is covered by `kpi-logic` and mapper tests.
