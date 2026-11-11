import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listApprovalPolicies } from "@/lib/approvals/policy-queries";
import { APPROVAL_MODULE_LABELS, APPROVAL_ACTION_TYPE_LABELS } from "@/lib/approvals/display";
import Sidebar from "../../components/sidebar";
import { ArrowLeft } from "lucide-react";
import PoliciesPanel from "./policies-panel";

/**
 * Milestone 8 (spec section 5: "a practical way for authorised
 * management users to configure approval rules"). SALES_MANAGER/
 * ADMINISTRATOR only -- enforced again server-side by every
 * /api/approval-policies route regardless of this page's own guard.
 * ORDER_VALUE_EXCEEDS_THRESHOLD policies are visibly labeled "not yet
 * enforced" (via each row's own `enforced` flag) -- schema/policy
 * support for Customer-PO/order-value thresholds exists per this
 * milestone's scope, but no live gate is wired into order creation yet
 * (a deliberate, user-confirmed decision for this round).
 */
export const instant = false;

export default async function ApprovalPoliciesPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "SALES_MANAGER" && user.role !== "ADMINISTRATOR") {
    redirect("/approvals");
  }

  const policies = await listApprovalPolicies();

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Approvals / Policies</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Approval Policies</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <Link href="/approvals" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-[#173D2E]">
            <ArrowLeft size={15} />
            Back to approvals
          </Link>

          <section>
            <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Configure approval rules</h1>
            <p className="mt-1 text-sm text-gray-500">
              Thresholds are set by management here -- nothing in this codebase hardcodes a minimum margin or discount
              limit. A rule only takes effect while &ldquo;Active&rdquo; and inside its optional effective date window.
              When more than one active rule could fire on the same submission, the most restrictive (lowest) threshold
              wins.
            </p>
          </section>

          <PoliciesPanel
            policies={policies}
            moduleLabels={APPROVAL_MODULE_LABELS}
            actionTypeLabels={APPROVAL_ACTION_TYPE_LABELS}
          />

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
