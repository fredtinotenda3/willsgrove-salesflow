import Link from "next/link";
import { getSettingValues, getStoredSettingKeys } from "@/lib/admin/settings-store";
import { SETTING_DEFINITIONS, type SettingGroup } from "@/lib/admin/settings-registry";
import { PageHeader, Panel as SectionCard } from "../_components/ui";
import { requireAdminPage } from "../_components/admin-shell";
import { SettingRow } from "../_components/setting-row";

export const instant = false;

const GROUPS: { id: SettingGroup; title: string; description: string }[] = [
  { id: "quotations", title: "Quotations", description: "Defaults used when sales staff create quotations." },
  { id: "operations", title: "Operations", description: "When operational work is treated as idle." },
  { id: "management", title: "Management recommendations", description: "The review lines that turn report data into management findings. A finding is only raised when at least the minimum number of records supports it." },
];

export default async function AdminConfigurationPage() {
  await requireAdminPage();
  const [values, stored] = await Promise.all([getSettingValues(), getStoredSettingKeys()]);
  return (
    <div className="space-y-4">
      <PageHeader title="Business configuration" description="Every change is validated against fixed bounds, needs a reason, takes effect immediately and is recorded in the audit log." />
      <SectionCard title="What is deliberately not configurable">
        <p className="p-4 text-sm text-[#5F6F66]">Sign-in and session rules, role permissions, CSRF protection, financial calculations (claim values, credit notes, currency separation, decimal precision) and the protection of invoiced or delivered records are enforced in code and cannot be changed here. Approval thresholds are managed on the <Link href="/approvals/policies" className="font-semibold text-[#1F7A4D]">approval policies</Link> screen. Notification preferences and per-user permissions are not supported by the current architecture.</p>
      </SectionCard>
      {GROUPS.map((g) => (
        <SectionCard key={g.id} title={g.title} description={g.description}>
          {SETTING_DEFINITIONS.filter((d) => d.group === g.id).map((d) => (
            <SettingRow key={d.key} settingKey={d.key} label={d.label} description={d.description} unit={d.unit} min={d.min} max={d.max} value={values[d.key]} defaultValue={d.defaultValue} effect={d.effect} changedBy={stored.get(d.key)?.updatedByName ?? null} />
          ))}
        </SectionCard>
      ))}
    </div>
  );
}
