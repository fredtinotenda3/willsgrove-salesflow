# Part 8 — Business Partner → Customer-Master CSV: Field-Mapping Report

## Source

`List_of_Business_Partners.xlsx`, sheet `Sheet1`, 2,647 data rows.

| Source column | Type found | Notes |
|---|---|---|
| `#` | integer | Row sequence number from the export. No business meaning for a customer record. |
| `BP Code` | text | Every value is a non-blank alphanumeric string (e.g. `HREC0D457`). No numeric-typed cells were found, so there is no leading-zero-loss risk from Excel's numeric storage — every code round-trips exactly as text. Confirmed unique across all 2,647 rows. |
| `BP Name` | text | Every value is non-blank. No embedded quotes, commas, newlines, or non-ASCII characters were found anywhere in the column (checked programmatically, not sampled). |
| `Account Balance` | number | Present and non-zero for a meaningful subset of rows. A **current balance**, not a credit ceiling — see below. |
| `Account Balance FC` | number | Same as above, foreign-currency balance. |
| `Gaap Supplier Code` | — | Blank for all 2,647 rows (confirmed programmatically). |

## Destination contract

`lib/sap-customer-master-csv.ts` (`REQUIRED_HEADERS`), documented in
`docs/sap-exports/customer-master.csv.md`. This is the **existing,
already-shipped** customer-master import used by
`/customers/master-import` — this report maps onto it exactly rather than
inventing a parallel format.

## Column-by-column mapping

| Contract column | Required | Source | Value written |
|---|---|---|---|
| `CUSTOMER_CODE` | Yes | `BP Code` | Verbatim (trimmed of incidental whitespace only; none was found) |
| `CUSTOMER_NAME` | Yes | `BP Name` | Verbatim (trimmed of incidental whitespace only; none was found) |
| `TIN` | No | — | Blank |
| `VAT_REG` | No | — | Blank |
| `CURRENCY` | No | — | Blank |
| `PRICE_LIST_CODE` | No | — | Blank |
| `PAYMENT_TERMS` | No | — | Blank |
| `BRANCH_CODE` | No | — | Blank |
| `STORE_CODE` | No | — | Blank |
| `CREDIT_LIMIT` | No | — | Blank |
| `CREDIT_HOLD` | No | — | **`N`** (explicit default — see "Assumptions" below) |
| `ADDRESS_LINE1` | No | — | Blank |
| `CITY` | No | — | Blank |
| `PHONE` | No | — | Blank |
| `EMAIL` | No | — | Blank |
| `CONTACT_NAME` | No | — | Blank |
| `CONTACT_EMAIL` | No | — | Blank |
| `CONTACT_PHONE` | No | — | Blank |

Every blank above is a deliberate "no source data" — nothing was invented
to fill it. Because a new customer created from a row with the address/
contact columns blank simply gets no seeded location or contact record
(per the existing import's own documented behaviour), this is safe:
administrators can fill those in by hand in SalesFlow afterward, or run a
second, more detailed import later.

## Source columns NOT carried into the CSV, and why

| Source column | Disposition |
|---|---|
| `#` | Dropped. A row-sequence number, not a customer attribute. |
| `Account Balance` | **Not mapped to `CREDIT_LIMIT` or anywhere else.** A balance is what the customer currently owes; a credit limit is the maximum SAP will let them owe. Writing one into the other's column would be a fabricated, misleading figure, not a transcription — this is exactly the kind of silent reinterpretation the spec prohibits. If Willsgrove wants account balances visible in SalesFlow, that needs its own column/feature, not a reuse of `CREDIT_LIMIT`. |
| `Account Balance FC` | Same reasoning (foreign-currency balance). |
| `Gaap Supplier Code` | Blank in every source row, and there is no contract column for it regardless. |

No data was silently discarded: every column present in the source is
accounted for above, whether it was carried into the CSV or not, and why.

## Assumptions to confirm before importing (flagged, not decided here)

1. **`CREDIT_HOLD` defaulted to `N` for every row.** The source has no
   hold data at all. The contract already treats a blank `CREDIT_HOLD` as
   `N`, so this changes nothing about how the import behaves — it only
   makes the default explicit in the file. If any of these 2,647
   customers should actually be on hold, that still needs to be set by
   hand (in SAP or in a follow-up import) after this one runs.
2. **Duplicate `CUSTOMER_NAME` values (813 groups) are NOT resolved
   here.** See the data-quality report for the full list. The existing
   import has no duplicate-name check (only duplicate-`CUSTOMER_CODE` is
   rejected, and there are none), so this file will import all 2,647
   rows as 2,647 distinct customers even where the same name recurs.
   Confirm with the business whether that is correct (e.g., the same
   physical store genuinely has separate SAP customer codes per currency
   or ledger) before relying on any per-customer reporting that assumes
   one row per real-world customer.
3. **No address, contact, VAT/TIN, currency, price-list, payment-terms,
   branch, or store data exists in this source for any of the 2,647
   customers.** This import will create (or update the master fields of)
   every customer with those fields blank. This is a genuine gap, not an
   artifact of the conversion — the workbook simply doesn't carry that
   data.

## Verification performed

The generated CSV was parsed with the **actual, already-shipped**
`parseSapCustomerMasterCsv()` function from `lib/sap-customer-master-csv.ts`
(via `tsx`, not a reimplementation) to confirm it is genuinely import-ready
under the real contract, not just visually similar to it:

```
success: true
totalRows: 2647
rows.length: 2647
errors.length: 0
duplicateCodes: 0
```

All 2,647 rows parse without a single validation error, and the parser's
own duplicate-code check found none — consistent with the data-quality
report's finding that every `BP Code` in the source is unique.
