import { resolveEffectiveLostValue } from "@/lib/lost-sales/effective-value";
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { unfulfilledDemandStatusValues } from "@/lib/lost-sales/validation";

/**
 * Milestone 4 (Lost-Sales Management). Read-only helpers shared by the
 * lost-sales API routes (GET endpoints) and the /lost-sales UI -- same
 * role lib/picking/queries.ts plays for Milestone 3.
 */
export type UnfulfilledDemandSummary = {
  id: string;
  orderId: string;
  orderReference: string;
  customerId: string;
  customerName: string;
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  productDescriptionSnapshot: string;
  requestedQuantity: string;
  foundQuantity: string;
  unavailableQuantity: string;
  outstandingQuantity: string;
  cancelledQuantity: string;
  substitutedQuantity: string;
  confirmedLostQuantity: string;
  // Additional Implementation Requirements (lost-sales automation):
  // the automatic estimate, resolved once at creation time -- see
  // UnfulfilledDemand's own schema.prisma comment. Null means no
  // historically valid price was available, never a guessed zero.
  estimatedUnitPrice: string | null;
  estimatedValue: string | null;
  estimatedValueSource: string | null;
  // Real-world fix ("lost sales... show unit price/currency"):
  // estimatedUnitPrice/estimatedValue were already resolved and stored,
  // but carry no currency of their own -- a lost sale's value is always
  // denominated in its own order's currency (the same order
  // resolveEstimatedLostSaleValue priced this demand's line against), so
  // this is read off the already-joined order relation, never invented
  // or assumed to be a single global currency.
  currencyCode: string;
  supersededByDemandId: string | null;
  status: string;
  expectedFollowUpDate: string | null;
  isDemo: boolean;
  createdAt: string;
};

const DEMAND_SUMMARY_SELECT = {
  id: true,
  orderId: true,
  order: { select: { reference: true, currency: true } },
  customerId: true,
  customer: { select: { name: true } },
  productId: true,
  sapItemCodeSnapshot: true,
  productDescriptionSnapshot: true,
  requestedQuantity: true,
  foundQuantity: true,
  unavailableQuantity: true,
  outstandingQuantity: true,
  cancelledQuantity: true,
  substitutedQuantity: true,
  confirmedLostQuantity: true,
  estimatedUnitPrice: true,
  estimatedValue: true,
  estimatedValueSource: true,
  orderLine: { select: { approvedUnitPrice: true, customerUnitPrice: true } },
  supersededByDemandId: true,
  status: true,
  expectedFollowUpDate: true,
  isDemo: true,
  createdAt: true,
} as const;

type DemandSummaryRow = {
  id: string;
  orderId: string;
  order: { reference: string; currency: string };
  customerId: string;
  customer: { name: string };
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  productDescriptionSnapshot: string;
  requestedQuantity: { toString(): string };
  foundQuantity: { toString(): string };
  unavailableQuantity: { toString(): string };
  outstandingQuantity: { toString(): string };
  cancelledQuantity: { toString(): string };
  substitutedQuantity: { toString(): string };
  confirmedLostQuantity: { toString(): string };
  estimatedUnitPrice: { toString(): string } | null;
  estimatedValue: { toString(): string } | null;
  estimatedValueSource: string | null;
  orderLine: { approvedUnitPrice: { toString(): string } | null; customerUnitPrice: { toString(): string } | null } | null;
  supersededByDemandId: string | null;
  status: string;
  expectedFollowUpDate: Date | null;
  isDemo: boolean;
  createdAt: Date;
};

function toSummary(row: DemandSummaryRow): UnfulfilledDemandSummary {
  const effective = resolveEffectiveLostValue({
    storedUnitPrice: row.estimatedUnitPrice ? row.estimatedUnitPrice.toString() : null,
    storedValue: row.estimatedValue ? row.estimatedValue.toString() : null,
    lineApprovedUnitPrice: row.orderLine?.approvedUnitPrice?.toString() ?? null,
    lineCustomerUnitPrice: row.orderLine?.customerUnitPrice?.toString() ?? null,
    quantity: (Number(row.confirmedLostQuantity.toString()) > 0 ? row.confirmedLostQuantity : row.unavailableQuantity).toString(),
  });
  return {
    id: row.id,
    orderId: row.orderId,
    orderReference: row.order.reference,
    currencyCode: row.order.currency,
    customerId: row.customerId,
    customerName: row.customer.name,
    productId: row.productId,
    sapItemCodeSnapshot: row.sapItemCodeSnapshot,
    productDescriptionSnapshot: row.productDescriptionSnapshot,
    requestedQuantity: row.requestedQuantity.toString(),
    foundQuantity: row.foundQuantity.toString(),
    unavailableQuantity: row.unavailableQuantity.toString(),
    outstandingQuantity: row.outstandingQuantity.toString(),
    cancelledQuantity: row.cancelledQuantity.toString(),
    substitutedQuantity: row.substitutedQuantity.toString(),
    confirmedLostQuantity: row.confirmedLostQuantity.toString(),
    estimatedUnitPrice: effective.unitPrice,
    estimatedValue: effective.value,
    estimatedValueSource: effective.source === "ORDER_LINE_PRICE" ? "ORDER_LINE_APPROVED_PRICE" : row.estimatedValueSource,
    supersededByDemandId: row.supersededByDemandId,
    status: row.status,
    expectedFollowUpDate: row.expectedFollowUpDate ? row.expectedFollowUpDate.toISOString() : null,
    isDemo: row.isDemo,
    createdAt: row.createdAt.toISOString(),
  };
}

