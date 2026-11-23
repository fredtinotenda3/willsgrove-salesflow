import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isValidId } from "@/lib/http";
import Sidebar from "../../components/sidebar";
import NewClaimForm, { type NewClaimFormPrefill } from "./new-claim-form";

/**
 * Milestone 6A. /invoice-claims/new -- the claim creation workflow (spec
 * section 2): pick what the claim is raised against -- this business's
 * own order (the default; see new-claim-form.tsx's own comment) or a
 * real, reconciled SAP invoice -- select which of its lines are being
 * disputed and how, then the claim-level detail. Open to any
 * authenticated user.
 *
 * export const instant = false: this page calls getCurrentUser()
 * (lib/auth/current-user.ts), which reads the request's session cookie
 * via cookies() -- a per-request dynamic API. With Cache Components
 * enabled (next.config.ts), Next.js otherwise tries to prerender this
 * page's static shell and fails the production build with "uncached or
 * runtime data accessed outside of <Suspense>". Every other
 * authenticated page in this app (see e.g. app/deliveries/page.tsx,
 * app/lost-sales/page.tsx) already opts out the same way; this route
 * was simply missing it.
 */
export const instant = false;

type RouteParams = {
  searchParams: Promise<{ orderId?: string; orderLineId?: string; rejectedQuantity?: string; reasonLabel?: string }>;
};

export default async function NewInvoiceClaimPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // Real-world fix (Invoice Claims from a rejected delivery): a "File a
  // claim" link from /invoice-claims' new "Awaiting a claim" section
  // (see that page's own comment) arrives here with the rejected order
  // line's own identity in the query string. Every piece is independently
  // validated and the whole prefill is dropped -- never partially applied
  // -- if orderId/orderLineId fail isValidId or rejectedQuantity isn't a
  // real decimal string: a malformed or tampered link should land the
  // user on a normal, empty claim form, not a form bound to an
  // unvalidated order/line pair.
  const resolved = await searchParams;
  let prefill: NewClaimFormPrefill | undefined;
  const rawOrderId = resolved.orderId?.trim();
  const rawOrderLineId = resolved.orderLineId?.trim();
  const rawRejectedQuantity = resolved.rejectedQuantity?.trim();
  if (
    rawOrderId &&
    rawOrderLineId &&
    isValidId(rawOrderId) &&
    isValidId(rawOrderLineId) &&
    rawRejectedQuantity &&
    Number.isFinite(Number(rawRejectedQuantity)) &&
    Number(rawRejectedQuantity) > 0
  ) {
    prefill = {
      orderId: rawOrderId,
      orderLineId: rawOrderLineId,
      rejectedQuantity: rawRejectedQuantity,
      reasonLabel: resolved.reasonLabel?.trim() || null,
    };
  }

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen md:pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Invoice Claims / New</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">File a claim</h2>
          </div>
        </header>
        <div className="p-8">
          <NewClaimForm prefill={prefill} />
        </div>
      </main>
    </div>
  );
}
