# Business data import guide

Every file in this folder is a CSV derived from the real workbooks you supplied (`Prices.xlsx`, `List_of_Business_Partners.xlsx`, `Items_List.xlsx`). Each one has already been run through the exact same validation logic the app's own import screens use, with **zero errors** (counts below) -- they are ready to import as-is. Nothing in them was invented: blank prices and blank item descriptions in the source were left blank, never defaulted to zero or fabricated text (the app will show these as warnings, not silently hide them).

**Import in this order.** Customer pricing (step 3) depends on price lists existing (step 2); nothing else here has an order dependency, but doing it in this order means every "unmatched" warning you might otherwise see at an earlier step is already resolved by the time you reach it.

## 1. Products -- `items-import.csv` (7,540 rows)

1. Go to **Products → Import** (`/products/import`).
2. Upload `items-import.csv`.
3. Review the preview -- it will flag 154 rows: 7 have no ITEM DESCRIPTION at all in the source file, and 147 have a BARCODE value that isn't a valid number (mostly barcodes Excel itself already mangled into scientific notation, e.g. `4.06214E+12`, somewhere upstream before this export was made -- not something this conversion did; the original text is preserved in each product's SAP source data, never discarded). Both import with the affected field left empty rather than a guessed value. (Separately, 2,137 rows have no barcode at all, which is normal for loose/bulk items and is not flagged.)
4. Confirm the import.

## 2. Customers -- `customer-master-import.csv` (2,647 rows)

1. Go to **Customers → Customer Master Import** (`/customers/master-import`).
2. Upload `customer-master-import.csv`.
3. Review the preview (new / changed / unchanged counts).
4. Confirm the import.

If this fails partway through on a very large run, **it is safe to upload the exact same file again** -- the import is idempotent: anything already created will be detected and skipped (shown as "unchanged"), never duplicated. See `IMPLEMENTATION-REPORT.md` in the project root for the reliability fix this round made to this exact importer.

The source `List_of_Business_Partners.xlsx` export only carries BP Code, BP Name, and 3 informational-only columns (account balance, FC balance, GAAP supplier code) -- it has no TIN, VAT number, currency, price list, address, phone, or contact fields. Every customer this creates will have those fields blank until assigned by hand or a richer export becomes available. Account balance / FC balance / GAAP supplier code are preserved in each customer's audit trail (so the real data isn't silently lost) but are not written to any customer field today -- see `lib/sap-customer-master-csv.ts`'s own comment for why.

## 3. Price lists -- `price-lists-import.csv` (8,256 priced entries across 7 real lists)

1. Go to **Price Lists → Import** (`/price-lists/import`).
2. Upload `price-lists-import.csv`.
3. Review the preview. The 7 price lists and their codes (derived from the source workbook's own "Base Price List" column, not invented):

   | Source sheet | Price list code |
   |---|---|
   | SPAR PRICES | `SPARUSD` |
   | FRESH PLUG | `THEFRESHPLUG` |
   | OK | `OKUSDBYO` |
   | TM | `TM-USD` |
   | BHOLA | `BHOLA` |
   | hospitality | `HOSPI-USD` |
   | pnp usd | `PNPUSD` |

4. Confirm the import. (44,979 item/list combinations in the source had no price at all and were skipped entirely -- not imported as a $0 price. Only the 8,256 rows that actually have a real price are in this file.)

## 4. Assign customers to a price list -- `/price-lists/customers`

Importing the price lists (step 3) does **not** automatically assign any customer to one -- the real customer-master export has no price-list column to drive that from (see step 2). After step 3, go to **Price Lists → Customer Pricing** (`/price-lists/customers`) and assign each customer's price list by hand. This is also where you'll do it if you only have a few customers whose list you know today (e.g. "assign TM Supermarkets to the `TM-USD` list") rather than waiting for every customer to be assigned at once.

## Re-generating these files

If you receive an updated export from SAP later, don't hand-edit these CSVs -- regenerate them the same validated way:

```
npx tsx --conditions=react-server scripts/convert-item-master-xlsx-to-csv.ts <new Items_List.xlsx> business-data/items-import.csv
npx tsx --conditions=react-server scripts/convert-price-list-xlsx-to-csv.ts <new Prices.xlsx> business-data/price-lists-import.csv
```

(There is no equivalent script for the customer file -- `/customers/master-import` already accepts the real `List_of_Business_Partners.xlsx`-shaped CSV directly, with no conversion step needed; just export it from SAP as CSV.)
