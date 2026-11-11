# Milestone 8 Delivery Report — Validation and Approvals

Built from your attached full specification (14 numbered sections) in
one pass. Full design rationale and the complete verification detail
live in `docs/milestones/PROGRESS.md`'s "Milestone 8" section; this
report is the concise delivery summary.

## 1. What was implemented

One reusable, cross-module approval framework — not a bespoke flag
bolted onto Quotations — covering: **approval requests** with a
6-status lifecycle (**DRAFT** → **PENDING** → **APPROVED** /
**REJECTED** / **CANCELLED** / **WITHDRAWN**, an exhaustive, re-
validated transition graph, never a trusted client-sent status);
**configurable approval policies** (`ApprovalPolicy` rows — action
type, threshold, required approver role, self-approval allowance,
overdue window, effective date range, active flag — entered by
management through the UI, never a hardcoded limit anywhere in this
codebase); **separation-of-duties enforcement** at two independent
layers (the structural requester-vs-decider comparison and the live,
server-side re-derivation of eligibility on every decision route);
**an approval dashboard/detail/policy-settings UI**; **an internal
notification mechanism** (`Notification`, polled — no websocket/push
infrastructure exists anywhere else in this project); **a full audit
trail** (`ApprovalEvent` per-request history plus the existing generic
`AuditEvent` on every mutation); and **integration with Quotations'
pricing/discount-exception approval** as the one mandatory workflow,
exactly as scoped.

**Deliberately not implemented in this milestone** (explicit,
documented scope boundaries — your instruction, not an oversight):

- **Customer-PO/order-value approval is framework-ready only.**
  `ApprovalModule.ORDERS` and `ApprovalActionType.ORDER_VALUE_EXCEEDS_
  THRESHOLD` exist, are fully configurable through `/approvals/
  policies`, and are visibly labelled **"Not yet enforced"** there.
  `lib/orders.ts`'s `createOrderCore` was left completely untouched —
  no live gate was wired into order creation. This is restated in
  every document in this delivery (PROGRESS.md, ROADMAP.md, CHANGES.md,
  here) so it cannot be missed later.
- No SAP API integration — approvals are a SalesFlow-internal workflow
  concept only; nothing here writes to or reads from SAP.
- No email/WhatsApp delivery for notifications — in-app only, per the
  spec's own scope exclusion.
- No inventory reservation triggered by an approval request at any
  stage.
- No new RBAC role — every eligibility check resolves against the
  three roles this project already has (`SALESPERSON`/
  `SALES_MANAGER`/`ADMINISTRATOR`).

## 2. Schema / migration changes

Purely additive. 5 new enums and 4 new tables — no existing table,
column, or enum value removed or changed; the legacy, unused
Milestone 0 `ProductVerification`/`PriceDecision`/`OrderApproval`
tables and their enums are deliberately left untouched (this is a
different, newer, live framework — see ROADMAP.md's "never conflate"
entry):

