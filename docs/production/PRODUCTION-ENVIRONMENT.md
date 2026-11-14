# Production Environment Variable Reference — Milestone 16

Authoritative reference for every environment variable this application reads. Cross-checked, this milestone, against the actual source (`grep -rhoE "process\.env\.[A-Z_]+" lib app scripts prisma`) — every variable below is actually read somewhere in the codebase, and every variable actually read is listed below; neither list has an entry the other doesn't (`DATABASE_URL`/`DIRECT_URL` are consumed by Prisma itself via `prisma.config.ts`, not via a direct `process.env.X` read in application code, which is why they don't show up in that grep but are still real, required variables).

Template file: `.env.example` (committed, contains no real secret — every value is a placeholder or a generation instruction). Copy it to `.env.local` for local development; a real deployment sets these through its own hosting platform's environment-variable mechanism, never a committed file.

## How the app fails when a mandatory variable is missing

Verified directly in code, not assumed:

| Variable | What happens if missing |
|---|---|
| `DATABASE_URL` | Prisma itself refuses to start; no silent fallback. |
| `AUTH_SECRET` | `lib/auth/session.ts: getAuthSecret()` throws explicitly ("AUTH_SECRET is missing or too short") the first time a session is created or verified — no session can ever be issued or trusted. |
| `APP_BASE_URL` | `lib/auth/csrf.ts: verifyCsrfOrigin()` fails closed — every mutating request is rejected with 403, never silently allowed. |
| `STORAGE_LOCAL_DIR` | `lib/storage/local-disk-driver.ts: resolveRoot()` throws explicitly before any file operation. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | `prisma/seed.ts` throws and refuses to seed — there is no fallback admin account. |
| `SAP_B1_PROVIDER`, `CHANNEL_EMAIL_PROVIDER`, `CHANNEL_WHATSAPP_PROVIDER` | Not an error — these three default to `"mock"` on any value other than exactly `"live"`. This is the intended fail-safe, not a gap. |
| `SAP_B1_PASSWORD`, `CHANNEL_EMAIL_API_KEY`/`CHANNEL_EMAIL_FROM_ADDRESS`, `CHANNEL_WHATSAPP_PHONE_NUMBER_ID`/`CHANNEL_WHATSAPP_ACCESS_TOKEN` | Live mode silently cannot activate even if the provider switch above says `"live"` — `canUseLive*Adapter()` returns `false` and the mock adapter keeps being used. Documented, deliberate fail-safe. |
| `CHANNEL_EMAIL_WEBHOOK_SECRET` / `CHANNEL_WHATSAPP_WEBHOOK_SECRET` | The corresponding inbound webhook route refuses every request with `503` ("...is not configured on this deployment"). There is no "accept unsigned" fallback mode. |
| `ANTHROPIC_API_KEY` | PO-document extraction falls back to the deterministic mock extraction provider — never an error, by design (`EXTRACTION_PROVIDER` can also force this explicitly). |

No mandatory variable was found to silently fall back to an insecure default — every one either throws, fails closed, or has an intentionally-documented safe default (mock mode).

## Full variable reference

### Database

| Variable | Required | Secret | Dev vs. prod | Purpose |
|---|---|---|---|---|
| `DATABASE_URL` | Yes | Yes | Different per environment | Pooled/application Postgres connection string. |
| `DIRECT_URL` | Yes | Yes | Different per environment | Unpooled Postgres connection, used by Prisma for migrations. Can equal `DATABASE_URL` if not using a connection pooler. |

### Auth

| Variable | Required | Secret | Dev vs. prod | Purpose |
|---|---|---|---|---|
| `AUTH_SECRET` | Yes | **Yes — rotating it invalidates every existing session** | Must be unique per environment, never shared between dev and prod | HS256 signing key for the session cookie. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. |
| `APP_BASE_URL` | Yes | No | **Must differ** — the real production URL in production, `http://localhost:3000` in dev | Origin the CSRF check validates `Origin`/`Referer` against. A production deployment with the wrong value here will reject every mutating request. |

### Seed admin (one-time, `prisma/seed.ts` only)

| Variable | Required (to run the seed) | Secret | Purpose |
|---|---|---|---|
| `SEED_ADMIN_EMAIL` | Yes | No | The one administrator account the seed script creates. |
| `SEED_ADMIN_PASSWORD` | Yes | **Yes — treat as a credential even though it is only used once** | Must pass `checkPasswordStrength`. The account has `mustChangePassword=true`, so this only has to work for the very first login. **Do not reuse a password used anywhere else, and remove it from whatever ran the seed command's shell history/CI logs afterward.** |