export type ListUnfulfilledDemandsOptions = {
  page: number;
  pageSize: number;
  includeDemo?: boolean;
  status?: string;
  customerId?: string;
  // Additional Implementation Requirements (spec section 3: analytics
  // overhaul). Additive, all-optional filters so the existing /lost-sales
  // list page (which never passes any of these) behaves identically to
  // before -- only the new analytics drilldown table
  // (lib/lost-sales/analytics-queries.ts) passes them. dateFrom/dateTo
  // are UTC Date instants (inclusive lower bound, exclusive upper bound
  // -- see analytics-queries.ts's own comment on why exclusive-upper),
  // already converted from "YYYY-MM-DD" by the caller via
  // lib/dates.ts -- this function stays DB-only and never parses a raw
  // query string itself. reason filters through the related
  // LostSaleRecord table (a demand only matches if at least one of its
  // records has that value) -- Prisma's `some` relation filter, not a
  // new column.
  //
  // Real Business Data Onboarding round (spec PART A): decisionType
  // removed outright -- no surviving code path ever creates a new
  // CustomerDecisionEvent to filter by any more (the model itself is
  // kept at the schema level only for historical-data safety; see its
  // own schema.prisma comment).
  productId?: string;
  salespersonId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  reason?: string;
};

export const LOST_SALES_DEFAULT_PAGE_SIZE = 50;
export const LOST_SALES_MAX_PAGE_SIZE = 100;
const MAX_PAGE = 100000;

function readInteger(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (parsed < min || parsed > max) return null;
  return parsed;
}

export type ParsedUnfulfilledDemandListQuery =
  | { ok: true; query: ListUnfulfilledDemandsOptions }
  | { ok: false; message: string };

/** Mirrors lib/order-queries.ts's parseOrderListQuery -- same tiny,
 * unexported pagination-parsing shape duplicated rather than imported,
 * since that function is private to that module and this is a handful
 * of generic lines, not a risk-bearing shared abstraction. */
export function parseUnfulfilledDemandListQuery(params: URLSearchParams): ParsedUnfulfilledDemandListQuery {
  const page = readInteger(params.get("page"), 1, 1, MAX_PAGE);
  if (page === null) return { ok: false, message: "Invalid page number." };

  const pageSize = readInteger(params.get("pageSize"), LOST_SALES_DEFAULT_PAGE_SIZE, 1, LOST_SALES_MAX_PAGE_SIZE);
  if (pageSize === null) {
    return { ok: false, message: `pageSize must be between 1 and ${LOST_SALES_MAX_PAGE_SIZE}.` };
  }

  const rawStatus = (params.get("status") ?? "").trim().toUpperCase();
  let status: string | undefined;
  if (rawStatus !== "" && rawStatus !== "ALL") {
    if (!unfulfilledDemandStatusValueSet.has(rawStatus)) {
      return { ok: false, message: "Invalid status filter." };
    }
    status = rawStatus;
  }

  const customerId = params.get("customerId")?.trim() || undefined;
  const includeDemo = params.get("includeDemo") === "true";

  return { ok: true, query: { page, pageSize, status, customerId, includeDemo } };
}

// Real Business Data Onboarding round (spec PART A): mirrors
// lib/lost-sales/validation.ts's unfulfilledDemandStatusValues -- kept at
// all 7 historical values (not pruned to the 2 now-reachable ones) so a
// pre-existing row from before this round stays filterable/visible. See
// that constant's own module comment for the full rationale.
const unfulfilledDemandStatusValueSet = new Set<string>(unfulfilledDemandStatusValues);

