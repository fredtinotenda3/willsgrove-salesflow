"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, FileText, Loader2, PackageCheck, Truck } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { OrderNextAction } from "@/lib/order-display";

/**
 * The "what happens next" bar of the order workflow. Which buttons appear is
 * decided by getOrderNextActions (lib/order-display.ts); every gate behind
 * them is enforced again on the server.
 *
 *   Mark as Invoiced     scrolls to the invoice step on the order page
 *   Dispatch             opens the dispatch screen (only invoiced goods can leave)
 *   Record delivery      opens the dispatch screen where delivery is recorded
 *   Mark as Done         POST /api/orders/[id]/complete
 */
export default function OrderNextStep({ orderId, actions, statusLabel }: { orderId: string; actions: OrderNextAction[]; statusLabel: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  if (actions.length === 0) return null;

  async function markDone() {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/complete`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; claimCount?: number };
      if (!response.ok || !body.success) {
        const message = body.message ?? "Unable to complete this order.";
        setError(message);
        toast.error("Order not completed", { description: message });
        return;
      }
      toast.success("Order completed", {
        description: body.claimCount ? `Recorded with ${body.claimCount} claim${body.claimCount === 1 ? "" : "s"} from delivery.` : "Delivered with nothing rejected.",
      });
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      toast.error("Order not completed", { description: "Could not reach the server." });
    } finally {
      lock.current = false;
      setWorking(false);
    }
  }

  const buttonClass = "inline-flex items-center gap-1.5 rounded-lg bg-[#173D2E] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110";

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E8EBE6] bg-white px-5 py-4" aria-label="Next step">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Current stage</p>
        <p className="text-sm font-bold text-[#17251E]">{statusLabel}</p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {actions.map((action) => {
          if (action.key === "INVOICE") {
            return (
              <a key={action.key} href="#invoice" className={buttonClass}>
                <FileText size={14} /> {action.label}
              </a>
            );
          }
          if (action.key === "DISPATCH") {
            return (
              <Link key={action.key} href={`/fulfilment/${orderId}`} className={buttonClass}>
                <Truck size={14} /> {action.label}
              </Link>
            );
          }
          if (action.key === "RECORD_DELIVERY") {
            return (
              <Link key={action.key} href={`/fulfilment/${orderId}`} className={buttonClass}>
                <PackageCheck size={14} /> {action.label}
              </Link>
            );
          }
          return (
            <button key={action.key} type="button" onClick={() => { setError(null); setConfirming(true); }} className={buttonClass}>
              <CheckCircle2 size={14} /> {action.label}
            </button>
          );
        })}
      </div>

      <AlertDialog open={confirming} onOpenChange={(open) => { if (!working) setConfirming(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this order as done?</AlertDialogTitle>
            <AlertDialogDescription>
              This closes the order: its invoice(s) are recorded as delivered, with a claim attached where products were
              rejected at delivery, and the order moves to Delivered Orders.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Not yet</AlertDialogCancel>
            <button
              type="button"
              onClick={() => void markDone()}
              disabled={working}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#173D2E] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {working ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Mark as Done
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
