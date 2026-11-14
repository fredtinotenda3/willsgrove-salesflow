# Milestone 16 Delivery Report — Production Readiness & Go-live

Built from your attached full specification — "M16 — Production Readiness & Go-live / Full Production Audit, Hardening, Verification and Deployment Authorisation" — against the fresh repository zip supplied as this milestone's explicit "authoritative starting point." This report follows the spec's own section numbering so every requirement maps to a specific finding, fix, or document. The eight new `docs/production/*.md` files are the detailed reference; this report is the summary and the final verdict.

**A note on the starting repository, because the spec explicitly warns against assuming a prior milestone's documented state matches the supplied code:** it did not, in two concrete ways, found and fixed before any other audit work began. `lib/reporting/product-insights-queries.ts` referenced a function, `getProductById`, that was imported and called at runtime but **never actually defined anywhere in the codebase** — a genuine, pre-existing defect that would have crashed the Product 360 page in real use, which had evidently escaped every prior milestone's own `tsc`/`eslint` round because it manifested as a malformed-generic parse error rather than a clean "missing export" error. And `lib/reporting/types.ts`'s `ReportFilters` type was missing 8 fields (`currency`, `lostSalesReason`, `productCategory`, `productSearch`, `sapItemCode`, `decisionCategory`, `priority`, `recommendationStatus`) that every other file in the repository that uses `ReportFilters` already correctly assumed existed — strongly suggesting this specific file had reverted to, or been reconstructed from, an older version during whatever process assembled this milestone's starting zip. Both are fixed; see §11.

## 1–2. Repository integrity and production architecture

Full detail: `docs/production/PRODUCTION-ARCHITECTURE.md`. Headline findings:

