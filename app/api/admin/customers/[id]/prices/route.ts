import { NextRequest } from "next/server";
import { z } from "zod";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { removeCustomerPrice, setCustomerPrice } from "@/lib/pricing/customer-prices";
import { isValidId } from "@/lib/http";

const idField = z.string().refine(isValidId, "Invalid id.");
const setSchema = z.object({
  productId: idField,
  unitPrice: z.string().trim().min(1, "Enter a unit price.").max(20),
  currencyCode: z.enum(["USD", "ZWG"]).nullish(),
  notes: z.string().trim().max(500).nullish(),
  reason: z.string().trim().max(500).nullish(),
});
const removeSchema = z.object({ productId: idField, reason: z.string().trim().max(500).nullish() });

/** PUT /api/admin/customers/[id]/prices -- set or change ONE customer's price for ONE product. Never touches other customers or the shared price list. */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const customerId = await routeId(context);
  if (!customerId) return invalidId();
  return adminMutation(request, setSchema, async (input, actor) => {
    const result = await setCustomerPrice({ customerId, ...input }, actor.id, "UI");
    return result.ok ? ok({ changed: result.changed, changeType: result.changeType, unitPrice: result.unitPrice, currencyCode: result.currencyCode }) : failure(result);
  });
}

/** DELETE /api/admin/customers/[id]/prices -- remove the override; the customer falls back to their price list. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const customerId = await routeId(context);
  if (!customerId) return invalidId();
  return adminMutation(request, removeSchema, async (input, actor) => {
    const result = await removeCustomerPrice(customerId, input.productId, actor.id, input.reason ?? null, "UI");
    return result.ok ? ok({ removed: result.removed }) : failure(result);
  });
}
