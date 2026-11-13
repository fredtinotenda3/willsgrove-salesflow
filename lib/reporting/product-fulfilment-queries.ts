import "server-only";
import { prisma } from "@/lib/prisma";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToTimestampFilter, resolveEffectiveDateRange } from "@/lib/reporting/filters";
import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";
import { itemKey } from "@/lib/reporting/product-purchasing";
import { rankByValue } from "@/lib/reporting/product-segmentation";

/**
 * Milestone 14 (Product Intelligence). Delivery/fulfilment queries for
 * one product (Product 360, spec section 4.5) and the management
 * overview's delivery-rejection ranking (spec section 4.B item 8).
 *
 * Reaches a product via OrderLine.productId/sapItemCodeSnapshot ->
 * DispatchLine.orderLineId -> DeliveryLine.dispatchLineId -- LINE level
 * throughout, never DeliveryRecord's own header-level `outcome` (which
 * describes an entire dispatch/shipment, possibly spanning several
 * products; attributing it to one product in that shipment would
 * misclassify an unrelated line's rejection as this product's own, which
 * spec section 4.5 explicitly forbids: "never classify every delivery
 * rejection as a product quality defect"). DeliveryLine's own
 * acceptedQuantity/rejectedQuantity are exact, per-line figures -- more
 * precise than the header-level signal Milestone 13's customer
 * commercial-health module uses, which is appropriate there (no
 * product-level breakdown needed) but not here.
 *
 * rejectionReason is free text on DeliveryLine (never a closed enum per
 * the schema's own comment), so it is reported as a plain grouped-count
 * breakdown, never coerced into an invented classification.
 *
 * Only exercised via RUN_DB_INTEGRATION_TESTS=1, same reason as every
 * other *-queries.ts file in this project.
 */

function groupQuantityByUnit(rows: { unit: string; quantity: string }[]): { unitOfMeasure: string; quantityTotal: string }[] {
  const byUnit = new Map<string, string[]>();
  for (const row of rows) {
    const unit = (row.unit ?? "").trim() === "" ? "UNKNOWN_UOM" : row.unit.trim().toUpperCase();
    const bucket = byUnit.get(unit) ?? [];
    bucket.push(row.quantity);
    byUnit.set(unit, bucket);
  }
  return [...byUnit.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([unitOfMeasure, values]) => ({ unitOfMeasure, quantityTotal: formatScaledDecimal(sumDecimalStrings(values)) }));
}

// ---------------------------------------------------------------------------
// Product 360 profile.
// ---------------------------------------------------------------------------

export type ProductFulfilmentSummary = {
  periodFrom: string;
  periodTo: string;
  dispatchedQuantityByUnit: { unitOfMeasure: string; quantityTotal: string }[];
  deliveredAcceptedQuantityByUnit: { unitOfMeasure: string; quantityTotal: string }[];
  deliveredRejectedQuantityByUnit: { unitOfMeasure: string; quantityTotal: string }[];
  /** COUNT of DeliveryLine rows for this product with rejectedQuantity > 0 -- a rejection EVENT count, never a rate (spec section 4.5: delivery, availability, customer refusal and product-quality issues are different concepts; this count says only that a rejection was recorded, not why). */
  deliveryLinesWithRejectionCount: number;
  /** Free-text rejectionReason, grouped as recorded -- never classified into an invented taxonomy. */
  rejectionReasons: { reason: string; count: number }[];
};

