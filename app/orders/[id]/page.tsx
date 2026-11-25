import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getOrderById } from "@/lib/order-queries";
import { isValidId } from "@/lib/http";
import Sidebar from "../../components/sidebar";
import OrderLifecycleStepper from "../../components/order-lifecycle-stepper";
import RecordInvoicePanel from "./record-invoice-panel";
import {
  ORDER_STATUS_LABELS,
  getEffectiveOrderStatus,
  getOrderLifecycleSteps,
  DOCUMENT_TYPE_LABELS,
  orderSourceLabel,
  formatOrderDate,
  formatOrderDateTime,
  formatOrderAmount,
  formatOrderAmountWithEstimate,
  formatLineAmountWithEstimate,
  formatFileSize,
  initialsFor,
  avatarColorFor,
  type OrderStatusValue,
  type DocumentTypeValue,
} from "@/lib/order-display";
import { INVOICE_RECONCILIATION_STATUS_LABELS, INVOICE_RECONCILIATION_STATUS_STYLES } from "@/lib/invoice-reconciliation/display";
import { CLAIM_STATUS_LABELS, CLAIM_STATUS_STYLES } from "@/lib/invoice-claims/display";
import { UNFULFILLED_DEMAND_STATUS_LABELS, UNFULFILLED_DEMAND_STATUS_STYLES } from "@/lib/lost-sales/display";