export type ListUnfulfilledDemandsResult = {
  demands: UnfulfilledDemandSummary[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

/**
 * Shared filter-building for listUnfulfilledDemands and
 * listAllUnfulfilledDemandsForExport -- kept as one function so the two
 * never drift into filtering differently (the export must show exactly
 * the rows the paginated table can page through, just all at once).
 */
function buildUnfulfilledDemandListWhere(
  options: Omit<ListUnfulfilledDemandsOptions, "page" | "pageSize">
): Prisma.UnfulfilledDemandWhereInput {
  const where: Prisma.UnfulfilledDemandWhereInput = {};
  if (!options.includeDemo) where.isDemo = false;
  if (options.status) {
    where.status = options.status as Prisma.UnfulfilledDemandWhereInput["status"];
  } else {
    // Additional Implementation Requirements (lost-sales automation): the
    // default list view is "current shortages," so a record replaced by
    // a later re-pick/correction is excluded unless the caller explicitly
    // asks to see superseded history via ?status=SUPERSEDED.
    where.status = { not: "SUPERSEDED" };
  }
  if (options.customerId) where.customerId = options.customerId;
  if (options.productId) where.productId = options.productId;
  if (options.salespersonId) where.order = { salespersonId: options.salespersonId };
  if (options.dateFrom || options.dateTo) {
    where.createdAt = {
      ...(options.dateFrom ? { gte: options.dateFrom } : {}),
      ...(options.dateTo ? { lt: options.dateTo } : {}),
    };
  }
  if (options.reason) where.lostSaleRecords = { some: { reason: options.reason as Prisma.LostSaleRecordWhereInput["reason"] } };
  return where;
}

/** The /lost-sales list page's query -- spec section 6's required list of unavailable/unfulfilled demand. */
export async function listUnfulfilledDemands(options: ListUnfulfilledDemandsOptions): Promise<ListUnfulfilledDemandsResult> {
  const where = buildUnfulfilledDemandListWhere(options);

  const [totalItems, rows] = await Promise.all([
    prisma.unfulfilledDemand.count({ where }),
    prisma.unfulfilledDemand.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      select: DEMAND_SUMMARY_SELECT,
    }),
  ]);

  return {
    demands: rows.map(toSummary),
    pagination: {
      page: options.page,
      pageSize: options.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / options.pageSize)),
    },
  };
}

// Same cap as lib/lost-sales/analytics-queries.ts's MAX_ANALYTICS_ROWS --
// kept as its own literal (not an import) since the two bounds protect
// two independent concerns (an in-memory chart computation vs. a CSV
// export) that happen to share a number today; `truncated` always
// discloses when the cap was hit, same "avoid misleading analytics"
// discipline as analytics-queries.ts.
const MAX_EXPORT_ROWS = 10_000;

/**
 * Additional Implementation Requirements (spec section 3, "a drillable
 * order-level data table" with export). Exports EVERY row matching the
 * current filters, not just one page -- the same "export reflects the
 * filtered view, not the pagination" contract as
 * lib/reporting/decision-intelligence-queries.ts's
 * listAllDecisionRecommendationsForExport, reusing
 * buildUnfulfilledDemandListWhere so the export can never drift from
 * what the on-screen drilldown table shows for the same filters.
 */
export async function listAllUnfulfilledDemandsForExport(
  options: Omit<ListUnfulfilledDemandsOptions, "page" | "pageSize">
): Promise<{ demands: UnfulfilledDemandSummary[]; truncated: boolean }> {
  const where = buildUnfulfilledDemandListWhere(options);

  const [totalItems, rows] = await Promise.all([
    prisma.unfulfilledDemand.count({ where }),
    prisma.unfulfilledDemand.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: MAX_EXPORT_ROWS,
      select: DEMAND_SUMMARY_SELECT,
    }),
  ]);

  return { demands: rows.map(toSummary), truncated: totalItems > MAX_EXPORT_ROWS };
}

// Real Business Data Onboarding round (spec PART A): DecisionEventDetail
// removed outright -- no surviving code path ever records a new decision
// event to detail any more (the UI/API/library surface that drove the
// Customer Decision workflow is deleted; CustomerDecisionEvent itself is
// kept at the schema level only for historical-data safety, see
// prisma/schema.prisma).

export type LostSaleRecordDetail = {
  id: string;
  quantity: string;
  reason: string;
  reasonDetail: string | null;
  decisionSource: string;
  estimatedUnitPrice: string | null;
  estimatedValue: string | null;
  estimatedValueSource: string | null;
  remarks: string | null;
  confirmedById: string;
  confirmedByName: string;
  confirmedAt: string;
};

export type SupersessionRef = { id: string; createdAt: string; unavailableQuantity: string };

export type UnfulfilledDemandDetail = UnfulfilledDemandSummary & {
  orderLineId: string;
  pickingSessionId: string;
  followUpRemarks: string | null;
  // Additional Implementation Requirements (lost-sales automation): the
  // other end of the supersession chain, if any -- see
  // UnfulfilledDemandStatus.SUPERSEDED's schema.prisma comment.
  supersededByDemandRef: SupersessionRef | null;
  supersedesDemandRef: SupersessionRef | null;
  lostSaleRecords: LostSaleRecordDetail[];
};

