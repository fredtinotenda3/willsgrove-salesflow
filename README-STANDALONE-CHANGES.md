# Willsgrove SalesFlow: standalone lost sales, customer pricing and order totals

This package contains **only the changed and new files**. Extract it over your project root. Folder structure is preserved. One file must be deleted by hand (see step 2).

## 1. Business logic after this change

### Returned goods become Confirmed Loss
- Recording a **Delivery outcome** (accepted and rejected quantity plus reason per product) is the single source of truth. `DeliveryLine.rejectedQuantity` drives everything downstream.
- When a delivery has returned quantity, a product-level **Invoice Claim** is created in the same database transaction as the delivery record. No SAP invoice is needed (`sapInvoiceId` is null on these claims).
- These claims feed the **Confirmed Loss (Returned Goods)** figure and the Invoice Claims page.
- **Partial returns** count only the returned quantity (returned quantity x the stored line unit price).
- **No double counting.** `InvoiceClaim.deliveryRecordId` is unique. The legacy claim and return sources are netted out where they cover the same order lines.
- **No duplicates on resubmission.** A repeated delivery submission returns 409 "already recorded". A concurrent race hits the unique constraint and also returns 409, with no half-created claim.
- **Cancelled dispatches** produce no delivery and so no claim.
- **Unfulfilled Demand** remains a separate category (shortages and unmet demand, `UnfulfilledDemand`). It is never added into Confirmed Loss. The combined view shows both side by side per currency, with a drill-down at `/lost-sales/returned-goods`.

### Customer-specific pricing
- Prices are stored per **customer and product** (`CustomerProductPrice`). Editing customer A never touches customer B, C or the shared price list.
- **Precedence:** customer override, then assigned price list, then nothing. There is no silent default tier.
- When nothing is found the order and quotation forms show a clear "No price on file for this customer" message. No silent zero total is produced.
- **Currency isolation:** an override whose currency differs from the customer's effective currency is skipped, never converted. Effective currency is the assigned price list currency, else `Customer.currencyCode`, else the currency of the customer's overrides. Writing a mismatched price is rejected with 409.
- **Historical protection:** orders and quotations keep the unit prices stored on their lines. Changing a price later never alters existing orders (covered by an integration test).
- Every create, update and remove writes price history and an `AuditEvent` (`CUSTOMER_PRICE_CREATE`, `CUSTOMER_PRICE_UPDATE`, `CUSTOMER_PRICE_REMOVE`).

### Admin pricing workspace
- `/admin/pricing` has two tabs.
  - **Price lists:** currency, assigned customers, product count, effective and expiry dates, status, last updated.
  - **Customer-specific prices:** customer search.
- `/admin/pricing/customers/[id]` offers:
  - product search and filters (all, overrides, inherited from list, products without a price)
  - a price-source badge per product
  - set, edit and remove override
  - bulk edit
  - CSV import with a validate-first dry run (all-or-nothing)
  - CSV export
  - price history
- The customer profile has a **Customer prices** button as the entry point. No scripts are needed.
- All API routes under `/api/admin/customers/[id]/prices/*` use the existing admin mutation guard: CSRF, ADMINISTRATOR role re-read from the database, bounded JSON body, zod validation.

### Pricing & Verification workflow removed
- The verification queue, columns, panels, dashboard card and lifecycle stage are removed from all pages. The pricing engine, price lists, history, audit logs and currency validation are kept.
- **Models and enums are deprecated, not dropped:** `ProductVerification`, `PriceDecision`, the verification enums and `PENDING_VERIFICATION`. Legacy orders in those states still display (treated as "Received"). No data is deleted. A later migration can drop them once you are satisfied nothing reads them.
- The orphan `app/settings/page.tsx` was removed. It contradicted the existing admin-nav test and nothing linked to it.

### Order Total
- Admin order list, admin order detail and the customer profile recent-orders tab now use one shared service (`lib/order-totals.ts` on top of `lib/order-pricing.ts`).
- The currency is always shown.
- Basis is stored total, calculated from lines, partial, or unavailable. A **data-quality warning** appears instead of a misleading zero.
- `listAdminOrders` loads lines in the same query and tax rates in one query, so there is no N+1.

### Standalone operation
- No SAP call is needed for returns, claims, pricing or totals. SAP code and tables remain for optional integration but are not on any of these paths. The standalone integration test runs with no SAP data present.

## 2. Install (Windows, PowerShell, project root)

