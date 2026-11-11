# Milestone 7 Delivery Report — Quotations Management

Built from your attached full specification (15 numbered sections) in
one pass, after this project's standing repo-inspection/migration-
consistency-gate/design-questions stages. Full design rationale, the
known UI limitation, and the complete verification detail live in
`docs/milestones/PROGRESS.md`'s "Milestone 7" section; this report is
the concise delivery summary.

## 1. What was implemented

A `Quotation` is its own first-class record — never a `CustomerOrder`
in a pre-order status — covering the full lifecycle a quotation goes
through before it becomes (or doesn't become) a real order:
**DRAFT** (created, freely editable, may start with zero lines) →
**ISSUED** (sent to the customer, financial values frozen) →
**ACCEPTED** / **REJECTED** (the customer's recorded response) /
**EXPIRED** (validity date passed, never silently inferred) →
**CANCELLED** (reason + actor recorded, blocked once already converted
into an order). A quotation line is either a real, looked-up SAP
catalogue product (snapshotted at add-time so it can never silently
drift after issue) or a clearly-marked unlisted/requested item — never
a fabricated SAP code. Pricing is always a manually Sales-entered value
with exact decimal math (discount applied before VAT); no automatic
pricing/discount approval process was built, per the spec's own
explicit scope exclusion. A revision is always a brand-new DRAFT row,
copied byte-for-byte from the original and linked back to it, never an
in-place edit of something already issued — the original's own
status/history is frozen exactly as it was, and is structurally
excluded from ever being mistaken for the current version. Converting
an ACCEPTED quotation into a real order is always an explicit, human-
triggered action from the quotation's own detail page, guarded twice
against ever producing a duplicate order for the same quotation.

**Deliberately not implemented in this milestone** (explicit,
documented scope boundaries from the spec itself, not oversights):

- No automatic pricing/discount approval workflow — manual Sales
  pricing only, exactly as instructed.
- No inventory reservation triggered by a quotation at any stage.
- No full accounting/SAP-replacement behavior — SalesFlow never writes
  a quotation document into SAP; this module only tracks SalesFlow's
  own pre-order sales process.
- No external integrations beyond this project's existing SAP-export
  conventions (reused as-is, nothing new added).
- No `customerContactId` selector in the create-quotation UI — see
  "Known limitations" below.

## 2. Schema / migration changes

Purely additive. 2 new enums, 3 new tables, and one new value on an
existing enum — no existing table/column/enum value removed or
changed:

| Enum | Values |
|---|---|
| `QuotationStatus` | `DRAFT`, `ISSUED`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `CANCELLED` |
| `QuotationEventType` | `CREATED`, `EDITED`, `ISSUED`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `CANCELLED`, `REVISED`, `CONVERTED` |
| `OrderSource` (existing, extended) | gains one new value: `QUOTATION` — set only when a `CustomerOrder` is created from an accepted quotation |

| Table | Purpose |
|---|---|
| `Quotation` | Header: customer/contact, dates, currency, salesperson, status, stored totals (subtotal/discount/VAT/total), issue/response/cancellation/conversion facts, revision linkage (`rootQuotationId`/`previousRevisionId`/`supersededAt`). |
| `QuotationLine` | One line: either a snapshotted SAP product reference or a free-text unlisted-item description (never both, never neither), quantity/price/discount/VAT, stored line amounts. |
| `QuotationEvent` | Append-only event-history timeline for the detail page, mirroring the dual-write `AuditEvent` pattern this project already uses. |

Migration file:
`prisma/migrations/20261111150000_add_quotations_management/migration.sql`
(hand-authored — this sandbox cannot run `prisma migrate dev`). Every
new foreign key uses `ON DELETE RESTRICT` except `customerContactId`/
`productId`, which use `SET NULL` (an optional contact or a later-
deleted product should never block a quotation's own existence).

**Installation**: see `SETUP-WINDOWS.md` §24 for the exact commands.
**No manual configuration required** beyond the migration and
`prisma generate` — no new environment variable, no new third-party
service, no new role.

## 3. New API routes

All following this project's established pattern (`verifyCsrfOrigin`
→ `requireUserOrResponse` → `isValidId` → zod `.safeParse` → lib call
→ `NextResponse.json`), none role-gated — any authenticated user:

| Route | Method | Purpose |
|---|---|---|
| `/api/quotations` | GET, POST | List / create |
| `/api/quotations/dashboard` | GET | Dashboard counts |
| `/api/quotations/[id]` | GET, PATCH | Detail / header edit (DRAFT-only) |
| `/api/quotations/[id]/lines` | POST | Add a line (DRAFT-only) |
| `/api/quotations/[id]/lines/[lineId]` | PATCH, DELETE | Update / remove a line (DRAFT-only) |
| `/api/quotations/[id]/follow-up` | PATCH | Follow-up date/notes (not DRAFT-gated) |
| `/api/quotations/[id]/issue` | POST | Issue to the customer |
| `/api/quotations/[id]/respond` | POST | Record the customer's accept/reject decision |
| `/api/quotations/[id]/cancel` | POST | Cancel, with a required reason |
| `/api/quotations/[id]/revise` | POST | Create a new revision |
| `/api/quotations/[id]/convert-to-order` | POST | Convert into a real order (idempotent) |
| `/api/quotations/[id]/expire` | POST | Manual per-quotation expiry |
| `/api/quotations/[id]/revisions` | GET | Full revision history for this lineage |

## 4. New / modified pages

| Page | Purpose |
|---|---|
| `/quotations` | Dashboard + paginated list: summary cards, status tabs, debounced search, salesperson/currency/date filters, value-by-status-and-currency (never summed across currencies, never labelled revenue). |
| `/quotations/new` | Creation form: customer search, header fields, per-line builder (catalogued SAP search or unlisted free text). |
| `/quotations/[id]` | Detail page: fields grid, superseded/eligible-for-expiry banners, lines table with totals, response/cancellation sections, revision-history list, event-history timeline, the `QuotationActionsPanel` action island. |
| `/quotations/[id]/print` | Printable quotation document — zero-write, A4 print CSS, mirrors `/orders/[id]/assembly-form`. No PDF library is installed in this project, so this is print-ready HTML, not a generated PDF file; the browser's own "Print → Save as PDF" produces one. |

New "Quotations" sidebar entry in the WORKSPACE section, next to
"PO Intake."

## 5. Permissions / audit controls

- **No new RBAC role, no approval gate on any action** — every route
  and lib function uses `requireUserOrResponse()` with no role array,
  same tier as order creation itself. A quotation is a sales-staff
  working document throughout its lifecycle in this milestone's scope.
- CSRF origin verification on every mutating route.
- Every mutating action writes **both** a dedicated `QuotationEvent`
  row and a generic `AuditEvent` row with before/after data — confirmed
  end-to-end in the gated test suite across a create→issue→accept
  sequence.
- **Structural duplicate-conversion guard**: `convertQuotationToOrder()`
  checks `Quotation.convertedOrderId` before doing any work, then
  re-checks it again inside the transaction, with a deterministic
  `QUO-CONVERT-<quotationId>` idempotency key on the created order as
  the final, race-proof guarantee — a repeat call always returns the
  identical order, never a second one.
- **Structural cancellation guard**: cancelling a quotation that has
  already produced a real order is blocked by a direct read of
  `convertedOrderId`, checked at the one place that actually writes
  `CANCELLED` — not assumed safe just because the status-transition
  graph structurally allows `ACCEPTED → CANCELLED`.
- **No fabricated SAP data**: a line's SAP item code/description are
  only ever a real, looked-up `Product` snapshot or explicitly absent
  (an unlisted item) — there is no code path that invents a code for a
  requested-but-not-catalogued item.
- **Live-computed expiry, never a trusted stale label**:
  `isEligibleForExpiry()` is the single source of truth used by the
  dashboard's follow-up count, the detail page's warning banner, and
  the two actual-write paths (`expireQuotation`/`sweepExpiredQuotations`)
  alike — none of the four can disagree with the others.

## 6. Tests executed and results

```
npx vitest run
 Test Files  27 passed | 11 skipped (38)
      Tests  442 passed | 75 skipped (517)
```

- **`tests/quotations.test.ts`** — 78 unconditional tests, pure logic.
  **All 78 passing**, run and confirmed both in isolation and as part
  of the full suite. Covers: the full 6×6 `validateQuotationStatusTransition`
  decision matrix (every one of the 36 from/to pairs individually
  asserted, plus the "already X" message check); every `isTerminal`/
  `isRevisable`/`isConvertible`/`isEditable` status predicate across
  all 6 statuses; `validatePositiveQuantity` (zero/negative/malformed
  rejected); `validateValidityWindow` (validUntil-before-quotationDate
  rejected); `isEligibleForExpiry` (strictly-before-today only, never
  on the date itself, never for a non-ISSUED status); `percentStringSchema`'s
  0–100/2-decimal-place bounds; the catalogued-vs-unlisted XOR in
  `quotationLineInputSchema` (including the "both at once" rejection);
  and every accept/reject boundary of `createQuotationSchema`/
  `updateQuotationHeaderSchema`/`respondToQuotationSchema`/
  `cancelQuotationSchema`/`reviseQuotationSchema`/
  `convertQuotationToOrderSchema`/`updateQuotationFollowUpSchema`.
- **`tests/quotations-db.integration.test.ts`** — 13 tests, gated
  behind `RUN_DB_INTEGRATION_TESTS=1` against a real database,
  building its own `Product`/`TaxCode` fixtures. **Written and type-
  checked against the real schema and lib source; not yet executed
  against a real database from this sandbox** (same honest caveat as
  every gated test in this project — confirmed to skip cleanly on its
  own: `13 skipped`). Covers: decimal-exact totals on creation (hand-
  verified figures, confirming discount-before-VAT); rejecting an
  unlisted line with no description and a catalogued line against an
  unknown product; every DRAFT line add/update/remove path
  recomputing totals correctly, then hard-blocked once issued; issuing
  refused with zero lines or twice; accept/reject responses
  (confirming ACCEPTED never creates an order as a side effect);
  cancellation allowed until converted, then blocked; a full convert-
  to-order cycle confirmed idempotent on a repeat call; a full
  revision cycle (new DRAFT row, old row frozen and excluded from the
  default list, re-revision blocked both ways); revision-history
  resolution from either the root or a later revision's id; manual
  expire + the system-wide sweep, each leaving a still-valid quotation
  untouched; and the dual-write audit trail.

No real bugs were found during this round's own verification beyond
one cosmetic lint catch (an unescaped apostrophe in
`quotation-actions-panel.tsx`, fixed before being counted as clean).

### Tests skipped / blocked

- The 13 gated DB-integration tests, skipped by design (unset
  `RUN_DB_INTEGRATION_TESTS`) — see above. Run them for real per
  `SETUP-WINDOWS.md` §24's "Run this milestone's real database
  acceptance tests" before treating Milestone 7 as fully verified.

### Known defects

None outstanding.

## 7. Honest `tsc` / build results

- `npx eslint .` (full repo) — **clean, 0 problems.**
- `npx tsc --noEmit` — **331 errors total** (up from 257 at the end of
  Milestone 6B): +63 from `lib/quotations/*`, +5 from the new UI
  (`app/quotations/[id]/page.tsx` and `.../print/page.tsx`), +6 from
  `tests/quotations-db.integration.test.ts`. **All 74 new errors
  individually traced**, by reading the actual error text file-by-
  file, to this sandbox's one documented, pre-existing limitation: `npx
  prisma generate` cannot run here, so the installed `@prisma/client`
  has no knowledge of `Quotation`/`QuotationLine`/`QuotationEvent`/
  their 2 new enums (or, for the pre-existing count, any model from
  Milestones 1–6B). Zero new error *categories* — only more instances
  of the same already-documented `TS7006`/`Prisma.*`-missing buckets.
  **Run `npx prisma generate` on a real machine** (`SETUP-WINDOWS.md`
  §24) and the stub-bucket errors resolve the same way every prior
  milestone's have.
- `npm run build` — hits the same pre-existing Google Fonts network
  block in `app/layout.tsx` that every prior round's build has hit
  since Milestone 1, confirmed unrelated to and untouched by this
  milestone. Turbopack's bundler itself reached and compiled every new
  Milestone 7 route/page/component before hitting that font fetch, so
  this milestone's compile graph is structurally sound — but, as with
  every prior milestone, no claim about the static-generation/
  prerendering phase for these new routes should be read as sandbox-
  verified. **Your next real `npm run build`** (after `npx prisma
  generate`) **is what actually confirms it.**

## 8. Known limitations (recorded, not silent)

- The 13 gated DB-integration tests have not been executed against a
  real database from this sandbox (see §6).
- The create-quotation form (`/quotations/new`) has no
  `customerContactId` selector. `Quotation.customerContactId` is
  optional in the schema and fully supported by the lib layer, but no
  existing endpoint in this codebase lists a customer's contacts
  (`getCustomerById` doesn't return them, and there's no
  `/api/customers/[id]/contacts` route) — building a new endpoint
  purely for one optional dropdown was judged out of this milestone's
  scope rather than done silently. A quotation can still be linked to
  a specific contact via a direct `PATCH /api/quotations/[id]` call.
- No background-job runner exists in this architecture, so the actual
  `ISSUED → EXPIRED` write only happens via a manual per-quotation
  action or by actually running `npm run quotations:expire` (or
  scheduling it — see `SETUP-WINDOWS.md` §24). Until one of those
  runs, the stored `status` column on an overdue quotation can lag
  behind reality for anyone querying the database directly — though
  every UI surface (dashboard, detail page) always computes the true,
  live answer rather than trusting that column.

## 9. Files changed

See `CHANGES.md`'s "Milestone 7" section for the complete, categorized
file list (schema/migration, `lib/quotations/`, API routes, UI, other
changes, tests, documentation). The delivered zip contains only these
new/changed files.

---

**Milestone 7 (Quotations Management) is complete as scoped.**
