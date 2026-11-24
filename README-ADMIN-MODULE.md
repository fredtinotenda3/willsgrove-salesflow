# Willsgrove SalesFlow — System Administration & Operational Management

Adds an Administrator-only **Administration Centre** (`/admin`) to the existing application. Built on the real models, auth, CSRF, audit and design system. This ZIP contains only new and modified files, one migration and this README. Copy over the project preserving paths.

## 1. Audit findings (before this work)

| Entity | View | Create | Edit | Deactivate/archive | Assign | Audit | Finding |
|---|---|---|---|---|---|---|---|
| Users | yes | yes | **missing** (no name/role/department) | yes (status only) | n/a | create/status | No role change, password reset, last login, leaver handover. Last-admin rule was self-only. |
| Products | yes | import only | **missing** | **missing** | n/a | import | No create/edit/archive or duplicate-barcode check. |
| Customers | yes | yes | yes | yes | **no account manager** | edit audit had **no actor** | Fixed actor; inactive price lists could be attached. |
| Price lists | yes | import | entries only | **missing** | to customers | import | No list status, rename or dependency protection. |
| Orders | yes | yes | yes | cancel via workflow | salesperson set at creation only | status history | No reassignment, no unassigned/idle view. |
| Quotations | yes | yes | drafts | cancel/expire | salesperson set at creation only | events | No reassignment tooling. |
| Claims | yes | yes | workflow | workflow | assignee field existed | yes | No central reassignment. |
| Configuration | n/a | n/a | **defective** | n/a | n/a | none | Settings page showed "saved in this prototype" and stored nothing. |
| Audit log | **missing** | | | | | | Events were written but could not be viewed. |

Already complete and reused (not duplicated): order, quotation, claim, delivery, picking and approval workflows, approval policies, personnel and vehicles register, SAP/price/customer/credit-note/invoice imports with preview.

## 2. What was added

- **`/admin` Overview**: active/inactive users, customers, products, price lists; outstanding orders; unassigned and idle work; pending approvals; open claims and management actions; configuration status; recent administrative activity. Links through, never duplicates the reports.
- **Users & access** (`/admin/users`, `/admin/users/[id]`): create (existing API), rename, change role, set department, activate/deactivate with reason, forced password change, secure password reset (one-time temporary password, shown once, not stored recoverably, never written to the audit log), last sign-in, active sessions, open-work counts, hand over all open work to another user. A role change or deactivation ends the user's sessions immediately.
- **Assignments** (`/admin/assignments`): unassigned / idle / all open work for orders, quotations, customers, claims and management actions; filter by owner and search; server-side pagination; bulk reassignment with preview, confirmation, reason and one audit event per record. Closed records are skipped and reported.
- **Products** (`/admin/products`): search, status/category/missing-barcode filters, create, edit, archive/restore, duplicate item-code and barcode detection, reference counts, change history, CSV export and template. **SAP item codes cannot be edited. Products are never deleted.**
- **Customers** (`/admin/customers`): new *account manager* ownership, assignment and reassignment. Customer details, contacts, locations, orders, claims stay on the existing customer pages.
- **Pricing** (`/admin/price-lists`): list status (activate/deactivate), rename. An inactive list cannot be newly assigned to a customer (customer edit and bulk assign now enforce this). A list still used by customers cannot be deactivated. Code and currency are never edited; entries and historical transaction prices are untouched.
- **Configuration** (`/admin/configuration`): 22 registered, bounded, audited settings: management recommendation thresholds (now actually used by the nine management reports and the Action Centre), default quotation validity (pre-fills New Quotation), and idle-order days. Ordered pairs (flag < critical) can never invert.
- **Audit log** (`/admin/audit`): search and filter by person, record type, action, date; before/after; CSV export (itself audited). Read-only: no edit or delete path exists.
- **Data** (`/admin/data`): CSV exports (products, template, customers, users without credentials, audit) and links to the existing preview-based import screens.
- Settings page no longer claims "saved in this prototype"; it states what is stored and where.

## 3. Rules (enforced in code, not configuration)

