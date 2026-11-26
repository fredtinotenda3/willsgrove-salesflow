# Order workflow, claims and reporting fixes

No schema change, no migration, no new dependency. Copy the files over your repo (same paths), then:

    npm run build        (or: npm run dev)

## What changed

1. **Assembly form** - `Download` button next to `Print` (PDF, `/orders/[id]/assembly-form/download`, generated in-process, same guards as the print page).
2. **Invoice step** - on Ready to Invoice the order page shows **Mark as Invoiced** (whole order, or untick lines to invoice one by one). Invoicing is based on what was picked and authorised, so it happens BEFORE dispatch. After invoicing, a **Dispatch** button appears.
3. **Dispatch requires an invoice** - only invoiced quantity can be dispatched (enforced in the API under the order row lock, not just in the UI). Invoice reset is blocked once the goods were dispatched.
4. **Dynamic status** - Ready to Invoice > Partially Invoiced > Invoiced > Dispatched > Delivered > Completed, on Orders, Dashboard, Fulfilment, Deliveries, Reports and **Admin** (orders, order detail, customer recent orders).
5. **Mark as Done** - when every dispatch is delivered, a **Mark as Done** button (order page) records the delivery outcome for the order's invoices (No Claim, or With Claim when products were rejected at delivery) and moves it to Delivered Orders. `POST /api/orders/[id]/complete`, idempotent.
6. **Recording delivery** - Accepted and Rejected now balance automatically; choosing a claim reason sets the rejected quantity (default: whole line, editable). A reason with Rejected 0 is refused (this was why "Short Delivered" lines showed as "Accepted in full" with no claim), and a rejected quantity needs one of the 8 standardised reasons. The server enforces both.
7. **Claims / Lost Sales** - a rejected product creates the claim at delivery, so it appears on the Claims page, in Returned Products, the reason summary, and Lost Sales (Unfulfilled Demand + returned products by standardised reason). Verified end to end on PostgreSQL.
8. **Currency** - one shared formatter (`lib/format/currency.ts`): USD shows `$1,234.50`; other currencies (ZWG) keep their code so they are never mislabelled as dollars.
9. **Chart tooltips** - compact, never scroll, opaque and above surrounding text on all charts.

## Round 2 (follow-up)
- **Admin "Value by currency"** - Order value was `$0.00` because it summed the stored order total, which is often null. It now falls back to each order's line totals.
- **`$` everywhere** - Lost Value / Confirmed lost value / Total / Amount on Lost Sales, analytics, customer page, credit notes, invoices, claim lines, quotation lines, estimates (`~$20.00`, was `~USD 20.00`). Figures with no currency attached default to `$`.
- **Delivered orders are read-only** - no invoicing form, reset, Dispatch or Mark-as-Invoiced once delivered; only **Mark as Done** remains. The Dispatch screen shows "Dispatch is closed" instead of the form.
- **Orders delivered before the invoice step existed** (no invoice on file) get their invoice recorded automatically, at the order's line prices, when you press Mark as Done.

## Verified
- `tsc` clean; `eslint` only the 3 pre-existing errors; `next build` succeeds.
- Full vitest run on PostgreSQL: all pass except the failures that already existed before these changes (acceptance-item-0228 x2, sap-order-outbox-db x2, consolidated-lost-sales-db, admin-nav).
- New tests: `order-workflow-db.integration.test.ts` (invoice gate, status walk, delivery validation, Mark as Done with and without claim, Claims/Returned/Lost Sales), `assembly-form-pdf.test.ts`, status/next-step cases in `order-display.test.ts`.
- Assembly PDF checked with `qpdf --check` and a rendered page. Not checked in a real browser.

## Known limits
- A delivery claim spanning several invoices is attached to the first invoice that covers one of its lines.
- The Admin status *filter* still filters on the stored status (the badge shows the derived one).
- The PDF is hand-generated (standard Helvetica, Latin-1 characters only; others print as `?`).
- Orders already dispatched before this change have no invoice: invoice them from the order page, then Mark as Done.

## Round 3 -- storage (R2), handover Excel/CSV, email

**Cause of `Unsupported STORAGE_DRIVER "r2"` (500 on `POST /api/orders/:id/handover`):** `lib/storage/index.ts` only implemented `local`. Every upload path (PO documents, delivery attachments, claim attachments, handovers) used it, so `r2` failed everywhere.

- `lib/storage/r2-driver.ts` + `lib/storage/sigv4.ts`: Cloudflare R2 driver, no new dependency (hand-rolled AWS SigV4; unit-tested against AWS's published signature). Same random UUID keys, key re-validation, and size/checksum from real bytes as the local driver. Reads `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT` (or `R2_ACCOUNT_ID`), `R2_REGION` (default `auto`), optional `R2_KEY_PREFIX`.
- Handover panel: Excel/CSV download starts automatically after "Generate", every past handover has Download and **Email**.
- `POST /api/orders/:id/handover/:handoverId/email`: emails the stored file (max 5 recipients, 10 MB, audit event `ORDER_HANDOVER_EMAILED`). Needs `CHANNEL_EMAIL_PROVIDER=live` + `CHANNEL_EMAIL_API_KEY` + `CHANNEL_EMAIL_FROM_ADDRESS`; otherwise it answers 503 "not configured" (no fake success).
- Storage failures during generation now return 503 with the actionable message instead of a bare 500.
- `.env.example` and `.env.production.example` list every variable.

Production notes: keep the R2 bucket private; use the non-pooled Neon host for `DIRECT_URL`; do not set `RUN_DB_INTEGRATION_TESTS` in production.
