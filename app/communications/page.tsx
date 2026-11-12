import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listOutboundMessages } from "@/lib/communications/queries";
import Sidebar from "../components/sidebar";
import { Send, ChevronRight, ChevronLeft } from "lucide-react";
import ResendButton from "./resend-button";

/**
 * Milestone 10 (Communication Channels & Fulfilment). The outbound
 * communications log (spec point 5: durable outbox, retry/failure
 * handling, audit trail -- made visible). Any authenticated role can
 * view; resend is restricted to SALES_MANAGER/ADMINISTRATOR (enforced
 * server-side by the resend route itself -- ResendButton is only
 * rendered here for those roles as a matter of not showing a button
 * that would just 403, not as the actual enforcement).
 */
export const instant = false;

const PAGE_SIZE = 25;

type RouteParams = { searchParams: Promise<{ page?: string; status?: string; channel?: string }> };

const STATUS_BADGE: Record<string, string> = {
  QUEUED: "bg-gray-100 text-gray-600",
  SENT: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-red-50 text-red-700",
};

const STATUS_TABS = ["ALL", "FAILED", "QUEUED", "SENT"] as const;

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default async function CommunicationsPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolved = await searchParams;
  const requestedPage = Number(resolved.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const statusFilter = resolved.status && STATUS_TABS.includes(resolved.status as (typeof STATUS_TABS)[number]) ? resolved.status : "ALL";

  const { messages, pagination } = await listOutboundMessages({
    page,
    pageSize: PAGE_SIZE,
    status: statusFilter === "ALL" ? null : statusFilter,
    channel: null,
  });

  const canResend = user.role === "SALES_MANAGER" || user.role === "ADMINISTRATOR";

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Communications</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Communications</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <section className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Outbound Messages</h1>
              <p className="mt-1 text-sm text-gray-500">
                Every quotation, order, dispatch, and delivery notification sent to a customer -- queued, sent, or
                failed, with a way to resend one that failed.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-[#E8EBE6] bg-white px-4 py-2.5">
              <Send size={16} className="text-[#173D2E]" />
              <span className="text-sm font-semibold text-[#17251E]">{pagination.totalItems}</span>
              <span className="text-xs text-gray-400">message{pagination.totalItems === 1 ? "" : "s"}</span>
            </div>
          </section>

          <nav className="flex gap-2">
            {STATUS_TABS.map((tab) => (
              <Link
                key={tab}
                href={tab === "ALL" ? "/communications" : `/communications?status=${tab}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  statusFilter === tab ? "bg-[#173D2E] text-white" : "border border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {tab}
              </Link>
            ))}
          </nav>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            {messages.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <Send size={28} className="mx-auto text-gray-300" />
                <p className="mt-3 text-sm font-semibold text-gray-600">No messages here</p>
                <p className="mt-1 text-xs text-gray-400">Nothing matches this filter yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-y border-gray-100 bg-gray-50/70">
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Type</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Customer</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Channel</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">To</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Sent / Last Attempt</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {messages.map((message) => (
                      <tr key={message.id} className="border-b border-gray-50 align-top">
                        <td className="px-6 py-4 text-xs font-medium text-gray-700">{message.type.replace(/_/g, " ")}</td>
                        <td className="px-6 py-4 text-xs text-gray-600">{message.customerName}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{message.channel}</td>
                        <td className="px-6 py-4 text-xs text-gray-600">{message.toAddress ?? "—"}</td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${STATUS_BADGE[message.status] ?? "bg-gray-100 text-gray-500"}`}>
                            {message.status}
                          </span>
                          {message.status === "FAILED" && message.lastErrorMessage && (
                            <p className="mt-1 max-w-[220px] text-[10px] text-[#9B3B3B]">{message.lastErrorMessage}</p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">
                          {formatDateTime(message.sentAt ?? message.lastAttemptAt)}
                          {message.attemptCount > 1 && <span className="ml-1 text-gray-400">({message.attemptCount} attempts)</span>}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          {message.status === "FAILED" && canResend && <ResendButton messageId={message.id} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {pagination.totalPages > 1 && (
            <nav className="flex items-center justify-between">
              <Link
                href={`/communications?page=${Math.max(1, page - 1)}${statusFilter !== "ALL" ? `&status=${statusFilter}` : ""}`}
                aria-disabled={page <= 1}
                className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 ${
                  page <= 1 ? "pointer-events-none opacity-40" : ""
                }`}
              >
                <ChevronLeft size={14} />
                Previous
              </Link>
              <p className="text-xs text-gray-400">
                Page {pagination.page} of {pagination.totalPages}
              </p>
              <Link
                href={`/communications?page=${Math.min(pagination.totalPages, page + 1)}${statusFilter !== "ALL" ? `&status=${statusFilter}` : ""}`}
                aria-disabled={page >= pagination.totalPages}
                className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 ${
                  page >= pagination.totalPages ? "pointer-events-none opacity-40" : ""
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