- Every `/api/admin/*` mutation: CSRF origin check → session → ADMINISTRATOR role re-read from the database → bounded JSON → zod → service in a transaction → audit event. Page redirects are only convenience.
- Last active administrator cannot be deactivated or demoted; nobody can demote or deactivate themselves.
- Work can only be assigned to ACTIVE users. Orders past approval-to-invoice (READY_TO_INVOICE, REJECTED, CANCELLED), non-open/converted/superseded quotations, and concluded claims keep their owner.
- Bulk reassignment is capped at 500, previewed, and re-derived inside the transaction.
- Not configurable by design: authentication/session rules, role permissions, CSRF, financial calculations and currency separation, historical-record protection. Approval thresholds remain on the existing Approval Policies screen.
- Reasons are required (3–500 chars) for sensitive changes and stored in the audit `afterData`.
- Exports neutralise spreadsheet formulas and never include password hashes.

## 4. Migration

`prisma/migrations/20261125090000_add_administration_module` is purely additive: `User.department` (nullable), `Customer.accountManagerId` (nullable, indexed, FK ON DELETE SET NULL), `PriceList.status` (default ACTIVE for every existing list), table `SystemSetting`. Nothing is backfilled or dropped.

```powershell
npx prisma migrate deploy
npx prisma generate
```

## 5. Verification actually performed

| Check | Result |
|---|---|
| `prisma validate` | pass |
| `prisma generate` | pass |
| `tsc --noEmit` | pass, 0 errors |
| ESLint, new/changed code | 0 errors |
| ESLint, whole repo | 3 errors, **all pre-existing** (`components/ui/carousel.tsx`, `components/ui/sidebar.tsx`, `hooks/use-mobile.ts`) |
| Vitest, whole suite | 1261 passed, 259 skipped (DB integration), 2 failed — **pre-existing** (`tests/acceptance-item-0228.test.ts`, needs `test-data/`) |
| New admin tests | 73 passed in 5 files (policy, registry, validation/CSV/paging, route access for every admin endpoint, services) |
| `next build` | **could not complete** in the sandbox: Google Fonts fetch fails (pre-existing, same on the baseline). No other compile error was reported. |

One existing test was edited: `tests/m12-acceptance-criteria.test.ts` asserted the exact JSX `<NewQuotationForm />`. It now also allows the `defaultValidityDays` prop and still forbids `defaultSalespersonId`.

## 6. Limitations (stated plainly)

- **Not run:** the 259 database integration tests and the new SQL migration against a real PostgreSQL (no database in the sandbox); the production build; browser/UI testing. The services are verified against a mocked Prisma client. Run `npx prisma migrate deploy` and the integration suite on a staging database before release.
- "Suspend" is represented as INACTIVE; there is no separate suspended state. Granular per-user permissions and notification preferences are not supported by the current architecture and were not invented.
- No driver, vehicle or delivery-assignment changes were added; those already exist on the order dispatch screens, and fulfilment completion still requires its existing evidence.
- Quotation, order, claim and customer *editing* and status workflows remain on their existing screens (reused, not duplicated). Admin adds ownership and oversight on top.
- Price-list entries, effective dates and import review use the existing price-list and import screens. There is no separate publish-approval workflow for prices.
- Assignment history is read from the audit log (no new history table). Existing customers have no account manager until assigned.
- Existing `PATCH /api/users/[id]` (Settings page) is kept for compatibility; it keeps the earlier self-deactivation rule only. The Administration screens use the stricter last-administrator guard.

## CRUD coverage (added)

| Area | Create | Edit | Remove / deactivate | Notes |
|---|---|---|---|---|
| Orders `/admin/orders` | via the normal order flow | details (PO ref, delivery date/address, internal notes) | Cancel, Reopen | Edit/cancel only DRAFT→APPROVED, never after picking, SAP hand-over, invoicing or with a pending approval. Reason required; status history + audit written. Orders are never deleted. |
| Quotations `/admin/quotations` | New quotation | on the quotation screens | Cancel (reason), Expire, Reassign | Converted quotations keep their order link. |
| Claims `/admin/claims` | New claim | workflow on the claim | Assign owner | Concluded claims keep their owner. |
| Customers | Add | Edit | Deactivate / Reactivate | Never deleted. |
| Price lists `/admin/price-lists[/id]` | New list, add price | rename, change price | Deactivate list, remove price | Overlapping dates rejected; orders/quotations keep snapshot prices. |
| Drivers & vehicles `/admin/fleet` | Add | Edit | Deactivate; delete only if never dispatched | Uses existing `/api/personnel` and `/api/vehicles`. |
| Users, products, settings | (earlier delivery) | | | |

Known pre-existing failures: `tests/acceptance-item-0228.test.ts` (2 tests) needs `test-data/sample-*.csv`, which is not in the uploaded repository.
