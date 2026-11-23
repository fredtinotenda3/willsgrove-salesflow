import { Badge } from "@/components/ui/badge";
import { formatOrderDateTime } from "@/lib/order-display";
import type { AssignmentHistoryEntry, AssignmentSnapshot } from "@/lib/fulfilment/assignment-history";

/**
 * Renders a dispatch's recorded driver/assistant/vehicle assignment history:
 * the initial assignment, then each change (who changed it, when, what it was
 * before, and the reason). Shared by the order detail page and the Delivered
 * Orders detail page so both read identically. Renders nothing when no
 * assignment event was ever recorded -- history is never reconstructed.
 * Presentational Server Component (no state, no handlers).
 */
const FIELD_LABEL: Record<keyof AssignmentSnapshot, string> = { driver: "Driver", assistant: "Assistant", vehicle: "Vehicle" };

function describe(snapshot: AssignmentSnapshot): string {
  return `${snapshot.driver ?? "Not Available"} · ${snapshot.assistant ?? "Not Available"} · ${snapshot.vehicle ?? "Not Available"}`;
}

export default function DispatchAssignmentHistory({ entries }: { entries: AssignmentHistoryEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <div className="mt-2 border-t border-[#F0F2EF] pt-2">
      <p className="text-[11px] font-medium text-gray-600">Assignment history</p>
      <ul className="mt-1 space-y-1">
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
            <Badge variant={entry.kind === "ASSIGNED" ? "secondary" : "outline"} className="h-4 px-1.5 text-[9px]">
              {entry.kind === "ASSIGNED" ? "Assigned" : "Changed"}
            </Badge>
            <span>
              {formatOrderDateTime(entry.at)} ({entry.byName ?? "Not Available"})
            </span>
            {entry.kind === "ASSIGNED" ? (
              <span>Driver / assistant / vehicle: {describe(entry.current)}</span>
            ) : (
              <span>
                {entry.changed.map((field, index) => (
                  <span key={field}>
                    {index > 0 && "; "}
                    {FIELD_LABEL[field]}: {entry.previous?.[field] ?? "Not Available"} → {entry.current[field] ?? "Not Available"}
                  </span>
                ))}
                {entry.reason && <span className="italic"> — {entry.reason}</span>}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
