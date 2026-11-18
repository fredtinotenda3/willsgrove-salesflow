import { PrismaClient } from "@prisma/client";
import { Semaphore, resolveQueryConcurrency } from "./query-concurrency-gate";

/**
 * Workflow/Navigation/Performance round, Part 5: root-cause fix for the
 * reported "Timed out fetching a new connection from the connection
 * pool. Current connection pool timeout: 10, Connection limit: 9" error
 * on the homepage (prisma.lostSaleRecord.groupBy() inside
 * getLostSalesReportSummary() <- getOperationalDashboard() <-
 * getDecisionDashboard() <- Home).
 *
 * INVESTIGATION (per the spec's own checklist):
 *
 * 1-2. lib/prisma.ts / DATABASE_URL: the singleton pattern below is the
 *    standard Next.js one, and .env.example's DATABASE_URL sets no
 *    `connection_limit`/`pool_timeout` -- so Prisma falls back to its
 *    documented default pool size, `num_cpus * 2 + 1`. "Connection
 *    limit: 9" in the reported error is exactly that default on a
 *    4-core machine, not a number anyone configured -- so raising it
 *    would just be masking the real problem with a bigger number that
 *    still runs out under enough concurrency, and Neon's own
 *    server-side connection ceiling (separate from this per-process
 *    pool) means this number can't be raised arbitrarily anyway.
 * 3. Multiple PrismaClient instances: the pre-existing singleton only
 *    cached onto `globalThis` when `NODE_ENV !== "production"`
 *    (guarding against dev/HMR re-instantiation only). In production,
 *    nothing stopped a second module instantiation of this file (e.g.
 *    from Next.js bundling this module separately into more than one
 *    route's server bundle, a documented Next.js/Prisma interaction --
 *    see https://pris.ly/d/help/next-js-best-practices) from silently
 *    creating a SECOND client with its OWN separate 9-connection pool,
 *    compounding the problem below. Fixed: cache unconditionally.
 * 4-7. The dashboard's query orchestration is the actual root cause.
 *    Home -> getDecisionDashboard() fires a 7-way Promise.all, one
 *    member of which is getOperationalDashboard() -- itself its OWN
 *    13-way Promise.all (lib/reporting/operational-dashboard.ts).
 *    Three of those 13 are themselves composite functions
 *    (getQuotationDashboardCounts, getApprovalDashboard,
 *    getLostSalesReportSummary) that each run their OWN internal
 *    Promise.all (getLostSalesReportSummary alone is an 8-way
 *    Promise.all -- lib/lost-sales/queries.ts:658, the exact reported
 *    failure site, landing last in that batch and so the one left
 *    waiting when the pool is already exhausted by everything queued
 *    ahead of it). getDecisionDashboard's other 6 members
 *    (getSalesPipelineReport x2, getFulfilmentIntelligenceReport x2,
 *    getFinancialExposureReport, getLostSalesAnalytics) are themselves
 *    further multi-query Promise.all compositions (sales-pipeline.ts
 *    alone has 7). One homepage load therefore fires on the order of
 *    60-100+ concurrent Prisma calls against a 9-connection pool --
 *    nowhere near a case of "a few queries, pool too small," but an
 *    actual fan-out explosion.
 * 8-9. Nothing here duplicates the SAME aggregate twice for no reason:
 *    the "current" vs "prior" period pairs are genuinely two different
 *    date ranges (needed for the dashboard's period-over-period deltas),
 *    and getOperationalDashboard's own snapshot figures are a separate,
 *    right-now (not date-ranged) composite, not a re-fetch of the
 *    trend/comparison data computed alongside it. Collapsing these
 *    into fewer logical aggregates would risk silently changing
 *    already-tested report output for 10+ existing modules
 *    (lib/reporting/sales-pipeline.ts, fulfilment-intelligence.ts,
 *    financial-exposure.ts, lib/lost-sales/queries.ts,
 *    lib/quotations/queries.ts, lib/approvals/queries.ts and others)
 *    for a problem that isn't actually about redundant work -- it's
 *    about too much REAL work being allowed to hit the database at
 *    once with no ceiling.
 * 10. No query here loads a full dataset where an aggregate would do --
 *    every call in the trace above is already a count/aggregate/groupBy,
 *    never an unbounded findMany.
 * 11. No long-running transaction holds a connection around unrelated
 *    work anywhere in this trace; every call is a single, short,
 *    independent read.
 *
 * FIX: rather than rewriting the internal structure of a dozen already-
 * correct, already-tested reporting modules (each individual Promise.all
 * is a reasonable, intentional design on its own -- the problem is only
 * what happens when many of them run at once), this is fixed at the ONE
 * place every single one of those calls necessarily passes through: the
 * Prisma Client itself. A Prisma Client Extension's `query` component
 * (stable, non-preview API since Prisma 5) wraps every model operation
 * -- find/count/aggregate/groupBy/create/etc., for every model, from
 * every call site in this codebase, present or future -- through a
 * single, process-wide, FIFO concurrency gate: at most
 * DATABASE_QUERY_CONCURRENCY queries (default 6, safely under the
 * reported 9-connection pool, leaving headroom for other concurrent
 * requests/users) are ever in flight against the database at once;
 * every query beyond that queues and runs as soon as a slot frees up,
 * rather than being serialized one-at-a-time (which the spec explicitly
 * warns against as unnecessary degradation) or left uncapped (today's
 * bug). This is "controlled concurrency," not a blind serialization,
 * and it is a single, central, always-applied safeguard rather than
 * something every future new report module has to remember to apply
 * itself.
 *
 * This also means a literal duplicate call for the exact same data
 * within one request (if one is ever introduced later) no longer has
 * the same blast radius -- it waits its turn for a slot rather than
 * adding to an uncapped spike -- though the real fix for that case is
 * still to not issue the duplicate call in the first place.
 *
 * The Semaphore class and resolveQueryConcurrency() themselves live in
 * ./query-concurrency-gate.ts, a pure, @prisma/client-free module, so
 * their concurrency-limiting behavior can be unit-tested directly (see
 * tests/query-concurrency-gate.test.ts) without needing a real database
 * -- this file keeps only the Prisma-specific wiring (the singleton
 * client, the $extends call) that genuinely can't be tested without one.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaQueryGate: Semaphore | undefined;
};

// Always a single instance per process (previously only true outside
// production -- see this file's module comment, point 3).
const basePrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
globalForPrisma.prisma = basePrismaClient;

const queryGate = globalForPrisma.prismaQueryGate ?? new Semaphore(resolveQueryConcurrency());
globalForPrisma.prismaQueryGate = queryGate;

export const prisma = basePrismaClient.$extends({
  name: "query-concurrency-gate",
  query: {
    $allModels: {
      async $allOperations({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) {
        return queryGate.run(() => query(args));
      },
    },
  },
});

/**
 * Part 5 follow-up fix (post-delivery): a known Prisma typing limitation,
 * NOT something this sandbox's stub @prisma/client could ever catch --
 * discovered only once this project was built against a real generated
 * client, where `next build`'s TypeScript pass failed with ~20+ "Argument
 * of type '...DynamicClientExtensionThis<...>...' is not assignable to
 * parameter of type 'TransactionClient'" errors across lib/approvals,
 * lib/invoice-claims, lib/invoice-reconciliation, lib/lost-sales,
 * lib/matching, lib/notifications, lib/orders.ts, lib/quotations,
 * lib/returns-credits, and lib/review.
 *
 * Root cause: this codebase has a long-standing, deliberate pattern (see
 * e.g. lib/invoice-claims/create-claim.ts's own module comment) of helper
 * functions typed `tx: Prisma.TransactionClient` that are called BOTH with
 * a real transaction's `tx` (inside `prisma.$transaction(async (tx) => ...)`)
 * AND directly with the top-level `prisma` export, for call sites that
 * don't need transactional atomicity. This worked because a plain
 * `PrismaClient` instance is always structurally assignable to
 * `Prisma.TransactionClient` (which is literally
 * `Omit<PrismaClient<DefaultArgs>, '$connect' | '$disconnect' | '$on' |
 * '$transaction' | '$extends'>`, generated against the *unextended*
 * default client).
 *
 * The Part 5 fix above wraps `prisma` in `.$extends()` to install the
 * query-concurrency gate. That is correct and necessary -- but it also
 * changes `prisma`'s TYPE from plain `PrismaClient` to
 * `DynamicClientExtensionThis<TypeMap<ExtArgs>, ...>`, parameterized on an
 * extended-args shape. `Prisma.TransactionClient`, generated once against
 * `DefaultArgs`, has no way to know about that extension and is no longer
 * structurally compatible with it -- a documented Prisma limitation
 * whenever `$extends()` is used (prisma/prisma#20738 and similar), not a
 * bug in how the extension itself is written.
 *
 * Fix: derive the "either prisma or tx" parameter type directly from our
 * own `prisma` export instead of from the library's unextended
 * `Prisma.TransactionClient`, so it automatically stays correct for
 * whatever `prisma` actually resolves to. Every call site that already
 * passed `tx` or the bare `prisma` export continues to work unchanged --
 * only the ~16 function declarations' parameter type annotation changes,
 * from `Prisma.TransactionClient` to this `PrismaTransactionClient`.
 */
export type PrismaTransactionClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;
