# Milestone 6B Delivery Report — Returns & Credit Notes

**Stage 2 of 2** of the "Invoice Claims Management & Returns/Credit
Notes" specification, built per your own explicit instruction —
*"Claude start Milestone 6B"* — which authorized starting this stage
without a separate review round on 6A first. Milestones 6A and 6B
together now complete the full specification as scoped.

Full design rationale, the two real bugs found and fixed during this
round's own verification, and the complete verification detail live in
`docs/milestones/PROGRESS.md`'s "Milestone 6B" section; this report is
the concise delivery summary.

## 1. What was implemented

A `ClaimReturn` records that physical goods were actually received
back against a claim (condition, quantity, date). A `CreditNote`
records that SAP has actually issued a credit note against a claim —
entered manually by a `SALES_MANAGER`/`ADMINISTRATOR` who sees it on
their own SAP B1 screen, or imported in bulk from a real SAP AR-
credit-memo CSV export and reconciled (automatically where
unambiguous, by hand otherwise). Recording either auto-advances the
claim's status through 6A's own existing validated transition graph —
never a new edge, never a skipped step — and `lib/invoice-claims/
financial.ts`'s `actualSapCreditedAmount` is now a live figure, summed
only from real recorded `CreditNote` rows, never estimated.

**Four confirmed design decisions, exactly as answered, govern
everything below**: `ClaimReturn` as its own structured model (not
free text); credit-note recording restricted to `SALES_MANAGER`/
`ADMINISTRATOR`; status auto-advance through the *existing* graph only;
both manual entry **and** a full CSV import pipeline for credit notes
(you chose this over manual-entry-only, the recommended alternative).

**Deliberately not implemented in this stage** (explicit, documented
scope boundaries, not oversights):

- No `CreditNoteLine` model — matching is claim-level, not line-level
  (6A already tracks exposure at the claim level).
- No automatic *reversal* of a status auto-advance when a credit note
  is later unlinked/reopened/marked cannot-link — that correction is
  left to 6A's own manual status-change action.
- SalesFlow never creates a credit note in SAP, or writes to
  `SapInvoice`/`SapInvoiceLine` — there is no SAP-write code path
  anywhere in this module.

## 2. Schema / migration changes

Purely additive. 2 new enums, 3 new tables, no existing table/column/
enum value touched:

| Enum | Values |
|---|---|
| `ReturnCondition` | `GOOD_RESALABLE`, `DAMAGED`, `EXPIRED`, `OTHER` |
| `CreditNoteMatchStatus` | `UNMATCHED`, `AUTO_MATCHED`, `MANUALLY_MATCHED`, `CANNOT_LINK` |

| Table | Purpose |
|---|---|
| `ClaimReturn` | One physical return received against a claim (optionally scoped to one claim line): quantity, condition, date, receiver, optional link to the `CreditNote` that settles it. |
| `CreditNote` | One actual SAP credit note: SAP DocEntry/DocNum, optional resolved base invoice and matched claim, match status/method/note, amount, currency, date, optional import-batch link, raw source data for an imported row. |
| `CreditNoteImportBatch` | One CSV import run: file name, uploader, column mapping, row counts. |

Migration file: `prisma/migrations/20261111120000_add_returns_credit_notes/migration.sql`
(hand-authored — this sandbox cannot run `prisma migrate dev`).
`InvoiceLineMatchMethod` (Milestone 5) is reused as-is for
`CreditNote.matchMethod` — no change to that enum. Every new foreign
key uses `ON DELETE RESTRICT`.

**Installation**: see `SETUP-WINDOWS.md` §23 for the exact commands.
**No manual configuration required** beyond the migration and
`prisma generate` — no new environment variable, no new third-party
service, no new role.

## 3. New API routes

All following this project's established pattern (`verifyCsrfOrigin`
→ `requireUserOrResponse` → `isValidId` → zod `.safeParse` → lib call
→ `NextResponse.json`):

