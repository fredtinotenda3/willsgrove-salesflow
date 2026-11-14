# Production Architecture — Milestone 16

Verified against the actual repository and `package.json` supplied for this milestone, not assumed from any prior delivery report.

## 1. Stack — exact installed versions

| Layer | Package | Version (from `package.json`/`package-lock.json`) |
|---|---|---|
| Framework | `next` | 16.4.4 |
| Runtime | Node.js | `>=20.9.0` (declared in `package.json` `engines`) |
| UI | `react` / `react-dom` | 19.3.0 |
| Database ORM | `@prisma/client` / `prisma` | ^6.19.0 |
| Database | PostgreSQL | (external — see §4; no version pinned by this project beyond standard Postgres SQL features used in migrations) |
| Auth | `jose` (session JWT), `bcryptjs` (password hashing) | ^6.2.15 / ^3.0.3 |
| Validation | `zod` | ^4.6.7 |
| Spreadsheet export | `exceljs` | ^4.4.0 |
| AI (PO extraction) | `@anthropic-ai/sdk` | ^1.6.0 |
| Styling | `tailwindcss` + `@tailwindcss/turbopack` | ^4 |
| Tests | `vitest` | ^4.1.12 |

No version in this table was assumed — all read directly from `package.json`/`package-lock.json` in this milestone's own repository copy.

## 2. Deployment model

This is a **single-process, server-rendered Next.js application** with no background worker, no queue, and no cache layer. That is a deliberate, already-documented decision carried from Milestone 0 (`lib/auth/rate-limit.ts`'s own header comment states it explicitly), not an oversight this milestone is introducing. It has two direct consequences that any deployment plan must respect:

1. **Login rate limiting is in-process memory.** If this app is ever run as more than one Node process (horizontal scaling, multiple serverless instances, a load-balanced pair of VMs), the rate limiter stops being effective — each process has its own counters. Scaling beyond one process requires moving `lib/auth/rate-limit.ts` to a shared store (a Postgres table or Redis) first.
2. **The two "scheduled" scripts (`npm run quotations:expire`, `npm run sap:sync`) have no built-in scheduler.** This is intentional — the spec for this project has always assumed no dedicated background-job infrastructure — but it means **a real deployment must wire these into an OS-level or platform-level scheduler itself**; nothing in the application triggers them on its own. See `docs/production/DEPLOYMENT-RUNBOOK.md` §6 for the exact cron lines.

No Kubernetes, message broker, or additional service was introduced for this milestone, consistent with the spec's explicit instruction not to add infrastructure without a demonstrated requirement. Nothing found during this audit demonstrated a requirement for any of them at Willsgrove's current scale.

## 3. Hosting and deployment configuration — a real gap

**No `Dockerfile`, no `vercel.json`, no platform-specific deployment config of any kind exists in this repository.** This is a genuine finding, not a style preference: whoever deploys this application today has no checked-in record of *how*. `docs/production/DEPLOYMENT-RUNBOOK.md` (new, this milestone) now documents a concrete, platform-agnostic procedure (any host that can run `node` ≥20.9 against a reachable PostgreSQL database), but no container image or platform config was added, because the spec explicitly warns against assuming infrastructure that hasn't been confirmed, and no host decision has been communicated. If Willsgrove has already chosen a host (Vercel, a VPS, a managed Node host), say so and the runbook can be tightened into exact platform steps rather than generic ones.

## 4. Database

- **Engine:** PostgreSQL, via `@prisma/client`. `prisma.config.ts` uses the "classic" engine with `DATABASE_URL` (pooled/application connection) and `DIRECT_URL` (unpooled, for migrations) kept as two separate environment variables — a pattern consistent with a pooled provider such as Neon or RDS Proxy sitting in front of a direct Postgres connection, though no specific provider is hardcoded anywhere in the application.
- **Connection pooling:** `lib/prisma.ts` uses the standard Next.js singleton pattern (one `PrismaClient` per process, cached on `globalThis` outside production) — correct for avoiding connection-pool exhaustion from Next's hot-reload in development. **No explicit `connection_limit`/`pool_timeout` is set on `DATABASE_URL` anywhere in `.env.example`.** For a single always-on Node process (§2) this is low-risk; it becomes a real concern only if this is ever deployed to a serverless/auto-scaling platform where many short-lived function instances could each open their own pool against Postgres simultaneously. **Recommendation:** if Willsgrove's eventual host is serverless, add `?connection_limit=5&pool_timeout=10` (tune to the host's actual concurrency) to `DATABASE_URL`, or front Postgres with a pooler (PgBouncer, or the hosting provider's own pooled connection string) before go-live. Not changed in this milestone because the actual hosting target is unconfirmed and this is a tuning decision, not a defect to silently alter.
- **Migrations:** 19 migrations after this milestone's fix (see `docs/production/DATABASE-BACKUP-AND-RECOVERY.md` §1 and the delivery report's acceptance matrix for the one ordering defect found and corrected). `provider = "postgresql"` confirmed in `prisma/migrations/migration_lock.toml`.

