import "server-only";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";

/**
 * Server-side price-list resolution for order lines.
 *
 * Why this exists: until now an order line only got a price when the
 * browser order form happened to prefill one from /api/price-lists/lookup.
 * Every other way an order can come into being (a confirmed PO-intake
 * review, a converted communication, a quotation conversion, a direct API
 * call) saved lines with no price at all, and the UI then showed "Pending
 * pricing" even though the customer's assigned price list holds a valid
 * price. The server is the only place that can guarantee every path gets
 * the same behaviour, so the resolution lives here and is called from
 * createOrderCore (lib/orders.ts).
 *
 * Rules (each one deliberate):
 *  - Source of truth is the customer's ASSIGNED price list
 *    (Customer.priceListId) -- never another customer's list, never a
 *    "default" list, never a guessed price.
 *  - "Price in effect on `asOf`": validFrom <= asOf and (validTo is null or
 *    validTo >= asOf); newest validFrom wins. Same rule, same product-id-
 *    then-SAP-code matching as resolveCustomerPriceListUnitPrice
 *    (lib/price-list-queries.ts), which this batches rather than replaces.
 *  - It returns prices; it never writes them. The caller stores the
 *    resolved value in OrderLine.customerUnitPrice at order creation, which
 *    IS the historical price snapshot: a later price-list edit or a new
 *    validity period never changes an existing line, because nothing in the
 *    codebase re-resolves a line that already has a price.
 *  - The price list's currency is returned alongside so the caller can
 *    refuse to mix currencies.
 */

export type ResolvedPriceListPrices = {
  priceListId: string | null;
  priceListCode: string | null;
  currencyCode: string | null;
  /** productId -> unit price (decimal string). A product with no price in effect is simply absent. */
  priceByProductId: Map<string, string>;
};

type PriceResolutionClient = Pick<PrismaTransactionClient, "customer" | "product" | "priceListEntry">;

export async function resolveCustomerPriceListPrices(
  client: PriceResolutionClient,
  customerId: string,
  productIds: readonly string[],
  asOf: Date = new Date()
): Promise<ResolvedPriceListPrices> {
  const empty: ResolvedPriceListPrices = { priceListId: null, priceListCode: null, currencyCode: null, priceByProductId: new Map() };
  const uniqueProductIds = [...new Set(productIds)];

  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: { priceList: { select: { id: true, code: true, currencyCode: true } } },
  });
  const priceList = customer?.priceList;
  if (!priceList) return empty;

  const base: ResolvedPriceListPrices = {
    priceListId: priceList.id,
    priceListCode: priceList.code,
    currencyCode: priceList.currencyCode,
    priceByProductId: new Map(),
  };
  if (uniqueProductIds.length === 0) return base;

  const products = await client.product.findMany({
    where: { id: { in: uniqueProductIds } },
    select: { id: true, sapItemCode: true },
  });
  const sapCodes = products.map((p) => p.sapItemCode).filter((code): code is string => Boolean(code));

  const entries = await client.priceListEntry.findMany({
    where: {
      priceListId: priceList.id,
      AND: [
        { OR: [{ productId: { in: uniqueProductIds } }, ...(sapCodes.length > 0 ? [{ sapItemCodeSnapshot: { in: sapCodes } }] : [])] },
        { validFrom: { lte: asOf } },
        { OR: [{ validTo: null }, { validTo: { gte: asOf } }] },
      ],
    },
    orderBy: { validFrom: "desc" },
    select: { productId: true, sapItemCodeSnapshot: true, unitPrice: true },
  });

  for (const product of products) {
    // Entries are newest-validFrom-first, so the first match is the one in effect.
    const entry = entries.find(
      (e) => e.productId === product.id || (product.sapItemCode !== null && e.sapItemCodeSnapshot === product.sapItemCode)
    );
    if (entry) base.priceByProductId.set(product.id, entry.unitPrice.toString());
  }

  return base;
}

/**
 * One query for the whole set of VAT codes an order (or a page of orders)
 * needs: code -> configured ratePercent as a decimal string. A code with no
 * TaxCode row is simply absent -- resolveVatRatePercent then yields null and
 * the pricing calculation reports "tax not configured" instead of guessing.
 */
export async function loadTaxRatesByCode(vatCodes: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const codes = [...new Set([...vatCodes].filter((code): code is string => Boolean(code)))];
  const rates = new Map<string, string>();
  if (codes.length === 0) return rates;

  const rows = await prisma.taxCode.findMany({ where: { code: { in: codes } }, select: { code: true, ratePercent: true } });
  for (const row of rows) rates.set(row.code, row.ratePercent.toString());
  return rates;
}
