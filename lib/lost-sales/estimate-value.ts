import "server-only";
import { Prisma } from "@prisma/client";
import { multiplyDecimalStrings } from "@/lib/lost-sales/validation";

/**
 * Milestone 4 (Lost-Sales Management).
 *
 * Spec 4.6: "Do not assume the financial value of a lost sale from the
 * warehouse's unavailable quantity alone... Only calculate estimated lost
 * revenue where an appropriate, historically valid selling price is
 * available. Clearly label estimated values as estimates. Do not invent
 * prices."
 *
 * Tries, in order, the two real price sources this codebase already has:
 *
 *   1. OrderLine.approvedUnitPrice -- the price actually agreed for THIS
 *      order's line, when one exists. The most historically valid price
 *      there could possibly be for this specific lost quantity.
 *   2. The customer's assigned PriceList, the most recent entry valid as
 *      of `asOf` for this product (by live productId first, then the
 *      frozen sapItemCodeSnapshot, same fallback order as everywhere else
 *      in this codebase that resolves a product).
 *
 * Returns null -- never a guessed/defaulted price -- when neither
 * resolves. Takes the caller's `tx` and never opens its own transaction,
 * so it's safe to call from inside confirm-lost-sale.ts's transaction.
 */
export type EstimatedLostSaleValue = {
  unitPrice: string;
  value: string;
  source: "ORDER_LINE_APPROVED_PRICE" | "PRICE_LIST_ENTRY";
};

export type ResolveEstimatedLostSaleValueParams = {
  orderLineId: string;
  customerId: string;
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  quantity: string;
  asOf: Date;
};

export async function resolveEstimatedLostSaleValue(
  tx: Prisma.TransactionClient,
  params: ResolveEstimatedLostSaleValueParams
): Promise<EstimatedLostSaleValue | null> {
  const orderLine = await tx.orderLine.findUnique({
    where: { id: params.orderLineId },
    select: { approvedUnitPrice: true },
  });

  if (orderLine?.approvedUnitPrice) {
    const unitPrice = orderLine.approvedUnitPrice.toString();
    const value = multiplyDecimalStrings(unitPrice, params.quantity);
    if (value !== null) {
      return { unitPrice, value, source: "ORDER_LINE_APPROVED_PRICE" };
    }
  }

  const customer = await tx.customer.findUnique({
    where: { id: params.customerId },
    select: { priceListId: true },
  });
  if (!customer?.priceListId) return null;

  const productMatchers: Prisma.PriceListEntryWhereInput[] = [];
  if (params.productId) productMatchers.push({ productId: params.productId });
  if (params.sapItemCodeSnapshot) productMatchers.push({ sapItemCodeSnapshot: params.sapItemCodeSnapshot });
  if (productMatchers.length === 0) return null;

  const entry = await tx.priceListEntry.findFirst({
    where: {
      priceListId: customer.priceListId,
      AND: [
        { OR: productMatchers },
        { validFrom: { lte: params.asOf } },
        { OR: [{ validTo: null }, { validTo: { gte: params.asOf } }] },
      ],
    },
    orderBy: { validFrom: "desc" },
    select: { unitPrice: true },
  });
  if (!entry) return null;

  const unitPrice = entry.unitPrice.toString();
  const value = multiplyDecimalStrings(unitPrice, params.quantity);
  if (value === null) return null;

  return { unitPrice, value, source: "PRICE_LIST_ENTRY" };
}