## 5. File storage

Local-disk only (`STORAGE_DRIVER=local`, the only implemented driver — `lib/storage/index.ts` throws a clear error for any other value rather than silently falling back). The storage root must be an absolute path **outside** the project directory (`STORAGE_LOCAL_DIR`), enforced by the driver refusing to start without it. This means **file storage is tied to one host's local disk** — there is no S3/object-storage driver implemented. For a single-VM deployment this is fine as long as that disk is included in the backup plan (see `DATABASE-BACKUP-AND-RECOVERY.md` §4 — uploaded documents are NOT captured by a database-only backup). If Willsgrove's eventual host is ephemeral (containers with no persistent volume, ephemeral serverless filesystem), local-disk storage will silently lose every uploaded document on redeploy/restart — this is a hosting decision Willsgrove needs to make and confirm before go-live, not something this milestone can resolve without knowing the target host.

## 6. Background/scheduled work

See §2. `scripts/expire-quotations.ts` and `scripts/sap-sync.ts` are idempotent, safe to run as often as the schedule likes, and documented in their own header comments as "this script IS the server-side scheduling mechanism" — but nothing runs them automatically. The deployment runbook now gives concrete `cron` lines.

## 7. External integrations

See `docs/production/SECURITY-REVIEW.md` §6 and the delivery report's integration-status section for the full detail. Summary: SAP Business One (Milestone 9) and email/WhatsApp channels (Milestone 10) are **code-complete but not live-verified** — both fail safe to a deterministic mock adapter by a deployment-level environment-variable kill switch (`SAP_B1_PROVIDER`, `CHANNEL_EMAIL_PROVIDER`, `CHANNEL_WHATSAPP_PROVIDER`, each defaulting to mock on any value other than exactly `"live"`), and no real credential for any of the three has ever been supplied to or used in this project. This is accurately reflected in the application's own UI and code comments already — nothing here claims a live connection that doesn't exist.

## 8. Logging and monitoring

Before this milestone: `console.error`/`console.log` only, scattered per-route, plus one basic `GET /api/health` route (DB connectivity check, no credential/config disclosure — already correct). This milestone extended the health endpoint (see `docs/production/OPERATIONS-HANDBOOK.md` §3) with a build/version indicator and an explicit liveness/readiness split, reusing the existing `AuditEvent` system for mutation-level audit trails (already present since Milestone 0 — no second, parallel audit system was created). No centralized log aggregation, APM, or external monitoring service is wired up anywhere in this codebase, and none was added — adding one (e.g. Sentry, Datadog) was judged to be infrastructure beyond what this milestone's spec authorises without a demonstrated requirement, and is recorded as a recommendation in the operations handbook rather than implemented speculatively.

## 9. Environment separation

`NODE_ENV` drives the only environment-conditional behaviour found: the session cookie's `Secure` flag (`lib/auth/cookies.ts`) and Prisma's log verbosity (`lib/prisma.ts`). There is no separate `.env.staging`/`.env.production` file structure in the repository (by design — `.env.local` is git-ignored and environment-specific, which is correct practice), but there is also no checked-in example showing the *difference* between a dev and a production environment's variable set beyond the single `NODE_ENV` line. `docs/production/PRODUCTION-ENVIRONMENT.md` (new, this milestone) is the authoritative reference for every variable, which environments need it, and what happens when it's missing — closing that gap without inventing a new config-file convention the codebase doesn't already have.

## 10. What this milestone did **not** introduce

No Kubernetes manifest, no message broker, no Redis, no second database, no new external service dependency, and no rewrite of any existing module. The only infrastructure-adjacent change made was a global HTTP security-header policy (`next.config.ts`, see `SECURITY-REVIEW.md` §4) and a small extension to the existing health endpoint — both additive, both verified against a running `next dev` instance before being counted as done.