/** Full history for one record -- spec section 6: "the salesperson should be able to open a record and see its full history." */
export async function getUnfulfilledDemandDetail(id: string): Promise<UnfulfilledDemandDetail | null> {
  const row = await prisma.unfulfilledDemand.findUnique({
    where: { id },
    select: {
      ...DEMAND_SUMMARY_SELECT,
      orderLineId: true,
      pickingSessionId: true,
      followUpRemarks: true,
      supersededByDemand: { select: { id: true, createdAt: true, unavailableQuantity: true } },
      supersedesDemand: { select: { id: true, createdAt: true, unavailableQuantity: true } },
      lostSaleRecords: {
        orderBy: { confirmedAt: "asc" },
        select: {
          id: true,
          quantity: true,
          reason: true,
          reasonDetail: true,
          decisionSource: true,
          estimatedUnitPrice: true,
          estimatedValue: true,
          estimatedValueSource: true,
          remarks: true,
          confirmedById: true,
          confirmedBy: { select: { name: true } },
          confirmedAt: true,
        },
      },
    },
  });
  if (!row) return null;

  return {
    ...toSummary(row),
    orderLineId: row.orderLineId,
    pickingSessionId: row.pickingSessionId,
    followUpRemarks: row.followUpRemarks,
    supersededByDemandRef: row.supersededByDemand
      ? {
          id: row.supersededByDemand.id,
          createdAt: row.supersededByDemand.createdAt.toISOString(),
          unavailableQuantity: row.supersededByDemand.unavailableQuantity.toString(),
        }
      : null,
    supersedesDemandRef: row.supersedesDemand
      ? {
          id: row.supersedesDemand.id,
          createdAt: row.supersedesDemand.createdAt.toISOString(),
          unavailableQuantity: row.supersedesDemand.unavailableQuantity.toString(),
        }
      : null,
    lostSaleRecords: row.lostSaleRecords.map((record) => ({
      id: record.id,
      quantity: record.quantity.toString(),
      reason: record.reason,
      reasonDetail: record.reasonDetail,
      decisionSource: record.decisionSource,
      estimatedUnitPrice: record.estimatedUnitPrice ? record.estimatedUnitPrice.toString() : null,
      estimatedValue: record.estimatedValue ? record.estimatedValue.toString() : null,
      estimatedValueSource: record.estimatedValueSource,
      remarks: record.remarks,
      confirmedById: record.confirmedById,
      confirmedByName: record.confirmedBy?.name ?? "Unknown",
      confirmedAt: record.confirmedAt.toISOString(),
    })),
  };
}

export type ProductQuantityBreakdown = {
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  productDescriptionSnapshot: string;
  totalQuantity: string;
};

export type CustomerShortageBreakdown = {
  customerId: string;
  customerName: string;
  demandCount: number;
};

export type LossReasonBreakdown = {
  reason: string;
  recordCount: number;
  totalQuantity: string;
};

export type LostSalesReportSummary = {
  // Real Business Data Onboarding round (spec PART A): awaitingDecisionCount
  // removed outright, not hardcoded to zero -- every NEW shortage is
  // immediately and automatically confirmed lost (see
  // lib/lost-sales/create-unfulfilled-demand.ts), so no demand created
  // from this point forward can ever be PENDING_DECISION again, making
  // "awaiting a customer decision" a structurally meaningless question
  // for the system's current, going-forward state -- spec section 19:
  // "No order is waiting for a customer decision" must hold everywhere,
  // including in this summary's own field list. (PENDING_DECISION
  // remains a valid historical value for a pre-existing row -- see
  // UnfulfilledDemandStatus's own schema.prisma comment -- but this
  // summary's job is to describe the current operational state, not
  // surface a count of old rows nothing can act on any more.)
  totalUnavailableQuantity: string;
  totalOutstandingQuantity: string;
  totalConfirmedLostQuantity: string;
  topUnavailableProducts: ProductQuantityBreakdown[];
  topConfirmedLostProducts: ProductQuantityBreakdown[];
  topShortageCustomers: CustomerShortageBreakdown[];
  lossReasonBreakdown: LossReasonBreakdown[];
};

/**
 * Builds the human-readable sapItemCodeSnapshot -> description lookup a
 * groupBy result needs (groupBy only returns the grouped field plus
 * aggregates, never other columns) -- one representative (most recent)
 * row per code.
 */