- **Stack versions verified directly** (not assumed): Next.js 16.4.4, React 19.3.0, Prisma 6.19.x, Node ≥20.9.
- **No deployment configuration exists in the repository** — no `Dockerfile`, no `vercel.json`, no platform-specific config of any kind. This milestone did not add one (no hosting decision has been communicated, and the spec warns against assuming infrastructure that hasn't been confirmed), but documented a concrete, platform-agnostic deployment procedure (`DEPLOYMENT-RUNBOOK.md`) so this is no longer undocumented, even though it remains unconfigured.
- **Single-process deployment model confirmed as a deliberate, already-documented decision** (not an oversight) — with two real consequences flagged for whoever deploys this: the login rate limiter is in-process memory only, and the two "scheduled" scripts need an external cron wired up (neither runs on its own).
- **Two repository-integrity findings that are not application code at all** — a prompt-injection-shaped instruction file (`Object Storage.md`) and an unreviewed Next.js telemetry flag (`experimental.agentFeedback`) — both detailed in `SECURITY-REVIEW.md` §0 and neither acted upon; both require a Willsgrove decision, not a sandbox fix.

## 3. Production architecture — environment separation, hosting assumptions

Covered in `PRODUCTION-ARCHITECTURE.md` §4–9. No Kubernetes, message broker, Redis, or second database was introduced — nothing found during this audit demonstrated a requirement for any of them at Willsgrove's current scale. File storage is local-disk only, which is a real hosting-decision dependency (ephemeral hosts would lose uploaded documents on redeploy) flagged for Willsgrove to confirm against its eventual host, not resolved unilaterally.

## 4. Security audit

Full detail: `docs/production/SECURITY-REVIEW.md`. Headline results:

- **Authentication** (§4.1): bcrypt (cost 12) password hashing, never plaintext or custom crypto; DB-backed, re-verified-on-every-request sessions with real revocation; cookies correctly flagged `HttpOnly`/`Secure`-in-production/`SameSite=Lax`; documented, self-aware single-process rate limiting. No invented guarantee (no MFA/SSO claimed, because none exists).
- **Authorisation** (§4.2): of 156 API routes, 154 call a verified server-side auth check (the two exceptions are the login route and the public health endpoint, both correctly so); every `page.tsx` without a direct check was confirmed to be a client shell that gets its data exclusively from an authenticated API route. One consistently-applied, self-disclosed, non-bug scope decision was found (any authenticated internal user can download any order's/claim's attached documents, regardless of role) and is recorded in the acceptance matrix (§16) as requiring a Willsgrove business-policy decision, not silently changed.
- **Input validation** (§4.3): zod schemas for complex input, consistent inline type/shape guards elsewhere; no unvalidated route found in a representative sample; no raw SQL string built from request input anywhere.
- **CSRF/browser security** (§4.4): CSRF origin-check confirmed fail-closed. **A real, now-fixed gap:** before this milestone, the only security header anywhere in the app was a per-route `nosniff` on file downloads — no site-wide clickjacking, MIME-sniffing, referrer, or CSP baseline existed at all. Fixed with a global, verified-safe header policy in `next.config.ts` (confirmed via a live `next dev` smoke test: headers present, `/login` renders correctly).
- **File uploads/downloads** (§4.5): byte-based content sniffing (never trusts the client's claimed MIME type), server-generated UUID storage keys with double path-traversal protection, storage root enforced outside the project tree, SHA-256 checksums, enforced size caps, and correct orphaned-file cleanup on a failed write. All confirmed by direct code read, not assumed.
- **Secrets** (§4.6): no hardcoded secret found in any file; every environment variable actually used by the code is documented in `.env.example`, and nothing undocumented was found; error-message redaction verified in both integration config modules. Git history itself could not be scanned (this working copy has no `.git`), so a history-aware secret scan is recommended before go-live rather than claimed as done.

## 5. Database migration and integrity review

Full detail: `docs/production/DATABASE-BACKUP-AND-RECOVERY.md` §1. **The most significant finding of this milestone:** an out-of-order migration (`20261110140630_add_invoice_reconciliation`) altered a column on a table (`SapInvoiceLine`) that a later migration, by timestamp, actually creates — meaning a fresh `prisma migrate deploy` would fail outright on any database that has never had these migrations applied. It also would have regressed that column's type from `TIMESTAMPTZ(6)` (correct, matches every other timestamp column in the schema) to `TIMESTAMP(3)` had it somehow run. This was leftover dead-migration cruft from Milestone 5's own draft iteration, not something this milestone introduced, and — as far as this audit can determine — has never been applied to any real database (every environment in this project's history has had `prisma generate`/`migrate deploy` network-blocked, confirmed again this round). **Fixed: the dead migration file was deleted.** A mandatory pre-deployment verification step (`prisma migrate status` against the real target database, checked before trusting this fix) is documented, because this audit cannot know for certain no real database anywhere has ever had that specific migration applied. An automated ordering check was then run across all 19 remaining migrations: zero further issues found. Zero other dropped columns/tables beyond one very early (pre-Milestone-0) column drop; FK `ON DELETE` behaviour confirmed consistent throughout; the Milestone 15 recommendation tables were read in full and found correctly additive, indexed, and honestly self-disclosed as never having been applied to a live database.

## 6. Environment configuration

Full detail: `docs/production/PRODUCTION-ENVIRONMENT.md`. Every mandatory variable's missing-value behaviour was verified directly in code: `AUTH_SECRET`, `APP_BASE_URL`, `STORAGE_LOCAL_DIR`, `SEED_ADMIN_EMAIL`/`PASSWORD`, and `DATABASE_URL` all either throw explicitly or fail closed — none silently falls back to an insecure default. The three integration kill-switches (`SAP_B1_PROVIDER`, `CHANNEL_EMAIL_PROVIDER`, `CHANNEL_WHATSAPP_PROVIDER`) correctly default to the safe mock mode. A full cross-reference of every `process.env.X` read in the codebase against `.env.example` found zero undocumented variables in either direction.

## 7. SAP and communication-channel integration status

**SAP Business One (Milestone 9) and email/WhatsApp channels (Milestone 10) are code-complete but not live-verified** — exactly as every prior milestone has honestly stated, re-confirmed by direct code read of `lib/integrations/sap/config.ts` and `lib/channels/config.ts` this round. Both use a correct two-gate design (an environment-variable kill switch that only activates on the literal value `"live"`, plus a complete set of real credentials, both required) and redact credentials from every error message before it is ever persisted or displayed. No real SAP, email, or WhatsApp credential has ever been supplied to this project. This milestone did not fabricate or claim a live connection for any of the three.

## 8. Reliability and error handling

A representative sample of the reporting layer (the area the spec specifically flagged — `decision-intelligence-queries.ts`, `product-revenue-queries.ts`, `attribution-queries.ts`, `product-commercial-health-queries.ts`) was checked for the N+1 query anti-pattern using an automated loop-plus-await scan. **Zero genuine N+1 patterns were found** — every loop that initially looked suspicious resolved to an in-memory aggregation over an already-batch-fetched result set (the consistent `findMany({ where: { in: [...] } })` + `Map`-join pattern used throughout this codebase). Document-upload failure handling was confirmed to clean up orphaned files on a failed database write; file-download handling was confirmed to fail cleanly (404, logged server-side) rather than crash when a referenced file is missing from disk. Multi-step mutations sampled (order-document upload, user creation) were confirmed to use `prisma.$transaction` where more than one write must succeed or fail together.

## 9. Logging and monitoring

Before this milestone: `console.error` only, plus a single basic health route. **Added this milestone:** `GET /api/health/live` (new — a true liveness check with zero database dependency, so an operator can tell "the process is wedged" apart from "the database is unreachable") and an extension to the existing `GET /api/health` (readiness) to surface a version/build-id/environment indicator, reusing a new small `lib/app-info.ts` helper. Both were verified against a running `next dev` instance (`/api/health/live` returns 200 with no database; `/api/health` correctly attempts the DB check and fails in this sandbox only because of the already-documented missing-Prisma-client sandbox limitation, not a code defect). Neither endpoint discloses a credential, connection string, or internal configuration detail — confirmed by reading both handlers directly. No external log aggregation or APM was added — judged to be infrastructure beyond what this milestone's spec authorises without a demonstrated requirement; recorded as a recommendation in `OPERATIONS-HANDBOOK.md`, not implemented speculatively.

## 10. Performance and scalability

See §8 above for the N+1 check. Indexing was spot-checked across several migrations (including the Milestone 15 tables specifically) and found consistently applied on foreign keys and frequently-filtered columns. No caching infrastructure was added (no measurable requirement was demonstrated — the spec explicitly asks not to add one speculatively). No load test was run and no load-test result is claimed; this sandbox has no live database to generate real load against, and inventing a number would violate the spec's explicit instruction not to invent load-test results.

## 11. Build, dependency, and code-quality audit — exact, honest results

| Check | Result |
|---|---|
| `npm install` | 547 packages installed; `npm audit` reports 13 vulnerabilities across 3 transitive dependency chains: `deepmerge-ts <8.0.0` (HIGH, via `@prisma/config`→`prisma`; fix requires a Prisma 7.x major upgrade), `minimatch 7.0.0–11.0.0` (MODERATE, via `@typescript-eslint/*`→`eslint-config-next`; fix requires `eslint-config-next@15.5.29`), `uuid <11.1.1` (MODERATE, via `exceljs`; fix requires `exceljs@3.4.0`). All three require a breaking major-version change to a dependency this project did not choose to upgrade this round, per the spec's own "do not replace the existing stack without strong evidence" instruction — recorded here as a documented, tracked risk rather than force-upgraded blind. |
| `npx eslint .` | **Clean** (exit 0), both before and after every change made this milestone. |
| `npx tsc --noEmit` | **674 errors — exact category-for-category, and after investigation file-for-file, match to the Milestone 15 delivery report's own documented baseline** (`TS7006=420, TS2694=108, TS2339=87, TS2305=38, TS2345=9, TS2322=9, TS18046=3`). This number was reached in two stages, both investigated rather than dismissed, per the spec's explicit instruction: first, fixing the genuinely broken `getProductById` reference (above) raised the count to 704 by un-masking real, previously-hidden type errors that the broken reference had been suppressing — all 30 of which traced to the second pre-existing defect (the stale `ReportFilters` type); fixing that collapsed the count back to exactly 674, matching the documented M15 baseline byte-for-byte in category breakdown. The remaining 9 `TS2322`/9 `TS2345` errors were individually confirmed, by file, to be the identical pre-existing M11–M14 issues M15's own delivery report already named (`customer-insights-queries.ts`, `product-demand-queries.ts`, `product-insights-queries.ts`, `product-revenue-queries.ts`, `sales-performance.ts`, `match-invoice.ts`, `price-list-import.ts`, `quotations/create.ts`) — none in any file this milestone added or touched. |
| `npx vitest run` | **875 passed / 158 skipped / 0 failed** — identical to the M15-documented final state, confirming the repository's actual behavior now matches what every prior delivery report claimed, after the two genuine defects above were fixed. |
| `npx prisma validate` / `generate` | Blocked by the same sandbox network restriction documented since Milestone 4: `Failed to fetch sha256 checksum at https://binaries.prisma.sh/.../libquery_engine.so.node.sha256 - 403 Forbidden`. Re-confirmed this round with a placeholder `DATABASE_URL` set specifically to get past the config-loading step and reach this exact, reproducible error. |
| `npm run build` (`next build`) | Fails at the identical, pre-existing `next/font/google` network wall (`Failed to fetch Geist from Google Fonts`) documented in every milestone since M11 — confirmed, this round, to be unrelated to any file this milestone touched, and to be exactly the kind of build-time external dependency flagged as a production-readiness risk in `DEPLOYMENT-RUNBOOK.md` §4 (a normal CI environment with internet access will not hit this; an air-gapped one would need `next/font/local` instead). |

**Genuine defects found and fixed this milestone** (beyond the two repository-state issues already described above):
1. `lib/reporting/types.ts`'s `ReportFilters` type was missing 8 fields that `lib/reporting/filters.ts`'s `parseReportFilters` and five other consuming files already correctly used — fixed by adding them, then verifying every object literal across the codebase that constructs a `ReportFilters` value (13 files: `app/page.tsx`, `app/reports/page.tsx`, 8 `app/reports/*/page.tsx` pages, `app/products/[id]/page.tsx`, `app/customers/[id]/page.tsx`, and 4 test files) was updated to include the same fields, restoring a clean, fully-typed `tsc` run.
2. The out-of-order migration (§5).
3. The missing `getProductById` function (above).
4. No site-wide HTTP security headers (§4/`SECURITY-REVIEW.md` §4).
5. No true liveness check, no build/version indicator on the health endpoint (§9).
6. A real, unreviewed data-sharing telemetry flag (§1/`SECURITY-REVIEW.md` §0).

**Nothing was weakened to pass a check.** No test was deleted, no compiler setting was loosened, and no check was skipped to make a number look better — every fix above is a positive change (added a missing function, added missing type fields, removed a broken migration, added headers/endpoints), confirmed by the error counts only ever going down for genuine issues and never by suppressing a check.

## 12. Demo and production data safety

`scripts/remove-demo-data.ts` was read in full: every demo-flagged table is deleted in an FK-dependency-correct order inside one transaction, with the Milestone 15 recommendation tables' cleanup block (a gap M15 itself found and fixed) confirmed present in this repository copy. `prisma/seed.ts` was confirmed to hash the admin password properly and to never log the password itself (only the email and generated user id). No code path was found that could cause production to accidentally seed demo data or run the destructive cleanup script automatically — both are explicit, manually-invoked `npm run` commands, never triggered by application code. **This destructive script has never been run against a real database** (same sandbox limitation as every migration) — `OPERATIONS-HANDBOOK.md` §10 flags its first real run as a reviewed event, not a routine one.

## 13. User acceptance testing

A complete plan with role-specific scenarios (Administrator, Sales Manager, Salesperson) and three end-to-end business scenarios: `docs/production/USER-ACCEPTANCE-TESTING.md`. Not executed in this sandbox (no live database/staging environment exists here) — delivered as the ready-to-run plan for Willsgrove's own staging pass.

## 14. Operations documentation and handover

`docs/production/OPERATIONS-HANDBOOK.md` — written for a competent IT administrator, not only the original developer, covering architecture, starting the app, user management, database operations, scheduled jobs, integration troubleshooting, and demo-data safety, pointing to the more detailed documents rather than duplicating them.

## 15. Deployment and rollback

`docs/production/DEPLOYMENT-RUNBOOK.md` and `docs/production/ROLLBACK-AND-INCIDENT-RESPONSE.md`. The critical point made explicit in both: every migration in this project is additive, so the previous application version remains compatible with a newly-migrated schema, which is what makes a same-direction code rollback safe today — but rolling back code never automatically reverses a migration, and that is called out as a standing principle for any future migration that isn't purely additive. **No deployment to any real environment was performed or attempted** — this milestone implemented and documented within the supplied repository only, per its own explicit authorization boundary.

## 16. Acceptance matrix and final verdict

| # | Requirement | Evidence | Result | Severity | Outstanding action | Owner |
|---|---|---|---|---|---|---|
| 1 | Password hashing / session management | `SECURITY-REVIEW.md` §1 | PASS | — | — | — |
| 2 | Server-side authorisation on every sensitive route | `SECURITY-REVIEW.md` §2 (154/156 routes verified) | PASS | — | Decide the per-record document-access policy (any authenticated staff vs. restricted) | Willsgrove management |
| 3 | Input validation | `SECURITY-REVIEW.md` §3 | PASS (representative sample) | — | — | — |
| 4 | CSRF / browser security headers | `SECURITY-REVIEW.md` §4 | PASS (fixed this milestone) | — | Verify a stricter nonce-based CSP against a real `next build` before tightening further | Whoever has a build environment with internet access |
| 5 | File upload/download safety | `SECURITY-REVIEW.md` §5 | PASS | — | — | — |
| 6 | No committed secrets | `SECURITY-REVIEW.md` §6 | PASS (current files); NOT TESTED (git history) | — | Run a history-aware secret scanner against the real repository | Whoever holds the real git history |
| 7 | Database migrations correct and safe | `DATABASE-BACKUP-AND-RECOVERY.md` §1 | PASS (fixed this milestone) | CRITICAL (as found) → resolved | Run `prisma migrate status` against the real target database before first deploy, per the mandatory check | Whoever runs the first real deploy |
| 8 | Backup and recovery configured and verified | `DATABASE-BACKUP-AND-RECOVERY.md` §3 | NOT TESTED — no live database exists in this sandbox | HIGH | Configure backups, verify a restore against a separate database, before go-live | Database/hosting administrator |
| 9 | Environment configuration documented, fails safe | `PRODUCTION-ENVIRONMENT.md` | PASS | — | — | — |
| 10 | SAP / channel integration status honestly reported | §7 above | PASS (mock-only, honestly reported) | — | Supply real credentials only when Willsgrove is ready to go live with a specific integration | Willsgrove / SAP admin |
| 11 | Reliability / error handling | §8 above | PASS (representative sample) | — | — | — |
| 12 | Logging / monitoring / health endpoint | §9 above | PASS (fixed/extended this milestone) | — | Consider external log aggregation if operational volume grows | Willsgrove, when/if needed |
| 13 | Performance / scalability | §10 above | PASS (no N+1 found; no load test performed) | — | Run a real load test against staging before a high-volume go-live, if expected | Whoever has a staging environment |
| 14 | Build / dependency / code quality | §11 above | PASS (674/674 baseline match; eslint clean; vitest 875/0/158) | — | Decide whether to force the 3 dependency-vulnerability upgrades (breaking changes) or accept as documented risk | Willsgrove / engineering owner |
| 15 | Demo/production data separation | §12 above | PASS | — | Treat the first real run of `remove-demo-data.ts` as a reviewed event | Database administrator |
| 16 | UAT plan complete | `USER-ACCEPTANCE-TESTING.md` | PASS (plan delivered; NOT EXECUTED — no staging environment in this sandbox) | — | Execute the plan against real staging before go-live | Willsgrove UAT team |
| 17 | Operations handbook / deployment runbook / rollback plan | §14/§15 above | PASS | — | Fill in the real on-call/escalation contacts | Willsgrove |
| 18 | Repository-integrity: `Object Storage.md` instruction file | `SECURITY-REVIEW.md` §0 | FOUND, not executed, not removed from the repository by this milestone (reported only) | MEDIUM | Delete the file from the real repository; confirm no prior session acted on it; rotate anything if it did | Willsgrove |
| 19 | Repository-integrity: `experimental.agentFeedback` telemetry flag | `SECURITY-REVIEW.md` §0 | FIXED this milestone (disabled) | MEDIUM | Confirm Willsgrove does not want this re-enabled without an explicit data-governance review | Willsgrove management |

**No critical security, data-integrity, or recovery issue remains hidden behind an overall percentage.** The one CRITICAL-severity finding (the migration ordering defect) was found and fixed within this milestone, with an explicit, mandatory human-verification step attached to it rather than declared unconditionally safe. Every other outstanding item above is either a HIGH-severity item that genuinely requires Willsgrove's own infrastructure/credentials/access (backup configuration and a real restore test — this sandbox has no live database to configure or restore), or a MEDIUM/decision-level item requiring a business or governance choice this sandbox cannot make on Willsgrove's behalf.

## Final status: **READY AFTER LISTED CONDITIONS**

The application itself — its code, its security posture, its migration set, its test suite — is in a verified, evidence-backed state and contains no known unresolved application defect. It is **not** declared `READY FOR CONTROLLED GO-LIVE` outright because three categories of precondition genuinely cannot be satisfied inside this sandbox and must be completed against Willsgrove's real infrastructure first:

1. **Backup and recovery must be configured and a restore actually tested** (acceptance-matrix item 8) — no live database exists here to configure or test against.
2. **UAT must be executed against a real staging environment** (item 16) — the plan is ready; it has not been run.
3. **The two repository-integrity findings (items 18–19) and the per-record document-access policy (item 2) need an explicit Willsgrove decision**, not a sandbox fix.

Once those three categories are closed, this becomes `READY FOR CONTROLLED GO-LIVE` with no further code work implied by this audit. None of the three requires new feature work — they require access, infrastructure, and decisions this sandbox does not have.
