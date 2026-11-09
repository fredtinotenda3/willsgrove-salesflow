# SAP export: Price lists

Import at **SAP master data → Price lists** (`/price-lists/import`). Run
the product import first (item codes should already exist, though an
unmatched item code is still accepted and saved).

## Shape of this file

One row per item per price list, with a validity date range. This is
**denormalized on purpose** -- simpler for a single read-only SAP
export/view to produce than two separate header + line files. A price
change is a **new row with a new `VALID_FROM`**, not an edit of an
existing row: price history is kept, not overwritten, because an order
needs "the price in effect on the order's date," not just "the current
price."

## Columns

| Column | Required | Format | Notes |
|---|---|---|---|
| `PRICE_LIST_CODE` | Yes | text | Your SAP price-list code. Must describe the *same* list (same name, same currency) on every row that uses it in one file. |
| `PRICE_LIST_NAME` | Yes | text | e.g. "TM Chinhoyi North" or a group name. |
| `CURRENCY` | Yes | 3-letter code | `USD` or `ZWG`. |
| `ITEM_CODE` | Yes | text | Matched against Products; if not found (yet), the price is still saved. |
| `UNIT_PRICE` | Yes | number, up to 4 decimal places | Per the item's own unit of measure (see item-master-extension.csv.md) -- e.g. per punnet, not per kg, if that's how SAP prices it. |
| `VALID_FROM` | Yes | `YYYY-MM-DD` | |
| `VALID_TO` | No | `YYYY-MM-DD` or blank | Blank means open-ended (still in effect). |

## What's confirmed vs. illustrative in the sample file

**The 0228 / `PL-TM-CHINHOYI` row is real**: invoice HRE580108 (6 Nov
2026) shows item 0228 at **0.45 USD** per punnet for TM Supermarkets -
Chinhoyi North (customer code HREC0D677). The price-list code
`PL-TM-CHINHOYI` itself and the `VALID_FROM` date are illustrative -- the
invoice proves the *price*, not which named SAP price list it came from
or when that price took effect. Your SAP administrator should replace the
list code with the real one and the date with the real effective date.

## Sample file

See `test-data/sample-price-lists.csv`:

```csv
"PRICE_LIST_CODE","PRICE_LIST_NAME","CURRENCY","ITEM_CODE","UNIT_PRICE","VALID_FROM","VALID_TO"
"PL-TM-CHINHOYI","TM Chinhoyi North","USD","0228","0.45","2026-01-01",""
"PL-TM-CHINHOYI","TM Chinhoyi North","USD","8028","3.20","2026-01-01",""
```

## Acceptance check this file is designed to satisfy

With `test-data/sample-item-master-extension.csv` and this file both
imported, and customer HREC0D677 assigned to price list `PL-TM-CHINHOYI`
(see customer-master.csv.md), an order line for item 0228 at quantity 10
should show: unit **PNT**, unit price **0.45 USD**, VAT **0.00**,
estimated total **4.50 USD** -- matching invoice HRE580108 line 1 exactly.

## Assumptions to confirm (see Milestone 1 report, section g.2)

- Are SAP B1 price lists in your setup customer-group-based (B1's native
  "Price Lists" object, assigned to many customers), customer-specific
  overrides, or both? This file's shape (one list, many customers can
  share it) assumes group-based; a customer-specific-override model would
  need a different column layout.
- Confirm whether SAP actually exposes `VALID_FROM`/`VALID_TO` per price
  row, or whether "current price" is all that's readily available, in
  which case every imported row would need a placeholder `VALID_FROM`
  (e.g. the import date) rather than a true effective date.
