"use client";

import { useEffect, useState } from "react";
import { Loader2, PlayCircle, CheckCircle2, ShieldCheck } from "lucide-react";
import { classifyAvailability, type AvailabilityStatus } from "@/lib/picking/validation";

/**
 * Milestone 3B (SAP Invoice Handover Specification -- warehouse
 * picking). The one client-rendered "island" on app/fulfilment/[id]/
 * page.tsx (an otherwise async Server Component), same split as
 * app/orders/[id]/page.tsx + HandoverPanel. Drives the full
 * start -> record -> complete -> authorize lifecycle against the
 * Milestone 3A API. Always re-fetches the session from the server after
 * every mutating action (never an optimistic update) -- the same
 * "re-fetch, don't guess" convention HandoverPanel already established,
 * which matters even more here since a completed/authorized session
 * locks its lines server-side and this panel must reflect that exactly.
 */

type OrderLineSummary = {
  id: string;
  lineNumber: number;
  originalProductDescription: string;
  requestedQuantity: string;
  requestedUnitCode: string;
};

type PickingLineDetail = {
  id: string;
  orderLineId: string;
  lineNumber: number;
  originalProductDescription: string;
  requestedQuantity: string;
  foundQuantity: string | null;
  unavailableQuantity: string | null;
  notes: string | null;
  pickedById: string | null;
  pickedAt: string | null;
};

type PickingSessionDetail = {
  id: string;
  orderId: string;
  status: "IN_PROGRESS" | "COMPLETED" | "AUTHORIZED";
  startedById: string;
  startedAt: string;
  completedById: string | null;
  completedAt: string | null;
  authorizedById: string | null;
  authorizedAt: string | null;
  notes: string | null;
  lines: PickingLineDetail[];
};

type LineInput = { found: string; unavailable: string; notes: string };

// Mirrors lib/picking/validation.ts's decimalStringSchema pattern exactly
// -- this is a client-side convenience check only (fail fast, no round
// trip for an obviously malformed value); the server's own check is what
// actually matters, so a mismatch between this and the server can only
// ever be over-strict here, never under-strict there.
const DECIMAL_PATTERN = /^\d+(\.\d{1,4})?$/;

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function emptyInput(): LineInput {
  return { found: "", unavailable: "", notes: "" };
}

// Milestone 3 completion (Warehouse Assembly Form & Partial Availability).
// The spec's section 5 requires every line to be clearly identifiable as
// fully available, partially available, or completely unavailable once
// findings are recorded -- this maps classifyAvailability's one shared
// classification (lib/picking/validation.ts) to a label and color, read
// directly off the SAVED session data (line.foundQuantity/
// unavailableQuantity), never off an unsaved/in-progress input value, so
// the badge never claims a status the server hasn't actually recorded
// yet.
const AVAILABILITY_BADGE: Record<AvailabilityStatus, { label: string; style: string }> = {
  FULLY_AVAILABLE: { label: "Fully Available", style: "bg-emerald-50 text-emerald-700" },
  PARTIALLY_AVAILABLE: { label: "Partially Available", style: "bg-amber-50 text-amber-700" },
  COMPLETELY_UNAVAILABLE: { label: "Unavailable", style: "bg-red-50 text-red-700" },
  PENDING: { label: "Not yet recorded", style: "bg-gray-100 text-gray-400" },
};

