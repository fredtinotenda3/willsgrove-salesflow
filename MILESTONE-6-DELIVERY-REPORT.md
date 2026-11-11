# Milestone 6A Delivery Report — Invoice Claims Management

**Stage 1 of 2** of the "Invoice Claims Management & Returns/Credit
Notes" specification. Stage 2 (6B — Returns / Credit Notes) is
explicitly **not** started — per the spec's own instruction and the
standing multi-session working agreement, 6B begins only after this
delivery is reviewed.

Full architecture assessment, design rationale, and verification
detail live in `docs/milestones/PROGRESS.md`'s "Milestone 6A" section;
this report is the concise delivery summary.

## 1. What was implemented

An `InvoiceClaim` is a complaint/dispute raised against a specific SAP
invoice (always) and, where possible, specific invoice line(s). It
carries a category, priority, description, and one or more disputed
lines (quantity disputes or amount-only disputes), moves through a
9-state lifecycle with enforced transitions, accumulates an
append-only history of investigation findings and proposed
resolutions, and surfaces financial exposure as explicit, never-
fabricated figures.

**Deliberately not implemented in this stage** (reserved for 6B):

- No `ReturnRequest`/`CreditNote` model or physical-return workflow.
- No recording of an actual SAP credit note. `approveClaimResolution()`
  records an *approved exposure* figure only — it never creates an
  accounting transaction, never writes to `SapInvoice`/`SapInvoiceLine`,
  and never sets an "actual credited amount." `computeClaimFinancialSummary()`
  returns `actualSapCreditedAmount: null, actualCreditDataAvailable: false`
  unconditionally, in every code path — there is no route to a non-null
  value in this stage.
- No automatic classification of a claim as a confirmed financial
  loss. A claim only ever records what was *disputed* and what was
  *approved as exposure* — never a realized loss.

## 2. Schema / migration changes

Purely additive. 5 new enums, 4 new tables, no existing table/column/
enum value touched:

| Enum | Values |
|---|---|
| `InvoiceClaimCategory` | `QUALITY_ISSUE`, `DAMAGED_PRODUCTS`, `SPOILAGE`, `SHORT_DELIVERY`, `MISSING_PRODUCTS`, `WRONG_PRODUCT_SUPPLIED`, `QUANTITY_DISCREPANCY`, `PRICING_DISPUTE`, `INCORRECT_INVOICE`, `CUSTOMER_REJECTION`, `OTHER` |
| `InvoiceClaimPriority` | `LOW`, `MEDIUM`, `HIGH`, `URGENT` |
| `InvoiceClaimStatus` | `OPEN`, `UNDER_INVESTIGATION`, `AWAITING_CUSTOMER`, `AWAITING_INTERNAL_ACTION`, `APPROVED`, `PARTIALLY_RESOLVED`, `RESOLVED`, `REJECTED`, `CLOSED` |
| `ClaimLineDisputeType` | `QUANTITY`, `AMOUNT_ONLY` |
| `ClaimResolutionDecision` | `NO_ACTION_REQUIRED`, `CLAIM_REJECTED`, `REPLACEMENT_APPROVED`, `PHYSICAL_RETURN_REQUIRED`, `PARTIAL_CREDIT_RECOMMENDED`, `FULL_CREDIT_RECOMMENDED`, `PRICING_CORRECTION_REQUIRED`, `DELIVERY_INVESTIGATION_REQUIRED`, `OTHER` |

| Table | Purpose |
|---|---|
| `InvoiceClaim` | One claim: links to `SapInvoice` (required), `CustomerOrder` (optional), `Customer` (required), reporter/assignee `User`s, category/priority/status/dates/description. |
| `InvoiceClaimLine` | One disputed line within a claim: links to one `SapInvoiceLine` (required); either a quantity dispute (accepted/rejected quantity) or an amount-only dispute (disputed amount); display-only SAP code/description snapshots. |
| `ClaimResolution` | One investigation-finding/proposed-resolution record, append-only; approver/rejecter fields mutually exclusive by application logic. |
| `InvoiceClaimAttachment` | One uploaded file against a claim (optionally scoped to one line). |

Migration file: `prisma/migrations/20261111000000_add_invoice_claims_management/migration.sql`
(hand-authored — this sandbox cannot run `prisma migrate dev`). All
foreign keys into `SapInvoice`/`SapInvoiceLine`/`CustomerOrder`/
`Customer`/`User` use `ON DELETE RESTRICT`, so a claim can never be
left dangling by a deletion elsewhere.

**Installation**: see `SETUP-WINDOWS.md` §22 for the exact commands
(`prisma migrate dev` / `migrate deploy`, then `prisma generate`).
**No manual configuration is required** beyond running the migration
and regenerating the client — no new environment variable, no new
third-party service, no new role.

## 3. New API routes

