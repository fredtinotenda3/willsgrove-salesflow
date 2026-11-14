# Security Review — Milestone 16 (Production Readiness & Go-live)

Scope: a direct code audit of authentication, authorisation, input validation, CSRF/browser security, file uploads/downloads, and secrets handling, against the repository supplied for this milestone. Every claim below is backed by a specific file and line reference checked during this round — nothing here is inferred from a prior milestone's delivery report alone (per this milestone's own explicit instruction not to treat earlier reports as proof of anything). Where a finding could not be exercised against a real environment (no live database, no network egress — see `docs/production/PRODUCTION-ARCHITECTURE.md` §7), that limitation is stated, not glossed over.

## 0. Repository-integrity findings (read this first)

Two items in the repository this milestone started from are **not application functionality** and need a decision from Willsgrove before go-live, independent of everything else in this document:

1. **`Object Storage.md` (repo root, removed from the delivery — see below).** Its content was not documentation; it was a first-person instruction block directed at an AI coding assistant, telling it to install the Neon CLI, link a specific external Neon project (`winter-boat-28858934`), provision an object-storage bucket, and pull live credentials into `.env.local`. This milestone did not execute any of it. **Recommendation:** delete this file from the real repository (it is not referenced by any code path) and confirm no prior session ever acted on it — if one did, the linked Neon project and any credentials it pulled down should be treated as exposed and rotated/revoked.
2. **`next.config.ts`'s `experimental.agentFeedback: true` flag (now disabled — see `CHANGES.md`).** This is a genuine Next.js 16.4.4 feature (`node_modules/next/dist/server/lib/generate-agent-files.js`), not a forgery, but its effect is to make `next dev` write an `AGENTS.md` file at the repo root containing instructions aimed at AI coding assistants — including a step that runs `next internal agent-feedback-instructions` and reports "anonymized" facts about the current coding session back to Next.js/Vercel. There is no record of Willsgrove management reviewing or approving sending any telemetry about this application to a third party. This milestone disabled the flag and removed the generated `AGENTS.md`; re-enabling it is a data-governance decision for Willsgrove to make explicitly, not an inherited default. Neither instruction file was obeyed in either case — both are reported here as findings, not actions taken on your behalf.

Both items are also recorded in the acceptance matrix (`docs/milestones/MILESTONE-16-DELIVERY-REPORT.md` §16) as OUTSTANDING ACTIONs for Willsgrove, not blockers this sandbox can resolve on its own.

## 1. Authentication (spec §4.1)

| Control | Implementation | Evidence |
|---|---|---|
| Password hashing | bcryptjs, cost factor 12. Never plaintext, never a custom cipher. | `lib/auth/password.ts` |
| Password strength | Minimum 10 characters, rejects a short list of trivially-guessable values. Deliberately length-first rather than a composition rule. | `lib/auth/password.ts: checkPasswordStrength` |
| Session mechanism | DB-backed `Session` row + a signed JWT (HS256, `AUTH_SECRET`) cookie carrying only the session id. The signature makes the cookie unforgeable; nothing secret is stored in the database, so a DB read alone can never mint a valid cookie. | `lib/auth/session.ts` |
| Session verification | Re-checked against the database on **every** request — signature, expiry, `revokedAt`, and the user's current `status` are all re-read live, never cached. A revoked session or a deactivated account stops working on the very next request, not after a cache window. | `lib/auth/session.ts: resolveSession` |
| Session expiry | 12 hours, fixed. | `lib/auth/session.ts: SESSION_LIFETIME_MS` |
| Session revocation | `revokeSession` (logout), `revokeAllSessionsForUser` (used on account deactivation — see `lib/users.ts: revokeSessionsIfDeactivated`, confirmed wired into the user-status-change path). | `lib/auth/session.ts`, `lib/users.ts` |
| Cookie attributes | `HttpOnly`; `Secure` forced on when `NODE_ENV=production`; `SameSite=Lax`; path `/`. | `lib/auth/cookies.ts` |
| First-login password change | `mustChangePassword` flag set on every admin-created user; enforced client-side redirect to `/change-password` (`app/change-password/page.tsx`), checked against the live session via `/api/auth/session`. | `lib/users.ts`, `app/change-password/page.tsx` |
| Account activation/deactivation | Admin-only mutation (`app/api/users/[id]/route.ts`, `requireUserOrResponse(["ADMINISTRATOR"])`); deactivation revokes every active session for that user immediately. | `app/api/users/[id]/route.ts`, `lib/users.ts` |
| Brute-force protection | In-memory sliding-window rate limiter, 8 attempts per 10 minutes per (IP, email) pair, applied to login. **Explicitly documented in the code itself as valid only for a single Node.js process** — if this app is ever deployed behind more than one instance, this must move to a shared store (Postgres table or Redis) or it silently stops limiting anything. This is a genuine, self-aware constraint, not an oversight — see §2 of `PRODUCTION-ARCHITECTURE.md` for the single-process deployment assumption this depends on. | `lib/auth/rate-limit.ts` |
| Login error handling | Generic "invalid credentials" response; no user-enumeration signal found in the login route. | `app/api/auth/login/route.ts` |