async function describeBySapCode(sapCodes: (string | null)[]): Promise<Map<string, { productId: string | null; description: string }>> {
  const codes = Array.from(new Set(sapCodes.filter((code): code is string => code !== null)));
  if (codes.length === 0) return new Map();

  const rows = await prisma.unfulfilledDemand.findMany({
    where: { sapItemCodeSnapshot: { in: codes } },
    orderBy: { createdAt: "desc" },
    distinct: ["sapItemCodeSnapshot"],
    select: { sapItemCodeSnapshot: true, productId: true, productDescriptionSnapshot: true },
  });

  const map = new Map<string, { productId: string | null; description: string }>();
  for (const row of rows) {
    if (row.sapItemCodeSnapshot) {
      map.set(row.sapItemCodeSnapshot, { productId: row.productId, description: row.productDescriptionSnapshot });
    }
  }
  return map;
}

export type SupplyShortageLostSalesValue = {
  /** Sum of LostSaleRecord.estimatedValue across every record that has one -- "Estimated Supply Lost Sales = Unavailable Quantity x Applicable Selling Price" (Final Operational Enhancements spec Part 7, Source B). Never a stored running total -- see lib/lost-sales/estimate-value.ts's own comment on why a price/value is never invented. */
  estimatedValue: string;
  /** How many LostSaleRecord rows contributed a real value to the sum above. */
  recordsWithEstimate: number;
  /** How many LostSaleRecord rows exist in total but had no resolvable price (estimatedValue is null) -- the UI must surface this count, never silently understate the true total by pretending every record was priced. */
  recordsWithoutEstimate: number;
};

/**
 * Final Operational Enhancements (spec Part 7): the money-value
 * counterpart to getLostSalesReportSummary's quantity-only totals above
 * -- Source B ("insufficient supply at fulfilment") in the spec's
 * required Source A / Source B split, kept here as its own small,
 * additive function rather than folded into getLostSalesReportSummary
 * (whose own comment already documents a deliberate choice not to blend
 * figures into one number -- adding a NEW figure to that same function
 * risked exactly the kind of implicit blending that comment warns
 * against). Composed with Source A (lib/invoice-claims/financial.ts's
 * computeExposureByCurrency) only in lib/reporting/financial-exposure.ts,
 * which is the one place spec Part 7 says must keep both sources
 * "separately identifiable."
 */
export async function getSupplyShortageLostSalesValue(options?: { includeDemo?: boolean }): Promise<SupplyShortageLostSalesValue> {
  const includeDemo = options?.includeDemo ?? false;
  const where: Prisma.LostSaleRecordWhereInput = includeDemo ? {} : { unfulfilledDemand: { isDemo: false } };

  const [valueAggregate, totalCount, withEstimateCount] = await Promise.all([
    prisma.lostSaleRecord.aggregate({ where, _sum: { estimatedValue: true } }),
    prisma.lostSaleRecord.count({ where }),
    prisma.lostSaleRecord.count({ where: { ...where, estimatedValue: { not: null } } }),
  ]);

  return {
    estimatedValue: (valueAggregate._sum.estimatedValue ?? new Prisma.Decimal(0)).toString(),
    recordsWithEstimate: withEstimateCount,
    recordsWithoutEstimate: totalCount - withEstimateCount,
  };
}

export type AutomaticLostSalesValue = {
  /**
   * Sum of UnfulfilledDemand.estimatedValue across every *current*
   * (non-SUPERSEDED) demand that has one -- "Estimated Lost Sales =
   * Unavailable Quantity x Applicable Selling Price", computed
   * automatically the moment a picking line's shortage is recorded (see
   * createUnfulfilledDemandsForSession), never only on manual
   * confirmation. This is a distinct figure from
   * getSupplyShortageLostSalesValue's estimatedValue above: that one
   * sums LostSaleRecord.estimatedValue (Source B -- a sale a manager has
   * actually confirmed as lost), while this one sums
   * UnfulfilledDemand.estimatedValue (every unresolved shortage still
   * sitting unconfirmed) -- the spec's required "Estimated Lost Sales"
   * KPI, which must be visible before anyone manually confirms
   * anything. The two are never added together into one blended figure,
   * for the same reason getLostSalesReportSummary's own comment gives.
   */
  estimatedValue: string;
  /** How many current (non-SUPERSEDED) demands contributed a real value to the sum above. */
  demandsWithEstimate: number;
  /** How many current (non-SUPERSEDED) demands exist in total but had no resolvable price (estimatedValue is null) -- never silently dropped from the count, so the UI can disclose that the total understates reality. */
  demandsWithoutEstimate: number;
};

