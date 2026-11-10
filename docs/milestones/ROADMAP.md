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
| 3B | Picking UI (`/fulfilment`) | ✅ Done | Builds out the already-linked, previously-dead `/fulfilment` nav entry: queue list + per-order picking workstation (start/record/complete/authorize). Session abandon/cancel still not built — see PROGRESS.md 3B's open items (unanswered, non-blocking). |
| 3C | Invoice Handover rework (SAP spec) | ✅ Done | Rebuilds `lib/handover/` to the SAP Invoice Handover Specification: 4-column product table, authorized-picked quantities (not `requestedQuantity`), richer header (+ generated Handover Reference), hard-block until picking is authorized, SAP-grid-compatibility claims softened. Exact column/header names are a best-reasoned reconstruction, not re-verified against the spec's literal text this round — see PROGRESS.md 3C's honesty note. |
| 3D | Tests, docs, verification | ✅ Done | Closed the one real test-coverage gap found across 3A–3C (`listPickingQueue`, `getLatestPickingSessionForOrder`/`getPickingSessionDetail`, `listOrderHandovers` — all previously untested); re-checked docs for drift (none found); full lint/typecheck/test/build pass. Session abandon/cancel formally recorded as a known, accepted limitation of Milestone 3 as shipped (see PROGRESS.md 3D). |
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
- 2026-11-10 — 3B marked done: `/fulfilment` (queue list) and `/fulfilment/[id]` (picking workstation) built on top of 3A's API, no schema change. Session abandon/cancel still open (non-blocking). `lib/handover/` rework and the two SAP-grid-compatibility overclaims remain 3C's job — see PROGRESS.md's Milestone 3B section for the full detail and honest verification results.
- 2026-11-10 — 3C marked done: `lib/handover/` reworked to source quantities from authorized picking, hard-blocked on `READY_TO_INVOICE`, 4-column table + richer header + generated Handover Reference, both SAP-grid-compatibility overclaims softened. This round's session did not have the spec's literal text in context (compacted away in an earlier session) — the exact column/header names are a reconstruction from this file's own prior wording, not re-verified against the spec directly; flag it if wrong. See PROGRESS.md's Milestone 3C section for the full detail, that honesty note, and honest verification results. Only 3D (final cross-milestone test/doc pass) remains.
- 2026-11-10 — 3D marked done, and with it, **Milestone 3 (SAP Invoice Handover Specification) is fully delivered end to end (3A–3D)**. Closed the one real test-coverage gap across 3A–3C (three previously-untested read-only query functions); confirmed docs match the shipped code with no drift. Session abandon/cancel remains formally unbuilt — recorded as a known, accepted limitation, not a silent gap — see PROGRESS.md's Milestone 3D section.