All under `app/api/invoice-claims/`, following this project's
established pattern (`verifyCsrfOrigin` → `requireUserOrResponse` →
`isValidId` → zod `.safeParse` → lib call → `NextResponse.json`):

| Route | Method | Access |
|---|---|---|
| `/api/invoice-claims` | GET, POST | Any authenticated user |
| `/api/invoice-claims/[id]` | GET | Any authenticated user |
| `/api/invoice-claims/[id]/status` | POST | Any authenticated user (role checked **inline**, only for transitions flagged `requiresApproval`) |
| `/api/invoice-claims/[id]/resolutions` | POST | Any authenticated user |
| `/api/invoice-claims/[id]/resolutions/[resolutionId]/approve` | POST | `SALES_MANAGER` / `ADMINISTRATOR` only |
| `/api/invoice-claims/[id]/resolutions/[resolutionId]/reject` | POST | `SALES_MANAGER` / `ADMINISTRATOR` only |
| `/api/invoice-claims/[id]/attachments` | POST | Any authenticated user |
| `/api/invoice-claims/attachments/[id]` | GET | Any authenticated user (download) |
| `/api/invoice-claims/dashboard` | GET | Any authenticated user |

**One minimal, additive change to an existing Milestone 5 route's
underlying query function**: `lib/invoice-reconciliation/queries.ts`'s
`listSapInvoices()` gained an optional `search` parameter (filters
`sapDocNum`/`customerName`/`matchedCustomer.name`), needed by the
claim-creation form's invoice picker. Backward-compatible, no existing
caller's behavior changes.

## 4. New pages

| Page | Purpose |
|---|---|
| `/invoice-claims` | Claims queue: status filter pills, search, pagination, customer drill-down from the dashboard. |
| `/invoice-claims/new` | Claim-creation form: invoice search → line selection with per-line dispute type → customer resolution → category/priority/assignee/notes. |
| `/invoice-claims/[id]` | Claim detail: header, financial-exposure metrics, disputed-lines table, attachments, append-only resolution history, status/resolution/attachment actions panel. |
| `/invoice-claims/dashboard` | Status/category/customer/product/department breakdowns, exposure-by-currency table, average resolution time, repeat-complaint customers. |

New "Invoice Claims" sidebar entry under Operations.

## 5. Permissions / audit controls

- **Two-tier authorization, per the confirmed design decision**: any
  authenticated user may create a claim, record investigation
  findings, and propose a resolution. Only `SALES_MANAGER`/
  `ADMINISTRATOR` may approve or reject a resolution, or move a claim
  into an approval-weight status (`APPROVED`/`PARTIALLY_RESOLVED`/
  `RESOLVED`/`REJECTED`/`CLOSED`).
- The status-change route is deliberately **not** whole-route-gated —
  it is open to any authenticated user, with the role check made
  **inline**, inside `changeClaimStatus()`, only for the specific
  transition requested. Every other approval-weight route (resolution
  approve/reject) **is** whole-route-gated via
  `requireUserOrResponse(["SALES_MANAGER","ADMINISTRATOR"])`. This is a
  deliberate, documented variation — not an inconsistency — because a
  single status endpoint serves both weights depending on what's
  asked of it.
- CSRF origin verification on every mutating route (`verifyCsrfOrigin`).
- Every significant action writes an `AuditEvent` with before/after
  data: claim creation, every status change, every resolution recorded/
  approved/rejected, every attachment upload.
- No arbitrary status change is possible: every transition passes
  through `validateClaimStatusTransition()`, backed by an exhaustive,
  compile-checked adjacency graph (`CLAIM_STATUS_TRANSITIONS`) — a
  status added later without an entry in that graph is a TypeScript
  compile error, not a silent gap.
- No duplicate/unauthorized financial double-counting: "already
  claimed elsewhere" is always a live aggregate across every claim
  ever filed against a `SapInvoiceLine`, re-validated both before and
  inside the write transaction (closing the race window between two
  concurrent claims against the same line).
- No silent overwrite of SAP invoice data: `lib/invoice-claims/` never
  writes to `SapInvoice`/`SapInvoiceLine` anywhere.

## 6. Tests executed and results

```
npx vitest run
 Test Files  25 passed | 9 skipped (34)
      Tests  322 passed | 54 skipped (376)
```

- **`tests/invoice-claims.test.ts`** — 26 unconditional tests, pure
  logic (`lib/invoice-claims/validation.ts`). **All 26 passing.**
  Covers: the full 9-status transition graph (valid moves,
  approval-weight flagging, invalid/no-op/terminal transitions, full
  coverage of every status), `isConcludedStatus()`, the exhaustive
  `resolutionDecisionToClaimStatus()` mapping, "OTHER requires detail"
  for category and resolution decision, quantity validation (the
  spec's 100/85/15 worked example, exceeding-remaining-quantity,
  live-aggregate-across-multiple-claims scenarios, malformed input),
  amount-only validation (no ceiling when unknown, exceeding/within a
  known ceiling).