/**
 * Additional Implementation Requirements (lost-sales automation), spec
 * section 1: "Automatic lost sales from unavailable quantities." The
 * automatic-estimate counterpart to getSupplyShortageLostSalesValue
 * (manual-confirmation figure, unchanged) and to
 * getLostSalesReportSummary's quantity-only totals (no money value) --
 * kept as its own small, additive function for the same reason
 * getSupplyShortageLostSalesValue's own comment gives: adding a new
 * money figure into an existing function risks exactly the kind of
 * implicit blending this codebase deliberately avoids everywhere else in
 * lost-sales reporting. Excludes SUPERSEDED demands (see
 * getLostSalesReportSummary's currentDemandWhere comment) so a re-pick
 * correction is never double-counted.
 */
export async function getAutomaticLostSalesValue(options?: {
  includeDemo?: boolean;
}): Promise<AutomaticLostSalesValue> {
  const includeDemo = options?.includeDemo ?? false;
  const where: Prisma.UnfulfilledDemandWhereInput = {
    ...(includeDemo ? {} : { isDemo: false }),
    status: { not: "SUPERSEDED" },
  };

  const demands = await prisma.unfulfilledDemand.findMany({
    where,
    select: {
      unavailableQuantity: true,
      confirmedLostQuantity: true,
      estimatedUnitPrice: true,
      estimatedValue: true,
      orderLine: { select: { approvedUnitPrice: true, customerUnitPrice: true } },
    },
  });
  let total = new Prisma.Decimal(0);
  let withEstimate = 0;
  for (const demand of demands) {
    const effective = resolveEffectiveLostValue({
      storedUnitPrice: demand.estimatedUnitPrice?.toString() ?? null,
      storedValue: demand.estimatedValue?.toString() ?? null,
      lineApprovedUnitPrice: demand.orderLine?.approvedUnitPrice?.toString() ?? null,
      lineCustomerUnitPrice: demand.orderLine?.customerUnitPrice?.toString() ?? null,
      quantity: (demand.confirmedLostQuantity.gt(0) ? demand.confirmedLostQuantity : demand.unavailableQuantity).toString(),
    });
    if (effective.value !== null) {
      total = total.plus(effective.value);
      withEstimate += 1;
    }
  }

  return {
    estimatedValue: total.toString(),
    demandsWithEstimate: withEstimate,
    demandsWithoutEstimate: demands.length - withEstimate,
  };
}

/**
 * Spec section 7. Deliberately a handful of distinct, clearly-labeled
 * figures rather than one blended "lost sales" number -- the spec's own
 * warning ("do not combine them into one misleading lost-sales figure")
 * -- and deliberately no trends-over-time chart yet: "avoid unnecessary
 * dashboard complexity... before advanced BI" (spec section 6). Time-series
 * reporting can be layered on top of these same rows in a later round
 * without any schema change.
 */
