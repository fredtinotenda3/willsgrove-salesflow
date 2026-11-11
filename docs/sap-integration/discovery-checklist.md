# SAP Business One discovery checklist (for Bulawayo HQ)

This is the list of things someone with real access to Willsgrove's SAP
Business One environment needs to confirm, verify, or grant **before**
`SAP_B1_PROVIDER=live` is ever set anywhere other than a test
environment. Nothing in this milestone's code assumes an answer to any
item below — every "unverified against a real tenant" comment in
`lib/integrations/sap/real-adapter.ts` points back here.

**The standard this checklist exists to meet:** once Bulawayo completes
everything below, SalesFlow should not need to be redesigned or have its
integration project restarted. The remaining work should be environment
configuration, connection verification, authorised testing, and
controlled activation — not new code.

## 1. Service Layer access

- [ ] Confirm the SAP Business One Service Layer is reachable from
      wherever SalesFlow is deployed (URL, port — typically `50000`,
      and whether it sits behind a reverse proxy/VPN SalesFlow's host
      needs to be on).
- [ ] Confirm the exact Service Layer base URL, including whether it
      ends in `/b1s/v1` (version `v1` is assumed throughout
      `real-adapter.ts`; a `v2`-only tenant needs that adapter's paths
      revisited).
- [ ] Confirm TLS: is the Service Layer's certificate from a public CA,
      or self-signed/internal? If self-signed, decide how the Node
      process trusts it (do **not** disable certificate verification
      as a workaround).
- [ ] Confirm the company database name (`CompanyDB`) for the correct
      SAP company — Willsgrove may run more than one company database,
      and submitting against the wrong one is a real-money mistake.

## 2. Service account and permissions

- [ ] Create a dedicated Service Layer user for SalesFlow — **never**
      a named individual's own SAP login. Document its username here
      (never its password — that belongs only in `SAP_B1_PASSWORD` on
      the server, never in this file, never in the database, never in
      a chat message).
- [ ] Confirm this service account's authorizations cover, at minimum:
  - Read access to Business Partners (customers) and Items (products).
  - Read access to A/R Invoices and Credit Memos (for invoice
    reconciliation and credit-note sync).
  - Create access to Sales Orders (for the one outbound write this
    milestone performs).
  - **Explicitly confirm it does NOT have write access to Items,
    Business Partners, A/R Invoices, or Credit Memos** — SAP remains
    the system of record for all of those; SalesFlow only ever reads
    them.
- [ ] Confirm whether SAP enforces IP allow-listing or a VPN requirement
      for Service Layer access, and whether SalesFlow's deployment host
      has (or can get) a static, allow-listable address.
- [ ] Confirm the account's session/login behavior: does repeated login
      trigger any lockout policy SalesFlow's own session-renewal logic
      (`real-adapter.ts`'s `ensureSession`) should be tuned around?

## 3. Data mapping confirmation

- [ ] Confirm the exact Service Layer field names Willsgrove's SAP B1
      version actually exposes for: item code (`ItemCode`), item name,
      barcode, item group; business-partner code (`CardCode`), name,
      TIN, VAT registration number, currency, price list assignment,
      payment terms, credit limit/hold. `real-adapter.ts` uses the
      standard B1 Service Layer object model names; a customized or
      older tenant may differ.
- [ ] Confirm which User-Defined Fields (UDFs), if any, Willsgrove uses
      on Business Partners or Items that SalesFlow should also capture
      (today: none are read — only standard fields).
- [ ] Confirm the field SAP actually uses to carry SalesFlow's own order
      reference back (this milestone assumes `NumAtCard` or a
      comparably free-text reference field on the Sales Order document
      — **not yet verified against a real tenant**).
- [ ] Confirm whether Service Layer's OData query support allows a
      genuine incremental ("changed since") filter on Items/Business
      Partners/Invoices/Credit Memos in this tenant's SAP B1 version, or
      whether every sync must remain a full refetch (the current,
      honest default).

## 4. Idempotency and duplicate-detection

- [ ] Confirm whether this SAP B1 version's Service Layer supports any
      native mechanism to look up a Sales Order by a caller-supplied
      reference/UDF value (what `findSalesOrderByExternalReference`
      needs for real). If none exists, the fallback is a manual,
      human-driven reconciliation process — decide and document that
      process with Bulawayo before go-live.
- [ ] Decide, with Bulawayo, what a human should actually do when an
      `UNCERTAIN` sales-order submission (a lost/timed-out response)
      cannot be resolved by an automatic reconciliation lookup — who in
      SAP has the access to check directly, and how quickly.

## 5. Volumes and rate limits

- [ ] Confirm whether Service Layer imposes any rate limit or
      concurrent-session cap that would affect a full product/customer
      catalogue sync (Willsgrove's product catalogue is roughly 7,500
      items per the Milestone 1 CSV export this project already
      imports from).
- [ ] Confirm an acceptable sync schedule/time-of-day with Bulawayo
      before turning on `scripts/sap-sync.ts` as a real Windows Task
      Scheduler job (see `SETUP-WINDOWS.md`).

## 6. Go-live sequencing

- [ ] Verify the connection from `/integrations/sap/settings`
      (ADMINISTRATOR-only "Test connection" action) against a **non-
      production** SAP company database first, if one exists.
- [ ] Submit a small number of real test Sales Orders against that
      non-production company database and have someone with direct SAP
      access confirm they look correct before any production order is
      ever submitted.
- [ ] Only then set `SAP_B1_PROVIDER=live` in the production
      environment, set `IntegrationConnection.mode` to `LIVE` via the
      settings page, and enable it — all three gates
      (`lib/integrations/sap/config.ts`'s `canUseLiveSapAdapter`) must
      agree before any real adapter call is ever made.

## What SalesFlow does NOT need from this checklist to keep working today

Nothing. Every sync and submission path in this milestone runs against
the deterministic `MockSapAdapter` until every gate above is
deliberately and explicitly flipped to live. No part of this checklist
blocks ordinary use of SalesFlow in the meantime.