| Route | Method | Access |
|---|---|---|
| `/api/invoice-claims/[id]/returns` | GET, POST | Any authenticated user |
| `/api/invoice-claims/[id]/credit-notes` | GET | Any authenticated user |
| `/api/invoice-claims/[id]/credit-notes` | POST | `SALES_MANAGER` / `ADMINISTRATOR` only |
| `/api/returns-credits/import/preview` | POST | `SALES_MANAGER` / `ADMINISTRATOR` only |
| `/api/returns-credits/import/confirm` | POST | `SALES_MANAGER` / `ADMINISTRATOR` only |
| `/api/returns-credits/import-history` | GET | Any authenticated user |
| `/api/returns-credits/credit-notes` | GET | Any authenticated user |
| `/api/returns-credits/credit-notes/[id]` | GET | Any authenticated user |
| `/api/returns-credits/credit-notes/[id]/candidate-claims` | GET | Any authenticated user |
| `/api/returns-credits/credit-notes/[id]/match` | POST | `SALES_MANAGER` / `ADMINISTRATOR` only |
| `/api/returns-credits/credit-notes/[id]/cannot-link` | POST | `SALES_MANAGER` / `ADMINISTRATOR` only |
| `/api/returns-credits/credit-notes/[id]/reopen` | POST | `SALES_MANAGER` / `ADMINISTRATOR` only |

**The credit-note-recording route cannot be tricked into recording
against a different claim than its own URL**: any `claimId` in the
POST body is always overwritten with the URL's `[id]` parameter before
zod validation runs.

## 4. New / modified pages

| Page | Purpose |
|---|---|
| `/returns-credits` | Credit-note reconciliation queue: match-status filter pills, paginated table, links to import + import history. |
| `/returns-credits/[id]` | One credit note's detail + a manual match/cannot-link/reopen action panel (`SALES_MANAGER`/`ADMINISTRATOR` only). |
| `/returns-credits/import` | 3-stage CSV import wizard (upload → map columns → preview/validate → confirm). |
| `/returns-credits/import-history` | Read-only list of past import batches. |
| `/invoice-claims/[id]` (modified) | New "Physical returns" and "Credit notes" read-only sections; the financial-exposure grid now shows a live "Actual SAP credited" figure and a new "Credit shortfall" metric; new `ReturnsCreditsPanel` (record-return / record-credit-note actions). |

New "Returns & Credits" sidebar entry under Operations.

## 5. Permissions / audit controls

- **Two-tier authorization, per the confirmed design decision**:
  recording a physical return is open to any authenticated user (an
  operational/warehouse fact, same tier as 6A's own claim creation and
  investigation findings). Recording that SAP has actually issued a
  credit note — by manual entry, by CSV import, or by any manual
  reconciliation action (match/cannot-link/reopen) — is restricted to
  `SALES_MANAGER`/`ADMINISTRATOR`, the same approval-weight tier as
  approving a `ClaimResolution` in 6A.
- CSRF origin verification on every mutating route.
- Every significant action writes an `AuditEvent` with before/after
  data: return recording, credit-note recording (manual and import),
  every match/cannot-link/reopen action, every import batch.
- No arbitrary status change: the auto-advance pass re-validates
  against 6A's own `validateClaimStatusTransition()` immediately
  before every write, and aborts the whole transaction (`throw`,
  never a silent skip) if an impossible edge is ever proposed —
  defensive, matching `lib/invoice-claims/claim-resolution.ts`'s own
  pattern.
- No guessed matches: automatic credit-note matching requires exactly
  one qualifying candidate claim (right status, credit-bearing
  decision, outstanding exposure) — zero or multiple candidates always
  lands `UNMATCHED` for a human decision, never a best-effort guess.
- No fabricated financial figures: `actualSapCreditedAmount` only ever
  sums real, recorded `CreditNote.amount` values — never computed as
  an estimate from claim lines or resolutions.

## 6. Tests executed and results

```
npx vitest run
 Test Files  26 passed | 10 skipped (36)
      Tests  364 passed | 62 skipped (426)
```

- **`tests/returns-credits.test.ts`** — 42 unconditional tests, pure
  logic. **All 42 passing.** Covers: the full `determineAutoAdvanceTarget()`
  decision matrix (every current-status guard, every decision shape —
  physical return, non-credit-bearing decisions, partial credit never
  escalating, full credit/pricing correction reaching RESOLVED
  including the never-clamped over-credit case); `matchCreditNoteToClaim()`'s
  zero/one/multiple-candidate and no-remaining-exposure cases; the CSV
  column-mapping/suggestion/validation/grouping logic (including the
  header-amount-from-first-row-only rule); `returnConditionRequiresDetail()`.
