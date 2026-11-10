import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isValidId } from "@/lib/http";
import { getUnfulfilledDemandDetail } from "@/lib/lost-sales/queries";
import {
  UNFULFILLED_DEMAND_STATUS_LABELS,
  UNFULFILLED_DEMAND_STATUS_STYLES,
  DECISION_TYPE_LABELS,
  DECISION_SOURCE_LABELS,
  LOST_SALE_REASON_LABELS,
} from "@/lib/lost-sales/display";
import { initialsFor, avatarColorFor, formatOrderDateTime } from "@/lib/order-display";
import Sidebar from "../../components/sidebar";
import { ArrowLeft } from "lucide-react";
import DecisionPanel from "./decision-panel";

/**
 * Milestone 4 (Lost-Sales Management). One UnfulfilledDemand record, its
 * full traceability chain, and its complete decision/lost-sale history --
 * spec section 6. DecisionPanel is the one client-rendered island here
 * (record-decision form + confirm-lost-sale form), same split as every
 * other order-scoped page in this project (PickingPanel, HandoverPanel).
 *
 * canConfirmLost is computed server-side and passed down as a plain
 * boolean, same "derived-boolean-prop" convention as
 * app/fulfilment/[id]/page.tsx's canAuthorize -- the Client Component
 * never sees the full user object.
 */
export const instant = false;

type RouteParams = { params: Promise<{ id: string }> };

export default async function LostSaleDetailPage({ params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  if (!isValidId(id)) {
    notFound();
  }

  const demand = await getUnfulfilledDemandDetail(id);
  if (!demand) {
    notFound();
  }

  const canConfirmLost = user.role === "SALES_MANAGER" || user.role === "ADMINISTRATOR";

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Lost Sales / {demand.orderReference}</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">{demand.productDescriptionSnapshot}</h2>
          </div>
          <Link
            href="/lost-sales"
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
          >
            <ArrowLeft size={15} />
            Back to List
          </Link>
        </header>

        <div className="space-y-6 p-8">
          <section className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold ${avatarColorFor(demand.customerName)}`}
              >
                {initialsFor(demand.customerName)}
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-[#17251E]">{demand.customerName}</h1>
                <p className="text-xs text-gray-400">
                  Order{" "}
                  <Link href={`/orders/${demand.orderId}`} className="font-semibold text-[#173D2E] hover:underline">
                    {demand.orderReference}
                  </Link>
                  {demand.sapItemCodeSnapshot && <> · SAP {demand.sapItemCodeSnapshot}</>}
                </p>
              </div>
            </div>
            <span
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                UNFULFILLED_DEMAND_STATUS_STYLES[demand.status] ?? "bg-gray-100 text-gray-500"
              }`}
            >
              {UNFULFILLED_DEMAND_STATUS_LABELS[demand.status] ?? demand.status}
            </span>
          </section>

          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              ["Requested", demand.requestedQuantity],
              ["Found", demand.foundQuantity],
              ["Unavailable", demand.unavailableQuantity],
              ["Outstanding", demand.outstandingQuantity],
              ["Cancelled", demand.cancelledQuantity],
              ["Substituted", demand.substitutedQuantity],
              ["Confirmed lost", demand.confirmedLostQuantity],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-[#E8EBE6] bg-white p-3 text-center">
                <p className="text-sm font-bold text-[#17251E]">{value}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
              </div>
            ))}
          </section>

          {demand.expectedFollowUpDate && (
            <p className="text-xs text-gray-500">
              Expected follow-up: <span className="font-semibold text-gray-700">{formatOrderDateTime(demand.expectedFollowUpDate)}</span>
              {demand.followUpRemarks ? ` -- ${demand.followUpRemarks}` : ""}
            </p>
          )}

          <DecisionPanel
            unfulfilledDemandId={demand.id}
            canConfirmLost={canConfirmLost}
            unavailableQuantity={demand.unavailableQuantity}
            outstandingQuantity={demand.outstandingQuantity}
            cancelledQuantity={demand.cancelledQuantity}
            substitutedQuantity={demand.substitutedQuantity}
            confirmedLostQuantity={demand.confirmedLostQuantity}
          />

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-sm font-bold text-[#17251E]">Decision History</h2>
            </div>
            {demand.decisionEvents.length === 0 ? (
              <p className="px-6 py-8 text-center text-xs text-gray-400">No customer decision has been recorded yet.</p>
            ) : (
              <ul className="divide-y divide-gray-50">
                {demand.decisionEvents.map((event) => (
                  <li key={event.id} className="px-6 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-[#17251E]">
                        {DECISION_TYPE_LABELS[event.decisionType] ?? event.decisionType} -- {event.quantity}
                      </p>
                      <p className="text-[10px] text-gray-400">{formatOrderDateTime(event.decidedAt)}</p>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">
                      Source: {DECISION_SOURCE_LABELS[event.source] ?? event.source} · Recorded by {event.recordedByName}
                      {event.customerContactName ? ` · Contact: ${event.customerContactName}` : ""}
                    </p>
                    {event.substituteProductDescriptionSnapshot && (
                      <p className="mt-1 text-[11px] text-gray-500">
                        Substitute: {event.substituteProductDescriptionSnapshot}
                        {event.substituteSapItemCodeSnapshot ? ` (${event.substituteSapItemCodeSnapshot})` : ""}
                      </p>
                    )}
                    {event.reason && <p className="mt-1 text-[11px] text-gray-500">Reason: {event.reason}</p>}
                    {event.remarks && <p className="mt-1 text-[11px] text-gray-400">{event.remarks}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-sm font-bold text-[#17251E]">Confirmed Lost Sales</h2>
            </div>
            {demand.lostSaleRecords.length === 0 ? (
              <p className="px-6 py-8 text-center text-xs text-gray-400">No lost sale has been confirmed for this record.</p>
            ) : (
              <ul className="divide-y divide-gray-50">
                {demand.lostSaleRecords.map((record) => (
                  <li key={record.id} className="px-6 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-[#17251E]">
                        {record.quantity} -- {LOST_SALE_REASON_LABELS[record.reason] ?? record.reason}
                      </p>
                      <p className="text-[10px] text-gray-400">{formatOrderDateTime(record.confirmedAt)}</p>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">
                      Confirmed by {record.confirmedByName} · Source: {DECISION_SOURCE_LABELS[record.decisionSource] ?? record.decisionSource}
                    </p>
                    <p className="mt-1 text-[11px] text-gray-500">
                      {record.estimatedValue !== null
                        ? `Estimated value: ${record.estimatedValue} (${
                            record.estimatedValueSource === "ORDER_LINE_APPROVED_PRICE"
                              ? "order's own approved price"
                              : "price list"
                          }) -- estimate only`
                        : "No estimated value available -- no historically valid price resolved for this product."}
                    </p>
                    {record.reasonDetail && <p className="mt-1 text-[11px] text-gray-400">{record.reasonDetail}</p>}
                    {record.remarks && <p className="mt-1 text-[11px] text-gray-400">{record.remarks}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
