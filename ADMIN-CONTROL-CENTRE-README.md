# Administration & Control Centre — delivery notes

Scope: this ZIP contains **only changed, new and (listed) deleted files**. Extract it over the repository root; paths are preserved. No Prisma models, no migrations, no data changes. Everything reads and writes the **same tables** through the existing/shared services, so the operational app and the admin side can never disagree.

## 1. What changed

| Area | Result |
|---|---|
| Command centre `/admin` | Real counts only. Every tile and attention row links to a list already filtered to exactly what was counted. Presets 7d/30d/MTD/YTD with previous-period comparison (no % from a zero baseline). Money is per currency (USD/ZWG never mixed). Claim exposure uses `computeClaimFinancialSummary` / `computeExposureByCurrency`, capped at 500 claims. |
| Shell | Grouped, collapsible sidebar, mobile drawer, breadcrumbs, global search (`/api/admin/search`), consistent dialogs (`action-dialog`), loading state. Navigation lives in one file: `lib/admin/nav.ts`. |
| Lists | URL-driven server tables (search, filters, allow-listed sort, paging, date range, CSV export) on one reusable `DataTable`. Client code only handles column visibility, selection, bulk actions. |
| Detail pages | Tabbed detail with audit trail for orders, quotations, customers, invoices, import batches, claims, products, price lists. |
| `/settings` | **Removed** (redundant: configuration is `/admin/configuration`, users `/admin/users`). Sidebar link and docs reference updated. |

## 2. Coverage matrix

| Module | List | Detail | Create | Edit | Status change | Delete |
|---|---|---|---|---|---|---|
| Users | yes | yes | existing | existing | deactivate/reactivate | never (deactivate) |
| Orders | yes | yes | operational app | notes/details | cancel / reopen | **draft only, unreferenced** |
| Quotations | yes | yes | operational app | — | cancel / expire (existing services) | never |
| SAP invoices / import batches | yes | yes | import | — | — | never |
| Claims | yes | yes | operational app | via existing claim services | existing | never |
| Credit notes / returns | yes | — | import | — | — | never |
| Products | yes | yes | yes | yes | activate/deactivate | **unreferenced only**; aliases removable |
| Customers | yes | yes | existing `/api/customers` | existing | activate/deactivate | **unreferenced only**; contacts add/edit/remove; aliases removable |
| Price lists / entries | yes | yes | yes | yes | activate/deactivate | list: **empty & unassigned only**; entry: removable |
| Fleet, assignments, deliveries | yes | — | existing | existing | existing | fleet: unreferenced only |
| Approvals, stock, integrations, communications | yes (read + existing retry/resend/reconcile actions) | — | — | — | — | never |
| Reports, data management, audit, configuration | yes | — | — | settings with reason | reset to default | never |

## 3. Deletion policy (enforced, shown at `/admin/data`)

Single source of truth: `lib/admin/deletion-policy.ts` (`DELETION_POLICY`), enforced in `lib/admin/record-deletion.ts`.

* Hard delete is offered **only** for: DRAFT orders, customers, products, price lists, product/customer aliases, price-list entries, fleet records — and only when nothing references them.
* Dependency counts are **recomputed inside the transaction**; the page's earlier view is never trusted. A DB foreign-key violation (P2003) rolls back and is reported as 409. Refusals are themselves audited (`*_DELETE_REFUSED`, outcome `REFUSED`).
* The order delete also requires `status = DRAFT` in the `deleteMany` predicate (race-safe) and removes only its own history/lines.
* **Protected (never deletable in the app):** users, quotations and revisions, order lines, SAP invoices/lines/import batches, claims/resolutions/attachments, credit notes, returns, dispatch/delivery records, stock snapshots, integration jobs/operations, message intakes/outbound messages, audit events. Their alternatives (deactivate, cancel, archive, reconcile) are shown in the UI instead of a delete button, so there are no misleading controls.

## 4. Security

* Every admin API route goes through `adminMutation` / `adminRead` (`lib/admin/route.ts`): CSRF origin check → `ADMINISTRATOR` role from the server session → bounded JSON → zod. Every admin **page** calls `requireAdminPage()`; the layout is not the security boundary.
* Unknown export entities / prototype keys return 404 (`Object.hasOwn` allow-list). Exports are audited (`DATA_EXPORT`).
* Sort keys, filters and page sizes are allow-listed; unknown params never reach a query.
* Every mutation writes to the **existing** `AuditEvent` table (no second log): actor, action, entity, before, after, reason, outcome (`lib/admin/audit.ts`), inside the same transaction as the change.
* Currency amounts are formatted from stored decimal strings; nothing is recomputed in floating point.

## 5. Verification results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint app lib tests` | 0 errors, 0 warnings |
| `npx vitest run` | 92 files passed, 32 skipped (need a database), 1 failed file: **1362 passed, 259 skipped, 2 failed** |
| `npx next build` | "Compiled successfully", 192/192 pages generated, all `/admin` and `/api/admin` routes present, no `/settings` route |

Failures: the 2 failing tests are `tests/acceptance-item-0228.test.ts`, which reads `test-data/sample-customer-master.csv`. That directory is not in the supplied zip; it failed identically before this work.

New tests: `admin-nav` (every nav link is a real page, breadcrumbs, `/settings` gone), `admin-list-query` (sort allow-list, date windows, drill-down window equals counted window), `admin-format-audit`, `admin-deletion` (verdict rules, policy table, transactional delete incl. race, FK and refusal auditing), `admin-command-centre-links`, and `admin-routes-access` extended to every new route (401 anonymous, 403 salesperson/manager, 403 foreign origin, no service executed, export 404/audit).

## 6. Windows commands

```powershell
npm install
npx prisma generate
npx prisma migrate deploy      # no new migrations in this delivery; existing ones only
npm run dev
npx tsc --noEmit
npx eslint app lib tests
npx vitest run
npx next build
```

## 7. Files removed (delete these after extracting)

* `app/settings/page.tsx`
* `lib/admin/overview.ts` (replaced by `lib/admin/command-centre.ts`)

`docs/production/USER-ACCEPTANCE-TESTING.md` was updated to point at `/admin/users`. Note `/api/admin/settings` and `/integrations/sap/settings` are different features and remain.

## 8. Known limitations

* **Integration tests need a database** and were not run here (skipped by the suite); nothing was exercised against live Postgres/Neon or SAP. Please run `npx vitest run` and click through `/admin` on a staging DB before release.
* Order **line editing is intentionally not offered in admin**: lines carry verification and price-approval rules and stay in the operational view (the admin page explains this).
* Claim exposure on the command centre is computed per claim and **capped at 500 claims**.
* Stock is imported snapshots, not live inventory.
* `assignments`, `audit`, `configuration`, `fleet`, the price-list list and `users/[id]` were migrated mechanically to the new shell and keep their previous table component; they work but do not yet use the new `DataTable`.
* In the sandbox, `next build` needed Google Fonts stubbed (no internet) and has no Prisma query engine, so the "database health check" log lines during page generation are expected there, not in your environment. `app/layout.tsx` is unchanged in this delivery.
* The build prints a Next.js security-advisory notice for the installed 16.4.4; upgrading Next.js is outside this task and was not done.
