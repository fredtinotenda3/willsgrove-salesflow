import { listPersonnel } from "@/lib/personnel";
import { listVehicles } from "@/lib/vehicles";
import { PageHeader, Panel as SectionCard } from "../_components/ui";
import { EmptyState } from "../../reports/_components/ui";
import { requireAdminPage } from "../_components/admin-shell";
import { ActionDialog, type DialogField } from "../_components/action-dialog";
import { StatusBadge } from "../_components/status-badge";

export const instant = false;
const ROLES = [{ value: "DRIVER", label: "Driver" }, { value: "DRIVER_ASSISTANT", label: "Driver's assistant" }, { value: "OTHER", label: "Other (give detail)" }];

const personFields = (p?: { name: string; role: string; roleDetail: string | null; phone: string | null; notes: string | null }): DialogField[] => [
  { name: "name", label: "Name", type: "text", required: true, defaultValue: p?.name },
  { name: "role", label: "Role", type: "select", options: ROLES, defaultValue: p?.role ?? "DRIVER" },
  { name: "roleDetail", label: "Role detail (required for Other)", type: "text", defaultValue: p?.roleDetail ?? "" },
  { name: "phone", label: "Phone", type: "text", defaultValue: p?.phone ?? "" },
  { name: "notes", label: "Notes", type: "textarea", defaultValue: p?.notes ?? "" },
];
const vehicleFields = (v?: { registrationNumber: string; description: string | null; notes: string | null }): DialogField[] => [
  { name: "registrationNumber", label: "Registration number", type: "text", required: true, defaultValue: v?.registrationNumber },
  { name: "description", label: "Description (make / model / type)", type: "text", defaultValue: v?.description ?? "" },
  { name: "notes", label: "Notes", type: "textarea", defaultValue: v?.notes ?? "" },
];

/** Drivers, assistants and vehicles used on dispatch. Those with dispatch history can only be deactivated, never deleted. */
export default async function AdminFleetPage() {
  await requireAdminPage();
  const [people, vehicles] = await Promise.all([listPersonnel(), listVehicles()]);
  return (
    <div className="space-y-4">
      <PageHeader title="Drivers, assistants & vehicles" description="Only people and vehicles recorded here can be assigned to a dispatch. A record used on a dispatch is deactivated rather than deleted so delivery history stays complete." />
      <SectionCard title={`Drivers & assistants (${people.length})`} description="People without a SalesFlow login.">
        <div className="flex justify-end px-4 pt-3"><ActionDialog label="Add person" variant="primary" title="Add driver / assistant" endpoint="/api/personnel" askReason={false} blank="omit" confirmLabel="Add" fields={personFields()} /></div>
        {people.length === 0 ? <EmptyState message="No drivers or assistants recorded yet." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Role</th><th className="px-4 py-2">Phone</th><th className="px-4 py-2">Dispatches</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Actions</th></tr></thead>
            <tbody>{people.map((p) => (
              <tr key={p.id} className="border-t border-[#EEF1ED]">
                <td className="px-4 py-2 font-medium">{p.name}</td><td className="px-4 py-2 text-xs">{p.role.replace(/_/g, " ")}{p.roleDetail ? ` — ${p.roleDetail}` : ""}</td><td className="px-4 py-2 text-xs">{p.phone ?? "—"}</td><td className="px-4 py-2">{p.dispatchHistoryCount}</td>
                <td className="px-4 py-2"><StatusBadge status={p.status} /></td>
                <td className="px-4 py-2"><div className="flex flex-wrap gap-2">
                  <ActionDialog label="Edit" title={`Edit ${p.name}`} endpoint={`/api/personnel/${p.id}`} method="PATCH" askReason={false} blank="omit" confirmLabel="Save" fields={personFields(p)} />
                  {p.status === "ACTIVE" ? <ActionDialog label="Deactivate" variant="danger" title={`Deactivate ${p.name}?`} description="They can no longer be assigned to new dispatches. History is kept." endpoint={`/api/personnel/${p.id}`} method="PATCH" payload={{ status: "INACTIVE" }} askReason={false} confirmLabel="Deactivate" /> : <ActionDialog label="Reactivate" variant="primary" title={`Reactivate ${p.name}?`} endpoint={`/api/personnel/${p.id}`} method="PATCH" payload={{ status: "ACTIVE" }} askReason={false} confirmLabel="Reactivate" />}
                  {p.dispatchHistoryCount === 0 ? <ActionDialog label="Delete" variant="danger" destructive title={`Delete ${p.name}?`} description="Permanent. Allowed only because they have never been used on a dispatch." endpoint={`/api/personnel/${p.id}`} method="DELETE" askReason={false} confirmLabel="Delete" /> : null}
                </div></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </SectionCard>
      <SectionCard title={`Vehicles (${vehicles.length})`}>
        <div className="flex justify-end px-4 pt-3"><ActionDialog label="Add vehicle" variant="primary" title="Add vehicle" endpoint="/api/vehicles" askReason={false} blank="omit" confirmLabel="Add" fields={vehicleFields()} /></div>
        {vehicles.length === 0 ? <EmptyState message="No vehicles recorded yet." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr><th className="px-4 py-2">Registration</th><th className="px-4 py-2">Description</th><th className="px-4 py-2">Dispatches</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Actions</th></tr></thead>
            <tbody>{vehicles.map((v) => (
              <tr key={v.id} className="border-t border-[#EEF1ED]">
                <td className="px-4 py-2 font-mono text-xs font-semibold">{v.registrationNumber}</td><td className="px-4 py-2">{v.description ?? "—"}</td><td className="px-4 py-2">{v.dispatchHistoryCount}</td>
                <td className="px-4 py-2"><StatusBadge status={v.status} /></td>
                <td className="px-4 py-2"><div className="flex flex-wrap gap-2">
                  <ActionDialog label="Edit" title={`Edit ${v.registrationNumber}`} endpoint={`/api/vehicles/${v.id}`} method="PATCH" askReason={false} blank="omit" confirmLabel="Save" fields={vehicleFields(v)} />
                  {v.status === "ACTIVE" ? <ActionDialog label="Deactivate" variant="danger" title={`Deactivate ${v.registrationNumber}?`} description="It can no longer be assigned to new dispatches. History is kept." endpoint={`/api/vehicles/${v.id}`} method="PATCH" payload={{ status: "INACTIVE" }} askReason={false} confirmLabel="Deactivate" /> : <ActionDialog label="Reactivate" variant="primary" title={`Reactivate ${v.registrationNumber}?`} endpoint={`/api/vehicles/${v.id}`} method="PATCH" payload={{ status: "ACTIVE" }} askReason={false} confirmLabel="Reactivate" />}
                  {v.dispatchHistoryCount === 0 ? <ActionDialog label="Delete" variant="danger" destructive title={`Delete ${v.registrationNumber}?`} description="Permanent. Allowed only because it has never been used on a dispatch." endpoint={`/api/vehicles/${v.id}`} method="DELETE" askReason={false} confirmLabel="Delete" /> : null}
                </div></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </SectionCard>
    </div>
  );
}