export async function getLostSalesReportSummary(options?: { includeDemo?: boolean }): Promise<LostSalesReportSummary> {
  const includeDemo = options?.includeDemo ?? false;
  const demandWhere: Prisma.UnfulfilledDemandWhereInput = includeDemo ? {} : { isDemo: false };

  // Additional Implementation Requirements (lost-sales automation): a
  // SUPERSEDED row was replaced by a later re-pick/correction against the
  // same order line (see UnfulfilledDemandStatus.SUPERSEDED's
  // schema.prisma comment and createUnfulfilledDemandsForSession's own
  // comment). Every "current open shortage" aggregate below -- the
  // outstanding/unavailable totals, the top-unavailable-products
  // breakdown, and the per-customer open-shortage count -- must exclude
  // superseded rows, or a corrected order would double-count: once under
  // its original (now-superseded) demand and again under the new one.
  //
  // confirmedLostTotal and topConfirmedLostProducts are the deliberate
  // exception -- they intentionally query with demandWhere (no status
  // filter), NOT currentDemandWhere. A confirmedLostQuantity figure
  // records a real, already-decided financial loss. If a later picking
  // correction supersedes the demand it was confirmed against, that loss
  // already happened and must not silently vanish from analytics just
  // because the remaining open shortage changed -- this is the same
  // reasoning documented on lib/lost-sales/create-unfulfilled-demand.ts's
  // supersession branch. (lossReasons, below, draws from LostSaleRecord
  // directly and was never filtered by demand status, so it already
  // behaves this way and needs no change.)
  const currentDemandWhere: Prisma.UnfulfilledDemandWhereInput = { ...demandWhere, status: { not: "SUPERSEDED" } };

  const [
    unavailableTotal,
    outstandingTotal,
    confirmedLostTotal,
    unavailableByProduct,
    lostByProduct,
    shortageByCustomer,
    lossReasons,
  ] = await Promise.all([
    prisma.unfulfilledDemand.aggregate({ where: currentDemandWhere, _sum: { unavailableQuantity: true } }),
    prisma.unfulfilledDemand.aggregate({ where: currentDemandWhere, _sum: { outstandingQuantity: true } }),
    prisma.unfulfilledDemand.aggregate({ where: demandWhere, _sum: { confirmedLostQuantity: true } }),
    prisma.unfulfilledDemand.groupBy({
      by: ["sapItemCodeSnapshot"],
      where: currentDemandWhere,
      _sum: { unavailableQuantity: true },
      orderBy: { _sum: { unavailableQuantity: "desc" } },
      take: 10,
    }),
    prisma.unfulfilledDemand.groupBy({
      by: ["sapItemCodeSnapshot"],
      where: { ...demandWhere, confirmedLostQuantity: { gt: 0 } },
      _sum: { confirmedLostQuantity: true },
      orderBy: { _sum: { confirmedLostQuantity: "desc" } },
      take: 10,
    }),
    prisma.unfulfilledDemand.groupBy({
      by: ["customerId"],
      where: currentDemandWhere,
      _count: { _all: true },
      orderBy: { _count: { customerId: "desc" } },
      take: 10,
    }),
    prisma.lostSaleRecord.groupBy({
      by: ["reason"],
      where: includeDemo ? {} : { unfulfilledDemand: { isDemo: false } },
      _count: { _all: true },
      _sum: { quantity: true },
      orderBy: { _count: { reason: "desc" } },
    }),
  ]);

  const descriptions = await describeBySapCode([
    ...unavailableByProduct.map((row) => row.sapItemCodeSnapshot),
    ...lostByProduct.map((row) => row.sapItemCodeSnapshot),
  ]);

  const customerIds = shortageByCustomer.map((row) => row.customerId);
  const customers = customerIds.length
    ? await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
    : [];
  const customerNameById = new Map(customers.map((customer) => [customer.id, customer.name]));

  return {
    totalUnavailableQuantity: (unavailableTotal._sum.unavailableQuantity ?? new Prisma.Decimal(0)).toString(),
    totalOutstandingQuantity: (outstandingTotal._sum.outstandingQuantity ?? new Prisma.Decimal(0)).toString(),
    totalConfirmedLostQuantity: (confirmedLostTotal._sum.confirmedLostQuantity ?? new Prisma.Decimal(0)).toString(),
    topUnavailableProducts: unavailableByProduct.map((row) => {
      const info = row.sapItemCodeSnapshot ? descriptions.get(row.sapItemCodeSnapshot) : undefined;
      return {
        productId: info?.productId ?? null,
        sapItemCodeSnapshot: row.sapItemCodeSnapshot,
        productDescriptionSnapshot: info?.description ?? "(unresolved product)",
        totalQuantity: (row._sum.unavailableQuantity ?? new Prisma.Decimal(0)).toString(),
      };
    }),
    topConfirmedLostProducts: lostByProduct.map((row) => {
      const info = row.sapItemCodeSnapshot ? descriptions.get(row.sapItemCodeSnapshot) : undefined;
      return {
        productId: info?.productId ?? null,
        sapItemCodeSnapshot: row.sapItemCodeSnapshot,
        productDescriptionSnapshot: info?.description ?? "(unresolved product)",
        totalQuantity: (row._sum.confirmedLostQuantity ?? new Prisma.Decimal(0)).toString(),
      };
    }),
    topShortageCustomers: shortageByCustomer.map((row) => ({
      customerId: row.customerId,
      customerName: customerNameById.get(row.customerId) ?? "Unknown customer",
      demandCount: row._count._all,
    })),
    lossReasonBreakdown: lossReasons.map((row) => ({
      reason: row.reason,
      recordCount: row._count._all,
      totalQuantity: (row._sum.quantity ?? new Prisma.Decimal(0)).toString(),
    })),
  };
}

/**
 * Follow-up fix ("Returned-claim lost sales must... Show returned-claim
 * losses in the same Lost Sales Analytics page, KPIs, charts and reports
 * as shortage-based lost sales"). The row-level counterpart to
 * lib/returns-credits/lost-sale-rows.ts's listReturnedProductLostSaleRows,
 * read by lib/lost-sales/consolidated-analytics.ts to merge both sources
 * into one view.
 *
 * Lists LostSaleRecord directly (Source B's own underlying table --
 * getSupplyShortageLostSalesValue's whole-business summary stays
 * unchanged and untouched), not UnfulfilledDemand: a LostSaleRecord row
 * IS the confirmed-loss event (one per demand, by this round's
 * auto-confirm rule -- see LostSaleRecord's own schema.prisma comment),
 * the exact same granularity as a ClaimReturnLostSale row on the
 * returned-product side. Reading at this granularity means this
 * function unions the two sources' already-decided rows rather than
 * re-deriving either side's "is this a real loss" business logic (which
 * remains exclusively in create-unfulfilled-demand.ts's auto-confirm and
 * lib/returns-credits/return-lost-sale.ts respectively).
 *
 * Currency: LostSaleRecord/UnfulfilledDemand carry no currency column at
 * all (a known, pre-existing limitation -- see lib/reporting/
 * financial-exposure.ts's own module comment). This function resolves a
 * REAL one instead of leaving the figure unlabeled: CustomerOrder.currency
 * is a required, always-set column (`@default("USD")`), so every row
 * below carries its originating order's actual recorded currency, never
 * an invented or assumed one.
 */
