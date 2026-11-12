# Milestone 10 Delivery Report — Communication Channels & Fulfilment

Built from your attached full specification in one pass, delivered
silently per your "return only changed files" instruction. This report
is the spec-structured record of what was built, what was deliberately
deferred, and the honest state of verification — see
`docs/milestones/PROGRESS.md`'s Milestone 10 section for the full
design-decision rationale this report summarizes.

## 1. Scope recap and the engineering standard this milestone was held to

The spec's four numbered points: (1) email/WhatsApp message intake with
mandatory human review before any commercial transaction; (2) customer
communication at quotation, order-confirmation, picking-update, and
delivery stages; (3) fulfilment management — dispatch, delivery,
partial fulfilment, shortages/substitutions, preserving Milestone 3's
picking authorisation; (4) communication reliability — a durable
queue/outbox, retry/failure handling, duplicate prevention, full audit
trail. Explicit constraints: never invent external integrations,
credentials, API endpoints, or WhatsApp access; never pretend WhatsApp
is connected when it is not; preserve every Milestone 0–9 workflow;
enforce every permission server-side; respect the existing
`SALESPERSON`/`SALES_MANAGER`/`ADMINISTRATOR` roles; make every
important action auditable. Every one of these is honoured — see §14
for the three deviations from the plan as originally sketched (none of
which narrow the spec's required scope).

## 2. Architecture: the channel adapter contract

`lib/channels/types.ts`'s `ChannelAdapter` interface mirrors
`lib/integrations/sap/types.ts`'s own `SapAdapter` shape exactly —
deliberately **send-only**: inbound email/WhatsApp messages never
arrive through an adapter method call, because a real provider
delivers them to this app via an HTTP webhook it receives, not a
request it initiates. There is nothing to abstract behind a
`fetchMessages()` method, and inventing one would misrepresent how
either provider's inbound side actually works.

Two adapters, each with a deterministic mock and an honestly
**unverified-against-any-real-provider** real implementation, selected
only through `lib/channels/get-adapter.ts`'s `getEmailAdapter()`/
`getWhatsAppAdapter()`:

- **Email** — `lib/channels/email/real-adapter.ts` is shaped against
  the common Postmark/SendGrid transactional-email REST pattern.
- **WhatsApp** — `lib/channels/whatsapp/real-adapter.ts` is shaped
  against the public WhatsApp Business Cloud API's documented
  message-send endpoint.

Both fail safe to mock: `canUseLiveEmailAdapter()`/
`canUseLiveWhatsAppAdapter()` require the deployment-level env-var kill
switch (`CHANNEL_EMAIL_PROVIDER`/`CHANNEL_WHATSAPP_PROVIDER`, exactly
`"live"`) **and** a complete, real set of credentials — there is no UI
toggle anywhere that can flip either into live mode on its own.

## 3. Schema / migration changes

Purely additive — see `CHANGES.md`'s Schema/migration table for the
exact file/column list. 6 new enums (`MessageChannel`,
`MessageIntakeStatus`, `OutboundMessageType`, `OutboundMessageStatus`,
`DispatchStatus`, `DeliveryOutcome`), 2 new values on the existing
`NotificationType` enum, 7 new models (`MessageIntake`,
`MessageAttachment`, `OutboundMessage`, `DispatchRecord`,
`DispatchLine`, `DeliveryRecord`, `DeliveryLine`). No existing table,
column, or enum value is removed, renamed, or retyped. The migration
was hand-authored (`prisma/migrations/20261111220000_add_communications_and_fulfilment/migration.sql`)
since `prisma migrate dev` cannot run in this sandbox — see §13.

## 4. Inbound intake and mandatory human review (spec point 1)

`MessageIntake` is created the instant a message arrives — by a
webhook POST, or by the always-available "Log a message manually"
form (`/communications/inbox`, for when no real channel is connected,
or for a call/walk-in). **No signed-in user is involved at that
moment** — `reviewedById` is structurally `null` until a human acts, so
"human review before any commercial transaction" isn't a convention
here, it's a fact the schema enforces. A suggested customer match
(exact email for `EMAIL`, normalized-phone for `WHATSAPP`) is computed
and attached, but never auto-confirmed.

A reviewer then does exactly one of:

- **Convert** — calls the EXISTING, completely unmodified
  `lib/po-intake.ts` `createPoIntake()`, attributing the resulting
  `OrderDocument` to the **reviewer**, never to the message itself.
  Either the message's `bodyText` (pasted-text submission) or one
  selected attachment (file submission) is converted — a message with
  several attachments converts its one selected attachment only; any
  other stays visible/downloadable on the review page and can be
  attached to the resulting order afterward through the existing
  per-order document upload route once that order exists. This is a
  deliberate, documented scope boundary, not an oversight.
- **Link** — ties the message to an already-existing order or
  quotation as a follow-up communication, never creating a new PO.
- **Ignore** — not a commercial transaction at all (spam, general
  chat), with a reason recorded.
- **Mark duplicate** — a re-delivery of an already-seen message,
  pointing at the original (`duplicateOfId`), never silently dropped.

Every action refuses with `409` once a message has left `RECEIVED` —
nothing can be reviewed twice. `recordInboundMessage` itself is
idempotent on `externalMessageId` (when the provider supplies one): a
webhook's at-least-once redelivery of the same provider message id
returns the *original* row with `duplicate: true` rather than creating
a second `MessageIntake`, enforced by a database `@unique` constraint,
not a racy check-then-insert.

Inbound webhooks (`app/api/channels/{email,whatsapp}/webhook`) are
genuinely implemented against each provider's public documentation —
signature verification (`X-Hub-Signature-256` for WhatsApp, an HMAC
shared secret for email) is attempted only when the corresponding
secret is configured; **while it is not (the default everywhere
today), both routes refuse every request with a 503** "...is not
configured on this deployment" — there is no "accept unsigned, verify
later" fallback. This is the literal, structural form of the spec's
"do not pretend WhatsApp is connected when it is not."

## 5. Outbound customer communication (spec point 2)

`OutboundMessage` is a deliberately **lighter outbox** than Milestone
9's `IntegrationOperation`, on purpose: a failed email/WhatsApp send
has no reconciliation ambiguity the way a lost SAP response does — the
provider's own API call either clearly succeeded or clearly failed. So
the lifecycle is just `QUEUED → SENT | FAILED`, with a manual
**Resend** (`SALES_MANAGER`/`ADMINISTRATOR`-only) on `FAILED` that
always resends the exact same immutable rendered body, never
re-rendered from possibly-changed data.

Six message types, one `lib/communications/templates.ts` renderer each,
triggered by `lib/communications/send.ts`'s `queue*Message` functions:

| Trigger | Message type | Fires from |
|---|---|---|
| Quotation issued | `QUOTATION_ISSUED` | `app/api/quotations/[id]/issue` |
| Customer accepted/rejected a quotation | `QUOTATION_RESPONSE_ACKNOWLEDGED` | `app/api/quotations/[id]/respond` |
| Quotation converted to order | `ORDER_CONFIRMATION` | `app/api/quotations/[id]/convert-to-order` |
| Picking authorized | `PICKING_UPDATE` | `app/api/orders/[id]/picking/[sessionId]/authorize` |
| Dispatch departed | `DISPATCH_NOTIFICATION` | `app/api/orders/[id]/dispatch/[dispatchId]/depart` |
| Delivery recorded, accepted in full | `DELIVERY_CONFIRMATION` | `app/api/orders/[id]/dispatch/[dispatchId]/delivery` |
| Delivery recorded, any rejection | `DELIVERY_EXCEPTION` | same route |

Every trigger lives at the thin **API route** layer, in its own
try/catch that only logs on failure and can never turn a successful
business action into a failed HTTP response — deliberately **not**
inside `lib/quotations/issue.ts`/`convert-to-order.ts`/
`lib/picking/authorize-picking.ts`'s own transactions, so no
already-shipped M3/M7/M8 workflow was touched at the transaction
level. See §6 for why a queuing failure is never silent despite this.

## 6. Fulfilment management (spec point 3)

`lib/fulfilment/` gives dispatch/delivery their own lifecycle,
`DispatchRecord.status` (`PLANNED → DEPARTED → DELIVERED`, or
`CANCELLED` any time before departure) — never a new `OrderStatus`
value, the same precedent Milestone 9 already set for not touching
that shared enum.

`getOrderFulfilmentStatus()` is the one live-derived definition of
"outstanding to dispatch" every caller uses: `authorizedFoundQuantity`
(summed `PickingLine.foundQuantity` across **every** `AUTHORIZED`
`PickingSession` for the order — correctly additive across a re-pick,
never "latest session wins") minus `dispatchedQuantity` (summed
`DispatchLine.dispatchedQuantity` across every non-`CANCELLED`
`DispatchRecord`), clamped at zero. This directly supports **partial
fulfilment** — several dispatches per order — without any schema
change: a dispatch can cover a subset of an order's lines and a
subset of a line's quantity, and the next dispatch simply sees a
smaller outstanding figure.

`recordDelivery()` requires every line of a dispatch to be accounted
for in one call (`accepted + rejected === dispatched`, exactly), a
rejection reason wherever `rejectedQuantity > 0`, and creates exactly
one `DeliveryRecord` per `DispatchRecord` (`@unique` constraint) —
**shortages and substitutions** are recorded as a rejected quantity
plus a free-text reason ("5 damaged in transit", "wrong item
substituted", etc. — never a closed enum, since field conditions
produce reasons no fixed list would anticipate). A rejection never
auto-creates an `InvoiceClaim`: the delivery UI only offers a "File a
claim" link into the EXISTING `/invoice-claims/new` flow (Milestone
6A) for a human to file one explicitly.

