const TONE: Record<string, string> = {
  ACTIVE: "bg-green-50 text-green-800", APPROVED: "bg-green-50 text-green-800", ACCEPTED: "bg-green-50 text-green-800", RESOLVED: "bg-green-50 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-600", INACTIVE: "bg-gray-100 text-gray-600", CLOSED: "bg-gray-100 text-gray-600", EXPIRED: "bg-gray-100 text-gray-600",
  REJECTED: "bg-red-50 text-red-700", DRAFT: "bg-slate-100 text-slate-700",
};
export function StatusBadge({ status }: { status: string }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${TONE[status] ?? "bg-amber-50 text-amber-800"}`}>{status.replace(/_/g, " ")}</span>;
}

export const userOptions = (users: { id: string; name: string }[], placeholder = "Choose a user…") => [{ value: "", label: placeholder }, ...users.map((u) => ({ value: u.id, label: u.name }))];