import {
  ArrowLeft,
  FileText,
  Download,
  MapPin,
  CalendarDays,
  Hash,
  Mail,
  Phone,
  Clock3,
  AlertTriangle,
  RotateCcw,
  Printer,
  ClipboardList,
  Receipt,
  PackageCheck,
  FileWarning,
  TrendingDown,
  ArrowUpRight,
  Truck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import DispatchAssignmentHistory from "../../components/dispatch-assignment-history";
import HandoverPanel from "./handover-panel";
import SapIntegrationPanel from "./sap-integration-panel";

// Milestone 3 completion (Warehouse Assembly Form & Partial Availability).
// Hidden only for a dead order -- nothing to assemble for one that's
// cancelled or rejected. The assembly-form route itself also hard-404s
// on these (and on DRAFT, which createOrder() never actually produces --
// see lib/orders.ts), so a stale link can't bypass this either; this set
// just controls whether the button appears at all.
const NOT_ASSEMBLABLE_STATUSES = new Set(["CANCELLED", "REJECTED"]);

// Same Cache Components escape hatch already used on the dashboard
// (app/page.tsx) and for the same reason: this page reads the current
// session and a live order record directly (no route-handler round trip),
// so it needs the request every time and can't be prerendered into the
// static shell. Using an async Server Component that receives `params`
// directly (rather than the `useParams()` client hook) also sidesteps the
// other build failure this route previously had -- "useParams() in a
// Client Component outside of <Suspense>" -- since there is no client
// hook involved at all.
export const instant = false;

type RouteParams = { params: Promise<{ id: string }> };

export default async function OrderDetailPage({ params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  if (!isValidId(id)) {
    notFound();
  }

  const order = await getOrderById(id);
  if (!order) {
    notFound();
  }

  const customerName = order.customer?.name ?? "Unknown customer";
  // Final completion phase, section 7: the header badge shows the
  // DERIVED Departed/Delivered label (never a second stored status) once
  // dispatch has actually progressed past READY_TO_INVOICE, rather than
  // staying frozen on "Ready to Invoice" -- see lib/order-display.ts's
  // getEffectiveOrderStatus. Every other use of order.status on this page
  // (the assembly-form gate, the HandoverPanel's readyToInvoice prop, the
  // statusHistory timeline) intentionally keeps reading the REAL stored
  // status, since those are genuine workflow/business-rule checks, not a
  // user-facing "what state is this order in" label.
  const { label: statusLabel, style: statusStyle } = getEffectiveOrderStatus({ status: order.status, dispatchStatuses: order.dispatchStatuses });

  // Part 3: lifecycle indicator + related-records panel, both derived
  // from data getOrderById already returns (see that function's own Part
  // 3 comment) -- no new query, no second definition of "delivered."
  const lifecycleSteps = getOrderLifecycleSteps({
    status: order.status,
    dispatchStatuses: order.dispatchStatuses,
    hasMatchedInvoice: order.matchedSapInvoices.length > 0,
    delivered: order.matchedSapInvoices.some((invoice: { delivered: boolean }) => invoice.delivered),
  });

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen md:pl-[260px]">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            {/* Part 3: breadcrumbs as real navigation, not plain text. */}
            <nav aria-label="Breadcrumb" className="text-xs text-gray-400">
              <Link href="/" className="hover:text-[#173D2E] hover:underline">Workspace</Link>
              {" / "}
              <Link href="/orders" className="hover:text-[#173D2E] hover:underline">Orders</Link>
              {" / "}
              <span className="text-gray-500">{order.reference}</span>
            </nav>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">{order.reference}</h2>
          </div>

          <Link
            href="/orders"
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
          >
            <ArrowLeft size={15} />
            Back to Orders
          </Link>
        </header>

        <div className="space-y-6 p-8">
          {/* Title row */}
          <section className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">{order.reference}</h1>
                <span className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${statusStyle}`}>
                  {statusLabel}
                </span>
                {order.isDemo && (
                  <span className="rounded-full bg-gray-100 px-3 py-1.5 text-[11px] font-semibold text-gray-500">
                    Demo
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-gray-500">
                {order.customerPoReference
                  ? `Customer PO reference: ${order.customerPoReference}`
                  : "No customer PO reference recorded."}
              </p>
            </div>

            <div className="flex items-start gap-3">
              {/* Milestone 3 completion (Warehouse Assembly Form). Opens
                  in a new tab -- a printable document, not a navigation
                  away from the order. Visible once the order has lines
                  and isn't cancelled/rejected; printing itself is never
                  role-restricted (picking has no dedicated role either --
                  see lib/picking/start-picking.ts's module comment) and
                  has no side effect for any role to be restricted from. */}
              {order.lines.length > 0 && !NOT_ASSEMBLABLE_STATUSES.has(order.status) && (
                <Link
                  href={`/orders/${order.id}/assembly-form`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
                >
                  <Printer size={14} />
                  Print Warehouse Assembly Form
                </Link>
              )}

              {/* Milestone 2C: one-click re-order -- pre-fills a NEW
                  manual order with this order's lines/quantities for a
                  human to review and submit; nothing is created yet.
                  Real-world bug fix: this is a plain <a>, not next/link's
                  <Link>, so clicking it always forces a full browser
                  navigation to /orders/new. It used to be a <Link>, and
                  staff repeating an order right after submitting a
                  DIFFERENT one would land back on that OTHER order's
                  stale "Order Received" confirmation screen instead of
                  a form pre-filled with THIS order's lines -- Next's
                  client Router Cache (cacheComponents: true in
                  next.config.ts) was reusing the previously rendered
                  /orders/new component instance, createdOrder state and
                  all, instead of giving this navigation a fresh one. See
                  the matching comment above app/orders/new/page.tsx's
                  own createdOrder state. */}
              <a
                href={`/orders/new?repeatFrom=${order.id}`}
                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                <RotateCcw size={14} />
                Repeat this order
              </a>

              {(() => {
                // Order Total card. The approved/SAP-confirmed `order.total`
                // wins when it exists; otherwise the derived total (line
                // subtotals + tax at the rates configured for each product,
                // lib/order-pricing.ts) is shown, marked "~" when it is
                // incomplete so a partial figure is never passed off as the
                // whole. "Pending pricing" now appears only when NO line has
                // a price at all.
                const amount = formatOrderAmountWithEstimate(
                  order.total,
                  order.estimatedTotal,
                  order.estimatedTotalIsPartial,
                  order.currency
                );
                return (
                  <div className="rounded-xl border border-[#E8EBE6] bg-white px-5 py-4 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Order Total</p>
                    <p
                      className={`mt-1 text-xl font-bold ${amount.isEstimate ? "text-amber-700" : "text-[#17251E]"}`}
                      title={
                        amount.isEstimate
                          ? (order.pricing.gapsExplanation ?? "Calculated from each line's price at order entry -- not yet the approved total.")
                          : undefined
                      }
                    >
                      {amount.text}
                    </p>
                    <p className="mt-1 text-[10px] text-gray-400">
                      {order.pricing.pricedLineCount === 0
                        ? "No line has a price yet."
                        : order.pricing.taxUnconfiguredLineCount > 0
                          ? "Tax added only where a rate is configured."
                          : "Subtotal plus configured tax."}
                    </p>
                  </div>
                );
              })()}
            </div>
          </section>

          {/* Part 3: lifecycle/progress indicator. Omitted for DRAFT/
              CANCELLED/REJECTED -- see getOrderLifecycleSteps's own
              comment for why a linear stepper doesn't fit those. */}
          {lifecycleSteps && (
            <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <OrderLifecycleStepper steps={lifecycleSteps} />
            </section>
          )}

          {/* Real-world fix (native invoice recording): renders nothing of
              its own when this order has nothing dispatched-but-
              uninvoiced (the common case) -- see record-invoice-panel.tsx's
              own comment for what this closes. */}
          <RecordInvoicePanel orderId={order.id} />

          <section className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-xs text-amber-800">
              Line prices come from the customer&apos;s own price (if one is set) or their price list when the
              order is created, or are entered manually. They are kept as a snapshot, so later price changes never
              alter this order.
            </p>
          </section>

          <div className="grid grid-cols-3 gap-6">
            {/* Left column */}
            <div className="col-span-2 space-y-6">
              {/* Line items */}
              <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
                <div className="p-6">
                  <h2 className="text-[15px] font-bold text-[#17251E]">Order Lines</h2>
                  <p className="mt-1 text-xs text-gray-400">
                    {order.lines.length} line item{order.lines.length === 1 ? "" : "s"}
                  </p>
                </div>

                {order.lines.length === 0 ? (
                  <div className="px-6 py-10 text-center">
                    <p className="text-xs font-semibold text-gray-600">No line items yet</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {order.originalSourceText || order.documents.length > 0
                        ? "This order was submitted as a pasted message and/or an attached document. There's no automatic line extraction yet (that's a later milestone) -- review what's below and add lines manually."
                        : "Add lines to this order once the details are confirmed."}
                    </p>
                  </div>
                ) : (
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow className="bg-gray-50/70 hover:bg-gray-50/70">
                        <TableHead className="w-10 px-4 text-[10px] uppercase tracking-wider text-gray-400">#</TableHead>
                        <TableHead className="px-4 text-[10px] uppercase tracking-wider text-gray-400">Product</TableHead>
                        <TableHead className="w-24 px-4 text-right text-[10px] uppercase tracking-wider text-gray-400">Qty</TableHead>
                        <TableHead className="w-32 px-4 text-right text-[10px] uppercase tracking-wider text-gray-400">Unit Price</TableHead>
                        <TableHead className="w-28 px-4 text-right text-[10px] uppercase tracking-wider text-gray-400">Tax</TableHead>
                        <TableHead className="w-32 px-4 text-right text-[10px] uppercase tracking-wider text-gray-400">Line Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {order.lines.map((line) => {
                        // SAP-reconciled lineTotal wins once it exists; before that
                        // the derived (subtotal + configured tax) total is shown.
                        const lineAmount = formatLineAmountWithEstimate(line.lineTotal, line.estimatedLineTotal, order.currency);

                        return (
                          <TableRow key={line.id}>
                            <TableCell className="px-4 align-top text-xs text-gray-400">{line.lineNumber}</TableCell>
                            <TableCell className="px-4 align-top whitespace-normal">
                              <p className="text-xs font-medium text-gray-700">{line.originalProductDescription}</p>
                              {line.sapItemCodeSnapshot && (
                                <p className="mt-0.5 text-[10px] text-gray-400">SAP item: {line.sapItemCodeSnapshot}</p>
                              )}
                              {line.salesNotes && <p className="mt-0.5 text-[10px] italic text-gray-400">{line.salesNotes}</p>}
                            </TableCell>
                            <TableCell className="px-4 text-right align-top text-xs text-gray-600">
                              {line.requestedQuantity} {line.requestedUnitCode}
                            </TableCell>
                            <TableCell className="px-4 text-right align-top text-xs text-gray-600">
                              {line.unitPrice !== null ? (
                                <>
                                  <span>
                                    {order.currency} {line.unitPrice}
                                  </span>
                                  {line.priceSource === "PRICE_LIST_CURRENT" && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge variant="outline" className="ml-1 border-amber-300 px-1.5 text-[9px] text-amber-700">
                                          list
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        No price was saved on this line. Shown from the customer&apos;s current price list; it is not a stored price.
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                  {line.approvedUnitPrice !== null && (
                                    <Badge variant="outline" className="ml-1 px-1.5 text-[9px]">
                                      approved
                                    </Badge>
                                  )}
                                </>
                              ) : (
                                <span className="text-gray-400">No price</span>
                              )}
                            </TableCell>
                            <TableCell className="px-4 text-right align-top text-xs text-gray-600">
                              {line.lineTax !== null ? (
                                `${order.currency} ${Number(line.lineTax).toFixed(2)}`
                              ) : line.lineSubtotal !== null ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help text-gray-400">Not set</span>
                                  </TooltipTrigger>
                                  <TooltipContent>No tax rate is configured for this product, so no tax is added.</TooltipContent>
                                </Tooltip>
                              ) : (
                                <span className="text-gray-300">--</span>
                              )}
                            </TableCell>
                            <TableCell className="px-4 text-right align-top text-xs font-semibold text-gray-700">
                              {lineAmount.isEstimate ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help">{lineAmount.text}</span>
                                  </TooltipTrigger>
                                  <TooltipContent>Calculated from this line&apos;s price (plus configured tax); not yet the SAP-confirmed total.</TooltipContent>
                                </Tooltip>
                              ) : (
                                lineAmount.text
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}

                {/* Totals: derived from the line snapshots (lib/order-pricing.ts); the
                    approved/SAP-confirmed order-level amounts win when they exist. */}
                <div className="flex justify-end border-t border-gray-100 px-6 py-4">
                  <div className="w-full max-w-xs space-y-2">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Subtotal</span>
                      <span>{formatOrderAmount(order.subtotal ?? order.pricing.subtotal, order.currency)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Tax</span>
                      <span>
                        {order.taxTotal !== null
                          ? formatOrderAmount(order.taxTotal, order.currency)
                          : order.pricing.pricedLineCount === 0
                            ? "--"
                            : order.pricing.taxUnconfiguredLineCount === order.pricing.pricedLineCount
                              ? "Not configured"
                              : formatOrderAmount(order.pricing.taxTotal, order.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-gray-100 pt-2 text-sm font-bold text-[#17251E]">
                      <span>Total</span>
                      <span>{formatOrderAmount(order.total ?? order.pricing.total, order.currency)}</span>
                    </div>
                    {order.pricing.gapsExplanation && order.total === null && (
                      <p className="text-[10px] text-amber-700">{order.pricing.gapsExplanation}</p>
                    )}
                  </div>
                </div>
              </section>

              {/* Original Message & Documents -- one compact section. The pasted
                  message is collapsed behind a trigger (first lines previewed,
                  full text in a height-capped scroll area) and attachments are
                  single-line rows, so a long PO text or several files no longer
                  push the rest of the page down. */}
              <section className="rounded-xl border border-[#E8EBE6] bg-white p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-[15px] font-bold text-[#17251E]">Original Message &amp; Documents</h2>
                  <p className="text-[10px] text-gray-400">
                    {order.documents.length} file{order.documents.length === 1 ? "" : "s"}
                    {order.originalSourceText ? " · pasted message" : ""}
                  </p>
                </div>

                {order.originalSourceText && (
                  <Collapsible className="mt-3 rounded-lg bg-gray-50">
                    <div className="flex items-start gap-2 px-3 py-2">
                      <p className="line-clamp-2 flex-1 whitespace-pre-wrap text-xs text-gray-600">{order.originalSourceText}</p>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="xs" className="shrink-0 text-[11px] text-gray-500">
                          Show full message
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent>
                      <ScrollArea className="max-h-48 border-t border-gray-100">
                        <p className="whitespace-pre-wrap px-3 py-2 text-xs text-gray-600">{order.originalSourceText}</p>
                      </ScrollArea>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {order.documents.length === 0 ? (
                  <p className="mt-3 text-xs text-gray-400">No documents have been uploaded for this order.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {order.documents.map((doc) => (
                      <li key={doc.id} className="flex items-center gap-3 px-3 py-2">
                        <FileText size={14} className="shrink-0 text-blue-600" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-gray-700" title={doc.originalFileName}>
                            {doc.originalFileName}
                          </p>
                          <p className="truncate text-[10px] text-gray-400">
                            {DOCUMENT_TYPE_LABELS[doc.documentType as DocumentTypeValue] ?? doc.documentType} ·{" "}
                            {formatFileSize(doc.fileSize)} · {doc.uploadedBy?.name ?? "unknown"} ·{" "}
                            {formatOrderDateTime(doc.createdAt)}
                          </p>
                        </div>
                        <Button asChild variant="outline" size="xs">
                          <a href={doc.downloadUrl}>
                            <Download />
                            Download
                          </a>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Status history */}
              <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
                <h2 className="text-[15px] font-bold text-[#17251E]">Status History</h2>

                <div className="mt-4 space-y-4">
                  {order.statusHistory.map((entry, index) => (
                    <div key={entry.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#173D2E] text-white">
                          <Clock3 size={13} />
                        </div>
                        {index < order.statusHistory.length - 1 && (
                          <div className="mt-1 h-full w-px flex-1 bg-gray-200" />
                        )}
                      </div>
                      <div className="pb-4">
                        <p className="text-xs font-semibold text-gray-700">
                          {entry.fromStatus
                            ? `${ORDER_STATUS_LABELS[entry.fromStatus as OrderStatusValue] ?? entry.fromStatus} → ${ORDER_STATUS_LABELS[entry.toStatus as OrderStatusValue] ?? entry.toStatus}`
                            : `Order ${ORDER_STATUS_LABELS[entry.toStatus as OrderStatusValue] ?? entry.toStatus}`}
                        </p>
                        <p className="mt-0.5 text-[11px] text-gray-400">
                          {formatOrderDateTime(entry.createdAt)} · {entry.changedBy?.name ?? "System"}
                        </p>
                        {entry.notes && <p className="mt-1 text-xs text-gray-500">{entry.notes}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Fulfilment history (Section 7 follow-up): picking start/
                  end times and driver/assistant/vehicle assignments, shown
                  on THIS (active) order page too -- not only on Delivered
                  Orders, where this detail already existed. Omitted
                  entirely (not shown empty) when nothing has happened yet,
                  same convention as the Original Message section above. */}
              {(order.pickingSessions.length > 0 || order.dispatches.length > 0) && (
                <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
                  <h2 className="text-[15px] font-bold text-[#17251E]">Fulfilment History</h2>
                  <p className="mt-1 text-xs text-gray-400">Picking and dispatch events recorded against this order.</p>

                  <div className="mt-4 space-y-3">
                    {order.pickingSessions.map((session) => (
                      <div key={session.id} className="rounded-lg border border-[#F0F2EF] p-3">
                        <div className="flex items-center gap-2">
                          <PackageCheck size={14} className="text-[#315C43]" />
                          <p className="text-xs font-semibold text-gray-700">Picking session · {session.status}</p>
                        </div>
                        <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-gray-500 sm:grid-cols-3">
                          <p>Started: {formatOrderDateTime(session.startedAt)} ({session.startedByName})</p>
                          <p>
                            Completed:{" "}
                            {session.completedAt ? `${formatOrderDateTime(session.completedAt)} (${session.completedByName ?? "Not Available"})` : "Not yet completed"}
                          </p>
                          <p>
                            Authorized:{" "}
                            {session.authorizedAt ? `${formatOrderDateTime(session.authorizedAt)} (${session.authorizedByName ?? "Not Available"})` : "Not yet authorized"}
                          </p>
                        </div>
                      </div>
                    ))}

                    {order.dispatches.map((dispatch) => (
                      <div key={dispatch.id} className="rounded-lg border border-[#F0F2EF] p-3">
                        <div className="flex items-center gap-2">
                          <Truck size={14} className="text-[#315C43]" />
                          <p className="text-xs font-semibold text-gray-700">Dispatch · {dispatch.status}</p>
                        </div>
                        <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-gray-500 sm:grid-cols-2">
                          <p>Driver: {dispatch.driverName ?? "Not Available"}</p>
                          <p>Assistant: {dispatch.assistantName ?? "Not Available"}</p>
                          <p>Vehicle: {dispatch.vehicleRegistration ?? dispatch.vehicleOrCourierReference ?? "Not Available"}</p>
                          <p>
                            Departed:{" "}
                            {dispatch.departedAt ? `${formatOrderDateTime(dispatch.departedAt)} (${dispatch.departedByName ?? "Not Available"})` : "Not yet departed"}
                          </p>
                        </div>

                        <DispatchAssignmentHistory entries={dispatch.assignmentHistory} />

                        {/* Real-world fix ("Order Fulfilment History should
                            include all products accepted and reject if
                            any"): the physical delivery outcome, per
                            product -- absent entirely (not shown empty)
                            until a delivery outcome has actually been
                            recorded for this dispatch, same convention as
                            the rest of this section. */}
                        {dispatch.delivery && (
                          <div className="mt-2 border-t border-[#F0F2EF] pt-2">
                            <p className="text-[11px] font-medium text-gray-600">
                              Delivery outcome: {dispatch.delivery.outcome.replaceAll("_", " ")} ·{" "}
                              {formatOrderDateTime(dispatch.delivery.recordedAt)} ({dispatch.delivery.recordedByName})
                              {dispatch.delivery.recipientName && ` · received by ${dispatch.delivery.recipientName}`}
                            </p>
                            <div className="mt-1.5 space-y-1">
                              {dispatch.delivery.lines.map((line, i) => (
                                <p key={i} className="text-[11px] text-gray-500">
                                  {line.description}
                                  {line.sapItemCode && ` (${line.sapItemCode})`}: accepted {line.acceptedQuantity}
                                  {Number(line.rejectedQuantity) > 0 && (
                                    <span className="font-medium text-red-600">
                                      {" "}
                                      · rejected {line.rejectedQuantity}
                                      {line.rejectionReason ? ` (${line.rejectionReason})` : ""}
                                    </span>
                                  )}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Right column */}
            <div className="space-y-6">
              {/* Customer */}
              <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
                <h2 className="text-[15px] font-bold text-[#17251E]">Customer</h2>

                <div className="mt-4 flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg text-xs font-bold ${avatarColorFor(customerName)}`}
                  >
                    {initialsFor(customerName)}
                  </div>
                  <p className="text-sm font-semibold text-gray-700">{customerName}</p>
                </div>

                <div className="mt-4 space-y-2 text-xs text-gray-500">
                  {order.customer?.email && (
                    <div className="flex items-center gap-2">
                      <Mail size={13} className="text-gray-400" />
                      {order.customer.email}
                    </div>
                  )}
                  {order.customer?.phone && (
                    <div className="flex items-center gap-2">
                      <Phone size={13} className="text-gray-400" />
                      {order.customer.phone}
                    </div>
                  )}
                  {order.customerLocation && (
                    <div className="flex items-start gap-2">
                      <MapPin size={13} className="mt-0.5 shrink-0 text-gray-400" />
                      <span>
                        {order.customerLocation.label && `${order.customerLocation.label} — `}
                        {[order.customerLocation.addressLine1, order.customerLocation.addressLine2, order.customerLocation.city, order.customerLocation.province]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </div>
                  )}
                </div>
              </section>

              {/* Order details */}
              <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
                <h2 className="text-[15px] font-bold text-[#17251E]">Order Details</h2>

                <dl className="mt-4 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-2 text-gray-400">
                      <Hash size={13} />
                      Source
                    </dt>
                    <dd className="font-medium text-gray-700">{orderSourceLabel(order.source)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-2 text-gray-400">
                      <CalendarDays size={13} />
                      Order Date
                    </dt>
                    <dd className="font-medium text-gray-700">{formatOrderDate(order.orderDate)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-2 text-gray-400">
                      <CalendarDays size={13} />
                      Requested Delivery
                    </dt>
                    <dd className="font-medium text-gray-700">{formatOrderDate(order.requestedDeliveryDate)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-400">Currency</dt>
                    <dd className="font-medium text-gray-700">{order.currency}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-400">Received</dt>
                    <dd className="font-medium text-gray-700">{formatOrderDateTime(order.timing.receivedAt)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-400">Created By</dt>
                    <dd className="font-medium text-gray-700">{order.createdBy?.name ?? "—"}</dd>
                  </div>
                  {order.deliveryAddress && (
                    <div>
                      <dt className="text-gray-400">Delivery Address</dt>
                      <dd className="mt-1 font-medium text-gray-700">{order.deliveryAddress}</dd>
                    </div>
                  )}
                </dl>
              </section>

              {/* Milestone 2C: manual, per-order SAP handover generation. Milestone 3C: hard-gated on READY_TO_INVOICE -- see HandoverPanel's module comment. */}
              <HandoverPanel orderId={order.id} readyToInvoice={order.status === "READY_TO_INVOICE"} />

              {/* Milestone 9 (SAP Business One Integration): sales-order submission status, self-fetched -- see that panel's own module comment. */}
              <SapIntegrationPanel orderId={order.id} canSubmit={user.role === "ADMINISTRATOR" || user.role === "SALES_MANAGER"} />

              {/* Part 3: forward navigation into every stage of this
                  order's real lifecycle that actually has a record --
                  every link below is a REAL id already returned by
                  getOrderById (lib/order-queries.ts), never guessed. */}
              {(lifecycleSteps || order.matchedSapInvoices.length > 0 || order.invoiceClaims.length > 0 || order.unfulfilledDemands.length > 0) && (
                <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
                  <h2 className="text-[15px] font-bold text-[#17251E]">Related Records</h2>
                  <div className="mt-4 space-y-2">
                    {lifecycleSteps && (
                      <Link
                        href={`/fulfilment/${order.id}`}
                        className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2.5 text-xs font-medium text-gray-700 transition hover:border-gray-200 hover:bg-gray-50"
                      >
                        <span className="flex items-center gap-2">
                          <ClipboardList size={14} className="text-gray-400" />
                          Picking &amp; Fulfilment
                        </span>
                        <ArrowUpRight size={13} className="text-gray-400" />
                      </Link>
                    )}

                    {order.matchedSapInvoices.map((invoice: { id: string; sapDocNum: string; reconciliationStatus: string; delivered: boolean; deliveryOutcome: string | null }) => (
                      <div key={invoice.id} className="space-y-2">
                        <Link
                          href={`/invoice-reconciliation/${invoice.id}`}
                          className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2.5 text-xs font-medium text-gray-700 transition hover:border-gray-200 hover:bg-gray-50"
                        >
                          <span className="flex items-center gap-2">
                            <Receipt size={14} className="text-gray-400" />
                            Invoice {invoice.sapDocNum}
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${INVOICE_RECONCILIATION_STATUS_STYLES[invoice.reconciliationStatus] ?? "bg-gray-100 text-gray-500"}`}>
                              {INVOICE_RECONCILIATION_STATUS_LABELS[invoice.reconciliationStatus] ?? invoice.reconciliationStatus}
                            </span>
                          </span>
                          <ArrowUpRight size={13} className="text-gray-400" />
                        </Link>

                        {invoice.delivered && (
                          <Link
                            href={`/delivered-orders/${invoice.id}`}
                            className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2.5 text-xs font-medium text-gray-700 transition hover:border-gray-200 hover:bg-gray-50"
                          >
                            <span className="flex items-center gap-2">
                              <PackageCheck size={14} className="text-gray-400" />
                              Delivered Orders record
                              {invoice.deliveryOutcome && (
                                <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700">
                                  {invoice.deliveryOutcome === "WITH_CLAIM" ? "With Claim" : "No Claim"}
                                </span>
                              )}
                            </span>
                            <ArrowUpRight size={13} className="text-gray-400" />
                          </Link>
                        )}
                      </div>
                    ))}

                    {order.invoiceClaims.map((claim: { id: string; claimReference: string; status: string }) => (
                      <Link
                        key={claim.id}
                        href={`/invoice-claims/${claim.id}`}
                        className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2.5 text-xs font-medium text-gray-700 transition hover:border-gray-200 hover:bg-gray-50"
                      >
                        <span className="flex items-center gap-2">
                          <FileWarning size={14} className="text-gray-400" />
                          Claim {claim.claimReference}
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CLAIM_STATUS_STYLES[claim.status] ?? "bg-gray-100 text-gray-500"}`}>
                            {CLAIM_STATUS_LABELS[claim.status] ?? claim.status}
                          </span>
                        </span>
                        <ArrowUpRight size={13} className="text-gray-400" />
                      </Link>
                    ))}

                    {/* Real-world fix ("ID pages... should carry also the amount
                        of lost sales, not just quantity"): estimatedValue is
                        null, never 0, when no historically valid price could be
                        resolved at the time (lib/lost-sales/estimate-value.ts's
                        "never invent a price" rule) -- shown as "No price
                        available" rather than silently omitted or defaulted to
                        zero. */}
                    {order.unfulfilledDemands.map(
                      (demand: {
                        id: string;
                        status: string;
                        confirmedLostQuantity: string;
                        estimatedValue: string | null;
                      }) => (
                        <Link
                          key={demand.id}
                          href={`/lost-sales/${demand.id}`}
                          className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2.5 text-xs font-medium text-gray-700 transition hover:border-gray-200 hover:bg-gray-50"
                        >
                          <span className="flex items-center gap-2">
                            <TrendingDown size={14} className="text-gray-400" />
                            Lost Sale record
                            <span className="text-gray-400">
                              ({demand.confirmedLostQuantity}
                              {demand.estimatedValue !== null
                                ? ` · ${formatOrderAmount(demand.estimatedValue, order.currency)}`
                                : " · no price available"}
                              )
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${UNFULFILLED_DEMAND_STATUS_STYLES[demand.status] ?? "bg-gray-100 text-gray-500"}`}>
                              {UNFULFILLED_DEMAND_STATUS_LABELS[demand.status] ?? demand.status}
                            </span>
                          </span>
                          <ArrowUpRight size={13} className="text-gray-400" />
                        </Link>
                      )
                    )}
                  </div>
                </section>
              )}

              {/* Internal notes */}
              {order.internalNotes && (
                <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
                  <h2 className="text-[15px] font-bold text-[#17251E]">Internal Notes</h2>
                  <p className="mt-3 whitespace-pre-wrap text-xs text-gray-600">{order.internalNotes}</p>
                </section>
              )}
            </div>
          </div>

          {/* Footer */}
          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