Milestone 3's picking authorisation is completely untouched —
`DispatchRecord.pickingSessionId` is an optional traceability pointer
only, and every dispatch-creation request is independently validated
against the live `getOrderFulfilmentStatus()` figure, never against a
cached or stored "how much was authorized" number.

## 7. Communication reliability (spec point 4)

- **Durable queue/outbox**: every `OutboundMessage` is a real database
  row created before any send attempt, in `QUEUED` status, inside the
  same best-effort call that triggers it — a queuing failure (caught in
  the route's own try/catch) is logged via `console.error`, never
  silently dropped, though it does mean no row exists for that one
  attempt; it is not retried automatically on that path, by this
  milestone's own design choice (see §14).
- **Retry/failure handling**: a `FAILED` row carries a sanitized
  `lastErrorMessage` and is resendable, once, by a `SALES_MANAGER`/
  `ADMINISTRATOR`, via `resendOutboundMessage()` — `lastResentById`/
  `lastResentAt` are tracked separately from `triggeredById`, so the
  record never loses who *originally* caused the communication even
  after a later resend by someone else.
- **Duplicate prevention**: `OutboundMessage.idempotencyKey` is
  `@unique` and deterministic per triggering event
  (`MSG-<type>-<entityId>` for a once-ever transition,
  `MSG-<type>-<dispatchOrDeliveryRecordId>` for a per-record event) —
  a route racing or retrying never creates a second message for the
  same real-world event; `createAndSend()` catches the resulting
  unique-constraint violation as an idempotent no-op. On the inbound
  side, `MessageIntake.externalMessageId` is likewise `@unique`, with
  the same idempotent-return-the-original-row behaviour (§4).
- **Audit trail**: every `MessageIntake` review decision and every
  `DispatchRecord`/`DeliveryRecord` creation/transition writes an
  `AuditEvent`, in the same database transaction as the business
  change — see §11.

## 8. Role / permission matrix

| Action | SALESPERSON | SALES_MANAGER | ADMINISTRATOR |
|---|---|---|---|
| View/review the message inbox, log a message manually | ✅ | ✅ | ✅ |
| Convert a message / link to order or quotation / ignore / mark duplicate | ✅ | ✅ | ✅ |
| View the outbound communications log | ✅ | ✅ | ✅ |
| Resend a FAILED outbound message | ❌ | ✅ | ✅ |
| Create a dispatch, record departure, cancel a PLANNED dispatch | ✅ | ✅ | ✅ |
| Record a delivery outcome | ✅ | ✅ | ✅ |

Operational recording (inbox triage, dispatch/delivery logging) is
open to any authenticated role, mirroring Milestone 3's own "picking
itself has no dedicated role" precedent; only resending a message
after a failure — a deliberate repeat external action — is restricted,
mirroring Milestone 9's own retry-action precedent. Every rule is
enforced server-side via `requireUserOrResponse()`, never only in the
UI — confirmed by reading every route in §9, not assumed.

## 9. New API routes

See `CHANGES.md`'s "API routes (new)" table for the complete list with
methods and roles. In summary: 6 routes under `app/api/channels/intake/`
and `app/api/channels/manual-intake/` for inbound review; 2 webhook
routes; 3 routes under `app/api/communications/` for the outbound log
and resend; 6 routes under `app/api/orders/[id]/{fulfilment,dispatch}/`
for the dispatch/delivery lifecycle — nested under the order they
belong to, matching how picking and documents are already routed in
this codebase (see §14's first deviation).

## 10. UI / UX

- `/communications/inbox` — the `MessageIntake` review queue, status
  tabs, the manual-intake form.
- `/communications/inbox/[id]` — one message's review page with the
  four actions.
- `/communications` — the separate outbound `OutboundMessage` log,
  status tabs, Resend on `FAILED` rows.
- `/deliveries` — the dispatch queue, building out the previously-dead
  sidebar link.
- `/fulfilment/[id]` — a new dispatch/delivery panel rendered after the
  existing picking panel.
- Sidebar: new "Message Inbox" (WORKSPACE) and "Communications"
  (OPERATIONS) entries.

See §14 for the two UI-shape deviations from the original plan sketch
(no embedded panel on `/quotations/[id]`/`/orders/[id]`; no
`/communications/settings` page).

## 11. Audit trail

Every `MessageIntake` review action (`MESSAGE_INTAKE_CONVERTED`,
`..._LINKED_ORDER`, `..._LINKED_QUOTATION`, `..._IGNORED`,
`..._MARKED_DUPLICATE`) and every `DispatchRecord`/`DeliveryRecord`
state change (`DISPATCH_RECORD_CREATED`, `..._DEPARTED`,
`..._CANCELLED`, `DELIVERY_RECORDED`) writes an `AuditEvent` inside the
same database transaction as the change itself — never a best-effort
write after the fact. No webhook secret, API key, or access token is
ever stored anywhere but the environment; `sanitizeChannelErrorMessage`
redacts anything that could conceivably be a credential before an
error is stored on `OutboundMessage.lastErrorMessage` or shown in the
UI.

## 12. Tests executed and results

- **39 unconditional unit tests**, all passing, covering every
  pure-logic module with no `@prisma/client` dependency:
  `tests/fulfilment-decimal.test.ts` (16 — exact bigint-scaled
  arithmetic), `tests/fulfilment-validation.test.ts` (14 — every zod
  schema's accept/reject boundary), `tests/communications-
  templates.test.ts` (9 — every message-body renderer's branches).
  Writing the first of these caught a real `BigInt`-literal/ES2017-
  target bug — see §13.
- **8 gated DB-integration tests**, written to this project's own
  established convention (`describe.skipIf`, dynamic imports, demo-
  marked rows, cleaned up in `afterAll`):
  `tests/fulfilment-db.integration.test.ts` (4 — the dispatch→
  depart→deliver lifecycle, outstanding-quantity math across a partial
  dispatch and a cancellation, `recordDelivery`'s validation) and
  `tests/channels-intake-review-db.integration.test.ts` (4 —
  idempotent dedup, every review action's already-reviewed refusal,
  `convertMessageIntakeToPoIntake` producing a real `OrderDocument`).
  Correctly self-skipping in this sandbox (no `DATABASE_URL`) — not
  yet run against a real database.
- **Full-project regression**: `npx vitest run` — 592 passed, 98
  skipped (49 files), up from 553 passed/90 skipped (44 files) at the
  end of Milestone 9. Zero regressions in any pre-existing test.

## 13. Honest `tsc` / lint / build results

- **`npx eslint .`** (`npm run lint`) — clean across the whole project.
- **`npx tsc --noEmit`** — 412 errors, up from 370 at the end of
  Milestone 9 (+42, all inside this milestone's own new files).
  Individually verified, every one, against two categories: the stale
  generated `@prisma/client` (dated 2026-11-10, before this
  milestone's 2026-11-11 schema edits) simply not knowing the 7 new
  models/6 new enums exist, and that staleness cascading into an
  implicit `any` or a `{}`-typed query result. **Confirmed identical**
  to the pre-existing noise category already present in already-
  shipped code (`lib/approvals/quotation-gate.ts`, `lib/approvals/
  requests.ts`, `lib/integrations/sap/order-outbox.ts`, `lib/
  integrations/sap/sync-job.ts` all produce the exact same error
  shapes today) — proof this is a sandbox limitation, not a defect
  introduced here. Two genuine defects were found and fixed during
  this same verification pass, before being counted out of the above:
  - `lib/fulfilment/{decimal,dispatch,delivery}.ts` used `10_000n`-
    style `BigInt` literal syntax in 8 places; this project's
    `tsconfig.json` targets ES2017, which doesn't support that syntax
    (`TS2737`) — `lib/picking/validation.ts`'s own comment already
    documents exactly why its own decimal arithmetic uses
    `BigInt(10_000)` call syntax instead. Fixed to match.
  - `app/api/channels/whatsapp/webhook/route.ts` narrowed a
    `message.image ?? message.document` union via `"filename" in
    media`, which TypeScript did not narrow cleanly (`TS2322`, a
    genuine type error). Fixed by reading `message.document?.filename`
    directly — the only one of the two media variants WhatsApp ever
    attaches a filename to.
- **`npx prisma generate`** — confirmed, conclusively, not possible in
  this sandbox: `binaries.prisma.sh` returns `403 Forbidden` for both
  the engine checksum file and the engine binary itself, even with
  `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` set; no cached engine
  exists anywhere on disk. `DATABASE_URL` and `prisma.config.ts` are
  both otherwise correctly configured — this is a hard sandbox
  limitation, not a setup error.
- **`npm run build`** — not re-attempted this round, same pre-existing
  Google-Fonts network block every prior milestone has hit.
- **Not run in this sandbox**: this milestone's 8 gated DB-integration
  tests against a real database, and anything through the real email/
  WhatsApp send adapters or real webhook signature verification — no
  real transactional-email account, WhatsApp Business Account, or Meta
  App credentials were ever available, and none were guessed.

## 14. Known limitations and deviations (recorded, not silent)

Three concrete deviations from the plan as originally sketched (none
narrow the spec's required scope — see `docs/milestones/PROGRESS.md`'s
"What was actually built" section for the full detail):

1. **Routes nested under `/orders/[id]`, not a top-level `/dispatches`
   collection** — matches how picking and documents are already routed
   in this codebase; a dispatch/delivery is never looked up except in
   the context of its order.
2. **The inbox and the outbound log are two separate pages**
   (`/communications/inbox` vs. `/communications`), not one page with
   panels embedded on `/quotations/[id]`/`/orders/[id]` — every
   `OutboundMessage` is still visible and resendable from
   `/communications`, it is simply not also duplicated inline on the
   order/quotation it concerns.
3. **No `/communications/settings` page** — the mock/live kill switches
   already fail safe with no UI involved; `.env.example` and this
   report are the record of how to enable a live provider. Can be
   added in a future round if wanted.

Other known, non-blocking facts: `sweepStuckQueuedMessages()` exists
(for a `QUEUED` row stuck by a process crash) but is not wired to any
scheduler — this architecture has no background-job runner, same
limitation Quotations' own expiry sweep (Milestone 7) already has.
Both real send adapters and both webhook signature-verification paths
are honestly unverified against any real provider — see §13's last
bullet.

## 15. Go-live path

Before setting `CHANNEL_EMAIL_PROVIDER`/`CHANNEL_WHATSAPP_PROVIDER` to
`"live"` anywhere but a test environment: obtain a real transactional-
email provider account and API key (`CHANNEL_EMAIL_API_KEY`/
`CHANNEL_EMAIL_FROM_ADDRESS`), or a real WhatsApp Business Account
with an approved Meta App (`CHANNEL_WHATSAPP_PHONE_NUMBER_ID`/
`CHANNEL_WHATSAPP_ACCESS_TOKEN`); configure the matching webhook
secret(s) and register this deployment's webhook URL with the
provider; and read through `lib/channels/email/real-adapter.ts`/
`lib/channels/whatsapp/real-adapter.ts`'s own header comments, since
neither has ever been exercised against a real account. None of this
is Willsgrove's decision to make today — no vendor has been chosen or
assumed.

## Files changed

See `CHANGES.md`'s Milestone 10 section for the complete file-by-file
list (schema/migration, 3 new `lib/` modules, 18 new/modified API
routes, 10 new/modified UI files, `scripts/remove-demo-data.ts`,
`.env.example`, 5 new test files, and this documentation set).

## Exact Windows PowerShell commands

See `SETUP-WINDOWS.md` §27 for the full, copy-pasteable sequence:
applying the migration, regenerating the Prisma client, configuring
the eight new environment variables, running the two new gated test
files, and a 10-step manual test script covering intake review,
outbound messaging, and the full dispatch/delivery lifecycle through
the UI.
