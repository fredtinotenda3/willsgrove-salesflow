import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listMessageIntakes } from "@/lib/channels/queries";
import Sidebar from "../../components/sidebar";
import { MessageSquare, Paperclip, ChevronRight } from "lucide-react";
import ManualIntakeForm from "./manual-intake-form";

/**
 * Milestone 10 (Communication Channels & Fulfilment). The message intake
 * review queue -- every email/WhatsApp/manually-entered message, before
 * any of it is treated as a commercial transaction (spec point 1's "human
 * review before confirming"). Same simple Server Component list pattern
 * as app/fulfilment/page.tsx; the actual review actions live on
 * app/communications/inbox/[id] (a client page), not here.
 */
export const instant = false;

type RouteParams = { searchParams: Promise<{ status?: string }> };

const STATUS_TABS = ["RECEIVED", "CONVERTED", "LINKED", "IGNORED", "DUPLICATE", "ALL"] as const;

const STATUS_BADGE: Record<string, string> = {
  RECEIVED: "bg-amber-50 text-amber-700",
  CONVERTED: "bg-emerald-50 text-emerald-700",
  LINKED: "bg-cyan-50 text-cyan-700",
  IGNORED: "bg-gray-100 text-gray-500",
  DUPLICATE: "bg-gray-100 text-gray-500",
};

const CHANNEL_LABEL: Record<string, string> = { EMAIL: "Email", WHATSAPP: "WhatsApp", MANUAL: "Manual" };

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default async function MessageInboxPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolved = await searchParams;
  const statusFilter = resolved.status && STATUS_TABS.includes(resolved.status as (typeof STATUS_TABS)[number]) ? resolved.status : "RECEIVED";

  const intakes = await listMessageIntakes(statusFilter);

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Message Inbox</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Message Inbox</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <section className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Inbound Messages</h1>
              <p className="mt-1 text-sm text-gray-500">
                Every email, WhatsApp message, and manually logged customer contact -- review each one before it
                becomes a PO intake or gets linked to an existing order or quotation. Nothing here is a confirmed
                transaction yet.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-[#E8EBE6] bg-white px-4 py-2.5">
              <MessageSquare size={16} className="text-[#173D2E]" />
              <span className="text-sm font-semibold text-[#17251E]">{intakes.length}</span>
              <span className="text-xs text-gray-400">message{intakes.length === 1 ? "" : "s"}</span>
            </div>
          </section>

          <ManualIntakeForm />

          <nav className="flex flex-wrap gap-2">
            {STATUS_TABS.map((tab) => (
              <Link
                key={tab}
                href={`/communications/inbox?status=${tab}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  statusFilter === tab ? "bg-[#173D2E] text-white" : "border border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {tab}
              </Link>
            ))}
          </nav>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            {intakes.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <MessageSquare size={28} className="mx-auto text-gray-300" />
                <p className="mt-3 text-sm font-semibold text-gray-600">Nothing here</p>
                <p className="mt-1 text-xs text-gray-400">No messages match this filter.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-y border-gray-100 bg-gray-50/70">
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Channel</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">From</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Subject / Preview</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Customer</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Received</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {intakes.map((intake) => (
                      <tr key={intake.id} className="border-b border-gray-50">
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{CHANNEL_LABEL[intake.channel] ?? intake.channel}</td>
                        <td className="px-6 py-4 text-xs text-gray-700">
                          {intake.fromDisplayName ? `${intake.fromDisplayName} ` : ""}
                          <span className="text-gray-400">{intake.fromAddress}</span>
                        </td>
                        <td className="px-6 py-4 text-xs text-gray-600">
                          <div className="flex items-center gap-1.5">
                            {intake.subject ?? <span className="text-gray-400">No subject</span>}
                            {intake.attachmentCount > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-gray-400">
                                <Paperclip size={11} /> {intake.attachmentCount}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-xs text-gray-600">{intake.customer?.name ?? "—"}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{formatDateTime(intake.receivedAt)}</td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${STATUS_BADGE[intake.status] ?? "bg-gray-100 text-gray-500"}`}>
                            {intake.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <Link
                            href={`/communications/inbox/${intake.id}`}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-[#173D2E]"
                          >
                            Review
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

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
