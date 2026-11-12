"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlusCircle } from "lucide-react";

/**
 * Milestone 10 (Communication Channels & Fulfilment). The manual intake
 * fallback form (spec point 2's explicit "provide a manual intake
 * fallback where no authorised integration exists") -- a staff member
 * who took a call or read a WhatsApp message on their own phone (no
 * webhook configured) logs it here, producing the exact same
 * MessageIntake row shape app/api/channels/manual-intake/route.ts's own
 * comment describes. Collapsed by default so it doesn't crowd the queue
 * table above it.
 */
export default function ManualIntakeForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<"MANUAL" | "EMAIL" | "WHATSAPP">("MANUAL");
  const [fromAddress, setFromAddress] = useState("");
  const [fromDisplayName, setFromDisplayName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!fromAddress.trim()) {
      setError("The customer's email, phone number, or name is required.");
      return;
    }
    if (!bodyText.trim() && !file) {
      setError("Enter what the customer said, or attach the file they sent.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("channel", channel);
      formData.set("fromAddress", fromAddress.trim());
      if (fromDisplayName.trim()) formData.set("fromDisplayName", fromDisplayName.trim());
      if (subject.trim()) formData.set("subject", subject.trim());
      if (bodyText.trim()) formData.set("bodyText", bodyText.trim());
      if (file) formData.set("file", file);

      const response = await fetch("/api/channels/manual-intake", { method: "POST", body: formData });
      const body: unknown = await response.json().catch(() => ({}));
      const success = typeof body === "object" && body !== null && (body as { success?: boolean }).success;
      if (!response.ok || !success) {
        const message = typeof body === "object" && body !== null ? (body as { message?: string }).message : undefined;
        setError(message ?? "Unable to log this message.");
        return;
      }

      setFromAddress("");
      setFromDisplayName("");
      setSubject("");
      setBodyText("");
      setFile(null);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
      >
        <PlusCircle size={14} />
        Log a message manually
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-[#E8EBE6] bg-white p-6">
      <h2 className="text-[13px] font-bold text-[#17251E]">Log a message manually</h2>
      <p className="mt-1 text-xs text-gray-400">
        For a call, walk-in, or a message read on a personal phone/inbox with no webhook configured.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
          <option value="MANUAL">Phone / in person</option>
          <option value="EMAIL">Email (no webhook)</option>
          <option value="WHATSAPP">WhatsApp (no webhook)</option>
        </select>
        <input
          type="text"
          value={fromAddress}
          onChange={(e) => setFromAddress(e.target.value)}
          placeholder="Customer email, phone, or name"
          className="rounded-lg border border-gray-200 px-3 py-2 text-xs"
        />
        <input
          type="text"
          value={fromDisplayName}
          onChange={(e) => setFromDisplayName(e.target.value)}
          placeholder="Customer display name (optional)"
          className="rounded-lg border border-gray-200 px-3 py-2 text-xs"
        />
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject (optional)"
          className="rounded-lg border border-gray-200 px-3 py-2 text-xs"
        />
      </div>

      <textarea
        value={bodyText}
        onChange={(e) => setBodyText(e.target.value)}
        rows={3}
        placeholder="What the customer said, as close to their own words as possible"
        className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
      />

      <div className="mt-3 flex items-center gap-3">
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
      </div>

      {error && <p className="mt-3 text-[11px] text-[#9B3B3B]">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={14} />}
          Log message
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
