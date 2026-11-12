# Milestone 12 Delivery Report — Sales Performance Intelligence

Built after a dedicated architecture-assessment/spec-revision phase,
presented and approved separately before implementation began (per your
explicit "STOP after presenting" instruction), resolving 6 open
decisions at that approval gate. This report is the spec-structured
record of what was built and the honest state of verification — see
`docs/milestones/PROGRESS.md`'s Milestone 12 section for the full
design-decision rationale this report summarizes, and
`docs/milestones/m12-metric-definitions.md` for the authoritative
definition of every figure this surface shows.

## 1. Scope recap and the six approved architecture decisions

1. `/reports/sales-performance` is **management-only**
   (`SALES_MANAGER`/`ADMINISTRATOR`), unlike every Milestone 11
   operational view.
2. **Both** the order-side and the quotation-side salesperson pickers
   are fixed now, not order-side only.
3. Attribution confidence is derived **live**, with **no schema
   migration** — the existing `CustomerOrder`/`Quotation`
   `salespersonId` columns and the existing `AuditEvent` table are
   enough.
4. The repeat-customer basis is `SapInvoice`, not `CustomerOrder`.
5. A fully-credited invoice (reduced to zero net value by a later
   credit note) still counts as a qualifying transaction.
6. Lost sales are attributed to a salesperson via the matched order,
   with no new direct column.

## 2. The finding that drove this milestone: a Milestone 11 data-integrity gap

Milestone 11 added `CustomerOrder.salespersonId`, but its own
`createOrderCore` silently defaulted it to `input.salespersonId ??
createdById` — "who typed the order in" — with **no audit trail**
distinguishing that silent default from a human's deliberate pick. The
quotation-creation path had an independent version of the same problem:
`app/quotations/new/page.tsx` pre-filled its picker to the preparer's
own id. Both defects are real — not a new feature gap this milestone
invents work to fill, but an existing correctness problem in already-
shipped code, found by re-reading Milestone 11's own work with a more
adversarial eye.

Fixing only the default, without also giving every future row a way to
*prove* it was a deliberate choice, would simply move the ambiguity
forward in time. So the fix is two parts that only work together:

- **Stop defaulting.** `createOrderCore` now leaves `salespersonId`
  genuinely `null` when not explicitly supplied. Every salesperson
  picker in the UI (`/orders/new`, PO-intake review, `/quotations/new`)
  now starts blank, never pre-filled.
- **Start recording provenance.** A new `salespersonAssignment: {
  salespersonId, source: "explicit" | "unassigned", assignedById }`
  sub-object is written onto the `ORDER_CREATE`/`QUOTATION_CREATED`
  `AuditEvent.afterData`. Its mere **absence** — true of every pre-fix
  row, by construction — is itself the signal `lib/reporting/attribution.ts`
  relies on; it is never backfilled onto historical rows and never
  re-derived from the resolved `salespersonId` value (a value that
  happens to differ from the creator is never, by itself, read as proof
  of a reliable choice).

## 3. Architecture: attribution confidence derived live, no schema change

Six buckets, computed by `classifyOrderAttribution` on every call —
never a stored column, so the classification always reflects the
latest understanding of what counts as reliable:

| Bucket | Meaning |
|---|---|
| `VERIFIED` | A human recorded, audit-confirmed deliberate choice — directly, or inherited from a quotation whose own creation was itself audit-confirmed. |
| `QUOTATION_SOURCED_LEGACY` | Converted from a quotation created before the quotation-side fix shipped — traceable to a real, required field, but not audit-confirmed as deliberate. |
| `UNVERIFIED_LIKELY` | Pre-order-fix, defaulted to the creator, who held `SALESPERSON` at creation time. |
| `UNVERIFIED_SUSPECT` | Same, but the creator held `SALES_MANAGER`/`ADMINISTRATOR` — more likely entering on someone else's behalf. |
| `UNVERIFIED_NO_PROVENANCE` | `salespersonId` differs from the creator, with no audit record confirming a deliberate choice. |
| `UNASSIGNED` | `salespersonId IS NULL` — genuinely unknown, never defaulted to anything. |

**A quotation-sourced order is classified from its source quotation's
own `QUOTATION_CREATED` event, never from the converted order's own
`ORDER_CREATE` event** — `lib/quotations/convert-to-order.ts` always
supplies a real, inherited `salespersonId` to the new order, so reading
the order's own event would make every converted order look `VERIFIED`
regardless of the source quotation's real provenance, exactly the false
signal this milestone exists to eliminate.

