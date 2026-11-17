# Database Cleanup Plan — Operational Data Reset

**Status: plan + script delivered, NEVER executed.** Nothing in this
document or in `scripts/reset-operational-data.ts` has been run against
any database, seeded or otherwise, in any sandbox or environment. This
sandbox has never had live database access (`prisma generate` cannot
reach `binaries.prisma.sh`; see `FINAL-IMPLEMENTATION-REPORT.md`), and
even if it did, running a destructive reset without the user's explicit,
in-the-moment approval is against this engagement's standing constraints.
**Do not run `npm run db:reset-operational-data` until a human with real
database access has read this document in full, confirmed a backup
exists, and explicitly decided to proceed.**

This is a different, broader tool than `npm run db:remove-demo`
(`scripts/remove-demo-data.ts`). That script deletes only rows flagged
`isDemo: true` and leaves every master-data table (`User`, `Customer`,
`Product`, …) and every real row untouched. This plan's script deletes
**all** rows — demo and real alike — from every *operational/
transactional* table, while leaving master/reference data and a short,
explicitly-chosen list of other tables completely untouched regardless
of their own `isDemo` flag. The two tools do not overlap and can be run
in either order, or independently. If the goal is only to clear seed/demo
fixtures, use `npm run db:remove-demo` instead — it is safer (smaller
blast radius) and already exists.

## 1. What "operational data reset" means here — the reading taken

The directive's own wording ("operational data reset") is not itself a
term already defined elsewhere in this codebase, so this is the explicit
interpretation this plan commits to, stated so it can be reviewed and
overridden before the script is ever run:

**Wipe:** every row in every table that represents a transaction, a
workflow step, a decision, a communication, or a derived/learned
artifact of processing real business activity — i.e. everything that
accumulates as the business operates, regardless of whether individual
rows happen to be flagged `isDemo`.

**Preserve:** every table that represents master/reference data (the
nouns the business transacts against, sourced from SAP or configured by
an administrator) or system/audit infrastructure that has no honest
"operational" meaning of its own — see §3 for the exact, fully-reasoned
list and the one genuinely judgment-call table (`ProductAlias`/
`CustomerAlias`).

This is a plan for a human to approve or amend, not a unilateral
decision. If Willsgrove wants a narrower or wider scope (for example,
keeping `ProductAlias`/`CustomerAlias` so document-matching accuracy
isn't lost, or additionally clearing `isDemo` master data via
`db:remove-demo`), §3's table and the script's model list are both built
to be easy to adjust before the first real run.

## 2. Full schema dependency map

The complete model-by-model foreign-key graph (every outgoing FK, its
exact `onDelete` behaviour, and which models are "hub" models with many
incoming references) was extracted by reading the full 4,462-line
`prisma/schema.prisma` in its entirety, covering all 61 models. The
findings that drove this plan's deletion ordering:

- **Every FK in this schema declares `onDelete` explicitly** — `Restrict`
  (the large majority: a child row must be deleted, or its FK nulled if
  nullable, before its parent can be deleted), `SetNull` (the parent can
  be deleted freely; Postgres nulls the child's FK automatically), or
  `Cascade` (deleting the parent auto-deletes the child). No implicit
  defaults are relied on anywhere.
- **Only eight relations use `Cascade`:** `Session.userId`,
  `Notification.userId`, `MessageAttachment.messageIntakeId`,
  `PickingLine.pickingSessionId`, `DispatchLine.dispatchRecordId`,
  `DeliveryLine.deliveryRecordId`, `ProductAlias.customerId`/
  `.productId`, `CustomerAlias.customerId`. Every one of these children
  only ever makes sense attached to its parent.
- **Four self-referential FKs exist:** `Quotation.previousRevisionId`,
  `ApprovalRequest.previousRequestId`, `UnfulfilledDemand.
  supersededByDemandId`, `MessageIntake.duplicateOfId`. All four are
  `Restrict`/`SetNull` on a *nullable* column. Because this script always
  deletes an **entire** table in one `deleteMany({})` call (never a
  filtered subset), every row of a self-referencing pair is removed in
  the same SQL statement — and Postgres evaluates FK constraints only
  after a statement finishes, not row-by-row — so no explicit "null the
  self-reference first" step is needed anywhere. (This is the same
  observation `scripts/remove-demo-data.ts`'s own header comment makes
  for its scoped `isDemo` deletes; it applies even more simply here
  because nothing is filtered.)
- **Biggest hubs:** `User` (~60+ incoming FKs, almost all `Restrict` —
  this is exactly why `User` stays preserved: a real reset would
  otherwise have to delete every user account), `CustomerOrder` (~15
  incoming FKs), `Customer`, `Product`, and the `SapInvoice`/
  `InvoiceClaim` sub-graph (tightly cross-referenced by `CreditNote`/
  `ClaimReturn`/`InvoiceClaimLine`/`InvoiceDeliveryRecord`).

Nothing below depends on memorising this graph — §4's script already
encodes the full, verified deletion order. This section exists so the
ordering can be audited against the schema, not taken on faith.

