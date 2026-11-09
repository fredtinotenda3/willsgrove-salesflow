# SAP export: Customer master

Import at **SAP master data → Customer master** (`/customers/master-import`).
Run the price-lists import first if you want price-list assignment to
resolve on the first pass (an unmatched price-list code is still accepted
and the customer saved without one, resolved on a later re-import).

## What this creates or updates

Unlike the item-master-extension import, this one **can create new
customers**, not just extend existing ones -- matched by `CUSTOMER_CODE`
against `Customer.sapCustomerCode`. For a customer that already exists,
**only the master-data fields below are updated** -- an existing
customer's locations and contacts are left exactly as they are, even if
this file's `ADDRESS_LINE1`/`CONTACT_NAME` differ, since those may have
been edited by hand since the customer was created. For a **new**
customer, the address and contact columns (if present) seed one default
location and one contact.

## Columns

| Column | Required | Format | Notes |
|---|---|---|---|
| `CUSTOMER_CODE` | Yes | text | SAP business-partner code. |
| `CUSTOMER_NAME` | Yes | text | |
| `TIN` | No | text | Separate from VAT_REG -- a real Willsgrove invoice shows both as different numbers. |
| `VAT_REG` | No | text | |
| `CURRENCY` | No | 3-letter code | `USD` or `ZWG`. |
| `PRICE_LIST_CODE` | No | text | Matched against the price-lists import; if not found (yet), saved without one. |
| `PAYMENT_TERMS` | No | text | SAP payment-terms code. |
| `BRANCH_CODE` | No | text | See "open question" below. |
| `STORE_CODE` | No | text | Kept distinct from `CUSTOMER_CODE` even where they coincide today -- see open question. |
| `CREDIT_LIMIT` | No | number, up to 2 decimal places | Display-only in SalesFlow; SAP remains the system of record for credit decisions. |
| `CREDIT_HOLD` | No | `Y` / `N` | Blank is treated as `N`. |
| `ADDRESS_LINE1` | No | text | Used only when creating a new customer. |
| `CITY` | No | text | |
| `PHONE` | No | text | |
| `EMAIL` | No | text | |
| `CONTACT_NAME` | No | text | One primary contact; used only when creating a new customer. |
| `CONTACT_EMAIL` | No | text | |
| `CONTACT_PHONE` | No | text | |

## What's confirmed vs. illustrative in the sample file

**Every field below for HREC0D677 is real**, read directly off invoice
HRE580108's header: SAP code `HREC0D677`, name "TM Supermarkets (Pvt) Ltd
- Chinhoyi North", TIN `2000003164`, VAT registration `220003216`, address
"194 Mutare Road", city "Harare", phone `0242-447255`, email
`imugabe@tmsm.co.zw`. `CURRENCY`, `PRICE_LIST_CODE`, `PAYMENT_TERMS`,
`BRANCH_CODE`, `CREDIT_LIMIT` and the contact columns are **illustrative**
-- the invoice doesn't show these, so they're filled with plausible
placeholders for your administrator to replace.

## Sample file

See `test-data/sample-customer-master.csv`:

```csv
"CUSTOMER_CODE","CUSTOMER_NAME","TIN","VAT_REG","CURRENCY","PRICE_LIST_CODE","PAYMENT_TERMS","BRANCH_CODE","STORE_CODE","CREDIT_LIMIT","CREDIT_HOLD","ADDRESS_LINE1","CITY","PHONE","EMAIL","CONTACT_NAME","CONTACT_EMAIL","CONTACT_PHONE"
"HREC0D677","TM Supermarkets (Pvt) Ltd - Chinhoyi North","2000003164","220003216","USD","PL-TM-CHINHOYI","NET30","HRE","HREC0D677","","N","194 Mutare Road","Harare","0242-447255","imugabe@tmsm.co.zw","","",""
```

## Assumptions to confirm (see Milestone 1 report, section g.3)

- Is "one SAP customer code per physical store" (this example: HREC0D677
  = TM Chinhoyi North specifically) universal across every chain you
  supply, or does any chain have one customer code covering several
  stores, distinguished by a separate branch/store code underneath it?
  `BRANCH_CODE` and `STORE_CODE` are kept as two separate columns
  specifically so either shape can be represented -- confirm which one is
  real before assuming `STORE_CODE` is redundant with `CUSTOMER_CODE`.
- Is `CREDIT_LIMIT`/`CREDIT_HOLD` meant to be a straight read of SAP's own
  values (display-only, which is what this milestone builds), or does
  Willsgrove want SalesFlow to make independent credit-hold decisions in
  a later milestone?
