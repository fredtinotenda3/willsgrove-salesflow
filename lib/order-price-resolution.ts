import "server-only";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { chooseApplicablePrice, isSupportedCurrency, type PriceSource } from "@/lib/pricing/price-core";

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
 *  - Precedence: the customer's own override (CustomerProductPrice) first,
 *    then the customer's ASSIGNED price list (Customer.priceListId) -- never
 *    another customer's price, never a "default" list, never a guessed price.
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
  priceListName: string | null;
  /** The customer's effective currency (assigned list's currency, else Customer.currencyCode, else the currency of their overrides). */
  currencyCode: string | null;
  /** productId -> unit price (decimal string). A product with no applicable price is simply absent. */
  priceByProductId: Map<string, string>;
  /** productId -> where that price came from (customer override beats the price list). Same keys as priceByProductId. */
  sourceByProductId: Map<string, PriceSource>;
  /** Products that have a customer override in a DIFFERENT currency from the customer's: skipped, never converted. */
  currencyMismatchProductIds: Set<string>;
};

type PriceResolutionClient = Pick<PrismaTransactionClient, "customer" | "product" | "priceListEntry" | "customerProductPrice">;

/**
 * Applicable-price resolution (precedence documented in lib/pricing/price-core.ts):
 * customer override -> assigned price list -> nothing. Batched: four queries
 * for any number of products.
 */
export async function resolveCustomerPriceListPrices(
  client: PriceResolutionClient,
  customerId: string,
  productIds: readonly string[],
  asOf: Date = new Date()
): Promise<ResolvedPriceListPrices> {
  const uniqueProductIds = [...new Set(productIds)];
  const result: ResolvedPriceListPrices = {
    priceListId: null,
    priceListCode: null,
    priceListName: null,
    currencyCode: null,
    priceByProductId: new Map(),
    sourceByProductId: new Map(),
    currencyMismatchProductIds: new Set(),
  };

  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: { currencyCode: true, priceList: { select: { id: true, code: true, name: true, currencyCode: true } } },
  });
  if (!customer) return result;
  const priceList = customer.priceList;

  const overrides =
    uniqueProductIds.length > 0
      ? await client.customerProductPrice.findMany({
          where: { customerId, productId: { in: uniqueProductIds } },
          select: { id: true, productId: true, currencyCode: true, unitPrice: true },
        })
      : [];

  result.priceListId = priceList?.id ?? null;
  result.priceListCode = priceList?.code ?? null;
  result.priceListName = priceList?.name ?? null;
  const overrideCurrencies = [...new Set(overrides.map((o) => o.currencyCode))].sort();
  result.currencyCode = priceList?.currencyCode ?? (isSupportedCurrency(customer.currencyCode) ? customer.currencyCode : null) ?? overrideCurrencies[0] ?? null;
  if (uniqueProductIds.length === 0) return result;

  const products = await client.product.findMany({ where: { id: { in: uniqueProductIds } }, select: { id: true, sapItemCode: true } });
  const sapCodes = products.map((p) => p.sapItemCode).filter((code): code is string => Boolean(code));

  const entries = priceList
    ? await client.priceListEntry.findMany({
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
      })
    : [];

  const overrideByProduct = new Map(overrides.map((o) => [o.productId, o]));
  for (const product of products) {
    // Entries are newest-validFrom-first, so the first match is the one in effect.
    const entry = entries.find((e) => e.productId === product.id || (product.sapItemCode !== null && e.sapItemCodeSnapshot === product.sapItemCode));
    const override = overrideByProduct.get(product.id) ?? null;
    const decision = chooseApplicablePrice(
      {
        override: override ? { id: override.id, unitPrice: override.unitPrice.toString(), currencyCode: override.currencyCode } : null,
        listPrice: entry && priceList ? { unitPrice: entry.unitPrice.toString(), priceListCode: priceList.code } : null,
        customerCurrency: result.currencyCode,
      },
      priceList?.currencyCode ?? null
    );
    if (decision.skippedOverrideForCurrency) result.currencyMismatchProductIds.add(product.id);
    if (decision.found) {
      result.priceByProductId.set(product.id, decision.unitPrice);
      result.sourceByProductId.set(product.id, decision.source);
    }
  }
  return result;
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
