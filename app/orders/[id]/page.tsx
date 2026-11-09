import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getOrderById } from "@/lib/order-queries";
import { isValidId } from "@/lib/http";
import Sidebar from "../../components/sidebar";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_STYLES,
  VERIFICATION_STATUS_LABELS,
  VERIFICATION_STATUS_STYLES,
  DOCUMENT_TYPE_LABELS,
  orderSourceLabel,
  formatOrderDate,
  formatOrderDateTime,
  formatOrderAmount,
  formatFileSize,
  initialsFor,
  avatarColorFor,
  type OrderStatusValue,
  type VerificationStatusValue,
  type DocumentTypeValue,
} from "@/lib/order-display";

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
} from "lucide-react";
import HandoverPanel from "./handover-panel";

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
  const statusLabel = ORDER_STATUS_LABELS[order.status as OrderStatusValue] ?? order.status;
  const statusStyle = ORDER_STATUS_STYLES[order.status as OrderStatusValue] ?? "bg-gray-100 text-gray-500";

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Sales Management / Orders / {order.reference}</p>
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
              {/* Milestone 2C: one-click re-order -- pre-fills a NEW
                  manual order with this order's lines/quantities for a
                  human to review and submit; nothing is created yet. */}
              <Link
                href={`/orders/new?repeatFrom=${order.id}`}
                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                <RotateCcw size={14} />
                Repeat this order
              </Link>

              <div className="rounded-xl border border-[#E8EBE6] bg-white px-5 py-4 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Order Total</p>
                <p className="mt-1 text-xl font-bold text-[#17251E]">
                  {formatOrderAmount(order.total, order.currency)}
                </p>
              </div>
            </div>
          </section>

          {/* Unbuilt-workflow notice -- honest, not a fake interactive panel */}
          <section className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-xs text-amber-800">
              Product verification, pricing and approval are not built yet in this milestone. The data below
              (customer, lines, documents, status history) is real and live; price/verification fields will
              show &quot;Pending&quot; until that workflow exists.
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-y border-gray-100 bg-gray-50/70">
                          <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            #
                          </th>
                          <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            Product
                          </th>
                          <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            Quantity
                          </th>
                          <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            Customer Price
                          </th>
                          <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            Approved Price
                          </th>
                          <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            Line Total
                          </th>
                          <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            Verification
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.lines.map((line) => {
                          const verificationLabel =
                            VERIFICATION_STATUS_LABELS[line.verificationStatus as VerificationStatusValue] ??
                            line.verificationStatus;
                          const verificationStyle =
                            VERIFICATION_STATUS_STYLES[line.verificationStatus as VerificationStatusValue] ??
                            "bg-gray-100 text-gray-500";

                          return (
                            <tr key={line.id} className="border-b border-gray-50">
                              <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-400">
                                {line.lineNumber}
                              </td>
                              <td className="px-6 py-4">
                                <p className="text-xs font-medium text-gray-700">
                                  {line.originalProductDescription}
                                </p>
                                {line.sapItemCodeSnapshot && (
                                  <p className="mt-1 text-[10px] text-gray-400">
                                    SAP item: {line.sapItemCodeSnapshot}
                                  </p>
                                )}
                                {line.salesNotes && (
                                  <p className="mt-1 text-[10px] italic text-gray-400">{line.salesNotes}</p>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">
                                {line.requestedQuantity} {line.requestedUnitCode}
                              </td>
                              <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">
                                {line.customerUnitPrice !== null
                                  ? `${order.currency} ${line.customerUnitPrice}`
                                  : "Not provided"}
                              </td>
                              <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">
                                {line.approvedUnitPrice !== null
                                  ? `${order.currency} ${line.approvedUnitPrice}`
                                  : "Pending"}
                              </td>
                              <td className="whitespace-nowrap px-6 py-4 text-xs font-semibold text-gray-700">
                                {line.lineTotal !== null ? `${order.currency} ${line.lineTotal}` : "Pending"}
                              </td>
                              <td className="whitespace-nowrap px-6 py-4">
                                <span
                                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${verificationStyle}`}
                                >
                                  {verificationLabel}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Totals */}
                <div className="flex justify-end border-t border-gray-100 px-6 py-4">
                  <div className="w-64 space-y-2">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Subtotal</span>
                      <span>{formatOrderAmount(order.subtotal, order.currency)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Tax</span>
                      <span>{formatOrderAmount(order.taxTotal, order.currency)}</span>
                    </div>
                    <div className="flex justify-between border-t border-gray-100 pt-2 text-sm font-bold text-[#17251E]">
                      <span>Total</span>
                      <span>{formatOrderAmount(order.total, order.currency)}</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Documents */}
              <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
                <h2 className="text-[15px] font-bold text-[#17251E]">Documents</h2>
                <p className="mt-1 text-xs text-gray-400">
                  Original purchase order and any supporting files attached to this order.
                </p>

                {order.documents.length === 0 ? (
                  <p className="mt-4 rounded-lg bg-gray-50 px-4 py-6 text-center text-xs text-gray-400">
                    No documents have been uploaded for this order.
                  </p>
                ) : (
                  <div className="mt-4 space-y-2">
                    {order.documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                            <FileText size={16} />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-gray-700">{doc.originalFileName}</p>
                            <p className="mt-0.5 text-[10px] text-gray-400">
                              {DOCUMENT_TYPE_LABELS[doc.documentType as DocumentTypeValue] ?? doc.documentType} ·{" "}
                              {formatFileSize(doc.fileSize)} · uploaded by {doc.uploadedBy?.name ?? "unknown"} on{" "}
                              {formatOrderDateTime(doc.createdAt)}
                            </p>
                          </div>
                        </div>

                        <a
                          href={doc.downloadUrl}
                          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-50"
                        >
                          <Download size={13} />
                          Download
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Original message/PO text, as pasted in at intake */}
              {order.originalSourceText && (
                <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
                  <h2 className="text-[15px] font-bold text-[#17251E]">Original Message</h2>
                  <p className="mt-1 text-xs text-gray-400">
                    The customer&apos;s message or PO text exactly as pasted in at intake.
                  </p>
                  <p className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600">
                    {order.originalSourceText}
                  </p>
                </section>
              )}

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

              {/* Milestone 2C: manual, per-order SAP handover generation */}
              <HandoverPanel orderId={order.id} />

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
