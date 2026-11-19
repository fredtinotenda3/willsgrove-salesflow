import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isValidId } from "@/lib/http";
import { getUnfulfilledDemandDetail } from "@/lib/lost-sales/queries";
import {
  UNFULFILLED_DEMAND_STATUS_LABELS,
  UNFULFILLED_DEMAND_STATUS_STYLES,
  DECISION_SOURCE_LABELS,
  LOST_SALE_REASON_LABELS,
} from "@/lib/lost-sales/display";
import { initialsFor, avatarColorFor, formatOrderDateTime } from "@/lib/order-display";
import Sidebar from "../../components/sidebar";
import { ArrowLeft } from "lucide-react";

/**
 * Milestone 4 (Lost-Sales Management). One UnfulfilledDemand record, its
 * full traceability chain, and its confirmed-lost-sale history -- spec
 * section 6.
 *
 * Real Business Data Onboarding round (spec PART A): there is no longer a
 * DecisionPanel or "Decision History" section on this page -- the
 * Customer Decision workflow was removed outright. The moment a shortage
 * is recorded, it is automatically both cancelled AND confirmed lost in
 * the same transaction (see lib/lost-sales/create-unfulfilled-demand.ts),
 * so "Confirmed Lost Sales" below is now populated automatically, with
 * decisionSource "AUTOMATIC_SYSTEM_RECORDED" on every entry, rather than
 * waiting on a human decision step this page used to collect.
 *
 * This page still surfaces the AUTOMATIC lost-sales estimate
 * (demand.estimatedValue/estimatedUnitPrice/estimatedValueSource, spec
 * section 1) and, when this record was superseded by or itself
 * supersedes another one (a re-pick/correction on the same order line --
 * see lib/lost-sales/create-unfulfilled-demand.ts's module comment),
 * a traceability banner linking to the other record -- so "update, not
 * duplicate" is visible to the user, not just correct under the hood.
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

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen md:pl-[260px]">
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

          {demand.status === "SUPERSEDED" && (
            <section className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-xs text-slate-600">
              This record was superseded by a later picking correction on the same order line and is now
              read-only history.
              {demand.supersededByDemandRef && (
                <>
                  {" "}
                  The current record is{" "}
                  <Link
                    href={`/lost-sales/${demand.supersededByDemandRef.id}`}
                    className="font-semibold text-[#173D2E] hover:underline"
                  >
                    here
                  </Link>
                  .
                </>
              )}
            </section>
          )}
          {demand.supersedesDemandRef && (
            <section className="rounded-xl border border-[#E8EBE6] bg-white px-5 py-4 text-xs text-gray-500">
              This record replaces an earlier shortage on the same order line (unavailable quantity was{" "}
              {demand.supersedesDemandRef.unavailableQuantity} before this correction) --{" "}
              <Link
                href={`/lost-sales/${demand.supersedesDemandRef.id}`}
                className="font-semibold text-[#173D2E] hover:underline"
              >
                view the superseded record
              </Link>
              .
            </section>
          )}

          <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
            <h2 className="text-sm font-bold text-[#17251E]">Estimated Lost Sales (automatic)</h2>
            <p className="mt-1 text-[11px] text-gray-400">
              Calculated automatically the moment this shortage was recorded -- Unavailable Quantity x Applicable
              Selling Price. This is the same quantity that was automatically cancelled and confirmed lost below --
              see Confirmed Lost Sales for the actually-confirmed record.
            </p>
            <p className="mt-3 text-sm font-semibold text-[#17251E]">
              {demand.estimatedValue !== null
                ? `${demand.estimatedValue} (unit price ${demand.estimatedUnitPrice} -- ${
                    demand.estimatedValueSource === "ORDER_LINE_APPROVED_PRICE"
                      ? "order's own approved price"
                      : "price list"
                  })`
                : "No estimated value available -- no historically valid price resolved for this product."}
            </p>
          </section>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-sm font-bold text-[#17251E]">Confirmed Lost Sales (automatic)</h2>
            </div>
            {demand.lostSaleRecords.length === 0 ? (
              <p className="px-6 py-8 text-center text-xs text-gray-400">
                No lost sale was recorded for this shortage -- see Estimated Lost Sales above if a price could not be resolved.
              </p>
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
