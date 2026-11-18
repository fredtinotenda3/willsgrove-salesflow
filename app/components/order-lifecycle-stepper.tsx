import { Check } from "lucide-react";
import type { OrderLifecycleStep } from "@/lib/order-display";

/**
 * Workflow/Navigation/Performance round, Part 3: "a consistent
 * lifecycle/progress indicator on relevant detail pages." One shared
 * component so every page that shows this (order detail, fulfilment)
 * renders it identically rather than each growing its own copy -- see
 * lib/order-display.ts's getOrderLifecycleSteps for how the steps
 * themselves are derived (never a second stored status).
 *
 * Pure presentational Server Component (no client state, no handlers) --
 * safe to render from either a Server or Client Component page.
 */
export default function OrderLifecycleStepper({ steps }: { steps: OrderLifecycleStep[] }) {
  return (
    <div className="flex items-center overflow-x-auto pb-1" role="list" aria-label="Order lifecycle progress">
      {steps.map((step, index) => (
        <div key={step.key} className="flex items-center" role="listitem">
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                step.state === "done"
                  ? "bg-[#173D2E] text-white"
                  : step.state === "current"
                    ? "bg-[#D7F36B] text-[#10271F] ring-2 ring-[#173D2E]/30"
                    : "bg-gray-100 text-gray-400"
              }`}
              aria-current={step.state === "current" ? "step" : undefined}
            >
              {step.state === "done" ? <Check size={13} /> : index + 1}
            </div>
            <span
              className={`whitespace-nowrap text-[10px] font-semibold ${
                step.state === "upcoming" ? "text-gray-400" : "text-[#17251E]"
              }`}
            >
              {step.label}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div className={`mx-2 h-px w-8 shrink-0 ${step.state === "done" ? "bg-[#173D2E]" : "bg-gray-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}
