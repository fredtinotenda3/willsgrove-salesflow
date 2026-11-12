import "server-only";
import { requireUserOrResponse } from "@/lib/auth/current-user";

/**
 * Milestone 11 (Operational BI). Role-gating for the M11 reporting
 * surface (spec sections 2/10). Two tiers, decided against this app's
 * own existing precedent (every GET dashboard/report route today --
 * invoice claims, quotations, lost sales, invoice reconciliation,
 * approvals -- is open to any authenticated role; role restriction is
 * reserved for mutating actions and the SAP integration surface):
 *
 *   - Operational views (spec sections 3/4/5/6/7 -- the operational
 *     dashboard, sales-pipeline/order intelligence, picking/fulfilment
 *     intelligence, financial-exposure dashboard, communications
 *     monitoring): open to SALESPERSON/SALES_MANAGER/ADMINISTRATOR,
 *     matching the existing dashboard precedent exactly.
 *     requireUserOrResponse() with no role list already does this.
 *
 *   - Management reports (spec section 9's 10 named reports, and their
 *     CSV exports): restricted to SALES_MANAGER/ADMINISTRATOR, the same
 *     restriction already used for the SAP integration dashboard
 *     (app/api/integrations/sap/dashboard/route.ts). This function is
 *     that restriction, named for its M11 purpose so every management-
 *     report route states its intent rather than repeating the role
 *     array by hand.
 *
 * Enforced server-side only, in every route that needs it -- never a
 * UI-only hide (spec section 10: "never rely on hiding a UI component
 * as the sole security control"). The nav/page-level hiding for
 * SALESPERSON is a UX convenience on top of this, not a substitute.
 */
export async function requireManagementReportAccess() {
  return requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
}