## 3. Tables preserved vs. wiped

### Preserved (never touched by this script, regardless of `isDemo`)

| Table | Why |
|---|---|
| `User` | Staff accounts/logins. Wiping these would lock everyone out; also the single largest FK hub in the schema — nothing else in the preserved set depends on this reasoning, but it is the clearest case. |
| `Session` | Server-side login sessions. A conscious choice, not an FK requirement — nothing blocks also clearing these. Kept so a reset does not silently log out every signed-in user. |
| `Customer`, `CustomerContact`, `CustomerLocation` | SAP-sourced master data: the business partners the business sells to. |
| `Product` | SAP-sourced master data: the sellable catalogue. |
| `TaxCode` | SAP-sourced master data: VAT-rate lookup. |
| `PriceList`, `PriceListEntry` | SAP-sourced master data: pricing structure. |
| `Personnel`, `Vehicle` | Operationally-configured master data: drivers/assistants and trucks available for dispatch assignment — reusable resources, not per-transaction records. |
| `ApprovalPolicy` | Admin-configured threshold *configuration*, not a transaction. (Its own instances, `ApprovalRequest`/`ApprovalEvent`, **are** wiped — see below.) |
| `IntegrationConnection` | Singleton SAP B1 connection *configuration* record. (Its own activity log, `IntegrationSyncJob`/`IntegrationOperation`, **is** wiped.) |
| `AuditEvent` | The audit trail itself must survive a reset to prove the reset happened — see §5. Never scoped for deletion by any script in this codebase. |

### Wiped (every row, regardless of `isDemo`) — 47 tables