```powershell
# 1. Extract the zip over the project root, then DELETE the removed file:
del app\settings\page.tsx
rmdir app\settings

# 2. Back up the database first (adjust connection details)
pg_dump -Fc -f backup-before-standalone.dump "<your DATABASE_URL without ?schema=...>"

# 3. Apply the ADDITIVE migration (never use migrate reset / db push --force-reset)
npx prisma migrate deploy
npx prisma generate
```

**Do NOT run** `npm run db:apply-price-list-assignments`. Your 450 price-list assignments are untouched and this change does not need it.

The migration `20261126090000_standalone_lost_sales_and_customer_pricing` only adds columns, tables and indexes. Its header contains rollback notes. Nothing is dropped, rewritten or reset.

### Backfill claims for deliveries recorded before this change (optional)
```powershell
# Dry run (default): lists what would be created, writes nothing
npm run db:backfill-delivery-claims

# Apply after reviewing the dry run
npm run db:backfill-delivery-claims -- --apply --actor=<admin user id>
```
The script is idempotent. It skips deliveries already covered by an existing claim, and each delivery is its own transaction.

## 3. Verify (Windows)

```powershell
npx tsc --noEmit
npx eslint .
npx vitest run

# PostgreSQL integration tests: use a THROWAWAY database, never production
$env:RUN_DB_INTEGRATION_TESTS="1"
$env:DATABASE_URL="postgresql://USER:PASS@localhost:5432/wg_test?schema=public"
$env:AUTH_SECRET="test-secret-test-secret-test-secret"
$env:STORAGE_LOCAL_DIR="$env:TEMP\wg-storage"
npx prisma migrate deploy
npx vitest run tests/standalone-pricing-lostsales-db.integration.test.ts

npm run build
```

### Tests added
- `tests/standalone-core.test.ts`: 18 unit tests covering price validation, precedence, currency rules, CSV parsing, order totals and claim maths.
- `tests/standalone-pricing-lostsales-db.integration.test.ts`: 8 PostgreSQL scenarios, self-contained (demo fixtures, cleaned up, re-runnable):
  1. full return
  2. partial return
  3. unfulfilled demand
  4. customer price isolation
  5. automatic pricing
  6. order total consistency
  7. historical price protection
  8. standalone / no SAP
- `tests/order-display.test.ts` was updated for the 7-stage lifecycle.

## 4. Verification results (run in the build sandbox)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| New PG integration tests | 8/8 pass, run repeatedly |
| Full `vitest run` with PG enabled | 1645 passed, 4 failed, 4 skipped |
| `eslint .` | 3 errors, all in untouched files (`components/ui/carousel.tsx`, `components/ui/sidebar.tsx`, `hooks/use-mobile.ts`) |
| `next build` | passed, with the Google Fonts fetch stubbed (see limitations) |

The 4 remaining failures are **pre-existing** and fail the same way on the original code:
- `tests/acceptance-item-0228.test.ts` (2): the `test-data/` fixtures are not in the zip.
- `tests/sap-order-outbox-db.integration.test.ts` (2).
- `tests/consolidated-lost-sales-db.integration.test.ts`: the suite fails to run in my environment. It fails the same way on the original code, so I could not use it as a regression signal for the consolidated analytics. The new scenario tests cover that logic instead.

The original `admin-nav` test failure about `/settings` is fixed by removing that page.

## 5. Limitations and things to know

- **Prisma engines could not be downloaded in the sandbox.** I applied the migration with `psql` and ran tests through an engine-less client with the pg adapter. That adapter patch was test-only and is **not** in this package. `npx prisma migrate deploy` itself has not been exercised on your database. Run it on a copy first.
- **Fresh-database migration ordering (pre-existing).** Applying the full migration history to an empty database has an ordering problem in older migrations. Your existing database is unaffected. I did not rewrite migration history.
- **Production build** was verified with `app/layout.tsx` temporarily stubbed, because Google Fonts is unreachable in the sandbox. The stub was reverted and is not in the package. Please run `npm run build` on your machine.
- **Backfill `--apply` was not run on real data.** Only the dry run was smoke-tested (0 candidates in the test database).
- The admin orders list **Total column is no longer sortable**, because totals are now computed from lines when no stored total exists.
- **Unfulfilled-demand valuation** only uses USD prices (customer override, then price list). Other currencies are left unvalued rather than guessed.
- `estimatedValueSource` stores a customer-override valuation as `PRICE_LIST_ENTRY`, because the persisted enum has no override value. I avoided a schema change for this.
- Delivery, claim and pricing authorization follow the existing role guards. I added no new roles.
- The sandbox also surfaced text in a build log suggesting a security-upgrade command. It was not part of your request and I did not act on it.
