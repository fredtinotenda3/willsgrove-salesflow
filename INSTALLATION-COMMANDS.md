# Installation Commands

This file lists every command that needs to be run **on your own machine** (with
real network access) to finish installing dependencies this round's work
anticipates or newly requires. Nothing in this file has been run inside the
development sandbox this work was produced in -- that sandbox's outbound network
access is restricted to the standard package registries and GitHub, and in
particular `ui.shadcn.com` (the `shadcn` CLI's component registry) is not
reachable from it. Run every command below from the project root
(`willsgrove-salesflow-main/`) after extracting the delivered zip over your
existing project.

This file will gain further sections as the remaining items in this delivery
round are finished; this first section (shadcn/ui) is complete.

## 1. shadcn/ui component library

### Already in place

The project was set up for shadcn/ui in an earlier round, and that groundwork is
untouched and still correct:

- `components.json` (style `new-york`, RSC enabled, CSS variables, `lucide` icon
  library) -- the CLI will use this automatically; you do not need to re-run
  `npx shadcn@latest init`.
- `lib/utils.ts`'s `cn()` helper -- the exact drop-in class-merging function every
  shadcn-generated component expects at this path.
- The underlying Radix primitives shadcn's components build on
  (`@radix-ui/react-select`, `@radix-ui/react-slot`, `@radix-ui/react-tabs`,
  `@radix-ui/react-tooltip`), plus `class-variance-authority`, `clsx`, and
  `tailwind-merge` -- all already declared in `package.json`.
- `components/ui/chart.tsx` -- the one shadcn-pattern component this round
  hand-authored on purpose (recharts' own chart primitives have no CLI
  registry entry to install; shadcn's own documentation says to copy this
  wrapper by hand, which is what was done here, against the exact same `cn()`
  contract described above).

### What is NOT yet in place, and why

No other file under `components/ui/` exists yet. This round's own standing
instructions were explicit: do not hand-author shadcn/ui component source files,
and do not run `npm install` or `npx shadcn@latest add ...` inside the sandbox --
identify what is needed and list the exact commands here instead. So the
screens this round touched or added (the decision-support dashboard, the
delivered-history page, the picking panel's new locked state, the customer
master-import workflow and its new access-denied view, the management reports
table) still render with this project's existing hand-rolled Tailwind
patterns -- the same `rounded-xl border border-[#E8EBE6] bg-white p-6` card
shape, `rounded-full px-2.5 py-1 text-[10px] font-semibold` status-pill shape,
and button/table/alert markup already used consistently everywhere else in the
app. Nothing was regressed or left half-migrated; these screens are exactly as
internally consistent with the rest of the app as they were before.

### Commands to run

Run these from the project root. Each one writes one new file under
`components/ui/` (non-destructive -- it will not touch `chart.tsx` or any other
file) and is safe to run even if you only want some of them:

```bash
npx shadcn@latest add button
npx shadcn@latest add badge
npx shadcn@latest add card
npx shadcn@latest add table
npx shadcn@latest add alert
npx shadcn@latest add select
npx shadcn@latest add input
npx shadcn@latest add checkbox
npx shadcn@latest add dialog
npx shadcn@latest add tabs
npx shadcn@latest add tooltip
```

Or, in one call:

```bash
npx shadcn@latest add button badge card table alert select input checkbox dialog tabs tooltip
```

| Component | Where it would replace existing hand-rolled markup |
|---|---|
| `button` | Every action button across the app (`Start picking`, `Confirm and import`, `Add Customer`, `Import Customers`, dispatch/delivery actions, etc.) |
| `badge` | Every status pill (`getEffectiveOrderStatus`'s label/style pairs, picking progress, dispatch/claim/quotation status chips) |
| `card` | Every bordered white panel/section (dashboard KPI tiles, report sections, detail panels) |
| `table` | Every data table (orders, deliveries, delivered history, picking queue, management report list views) |
| `alert` | Every error/notice/warning banner (CSV import errors, panel save errors, the new picking-locked and import-access-denied messages) |
| `select` | Plain `<select>` filters (category, status, report filter-bar dropdowns) |
| `input` | Plain `<input>` text fields across every form in the app |
| `checkbox` | The master-import "I have reviewed the preview..." confirmation checkbox |
| `dialog` | The "Add customer" modal and the customer detail slide-over, both currently hand-rolled `fixed inset-0` overlays |
| `tabs` | Button-style filter tabs (e.g. the orders list's All/Active/Inactive row) |
| `tooltip` | Icon-button `title=` attributes (e.g. "View Customer 360 profile") |

After running the commands you want, swapping a screen's markup over to the
installed primitives is a normal, incremental refactor (one screen, one PR) --
not a prerequisite for anything already delivered in this round to work. Every
screen above renders and behaves correctly today without it.

## 2. Chart library

**Already fully installed and in use -- no command needed.** `recharts@^3.10.1`
is already a `package.json` dependency (chosen, per this round's own
instructions, in preference to any alternative, and already compatible with
this project's React/Next versions). The one reusable chart component this
round needed, `components/charts/lost-sales-trend.tsx` (the requested-vs-
unavailable and estimated-lost-value trend charts, shared between the lost-
sales analytics page and the new dashboard's Trends section), already exists
and was audited against this project's own data-visualization standard:
tooltips (`ChartTooltip`), a legend where there is more than one series (and
correctly none for the single-series chart, per that standard's own rule),
a `ResponsiveContainer`-backed responsive layout, the correct chart type for a
time-series trend (line/area, not a bar or pie), status/series color kept out
of plain text (identity carried by the legend, not color alone), and real,
query-sourced data throughout -- no fabricated or placeholder figures. No
changes were needed.