export default function PickingPanel({
  orderId,
  canAuthorize,
  lines,
}: {
  orderId: string;
  canAuthorize: boolean;
  lines: OrderLineSummary[];
}) {
  const [session, setSession] = useState<PickingSessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [inputs, setInputs] = useState<Record<string, LineInput>>({});
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});

  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const [authorizing, setAuthorizing] = useState(false);
  const [authorizeError, setAuthorizeError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/picking`, { cache: "no-store" });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setLoadError((body.message as string) ?? "Unable to load this order's picking session.");
        return;
      }
      const loadedSession = (body.session as PickingSessionDetail | null) ?? null;
      setSession(loadedSession);

      const nextInputs: Record<string, LineInput> = {};
      if (loadedSession) {
        for (const line of loadedSession.lines) {
          nextInputs[line.orderLineId] = {
            found: line.foundQuantity ?? "",
            unavailable: line.unavailableQuantity ?? "",
            notes: line.notes ?? "",
          };
        }
      }
      setInputs(nextInputs);
    } catch {
      setLoadError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Same reasoning as HandoverPanel's mount effect: wrapping in
    // Promise.resolve().then(...) avoids react-hooks/set-state-in-effect.
    void Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function startPicking() {
    setStarting(true);
    setStartError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/picking`, { method: "POST" });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setStartError((body.message as string) ?? "Unable to start picking for this order.");
        return;
      }
      await load();
    } catch {
      setStartError("Could not reach the server.");
    } finally {
      setStarting(false);
    }
  }

  function updateInput(orderLineId: string, field: keyof LineInput, value: string) {
    setInputs((prev) => ({ ...prev, [orderLineId]: { ...(prev[orderLineId] ?? emptyInput()), [field]: value } }));
  }

  async function saveLine(orderLineId: string) {
    if (!session) return;
    const input = inputs[orderLineId] ?? emptyInput();
    const found = input.found.trim();
    const unavailable = input.unavailable.trim();

    if (!DECIMAL_PATTERN.test(found) || !DECIMAL_PATTERN.test(unavailable)) {
      setLineErrors((prev) => ({
        ...prev,
        [orderLineId]: "Enter a non-negative number (up to 4 decimal places) for both found and unavailable.",
      }));
      return;
    }

    setSavingLineId(orderLineId);
    setLineErrors((prev) => ({ ...prev, [orderLineId]: "" }));
    try {
      const response = await fetch(`/api/orders/${orderId}/picking/${session.id}/lines/${orderLineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foundQuantity: found, unavailableQuantity: unavailable, notes: input.notes.trim() || undefined }),
      });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setLineErrors((prev) => ({ ...prev, [orderLineId]: (body.message as string) ?? "Unable to save this line." }));
        return;
      }
      await load();
    } catch {
      setLineErrors((prev) => ({ ...prev, [orderLineId]: "Could not reach the server." }));
    } finally {
      setSavingLineId(null);
    }
  }

  async function completePicking() {
    if (!session) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/picking/${session.id}/complete`, { method: "POST" });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setCompleteError((body.message as string) ?? "Unable to complete picking for this order.");
        return;
      }
      await load();
    } catch {
      setCompleteError("Could not reach the server.");
    } finally {
      setCompleting(false);
    }
  }

  async function authorizePicking() {
    if (!session) return;
    setAuthorizing(true);
    setAuthorizeError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/picking/${session.id}/authorize`, { method: "POST" });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setAuthorizeError((body.message as string) ?? "Unable to authorize this picking session.");
        return;
      }
      await load();
    } catch {
      setAuthorizeError("Could not reach the server.");
    } finally {
      setAuthorizing(false);
    }
  }

  if (loading && !session) {
    return (
      <section className="flex items-center justify-center rounded-xl border border-[#E8EBE6] bg-white p-12">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
        <p className="text-xs text-[#9B3B3B]">{loadError}</p>
      </section>
    );
  }

  // No session yet, or the latest one was authorized -- either way, the
  // next action is to start a (possibly brand-new) session.
  if (!session || session.status === "AUTHORIZED") {
    return (
      <section className="space-y-4">
        {session && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-semibold text-emerald-800">
              Picking authorized on {formatDateTime(session.authorizedAt)}.
            </p>
            <p className="mt-1 text-[11px] text-emerald-700">
              {session.lines.length} line{session.lines.length === 1 ? "" : "s"} picked. This order is ready for
              invoice handover.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-[#E8EBE6] bg-white p-6">
          <h2 className="text-[15px] font-bold text-[#17251E]">{session ? "Start a new picking session" : "Start picking"}</h2>
          <p className="mt-1 text-xs text-gray-400">
            {session
              ? "A new session is a correction/re-pick -- the earlier, authorized session's history is kept, not overwritten."
              : `${lines.length} line${lines.length === 1 ? "" : "s"} will be set up for picking, with the requested quantity snapshotted for each.`}
          </p>

          <ul className="mt-4 space-y-1.5">
            {lines.map((line) => (
              <li key={line.id} className="flex items-center justify-between text-xs text-gray-600">
                <span>
                  #{line.lineNumber} {line.originalProductDescription}
                </span>
                <span className="font-medium text-gray-700">
                  {line.requestedQuantity} {line.requestedUnitCode}
                </span>
              </li>
            ))}
          </ul>

          {startError && <p className="mt-3 text-[11px] text-[#9B3B3B]">{startError}</p>}

          <button
            type="button"
            onClick={() => void startPicking()}
            disabled={starting}
            className="mt-4 flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {starting ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
            {session ? "Start a new picking session" : "Start picking"}
          </button>
        </div>
      </section>
    );
  }

  const locked = session.status !== "IN_PROGRESS";
  const allLinesAccountedFor = session.lines.every((line) => {
    const input = inputs[line.orderLineId];
    if (!input) return false;
    const found = input.found.trim();
    const unavailable = input.unavailable.trim();
    if (!DECIMAL_PATTERN.test(found) || !DECIMAL_PATTERN.test(unavailable)) return false;
    return Math.abs(Number(found) + Number(unavailable) - Number(line.requestedQuantity)) < 1e-9;
  });

  return (
    <section className="space-y-4">
      <div className={`rounded-xl border p-4 ${session.status === "COMPLETED" ? "border-amber-200 bg-amber-50" : "border-cyan-200 bg-cyan-50"}`}>
        <p className={`text-xs font-semibold ${session.status === "COMPLETED" ? "text-amber-800" : "text-cyan-800"}`}>
          {session.status === "COMPLETED"
            ? `Picking completed on ${formatDateTime(session.completedAt)} -- awaiting authorization.`
            : `Picking in progress -- started ${formatDateTime(session.startedAt)}.`}
        </p>
        {session.status === "COMPLETED" && !canAuthorize && (
          <p className="mt-1 text-[11px] text-amber-700">
            Only a sales manager or administrator can authorize this picking session.
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
        <div className="p-6">
          <h2 className="text-[15px] font-bold text-[#17251E]">Order Lines</h2>
          <p className="mt-1 text-xs text-gray-400">
            Enter what was actually found in the warehouse. Found + unavailable must account for the full requested
            quantity before picking can be completed.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-y border-gray-100 bg-gray-50/70">
                <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">#</th>
                <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Product</th>
                <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Requested</th>
                <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Found</th>
                <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Unavailable</th>
                <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Notes</th>
                <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Availability
                </th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {session.lines.map((line) => {
                const input = inputs[line.orderLineId] ?? emptyInput();
                const error = lineErrors[line.orderLineId];
                const availability = classifyAvailability(
                  line.foundQuantity,
                  line.unavailableQuantity,
                  line.requestedQuantity
                );
                const badge = AVAILABILITY_BADGE[availability];
                return (
                  <tr key={line.id} className="border-b border-gray-50">
                    <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-400">{line.lineNumber}</td>
                    <td className="px-6 py-4 text-xs font-medium text-gray-700">{line.originalProductDescription}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{line.requestedQuantity}</td>
                    <td className="px-6 py-4">
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={locked}
                        value={input.found}
                        onChange={(e) => updateInput(line.orderLineId, "found", e.target.value)}
                        className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-xs disabled:bg-gray-50 disabled:text-gray-400"
                        placeholder="0"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={locked}
                        value={input.unavailable}
                        onChange={(e) => updateInput(line.orderLineId, "unavailable", e.target.value)}
                        className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-xs disabled:bg-gray-50 disabled:text-gray-400"
                        placeholder="0"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <input
                        type="text"
                        disabled={locked}
                        value={input.notes}
                        onChange={(e) => updateInput(line.orderLineId, "notes", e.target.value)}
                        className="w-40 rounded-lg border border-gray-200 px-2 py-1.5 text-xs disabled:bg-gray-50 disabled:text-gray-400"
                        placeholder="Optional"
                      />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${badge.style}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      {!locked && (
                        <button
                          type="button"
                          onClick={() => void saveLine(line.orderLineId)}
                          disabled={savingLineId === line.orderLineId}
                          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                        >
                          {savingLineId === line.orderLineId ? <Loader2 size={12} className="animate-spin" /> : "Save"}
                        </button>
                      )}
                      {error && <p className="mt-1 max-w-[180px] text-[10px] text-[#9B3B3B]">{error}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {session.status === "IN_PROGRESS" && (
        <div className="rounded-xl border border-[#E8EBE6] bg-white p-6">
          {completeError && <p className="mb-3 text-[11px] text-[#9B3B3B]">{completeError}</p>}
          <button
            type="button"
            onClick={() => void completePicking()}
            disabled={completing}
            className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {completing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Complete picking
          </button>
          {!allLinesAccountedFor && (
            <p className="mt-2 text-[11px] text-gray-400">
              Every line needs found + unavailable to add up to its requested quantity before this will succeed.
            </p>
          )}
        </div>
      )}

      {session.status === "COMPLETED" && canAuthorize && (
        <div className="rounded-xl border border-[#E8EBE6] bg-white p-6">
          {authorizeError && <p className="mb-3 text-[11px] text-[#9B3B3B]">{authorizeError}</p>}
          <button
            type="button"
            onClick={() => void authorizePicking()}
            disabled={authorizing}
            className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {authorizing ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            Authorize
          </button>
        </div>
      )}
    </section>
  );
}
