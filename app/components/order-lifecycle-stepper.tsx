import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OrderLifecycleStep } from "@/lib/order-display";

/**
 * Workflow/Navigation/Performance round, Part 3: "a consistent
 * lifecycle/progress indicator on relevant detail pages." One shared
 * component so every page that shows this (order detail, fulfilment)
 * renders it identically rather than each growing its own copy -- see
 * lib/order-display.ts's getOrderLifecycleSteps for how the steps
 * themselves are derived (never a second stored status).
 *
 * Compact layout: the eight steps are equal-width cells in a responsive
 * grid (4 per row on narrow screens, all 8 on one row from `lg`), each a
 * small card with the step number/tick, its label and a one-word state.
 * Nothing forces horizontal scrolling at any width -- the previous
 * fixed-width connector layout needed ~760px and scrolled on tablets.
 *
 * Pure presentational Server Component (no client state, no handlers) --
 * safe to render from either a Server or Client Component page.
 */
const STATE_LABEL: Record<OrderLifecycleStep["state"], string> = {
  done: "Done",
  current: "In progress",
  upcoming: "Pending",
};

export default function OrderLifecycleStepper({ steps }: { steps: OrderLifecycleStep[] }) {
  return (
    <ol className="grid grid-cols-4 gap-2 lg:grid-cols-8" aria-label="Order lifecycle progress">
      {steps.map((step, index) => (
        <li
          key={step.key}
          aria-current={step.state === "current" ? "step" : undefined}
          className={`flex min-w-0 flex-col gap-1 rounded-lg border px-2.5 py-2 ${
            step.state === "done"
              ? "border-[#173D2E]/20 bg-[#173D2E]/5"
              : step.state === "current"
                ? "border-[#173D2E]/40 bg-[#D7F36B]/30"
                : "border-gray-100 bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                step.state === "done"
                  ? "bg-[#173D2E] text-white"
                  : step.state === "current"
                    ? "bg-[#D7F36B] text-[#10271F] ring-1 ring-[#173D2E]/40"
                    : "bg-gray-200 text-gray-500"
              }`}
            >
              {step.state === "done" ? <Check size={11} /> : index + 1}
            </span>
            <span className={`truncate text-[11px] font-semibold ${step.state === "upcoming" ? "text-gray-400" : "text-[#17251E]"}`}>
              {step.label}
            </span>
          </div>
          <Badge
            variant={step.state === "done" ? "secondary" : "outline"}
            className={`h-4 px-1.5 text-[9px] ${step.state === "current" ? "border-[#173D2E]/40 text-[#173D2E]" : ""}`}
          >
            {STATE_LABEL[step.state]}
          </Badge>
        </li>
      ))}
    </ol>
  );
}