| Enum | Values |
|---|---|
| `ApprovalRequestStatus` | `DRAFT`, `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `WITHDRAWN` |
| `ApprovalModule` | `QUOTATIONS`, `ORDERS` |
| `ApprovalActionType` | `QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD`, `ORDER_VALUE_EXCEEDS_THRESHOLD` |
| `ApprovalEventType` | `SUBMITTED`, `APPROVED`, `REJECTED`, `WITHDRAWN`, `CANCELLED`, `RESUBMITTED`, `INVALIDATED` |
| `NotificationType` | `APPROVAL_SUBMITTED`, `APPROVAL_APPROVED`, `APPROVAL_REJECTED`, `APPROVAL_WITHDRAWN`, `APPROVAL_OVERDUE` |

| Table | Purpose |
|---|---|
| `ApprovalPolicy` | The configurable rule: module/action type, threshold (percent or amount+currency depending on action type), required approver role, self-approval allowance, overdue window, effective date range, active flag, `isDemo`. |
| `ApprovalRequest` | One instance of a policy being triggered against a real quotation or order: submitted/previous values (JSON snapshots), status, requester/decider/withdrawer/canceller facts, resubmission chain (`previousRequestId`/`rootRequestId`). |
| `ApprovalEvent` | Append-only per-request event history, mirroring `QuotationEvent`'s own pattern exactly. |
| `Notification` | Per-user in-app inbox item: type, title, message, optional relative link, read state, `isDemo`. `onDelete: Cascade` from `User` (unlike every business record in this schema, which is `Restrict`) — a notification has no meaning once its recipient's account is gone. |

Migration file:
`prisma/migrations/20261111180000_add_validation_and_approvals/migration.sql`
(hand-authored — this sandbox cannot run `prisma migrate dev`). Every
new foreign key uses `ON DELETE RESTRICT` except `ApprovalRequest.
policyId` (`SET NULL` — a later-deactivated/deleted policy should
never block the existence of a request it once triggered) and
`Notification.userId` (`CASCADE`, per above).

**Installation**: see `SETUP-WINDOWS.md` §25 for the exact commands.
**No manual configuration required** beyond the migration and
`prisma generate` — no new environment variable, no new third-party
service, no new role. No default policy is seeded — `prisma/seed.ts`'s
`main()` only ever seeds Milestone 0's baseline (admin, demo
customers, demo orders), the same as every milestone since M1; no
default policy is ever created by application code. The gated
integration suite creates its own `isDemo: true` policy rows directly
instead (see §9).

## 3. Default policies / configurable rules

**No business limits are hardcoded anywhere in this milestone's
code.** Every threshold a policy enforces is a number management
entered through `/approvals/policies` — no default policy is seeded;
`prisma/seed.ts` was not extended for this milestone (see §2). The
gated integration suite creates its own `isDemo: true` policy rows
directly via Prisma for its own fixtures. `ApprovalPolicy` fields,
in full:

| Field | Meaning |
|---|---|
| `module` / `actionType` | Which workflow this policy governs (derived automatically from `actionType` via `actionTypeModule()` — a policy can never be saved with a mismatched pair). |
| `thresholdPercent` | For `QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD` — a discount percentage above which approval is required. |
| `thresholdAmount` + `currency` | For `ORDER_VALUE_EXCEEDS_THRESHOLD` — an order-value threshold in a specific currency (framework-ready only; see §1). |
| `requiredApproverRole` | Which role must decide a request this policy creates (`SALES_MANAGER` or `ADMINISTRATOR`). |
| `allowRequesterSelfApprove` | Default `false`. When `true`, the requester-vs-decider self-approval block is lifted for requests under this specific policy only. |
| `overdueAfterHours` | Optional — drives the dashboard's "Overdue" counter; no hardcoded SLA. |
| `effectiveFrom` / `effectiveTo` | Optional date window — a policy outside its window is treated as inactive by the evaluator even if `active: true`. |
| `active` | A simple on/off switch independent of the date window. |

When more than one active policy matches the same action type (e.g.
two overlapping discount-threshold policies with different
thresholds), **the most restrictive threshold wins** — confirmed by a
dedicated unit test in `tests/approvals.test.ts`, independent of the
order the policies happen to be stored or returned in.

## 4. Workflows affected

| Workflow | Effect |
|---|---|
| **Quotations — issuing** | `issueQuotation()` calls `checkAndRequireQuotationApproval()` before allowing `DRAFT → ISSUED`. If any active `QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD` policy is breached by any line, issuing is refused and a `PENDING` `ApprovalRequest` is created (or an existing one is reused if already pending for the same values). The refusal response carries the blocking request's id so the UI can link straight to it. |
| **Quotations — line edits** | `addQuotationLine`/`updateQuotationLine`/`removeQuotationLine` each call `invalidateStaleApprovalRequests()` after recomputing totals. A discount edited back under threshold auto-cancels the stale `PENDING` request (system reason, `CANCELLED` status, nothing deleted); a later edit back over threshold creates a *new* request chained to the original via `previousRequestId`/`rootRequestId`. |
| **Orders — creation** | **No effect.** `createOrderCore` in `lib/orders.ts` has zero calls into the approval framework. See §1. |
| **Every approval decision** | Writes one `ApprovalEvent` row, one generic `AuditEvent` row, and fires a `Notification` to the relevant recipient (the eligible approvers on submit; the requester on approve/reject/withdraw). |

## 5. Role / permission matrix

| Action | SALESPERSON | SALES_MANAGER | ADMINISTRATOR |
|---|---|---|---|
| View own submitted requests (`/approvals?tab=mine`) | ✅ | ✅ | ✅ |
| View requests awaiting their decision (`/approvals?tab=pending`) | — (never the required approver role for any shipped policy) | ✅ | ✅ |
| View any request's detail page | ✅ (any authenticated user) | ✅ | ✅ |
| Approve / reject a request | — | ✅, only if the request's `requiredApproverRole` is `SALES_MANAGER` and they are not the requester (unless the policy allows self-approval) | ✅, only if the request's `requiredApproverRole` is `ADMINISTRATOR`, same self-approval rule |
| Withdraw a request | ✅, only their own, only while `PENDING`/`DRAFT` | ✅, only their own | ✅, only their own |
| Cancel a request | — | — | ✅ (any request, any requester) |
| Create / edit approval policies (`/approvals/policies`) | — | ✅ | ✅ |
| View notifications / mark read | ✅ (own feed only) | ✅ | ✅ |

Every row above is enforced **server-side**, not just hidden in the
UI — confirmed directly: `approve`/`reject`/`withdraw`/`cancel` all
re-derive eligibility from the live policy and the live requester on
every call, and the gated integration test suite calls these routes'
underlying lib functions directly (bypassing the UI entirely) to
confirm the 403s actually happen.

## 6. New API routes

All following this project's established pattern (`verifyCsrfOrigin`
→ `requireUserOrResponse([...roles])` → `isValidId` → `readJsonObject`
→ zod `.safeParse` → lib call → `NextResponse.json`):

| Route | Method | Role gate | Purpose |
|---|---|---|---|
| `/api/approvals` | GET | any authenticated user | List, with status/module/`mine` filters |
| `/api/approvals/[id]` | GET | any authenticated user | Detail — submitted-values snapshot + event history |
| `/api/approvals/[id]/approve` | POST | policy's `requiredApproverRole` | Approve |
| `/api/approvals/[id]/reject` | POST | policy's `requiredApproverRole` | Reject, mandatory reason |
| `/api/approvals/[id]/withdraw` | POST | requester only | Withdraw |
| `/api/approvals/[id]/cancel` | POST | `ADMINISTRATOR` | Cancel |
| `/api/approval-policies` | GET, POST | `SALES_MANAGER`, `ADMINISTRATOR` | List / create policies |
| `/api/approval-policies/[id]` | GET, PATCH | `SALES_MANAGER`, `ADMINISTRATOR` | Single / update |
| `/api/notifications` | GET | any authenticated user | The caller's own feed + unread count |
| `/api/notifications/[id]/read` | POST | any authenticated user | Mark one read (ownership-checked in the lib layer) |
| `/api/notifications/mark-all-read` | POST | any authenticated user | Mark all read for the caller |

There is deliberately **no** `POST /api/approvals` route exposed for
direct, arbitrary submission — the only way a request is created is
through `checkAndRequireQuotationApproval()`, called from the
Quotations workflow itself, so a request can never be fabricated
disconnected from the real values it's supposed to represent.

## 7. New / modified pages

| Page | Purpose |
|---|---|
| `/approvals` | List + dashboard: All / Pending-my-decision / Submitted-by-me tabs, status/module filter chips (chips only on the "all" tab), summary counters row (Pending / Awaiting my decision / Submitted by me / Overdue / Approved / Avg turnaround). |
| `/approvals/[id]` | Detail: submitted-values-vs-current-values comparison table (changed fields highlighted amber), full event history, the `ApprovalActionsPanel` action island (renders only the buttons the viewer is actually eligible to use). |
| `/approvals/policies` | `SALES_MANAGER`/`ADMINISTRATOR`-only policy CRUD; redirects everyone else to `/approvals`. Create/edit form, policy list with active/inactive toggle and an explicit **"Not yet enforced"** badge on `ORDER_VALUE_EXCEEDS_THRESHOLD` rows. |

New "Approvals" sidebar entry in the WORKSPACE section (next to
"Quotations"), and a notification bell in the sidebar footer (30-
second unread-count poll, dropdown with mark-read/mark-all-read).
`/quotations/[id]` gains an amber "pending approval" banner linking to
the live request when one exists; the issue action's error path on
`/quotations/[id]` links straight to the blocking request.

## 8. Audit and notification behaviour

- Every decision (submit/approve/reject/withdraw/cancel) writes **one
  `ApprovalEvent`** (dedicated, per-request, mirrors `QuotationEvent`)
  **and one generic `AuditEvent`** — the same dual-write pattern this
  project uses everywhere else.
- Notifications fire: on submit, to every user eligible to decide
  (resolved from the policy's `requiredApproverRole`); on approve/
  reject/withdraw, to the original requester. Each notification
  carries a relative `link` (e.g. `/approvals/{id}`) — never an
  absolute URL, never anything SAP/external.
- The notification bell polls `GET /api/notifications?take=1` every 30
  seconds for the unread count, and loads the latest 15 on open.
  Marking read is optimistic client-side first, then a best-effort
  `POST` — a failed mark-read simply shows as unread again on the next
  reload rather than surfacing an error.
- **Concurrency**: every decision route uses an atomic
  `updateMany({ where: { id, status: "PENDING" } })` guard. A second
  decision arriving after the first has already committed gets a
  `409`, never a silently-overwritten decision — confirmed directly by
  a `Promise.all` concurrent-decision test in the gated integration
  suite.

## 9. Tests executed and results

```
npx vitest run
 Test Files  28 passed | 12 skipped (40)
      Tests  521 passed | 85 skipped (606)
