"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";

/**
 * Milestone 10 (Communication Channels & Fulfilment). The one client
 * island on an otherwise server-rendered /communications page -- same
 * "small client component for the one interactive bit" split as
 * app/fulfilment/[id]/page.tsx's PickingPanel. Re-fetches the page's own
 * server data afterwards via router.refresh() rather than updating
 * local state, since a resend changes the row's status server-side and
 * this component has no reason to duplicate that server read.
 */
export default function ResendButton({ messageId }: { messageId: string }) {
  const router = useRouter();
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setResending(true);
    setError(null);
    try {
      const response = await fetch(`/api/communications/${messageId}/resend`, { method: "POST" });
      const body: unknown = await response.json().catch(() => ({}));
      const success = typeof body === "object" && body !== null && (body as { success?: boolean }).success;
      if (!response.ok || !success) {
        const message = typeof body === "object" && body !== null ? (body as { message?: string }).message : undefined;
        setError(message ?? "Unable to resend this message.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void resend()}
        disabled={resending}
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
      >
        {resending ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
        Resend
      </button>
      {error && <p className="max-w-[180px] text-right text-[10px] text-[#9B3B3B]">{error}</p>}
    </div>
  );
}