- **`tests/returns-credits-db.integration.test.ts`** — 8 tests, gated
  behind `RUN_DB_INTEGRATION_TESTS=1` against a real database,
  following this project's established DB-integration-test
  conventions, driving claims to `APPROVED` through the real 6A
  lifecycle rather than writing status by hand. **Written and type-
  checked against the real schema and lib source; not yet executed
  against a real database from this sandbox** (same honest caveat as
  every gated test in this project). Covers: physical-return
  auto-resolution; full-credit auto-resolution with the financial
  summary checked; partial-credit never escalating even once fully
  credited; an over-credit flagged, never clamped; CSV import
  auto-matching the single outstanding candidate; CSV import landing
  `UNMATCHED` on an ambiguous two-claim case; a full manual match/
  cannot-link/reopen cycle; both `recordClaimReturn`/
  `recordCreditNoteManually` refusing to act with no approved
  resolution yet.
- **`tests/invoice-claims-db.integration.test.ts`** (modified) — one
  pre-existing 6A test's assertions updated: `actualSapCreditedAmount`/
  `actualCreditDataAvailable` are no longer asserted `null`/`false`
  (6A's own honest placeholder, now intentionally superseded) — now
  asserts the live `"0.0000"`/`true` values for a claim with no credit
  note recorded yet, plus the two new fields.

**Two real bugs were found and fixed by this round's own `tsc`
verification, before delivery** (not sandbox artifacts, not
user-reported): two dead, impossible comparisons (`TS2367`) in
`determineAutoAdvanceTarget()`, each comparing an already-narrowed
status against a value it could never equal. Removed, with an
explanatory comment left at each site; re-running `tsc` confirmed both
gone with zero new errors introduced.

### Tests skipped / blocked

- The 8 gated DB-integration tests, skipped by design (unset
  `RUN_DB_INTEGRATION_TESTS`) — see above. Run them for real per
  `SETUP-WINDOWS.md` §23's "Run this milestone's real database
  acceptance tests" before treating 6B as fully verified.

### Known defects

None outstanding. The two defects found during this round's own
verification (the dead comparisons above) were fixed before delivery,
not left open.

## 7. Honest `tsc` / build results

- `npx eslint .` (full repo) — **clean, 0 problems.**
- `npx tsc --noEmit` — **257 errors total** (up from 241 at the end of
  6A). Breakdown: 166×`TS7006`, 38×`TS2339`, 28×`TS2694`, 18×`TS2305`,
  3×`TS2345`, 3×`TS18046`, 1×`TS2322`. **All 257 individually traced**
  to this sandbox's one documented, pre-existing limitation: `npx
  prisma generate` cannot run here, so the installed `@prisma/client`
  has no knowledge of `ClaimReturn`/`CreditNote`/`CreditNoteImportBatch`/
  their 2 new enums (or, for the pre-existing count, any model from
  Milestones 1–6A). Confirmed by filtering the output to every file
  this milestone touched and checking each line individually — zero
  new error *categories*, only more instances of the same three
  already-documented buckets. **Run `npx prisma generate` on a real
  machine** (`SETUP-WINDOWS.md` §23) and the stub-bucket errors
  resolve the same way every prior milestone's have.
- `npm run build` — hits the same pre-existing Google Fonts network
  block in `app/layout.tsx` that every prior round's build has hit,
  confirmed unrelated to and untouched by this milestone.

## 8. Known limitations (recorded, not silent)

- The 8 gated DB-integration tests have not been executed against a
  real database from this sandbox (see §6).
- No automatic reversal of a status auto-advance when a credit note
  is later unlinked/reopened/marked cannot-link — by design, left to
  6A's own manual status-change action (see PROGRESS.md's design
  rationale).
- Credit-note matching is claim-level only — no line-level matching,
  by design (6A's own exposure tracking is already claim-level).

## 9. Files changed

See `CHANGES.md`'s "Milestone 6B" section for the complete, categorized
file list (schema/migration, `lib/returns-credits/`, API routes, UI,
other changes, tests, documentation). The delivered zip contains only
these new/changed files.

---

**Milestones 6A and 6B together complete the full "Invoice Claims
Management & Returns/Credit Notes" specification.**