- **`tests/invoice-claims-db.integration.test.ts`** — 6 tests, gated
  behind `RUN_DB_INTEGRATION_TESTS=1` against a real database,
  following this project's established DB-integration-test
  conventions. **Written and type-checked against the real schema and
  lib source; not yet executed against a real database from this
  sandbox** (same honest caveat as every gated test in this project —
  this sandbox cannot run `prisma generate`, so no real client exists
  here to run them against). Covers: claim creation with a quantity
  dispute + original-SAP-line immutability; a second claim against the
  same line correctly rejected once the live aggregate shows the
  remaining quantity exhausted; an amount-only dispute; the full
  resolution lifecycle (record → reject → record → approve) with the
  append-only history and `approvedCreditAmount` asserted; direct
  enforcement of the transition graph through `changeClaimStatus()`
  itself; a financial summary confirming `actualSapCreditedAmount`/
  `actualCreditDataAvailable` stay `null`/`false`.

**One real bug was found and fixed by the test suite itself, before
delivery**: `CLAIM_STATUS_TRANSITIONS["AWAITING_INTERNAL_ACTION"]` was
missing `"RESOLVED"` as an allowed target, which
`resolutionDecisionToClaimStatus("NO_ACTION_REQUIRED")` requires —
this would have made `approveClaimResolution()` hit its own defensive
500 "Internal error" branch for that one, entirely valid decision.
Fixed; re-running the suite confirmed it go from 1 failed to 0 failed
with no other change.

### Tests skipped / blocked

- The 6 gated DB-integration tests, skipped by design (unset
  `RUN_DB_INTEGRATION_TESTS`) — see above. Run them for real per
  `SETUP-WINDOWS.md` §22's "Run this milestone's real database
  acceptance tests" before treating 6A as fully verified.

### Known defects

None outstanding. The one defect found during this round's own
verification (the transition-graph gap above) was fixed before
delivery, not left open.

## 7. Honest `tsc` / build results

- `npx eslint .` (full repo) — **clean, 0 problems.** (13 errors + 1
  warning found and fixed during this round's own check — see
  PROGRESS.md's Milestone 6A section for the exact list.)
- `npx tsc --noEmit` — **241 errors total.** Breakdown:
  154×`TS7006`, 36×`TS2339`, 26×`TS2694`, 18×`TS2305`, 3×`TS2345`,
  3×`TS18046`, 1×`TS2322`. **All 241 individually traced** to this
  sandbox's one documented, pre-existing limitation: `npx prisma
  generate` cannot run here (`binaries.prisma.sh` is blocked by this
  sandbox's network allowlist, and no engine binary is cached), so the
  installed `@prisma/client` has no knowledge of `InvoiceClaim`/
  `InvoiceClaimLine`/`ClaimResolution`/`InvoiceClaimAttachment`/their 5
  new enums (or, for the pre-existing count, any model from
  Milestones 1–5). **Two genuinely invented/incorrect API usages were
  found independently of the stub bucket and fixed** — a non-existent
  `Prisma.Decimal.toBigInt()` call in `financial.ts` (replaced with the
  project's established `parseScaledDecimal` helper) and an
  unnecessary `as unknown as Prisma.TransactionClient` cast in
  `create-claim.ts` (removed — `PrismaClient` structurally satisfies
  `Prisma.TransactionClient`). **Run `npx prisma generate` on a real
  machine** (`SETUP-WINDOWS.md` §22) and the stub-bucket errors resolve
  the same way every prior milestone's have.
- `npm run build` — hits the same pre-existing Google Fonts network
  block in `app/layout.tsx` that every prior round's build has hit,
  confirmed unrelated to this milestone (untouched file). Turbopack's
  bundling stage runs cleanly up to that point, confirming the build
  pipeline tolerates every new file.

## 8. Known limitations (recorded, not silent)

- The 6 gated DB-integration tests have not been executed against a
  real database from this sandbox (see §6).
- `actualSapCreditedAmount`/`actualCreditDataAvailable` are always
  `null`/`false` in this stage, by design — this is Milestone 6B's
  job, not a bug.
- No physical-return or credit-note model exists yet — also 6B's job.
- `RESOLUTIONS_IMPLYING_6B_FOLLOWUP` is a UI-only label hint; it never
  implies a 6B record exists and nothing reads it as one.

## 9. Files changed

See `CHANGES.md`'s "Milestone 6A" section for the complete, categorized
file list (schema/migration, `lib/invoice-claims/`, API routes, UI,
other changes, tests, documentation). The delivered zip contains only
these new/changed files.

---

**Do not start Milestone 6B until this delivery is reviewed** — per
the spec's own explicit two-stage instruction and the standing
multi-session working agreement.
