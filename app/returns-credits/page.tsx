import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listCreditNotes } from "@/lib/returns-credits/queries";
import { CREDIT_NOTE_MATCH_STATUS_LABELS, CREDIT_NOTE_MATCH_STATUS_STYLES } from "@/lib/returns-credits/display";
import Sidebar from "../components/sidebar";
import { Undo2, ChevronRight, ChevronLeft, Upload, History } from "lucide-react";

/**
 * Milestone 6B (Returns & Credit Notes).
 *
 * The /returns-credits credit-note reconciliation queue -- same role
 * app/invoice-reconciliation/page.tsx plays for Milestone 5's unmatched
 * invoice lines: every credit note, filterable by match status, with a
 * link through to the manual-match/cannot-link/reopen detail panel for
 * one that needs a human decision. Deliberately a simple Server
 * Component list with plain query-string pagination, same choice as
 * every other list page in this project.
 */
export const instant = false;

const PAGE_SIZE = 25;

const STATUS_FILTERS = ["UNMATCHED", "AUTO_MATCHED", "MANUALLY_MATCHED", "CANNOT_LINK"];

type RouteParams = { searchParams: Promise<{ page?: string; matchStatus?: string }> };

export default async function ReturnsCreditsPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolved = await searchParams;
  const requestedPage = Number(resolved.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const matchStatus = resolved.matchStatus && STATUS_FILTERS.includes(resolved.matchStatus) ? resolved.matchStatus : undefined;

  const { rows, page: safePage, totalPages } = await listCreditNotes({ matchStatus }, page, PAGE_SIZE);

  const statusQuery = (targetStatus: string | undefined) => (targetStatus ? `&matchStatus=${targetStatus}` : "");

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Returns & Credits</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Returns & Credit Notes</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/returns-credits/import-history"
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              <History size={14} />
              Import history
            </Link>
            <Link
              href="/returns-credits/import"
              className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#122E23]"
            >
              <Upload size={14} />
              Import credit notes
            </Link>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <section>
            <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Credit Note Reconciliation</h1>
            <p className="mt-1 text-sm text-gray-500">
              SAP Business One remains the system of record for credit notes -- this records that SAP has actually
              issued one and reconciles it against the claim it settles, never the other way around. A credit note
              recorded here is never created in SAP by SalesFlow.
            </p>
          </section>

          <section className="flex flex-wrap items-center gap-2">
            <Link
              href="/returns-credits"
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                !matchStatus ? "bg-[#173D2E] text-white" : "bg-white text-gray-500 border border-gray-200"
              }`}
            >
              All
            </Link>
            {STATUS_FILTERS.map((value) => (
              <Link
                key={value}
                href={`/returns-credits?page=1${statusQuery(value)}`}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                  matchStatus === value ? "bg-[#173D2E] text-white" : "bg-white text-gray-500 border border-gray-200"
                }`}
              >
                {CREDIT_NOTE_MATCH_STATUS_LABELS[value] ?? value}
              </Link>
            ))}
          </section>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            {rows.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <Undo2 size={28} className="mx-auto text-gray-300" />
                <p className="mt-3 text-sm font-semibold text-gray-600">Nothing here</p>
                <p className="mt-1 text-xs text-gray-400">
                  No credit notes match this filter. Record one against a claim, or import an SAP credit note export to get started.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-y border-gray-100 bg-gray-50/70">
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Credit note</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Base invoice</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Claim</th>
                      <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Amount</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((creditNote) => (
                      <tr key={creditNote.id} className="border-b border-gray-50">
                        <td className="whitespace-nowrap px-6 py-4">
                          <p className="text-xs font-semibold text-[#173D2E]">{creditNote.sapCreditNoteDocNum}</p>
                          {creditNote.sapCreditNoteDocEntry && <p className="text-[10px] text-gray-400">DocEntry {creditNote.sapCreditNoteDocEntry}</p>}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">
                          {creditNote.sapInvoice ? (
                            <Link href={`/invoice-reconciliation/${creditNote.sapInvoice.id}`} className="font-semibold text-[#173D2E] hover:underline">
                              {creditNote.sapInvoice.sapDocNum}
                            </Link>
                          ) : (
                            <span className="text-gray-400">Unresolved</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">
                          {creditNote.claim ? (
                            <Link href={`/invoice-claims/${creditNote.claim.id}`} className="font-semibold text-[#173D2E] hover:underline">
                              {creditNote.claim.claimReference}
                            </Link>
                          ) : (
                            <span className="text-gray-400">Not matched</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">
                          {creditNote.amount.toString()} {creditNote.currencyCode ?? ""}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${CREDIT_NOTE_MATCH_STATUS_STYLES[creditNote.matchStatus] ?? "bg-gray-100 text-gray-500"}`}>
                            {CREDIT_NOTE_MATCH_STATUS_LABELS[creditNote.matchStatus] ?? creditNote.matchStatus}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <Link
                            href={`/returns-credits/${creditNote.id}`}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-[#173D2E]"
                          >
                            Open
                            <ChevronRight size={13} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {totalPages > 1 && (
            <nav className="flex items-center justify-between">
              <Link
                href={`/returns-credits?page=${Math.max(1, safePage - 1)}${statusQuery(matchStatus)}`}
                aria-disabled={safePage <= 1}
                className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 ${
                  safePage <= 1 ? "pointer-events-none opacity-40" : ""
                }`}
              >
                <ChevronLeft size={14} />
                Previous
              </Link>
              <p className="text-xs text-gray-400">
                Page {safePage} of {totalPages}
              </p>
              <Link
                href={`/returns-credits?page=${Math.min(totalPages, safePage + 1)}${statusQuery(matchStatus)}`}
                aria-disabled={safePage >= totalPages}
                className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 ${
                  safePage >= totalPages ? "pointer-events-none opacity-40" : ""
                }`}
              >
                Next
                <ChevronRight size={14} />
              </Link>
            </nav>
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
