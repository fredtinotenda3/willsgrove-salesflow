const GREEN = "bg-emerald-50 text-emerald-800 ring-emerald-600/15";
const GREY = "bg-slate-100 text-slate-600 ring-slate-500/15";
const RED = "bg-red-50 text-red-700 ring-red-600/15";
const AMBER = "bg-amber-50 text-amber-800 ring-amber-600/20";
const BLUE = "bg-sky-50 text-sky-800 ring-sky-600/15";
const SLATE = "bg-slate-50 text-slate-700 ring-slate-500/15";

const TONE: Record<string, string> = {
  ACTIVE: GREEN, APPROVED: GREEN, ACCEPTED: GREEN, RESOLVED: GREEN, MATCHED: GREEN, COMPLETED: GREEN, SUCCEEDED: GREEN, SENT: GREEN, DELIVERED: GREEN, AUTO_MATCHED: GREEN, MANUALLY_MATCHED: GREEN, ACCEPTED_IN_FULL: GREEN, AUTHORIZED: GREEN, READY_TO_INVOICE: GREEN, INVOICED: BLUE,
  CANCELLED: GREY, INACTIVE: GREY, CLOSED: GREY, EXPIRED: GREY, DISMISSED: GREY, IGNORED: GREY, WITHDRAWN: GREY, CANCELLED_REVERSED: GREY, DUPLICATE: GREY, CANNOT_LINK: GREY,
  REJECTED: RED, FAILED: RED, FULLY_REJECTED: RED, UNCERTAIN: RED,
  DRAFT: SLATE, PLANNED: SLATE, QUEUED: SLATE, PENDING: AMBER, UNMATCHED: AMBER, RECONCILIATION_REQUIRED: AMBER, PARTIALLY_MATCHED: AMBER, PARTIALLY_RESOLVED: AMBER, PARTIAL: AMBER, PARTIALLY_INVOICED: AMBER, PARTIALLY_REJECTED: AMBER, AWAITING_CUSTOMER: AMBER, AWAITING_INTERNAL_ACTION: AMBER, URGENT: RED, HIGH: AMBER,
  OPEN: BLUE, RECEIVED: BLUE, ISSUED: BLUE, PICKING: BLUE, UNDER_INVESTIGATION: BLUE, IN_PROGRESS: BLUE, RUNNING: BLUE, PROCESSING: BLUE, DEPARTED: BLUE, DISPATCHED: BLUE, CONVERTED: BLUE, LINKED: BLUE, ACKNOWLEDGED: BLUE, IN_PROGRESS_PICK: BLUE,
};

/** Status chip: tone follows meaning (green = complete/healthy, amber = needs attention, red = failed/refused, grey = closed/inactive, blue = in progress). */
export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONE[status] ?? AMBER} ${className}`}>{status.replace(/_/g, " ")}</span>;
}

export const userOptions = (users: { id: string; name: string }[], placeholder = "Choose a user…") => [{ value: "", label: placeholder }, ...users.map((u) => ({ value: u.id, label: u.name }))];
