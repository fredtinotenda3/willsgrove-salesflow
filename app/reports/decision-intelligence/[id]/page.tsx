import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isValidId } from "@/lib/http";
import { getDecisionRecommendationDetail } from "@/lib/reporting/decision-intelligence-queries";
import { DECISION_RECOMMENDATION_STATUS_TRANSITIONS, type DecisionCategory, type DecisionPriority, type DecisionConfidence, type DecisionRecommendationStatus, type DecisionEvidence } from "@/lib/reporting/decision-types";
import Sidebar from "../../../components/sidebar";
import { PageHeader, SectionCard } from "../../_components/ui";
import StatusPanel from "./status-panel";

type RouteParams = { params: Promise<{ id: string }> };

export const instant = false;

const CATEGORY_LABELS: Record<DecisionCategory, string> = {
  SALES: "Sales",
  CUSTOMER: "Customer",
  PRODUCT: "Product",
  COMMERCIAL_EXPOSURE: "Commercial exposure",
  OPERATIONAL: "Operational",
};

const PRIORITY_LABELS: Record<DecisionPriority, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  INFORMATIONAL: "Informational",
};

const PRIORITY_BADGE_STYLES: Record<DecisionPriority, string> = {
  CRITICAL: "bg-red-50 text-red-700",
  HIGH: "bg-amber-50 text-amber-700",
  MEDIUM: "bg-cyan-50 text-cyan-700",
  LOW: "bg-gray-100 text-gray-600",
  INFORMATIONAL: "bg-gray-50 text-gray-400",
};

const CONFIDENCE_LABELS: Record<DecisionConfidence, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  INSUFFICIENT_DATA: "Insufficient data",
};

const CONFIDENCE_BADGE_STYLES: Record<DecisionConfidence, string> = {
  HIGH: "bg-emerald-50 text-emerald-700",
  MEDIUM: "bg-cyan-50 text-cyan-700",
  LOW: "bg-amber-50 text-amber-700",
  INSUFFICIENT_DATA: "bg-gray-100 text-gray-500",
};

const STATUS_LABELS: Record<DecisionRecommendationStatus, string> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

const STATUS_BADGE_STYLES: Record<DecisionRecommendationStatus, string> = {
  OPEN: "bg-amber-50 text-amber-700",
  ACKNOWLEDGED: "bg-cyan-50 text-cyan-700",
  IN_PROGRESS: "bg-blue-50 text-blue-700",
  RESOLVED: "bg-emerald-50 text-emerald-700",
  DISMISSED: "bg-gray-100 text-gray-500",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  CREATED: "Created",
  ACKNOWLEDGED: "Acknowledged",
  STARTED: "Started",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
  REOPENED: "Reopened",
};

function Badge({ label, className }: { label: string; className: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{label}</span>;
}

/**
 * Defensive narrowing of the persisted `evidence` Json column back into
 * its known shape (DecisionEvidence) for rendering only -- the column is
 * typed `unknown` at the Prisma boundary (lib/reporting/decision-
 * intelligence-queries.ts's own DecisionRecommendationRow.evidence), so
 * this page never assumes the shape without checking it, even though
 * every row is written by this milestone's own code.
 */
function asDecisionEvidence(value: unknown): DecisionEvidence | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.confidenceBasis !== "string" || !Array.isArray(v.sourceRecords) || typeof v.metrics !== "object" || v.metrics === null) return null;
  return value as DecisionEvidence;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Milestone 15 (Decision Intelligence), spec sections 4/6/9: a single
 * recommendation's full detail -- explanation, evidence metrics, every
 * source-record reference as a real link into its own existing page
 * (Customer 360 / Product 360 / Quotation / Order), recommended next
 * action, and the complete append-only status-change history. The one
 * mutation (changing status) is isolated in StatusPanel, a small client
 * component, same split as every other *-actions-panel.tsx in this
 * project.
 */