No invented security guarantee was found or added here (e.g. no claim of MFA, SSO, or account lockout policy, none of which exist in this codebase).

## 2. Authorisation (spec §4.2)

**Method:** every route handler under `app/api/**/route.ts` (156 files) and every `app/**/page.tsx` server component (62 files) was mechanically checked for a call into the one real authorisation boundary, `lib/auth/current-user.ts`'s `requireUser`/`requireUserOrResponse`/`getCurrentUser`/`getCurrentSession`, or a named wrapper around it (`lib/reporting/access.ts`'s `requireManagementReportAccess`).

**Result:** of 156 API route files, **154** call a verified server-side auth check. The two that do not are `app/api/auth/login/route.ts` (must be reachable signed-out) and `app/api/health/route.ts` (deliberately public, see §9 of `PRODUCTION-ARCHITECTURE.md` — it discloses DB-connectivity status only, never credentials or configuration). Inbound webhook routes (`app/api/channels/{email,whatsapp}/webhook/route.ts`) use a separate, correct boundary — a shared-secret signature check that fails closed with `503` when the relevant `*_WEBHOOK_SECRET` env var is unset, never an "accept unsigned" mode.

Of the 18 `page.tsx` files with no direct `getCurrentUser()` call, every one is a `"use client"` shell that renders no server-fetched data of its own and gets all of its data from an authenticated API route (confirmed by spot-checking `app/orders/page.tsx`, `app/products/page.tsx`, `app/customers/page.tsx`, `app/settings/page.tsx`, `app/change-password/page.tsx`). This is a sound pattern **as long as** `proxy.ts`'s optimistic redirect keeps covering these paths (it does — its matcher excludes only `/login`, `/api/*`, and static assets) and every API route those pages call enforces its own check (confirmed). `proxy.ts` itself is explicit in its own comment that it is not the security boundary — a documented, correct understanding of the 2025 Next.js middleware-bypass disclosure, not an invented guarantee.

Role-gated mutations were spot-checked end to end: `POST /api/users` (create user) and `PATCH /api/users/[id]` (status/role change) both require `ADMINISTRATOR`, re-verified server-side, never only via a hidden UI control. `listUsers()`'s `select` was checked and confirmed to never return `passwordHash`.

