import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listCreditNoteImportBatches } from "@/lib/returns-credits/queries";
import Sidebar from "../../components/sidebar";
import { ArrowLeft } from "lucide-react";

/**
 * Milestone 6B (Returns & Credit Notes). A simple read-only history of
 * past credit-note CSV import batches -- open to any authenticated user,
 * same as app/api/returns-credits/import-history/route.ts (only writing a
 * credit note carries the SALES_MANAGER/ADMINISTRATOR approval-weight
 * gate, not reading about a past import). Deliberately a plain list
 * rather than a drill-down -- each batch's own imported credit notes are
 * already visible in the main /returns-credits queue, filterable, so this
 * page's only job is "when did we last import, and how did it go."
 */
export const instant = false;

const PAGE_SIZE = 25;

type RouteParams = { searchParams: Promise<{ page?: string }> };

export default async function CreditNoteImportHistoryPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolved = await searchParams;
  const requestedPage = Number(resolved.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const { rows, page: safePage, totalPages } = await listCreditNoteImportBatches(page, PAGE_SIZE);

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Returns & Credits / Import history</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Credit Note Import History</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <Link href="/returns-credits" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-[#173D2E]">
            <ArrowLeft size={15} />
            Back to credit note reconciliation
          </Link>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            {rows.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="text-sm font-semibold text-gray-600">No imports yet</p>
                <p className="mt-1 text-xs text-gray-400">Run an import to see its history here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-y border-gray-100 bg-gray-50/70">
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">File</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Uploaded by</th>
                      <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Rows</th>
                      <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Imported</th>
                      <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Duplicates</th>
                      <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Invalid</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((batch) => (
                      <tr key={batch.id} className="border-b border-gray-50">
                        <td className="whitespace-nowrap px-6 py-4 text-xs font-semibold text-[#173D2E]">{batch.originalFileName}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{batch.uploadedBy.name}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{batch.totalRows}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{batch.importedCreditNoteCount}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{batch.duplicateRowCount}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{batch.invalidRowCount}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-400">{new Date(batch.createdAt).toLocaleString()}</td>
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
                href={`/returns-credits/import-history?page=${Math.max(1, safePage - 1)}`}
                aria-disabled={safePage <= 1}
                className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 ${
                  safePage <= 1 ? "pointer-events-none opacity-40" : ""
                }`}
              >
                Previous
              </Link>
              <p className="text-xs text-gray-400">
                Page {safePage} of {totalPages}
              </p>
              <Link
                href={`/returns-credits/import-history?page=${Math.min(totalPages, safePage + 1)}`}
                aria-disabled={safePage >= totalPages}
                className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 ${
                  safePage >= totalPages ? "pointer-events-none opacity-40" : ""
                }`}
              >
                Next
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