export default async function DecisionRecommendationDetailPage({ params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "SALES_MANAGER" && user.role !== "ADMINISTRATOR") {
    redirect("/reports");
  }

  const { id } = await params;
  if (!isValidId(id)) {
    notFound();
  }

  const detail = await getDecisionRecommendationDetail(id);
  if (!detail) {
    notFound();
  }

  const evidence = asDecisionEvidence(detail.evidence);
  const allowedNextStatuses = DECISION_RECOMMENDATION_STATUS_TRANSITIONS[detail.status];

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Reports / Decision Intelligence / Recommendation</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">{detail.title}</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Reports / Decision Intelligence / Recommendation"
            title={detail.title}
            description={`Rule ${detail.ruleId} (v${detail.ruleVersion}) · reporting period ${detail.reportingPeriodFrom} to ${detail.reportingPeriodTo} · first detected ${formatTimestamp(detail.firstDetectedAt)} · last evaluated ${formatTimestamp(detail.lastEvaluatedAt)}`}
            actions={
              <Link href="/reports/decision-intelligence" className="text-sm font-semibold text-[#718078] hover:text-[#17251E]">
                &larr; All recommendations
              </Link>
            }
          />

          <div className="flex flex-wrap items-center gap-2">
            <Badge label={PRIORITY_LABELS[detail.priority]} className={PRIORITY_BADGE_STYLES[detail.priority]} />
            <Badge label={CATEGORY_LABELS[detail.decisionCategory]} className="bg-[#F2F6F1] text-[#496A42]" />
            <Badge label={`Confidence: ${CONFIDENCE_LABELS[detail.confidence]}`} className={CONFIDENCE_BADGE_STYLES[detail.confidence]} />
            <Badge label={STATUS_LABELS[detail.status]} className={STATUS_BADGE_STYLES[detail.status]} />
            {detail.isDemo && <Badge label="Demo data" className="bg-purple-50 text-purple-700" />}
          </div>

          <SectionCard title="Explanation" description="Why this recommendation was raised">
            <p className="text-sm leading-6 text-[#17251E]">{detail.explanation}</p>
            {evidence && <p className="mt-3 text-xs leading-5 text-[#849087]">Confidence basis: {evidence.confidenceBasis}</p>}
          </SectionCard>

          <SectionCard title="Recommended next action">
            <p className="text-sm leading-6 text-[#17251E]">{detail.recommendedNextAction}</p>
          </SectionCard>

          <SectionCard title="Evidence" description="Every number a human can verify by hand against the source records below.">
            {evidence && Object.keys(evidence.metrics).length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {Object.entries(evidence.metrics).map(([key, value]) => (
                      <tr key={key}>
                        <td className="w-1/2 px-5 py-2.5 font-medium text-[#536158]">{key}</td>
                        <td className="px-5 py-2.5 tabular-nums text-[#17251E]">{value === null ? "—" : String(value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-5 py-4 text-sm text-[#849087]">No metrics recorded for this recommendation.</p>
            )}
          </SectionCard>

          <SectionCard title="Source records" description="Links into the real records this recommendation was evaluated from.">
            <div className="flex flex-wrap gap-3 px-1">
              {detail.customerId && (
                <Link href={`/customers/${detail.customerId}`} className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 text-sm font-semibold text-[#17251E] hover:bg-gray-50">
                  Customer: {detail.customerName ?? detail.customerId}
                </Link>
              )}
              {detail.productId && (
                <Link href={`/products/${detail.productId}`} className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 text-sm font-semibold text-[#17251E] hover:bg-gray-50">
                  Product: {detail.sapItemCode ?? detail.productId}
                </Link>
              )}
              {!detail.productId && detail.sapItemCode && (
                <span className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 text-sm font-semibold text-[#17251E]">SAP item code: {detail.sapItemCode}</span>
              )}
              {detail.quotationId && (
                <Link href={`/quotations/${detail.quotationId}`} className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 text-sm font-semibold text-[#17251E] hover:bg-gray-50">
                  Quotation
                </Link>
              )}
              {detail.customerOrderId && (
                <Link href={`/orders/${detail.customerOrderId}`} className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 text-sm font-semibold text-[#17251E] hover:bg-gray-50">
                  Order {detail.customerOrderReference ?? ""}
                </Link>
              )}
              {detail.salespersonName && <span className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 text-sm font-semibold text-[#17251E]">Salesperson: {detail.salespersonName}</span>}
              {detail.currencyCode && <span className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 text-sm font-semibold text-[#17251E]">Currency: {detail.currencyCode}</span>}
              {evidence?.sourceRecords.map((record, index) =>
                record.href ? (
                  <Link key={`${record.type}-${record.id}-${index}`} href={record.href} className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 text-sm font-semibold text-[#17251E] hover:bg-gray-50">
                    {record.label}
                  </Link>
                ) : (
                  <span key={`${record.type}-${record.id}-${index}`} className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 text-sm font-semibold text-[#17251E]">
                    {record.label}
                  </span>
                ),
              )}
              {!detail.customerId && !detail.productId && !detail.sapItemCode && !detail.quotationId && !detail.customerOrderId && (!evidence || evidence.sourceRecords.length === 0) && (
                <p className="text-sm text-[#849087]">No linkable source records for this recommendation.</p>
              )}
            </div>
          </SectionCard>

          <StatusPanel recommendationId={detail.id} currentStatus={detail.status} allowedNextStatuses={allowedNextStatuses} statusLabels={STATUS_LABELS} />

          <SectionCard title="Status history" description="Every status change, including who made it and when -- preserved regardless of later changes.">
            {detail.history.length === 0 ? (
              <p className="px-1 py-2 text-sm text-[#849087]">No status changes recorded yet.</p>
            ) : (
              <ol className="space-y-4">
                {detail.history.map((event) => (
                  <li key={event.id} className="flex items-start gap-3 border-l-2 border-[#E1E7E2] pl-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#17251E]">
                        {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
                        {event.fromStatus && <span className="font-normal text-[#849087]"> ({STATUS_LABELS[event.fromStatus as DecisionRecommendationStatus] ?? event.fromStatus} &rarr; {STATUS_LABELS[event.toStatus as DecisionRecommendationStatus] ?? event.toStatus})</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-[#849087]">
                        {formatTimestamp(event.createdAt)}
                        {event.actorName && ` · ${event.actorName}`}
                      </p>
                      {event.notes && <p className="mt-1 text-xs text-[#536158]">{event.notes}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </div>
      </main>
    </div>
  );
}
