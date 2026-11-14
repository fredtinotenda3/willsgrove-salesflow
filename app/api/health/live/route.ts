import { getAppInfo } from "@/lib/app-info";

/**
 * Milestone 16 (Production Readiness), spec section 9. LIVENESS check:
 * is the Node process itself up and able to handle a request at all. It
 * deliberately makes NO database call and imports nothing that touches
 * Prisma -- the whole point of separating this from GET /api/health
 * (the readiness check) is that an orchestrator should be able to tell
 * "the process is wedged/crashed, restart it" apart from "the process is
 * fine but its database is temporarily unreachable" (restarting the
 * process would do nothing for the second case). Public, no auth check,
 * same reasoning as /api/health -- and the same information cap: no
 * internal configuration or infrastructure detail, ever.
 */
export async function GET() {
  const info = getAppInfo();

  return Response.json(
    {
      success: true,
      application: "Willsgrove SalesFlow",
      status: "alive",
      version: info.version,
      buildId: info.buildId,
      environment: info.environment,
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
