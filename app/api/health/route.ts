
import { prisma } from "@/lib/prisma";

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

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return Response.json(
      {
        success: true,
        application: "Willsgrove SalesFlow",
        database: "connected",
        message: "Database connection is healthy.",
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Database health check failed:", error);

    return Response.json(
      {
        success: false,
        application: "Willsgrove SalesFlow",
        database: "disconnected",
        message: "Could not connect to the database.",
      },
      { status: 503 }
    );
  }
}
