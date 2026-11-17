"use client";

import { useEffect, useState } from "react";
import { Loader2, PlayCircle, CheckCircle2, ShieldCheck, Lock } from "lucide-react";
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

/**
 * Final Operational Enhancements (spec Part 2.2). Formats a non-negative
 * number back into this panel's decimal-string shape (up to 4 decimal
 * places, no trailing zeros) -- used only for the live Found/Unavailable
 * auto-calculation below, never for anything sent to the server as-is
 * without first re-matching DECIMAL_PATTERN, so a float-formatting edge
 * case here can only ever affect a displayed suggestion, never bypass the
 * server's own exact scaled-integer validation.
 */
function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const clamped = Math.max(0, value);
  return Number(clamped.toFixed(4)).toString();
}

/**
 * Final Operational Enhancements (spec Part 2.2): "Found/Unavailable
 * fields must live-auto-calculate each other both directions, clamped to
 * [0, Requested]." Only recalculates once the just-edited field is
 * itself a syntactically COMPLETE decimal value (DECIMAL_PATTERN) --
 * an in-progress keystroke like "10." deliberately leaves both fields
 * alone rather than fighting the user's typing. requestedQuantity
 * missing/non-numeric (should never happen -- every line always has one
 * -- but defensively checked) also leaves both fields alone, same
 * "never guess, never invent" convention as the rest of this codebase.
 * Returns the (possibly clamped-down) value for the field just edited
 * plus its auto-calculated complement -- both always sum to exactly
 * requestedQuantity. This is a CLIENT-SIDE convenience only -- the server
 * (lib/picking/record-picked-line.ts, lib/picking/complete-picking.ts)
 * re-validates found+unavailable<=requested with its own exact
 * scaled-integer arithmetic regardless of what this function computes,
 * so a rounding edge case here can never let an invalid pair reach the
 * database.
 */
function autoCalculate(editedValue: string, requestedQuantity: string): { edited: string; complement: string } | null {
  const trimmed = editedValue.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return null;
  const requested = Number(requestedQuantity);
  if (!Number.isFinite(requested) || requested < 0) return null;
  const clampedEntered = Math.min(Math.max(Number(trimmed), 0), requested);
  return { edited: formatQuantity(clampedEntered), complement: formatQuantity(requested - clampedEntered) };
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
  dispatchHasDepartedOrDelivered,
  lines,
}: {
  orderId: string;
  canAuthorize: boolean;
  /**
   * Final completion phase, section 6: true once this order has a
   * non-cancelled dispatch that's already departed or been delivered.
   * Disables + explains "Start a new picking session" below -- the real
   * enforcement is server-side (lib/picking/start-picking.ts), which
   * rejects the same condition even if this prop were somehow stale or
   * bypassed, so this is purely the explanation, never the only guard.
   */
  dispatchHasDepartedOrDelivered: boolean;
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
    // Defense in depth -- the button that calls this is already disabled
    // in this state (see the render below), and lib/picking/start-picking.ts
    // rejects it regardless either way, but this keeps the function itself
    // honest rather than relying solely on the disabled attribute.
    if (dispatchHasDepartedOrDelivered) {
      setStartError(
        "This order already has a dispatch that has departed or been delivered -- picking cannot be restarted."
      );
      return;
    }
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

  // `requestedQuantity` is only passed (and only has an effect) for the
  // "found"/"unavailable" fields -- see autoCalculate()'s own comment.
  // "notes" is untouched by auto-calculation, same as before this change.
  function updateInput(orderLineId: string, field: keyof LineInput, value: string, requestedQuantity?: string) {
    setInputs((prev) => {
      const current = prev[orderLineId] ?? emptyInput();
      if ((field === "found" || field === "unavailable") && requestedQuantity !== undefined) {
        const result = autoCalculate(value, requestedQuantity);
        if (result) {
          const complementField: keyof LineInput = field === "found" ? "unavailable" : "found";
          return { ...prev, [orderLineId]: { ...current, [field]: result.edited, [complementField]: result.complement } };
        }
      }
      return { ...prev, [orderLineId]: { ...current, [field]: value } };
    });
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
      // Final Operational Enhancements (spec Part 2.1): bundle every
      // currently-entered line value -- whether or not it was ever
      // individually saved -- so Complete Picking saves ALL entered
      // records together, atomically with completion itself. A line
      // whose input box isn't currently a complete, valid decimal pair
      // is simply left out (the server falls back to whatever that line
      // last had persisted, exactly as before this change); the
      // individual per-line Save button keeps working completely
      // unchanged alongside this.
      const lineEdits = session.lines
        .map((line) => {
          const input = inputs[line.orderLineId] ?? emptyInput();
          const found = input.found.trim();
          const unavailable = input.unavailable.trim();
          if (!DECIMAL_PATTERN.test(found) || !DECIMAL_PATTERN.test(unavailable)) return null;
          return {
            orderLineId: line.orderLineId,
            foundQuantity: found,
            unavailableQuantity: unavailable,
            notes: input.notes.trim() || undefined,
          };
        })
        .filter((edit): edit is { orderLineId: string; foundQuantity: string; unavailableQuantity: string; notes: string | undefined } => edit !== null);

      const response = await fetch(`/api/orders/${orderId}/picking/${session.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineEdits }),
      });
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
            {dispatchHasDepartedOrDelivered
              ? "This order already has a dispatch that has departed or been delivered, so picking can no longer be restarted -- the earlier, authorized session's history is kept exactly as recorded."
              : session
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
            disabled={starting || dispatchHasDepartedOrDelivered}
            title={dispatchHasDepartedOrDelivered ? "Locked -- this order has already been dispatched." : undefined}
            className="mt-4 flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : dispatchHasDepartedOrDelivered ? (
              <Lock size={14} />
            ) : (
              <PlayCircle size={14} />
            )}
            {dispatchHasDepartedOrDelivered ? "Picking locked -- already dispatched" : session ? "Start a new picking session" : "Start picking"}
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
            Enter what was actually found in the warehouse -- unavailable fills in automatically (and vice versa) so
            the two always add up to the requested quantity. Override either one at any time if needed.
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
                        onChange={(e) => updateInput(line.orderLineId, "found", e.target.value, line.requestedQuantity)}
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
                        onChange={(e) => updateInput(line.orderLineId, "unavailable", e.target.value, line.requestedQuantity)}
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
