import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import Sidebar from "../../components/sidebar";
import NewQuotationForm from "./new-quotation-form";

/**
 * Milestone 7. /quotations/new -- quotation creation (spec section 3):
 * header + an initial set of lines (catalogued SAP products or clearly-
 * marked unlisted/requested items). A quotation can also be created with
 * zero lines and built up afterwards from the detail page's DRAFT line
 * editor -- this form's own "at least one line" nudge is a UX default,
 * not a hard requirement (lib/quotations/create.ts accepts an empty
 * `lines` array).
 */
export default async function NewQuotationPage() {
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
            <p className="text-xs text-gray-400">Workspace / Sales Management / Quotations / New</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">New Quotation</h2>
          </div>
        </header>
        <div className="p-8">
          <NewQuotationForm defaultSalespersonId={user.id} />
        </div>
      </main>
    </div>
  );
}