`lib/reporting/attribution-queries.ts` bulk-fetches exactly the
`AuditEvent`/`Quotation` rows a batch of orders needs (two extra round
trips regardless of batch size, never one query per order) and
delegates every classification decision to the pure `attribution.ts`
functions, which have no `@prisma/client` import anywhere in their
graph and are therefore unconditionally unit-tested in this sandbox.

## 4. New/repeat customers (spec basis: `SapInvoice`, decision 4)

Qualifying invoice = a `SapInvoice` with `isCancelledOrReversed: false`,
a resolved `matchedCustomerId`, and a non-null `invoiceDate`. NEW = this
customer's first-ever qualifying invoice falls inside the selected
period; REPEAT = a qualifying invoice inside the period **and** an
earlier one strictly before it. A fully-credited invoice still counts
(decision 5) — the only exclusion gate is `isCancelledOrReversed`, the
SAP-native document-status flag; a later credit note is a separate fact
that never un-happens the original sale. This metric is **whole-business
only, never split by salesperson** — a single `SapInvoice` can span
multiple orders with different salespeople.

## 5. "SAP invoice line value" — deliberately never "revenue"

`SapInvoiceLine.lineTotal`'s VAT treatment (inclusive vs. exclusive)
cannot be established anywhere in this codebase or its documentation —
confirmed by a repository-wide search before writing a line of this
module. Every money figure this report surfaces is labelled "SAP
invoice line value," never "revenue." Attributed at LINE level
(`matchedOrderId`/`matchedOrderLineId`), never invoice-header level
(which is `null` for any invoice spanning multiple orders), and never
summed across currency — grouped by currency first, matching the
`exposureByCurrency` precedent already established in M6A/M11.

## 6. Lost sales by salesperson (decision 6: no new direct column)

Joined `LostSaleRecord` → `UnfulfilledDemand` → `CustomerOrder` (for
`salespersonId`/`currency`), bulk-fetched rather than N+1. Anchored on
`LostSaleRecord.confirmedAt`, not `UnfulfilledDemand.createdAt` (which
`lib/reporting/sales-pipeline.ts`'s own, differently-scoped figure
uses). Headline figure is quantity, not value — `estimatedValue` is
nullable and never invented when absent; `estimatedValueByCurrency[]`
is reported separately, excluding rows with no estimate from the sum
rather than coercing them to zero. `lostSalesReason` is applied only in
this report — every other report is deliberately silent on it.

## 7. Per-salesperson pipeline conversion funnel

Reuses — never re-derives — `lib/reporting/sales-pipeline.ts`'s own
cohort/rate math: one funnel per active salesperson, computed by
calling `getSalesPipelineReport` once per salesperson with that
salesperson substituted into the filter set. **Documented limitation**:
orders/quotations with no assigned salesperson have no row here
(`sales-pipeline.ts` has no "salespersonId IS NULL" mode) — that
population remains visible in the unfiltered `/reports/pipeline` funnel
and in this report's own `UNASSIGNED` attribution count.

## 8. Role / permission matrix (decision 1, server-side only)

`/reports/sales-performance` and both its API routes
(`app/api/reports/sales-performance/route.ts` and `.../export/route.ts`)
are gated by the EXISTING `requireManagementReportAccess` — the same
server-side-only enforcement Milestone 11 established for its 9
management reports. The page-level redirect for a `SALESPERSON` user is
a UX convenience only, never the security boundary.

## 9. One real bug found and fixed this round

Self-caught while extending `ReportFilters` with the new `currency`
field, before any user or test flagged it: `lib/reporting/sales-revenue-queries.ts`'s
`getSalesRevenueReport` accepted `filters.currency` in its type
signature but never actually applied it — every call silently returned
all currencies regardless of what the filter bar sent. Fixed with an
explicit `currencyFilter` spread into the invoice `where` clause, with a
dedicated regression test in `tests/sales-performance-db.integration.test.ts`.

A second, smaller issue was caught while authoring
`tests/m12-acceptance-criteria.test.ts`: the first draft's regex
assertion against `app/quotations/new/page.tsx` false-positived against
that file's own explanatory comment (which legitimately mentions the
removed `defaultSalespersonId` prop by name). Fixed by checking the
actual `<NewQuotationForm />` JSX invocation specifically.

A third issue surfaced during this round's own honest `tsc --noEmit`
re-verification: extending `ReportFilters` with `currency`/
`lostSalesReason` broke **Milestone 11's own**
`tests/reporting-db.integration.test.ts`, whose hand-built filter
literals hadn't been updated for the two new fields — 5 genuine
`TS2345` "missing properties" errors, a real regression caused by this
milestone's own type change, not one of the pre-existing stub
categories. Fixed by adding both fields (as `null`) to all four
occurrences of the pattern in that file; re-running `tsc`/`vitest`
confirmed the fix was type-only (error count 537→532, same 657/118/0
test result).

