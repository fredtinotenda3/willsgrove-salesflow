import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getOrCreateConnection } from "@/lib/integrations/sap/connection";
import { getSapDeploymentMode } from "@/lib/integrations/sap/config";
import Sidebar from "../../../components/sidebar";
import SapConnectionForm from "./sap-connection-form";

/**
 * Milestone 9 (SAP Business One Integration). ADMINISTRATOR-only
 * connection settings page (spec section 6). The password field is
 * deliberately absent from this page entirely -- it is environment-only
 * (SAP_B1_PASSWORD, lib/integrations/sap/config.ts) and this page never
 * reads or displays it.
 */
export const instant = false;

export default async function SapSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMINISTRATOR") redirect("/integrations/sap");

  const connection = await getOrCreateConnection();
  const deploymentMode = getSapDeploymentMode();

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Integrations / SAP Business One / Settings</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Connection settings</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">
            <h2 className="text-sm font-bold text-[#17251E]">Deployment mode</h2>
            <p className="mt-1 text-xs text-gray-500">
              Set by the <code className="rounded bg-gray-100 px-1 py-0.5">SAP_B1_PROVIDER</code> environment variable on the server, not from
              this page. It is a hard ceiling: even with &quot;Live&quot; selected and enabled below, live calls to SAP only actually happen when
              this also says &quot;live&quot;.
            </p>
            <p className="mt-2 text-sm font-semibold text-[#17251E]">
              Currently: {deploymentMode === "live" ? "live calls permitted" : "mock only (SAP_B1_PROVIDER is not set to \"live\")"}
            </p>
          </div>

          <SapConnectionForm initialConnection={connection} />

          <div className="rounded-xl border border-[#E8EBE6] bg-white p-5 text-xs text-gray-500">
            <h2 className="text-sm font-bold text-[#17251E]">Password</h2>
            <p className="mt-1">
              The SAP Service Layer password is never stored in this database and never shown on this page -- set it as the{" "}
              <code className="rounded bg-gray-100 px-1 py-0.5">SAP_B1_PASSWORD</code> environment variable on the server. See{" "}
              <code className="rounded bg-gray-100 px-1 py-0.5">docs/sap-integration/discovery-checklist.md</code> for the full list of details
              Bulawayo HQ needs to supply before live mode can be turned on.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
