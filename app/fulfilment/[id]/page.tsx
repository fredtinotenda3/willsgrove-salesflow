import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getOrderById } from "@/lib/order-queries";
import { isValidId } from "@/lib/http";
import Sidebar from "../../components/sidebar";
import OrderLifecycleStepper from "../../components/order-lifecycle-stepper";
import {
  getEffectiveOrderStatus,
  getOrderLifecycleSteps,
  initialsFor,
  avatarColorFor,
} from "@/lib/order-display";
import { INVOICE_RECONCILIATION_STATUS_LABELS, INVOICE_RECONCILIATION_STATUS_STYLES } from "@/lib/invoice-reconciliation/display";
import { UNFULFILLED_DEMAND_STATUS_LABELS, UNFULFILLED_DEMAND_STATUS_STYLES } from "@/lib/lost-sales/display";
import { ArrowLeft, ArrowUpRight, ExternalLink, Ban, Receipt, PackageCheck, TrendingDown } from "lucide-react";
import PickingPanel from "./picking-panel";
import DispatchPanel from "./dispatch-panel";

/**
 * Milestone 3B (SAP Invoice Handover Specification -- warehouse
 * picking). The picking "workstation" for one order: start/record/
 * complete/authorize, all in PickingPanel (the one client-rendered
 * island here, same split as app/orders/[id]/page.tsx + HandoverPanel).
 * This page deliberately does NOT duplicate the full order detail page's
 * content (pricing, documents, status history, the handover panel
 * itself) -- it links to /orders/[id] for that instead, and stays
 * focused on the one job its name implies.
 *
 * Reads the session and a live order record directly, same reason as
 * every other order-scoped page in this project.
 */
export const instant = false;

type RouteParams = { params: Promise<{ id: string }> };

const NOT_PICKABLE_STATUSES = new Set(["DRAFT", "CANCELLED", "REJECTED"]);

