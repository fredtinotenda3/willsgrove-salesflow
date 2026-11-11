import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import Sidebar from "../../components/sidebar";
import NewClaimForm from "./new-claim-form";

/**
 * Milestone 6A. /invoice-claims/new -- the claim creation workflow (spec
 * section 2): pick the SAP invoice, select which of its lines are being
 * disputed and how, then the claim-level detail. Open to any
 * authenticated user.
 */
export default async function NewInvoiceClaimPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Invoice Claims / New</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">File a claim</h2>
          </div>
        </header>
        <div className="p-8">
          <NewClaimForm />
        </div>
      </main>
    </div>
  );
}
