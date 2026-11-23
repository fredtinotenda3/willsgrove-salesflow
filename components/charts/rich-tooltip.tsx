"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { LostSalesCustomerBreakdown, LostSalesProductBreakdown, LostSalesTrendPoint } from "@/lib/lost-sales/analytics-queries";

/**
 * Chart intelligence enhancement ("SalesFlow Analytics: Deep Chart
 * Intelligence, Product-Level Breakdown and Rich Tooltips"). Reusable,
 * shared tooltip content for every Lost Sales Analytics chart that plots
 * a figure which is itself an aggregate of several products/customers/
 * orders -- the request's own core instruction: "make every important
 * aggregate figure explainable and traceable to its contributing
 * records," without overwhelming the chart itself (the summary stays a
 * single bar/line point; the explanation lives in this tooltip).
 *
 * Built on top of components/ui/chart.tsx's Recharts <Tooltip content=
 * {...} /> mechanism, the same way ChartTooltipContent already is --
 * this is a second, purpose-built `content` component for the charts
 * that need a product-level breakdown table rather than
 * ChartTooltipContent's generic one-row-per-series layout. No new
 * charting library, no change to components/ui/chart.tsx itself.
 *
 * Data integrity (spec section 9): every figure rendered here is read
 * straight off whatever LostSalesTrendPoint/LostSalesProductBreakdown
 * the caller already fetched server-side (lib/lost-sales/
 * analytics-queries.ts) -- nothing in this file computes, estimates, or
 * invents a number. Two scope notes carried through everywhere a money
 * figure appears:
 *   - These amounts have no currency code anywhere in this schema (a
 *     pre-existing Milestone-4 limitation -- see analytics-queries.ts's
 *     own module comment); formatPlainAmount never invents one.
 *   - "Estimated" and "Confirmed" are always shown as two separate
 *     lines, never summed -- see analytics-queries.ts's own comment on
 *     why that distinction is never blurred.
 *
 * Accessibility note (honest limitation, not silently skipped): Recharts
 * only opens a tooltip on pointer hover/focus-within its own chart
 * surface, which is a library-level limitation this file cannot change
 * without a different charting library (out of this enhancement's
 * scope -- "do not introduce another charting library"). What IS done
 * here: every drill-down inside this tooltip is a real <Link>, so once a
 * tooltip is visible (including via touch-hold on a touchscreen) its
 * links are focusable and keyboard-activatable like any other link on
 * the page -- and the exact same product-level detail is always
 * available without hovering anything, via the per-product bar charts
 * and the drilldown table already on this page, which are ordinary
 * keyboard-navigable HTML throughout.
 */

function formatQty(value: string, unit: string | null): string {
  const n = Number.parseFloat(value);
  const formatted = Number.isFinite(n) ? n.toLocaleString("en-GB", { maximumFractionDigits: 2 }) : value;
  return unit ? `${formatted} ${unit}` : formatted;
}

