
import { prisma } from "@/lib/prisma";
import { getAppInfo } from "@/lib/app-info";

// CORRECTION (see CHANGES.md): an earlier fix added
// `export const dynamic = "force-dynamic"` here to stop this route from
// running at build time. That was wrong on two counts -- Next 16's Cache
// Components model (next.config.ts: cacheComponents: true) rejects the
// legacy `dynamic` route segment config outright ("Route segment config
// 'dynamic' is not compatible with `nextConfig.cacheComponents`"), so it
// doesn't even build; and it wasn't the right fix anyway. Under Cache
// Components, a GET Route Handler is request-time by default and only
// needs an explicit `"use cache"` to opt INTO caching (the inverse of the
// pre-16 model) -- see
// node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md,
// "Route Handlers (GET)". This route's uncached `prisma.$queryRaw` call
// already makes it request-time-only with no config needed at all.
//
// Milestone 16 (Production Readiness), spec section 9: this is the
// READINESS check (can this instance actually serve a real request right
// now, i.e. is the database reachable). It is deliberately public (no
// auth check) so a load balancer/orchestrator/uptime monitor can call it
// without a credential, which is also why its response is capped at
// exactly: a boolean, the app name, a DB connectivity flag, the
// package.json version, an opaque build id (set by the deploy pipeline,
// "unknown" otherwise), the NODE_ENV name, and a timestamp -- never a
// connection string, a stack trace, a row count, or any other internal
// detail. See GET /api/health/live for the separate, DB-independent
// LIVENESS check, and docs/production/OPERATIONS-HANDBOOK.md section 3
// for how an operator is expected to use each one.

export async function GET() {
  const info = getAppInfo();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return Response.json(
      {
        success: true,
        application: "Willsgrove SalesFlow",
        database: "connected",
        message: "Database connection is healthy.",
        version: info.version,
        buildId: info.buildId,
        environment: info.environment,
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Database health check failed:", error);

    return Response.json(
      {
        success: false,
        application: "Willsgrove SalesFlow",
        database: "disconnected",
        message: "Could not connect to the database.",
        version: info.version,
        buildId: info.buildId,
        environment: info.environment,
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