Grouped by subsystem, in the order the script deletes them (full
leaf-to-root reasoning is in the script's own comments):

- **Decision intelligence:** `DecisionRecommendationEvent`, `DecisionRecommendation`
- **Communications & fulfilment:** `MessageAttachment`, `OutboundMessage`, `MessageIntake`, `DeliveryLine`, `DeliveryRecord`, `DispatchLine`, `DispatchRecord`
- **Approvals & notifications:** `ApprovalEvent`, `ApprovalRequest`, `Notification`
- **Quotations:** `QuotationEvent`, `QuotationLine`, `Quotation`
- **Document extraction:** `ExtractedOrderLine`, `ExtractionRun`
- **Legacy order-review trio & order history:** `ProductVerification`, `PriceDecision`, `OrderApproval`, `OrderStatusHistory`, `OrderDocument`, `OrderHandover`
- **Lost sales:** `CustomerDecisionEvent`, `LostSaleRecord`, `UnfulfilledDemand`
- **Picking:** `PickingLine`, `PickingSession`
- **Claims & credit notes:** `ClaimReturn`, `InvoiceClaimAttachment`, `ClaimResolution`, `CreditNote`, `InvoiceClaimLine`, `InvoiceClaim`, `InvoiceDeliveryRecord`
- **SAP invoice reconciliation:** `SapInvoiceLine`, `SapInvoice`, `SapInvoiceImportBatch`, `CreditNoteImportBatch`
- **SAP integration activity log:** `IntegrationOperation`, `IntegrationSyncJob`
- **Learned extraction aliases:** `ProductAlias`, `CustomerAlias`
- **The order pipeline itself:** `OrderLine`, `CustomerOrder`
- **Stock snapshots:** `StockSnapshotLine`, `StockSnapshot`

### The one genuine judgment call: `ProductAlias` / `CustomerAlias`

These are *learned* mappings (free-text customer/product wording →
resolved SAP record) built up automatically as real purchase orders are
processed — not SAP master data, but also not a "transaction" in the
sales-pipeline sense. This plan classifies them as operational and wipes
them, on the reasoning that a true reset should let document-extraction
matching relearn from scratch rather than carry forward associations
tied to deleted orders/messages. **If Willsgrove would rather keep this
learned matching intelligence across a reset,** remove the two
`tx.productAlias.deleteMany()` / `tx.customerAlias.deleteMany()` calls
(and their count lines) from `scripts/reset-operational-data.ts` before
the first real run — nothing else in the script depends on them being
wiped, since both only carry `Cascade`/`Restrict`-to-preserved-table FKs.

### Special-handling records

- **`AuditEvent`** is never deleted by this script, and the script's own
  final action is to *append one new row* to it — `action:
  "OPERATIONAL_DATA_RESET"` — recording the actor, the operator-supplied
  backup reference, and the exact before/after row count of all 47
  wiped tables. This mirrors `scripts/remove-demo-data.ts`'s own
  terminal-audit-event pattern exactly.
- **Self-referential FKs** (`Quotation`, `ApprovalRequest`,
  `UnfulfilledDemand`, `MessageIntake`) need no special null-out step —
  see §2's explanation of why a full-table `deleteMany({})` sidesteps
  this entirely.
- **`isDemo`-flagged master data** (e.g. demo customers/products seeded
  by `prisma/seed.ts`) is explicitly **out of scope** for this script.
  If that should also be removed, run `npm run db:remove-demo`
  separately — before or after this script, in either order, since
  after this script runs there is no operational data left for it to
  conflict with.

## 4. The script

`scripts/reset-operational-data.ts` (run via `npm run
db:reset-operational-data`) implements the plan above. Summary of its
safety mechanisms — full detail is in the script's own comments:

1. **Admin-gated.** Requires `--actor=<userId>` naming a real `User` row
   with `role: "ADMINISTRATOR"` and `status: "ACTIVE"`, validated against
   the database before anything else runs. A missing, non-existent,
   non-admin, or inactive actor refuses the run.
2. **Dry-run first, always.** `--dry-run` (no other flags required besides
   `--actor`) prints a full per-table row count and a grand total, and
   **changes nothing**. The real run requires `--confirm-total-rows=<N>`
   to exactly match a *freshly re-counted* total taken at run time —
   not the dry-run's own cached number — so a stale or copy-pasted
   command from an earlier state, or a different environment, is
   refused rather than silently deleting a different amount of data than
   the operator reviewed.
3. **Backup-required.** `--backup-reference="<description>"` must be a
   non-empty string describing what backup was taken and when (e.g. a
   Neon branch/snapshot id and timestamp) — not a bare yes/no flag. It is
   recorded verbatim in the final `AuditEvent`, so the backup that was
   attested to is permanently tied to the reset it preceded.
4. **Confirmation-required.** `--confirm="RESET OPERATIONAL DATA FOR
   WILLSGROVE SALESFLOW"` must match that exact literal phrase.
5. **Transactional.** All 47 deletes plus the terminal `AuditEvent`
   insert run inside one `prisma.$transaction`, so a failure partway
   through leaves the database exactly as it was before the script ran
   — never half-cleaned.
6. **Idempotent / guarded.** Every delete is an unconditional
   `deleteMany({})` on its table; running the script again against an
   already-empty operational dataset is a safe no-op (every count is 0,
   one more `AuditEvent` row is appended recording that fact).
7. **Target visibility.** Before doing anything else, the script prints
   the database host it is about to connect to (parsed from
   `DATABASE_URL`, credentials stripped) so the operator can visually
   confirm it is pointed at the intended environment, per
   `docs/production/DATABASE-BACKUP-AND-RECOVERY.md` §2's own "confirm
   the target" step.

### How to run it (for whoever has real database access — never in this sandbox)

```bash
# 1. Take a real backup through your hosting provider first. See
#    docs/production/DATABASE-BACKUP-AND-RECOVERY.md §3.

# 2. Dry run — review the counts, change nothing:
npm run db:reset-operational-data -- --actor=<admin-user-id> --dry-run

# 3. Real run, using the total the dry run just printed:
npm run db:reset-operational-data -- \
  --actor=<admin-user-id> \
  --backup-reference="Neon branch snapshot br-xxxx taken 2026-11-17T14:00Z" \
  --confirm="RESET OPERATIONAL DATA FOR WILLSGROVE SALESFLOW" \
  --confirm-total-rows=<N-from-step-2>
```

## 5. Rollback procedure

This script performs real `DELETE` statements — Postgres's own
transaction guarantees mean a *failed* run leaves the database
untouched (see §4 point 5), but a *successful* run's deletions are
permanent at the application level. There is no in-application "undo."
Recovery from an unwanted or mistaken successful run follows the
project's existing, already-documented procedure rather than a new one
invented for this script:

1. **Stop.** Do not run the script again, and do not let the
   application continue writing new operational data on top of the
   reset state, until a decision is made.
2. **Restore from the backup recorded in the triggering `AuditEvent`.**
   Query `AuditEvent` for the most recent `action:
   "OPERATIONAL_DATA_RESET"` row — its `afterData.backupReference` field
   holds exactly what the operator attested to before running the
   script. Follow the restore procedure in
   `docs/production/DATABASE-BACKUP-AND-RECOVERY.md` §3 ("Restore
   procedure") using that backup: restore into a **separate** instance
   first, verify it, and only then treat it as the path back — never
   restore directly over the live database without that verification
   step.
3. **Incident handling.** If the reset was run in error (wrong
   environment, wrong intent), treat it as a Critical incident per
   `docs/production/ROLLBACK-AND-INCIDENT-RESPONSE.md` §4–§6: capture
   when it was noticed, what was run (the full command, available from
   shell history and the `AuditEvent` row), and follow that document's
   capture checklist once resolved.
4. **Master data is never at risk.** Because this script never touches
   `Customer`, `Product`, `PriceList`, `User`, or any other preserved
   table (§3), a restore only needs to bring back operational/
   transactional rows — master data present after an accidental reset
   is still the live, current master data and does not itself need to
   be rolled back.

## 6. What this plan deliberately does not do

- It does not run anything. No command in this document or the script
  has been executed against any database.
- It does not touch `isDemo`-flagged master data — that remains
  `npm run db:remove-demo`'s job.
- It does not attempt to configure or verify a real backup system —
  that gap is already documented, honestly, in
  `docs/production/DATABASE-BACKUP-AND-RECOVERY.md` §3 as something only
  Willsgrove's own hosting-provider access can close.
