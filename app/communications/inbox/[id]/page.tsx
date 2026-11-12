import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isValidId } from "@/lib/http";
import Sidebar from "../../../components/sidebar";
import { ArrowLeft } from "lucide-react";
import ReviewPanel from "./review-panel";

/**
 * Milestone 10 (Communication Channels & Fulfilment). One MessageIntake's
 * review page -- the server shell (auth + id validation + layout), same
 * split as app/fulfilment/[id]/page.tsx + PickingPanel. All the actual
 * review actions live in ReviewPanel (client), since each one is a
 * mutation needing immediate feedback.
 */
export const instant = false;

type RouteParams = { params: Promise<{ id: string }> };

export default async function MessageIntakeReviewPage({ params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  if (!isValidId(id)) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Message Inbox / Review</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Review Message</h2>
          </div>
          <Link
            href="/communications/inbox"
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
          >
            <ArrowLeft size={15} />
            Back to Inbox
          </Link>
        </header>

        <div className="space-y-6 p-8">
          <ReviewPanel messageIntakeId={id} />

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
