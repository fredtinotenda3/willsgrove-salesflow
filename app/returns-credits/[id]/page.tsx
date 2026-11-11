import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isValidId } from "@/lib/http";
import { getCreditNoteDetail } from "@/lib/returns-credits/queries";
import { CREDIT_NOTE_MATCH_STATUS_LABELS, CREDIT_NOTE_MATCH_STATUS_STYLES } from "@/lib/returns-credits/display";
import Sidebar from "../../components/sidebar";
import { ArrowLeft } from "lucide-react";
import CreditNotePanel from "./credit-note-panel";

/**
 * Milestone 6B (Returns & Credit Notes). One credit note's full detail --
 * mirrors app/invoice-reconciliation/[id]/page.tsx's structure exactly:
 * header fields + a client-rendered action island for the manual-match/
 * cannot-link/reopen decisions a SALES_MANAGER/ADMINISTRATOR makes on an
 * UNMATCHED or CANNOT_LINK row. Reading this page itself is open to any
 * authenticated user, same split as every other 6B route.
 */
export const instant = false;

type RouteParams = { params: Promise<{ id: string }> };

export default async function CreditNoteDetailPage({ params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  if (!isValidId(id)) {
    notFound();
  }

  const creditNote = await getCreditNoteDetail(id);
  if (!creditNote) {
    notFound();
  }

  const canReconcile = user.role === "SALES_MANAGER" || user.role === "ADMINISTRATOR";

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Returns & Credits / {creditNote.sapCreditNoteDocNum}</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Credit Note {creditNote.sapCreditNoteDocNum}</h2>
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold ${
              CREDIT_NOTE_MATCH_STATUS_STYLES[creditNote.matchStatus] ?? "bg-gray-100 text-gray-500"
            }`}
          >
            {CREDIT_NOTE_MATCH_STATUS_LABELS[creditNote.matchStatus] ?? creditNote.matchStatus}
          </span>
        </header>

        <div className="space-y-6 p-8">
          <Link href="/returns-credits" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-[#173D2E]">
            <ArrowLeft size={15} />
            Back to credit note reconciliation
          </Link>

          <section className="grid grid-cols-1 gap-4 rounded-xl border border-[#E8EBE6] bg-white p-5 sm:grid-cols-4">
            <Field label="DocEntry" value={creditNote.sapCreditNoteDocEntry ?? "-"} />
            <Field label="Amount" value={`${creditNote.amount.toString()} ${creditNote.currencyCode ?? ""}`} />
            <Field label="Credit note date" value={creditNote.creditNoteDate ? new Date(creditNote.creditNoteDate).toLocaleDateString() : "-"} />
            <Field label="Recorded" value={`${creditNote.recordedBy.name} · ${new Date(creditNote.recordedAt).toLocaleString()}`} />
            <Field
              label="Base invoice"
              value={creditNote.sapInvoice ? creditNote.sapInvoice.sapDocNum : "Unresolved"}
              link={creditNote.sapInvoice ? `/invoice-reconciliation/${creditNote.sapInvoice.id}` : undefined}
            />
            <Field
              label="Matched claim"
              value={creditNote.claim ? creditNote.claim.claimReference : "Not matched"}
              link={creditNote.claim ? `/invoice-claims/${creditNote.claim.id}` : undefined}
              sub={creditNote.claim ? creditNote.claim.status : undefined}
            />
            <Field label="Import batch" value={creditNote.importBatch ? creditNote.importBatch.originalFileName : "Manual entry"} />
            <Field label="Matched by" value={creditNote.matchedBy ? `${creditNote.matchedBy.name} · ${creditNote.matchedAt ? new Date(creditNote.matchedAt).toLocaleString() : ""}` : "-"} />
          </section>

          {(creditNote.notes || creditNote.matchNote) && (
            <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              {creditNote.notes && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400">Notes</p>
                  <p className="mt-1 text-sm text-gray-600">{creditNote.notes}</p>
                </div>
              )}
              {creditNote.matchNote && (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400">Match note</p>
                  <p className="mt-1 text-sm text-gray-600">{creditNote.matchNote}</p>
                </div>
              )}
            </section>
          )}

          {creditNote.returns.length > 0 && (
            <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h2 className="text-sm font-bold text-[#17251E]">Linked physical returns</h2>
              <ul className="mt-2 space-y-1">
                {creditNote.returns.map((ret) => (
                  <li key={ret.id} className="text-xs text-gray-600">
                    {ret.returnReference} · qty {ret.receivedQuantity.toString()}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
            <h2 className="text-sm font-bold text-[#17251E]">Reconciliation</h2>
            {canReconcile ? (
              <CreditNotePanel
                creditNoteId={creditNote.id}
                matchStatus={creditNote.matchStatus}
                sapInvoiceId={creditNote.sapInvoiceId}
              />
            ) : (
              <p className="mt-2 text-xs text-gray-400">Only a sales manager or administrator may change how this credit note is matched.</p>
            )}
          </section>

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}

function Field({ label, value, sub, link }: { label: string; value: string; sub?: string | null; link?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-400">{label}</p>
      {link ? (
        <Link href={link} className="mt-0.5 block text-sm font-semibold text-[#173D2E] hover:underline">
          {value}
        </Link>
      ) : (
        <p className="mt-0.5 text-sm font-semibold text-gray-700">{value}</p>
      )}
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </div>
  );
}