export async function getProductFulfilmentSummary(sapItemCode: string, productId: string | null, filters: ReportFilters): Promise<ProductFulfilmentSummary> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const demo = demoWhere(filters);
  const timestampRange = dateRangeToTimestampFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });

  const orderLineMatch = productId ? { OR: [{ sapItemCodeSnapshot: sapItemCode }, { productId }] } : { sapItemCodeSnapshot: sapItemCode };

  // NOTE: DispatchLine itself has no isDemo column (only DispatchRecord
  // does), so the demo filter is applied solely via the dispatchRecord
  // relation below -- never spread onto this query's own top-level where,
  // which has no such field to match against. Likewise DispatchRecord has
  // no "dispatchedAt" column (verified directly against prisma/schema.prisma);
  // its date-bearing fields are plannedDepartureAt/departedAt/cancelledAt,
  // all nullable since a dispatch may be planned but not yet physically
  // departed. Using any of those would silently exclude legitimate
  // dispatched-but-not-yet-departed activity from the period. DispatchLine's
  // own `createdAt` (non-nullable, set when this dispatch line -- i.e. this
  // quantity's dispatch -- was recorded) is used instead: it is always
  // present and needs no nullable-field judgment call. Accepted/rejected
  // figures below are therefore the eventual outcome of dispatches that
  // occurred in the period (a cohort view), not of deliveries recorded in
  // the period -- the closest defensible reading of "fulfilment activity in
  // the period" given the schema has no single field meaning "when this
  // fulfilment cycle completed" (spec section 15's fallback clause).
  const dispatchLines = await prisma.dispatchLine.findMany({
    where: { orderLine: orderLineMatch, createdAt: timestampRange, dispatchRecord: { ...demo } },
    select: { dispatchedQuantity: true, orderLine: { select: { requestedUnitCode: true } }, deliveryLine: { select: { acceptedQuantity: true, rejectedQuantity: true, rejectionReason: true } } },
  });

  const dispatchedQuantityByUnit = groupQuantityByUnit(dispatchLines.map((d) => ({ unit: d.orderLine.requestedUnitCode, quantity: d.dispatchedQuantity.toString() })));

  const deliveredLines = dispatchLines.filter((d) => d.deliveryLine !== null);
  const deliveredAcceptedQuantityByUnit = groupQuantityByUnit(
    deliveredLines.map((d) => ({ unit: d.orderLine.requestedUnitCode, quantity: d.deliveryLine!.acceptedQuantity.toString() }))
  );
  const deliveredRejectedQuantityByUnit = groupQuantityByUnit(
    deliveredLines.map((d) => ({ unit: d.orderLine.requestedUnitCode, quantity: d.deliveryLine!.rejectedQuantity.toString() }))
  );

  const rejectedLines = deliveredLines.filter((d) => Number(d.deliveryLine!.rejectedQuantity.toString()) > 0);
  const reasonCounts = new Map<string, number>();
  for (const line of rejectedLines) {
    const reason = (line.deliveryLine!.rejectionReason ?? "").trim() || "Not recorded";
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }

  return {
    periodFrom: effectiveFrom,
    periodTo: effectiveTo,
    dispatchedQuantityByUnit,
    deliveredAcceptedQuantityByUnit,
    deliveredRejectedQuantityByUnit,
    deliveryLinesWithRejectionCount: rejectedLines.length,
    rejectionReasons: [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------------------
// Management overview: products ranked by recorded delivery-rejection
// quantity (spec section 4.B item 8).
// ---------------------------------------------------------------------------

export type ProductDeliveryRejectionRow = {
  sapItemCode: string;
  productId: string | null;
  deliveryLinesWithRejectionCount: number;
  rejectedQuantityByUnit: { unitOfMeasure: string; quantityTotal: string }[];
  rank: number;
};

export async function getProductDeliveryRejectionOverview(filters: ReportFilters): Promise<{ periodFrom: string; periodTo: string; rows: ProductDeliveryRejectionRow[] }> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const demo = demoWhere(filters);
  const timestampRange = dateRangeToTimestampFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });

  // See getProductFulfilmentSummary above for why the demo filter is
  // applied only via the dispatchRecord relation and the period is
  // scoped by DispatchLine's own createdAt rather than a nonexistent
  // DispatchRecord.dispatchedAt field.
  const dispatchLines = await prisma.dispatchLine.findMany({
    where: { createdAt: timestampRange, dispatchRecord: { ...demo }, deliveryLine: { rejectedQuantity: { gt: 0 } } },
    select: {
      orderLine: { select: { sapItemCodeSnapshot: true, productId: true, requestedUnitCode: true } },
      deliveryLine: { select: { rejectedQuantity: true } },
    },
  });

  type Acc = { productId: string | null; count: number; quantitiesByUnit: Map<string, string[]> };
  const byItem = new Map<string, Acc>();
  for (const line of dispatchLines) {
    const item = itemKey(line.orderLine.sapItemCodeSnapshot);
    const acc = byItem.get(item) ?? { productId: line.orderLine.productId, count: 0, quantitiesByUnit: new Map() };
    acc.count += 1;
    if (!acc.productId) acc.productId = line.orderLine.productId;
    const unit = (line.orderLine.requestedUnitCode ?? "").trim() === "" ? "UNKNOWN_UOM" : line.orderLine.requestedUnitCode.trim().toUpperCase();
    const bucket = acc.quantitiesByUnit.get(unit) ?? [];
    bucket.push(line.deliveryLine!.rejectedQuantity.toString());
    acc.quantitiesByUnit.set(unit, bucket);
    byItem.set(item, acc);
  }

  const ranked = rankByValue([...byItem.entries()].map(([sapItemCode, acc]) => ({ sapItemCode, value: acc.count })), "descending");
  const rankByItem = new Map(ranked.map((r) => [r.sapItemCode, r.rank]));

  const rows: ProductDeliveryRejectionRow[] = [...byItem.entries()]
    .map(([sapItemCode, acc]) => ({
      sapItemCode,
      productId: acc.productId,
      deliveryLinesWithRejectionCount: acc.count,
      rejectedQuantityByUnit: [...acc.quantitiesByUnit.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([unitOfMeasure, values]) => ({ unitOfMeasure, quantityTotal: formatScaledDecimal(sumDecimalStrings(values)) })),
      rank: rankByItem.get(sapItemCode)!,
    }))
    .sort((a, b) => a.rank - b.rank);

  return { periodFrom: effectiveFrom, periodTo: effectiveTo, rows };
}