```

- **`tests/approvals.test.ts`** — 79 unconditional tests, pure logic.
  **All 79 passing**, run and confirmed both in isolation and as part
  of the full suite. Covers: the full from×to approval-status
  transition matrix; every predicate (`isLiveStatus`/
  `eligibleApproverRoles`/self-approval checks); the XOR check on
  target references (a request always points at exactly one of
  `quotationId`/`customerOrderId`, never both, never neither);
  threshold evaluation including most-restrictive-wins across
  overlapping active policies and confirming the result is independent
  of input array order; submitted-values snapshot matching; and every
  zod schema's accept/reject boundary.
- **`tests/approvals-db.integration.test.ts`** — 12 tests, gated
  behind `RUN_DB_INTEGRATION_TESTS=1` against a real database,
  creating its own two `SALES_MANAGER` test users directly via Prisma.
  **Written and type-checked against the real schema and lib source;
  not yet executed against a real database from this sandbox** (same
  honest caveat as every gated test in this project — confirmed to
  skip cleanly on its own). Covers: policy-blocked quotation issue
  creating a `PENDING` request; self-approval block (same user
  prepared and would decide); cross-manager approval success; re-issue
  after approval succeeding unconditionally; re-deciding an already-
  decided request returning `409`; rejection with a mandatory reason
  plus the resulting notification; duplicate-submission prevention
  (second issue attempt also `409`, exactly one `ApprovalRequest` row
  exists); the concurrent-decision race (`Promise.all`, exactly one
  succeeds); staleness auto-clear (discount lowered below threshold
  cancels the stale request, next issue succeeds unconditionally);
  staleness-resubmission chaining (discount raised again creates a new
  request chained via `previousRequestId`/`rootRequestId`); requester-
  only withdraw (403 for anyone else); admin-only cancel; and role-
  eligibility enforcement (wrong-role decider refused 403).

No real bugs were found during this round's own verification beyond
the self-caught fixes already documented in PROGRESS.md (a body-
parsing convention deviation across six routes, a missing `Fragment`
key, two TypeScript literal-widening annotations, one
`react-hooks/set-state-in-effect` lint catch, two `@next/next/no-
assign-module-variable` lint catches, and one block-comment parse
error in the test file's own header comment) — all fixed before being
counted as clean.

### Tests skipped / blocked

- The 12 gated DB-integration tests, skipped by design (unset
  `RUN_DB_INTEGRATION_TESTS`) — see above. Run them for real per
  `SETUP-WINDOWS.md` §25's "Run this milestone's real database
  acceptance tests" before treating Milestone 8 as fully verified.

### Known defects

None outstanding.

## 10. Honest `tsc` / build results

- `npx eslint .` (full repo) — **clean, 0 problems.**
- `npx tsc --noEmit` — **363 errors total** (up from 331 at the end of
  Milestone 7). **Every new error individually cross-referenced**, by
  file and category, against the pre-existing M2–M7 baseline: the only
  category this milestone adds is the same stale/stub-`@prisma/client`
  noise every prior milestone has produced in this sandbox
  (`Namespace 'Prisma' has no exported member 'Decimal'`, `Module
  '"@prisma/client"' has no exported member 'NotificationType'`,
  `Parameter 'tx' implicitly has an 'any' type` on every
  `prisma.$transaction` callback including the updated
  `scripts/remove-demo-data.ts`). Zero new error *categories* — only
  more instances of the same already-documented buckets, a direct
  consequence of `npx prisma generate` being unable to reach
  `binaries.prisma.sh` from this sandbox. **Run `npx prisma generate`
  on a real machine** (`SETUP-WINDOWS.md` §25) and the stub-bucket
  errors resolve the same way every prior milestone's have.
- `npm run build` — hits the same pre-existing Google Fonts network
  block in `app/layout.tsx` that every prior round's build has hit
  since Milestone 1, confirmed unrelated to and untouched by this
  milestone. Turbopack's bundler itself reached and compiled this
  milestone's new routes/pages/components before hitting that font
  fetch, so this milestone's compile graph is structurally sound — but,
  as with every prior milestone, no claim about the static-generation/
  prerendering phase for these new routes should be read as sandbox-
  verified. **Your next real `npm run build`** (after `npx prisma
  generate`) **is what actually confirms it.**

## 11. Known limitations (recorded, not silent)

- **Customer-PO/order-value approval is not enforced** — by your
  explicit instruction, not an oversight. See §1 and §4. Wiring it in
  later is a small, additive change (the same `checkAndRequire*` gate
  pattern already proven on Quotations) and requires no further schema
  migration, since the models and enum values needed for it already
  exist.
- The 12 gated DB-integration tests have not been executed against a
  real database from this sandbox (see §9).
- Notifications are polled every 30 seconds, not pushed — an approver
  who is actively looking at a stale dropdown could in principle wait
  up to 30 seconds for a new unread badge to appear. This is the same
  trade-off every other "live-ish" surface in this project makes (no
  websocket/SSE infrastructure exists anywhere else), not specific to
  this milestone.
- An `ApprovalRequest` can target either a `Quotation` or a
  `CustomerOrder` (the schema supports both via the module/action-type
  split), but since Orders enforcement is framework-ready only, no
  code path in this milestone ever actually creates a request against
  a `CustomerOrder` yet — that side of the schema is proven only by
  its structure and by unit tests on the pure XOR-validation logic,
  not by an end-to-end flow.

## 12. Files changed

See `CHANGES.md`'s "Milestone 8" section for the complete, categorized
file list (schema/migration, `lib/approvals/` + `lib/notifications/`,
API routes, UI, other changes, tests, documentation). The delivered
zip contains only these new/changed files.

---

**Milestone 8 (Validation and Approvals) is complete as scoped, with
Customer-PO/order-value approval deliberately left framework-ready
only, per your explicit instruction.**
