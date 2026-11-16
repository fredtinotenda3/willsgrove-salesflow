"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Truck, PackageCheck, XCircle, Send, RotateCcw } from "lucide-react";

/**
 * Milestone 10 (Communication Channels & Fulfilment). The dispatch/
 * delivery "island" on app/fulfilment/[id]/page.tsx, alongside
 * PickingPanel -- same split, same "re-fetch after every mutation, never
 * optimistic" convention that panel already established. Only rendered
 * once an order has an AUTHORIZED picking session (i.e. is or has been
 * READY_TO_INVOICE) -- see dispatch.ts's own eligibility check, which
 * this panel mirrors in its own empty state rather than hide entirely,
 * so staff get an honest reason rather than a missing section.
 */

type FulfilmentLine = {
  orderLineId: string;
  lineNumber: number;
  originalProductDescription: string;
  requestedQuantity: string;
  sapItemCodeSnapshot: string | null;
  requestedUnitCode: string;
  authorizedFoundQuantity: string;
  dispatchedQuantity: string;
  outstandingQuantity: string;
};

type DispatchSummary = {
  id: string;
  status: string;
  vehicleOrCourierReference: string | null;
  plannedDepartureAt: string | null;
  departedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  lineCount: number;
  deliveryOutcome: string | null;
  driver: { id: string; name: string } | null;
  assistant: { id: string; name: string } | null;
  vehicle: { id: string; registrationNumber: string } | null;
};

/** Final Operational Enhancements (spec Part 4): the registered-personnel/vehicle directory this panel's Driver/Assistant/Vehicle dropdowns are sourced from -- never free-typed. */
type PersonnelOption = { id: string; name: string; role: string; status: string };
type VehicleOption = { id: string; registrationNumber: string; status: string };

type DispatchDetailLine = { id: string; orderLineId: string; lineNumber: number; originalProductDescription: string; dispatchedQuantity: string };
type DispatchDetail = {
  id: string;
  status: string;
  lines: DispatchDetailLine[];
};

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

const STATUS_BADGE: Record<string, { label: string; style: string }> = {
  PLANNED: { label: "Planned", style: "bg-gray-100 text-gray-600" },
  DEPARTED: { label: "Departed", style: "bg-cyan-50 text-cyan-700" },
  DELIVERED: { label: "Delivered", style: "bg-emerald-50 text-emerald-700" },
  CANCELLED: { label: "Cancelled", style: "bg-red-50 text-red-700" },
};

const OUTCOME_BADGE: Record<string, { label: string; style: string }> = {
  ACCEPTED_IN_FULL: { label: "Accepted in full", style: "bg-emerald-50 text-emerald-700" },
  PARTIALLY_REJECTED: { label: "Partially rejected", style: "bg-amber-50 text-amber-700" },
  FULLY_REJECTED: { label: "Fully rejected", style: "bg-red-50 text-red-700" },
};

