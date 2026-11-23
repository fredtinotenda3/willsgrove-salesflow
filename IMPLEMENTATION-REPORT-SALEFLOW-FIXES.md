# Implementation Report — SalesFlow Fixes (pricing, lifecycle, history, Lost Value, Invoice Claims)

No schema change, no migration, no Neon/DB access, no env/secret changes. Existing reports (`IMPLEMENTATION-REPORT.md`, `FOLLOW-UP-FIXES-REPORT.md`) untouched.

## 1. Next.js and pricing
- `/price-lists/[id]`: page is now a server component (`instant = false`, `await params`) rendering a client island (`price-list-detail.tsx`) — removes `use(params)` in a client page, the Cache Components problem. **Not reproduced**: `next build` is blocked in this environment (Google Fonts fetch), so the fix follows the app's own server-page + client-island pattern and is not build-verified.
- Prices from the customer's price list: resolved server-side at order creation (`lib/order-price-resolution.ts`, used by `lib/orders.ts`), stored as the snapshot (`customerUnitPrice`); caller-supplied prices are never overridden; currency must match (or the order adopts the list's currency when none was given). The new-order form now sends the price-list currency.
- One calculation (`lib/order-pricing.ts`): unpriced ≠ zero, tax only where a rate is configured (0% valid), half-up 4dp per line, totals are sums of lines. Used by the order list, order detail and Delivered Orders detail. "Pending pricing" is not shown when a snapshot or valid list price exists; historical snapshots are preserved (list fallback only for lines with no snapshot).

## 2. Workflow and lifecycle
- "Original Message & Documents" merged and compacted (clamped message + collapsible, single-line document rows).
- Lifecycle stepper rewritten as compact responsive cards; delivered orders (all dispatches DELIVERED, or delivery outcome on record) show all 8 steps complete (`lib/order-display.ts`).
- Picking start/end timestamps and staff are shown in the Delivered Orders record (from existing picking sessions; nothing invented).
- Assignment changes: `PATCH /api/orders/[id]/dispatch/[dispatchId]/assignment` + `changeDispatchAssignment` (PLANNED/DEPARTED only, registered+ACTIVE validation, mandatory reason) writes an AuditEvent with before/after; initial assignment is snapshotted at creation. Shown in the order's Fulfilment History and Delivered Orders. Dialog on the dispatch panel.
- Delivered Orders detail now includes lifecycle stepper, priced PO lines with subtotal/tax/total, assignment history, and a new "Order history and documents" section (recorded status history + downloadable documents).

## 3. Responsive UI/date controls
- New `app/components/date-picker.tsx` (`DatePicker`, `DateRangePicker`) from existing `calendar` + `popover` + `button`; replaces native date inputs in report filters, Delivered Orders filters and the quotations list. `sonner` toasts used for the new assignment action.
- Touched tables (order lines, PO lines, invoice register) use fixed layout and hide low-priority columns by breakpoint.
- Not converted: other native date inputs (new-quotation form, quotation actions panel, intake review, new-order form) — outside the touched screens.

## 4. Lost Value
- "Est. Value"/"Estimated lost value" → **Lost Value** across lost-sales list/detail/analytics, charts, tooltips, customer/product pages, dashboard, sales-performance and the CSV export. Unit price, lost qty and Lost Value columns added to `/lost-sales` and the analytics drill-down. Unpriced stays "--"/null, never 0. Source A/C logic and qualification rules untouched.
- Not done: Source-C rows in the financial-exposure report keep their existing "Confirmed loss" wording (already distinct).

## 5. Invoice Claims
- `lib/invoice-claims/invoice-register.ts` + `app/invoice-claims/invoice-register.tsx`: every SalesFlow-native invoice listed (with or without a claim), links to order/claims, accepted/rejected/returned quantities, per-line reason labels; derived outcome (No claim / Claim recorded / Pending resolution / Resolved) plus return facet (Partial / Full). Filter: all / with claim / no claim. Shows the first 50 matching invoices (no register pagination yet).
- Server-side returned-quantity validation in `recordClaimReturn` (`lib/returns-credits/return-quantity.ts`): cumulative returns ≤ disputed (rejected) quantity, checked in the transaction.
- Claim quantities are shown as exposure only; confirmed losses still come solely from the existing returned-product valuation. Reason labels unchanged.
- Fixed the 3 pre-existing tsc errors (`create-claim.ts` ×2, `consolidated-analytics.ts`).

## shadcn components reused
alert, badge, button, calendar, card, checkbox, collapsible, dialog, input, label, popover, scroll-area, select, sonner (toast), table, tabs, textarea, tooltip.
All raw `<button>/<input>/<select>/<textarea>` elements were removed from every page and component I changed or created (`/orders/new`, delivered orders, report filter bar, quotations list, dashboard header, dispatch panel, price-list detail). The only native elements left are hidden form inputs inside `DatePicker`/`FormSelect` (they carry the value into plain GET forms). Two small composites built ONLY from `components/ui` were added: `app/components/date-picker.tsx` and `app/components/form-select.tsx` (Radix Select cannot hold an empty value; the wrapper keeps the "" = any contract for server forms).
Not converted: pre-existing raw `<table>` markup on pages I only touched lightly (price-list detail entries table, the delivered-orders detail's other sections, the invoice-claims page's existing tables) and untouched pages elsewhere in the app. In `/orders/new` the order-lines table no longer has a sticky header/“Add Line” bar (shadcn `Table` wraps itself in an overflow container, which defeats `position: sticky`). **Missing components: none. No install commands required.**

## Verification (actual results)
| Check | Baseline | Now |
|---|---|---|
| `npx tsc --noEmit` | 3 errors (pre-existing) | **0 errors** |
| `npm run lint` | 3 errors (pre-existing: `components/ui/carousel.tsx`, `components/ui/sidebar.tsx`, `hooks/use-mobile.ts`) | same 3, none new |
| `npx vitest run` | 2 failures (pre-existing, `tests/acceptance-item-0228.test.ts`, missing `test-data` file) | same 2; 1021 passed, 257 skipped (DB integration) |
| `npx prisma validate` | n/a — schema not changed | not run |
New tests: `order-pricing`, `assignment-history` (+ schema), `return-quantity-and-claim-state` (37 pass incl. updated `order-display`).

## Outstanding / limitations
- `/price-lists/[id]` fix not build-verified (build blocked by Google Fonts fetch).
- DB integration tests could not run (no database); the DB-touching paths (price resolution, assignment change, return quantity transaction, register query, delivered detail) are type-checked but not exercised against Postgres.
- Tax uses the current TaxCode rate (no per-line tax snapshot column; adding one would need a schema change).
- Stepper "Invoiced" shows done whenever a later stage is reached (needed so Delivered shows all 8 complete).
- Picking/dispatch history relies on existing records and audit events; dispatches created before this change have no recorded assignment event and show no assignment history (not reconstructed).
- Lost Value breakdown/trend/filter features already existed in analytics; this round renamed and added columns rather than building new breakdowns.
- Not visually checked in a browser.
