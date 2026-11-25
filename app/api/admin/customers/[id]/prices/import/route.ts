import { NextRequest } from "next/server";
import { z } from "zod";
import { adminMutation, invalidId, routeId } from "@/lib/admin/route";
import { importCustomerPrices } from "@/lib/pricing/customer-prices";

const schema = z.object({ csv: z.string().min(1, "The file is empty.").max(190000, "File too large; split it."), dryRun: z.boolean().default(true) });

/** POST /api/admin/customers/[id]/prices/import -- CSV import for this customer. dryRun (default) validates only. All-or-nothing. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const customerId = await routeId(context);
  if (!customerId) return invalidId();
  return adminMutation(request, schema, async (input, actor) => {
    const result = await importCustomerPrices(customerId, input.csv, actor.id, input.dryRun);
    return Response.json(result.ok ? { success: true, dryRun: result.dryRun, outcomes: result.outcomes, summary: result.summary } : { success: false, message: result.message, outcomes: result.outcomes }, { status: result.ok ? 200 : result.status });
  });
}
