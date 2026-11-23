import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDeliveredOrderDetail } from "@/lib/delivered-orders/queries";
import Sidebar from "../../components/sidebar";
import { PageHeader, SectionCard, EmptyState } from "../../reports/_components/ui";
import OrderLifecycleStepper from "../../components/order-lifecycle-stepper";
import DispatchAssignmentHistory from "../../components/dispatch-assignment-history";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOrderLifecycleSteps, formatFileSize, formatOrderAmount, ORDER_STATUS_LABELS, DOCUMENT_TYPE_LABELS, type OrderStatusValue, type DocumentTypeValue } from "@/lib/order-display";
import { ArrowLeft, ArrowUpRight, Download } from "lucide-react";

/**
 * Management Analytics spec, Part 6: the full lifecycle detail view for
 * one delivered order/invoice -- sections (A) Original PO through (H)
 * Durations, exactly as specified. Every field below is read straight
 * from lib/delivered-orders/queries.ts's getDeliveredOrderDetail; no
 * value is computed or guessed in this file.
 *
 * Cache Components (next.config.ts: cacheComponents: true) can't
 * prerender this page's request-time auth + DB read into a static
 * shell -- same "instant = false" escape hatch every other
 * authenticated page in this codebase already uses (see app/page.tsx's
 * own comment, and app/delivered-orders/page.tsx, this page's own list
 * view, right next to it).
 */
export const instant = false;

function formatDuration(ms: number | null): string {
  if (ms === null) return "Not Available";
  if (ms < 0) return "Not Available";
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(" ");
}