**Known, self-disclosed scope decision (not a bug):** `app/api/orders/[id]/documents` (upload), `app/api/files/[id]` (download), `app/api/invoice-claims/attachments/[id]`, `app/api/channels/intake/[id]/attachments/[attachmentId]`, and the handover/dispatch download routes all require only *authentication*, not a per-record ownership check — any signed-in internal user (any of the three roles) can download any order's or claim's attached documents. This is consistently applied (same pattern, same honest in-code comment, across every one of these routes — not an inconsistency), and the exposure is bounded to authenticated internal staff, never anonymous or external. It is recorded as an **ACCEPTED-RISK / OUTSTANDING ACTION** item in the acceptance matrix rather than silently changed, because narrowing it to "only this order's own salesperson" is a business-policy decision (this milestone's spec explicitly forbids inventing one) that could just as easily break a legitimate "cover for a colleague" workflow if assumed incorrectly.

"Client-side hidden buttons are not security controls" was checked directly: every role-conditional UI element found (e.g. `app/settings/page.tsx`'s `isAdmin` flag) gates only what renders, never what the underlying API accepts — confirmed by the `app/api/users` route pair above enforcing the same restriction server-side independently of what the client sent.

## 3. Input validation (spec §4.3)

Two consistent, deliberate validation patterns were found across the codebase (156 routes sampled by pattern, ~20 read directly):

1. **Zod schemas** for structurally complex input (`createUserSchema`, `updateDecisionRecommendationStatusSchema`, etc. — 16 files import `zod` directly).
2. **Inline shape/type guards** (`typeof x !== "string"`, `isValidId(x)`, `.trim() === ""`) for simpler mutations — found in every one of the 14 routes sampled that do not import `zod` (e.g. `app/api/po-intake/route.ts`, `app/api/customers/route.ts` via `lib/customer-validation.ts`'s hand-rolled `validateCreateCustomer`, `app/api/invoice-reconciliation/lines/[id]/match/route.ts`). No route sampled was found accepting a request body with no validation at all.

`isValidId` (`lib/http.ts`) is used consistently to reject malformed path-parameter ids before they ever reach a Prisma query, which is the project's actual defence against ID-shaped injection/IDOR probing rather than relying on Prisma's parameterisation alone. SQL injection risk is low by construction — no file in `lib/` or `app/` builds a raw SQL string from request input (`prisma.$queryRaw` appears only in `app/api/health/route.ts`, with a fixed literal `SELECT 1`, no interpolation).

This was a representative, risk-based review (156 routes exist; roughly 20 were read in full), not an exhaustive line-by-line audit of every handler. No unvalidated route was found in the sample.

## 4. CSRF and browser security (spec §4.4)

- **CSRF:** `lib/auth/csrf.ts`'s `verifyCsrfOrigin` checks the `Origin` header (falling back to `Referer`) against `APP_BASE_URL` on every mutating route sampled, as a second layer on top of the session cookie's `SameSite=Lax`. It **fails closed** when `APP_BASE_URL` is unset — a missing config value is treated as a security failure, not an excuse to skip the check. This is a correct, honestly-scoped implementation; it is not claimed to replace `SameSite`, only to add defence in depth against its known browser-specific exceptions.
- **Security headers:** before this milestone, the only security header anywhere in the codebase was a per-route `X-Content-Type-Options: nosniff` on the four file-download routes — there was **no site-wide clickjacking, MIME-sniffing, referrer, or permissions baseline at all**. This milestone added one, globally, via `next.config.ts`'s `headers()` function (applies to every response, independent of the app's Cache Components config):
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains`
  - `Content-Security-Policy`: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`

  **Honest limitation, stated rather than hidden:** the CSP above is a non-breaking baseline (`'unsafe-inline'` on script/style), chosen because this sandbox cannot run a full `next build` (see §11) to validate a stricter, nonce-based CSP against Next's own hydration script and `next/font/google` usage without risking a silent production breakage. It was verified against `next dev` (headers confirmed present via `curl`; `/login` rendered correctly, 200 OK, full page body). **Recommendation before go-live:** run a real `next build && next start` in an environment with normal internet access and attempt to tighten `script-src`/`style-src` to a nonce-based policy; this was not attempted here because it could not be verified end to end in this sandbox.
- **Clickjacking** is now covered twice (`X-Frame-Options: DENY` and `frame-ancestors 'none'`).

Nothing already in place was weakened to make this change easier — the per-route `nosniff` headers were left as-is, and the new global policy adds to them.

## 5. File uploads and downloads (spec §4.5)

`lib/storage/` (reviewed in full: `content-sniff.ts`, `local-disk-driver.ts`, `index.ts`, `types.ts`):

- **Content-type validation is byte-based, not trust-based.** `sniffContentType` reads magic bytes (PDF/JPEG/PNG/zip-container signatures, plus a strict UTF-8-decode check for text) and `validateUploadContent` cross-checks the claimed MIME type against what the bytes actually are — the client's `Content-Type` header is never trusted on its own.
- **Storage keys are server-generated UUIDs**, never derived from the caller's filename — this is what rules out path traversal, not a blocklist. A second, independent guard (`keyToAbsolutePath`) additionally verifies the resolved path never escapes the configured storage root, and a regex shape-check rejects any key not matching the exact `<4 hex>/<uuid>.bin` pattern.
- **Storage lives outside the project tree** (`STORAGE_LOCAL_DIR`, required to be an absolute path outside the repo; the driver throws at startup if unset — fails safe, not an insecure default).
- **Checksums:** SHA-256 computed on every upload and stored (`OrderDocument.checksum`), giving tamper/corruption detection for later verification, though no process currently re-verifies it on read (recorded as a LOW-severity enhancement opportunity, not a defect).
- **Size limits:** spot-checked on `app/api/orders/[id]/documents/route.ts` — a 20 MB cap enforced both on the declared `Content-Length` (cheap early rejection) and on the actual buffered byte count (authoritative). The same cap pattern was confirmed present on the other three upload-accepting routes.
- **Download authorisation:** every file-serving route requires authentication (see §2); the storage key itself never appears in a URL or any client-visible value (downloads are by opaque DB-row id, resolved server-side to a storage key), so there is nothing for a client to guess or tamper with to reach another file directly. The per-record (not just per-authentication) access-control scope decision is the same one already recorded in §2.
- **Storage-failure handling:** `app/api/orders/[id]/documents/route.ts` deletes the just-written file from disk if the subsequent database write fails, so a crashed upload never leaves an orphaned, unreferenced file on disk; `app/api/files/[id]/route.ts` returns a clean 404 (logged server-side for operator visibility) rather than crashing when a DB row references bytes that are missing from disk — a real, already-handled inconsistency case, not a theoretical one.

## 6. Secrets (spec §4.6)

- `.gitignore` excludes `.env*` except the committed `.env.example` template, which was read in full and contains **no real secret** — every value is either empty or an explicit instruction for generating one (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` for `AUTH_SECRET`).
- A pattern scan for hardcoded secret shapes (AWS-style access keys, OpenAI/Anthropic-style `sk-` tokens, PEM private key headers, literal `password = "..."` assignments) across every `.ts`/`.tsx`/`.json` file outside `node_modules` returned **zero matches**.
- Error-message redaction was verified in both integration config modules: `sanitizeSapErrorMessage` (`lib/integrations/sap/config.ts`) and `sanitizeChannelErrorMessage` (`lib/channels/config.ts`) strip the actual credential value, plus a generic `Authorization:`/`Bearer ...` pattern, from any error text before it is persisted to `IntegrationOperation.lastErrorMessage` / `OutboundMessage.lastErrorMessage` or shown in the UI.
- Every environment variable actually read by application code (`lib/`, `app/`, `scripts/`, `prisma/`) is documented in `.env.example` — a full cross-reference found zero undocumented variables (see `docs/production/PRODUCTION-ENVIRONMENT.md`).
- **Stated limitation:** this sandbox has no `.git` history (the working copy is not a git repository — confirmed via the environment itself), so a scan of committed history for a since-removed secret could not be performed here. **Recommendation:** before go-live, run a history-aware secret scanner (e.g. `gitleaks detect` or `trufflehog`) against the real repository's full git history, not just its current file tree.
- No real credential of any kind (SAP, email, WhatsApp, database) was ever supplied to or discovered in this environment — see `docs/production/PRODUCTION-ENVIRONMENT.md` and the integration-status section of the delivery report for what that means for go-live.

## 7. Summary

No CRITICAL security defect was found in the application code itself. One CRITICAL-adjacent finding was in the **database migration set**, not application code (an out-of-order migration that would break a fresh `prisma migrate deploy` — see `docs/production/DATABASE-BACKUP-AND-RECOVERY.md` and the delivery report's acceptance matrix; already fixed). The two repository-integrity findings in §0 require a Willsgrove decision, not a code fix. The authenticated-but-not-per-record document-access scope decision in §2/§5 is recorded as an accepted, consistently-applied risk pending a business-policy decision, not a defect. The CSP in §4 is a verified-safe baseline with an honestly-stated path to a stricter policy that this sandbox cannot validate end to end.