export default function DispatchPanel({ orderId }: { orderId: string }) {
  const [lines, setLines] = useState<FulfilmentLine[] | null>(null);
  const [dispatches, setDispatches] = useState<DispatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Final Operational Enhancements (spec Part 3.3): registered drivers,
  // assistants and vehicles -- loaded from Settings (lib/personnel.ts /
  // lib/vehicles.ts via /api/personnel, /api/vehicles), never free-typed.
  const [drivers, setDrivers] = useState<PersonnelOption[]>([]);
  const [assistants, setAssistants] = useState<PersonnelOption[]>([]);
  const [vehicleOptions, setVehicleOptions] = useState<VehicleOption[]>([]);
  const [driverId, setDriverId] = useState("");
  const [assistantId, setAssistantId] = useState("");
  const [vehicleId, setVehicleId] = useState("");

  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [deliveryFormFor, setDeliveryFormFor] = useState<string | null>(null);
  const [deliveryDetail, setDeliveryDetail] = useState<DispatchDetail | null>(null);
  const [deliveryInputs, setDeliveryInputs] = useState<Record<string, { accepted: string; rejected: string; reason: string }>>({});
  const [recipientName, setRecipientName] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [submittingDelivery, setSubmittingDelivery] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/fulfilment`, { cache: "no-store" });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setLoadError((body.message as string) ?? "Unable to load dispatch/delivery information.");
        return;
      }
      const fulfilment = body.fulfilment as { lines: FulfilmentLine[] };
      setLines(fulfilment.lines);
      setDispatches((body.dispatches as DispatchSummary[]) ?? []);
    } catch {
      setLoadError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  async function loadPersonnelAndVehicles() {
    try {
      const [driversRes, assistantsRes, vehiclesRes] = await Promise.all([
        fetch(`/api/personnel?role=DRIVER&status=ACTIVE`, { cache: "no-store" }),
        fetch(`/api/personnel?role=DRIVER_ASSISTANT&status=ACTIVE`, { cache: "no-store" }),
        fetch(`/api/vehicles?status=ACTIVE`, { cache: "no-store" }),
      ]);
      const [driversBody, assistantsBody, vehiclesBody] = await Promise.all([
        readJson(driversRes),
        readJson(assistantsRes),
        readJson(vehiclesRes),
      ]);
      if (driversRes.ok && driversBody.success) setDrivers((driversBody.personnel as PersonnelOption[]) ?? []);
      if (assistantsRes.ok && assistantsBody.success) setAssistants((assistantsBody.personnel as PersonnelOption[]) ?? []);
      if (vehiclesRes.ok && vehiclesBody.success) setVehicleOptions((vehiclesBody.vehicles as VehicleOption[]) ?? []);
    } catch {
      // Non-fatal: the driver/assistant/vehicle selects simply stay empty,
      // and createDispatch() below cannot succeed without a selection --
      // the user sees that failure as a normal validation error, not a
      // silent one.
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => {
      void load();
      void loadPersonnelAndVehicles();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Final Operational Enhancements (spec Part 3): "auto-populate dispatch
  // lines from invoiced products/quantities... instead of requiring manual
  // re-entry," while keeping "reset-to-invoice and edit-before-confirm
  // capability." The invoiced/outstanding quantity for each line is the
  // default; `quantities` holds only the user's edits away from that
  // default, so "Reset to invoice" is simply clearing those edits.
  const defaultQuantities = useMemo(() => {
    const defaults: Record<string, string> = {};
    for (const line of lines ?? []) {
      defaults[line.orderLineId] = line.outstandingQuantity;
    }
    return defaults;
  }, [lines]);

  function effectiveQuantity(orderLineId: string): string {
    return quantities[orderLineId] ?? defaultQuantities[orderLineId] ?? "";
  }

  function resetToInvoice() {
    setQuantities({});
  }

  async function createDispatch() {
    if (!lines) return;
    const requestLines = lines
      .map((line) => ({ orderLineId: line.orderLineId, quantity: effectiveQuantity(line.orderLineId).trim() }))
      .filter((line) => line.quantity && Number(line.quantity) > 0);

    if (requestLines.length === 0) {
      setCreateError("Enter a quantity greater than zero for at least one line.");
      return;
    }
    if (!driverId || !assistantId || !vehicleId) {
      setCreateError("A driver, driver's assistant, and vehicle are all required to confirm a dispatch.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: requestLines, driverId, assistantId, vehicleId }),
      });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setCreateError((body.message as string) ?? "Unable to create this dispatch.");
        return;
      }
      setQuantities({});
      setDriverId("");
      setAssistantId("");
      setVehicleId("");
      await load();
    } catch {
      setCreateError("Could not reach the server.");
    } finally {
      setCreating(false);
    }
  }

  async function departDispatch(dispatchId: string) {
    setActioningId(dispatchId);
    setActionError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/dispatch/${dispatchId}/depart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setActionError((body.message as string) ?? "Unable to mark this dispatch as departed.");
        return;
      }
      await load();
    } catch {
      setActionError("Could not reach the server.");
    } finally {
      setActioningId(null);
    }
  }

  async function cancelDispatch(dispatchId: string) {
    const reason = window.prompt("Reason for cancelling this dispatch:");
    if (!reason || !reason.trim()) return;

    setActioningId(dispatchId);
    setActionError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/dispatch/${dispatchId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setActionError((body.message as string) ?? "Unable to cancel this dispatch.");
        return;
      }
      await load();
    } catch {
      setActionError("Could not reach the server.");
    } finally {
      setActioningId(null);
    }
  }

  async function openDeliveryForm(dispatchId: string) {
    setDeliveryError(null);
    setDeliveryFormFor(dispatchId);
    setDeliveryDetail(null);
    setRecipientName("");
    setDeliveryNotes("");
    setPhotoFile(null);
    setSignatureFile(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/dispatch/${dispatchId}`, { cache: "no-store" });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setDeliveryError((body.message as string) ?? "Unable to load this dispatch's lines.");
        return;
      }
      const detail = body.dispatch as DispatchDetail;
      setDeliveryDetail(detail);
      const nextInputs: Record<string, { accepted: string; rejected: string; reason: string }> = {};
      for (const line of detail.lines) {
        nextInputs[line.id] = { accepted: line.dispatchedQuantity, rejected: "0", reason: "" };
      }
      setDeliveryInputs(nextInputs);
    } catch {
      setDeliveryError("Could not reach the server.");
    }
  }

  async function submitDelivery() {
    if (!deliveryDetail) return;
    const payloadLines = deliveryDetail.lines.map((line) => {
      const input = deliveryInputs[line.id] ?? { accepted: line.dispatchedQuantity, rejected: "0", reason: "" };
      return {
        dispatchLineId: line.id,
        acceptedQuantity: input.accepted.trim() || "0",
        rejectedQuantity: input.rejected.trim() || "0",
        rejectionReason: input.reason.trim() || undefined,
      };
    });

    setSubmittingDelivery(true);
    setDeliveryError(null);
    try {
      const formData = new FormData();
      formData.set(
        "payload",
        JSON.stringify({
          lines: payloadLines,
          recipientName: recipientName.trim() || undefined,
          notes: deliveryNotes.trim() || undefined,
        })
      );
      if (photoFile) formData.set("proofPhoto", photoFile);
      if (signatureFile) formData.set("proofSignature", signatureFile);

      const response = await fetch(`/api/orders/${orderId}/dispatch/${deliveryDetail.id}/delivery`, {
        method: "POST",
        body: formData,
      });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setDeliveryError((body.message as string) ?? "Unable to record this delivery outcome.");
        return;
      }
      setDeliveryFormFor(null);
      setDeliveryDetail(null);
      await load();
    } catch {
      setDeliveryError("Could not reach the server.");
    } finally {
      setSubmittingDelivery(false);
    }
  }

  if (loading && !lines) {
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

  const dispatchableLines = (lines ?? []).filter((line) => Number(line.outstandingQuantity) > 0);

  return (
    <section className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-bold text-[#17251E]">Dispatch</h2>
              <p className="mt-1 text-xs text-gray-400">
                Lines are pre-filled with the invoiced/outstanding quantity (authorized &amp; found by picking,
                minus what has already been dispatched). Edit a line if the actual quantity to dispatch now
                differs, or reset it back to the invoiced amount.
              </p>
            </div>
            {dispatchableLines.length > 0 && (
              <button
                type="button"
                onClick={resetToInvoice}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                <RotateCcw size={12} /> Reset to invoice
              </button>
            )}
          </div>
        </div>

        {dispatchableLines.length === 0 ? (
          <p className="px-6 pb-6 text-xs text-gray-400">Nothing outstanding to dispatch for this order right now.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-y border-gray-100 bg-gray-50/70">
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">#</th>
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Code</th>
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Product</th>
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">UOM</th>
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Invoiced / outstanding</th>
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Dispatch now</th>
                  </tr>
                </thead>
                <tbody>
                  {dispatchableLines.map((line) => (
                    <tr key={line.orderLineId} className="border-b border-gray-50">
                      <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-400">{line.lineNumber}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-500">{line.sapItemCodeSnapshot ?? "—"}</td>
                      <td className="px-6 py-4 text-xs font-medium text-gray-700">{line.originalProductDescription}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-500">{line.requestedUnitCode}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{line.outstandingQuantity}</td>
                      <td className="px-6 py-4">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={effectiveQuantity(line.orderLineId)}
                          onChange={(e) => setQuantities((prev) => ({ ...prev, [line.orderLineId]: e.target.value }))}
                          placeholder="0"
                          className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-100 p-6">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Driver, assistant &amp; vehicle (required to confirm dispatch)
              </p>
              <div className="flex flex-wrap gap-2">
                <select
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700"
                >
                  <option value="">Select driver…</option>
                  {drivers.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <select
                  value={assistantId}
                  onChange={(e) => setAssistantId(e.target.value)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700"
                >
                  <option value="">Select driver&apos;s assistant…</option>
                  {assistants.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700"
                >
                  <option value="">Select vehicle…</option>
                  {vehicleOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.registrationNumber}
                    </option>
                  ))}
                </select>
              </div>
              {(drivers.length === 0 || assistants.length === 0 || vehicleOptions.length === 0) && (
                <p className="mt-2 text-[11px] text-gray-400">
                  No registered {drivers.length === 0 ? "drivers" : assistants.length === 0 ? "assistants" : "vehicles"} found --
                  add them under Settings &rsaquo; Personnel &amp; Vehicles first.
                </p>
              )}
            </div>
            <div className="p-6">
              {createError && <p className="mb-3 text-[11px] text-[#9B3B3B]">{createError}</p>}
              <button
                type="button"
                onClick={() => void createDispatch()}
                disabled={creating}
                className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
                Create dispatch
              </button>
            </div>
          </>
        )}
      </div>

      {dispatches.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
          <div className="p-6">
            <h2 className="text-[15px] font-bold text-[#17251E]">Dispatch history</h2>
          </div>
          {actionError && <p className="px-6 pb-3 text-[11px] text-[#9B3B3B]">{actionError}</p>}
          <div className="divide-y divide-gray-50">
            {dispatches.map((dispatch) => {
              const badge = STATUS_BADGE[dispatch.status] ?? { label: dispatch.status, style: "bg-gray-100 text-gray-500" };
              const outcomeBadge = dispatch.deliveryOutcome ? OUTCOME_BADGE[dispatch.deliveryOutcome] : null;
              return (
                <div key={dispatch.id} className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${badge.style}`}>{badge.label}</span>
                        {outcomeBadge && (
                          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${outcomeBadge.style}`}>{outcomeBadge.label}</span>
                        )}
                        <span className="text-xs text-gray-400">
                          {dispatch.lineCount} line{dispatch.lineCount === 1 ? "" : "s"}
                          {dispatch.vehicleOrCourierReference ? ` · ${dispatch.vehicleOrCourierReference}` : ""}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-400">
                        Created {formatDateTime(dispatch.createdAt)}
                        {dispatch.departedAt ? ` · Departed ${formatDateTime(dispatch.departedAt)}` : ""}
                        {dispatch.cancelledAt ? ` · Cancelled ${formatDateTime(dispatch.cancelledAt)}` : ""}
                      </p>
                      {(dispatch.driver || dispatch.assistant || dispatch.vehicle) && (
                        <p className="mt-1 text-[11px] text-gray-400">
                          {dispatch.driver ? `Driver: ${dispatch.driver.name}` : "Driver: —"}
                          {" · "}
                          {dispatch.assistant ? `Assistant: ${dispatch.assistant.name}` : "Assistant: —"}
                          {" · "}
                          {dispatch.vehicle ? `Vehicle: ${dispatch.vehicle.registrationNumber}` : "Vehicle: —"}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dispatch.status === "PLANNED" && (
                        <>
                          <button
                            type="button"
                            onClick={() => void departDispatch(dispatch.id)}
                            disabled={actioningId === dispatch.id}
                            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                          >
                            <Send size={12} /> Mark departed
                          </button>
                          <button
                            type="button"
                            onClick={() => void cancelDispatch(dispatch.id)}
                            disabled={actioningId === dispatch.id}
                            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-[#9B3B3B] transition hover:bg-red-50 disabled:opacity-50"
                          >
                            <XCircle size={12} /> Cancel
                          </button>
                        </>
                      )}
                      {dispatch.status === "DEPARTED" && (
                        <button
                          type="button"
                          onClick={() => void openDeliveryForm(dispatch.id)}
                          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-50"
                        >
                          <PackageCheck size={12} /> Record delivery
                        </button>
                      )}
                    </div>
                  </div>

                  {deliveryFormFor === dispatch.id && (
                    <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50/60 p-4">
                      {!deliveryDetail ? (
                        <Loader2 size={16} className="animate-spin text-gray-400" />
                      ) : (
                        <div className="space-y-3">
                          {deliveryDetail.lines.map((line) => {
                            const input = deliveryInputs[line.id] ?? { accepted: line.dispatchedQuantity, rejected: "0", reason: "" };
                            return (
                              <div key={line.id} className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="w-56 font-medium text-gray-700">
                                  #{line.lineNumber} {line.originalProductDescription} ({line.dispatchedQuantity})
                                </span>
                                <label className="text-[10px] text-gray-400">
                                  Accepted
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={input.accepted}
                                    onChange={(e) =>
                                      setDeliveryInputs((prev) => ({ ...prev, [line.id]: { ...input, accepted: e.target.value } }))
                                    }
                                    className="ml-1 w-20 rounded-lg border border-gray-200 px-2 py-1 text-xs"
                                  />
                                </label>
                                <label className="text-[10px] text-gray-400">
                                  Rejected
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={input.rejected}
                                    onChange={(e) =>
                                      setDeliveryInputs((prev) => ({ ...prev, [line.id]: { ...input, rejected: e.target.value } }))
                                    }
                                    className="ml-1 w-20 rounded-lg border border-gray-200 px-2 py-1 text-xs"
                                  />
                                </label>
                                <input
                                  type="text"
                                  value={input.reason}
                                  onChange={(e) => setDeliveryInputs((prev) => ({ ...prev, [line.id]: { ...input, reason: e.target.value } }))}
                                  placeholder="Rejection reason (if any)"
                                  className="w-48 rounded-lg border border-gray-200 px-2 py-1 text-xs"
                                />
                              </div>
                            );
                          })}

                          <div className="flex flex-wrap gap-2 pt-2">
                            <input
                              type="text"
                              value={recipientName}
                              onChange={(e) => setRecipientName(e.target.value)}
                              placeholder="Recipient name (optional)"
                              className="w-56 rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                            />
                            <input
                              type="text"
                              value={deliveryNotes}
                              onChange={(e) => setDeliveryNotes(e.target.value)}
                              placeholder="Notes (optional)"
                              className="w-56 rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                            />
                          </div>
                          <div className="flex flex-wrap gap-4 pt-1 text-[11px] text-gray-500">
                            <label className="flex items-center gap-2">
                              Proof photo:
                              <input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
                            </label>
                            <label className="flex items-center gap-2">
                              Signature:
                              <input type="file" accept="image/*" onChange={(e) => setSignatureFile(e.target.files?.[0] ?? null)} />
                            </label>
                          </div>

                          {deliveryError && <p className="text-[11px] text-[#9B3B3B]">{deliveryError}</p>}

                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => void submitDelivery()}
                              disabled={submittingDelivery}
                              className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                            >
                              {submittingDelivery ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
                              Submit delivery outcome
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeliveryFormFor(null)}
                              className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