function formatDate(value: string | null): string {
  if (!value) return "Not Available";
  return new Date(value).toLocaleString();
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[#A4ACA4]">{label}</p>
      <p className="text-sm font-medium text-[#17251E]">{value ?? "Not Available"}</p>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const isClaim = outcome === "WITH_CLAIM" || outcome === "PARTIALLY_REJECTED" || outcome === "FULLY_REJECTED";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${isClaim ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
      {outcome.replaceAll("_", " ")}
    </span>
  );
}

export default async function DeliveredOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  const detail = await getDeliveredOrderDetail(id);

  if (!detail) {
    return (
      <div className="min-h-screen bg-[#F7F8F6]">
        <Sidebar />
        <main className="min-h-screen md:pl-[260px] p-8">
          <EmptyState message="This invoice has no recorded delivery outcome, or does not exist." />
          <Link href="/delivered-orders" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#173D2E]">
            <ArrowLeft size={14} /> Back to Delivered Orders
          </Link>
        </main>
      </div>
    );
  }

  const { purchaseOrder, pickingSessions, invoice, dispatches, deliveryOutcome, claims, people, durations } = detail;

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen md:pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            {/* Part 3: breadcrumbs as real navigation, not plain text. */}
            <nav aria-label="Breadcrumb" className="text-xs text-gray-400">
              <Link href="/" className="hover:text-[#173D2E] hover:underline">Workspace</Link>
              {" / "}
              <Link href="/delivered-orders" className="hover:text-[#173D2E] hover:underline">Delivered Orders</Link>
              {" / "}
              <span className="text-gray-500">{invoice.sapDocNum}</span>
            </nav>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Invoice {invoice.sapDocNum}</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Operations / Delivered Orders / Full history"
            title={`Invoice ${invoice.sapDocNum}`}
            description="Complete lifecycle: purchase order, picking, invoicing, dispatch, delivery outcome and any claim raised against it."
            actions={
              <Link href="/delivered-orders" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#718078] hover:text-[#17251E]">
                <ArrowLeft size={14} /> Back to Delivered Orders
              </Link>
            }
          />

          {/* Lifecycle: a delivered order has, by definition, completed every
              stage -- derived by the same getOrderLifecycleSteps the order page
              uses (delivered = an invoice delivery outcome is on record), never a
              separate definition. */}
          {(() => {
            const steps = getOrderLifecycleSteps({
              status: purchaseOrder?.status ?? "READY_TO_INVOICE",
              dispatchStatuses: dispatches.map((d) => d.status),
              hasMatchedInvoice: true,
              delivered: true,
            });
            return steps ? (
              <section className="rounded-xl border border-[#E8EBE6] bg-white p-4">
                <OrderLifecycleStepper steps={steps} />
              </section>
            ) : null;
          })()}

          {/* (A) Original PO */}
          <SectionCard title="A. Original purchase order" description="As received from the customer, before any approval or fulfilment">
            {purchaseOrder ? (
              <div className="space-y-5">
                {/* Part 3: forward/backward link to the order's own full
                    detail page (lines, documents, status history, SAP
                    handover) -- this section only summarizes it. Real id
                    from getDeliveredOrderDetail, never guessed. */}
                {purchaseOrder.orderId && (
                  <Link
                    href={`/orders/${purchaseOrder.orderId}`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#173D2E] hover:underline"
                  >
                    View full order detail <ArrowUpRight size={13} />
                  </Link>
                )}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Field label="Customer" value={purchaseOrder.customerName} />
                  <Field label="SAP customer code" value={purchaseOrder.customerSapCode} />
                  <Field label="Order reference" value={purchaseOrder.orderReference} />
                  <Field label="Customer PO reference" value={purchaseOrder.customerPoReference} />
                  <Field label="Order date" value={formatDate(purchaseOrder.orderDate)} />
                  <Field label="PO received" value={formatDate(purchaseOrder.receivedAt)} />
                  <Field label="Salesperson" value={purchaseOrder.salespersonName} />
                  <Field label="Currency" value={purchaseOrder.currency} />
                </div>
                {purchaseOrder.originalSourceText && (
                  <details className="rounded-lg border border-[#E7ECE7] bg-[#FAFBF9] p-3 text-xs text-[#536158]">
                    <summary className="cursor-pointer font-semibold text-[#17251E]">Original order document / message</summary>
                    <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px]">{purchaseOrder.originalSourceText}</pre>
                  </details>
                )}
                <Table className="table-fixed text-xs">
                  <TableHeader>
                    <TableRow className="bg-[#F7F8F6] hover:bg-[#F7F8F6]">
                      <TableHead className="w-8 px-3 text-[10px] uppercase tracking-wide text-[#849087]">#</TableHead>
                      <TableHead className="px-3 text-[10px] uppercase tracking-wide text-[#849087]">Product</TableHead>
                      <TableHead className="w-24 px-3 text-right text-[10px] uppercase tracking-wide text-[#849087]">Qty</TableHead>
                      <TableHead className="w-24 px-3 text-right text-[10px] uppercase tracking-wide text-[#849087]">Unit price</TableHead>
                      <TableHead className="hidden w-24 px-3 text-right text-[10px] uppercase tracking-wide text-[#849087] md:table-cell">Tax</TableHead>
                      <TableHead className="w-28 px-3 text-right text-[10px] uppercase tracking-wide text-[#849087]">Line total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchaseOrder.lines.map((l) => (
                      <TableRow key={l.lineNumber}>
                        <TableCell className="px-3 align-top">{l.lineNumber}</TableCell>
                        <TableCell className="px-3 align-top whitespace-normal">
                          {l.description}
                          {l.sapItemCode && <span className="ml-1 text-[#A4ACA4]">({l.sapItemCode})</span>}
                        </TableCell>
                        <TableCell className="px-3 text-right align-top tabular-nums">{l.requestedQuantity}</TableCell>
                        <TableCell className="px-3 text-right align-top tabular-nums">{l.unitPrice ?? "-"}</TableCell>
                        <TableCell className="hidden px-3 text-right align-top tabular-nums md:table-cell">{l.lineTax ?? "-"}</TableCell>
                        <TableCell className="px-3 text-right align-top tabular-nums">{l.lineTotal ?? l.lineTotalDerived ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={5} className="px-3 text-right text-[#536158]">Subtotal</TableCell>
                      <TableCell className="px-3 text-right tabular-nums">{formatOrderAmount(purchaseOrder.pricing.subtotal, purchaseOrder.currency ?? "USD")}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={5} className="px-3 text-right text-[#536158]">Tax</TableCell>
                      <TableCell className="px-3 text-right tabular-nums">{formatOrderAmount(purchaseOrder.pricing.taxTotal, purchaseOrder.currency ?? "USD")}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={5} className="px-3 text-right font-semibold">Order total</TableCell>
                      <TableCell className="px-3 text-right font-semibold tabular-nums">{formatOrderAmount(purchaseOrder.pricing.total, purchaseOrder.currency ?? "USD")}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
                {purchaseOrder.pricing.gapsExplanation && (
                  <p className="text-[11px] text-amber-700">{purchaseOrder.pricing.gapsExplanation}</p>
                )}
              </div>
            ) : (
              <EmptyState message="This invoice was never matched to a CustomerOrder in SalesFlow -- it may have been invoiced directly against an order placed outside this system." />
            )}
          </SectionCard>

          {/* (B) Picking / fulfilment */}
          <SectionCard title="B. Picking and fulfilment" description="Every picking session recorded against this order">
            {pickingSessions.length === 0 ? (
              <EmptyState message="No picking session was recorded for this order." />
            ) : (
              <div className="space-y-5">
                {pickingSessions.map((session) => (
                  <div key={session.id} className="rounded-lg border border-[#E7ECE7] p-4">
                    <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Field label="Status" value={session.status} />
                      <Field label="Started by" value={`${session.startedByName} · ${formatDate(session.startedAt)}`} />
                      <Field label="Completed by" value={session.completedByName ? `${session.completedByName} · ${formatDate(session.completedAt)}` : "Not Available"} />
                      <Field label="Authorized by" value={session.authorizedByName ? `${session.authorizedByName} · ${formatDate(session.authorizedAt)}` : "Not Available"} />
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-[#F0F2EF]">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#F7F8F6] text-[10px] uppercase tracking-wide text-[#849087]">
                          <tr>
                            <th className="px-3 py-2">Product</th>
                            <th className="px-3 py-2 text-right">Requested</th>
                            <th className="px-3 py-2 text-right">Found</th>
                            <th className="px-3 py-2 text-right">Unavailable</th>
                            <th className="px-3 py-2">Picked by</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2EF]">
                          {session.lines.map((line, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2">{line.description} {line.sapItemCode && <span className="text-[#A4ACA4]">({line.sapItemCode})</span>}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{line.requestedQuantity}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{line.foundQuantity ?? "-"}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{line.unavailableQuantity ?? "-"}</td>
                              <td className="px-3 py-2">{line.pickedByName ? `${line.pickedByName} · ${formatDate(line.pickedAt)}` : "Not Available"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* (C) Invoice */}
          <SectionCard title="C. Invoice" description="The SAP invoice this order was billed against. SalesFlow delivery status is tracked separately from SAP's own reconciliation/accounting status, below.">
            {/* Part 3: the invoice reconciliation record behind this
                delivered order -- `id` here is the SAP invoice id the
                route itself was loaded with (getDeliveredOrderDetail is
                keyed by it), so this is the same id, never a guess. */}
            <Link
              href={`/invoice-reconciliation/${id}`}
              className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#173D2E] hover:underline"
            >
              View invoice reconciliation record <ArrowUpRight size={13} />
            </Link>
            {/* Real-world fix (native invoice recording): this invoice has no
                SAP import behind it -- recorded directly in SalesFlow
                against its own order -- so that's stated plainly rather
                than left to look like every other, SAP-imported row here. */}
            {invoice.isNativelyRecorded && (
              <p className="mb-4 rounded-lg bg-cyan-50 px-3 py-2 text-xs font-medium text-cyan-800">
                Recorded directly in SalesFlow -- not imported from a SAP export.
              </p>
            )}
            <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Invoice number" value={invoice.sapDocNum} />
              <Field label="Invoice date" value={formatDate(invoice.invoiceDate)} />
              <Field label="Currency" value={invoice.currencyCode} />
              <Field label="Total" value={invoice.total ? `${invoice.currencyCode ?? ""} ${invoice.total}` : null} />
              <Field label="SAP reconciliation status" value={invoice.reconciliationStatus} />
              <Field label="Cancelled/reversed in SAP" value={invoice.isCancelledOrReversed ? "Yes" : "No"} />
            </div>
            <div className="overflow-x-auto rounded-lg border border-[#E7ECE7]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F7F8F6] text-[10px] uppercase tracking-wide text-[#849087]">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Product code</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">Qty invoiced</th>
                    <th className="px-3 py-2 text-right">Unit price</th>
                    <th className="px-3 py-2 text-right">Line total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F2EF]">
                  {invoice.lines.map((l) => (
                    <tr key={l.lineNumber}>
                      <td className="px-3 py-2">{l.lineNumber}</td>
                      <td className="px-3 py-2">{l.sapItemCode ?? "-"}</td>
                      <td className="px-3 py-2">{l.description ?? "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.quantityInvoiced}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.unitPrice ?? "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.lineTotal ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* (D) Dispatch */}
          <SectionCard title="D. Dispatch" description="Vehicle, driver and quantity dispatched, plus the physical (truck/gate) delivery outcome recorded at drop-off">
            {dispatches.length === 0 ? (
              <EmptyState message="No dispatch was recorded for this order." />
            ) : (
              <div className="space-y-5">
                {dispatches.map((dispatch) => (
                  <div key={dispatch.id} className="rounded-lg border border-[#E7ECE7] p-4">
                    <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Field label="Status" value={dispatch.status} />
                      <Field label="Driver" value={dispatch.driverName} />
                      <Field label="Assistant" value={dispatch.assistantName} />
                      <Field label="Vehicle" value={dispatch.vehicleRegistration ?? dispatch.vehicleOrCourierReference} />
                      <Field label="Planned departure" value={formatDate(dispatch.plannedDepartureAt)} />
                      <Field label="Departed" value={dispatch.departedAt ? `${formatDate(dispatch.departedAt)} (recorded by ${dispatch.departedByName ?? "Not Available"})` : "Not Available"} />
                      <Field label="Created by" value={dispatch.createdByName} />
                    </div>
                    <div className="mb-3 -mt-1">
                      <DispatchAssignmentHistory entries={dispatch.assignmentHistory} />
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-[#F0F2EF]">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#F7F8F6] text-[10px] uppercase tracking-wide text-[#849087]">
                          <tr>
                            <th className="px-3 py-2">Product</th>
                            <th className="px-3 py-2 text-right">Invoiced qty</th>
                            <th className="px-3 py-2 text-right">Dispatched qty</th>
                            <th className="px-3 py-2 text-right">Difference</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2EF]">
                          {dispatch.lines.map((line, i) => {
                            const invoiced = line.invoicedQuantity !== null ? Number(line.invoicedQuantity) : null;
                            const dispatched = Number(line.dispatchedQuantity);
                            const diff = invoiced !== null ? (dispatched - invoiced).toFixed(4) : null;
                            return (
                              <tr key={i}>
                                <td className="px-3 py-2">{line.description} {line.sapItemCode && <span className="text-[#A4ACA4]">({line.sapItemCode})</span>}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{line.invoicedQuantity ?? "Not Available"}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{line.dispatchedQuantity}</td>
                                <td className={`px-3 py-2 text-right tabular-nums ${diff && Number(diff) !== 0 ? "font-semibold text-amber-700" : ""}`}>{diff ?? "Not Available"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 rounded-lg bg-[#FAFBF9] p-3">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#849087]">Physical delivery (truck/gate outcome)</p>
                      {dispatch.physicalDelivery ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <OutcomeBadge outcome={dispatch.physicalDelivery.outcome} />
                            <span className="text-xs text-[#536158]">
                              recorded by {dispatch.physicalDelivery.recordedByName} on {formatDate(dispatch.physicalDelivery.recordedAt)}
                              {dispatch.physicalDelivery.recipientName && ` · received by ${dispatch.physicalDelivery.recipientName}`}
                            </span>
                          </div>
                          {dispatch.physicalDelivery.lines.some((l) => Number(l.rejectedQuantity) > 0) && (
                            <ul className="list-inside list-disc text-xs text-[#536158]">
                              {dispatch.physicalDelivery.lines.filter((l) => Number(l.rejectedQuantity) > 0).map((l, i) => (
                                <li key={i}>
                                  {l.description}: accepted {l.acceptedQuantity}, rejected {l.rejectedQuantity}
                                  {l.rejectionReason && ` -- ${l.rejectionReason}`}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-[#849087]">Not Available -- no physical delivery outcome was recorded for this dispatch.</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* (E) Delivery outcome */}
          <SectionCard title="E. Invoice delivery outcome" description="Recorded exactly once per invoice, separate from SAP's own accounting status">
            <div className="flex flex-wrap items-center gap-4">
              <OutcomeBadge outcome={deliveryOutcome.outcome} />
              <Field label="Recorded by" value={`${deliveryOutcome.recordedByName} · ${formatDate(deliveryOutcome.recordedAt)}`} />
              {deliveryOutcome.podReference && <Field label="Proof of delivery reference" value={deliveryOutcome.podReference} />}
            </div>
            {deliveryOutcome.notes && <p className="mt-3 rounded-lg bg-[#FAFBF9] p-3 text-xs text-[#536158]">{deliveryOutcome.notes}</p>}
          </SectionCard>

          {/* (F) Claims */}
          <SectionCard title="F. Claims" description="Every claim filed against this invoice, with its standardised reason per line">
            {claims.length === 0 ? (
              <EmptyState message="No claim has been filed against this invoice (No Claim)." />
            ) : (
              <div className="space-y-4">
                {claims.map((claim) => (
                  <div key={claim.id} className="rounded-lg border border-[#E7ECE7] p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {/* Part 3: real link to this claim's own full
                            record (resolution history, attachments). */}
                        <Link href={`/invoice-claims/${claim.id}`} className="text-sm font-semibold text-[#173D2E] hover:underline">
                          {claim.claimReference}
                        </Link>
                        <span className="rounded-full bg-[#F2F6F1] px-2 py-0.5 text-[10px] font-semibold text-[#496A42]">{claim.status}</span>
                      </div>
                      <span className="text-xs text-[#849087]">
                        {claim.reportedByName} · {formatDate(claim.createdAt)} · {claim.attachmentCount} attachment(s)
                      </span>
                    </div>
                    <p className="mb-3 text-xs text-[#536158]">{claim.description}</p>
                    <div className="overflow-x-auto rounded-lg border border-[#F0F2EF]">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#F7F8F6] text-[10px] uppercase tracking-wide text-[#849087]">
                          <tr>
                            <th className="px-3 py-2">Product</th>
                            <th className="px-3 py-2">Reason</th>
                            <th className="px-3 py-2 text-right">Qty rejected</th>
                            <th className="px-3 py-2 text-right">Disputed amount</th>
                            <th className="px-3 py-2">Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2EF]">
                          {claim.lines.map((line, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2">{line.description ?? "-"} {line.sapItemCode && <span className="text-[#A4ACA4]">({line.sapItemCode})</span>}</td>
                              <td className="px-3 py-2">{line.reasonLabel ?? "Not categorised (historical)"}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{line.rejectedQuantity ?? "-"}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{line.disputedAmount ?? (line.disputedUnitPrice && line.rejectedQuantity ? "see unit price" : "-")}</td>
                              <td className="px-3 py-2">{line.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* (I) Order history and documents -- exactly what was recorded:
              OrderStatusHistory rows and files attached to the order. Nothing
              is synthesised; an order with no recorded history shows an empty
              state, not an invented timeline. */}
          <SectionCard title="I. Order history and documents" description="Status changes and files recorded against this order">
            {purchaseOrder ? (
              <div className="space-y-5">
                {purchaseOrder.statusHistory.length === 0 ? (
                  <EmptyState message="No status history was recorded for this order." />
                ) : (
                  <ol className="space-y-2">
                    {purchaseOrder.statusHistory.map((entry) => (
                      <li key={entry.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#536158]">
                        <span className="tabular-nums text-[#849087]">{formatDate(entry.createdAt)}</span>
                        <Badge variant="outline">
                          {entry.fromStatus ? `${ORDER_STATUS_LABELS[entry.fromStatus as OrderStatusValue] ?? entry.fromStatus} → ` : ""}
                          {ORDER_STATUS_LABELS[entry.toStatus as OrderStatusValue] ?? entry.toStatus}
                        </Badge>
                        <span>{entry.changedByName ?? "Not Available"}</span>
                        {entry.notes && <span className="italic">— {entry.notes}</span>}
                      </li>
                    ))}
                  </ol>
                )}

                {purchaseOrder.documents.length === 0 ? (
                  <EmptyState message="No documents were attached to this order." />
                ) : (
                  <ul className="divide-y divide-[#F0F2EF] rounded-lg border border-[#E7ECE7]">
                    {purchaseOrder.documents.map((doc) => (
                      <li key={doc.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-[#17251E]" title={doc.originalFileName}>{doc.originalFileName}</p>
                          <p className="truncate text-[10px] text-[#849087]">
                            {DOCUMENT_TYPE_LABELS[doc.documentType as DocumentTypeValue] ?? doc.documentType} · {formatFileSize(doc.fileSize)} · {doc.uploadedByName ?? "Not Available"} · {formatDate(doc.createdAt)}
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
              </div>
            ) : (
              <EmptyState message="This invoice was never matched to a CustomerOrder in SalesFlow, so there is no order history to show." />
            )}
          </SectionCard>

          {/* (G) People / accountability */}
          <SectionCard title="G. People and accountability" description="Everyone on record for this order -- only roles that actually have a named person are shown">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {people.map((p, i) => (
                <div key={i} className="rounded-lg bg-[#FAFBF9] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-[#A4ACA4]">{p.role}</p>
                  <p className="text-sm font-medium text-[#17251E]">{p.name}</p>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* (H) Durations */}
          <SectionCard title="H. Lifecycle durations" description="Not Available wherever a required timestamp was never recorded -- never assumed to be zero">
            <div className="overflow-x-auto rounded-lg border border-[#E7ECE7]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#F7F8F6] text-[10px] uppercase tracking-wide text-[#849087]">
                  <tr>
                    <th className="px-3 py-2">Stage</th>
                    <th className="px-3 py-2">From</th>
                    <th className="px-3 py-2">To</th>
                    <th className="px-3 py-2 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F2EF]">
                  {durations.map((d, i) => (
                    <tr key={i} className={d.label.startsWith("Total") ? "bg-[#F2F6F1] font-semibold" : ""}>
                      <td className="px-3 py-2">{d.label}</td>
                      <td className="px-3 py-2 text-[#849087]">{d.fromLabel}</td>
                      <td className="px-3 py-2 text-[#849087]">{d.toLabel}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${d.milliseconds === null ? "text-[#A4ACA4]" : "text-[#17251E]"}`}>{formatDuration(d.milliseconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </main>
    </div>
  );
}