### File storage

| Variable | Required | Secret | Purpose |
|---|---|---|---|
| `STORAGE_DRIVER` | No (defaults to `"local"`) | No | Only `"local"` is implemented — see `docs/production/PRODUCTION-ARCHITECTURE.md` §5 for what that means for hosting choice. |
| `STORAGE_LOCAL_DIR` | Yes | No (it's a path, not a secret, but it should not be world-readable) | Absolute path **outside** the project directory where uploaded documents are written. Must be backed up — see `DATABASE-BACKUP-AND-RECOVERY.md` §4. |

### PO extraction (Milestone 2A)

| Variable | Required | Secret | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | No | **Yes** | Enables real PDF/image/text PO extraction. Leave blank to run entirely on the deterministic mock provider. |
| `ANTHROPIC_MODEL` | No | No | Defaults to `claude-sonnet-5-5` if unset. |
| `EXTRACTION_PROVIDER` | No | No | Set to `"mock"` to force the mock provider even with a real key set (useful for predictable demos). |

### SAP Business One integration (Milestone 9)

| Variable | Required | Secret | Purpose |
|---|---|---|---|
| `SAP_B1_PROVIDER` | No (defaults to mock) | No | Deployment-level kill switch. Only the exact value `"live"` activates the real adapter, and only together with `IntegrationConnection.mode=LIVE` set in-app by an ADMINISTRATOR — both must agree. |
| `SAP_B1_PASSWORD` | Only for live mode | **Yes** | SAP Service Layer service-account password. Base URL/company DB/username are configured in-app (`/integrations/sap/settings`), never as environment variables — only this one secret lives in the environment. |

### Communication channels (Milestone 10)

| Variable | Required | Secret | Purpose |
|---|---|---|---|
| `CHANNEL_EMAIL_PROVIDER` / `CHANNEL_WHATSAPP_PROVIDER` | No (default mock) | No | Per-channel deployment-level kill switches. |
| `CHANNEL_EMAIL_API_KEY` / `CHANNEL_EMAIL_FROM_ADDRESS` | Only for live email | Key: **yes**. From-address: no. | Postmark/SendGrid-shaped real email credentials. |
| `CHANNEL_WHATSAPP_PHONE_NUMBER_ID` / `CHANNEL_WHATSAPP_ACCESS_TOKEN` | Only for live WhatsApp | Token: **yes**. Phone number id: no. | Meta WhatsApp Business Cloud API credentials. |
| `CHANNEL_EMAIL_WEBHOOK_SECRET` / `CHANNEL_WHATSAPP_WEBHOOK_SECRET` | Required for the corresponding inbound webhook to accept anything at all | **Yes** | Verifies an inbound webhook actually came from the configured provider. `CHANNEL_WHATSAPP_WEBHOOK_SECRET` doubles as the WhatsApp Platform's one-time "verify token." |

### Misc / build

| Variable | Required | Secret | Purpose |
|---|---|---|---|
| `NODE_ENV` | Set by the runtime/host, not usually hand-set | No | `"development"` / `"production"` / `"test"`. Drives the session cookie's `Secure` flag and Prisma log verbosity. |
| `BUILD_ID` / `VERCEL_GIT_COMMIT_SHA` / `SOURCE_VERSION` | No | No | **New in this milestone** (`lib/app-info.ts`). Whichever one the deploy pipeline sets is surfaced on `GET /api/health` and `GET /api/health/live` as a build identifier, so an operator can confirm which build is actually running. Falls back to `"unknown"` — never required, never blocks startup. |

## Environments

There is no checked-in `.env.staging`/`.env.production` — by design, since real environment files must never be committed (`.gitignore` excludes `.env*` except the template). What distinguishes an environment is: a distinct `DATABASE_URL`/`DIRECT_URL`, a distinct `AUTH_SECRET` (never shared with another environment — sharing one means a session token from staging would verify against production), a distinct `APP_BASE_URL` matching that environment's real URL, and `NODE_ENV=production` only on the real production deployment. **Production must never be started with a development `AUTH_SECRET`, a development database, or a development `STORAGE_LOCAL_DIR` — there is no code-level guard against this, so it is a deployment-procedure discipline, documented explicitly in `docs/production/DEPLOYMENT-RUNBOOK.md`.**
