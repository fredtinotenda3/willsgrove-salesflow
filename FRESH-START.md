# Fresh start: empty the database and load showcase data

One command empties everything except user accounts and loads a complete, realistic dataset so you can review every screen.

## Run it

1. Copy the files from this ZIP into the project at the same paths (`package.json` only gains one script line, `db:fresh-start`).
2. Make sure `.env` points at the database you want to empty (`DATABASE_URL`) and that an administrator exists (your normal login does).
3. Dry run (changes nothing; shows the target database and current row counts):

   ```
   npm run db:fresh-start
   ```

4. Wipe and seed:

   ```
   npm run db:fresh-start -- --yes
   ```

   It prints the target database, then waits 10 seconds — press Ctrl+C to abort. The wipe is a single transaction: if it fails, nothing is removed.

## What is removed
Everything except `User` rows: orders, picking, dispatch, deliveries, invoices, claims, returns, lost sales, quotations, approvals, communications, customers, products, price lists, tax codes, personnel, vehicles, approval policies, SAP connection settings, sessions and the audit log. You will be signed out; log back in with your usual account.

## What is loaded
All as real rows (not demo-flagged, so every report and chart includes them).

| Data | Detail |
| --- | --- |
| Tax codes | VAT15 (15%), ZERO, EXEMPT |
| Products | 20 across fruit, vegetables, processed, herbs; four are VAT-rated so tax shows on orders |
| Price lists | Wholesale (USD) and Retail Chains (USD), every product priced |
| Customers | 6 (three supermarkets, hotel, wholesale market, school caterer), each assigned a price list |
| People / vehicles | 2 drivers, 2 assistants, 2 trucks (ABC1234, AEF5678) |
| Orders | 18, created and advanced with the application's own functions |

Order mix: 2 received, 2 pending verification, 1 approved, 5 picked and authorized (4 with shortages, which create lost sales and Lost Value), 1 dispatched, 5 delivered with rejected products and standard claim reasons (appear on Invoice Claims, grouped by invoice, with "File a claim"), 2 delivered cleanly. Orders are dated across the last 18 days so trend charts have a shape.

Delivery rejection reasons used: Poor Quality Product, Short Delivered, Expire, Price Claim, No Barcode, Barcode Scanning Problems, OverSupply, Duplicates.

## If a scenario fails
Master data loads first, then each order scenario runs on its own. A failure is printed (`✗ S12 …`) and the rest continue; the command exits non-zero. Send me the message and I will fix it.

## Editing the data
Everything is in `prisma/fresh-start/data.ts` (pure data, no database code).

## Not seeded
Approval policies, SAP connection settings and quotations/communications are left empty — create them in the UI to review those screens.