## 10. Tests executed and results

- **84 new unconditional unit tests**, all passing:
  - `tests/attribution.test.ts` — every classification branch of
    `classifyDirectOrderAttribution`/`classifyQuotationSourcedAttribution`/
    `classifyOrderAttribution`, provenance edge cases, and a
    bucket/label/definition internal-consistency check.
  - `tests/customer-activity.test.ts` — NEW/REPEAT classification,
    inclusive boundaries, single-day period.
  - `tests/sales-revenue.test.ts` — `currencyKey`, `sumMoneyRows`,
    `groupRevenueByCurrencyAndSalesperson`.
  - `tests/reporting-filters.test.ts` — extended with `currency`/
    `lostSalesReason` cases (uppercase normalization, invalid-length
    rejection, whitespace→null, invalid-enum rejection).
  - `tests/m12-acceptance-criteria.test.ts` — source-level regression
    guard: `createOrderCore` no longer defaults to `createdById` (and
    does default to `null`); `createOrderSchema` has the nullable/
    optional field; `<NewQuotationForm />`'s actual JSX invocation has
    no `defaultSalespersonId` prop.
- **A new gated DB-integration test file**
  (`tests/sales-performance-db.integration.test.ts`,
  `RUN_DB_INTEGRATION_TESTS`) — attribution via a real DB round trip;
  the full picking→authorize→decision→confirm-lost-sale lifecycle
  attributed to a salesperson; a `getSalesPerformanceReport` plumbing
  smoke test; the `currency` filter regression. Correctly self-skips in
  this sandbox (no `DATABASE_URL`) — not yet run against a real
  database.
- **Full-project regression**: `npx vitest run` — 657 passed, 118
  skipped, 0 failed. Zero regressions in any pre-existing test.

## 11. Honest `tsc` / lint / build results

- **`npx eslint .`** — clean across the whole project, including every
  file this milestone added or edited.
- **`npx tsc --noEmit`** — 532 errors (537 before the
  `tests/reporting-db.integration.test.ts` fix in §9 above, which
  removed exactly 5 and introduced none). Every remaining new type
  error introduced by this milestone's Prisma-backed files falls into
  the same three already-documented sandbox `@prisma/client`-stub
  categories (`TS2694`/`TS7006`/`TS2305`, plus one `TS2339`/`TS2322`
  cascade from the same root cause) present in every pre-existing
  Prisma-backed file across Milestones 0–11; the project's only other
  non-stub-category errors (3 `TS2345` in
  `lib/invoice-reconciliation/match-invoice.ts`) predate this milestone
  and are untouched by it. Confirmed by grep that this milestone's own
  new page and API route files carry **zero** type errors — the noise
  isolates entirely to the Prisma-backed query/composite modules,
  exactly matching the established precedent. This is a sandbox-only
  `@prisma/client`-generation limitation; `npx prisma generate` against
  a real network is expected to clear essentially all of it.
- **`npx prisma generate`** — not possible in this sandbox, same
  `binaries.prisma.sh` proxy block documented in every prior milestone.
- **`npm run build`** — re-attempted this round: fails at the identical
  pre-existing `next/font/google` block, confirmed unrelated to any
  file this milestone touched.
- **Not run in this sandbox**: `npx prisma generate`/`validate`, and
  this milestone's gated DB-integration tests against a real database.

## 12. Non-goals honored

No schema migration was introduced (decision 3 honored structurally,
not just by omission — checked that every new query reads existing
columns). No parallel copy of business data was created — every new
`lib/reporting/*.ts` function reads the same tables M1–M11 already
write to. No figure is reported as a confident number when it is
actually an estimate — lost-sales value is explicitly labelled an
estimate, and "SAP invoice line value" is never called "revenue."

## Files changed

See `CHANGES.md`'s Milestone 12 section for the complete file-by-file
list: the order/quotation attribution-provenance fix (6 files), 9 new/
modified `lib/reporting/` files, 2 new API routes, 3 new/modified UI
files, 7 test files (6 new plus a type-only fix to Milestone 11's own
`tests/reporting-db.integration.test.ts`), and this documentation set.

## Exact Windows PowerShell commands

See `SETUP-WINDOWS.md` §29 for the full, copy-pasteable sequence: no
migration to apply, regenerating the Prisma client, running the 5 new
test files (6 including the extended `reporting-filters.test.ts`), and
a 10-step manual test script covering both never-pre-filled pickers,
the attribution-confidence table, the never-summed revenue-by-currency
table, the lost-sales panel, the per-salesperson conversion funnel, the
new filters, and CSV export.