export default async function FulfilmentOrderPage({ params }: RouteParams) {
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
  // Final completion phase, section 7: derived label, not the raw
  // status -- see lib/order-display.ts's getEffectiveOrderStatus.
  const { label: statusLabel, style: statusStyle } = getEffectiveOrderStatus({ status: order.status, dispatchStatuses: order.dispatchStatuses, invoiceState: order.invoiceState, completed: order.completed });
  const canAuthorize = user.role === "SALES_MANAGER" || user.role === "ADMINISTRATOR";
  const notPickable = NOT_PICKABLE_STATUSES.has(order.status);

  // Part 3: same lifecycle indicator + real related-record links as the
  // order detail page, reusing the same getOrderById data -- never a
  // second definition.
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
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            {/* Part 3: breadcrumbs as real navigation, not plain text. */}
            <nav aria-label="Breadcrumb" className="text-xs text-gray-400">
              <Link href="/" className="hover:text-[#173D2E] hover:underline">Workspace</Link>
              {" / "}
              <Link href="/fulfilment" className="hover:text-[#173D2E] hover:underline">Picking &amp; Fulfilment</Link>
              {" / "}
              <span className="text-gray-500">{order.reference}</span>
            </nav>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">{order.reference}</h2>
          </div>
          <Link
            href="/fulfilment"
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
          >
            <ArrowLeft size={15} />
            Back to Queue
          </Link>
        </header>

        <div className="space-y-6 p-8">
          <section className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold ${avatarColorFor(customerName)}`}
                >
                  {initialsFor(customerName)}
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-[#17251E]">{customerName}</h1>
                  <p className="text-xs text-gray-400">
                    {order.customerPoReference ? `PO ${order.customerPoReference}` : "No customer PO reference"}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${statusStyle}`}>
                  {statusLabel}
                </span>
              </div>
            </div>

            <Link
              href={`/orders/${order.id}`}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
            >
              <ExternalLink size={14} />
              View full order
            </Link>
          </section>

          {/* Part 3: lifecycle/progress indicator -- same derivation as
              the order detail page, see getOrderLifecycleSteps's comment. */}
          {lifecycleSteps && (
            <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <OrderLifecycleStepper steps={lifecycleSteps} />
            </section>
          )}

          {/* Part 3: forward links into whatever later stages this order
              has actually reached -- real ids from getOrderById, same
              data the order detail page's Related Records panel uses. */}
          {(order.matchedSapInvoices.length > 0 || order.unfulfilledDemands.length > 0) && (
            <section className="flex flex-wrap items-center gap-3">
              {order.matchedSapInvoices.map((invoice: { id: string; sapDocNum: string; reconciliationStatus: string; delivered: boolean }) => (
                <div key={invoice.id} className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/invoice-reconciliation/${invoice.id}`}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
                  >
                    <Receipt size={13} />
                    Invoice {invoice.sapDocNum}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${INVOICE_RECONCILIATION_STATUS_STYLES[invoice.reconciliationStatus] ?? "bg-gray-100 text-gray-500"}`}>
                      {INVOICE_RECONCILIATION_STATUS_LABELS[invoice.reconciliationStatus] ?? invoice.reconciliationStatus}
                    </span>
                    <ArrowUpRight size={12} />
                  </Link>
                  {invoice.delivered && (
                    <Link
                      href={`/delivered-orders/${invoice.id}`}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
                    >
                      <PackageCheck size={13} />
                      Delivered Orders record
                      <ArrowUpRight size={12} />
                    </Link>
                  )}
                </div>
              ))}

              {order.unfulfilledDemands.map((demand: { id: string; status: string }) => (
                <Link
                  key={demand.id}
                  href={`/lost-sales/${demand.id}`}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
                >
                  <TrendingDown size={13} />
                  Lost Sale record
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${UNFULFILLED_DEMAND_STATUS_STYLES[demand.status] ?? "bg-gray-100 text-gray-500"}`}>
                    {UNFULFILLED_DEMAND_STATUS_LABELS[demand.status] ?? demand.status}
                  </span>
                  <ArrowUpRight size={12} />
                </Link>
              ))}
            </section>
          )}

          {notPickable ? (
            <section className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-6">
              <Ban size={18} className="mt-0.5 shrink-0 text-gray-400" />
              <div>
                <p className="text-sm font-semibold text-gray-700">This order isn&apos;t eligible for picking</p>
                <p className="mt-1 text-xs text-gray-400">
                  Its status is &quot;{statusLabel}&quot;. Only an order that isn&apos;t a draft, cancelled, or
                  rejected can be picked.
                </p>
              </div>
            </section>
          ) : (
            <PickingPanel
              orderId={order.id}
              canAuthorize={canAuthorize}
              // Final completion phase, section 6: lets the panel disable
              // + explain "Start a new picking session" once this order has
              // a dispatch that's already departed or delivered -- the
              // same condition lib/picking/start-picking.ts enforces
              // server-side, so the button being disabled here is purely
              // an explanation, never the only thing standing in the way.
              dispatchHasDepartedOrDelivered={order.dispatchStatuses.some(
                (status) => status === "DEPARTED" || status === "DELIVERED"
              )}
              lines={order.lines.map((line) => ({
                id: line.id,
                lineNumber: line.lineNumber,
                originalProductDescription: line.originalProductDescription,
                requestedQuantity: line.requestedQuantity,
                requestedUnitCode: line.requestedUnitCode,
              }))}
            />
          )}

          {/* Milestone 10 (Communication Channels & Fulfilment). Dispatch
              and delivery -- shown regardless of pickability, since an
              order's dispatch history stays relevant even once picking
              itself is done; the panel's own empty state covers "nothing
              outstanding yet." */}
          <DispatchPanel
            orderId={order.id}
            locked={order.completed || (order.dispatchStatuses.length > 0 && order.dispatchStatuses.every((status) => status === "DELIVERED" || status === "CANCELLED") && order.dispatchStatuses.some((status) => status === "DELIVERED"))}
          />

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