export type ShortageLostSaleRow = {
  id: string; // LostSaleRecord.id
  unfulfilledDemandId: string;
  orderId: string;
  orderReference: string;
  customerId: string;
  customerName: string;
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  productDescriptionSnapshot: string;
  /** Product.unitOfMeasure, joined live -- null when productId is null or the product has none recorded. */
  unitOfMeasure: string | null;
  /** LostSaleRecord.quantity -- always equal to the parent demand's full confirmedLostQuantity, per this round's auto-confirm rule. */
  quantity: string;
  unitPrice: string | null;
  totalValue: string | null;
  /** CustomerOrder.currency -- never null (see this function's own module comment). */
  currencyCode: string;
  reason: string; // LostSaleReason
  salespersonId: string | null;
  confirmedAt: Date;
  isDemo: boolean;
};

export type ListShortageLostSalesResult = {
  rows: ShortageLostSaleRow[];
  totalMatching: number;
  truncated: boolean;
};

export type ShortageLostSaleFilters = {
  includeDemo: boolean;
  customerId?: string | null;
  productId?: string | null;
  salespersonId?: string | null;
  /** Applied against LostSaleRecord.confirmedAt -- the "this loss was confirmed" timestamp, the same role ClaimReturnLostSale.recordedAt plays on the returned-product side. */
  dateRange: { gte?: Date; lt?: Date };
};

const MAX_SHORTAGE_LOST_SALE_ROWS = 10_000;

export async function listShortageLostSaleRows(filters: ShortageLostSaleFilters): Promise<ListShortageLostSalesResult> {
  const where: Prisma.LostSaleRecordWhereInput = {
    confirmedAt: filters.dateRange,
    unfulfilledDemand: {
      ...(filters.includeDemo ? {} : { isDemo: false }),
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...(filters.productId ? { productId: filters.productId } : {}),
      ...(filters.salespersonId ? { order: { salespersonId: filters.salespersonId } } : {}),
    },
  };

  const [totalMatching, rawRows] = await Promise.all([
    prisma.lostSaleRecord.count({ where }),
    prisma.lostSaleRecord.findMany({
      where,
      take: MAX_SHORTAGE_LOST_SALE_ROWS,
      orderBy: { confirmedAt: "asc" },
      select: {
        id: true,
        unfulfilledDemandId: true,
        quantity: true,
        reason: true,
        estimatedUnitPrice: true,
        estimatedValue: true,
        confirmedAt: true,
        unfulfilledDemand: {
          select: {
            orderId: true,
            order: { select: { reference: true, salespersonId: true, currency: true } },
            customerId: true,
            customer: { select: { name: true } },
            productId: true,
            product: { select: { unitOfMeasure: true } },
            sapItemCodeSnapshot: true,
            productDescriptionSnapshot: true,
            isDemo: true,
          },
        },
      },
    }),
  ]);

  const rows: ShortageLostSaleRow[] = rawRows.map((row) => ({
    id: row.id,
    unfulfilledDemandId: row.unfulfilledDemandId,
    orderId: row.unfulfilledDemand.orderId,
    orderReference: row.unfulfilledDemand.order.reference,
    customerId: row.unfulfilledDemand.customerId,
    customerName: row.unfulfilledDemand.customer.name,
    productId: row.unfulfilledDemand.productId,
    sapItemCodeSnapshot: row.unfulfilledDemand.sapItemCodeSnapshot,
    productDescriptionSnapshot: row.unfulfilledDemand.productDescriptionSnapshot,
    unitOfMeasure: row.unfulfilledDemand.product?.unitOfMeasure ?? null,
    quantity: row.quantity.toString(),
    unitPrice: row.estimatedUnitPrice?.toString() ?? null,
    totalValue: row.estimatedValue?.toString() ?? null,
    currencyCode: row.unfulfilledDemand.order.currency,
    reason: row.reason,
    salespersonId: row.unfulfilledDemand.order.salespersonId,
    confirmedAt: row.confirmedAt,
    isDemo: row.unfulfilledDemand.isDemo,
  }));

  return {
    rows,
    totalMatching,
    truncated: totalMatching > MAX_SHORTAGE_LOST_SALE_ROWS,
  };
}
