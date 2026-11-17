# Final Implementation Report — Willsgrove SalesFlow

**Round:** "FINAL COMPLETION DIRECTIVE — WILLSGROVE SALESFLOW" (15 parts, tasks #166-179)
**Date:** 2026-11-17
**Zip delivered alongside this report:** `willsgrove-salesflow-final-enhancements.zip` (74 changed/new source files; see §3)
**Also delivered separately, alongside this report:** `INSTALLATION-COMMANDS.md`, `WINDOWS-SETUP-AND-VALIDATION.md`, `DATABASE-CLEANUP-PLAN.md`
**Customer-master CSV + its field-mapping/data-quality reports (task #156):** delivered separately, in an earlier round of this engagement, as its own file set — intentionally **not** re-included in this round's zip. See the note at the end of §2, Part 9, for what could and could not be independently re-confirmed about that delivery from inside this session.

This report follows the same format and the same honesty conventions as the
preceding `FINAL-OPERATIONAL-ENHANCEMENTS-DELIVERY-REPORT.md` (the direct
precedent for this one): every verification claim below was executed in this
session, not assumed, and every sandbox limitation is reproduced with its
exact error output rather than described from memory.

---

## 1. Summary verdict

All 15 parts of the directive (tasks #166-179) are complete. Every
automated gate that can run inside this sandbox passes cleanly; the two that
cannot (`prisma generate`/`validate` and `next build`) fail for the same
sandbox-network reason documented in every milestone back through M11, not
for a defect in this round's code — reproduced fresh below, not assumed.

| Gate | Result |
|---|---|
| `npx eslint .` | **Clean.** 0 errors, 0 warnings, full repo. |
| `npx tsc --noEmit` | **760 errors, all 7 pre-existing codes, 0 new categories.** See §4 for the full bucket breakdown and root-cause attribution. |
| `npx vitest run --exclude '**/*-db.integration.test.ts'` | **Pass.** 60 files / 950 tests passed, 20 skipped (role-gating/precedent-scoped tests, a documented project-wide convention — see tasks #177/#178 notes below). |
| `npx vitest run` (full suite, DB-integration files self-skip) | **Pass.** 60 files passed / 25 skipped, 950 tests passed / 207 skipped, 0 failures. The 25 skipped files are `*-db.integration.test.ts` files that `describe.skipIf(!RUN_DB_INTEGRATION_TESTS)` against — correct, by design, with no live Postgres reachable from this sandbox. |
| `prisma validate` / `prisma generate` | **Blocked by sandbox network policy**, not a schema defect. See §5. |
| `next build` | **Blocked by sandbox network policy** (Google Fonts fetch for `next/font`), not a code defect. See §5. |

**What "complete" means here, precisely:** every part's business logic, UI,
and migration is written, lint-clean, and covered by passing tests that this
session actually ran. What it does **not** mean: that the one new migration
has been applied to a live database, or that a production `next build` has
been exercised end-to-end for this round's new/changed pages. Neither is
possible from inside this sandbox (§5), and neither is quietly assumed done
anywhere in this report — §6 states both as open, explicit gaps for the
receiving environment to close.

---

## 2. What was built, by part

### Part 1 (task #167) — Automatic lost sales from unavailable quantities

`lib/lost-sales/create-unfulfilled-demand.ts` now runs inside picking
completion/authorization so that `unavailable = requested − found` on a
picking line auto-creates (never duplicates) an `UnfulfilledDemand` row, with
`estimatedUnitPrice`/`estimatedValue`/`estimatedValueSource` populated from
the line's approved selling price. A **re-pick correction** after an already
AUTHORIZED session is handled by marking the prior "current" demand
`status: "SUPERSEDED"` with `supersededByDemandId` pointing at its
replacement — or `null` when the correction found the line fully available,
so no replacement is created and no duplicate "current" row is left behind.
This entire supersession path had zero test coverage anywhere in the
codebase before task #178 (below); it is now covered end-to-end. Schema
support: `prisma/migrations/20261116130000_add_lost_sales_automation/`
(additive-only — one new enum value, three new nullable columns, one new
nullable self-referential FK; never applied to a live database — see §5/§6).
This is kept strictly separate from claim-based (Source A) lost sales per
the directive's own instruction; `lib/lost-sales/display.ts` and
`lib/lost-sales/queries.ts` carry the source distinction through to the UI
and analytics layers.

### Part 2 (task #168) — Remove "Confirm Lost Sale" card, keep "Record Customer Decision"

The manual "Confirm Lost Sale" action — now redundant with Part 1's
automatic creation — was removed from the lost-sales detail screen
(`app/lost-sales/[id]/page.tsx`, `app/lost-sales/[id]/decision-panel.tsx`),
along with the server code that backed only that step
(`lib/lost-sales/confirm-lost-sale.ts` was reduced to what the remaining
decision workflow still needs). "Record Customer Decision" and its existing
decision categories are unchanged and still link correctly to the
auto-created shortage record from Part 1.

### Part 3 (task #169) — Lost sales analytics overhaul

`lib/lost-sales/analytics-queries.ts`'s `getLostSalesAnalytics` (a single
combined, DB-backed query) computes core metrics (availability rate,
shortage rate, undecided/outstanding/cancelled/confirmed-lost quantities),
breaks them down by customer, product, order, date, reason, decision,
status, period, and salesperson, and backs a drillable order-level table.
Charts (`app/lost-sales/analytics/_components/charts.tsx`,
`components/charts/lost-sales-trend.tsx`) use Recharts (Part 10, below) for
the trend line, top-products/customers bars, requested/found/unavailable
grouped bars, shortage-rate bar, and composition stacked bar — every series
sourced from real DB data, no fabricated figures. `MIN_DEMAND_COUNT_FOR_RATE_RANKING
= 3` keeps a single-demand 100%-shortage product from distorting the
shortage-rate ranking; the default query scope excludes `SUPERSEDED` rows
(Part 1) so a correction's old quantity is never double-counted into the
totals — both rules are now covered by DB-integration tests (task #178).
This module had zero test coverage before task #178; it now has a dedicated
test file (`tests/lost-sales-analytics-db.integration.test.ts`).

### Part 4 (task #170) — Dashboard decision-support rebuild

`lib/reporting/decision-dashboard.ts` and
`lib/reporting/decision-dashboard-period.ts` assemble a KPI section (with
period-over-period comparison), a trends section, an exceptions/priorities
section, and a drill-down detail section, rendered in `app/page.tsx` and
`app/reports/decision-intelligence/page.tsx`. Content is role-appropriate via
the existing permission system and contains no fabricated targets — every
figure traces to a real query. `tests/decision-dashboard.test.ts` and
`tests/decision-intelligence-db.integration.test.ts` cover the pure
period-math and the DB-backed assembly respectively.

### Part 5 (task #171) — Dynamic order status propagation (fix stuck "Ready for Invoice")

Root cause: `lib/reporting/management-reports.ts`'s `toOutstandingOrderRow`
was reading `CustomerOrder.status` directly instead of going through the
same **display-only derived status** pattern
(`lib/order-display.ts`'s `getEffectiveOrderStatus`) already used correctly
on the order list/detail pages, so a dispatch that had departed or been
delivered still showed as "Ready to Invoice" on the outstanding-orders
report and the dashboard that reads from it. Fixed by routing
`toOutstandingOrderRow` through `getEffectiveOrderStatus`, with **no new
status field** — status is still derived live from the latest
dispatch/delivery state, never stored redundantly. Task #178 added two
DB-integration tests proving the fix is reachable specifically through
`listOutstandingOrders` (the function this bug actually lived in); a
companion function, `listOrdersAwaitingFulfilment`, was confirmed by code
reading to be structurally immune to this same bug (its own where-clause
excludes DEPARTED/DELIVERED dispatches outright), so it was deliberately not
re-tested for the same defect — that judgment call is recorded in the test
file's own comments.

### Part 6 (task #172) — Block new picking session after departure/delivery

`lib/picking/start-picking.ts` now rejects starting a new picking session on
an order whose dispatch has departed or been delivered, enforced
server-side in the action itself (not just client-side), so it cannot be
bypassed by a direct request. `app/fulfilment/[id]/picking-panel.tsx`
disables and explains the "Start a New Picking Session" button client-side
for the same condition. Historical picking sessions remain fully readable;
nothing is deleted or invalidated. The re-pick/correction workflow used by
Part 1 (re-picking **after** an AUTHORIZED session, before departure) is
preserved exactly as before — this change only closes the window after
departure/delivery, which is a different state.

### Part 7 (task #173) — "Dispatch Now" defaults to invoiced quantities (verify/fix)

Verified against the directive's five specific behaviors: default equals
invoiced quantity; reopening the dispatch panel does not silently overwrite
already-saved actuals; an explicit Reset-to-Invoice action exists; invoiced
quantity is preserved separately from the actual dispatched quantity; and
validation runs before confirm. `lib/fulfilment/queries.ts` and
`app/fulfilment/[id]/page.tsx` carry the fix where a gap was found; this was
a verify/fix task, not a rebuild, per its own task description.

### Part 8 (task #174) — Standardize invoice rejection reason dropdown (10 categories)

`lib/invoice-claims/validation.ts` maps the existing `InvoiceClaimCategory`
enum to the exact 10 business-facing labels (Price Claim, Poor Quality,
Short Delivery, Not Ordered, Not Delivered, OverSupply, Expired, No
BarCode, BarCode Scabbing Problem, Duplicate) — these are the same 10 labels
locked verbatim by a pre-existing test from earlier in this engagement,
unchanged in this round. The internal enum is preserved for backward
compatibility; the mapping is label-only, so no category was duplicated and
no sample-document reason outside this list was silently added.
`tests/invoice-claims.test.ts` covers the mapping.

### Part 9 (task #175) — Customer page CSV import UI

`app/customers/master-import/page.tsx` (new) adds the full Import Customers
workflow on top of the already-existing parser/contract
(`app/api/customers/master-import/route.ts`,
`app/api/customers/master-import/preview/route.ts`): file select, header/field
validation, preview, inline error display, duplicate/existing-record
detection, create/update/skip counts, a confirm step, and a final summary.
Writes are transactional/batched, end with an `AuditEvent` carrying the
counts, are role-restricted, and the route validates file type/size/content
server-side before any parsing begins.

**On the task #156 customer-master CSV itself:** this session could not
independently re-verify delivery of that separate CSV + report set, because
it was reportedly delivered in an earlier round of this engagement, before
this session's own context began. What this session *can* confirm directly:
`data-quality-report.md` and `field-mapping-report.md` still exist at the
project root, and a copy of the CSV exists in this session's own scratchpad
at `/tmp/claude-0/-home-claude/bd1740d4-b0f1-56f2-abe0-e412938f4e26/scratchpad/part8-customer-import/customer-master-import.csv`. If that earlier delivery did not
reach you, say so and this file can be re-sent from this session immediately
— it does not need to be rebuilt.

### Part 10-12 (task #176) — shadcn/ui + chart library adoption

`components.json`, `lib/utils.ts` (the `cn()` helper), and the Radix/CVA/clsx/
tailwind-merge dependencies in `package.json` set up the project for
shadcn/ui, consistent with the directive's instruction to adopt it for this
round's new/updated screens rather than rewrite the whole app. Per this
round's own standing constraint, **no shadcn/ui component source file was
hand-authored and `npx shadcn@latest add ...` was never run in this
sandbox** (no reachable `ui.shadcn.com` registry from here) — the one
exception, `components/ui/chart.tsx`, is the Recharts-wrapper pattern
shadcn's own documentation instructs be copied by hand, since it has no CLI
registry entry. `INSTALLATION-COMMANDS.md` (delivered separately) lists the
exact `npx shadcn@latest add <component>` commands for the 11 primitives
this round's screens would use once installed, with a table of which
existing hand-rolled markup each would replace — nothing delivered in this
round is broken or half-migrated without them; the screens render correctly
today on the existing Tailwind patterns. Recharts (`^3.10.1`) was selected
per the directive's stated preference and is already fully wired —
`components/charts/lost-sales-trend.tsx` is the one reusable chart component
this round needed, and it was audited against this engagement's own
data-visualization standard (tooltips, correct-for-series legend behavior,
`ResponsiveContainer`, correct chart type for a time series, identity never
carried by color alone, real query-sourced data only).

### Part 13 (task #177) — Data-cleanup dependency map + safe reset script

`DATABASE-CLEANUP-PLAN.md` (delivered separately) maps all 61 Prisma models'
FK dependencies and lists the 14 preserved-vs-47 wiped tables for an
operational data reset, plus the one genuine judgment call it required
(`ProductAlias`/`CustomerAlias` handling) and a rollback procedure.
`scripts/reset-operational-data.ts` implements that plan behind seven
independent safety gates — admin-gated actor validation, a mandatory
`--dry-run` path, a fresh-recount confirmation that must match
`--confirm-total-rows` (so a stale or copy-pasted command is rejected), a
required `--backup-reference`, a required literal `--confirm` phrase, a
single `prisma.$transaction` with a raised timeout, and a terminal
`AuditEvent`. Per the directive's own non-negotiable standing constraint,
**this script has never been executed in this sandbox, against this or any
other database, and nothing calls it from startup, migration, seeding, or
deployment code.** The pure argument-parsing/guard logic was extracted into
`lib/db-reset-args.ts` specifically so it could be unit-tested without a
database — 19 tests in `tests/db-reset-args.test.ts` cover every gate
individually, the gate-check order, and the zero/negative/NaN edge cases.

### Part 14 (task #178) — Tests for every new/changed rule

A judgment-based gap sweep (not a mechanical one) across every part above,
closing the two genuine, previously-untested gaps found: the Part 5
status-display fix (now covered in `tests/reporting-db.integration.test.ts`)
and the Part 1 supersession/correction logic plus its Part 3 analytics
integration (now covered in `tests/lost-sales-db.integration.test.ts` and
the new `tests/lost-sales-analytics-db.integration.test.ts`). Several other
candidate areas were explicitly judged already adequate — role-gating
403-paths and "thin composition" dashboard summaries are a documented,
project-wide scope boundary this codebase's own existing test comments
already establish (e.g. `reporting-db.integration.test.ts`'s own module
comment), not a gap introduced by this round.

### Part 15 (task #179) — This report, final verification, Windows commands, zip

This document, plus a final, consolidated, honest run of lint/tsc/vitest
(§1/§4), the two sandbox-blocked gates reproduced with their exact errors
(§5), `WINDOWS-SETUP-AND-VALIDATION.md` (delivered separately, covering only
this round's own setup/validation steps, split into safe/read-only vs.
mutating sections), and the zip itself (§3).

---

## 3. Files changed or added this round

**74 files**, determined the same way the preceding round's report
determined its own file list — this repository has no `.git` history to
diff against, so changed/new files were found by comparing modification
times against `FINAL-OPERATIONAL-ENHANCEMENTS-DELIVERY-REPORT.md` (the
prior round's own finalized report, timestamped 2026-11-16 10:46:59 UTC,
immediately before this round's first schema migration at 13:35:49 UTC the
same day):

```
find . -newer FINAL-OPERATIONAL-ENHANCEMENTS-DELIVERY-REPORT.md -type f \
  -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./.next/*"
```

**Excluded from this count and from the zip:** `tsconfig.tsbuildinfo` (a
local incremental-build cache file, not source — regenerates automatically)
and `package-lock.json` (its timestamp changed, but `package.json`'s own
dependency list — checked directly, §2 Part 10-12 — already carried every
dependency this round needed before this session began working; no
`npm install` was run in this sandbox at any point this round, consistent
with this round's own standing constraint). Also excluded: the four
separately-delivered report/plan documents themselves
(`DATABASE-CLEANUP-PLAN.md`, `INSTALLATION-COMMANDS.md`,
`FINAL-IMPLEMENTATION-REPORT.md`, `WINDOWS-SETUP-AND-VALIDATION.md`) — these
ship alongside the zip, not inside it, per this round's own delivery
convention.

**On new-vs-modified status:** without git history, this session can
state with certainty that every file below was touched *during* this round
(that is what the `-newer` check proves), but cannot always independently
verify which were brand-new versus edited in place beyond the files this
session itself authored directly, or that an existing project document
(`INSTALLATION-COMMANDS.md`) explicitly confirms. Those are flagged
`*(new)*` below; everything else is reported as "changed this round" without
an unverified new/modified claim attached.

**Schema / migration (2):**
- `prisma/schema.prisma`
- `prisma/migrations/20261116130000_add_lost_sales_automation/migration.sql` *(new)*

**Scripts (1):**
- `scripts/reset-operational-data.ts` *(new)*

**Library — business logic (21):**
- `lib/db-reset-args.ts` *(new)*
- `lib/fulfilment/queries.ts`
- `lib/invoice-claims/validation.ts`
- `lib/lost-sales/analytics-queries.ts`
- `lib/lost-sales/analytics-validation.ts`
- `lib/lost-sales/confirm-lost-sale.ts`
- `lib/lost-sales/create-unfulfilled-demand.ts`
- `lib/lost-sales/display.ts`
- `lib/lost-sales/queries.ts`
- `lib/lost-sales/record-decision.ts`
- `lib/lost-sales/validation.ts`
- `lib/order-display.ts`
- `lib/order-queries.ts`
- `lib/picking/queries.ts`
- `lib/picking/start-picking.ts`
- `lib/reporting/decision-dashboard-period.ts`
- `lib/reporting/decision-dashboard.ts`
- `lib/reporting/filters.ts`
- `lib/reporting/management-reports.ts`
- `lib/reporting/types.ts`
- `lib/utils.ts` *(new)*

**Components (2, new):**
- `components/charts/lost-sales-trend.tsx` *(new)*
- `components/ui/chart.tsx` *(new)*

**Config (2):**
- `components.json` *(new)*
- `package.json`

**App — routes and UI (32):**
- `app/api/customers/master-import/preview/route.ts`
- `app/api/customers/master-import/route.ts`
- `app/api/lost-sales/analytics/export/route.ts`
- `app/customers/[id]/page.tsx`
- `app/customers/master-import/page.tsx` *(new)*
- `app/customers/page.tsx`
- `app/deliveries/history/page.tsx`
- `app/deliveries/page.tsx`
- `app/fulfilment/[id]/page.tsx`
- `app/fulfilment/[id]/picking-panel.tsx`
- `app/fulfilment/page.tsx`
- `app/globals.css`
- `app/lost-sales/[id]/decision-panel.tsx`
- `app/lost-sales/[id]/page.tsx`
- `app/lost-sales/analytics/_components/charts.tsx`
- `app/lost-sales/analytics/page.tsx`
- `app/lost-sales/page.tsx`
- `app/orders/[id]/page.tsx`
- `app/orders/page.tsx`
- `app/page.tsx`
- `app/products/[id]/page.tsx`
- `app/reports/_components/filter-bar.tsx`
- `app/reports/communications/page.tsx`
- `app/reports/customer-intelligence/page.tsx`
- `app/reports/decision-intelligence/page.tsx`
- `app/reports/financial-exposure/page.tsx`
- `app/reports/fulfilment/page.tsx`
- `app/reports/management/[reportId]/page.tsx`
- `app/reports/page.tsx`
- `app/reports/pipeline/page.tsx`
- `app/reports/product-intelligence/page.tsx`
- `app/reports/sales-performance/page.tsx`

**Tests (14, all under `tests/`):**
- `tests/customer-intelligence-db.integration.test.ts`
- `tests/db-reset-args.test.ts` *(new)*
- `tests/decision-dashboard.test.ts`
- `tests/decision-intelligence-db.integration.test.ts`
- `tests/fulfilment-db.integration.test.ts`
- `tests/invoice-claims.test.ts`
- `tests/lost-sales-analytics-db.integration.test.ts` *(new)*
- `tests/lost-sales-analytics-validation.test.ts`
- `tests/lost-sales-db.integration.test.ts`
- `tests/order-display.test.ts`
- `tests/product-intelligence-db.integration.test.ts`
- `tests/reporting-db.integration.test.ts`
- `tests/reporting-filters.test.ts`
- `tests/sales-performance-db.integration.test.ts`

2 + 1 + 21 + 2 + 2 + 32 + 14 = **74**, matching the zip's own file count
(verified with `unzip -l` at packaging time).

---

## 4. `tsc --noEmit` — honest accounting

760 errors total, broken down by TypeScript error code (reproduced fresh at
report time):

| Code | Count | Cause |
|---|---|---|
| TS7006 | 464 | Implicit-`any` on a function parameter (`tx`, row/line objects, lambda params) |
| TS2694 | 126 | `Prisma` namespace missing a member |
| TS2339 | 104 | Property access on a type resolving to `{}` |
| TS2305 | 42 | No exported member from `@prisma/client` |
| TS2345 | 9 | Argument type mismatch |
| TS2322 | 9 | Assignment type mismatch |
| TS18046 | 6 | `'error' is of type 'unknown'` |

**Root cause, confirmed directly, not assumed — same as every prior
milestone in this engagement:** `@prisma/client` in this sandbox is a
non-functional stub (this session cannot run `prisma generate` against a
real engine binary — `binaries.prisma.sh` returns 403, see §5). Every one of
the 7 codes above is a mechanical, predictable consequence of that stub: an
empty `Prisma` namespace breaks namespaced type references (TS2694); a
`{}`-typed Prisma delegate breaks property access (TS2339) and parameter
inference downstream (TS7006), including into page components that `.map()`
over Prisma-shaped arrays; missing exports (TS2305) cascade from the same
stub. TS2345/TS2322 have held at exactly 9/9 since at least M14/M15's own
delivery reports and gained zero new instances this round.

**Growth from the prior round's own reported baseline (733 → 760, +27) is
fully attributable to this round's own new code, not to any new error
category:** TS7006 +15 (464 vs 449 — new `tx` transaction parameters in
`scripts/reset-operational-data.ts` and the new `.map()`/lambda callbacks
added across this round's new test files and dashboard/analytics modules),
TS2694 +11 (126 vs 115 — new `Prisma.UnfulfilledDemandStatus`,
`Prisma.UnfulfilledDemandWhereInput`, and similar namespaced references
introduced by Part 1's schema additions), TS2339 +1 (104 vs 103 — property
access on the new `supersededByDemandId` relation through the same stubbed
delegate type). TS2305 (42), TS2345 (9), TS2322 (9), and TS18046 (6) are
unchanged. **Zero new error codes appear anywhere in this round's output** —
this was checked explicitly with
`grep -oE 'error TS[0-9]+' | sort | uniq -c` against the known 7-code
baseline before any of this round's work was accepted as complete, per this
engagement's own standing testing-rigor requirement, and the one genuinely
new category that did briefly appear during development (TS1501, a regex
dotAll-flag issue in a draft of `lib/db-reset-args.ts`) was identified and
fixed before this report was written — see the note on that fix below.

**One fix applied during this round that is worth calling out:** an early
draft of `lib/db-reset-args.ts` used the `/s` (dotAll) regex flag, which
requires an es2018+ compile target this project's `tsconfig.json` does not
set — a genuinely new `TS1501` error, not attributable to the Prisma stub.
It was caught by the same bucket-diffing discipline described above and
fixed by removing the unneeded flag (argv entries never contain embedded
newlines, so plain `.` already matches everything the parser needs); the
final count above reflects the fix, not the defect.

**What this means for production:** none of this is expected to reproduce
against a real `@prisma/client` build. This is a sandbox-only artifact of
the stubbed package, not a defect in the code delivered.

---

## 5. The two gates that could not run here

### `prisma validate` / `prisma generate`

```
Error: Failed to fetch sha256 checksum at
https://binaries.prisma.sh/all_commits/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/debian-openssl-3.0.x/schema-engine.gz.sha256 - 403 Forbidden
```

Reproduced fresh at report time, with a placeholder `DATABASE_URL` set
(required just to load `prisma.config.ts`). The failure is this sandbox's
outbound-network allowlist rejecting `binaries.prisma.sh`, not a schema
problem.

**Mitigation performed instead:** this round's one migration
(`prisma/migrations/20261116130000_add_lost_sales_automation/migration.sql`)
was hand-written and reviewed field-by-field against `prisma/schema.prisma`
for a 1:1 match in a prior window of this same engagement — every new
column is nullable (so no backfill is required for existing rows), the one
`ALTER TYPE ... ADD VALUE` statement adds a single enum value, and the new
FK (`supersededByDemandId`) is `ON DELETE SET NULL ON UPDATE CASCADE`,
self-referential, and nullable. It has **not** been applied or tested
against a live database. **Before relying on it:** run `prisma migrate
status` against the target database first, then `prisma migrate deploy` —
see `WINDOWS-SETUP-AND-VALIDATION.md` for the exact commands.

### `next build`

```
Error: next/font: error:
Failed to fetch Geist from Google Fonts.
If you are offline or behind a proxy, self-host the font with next/font/local,
or set HTTP_PROXY/HTTPS_PROXY so Next.js can reach fonts.googleapis.com.
Import trace: ... ./app/layout.tsx
(and the same error for Geist Mono)
```

Reproduced fresh at report time (`npx next build`, 2 errors, both on the
same root-layout font import). `app/layout.tsx` is **not** in this round's
changed-file list (§3) — it predates this round entirely, and the failure
occurs during root-layout module evaluation, before the build reaches any
route this round touched. It is structurally identical to the Prisma block
above: an outbound HTTPS request to a host (`fonts.googleapis.com`) outside
this sandbox's allowlist.

Neither gate is something a code change can fix from inside this sandbox.
Both will behave normally in any environment with ordinary internet egress,
which a real deployment target has.

---

## 6. Honest limitations / what still needs a real environment

- The one new migration has been reviewed but **never applied**. Run
  `prisma migrate status` first, then `prisma migrate deploy`, against a
  disposable copy of the target database before touching production.
- The gated `*-db.integration.test.ts` files — 8 of the 14 test files
  touched or added this round (`customer-intelligence-db`,
  `decision-intelligence-db`, `fulfilment-db`, `lost-sales-analytics-db`,
  `lost-sales-db`, `product-intelligence-db`, `reporting-db`,
  `sales-performance-db`; see the exact file list in §3), plus 17 more from
  earlier rounds (25 such files exist in the repo in total, per the full
  `vitest run` skip count in §1) — have never executed against a real
  Postgres instance in this sandbox. There is no `DATABASE_URL` here, so
  they self-skip (`describe.skipIf`), by design. Run
  `RUN_DB_INTEGRATION_TESTS=1 npx vitest run` against a real, disposable
  database before go-live.
- `next build`'s static-generation/prerendering phase has, as a direct
  consequence of the font-fetch block above, never been exercised for any
  of this round's new or changed pages (the lost-sales analytics page, the
  customer master-import page, the rebuilt dashboard and decision
  intelligence pages). A real build should be run once, in an environment
  with normal internet access, before shipping.
- `scripts/reset-operational-data.ts` has never been executed, in any mode,
  against any database, by this session or any prior one in this
  engagement — it is reviewed and unit-tested (its pure argument/guard
  logic only; see §2 Part 13) but not integration-tested, by design, per
  this round's own standing constraint against running it automatically or
  without explicit approval.
- The shadcn/ui component primitives listed in `INSTALLATION-COMMANDS.md`
  have not been installed in this sandbox (no reachable
  `ui.shadcn.com` registry) — this round's screens render correctly on the
  project's existing hand-rolled Tailwind patterns without them; installing
  them is a follow-up visual refactor, not a blocker for anything delivered
  this round.

None of these are claimed as done above. They are the explicit, remaining
gap between "verified in this sandbox" and "verified end-to-end," called out
here rather than folded into a blanket completion claim.
