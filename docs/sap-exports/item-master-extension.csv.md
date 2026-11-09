# SAP export: Item master extension (unit, pack size, VAT code)

Import at **SAP master data → Item master** (`/item-master/import`). Run
the tax-codes import first.

## Why this is a separate file from the product import

Your real SAP item export (the one already imported in Milestone 0 --
`CODE`, `ITEM DESCRIPTION`, `BARCODE`, `ITEM GROUP`) was checked directly
against your actual 7,540-row file: it has **no unit, pack size, or VAT
columns**. Those live in a different part of SAP B1's item master (unit of
measure, tax group) and need a second, separate read-only export, keyed by
the same `CODE`.

This import only **extends** products that already exist from the product
import -- it never creates a new product. A `CODE` that doesn't match an
existing product is reported back, not silently skipped or guessed at.

## Columns

| Column | Required | Format | Notes |
|---|---|---|---|
| `CODE` | Yes | text | Must match an existing product's SAP item code exactly (including any leading zero). |
| `UNIT_OF_MEASURE` | No | text | SAP's unit code, e.g. `PNT` (punnet), `KG`, `EA`. |
| `PACK_SIZE` | No | text | Free text, as SAP itself holds it, e.g. `250G`. |
| `VARIABLE_WEIGHT` | No | `Y` / `N` | Blank is treated as `N`. |
| `TAX_CODE` | No | text | Must match a `TAX_CODE` from the tax-codes import; if it doesn't (yet), the value is still saved but flagged in the preview. |

## What's confirmed vs. illustrative in the sample file

**Item 0228 is real, cross-checked against invoice HRE580108**: SAP
description "Baby Marrow 250G Punnet", unit **PNT**, VAT **0.00** → tax
code `VAT00` (see tax-codes.csv.md). That row in the sample file is exact.

The other rows (8028 "Deli Baby Marrow/kg", from your real catalogue
health findings) use a **plausible, illustrative** unit (`KG`,
variable-weight `Y`) and tax code -- not confirmed against a real export.
Treat every row except 0228 as a template to replace.

## Sample file

See `test-data/sample-item-master-extension.csv`:

```csv
"CODE","UNIT_OF_MEASURE","PACK_SIZE","VARIABLE_WEIGHT","TAX_CODE"
"0228","PNT","250G","N","VAT00"
"8028","KG","","Y","VAT00"
"3495","EA","6s","N","VAT15"
```

## Assumptions to confirm (see Milestone 1 report, section g.1)

- Confirm whether your SAP export truly has no unit/pack/VAT columns on
  the standard item list, or whether a different report/view in SAP B1
  (e.g. the Item Master Data form's "Inventory Data" / "Purchasing Data"
  tabs) exposes them directly, which would let your administrator produce
  this file as a straight export rather than a hand-assembled one.
- Pack size is free text here because SAP's own description field mixes
  it in inconsistently (e.g. "6s" vs "250G" vs embedded in the name) --
  confirm whether SAP actually holds pack size as its own structured
  field anywhere, which would be more reliable than re-typing it.
