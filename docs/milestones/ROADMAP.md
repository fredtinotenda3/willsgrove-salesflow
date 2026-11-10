# Willsgrove SalesFlow — Master Roadmap

Single cross-milestone source of truth for what exists, what's in flight, and what's deliberately deferred. Update this file in the same round as every milestone/stage delivery — before packaging the zip — so a later milestone never duplicates or quietly conflicts with something already built.

This file is a map, not a spec. For the authoritative detail on any completed milestone, see its section in `PROGRESS.md`. For the authoritative detail on the in-flight one, see the design note linked from its row below until it's folded into `PROGRESS.md` on completion.

## Status legend

- ✅ **Done** — implemented, tested, delivered.
- 🚧 **In progress** — design agreed and/or partially built.
- 📝 **Proposed** — written up, awaiting confirmation before build starts.
- ⏳ **Deferred** — intentionally not built yet; a placeholder (nav link, schema comment, enum gap) may already exist pointing at it.

## Milestones

| # | Name | Status | One-line scope |
|---|---|---|---|
| 0 | Foundations | ✅ Done | Schema baseline, auth, RBAC skeleton (`SALESPERSON`/`SALES_MANAGER`/`ADMINISTRATOR`), audit log, demo-data lifecycle. |
| 1 | Master data | ✅ Done | SAP customer/product/price-list import, `Customer`/`Product`/`PriceList`/`StockSnapshot` models. |
| 2A | PO intake + extraction | ✅ Done | Document upload, deterministic Excel/text extraction, three-way product matching, `ExtractionRun`/`ExtractedOrderLine` append-only audit trail. |
| 2B | Review & confirm | ✅ Done | Human review UI over an extraction run, line-level accept/edit/reject, order creation on confirm. |
| 2C | Handover (v1) + multi-store split + repeat order | ✅ Done | First `OrderHandover` generation (Excel/CSV/clipboard, 7 columns, `requestedQuantity`-based), splitting one source document into several per-store orders, one-click repeat-order prefill. |
| 3A | Picking schema + workflow core | ✅ Done | New `PickingSession`/`PickingLine` models, `OrderStatus.PICKING`/`READY_TO_INVOICE`, `lib/picking/` core module, API routes, audit events. No UI yet. |
| 3B | Picking UI (`/fulfilment`) | 📝 Proposed | Builds out the already-linked, currently-dead `/fulfilment` nav entry: orders awaiting/in picking, per-order found/unavailable entry, complete + authorize actions. Needs a decision on whether an in-progress session can be abandoned (see PROGRESS.md 3A's open items). |
| 3C | Invoice Handover rework (SAP spec) | 📝 Proposed | Rebuilds `lib/handover/` to the SAP Invoice Handover Specification: 4-column product table, authorized-picked quantities (not `requestedQuantity`), richer header, hard-block until picking is authorized, SAP-grid-compatibility claims softened/removed. |
| 3D | Tests, docs, verification | 📝 Proposed | Full test coverage for 3A–3C, `PROGRESS.md`/`CHANGES.md`/`SETUP-WINDOWS.md`/this file updated, full lint/typecheck/test/build pass, zip. |
| 4+ | Dispatch & delivery | ⏳ Deferred | Sidebar already links a dead `/deliveries` page. Not started; no schema yet. Picking (Milestone 3) is a prerequisite — don't start this before 3's `OrderStatus`/picking model shape is final, since a dispatch status almost certainly chains onto it. |
| 4+ | Pricing/discount verification & approval | ⏳ Deferred | Schema already exists and is unused: `VerificationStatus`, `PriceDecisionStatus`, `ApprovalStatus`, `ProductVerification`, `PriceDecision`, `OrderApproval`. **This is a different workflow from Milestone 3's warehouse picking** — SAP-catalogue/price verification and discount approval on an `OrderLine`, not physical-stock picking. Do not conflate the two when either is built. |
| 4+ | Reporting / funnel metrics | ⏳ Deferred | `CustomerOrder`'s stage timestamps (`receivedAt`/`extractedAt`/`reviewedAt`/`approvedAt`/`handedToSapAt`/`invoicedAt`) and `OrderStatusHistory` already exist to feed this; nothing built on top of them yet. |

## Known pre-existing placeholders (don't rebuild — wire up instead)

- `app/components/sidebar.tsx` — "Picking & Fulfilment" → `/fulfilment` and "Dispatch & Delivery" → `/deliveries` nav entries already exist as dead links.
- `lib/order-display.ts` — explicit comment: add a `Picking`/`Dispatched`/`Delivered` display case "only after it exists in the schema." Milestone 3 is the first of these to actually add one (`PICKING`).
- `app/page.tsx` — dashboard currently shows "Picking" only in hardcoded mock data, fully disconnected from real orders. Out of scope to wire up unless asked.

## Things to never conflate

- **Warehouse picking (Milestone 3)** vs. **SAP-catalogue/price verification & discount approval** (`VerificationStatus`/`PriceDecisionStatus`/`OrderApproval`, deferred, unused) — different departments, different gates, different models. See the table row above.
- **`StockSnapshot`/`StockSnapshotLine`** (Milestone 1, point-in-time SAP on-hand inventory import, for future stock-availability checks at order-entry time) vs. a picking session's per-order found/unavailable record (Milestone 3, order-specific, not a snapshot of SAP stock).

## Change log for this file

- 2026-11-10 — Created. Captures Milestones 0–2C as done and the proposed 3A–3D breakdown for the SAP Invoice Handover specification.
- 2026-11-10 — 3A marked done: `PickingSession`/`PickingLine` schema, `lib/picking/` core workflow (start/record/complete/authorize), and the 4 new API routes under `/api/orders/[id]/picking/`. No UI yet (3B) and `lib/handover/` itself is still untouched (3C) — see PROGRESS.md's Milestone 3A section for the full detail and honest verification results.
