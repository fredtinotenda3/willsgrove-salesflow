import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getOrderById } from "@/lib/order-queries";
import { isValidId } from "@/lib/http";
import Sidebar from "../../components/sidebar";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_STYLES,
  initialsFor,
  avatarColorFor,
  type OrderStatusValue,
} from "@/lib/order-display";
import { ArrowLeft, ExternalLink, Ban } from "lucide-react";
import PickingPanel from "./picking-panel";

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
  const statusLabel = ORDER_STATUS_LABELS[order.status as OrderStatusValue] ?? order.status;
  const statusStyle = ORDER_STATUS_STYLES[order.status as OrderStatusValue] ?? "bg-gray-100 text-gray-500";
  const canAuthorize = user.role === "SALES_MANAGER" || user.role === "ADMINISTRATOR";
  const notPickable = NOT_PICKABLE_STATUSES.has(order.status);

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">
              Workspace / Operations / Picking &amp; Fulfilment / {order.reference}
            </p>
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
              lines={order.lines.map((line) => ({
                id: line.id,
                lineNumber: line.lineNumber,
                originalProductDescription: line.originalProductDescription,
                requestedQuantity: line.requestedQuantity,
                requestedUnitCode: line.requestedUnitCode,
              }))}
            />
          )}

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