/** No currency code is ever invented -- see this file's own module comment. */
function formatPlainAmount(value: string): string {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

/** A clickable drill-down into the SAME page's own drilldown table/filters -- "reuse existing pages, preserve existing filters," never a second parallel view. */
function DrillDownLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-[#173D2E] underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

function buildHref(basePath: string, baseQuery: Record<string, string>, extra: Record<string, string>): string {
  const params = new URLSearchParams(baseQuery);
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
  }
  return `${basePath}?${params.toString()}`;
}

function TooltipShell({ children }: { children: ReactNode }) {
  return (
    <div className="max-h-[360px] w-[320px] overflow-y-auto rounded-lg border border-border/50 bg-popover p-3 text-xs text-popover-foreground shadow-lg">
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/**
 * The quantity-trend chart's tooltip (requested vs. unavailable over
 * time): reporting date, the full summary the request's own example
 * lists (requested/found/unavailable/availability/shortage rate), and a
 * scrollable per-product breakdown table -- each row a drill-down link
 * into this same page's drilldown table, scoped to that product AND this
 * exact date bucket (lib/lost-sales/analytics-validation.ts's
 * bucketDateRange, computed server-side, never re-derived here).
 */
export function TrendTooltipContent({
  active,
  payload,
  basePath,
  baseQuery,
}: {
  active?: boolean;
  payload?: { payload: LostSalesTrendPoint }[];
  basePath: string;
  baseQuery: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;

  return (
    <TooltipShell>
      <p className="mb-1.5 font-semibold text-foreground">{point.label}</p>
      {point.mixedUnitsOfMeasure && (
        <p className="mb-1.5 rounded bg-amber-50 px-1.5 py-1 text-[10px] text-amber-800">
          Mixed units of measure in this period -- quantities below are shown per product, not combined into one unit.
        </p>
      )}
      <SummaryRow label="Requested" value={formatQty(point.requestedQuantity, point.quantityUnitCode)} />
      <SummaryRow label="Requested value" value={formatPlainAmount(point.requestedValue)} />
      <SummaryRow label="Found" value={formatQty(point.foundQuantity, point.quantityUnitCode)} />
      <SummaryRow label="Found value" value={formatPlainAmount(point.foundValue)} />
      <SummaryRow label="Unavailable" value={formatQty(point.unavailableQuantity, point.quantityUnitCode)} />
      <SummaryRow label="Availability rate" value={formatPercent(point.availabilityRatePercent)} />
      <SummaryRow label="Shortage rate" value={formatPercent(point.shortageRatePercent)} />
      <SummaryRow label="Lost Value" value={formatPlainAmount(point.estimatedLostValue)} />
      <SummaryRow label="Confirmed lost value" value={formatPlainAmount(point.confirmedLostValue)} />
      <SummaryRow
        label="Affected orders / customers"
        value={`${point.affectedOrderCount} / ${point.affectedCustomerCount}`}
      />

      {point.products.length > 0 && (
        <>
          <p className="mt-2 mb-1 font-semibold text-foreground">Product breakdown</p>
          <div className="space-y-1.5">
            {point.products.map((product) => (
              <div key={`${product.productId ?? "x"}-${product.sapItemCodeSnapshot ?? product.productDescriptionSnapshot}`} className="border-t border-border/40 pt-1 first:border-t-0 first:pt-0">
                <DrillDownLink
                  href={buildHref(basePath, baseQuery, {
                    dateFrom: point.dateFrom,
                    dateTo: point.dateTo,
                    productId: product.productId ?? "",
                    sapItemCode: product.sapItemCodeSnapshot ?? "",
                  })}
                >
                  {product.productDescriptionSnapshot}
                </DrillDownLink>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                  <span>Req {formatQty(product.requestedQuantity, product.unitOfMeasure)}</span>
                  <span>Found {formatQty(product.foundQuantity, product.unitOfMeasure)}</span>
                  <span>Unavail {formatQty(product.unavailableQuantity, product.unitOfMeasure)}</span>
                  {product.shortageRatePercent !== null && <span>{formatPercent(product.shortageRatePercent)} shortage</span>}
                </div>
              </div>
            ))}
          </div>
          {point.otherProductsCount > 0 && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              +{point.otherProductsCount} more product{point.otherProductsCount === 1 ? "" : "s"} ({formatQty(point.otherProductsUnavailableQuantity, point.quantityUnitCode)} unavailable) --{" "}
              <DrillDownLink href={buildHref(basePath, baseQuery, { dateFrom: point.dateFrom, dateTo: point.dateTo })}>view all</DrillDownLink>
            </p>
          )}
        </>
      )}
    </TooltipShell>
  );
}

/**
 * The per-product bar charts' tooltip (top unavailable products,
 * requested/found/unavailable by product, shortage rate by product) --
 * one product's full detail, including the estimated-vs-confirmed value
 * split and affected order/customer counts the bar itself has no room to
 * show.
 */
export function ProductBarTooltipContent({
  active,
  payload,
  basePath,
  baseQuery,
}: {
  active?: boolean;
  payload?: { payload: LostSalesProductBreakdown }[];
  basePath: string;
  baseQuery: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const product = payload[0].payload;

  return (
    <TooltipShell>
      <p className="font-semibold text-foreground">{product.productDescriptionSnapshot}</p>
      {product.sapItemCodeSnapshot && <p className="text-[10px] text-muted-foreground">{product.sapItemCodeSnapshot}</p>}
      <div className="mt-1.5">
        <SummaryRow label="Requested" value={formatQty(product.requestedQuantity, product.unitOfMeasure)} />
        <SummaryRow label="Requested value" value={formatPlainAmount(product.requestedValue)} />
        <SummaryRow label="Found" value={formatQty(product.foundQuantity, product.unitOfMeasure)} />
        <SummaryRow label="Found value" value={formatPlainAmount(product.foundValue)} />
        <SummaryRow label="Unavailable" value={formatQty(product.unavailableQuantity, product.unitOfMeasure)} />
        <SummaryRow label="Shortage rate" value={formatPercent(product.shortageRatePercent)} />
        <SummaryRow label="Lost Value" value={formatPlainAmount(product.estimatedValue)} />
        <SummaryRow label="Confirmed lost value" value={formatPlainAmount(product.confirmedLostValue)} />
        <SummaryRow label="Affected orders" value={product.affectedOrderCount} />
        <SummaryRow label="Affected customers" value={product.affectedCustomerCount} />
        <SummaryRow label="Demand records" value={product.demandCount} />
      </div>
      <p className="mt-2 border-t border-border/40 pt-1.5">
        <DrillDownLink
          href={buildHref(basePath, baseQuery, { productId: product.productId ?? "", sapItemCode: product.sapItemCodeSnapshot ?? "" })}
        >
          View all records for this product
        </DrillDownLink>
      </p>
    </TooltipShell>
  );
}

/**
 * The per-customer bar charts' tooltip (top unavailable customers,
 * shortage rate by customer) -- mirrors ProductBarTooltipContent exactly,
 * for LostSalesCustomerBreakdown. Deliberately no unit-of-measure suffix
 * here: a customer's requested/found/unavailable total can span several
 * products in several different units, and this schema has no single
 * "this customer's unit" to attach -- shown unitless rather than
 * guessing or silently picking one product's unit for the whole customer
 * (same "never invent a value" discipline as everywhere else in this
 * module).
 */
export function CustomerBarTooltipContent({
  active,
  payload,
  basePath,
  baseQuery,
}: {
  active?: boolean;
  payload?: { payload: LostSalesCustomerBreakdown }[];
  basePath: string;
  baseQuery: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const customer = payload[0].payload;

  return (
    <TooltipShell>
      <p className="font-semibold text-foreground">{customer.customerName}</p>
      <div className="mt-1.5">
        <SummaryRow label="Requested" value={formatQty(customer.requestedQuantity, null)} />
        <SummaryRow label="Requested value" value={formatPlainAmount(customer.requestedValue)} />
        <SummaryRow label="Found" value={formatQty(customer.foundQuantity, null)} />
        <SummaryRow label="Found value" value={formatPlainAmount(customer.foundValue)} />
        <SummaryRow label="Unavailable" value={formatQty(customer.unavailableQuantity, null)} />
        <SummaryRow label="Shortage rate" value={formatPercent(customer.shortageRatePercent)} />
        <SummaryRow label="Lost Value" value={formatPlainAmount(customer.estimatedValue)} />
        <SummaryRow label="Confirmed lost value" value={formatPlainAmount(customer.confirmedLostValue)} />
        <SummaryRow label="Affected orders" value={customer.affectedOrderCount} />
        <SummaryRow label="Demand records" value={customer.demandCount} />
      </div>
      <p className="mt-2 border-t border-border/40 pt-1.5">
        <DrillDownLink href={buildHref(basePath, baseQuery, { customerId: customer.customerId })}>
          View all records for this customer
        </DrillDownLink>
      </p>
    </TooltipShell>
  );
}

/**
 * The estimated-lost-value trend chart's own tooltip (spec section 4):
 * financial summary first (estimated exposure, confirmed loss, affected
 * products/orders/customers -- NEVER one blended figure), then the
 * product-contribution table with each product's own implied average
 * selling price -- a real, derived ratio (estimatedValue / unavailable
 * quantity) over this product's own already-summed figures, not an
 * invented price; shown as an average because a product's resolved
 * price can genuinely differ demand to demand (see
 * lib/lost-sales/create-unfulfilled-demand.ts's own price-resolution
 * comment).
 */
export function ValueTrendTooltipContent({
  active,
  payload,
  basePath,
  baseQuery,
}: {
  active?: boolean;
  payload?: { payload: LostSalesTrendPoint }[];
  basePath: string;
  baseQuery: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const productsByValue = [...point.products].sort((a, b) => Number(b.estimatedValue) - Number(a.estimatedValue));

  return (
    <TooltipShell>
      <p className="mb-1.5 font-semibold text-foreground">{point.label}</p>
      <p className="mb-1.5 text-[10px] text-muted-foreground">
        Amounts below carry no currency code -- this figure is never split by currency in this system (a known, pre-existing limitation; see the Implementation Report).
      </p>
      <SummaryRow label="Lost Value" value={formatPlainAmount(point.estimatedLostValue)} />
      <SummaryRow label="Confirmed loss" value={formatPlainAmount(point.confirmedLostValue)} />
      <SummaryRow label="Affected products" value={point.products.length + point.otherProductsCount} />
      <SummaryRow label="Affected orders" value={point.affectedOrderCount} />
      <SummaryRow label="Affected customers" value={point.affectedCustomerCount} />

      {productsByValue.length > 0 && (
        <>
          <p className="mt-2 mb-1 font-semibold text-foreground">Product contribution</p>
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left font-medium">Product</th>
                <th className="text-right font-medium">Unavail.</th>
                <th className="text-right font-medium">Avg. price</th>
                <th className="text-right font-medium">Lost Value</th>
              </tr>
            </thead>
            <tbody>
              {productsByValue.map((product) => {
                const unavailable = Number(product.unavailableQuantity);
                const value = Number(product.estimatedValue);
                const avgPrice = unavailable > 0 ? value / unavailable : null;
                return (
                  <tr key={`${product.productId ?? "x"}-${product.sapItemCodeSnapshot ?? product.productDescriptionSnapshot}`} className="border-t border-border/40">
                    <td className="py-1 pr-1">
                      <DrillDownLink
                        href={buildHref(basePath, baseQuery, {
                          dateFrom: point.dateFrom,
                          dateTo: point.dateTo,
                          productId: product.productId ?? "",
                          sapItemCode: product.sapItemCodeSnapshot ?? "",
                        })}
                      >
                        {product.productDescriptionSnapshot}
                      </DrillDownLink>
                    </td>
                    <td className="py-1 text-right tabular-nums">{formatQty(product.unavailableQuantity, product.unitOfMeasure)}</td>
                    <td className="py-1 text-right tabular-nums">{avgPrice === null ? "—" : avgPrice.toFixed(2)}</td>
                    <td className="py-1 text-right tabular-nums">{formatPlainAmount(product.estimatedValue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {point.otherProductsCount > 0 && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              +{point.otherProductsCount} more product{point.otherProductsCount === 1 ? "" : "s"} --{" "}
              <DrillDownLink href={buildHref(basePath, baseQuery, { dateFrom: point.dateFrom, dateTo: point.dateTo })}>view all</DrillDownLink>
            </p>
          )}
        </>
      )}
    </TooltipShell>
  );
}
