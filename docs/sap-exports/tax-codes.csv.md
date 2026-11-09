# SAP export: Tax codes

Import at **SAP master data → Tax codes** (`/tax-codes/import`). Run this
import **before** the item-master-extension import, since that import
cross-checks each item's VAT code against this table.

## Why this file exists

VAT varies per item in your business -- confirmed, never a flat rate. SAP
holds a small set of tax codes (standard rate, zero-rated, etc.), each with
its own percentage. This file is that lookup table.

## Columns

| Column | Required | Format | Notes |
|---|---|---|---|
| `TAX_CODE` | Yes | text | Your SAP tax code, exactly as SAP shows it (e.g. `VAT00`, `VAT15`). Kept as text always. |
| `DESCRIPTION` | No | text | Free text, e.g. "Zero-rated" or "Standard rate". |
| `RATE_PERCENT` | Yes | number, 0-100, up to 2 decimal places | The VAT percentage, e.g. `15.50` or `0.00`. |

## What's confirmed vs. illustrative in the sample file

The real invoice (HRE580108, 6 Nov 2026) shows item 0228 (Baby Marrow 250G
Punnet, a fresh-produce item) with **VAT 0.00** -- consistent with fresh,
unprocessed produce typically being zero-rated. That confirms a zero-rated
code exists and is the one in use for at least that item. The sample file
below uses `VAT00` / `VAT15` as the code *identifiers* -- these are
**illustrative, not confirmed**. Your SAP administrator should replace them
with your actual SAP tax code IDs (from SAP B1's tax-code setup screen,
OVTG), keeping the real rates: 0% for the zero-rated code, and 15.5% for
the standard rate effective 1 Jan 2026 per your own figure.

## Sample file

See `test-data/sample-tax-codes.csv`:

```csv
"TAX_CODE","DESCRIPTION","RATE_PERCENT"
"VAT00","Zero-rated (fresh produce)","0.00"
"VAT15","Standard rate (from 1 Jan 2026)","15.50"
```

## Assumptions to confirm (see Milestone 1 report, section g.4)

- Does your SAP export expose VAT-rate **history** (effective-from dates),
  or only the current rate? This file currently imports current-only. If
  SAP has history, say so and this gets a `VALID_FROM`/`VALID_TO` pair
  added, the same way price lists already have one.
- Confirm the exact set of tax codes in use -- this sample only has two;
  your real export may have more (exempt, import VAT, etc.).
