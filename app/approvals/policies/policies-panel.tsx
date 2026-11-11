"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Pencil, ShieldAlert } from "lucide-react";

/**
 * Milestone 8. CRUD for ApprovalPolicy rows, as one client-rendered
 * island (same split as every other *-actions-panel.tsx in this
 * project). `isMandatory` has no corresponding field in this UI's
 * create/update payload -- it is informational only here (set, if ever,
 * by data outside this milestone's API surface), never something this
 * form lets a user toggle.
 */

type PolicyRow = {
  id: string;
  module: string;
  actionType: string;
  name: string;
  description: string | null;
  thresholdPercent: string | null;
  thresholdAmount: string | null;
  currency: string | null;
  requiredApproverRole: string;
  allowRequesterSelfApprove: boolean;
  isMandatory: boolean;
  overdueAfterHours: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  active: boolean;
  enforced: boolean;
  createdAt: string;
};

type Props = {
  policies: PolicyRow[];
  moduleLabels: Record<string, string>;
  actionTypeLabels: Record<string, string>;
};

type FormState = {
  actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD" | "ORDER_VALUE_EXCEEDS_THRESHOLD";
  name: string;
  description: string;
  thresholdPercent: string;
  thresholdAmount: string;
  currency: string;
  requiredApproverRole: "SALES_MANAGER" | "ADMINISTRATOR";
  allowRequesterSelfApprove: boolean;
  overdueAfterHours: string;
  effectiveFrom: string;
  effectiveTo: string;
};

function emptyForm(): FormState {
  return {
    actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD",
    name: "",
    description: "",
    thresholdPercent: "",
    thresholdAmount: "",
    currency: "USD",
    requiredApproverRole: "SALES_MANAGER",
    allowRequesterSelfApprove: false,
    overdueAfterHours: "",
    effectiveFrom: "",
    effectiveTo: "",
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function PoliciesPanel({ policies, moduleLabels, actionTypeLabels }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startCreate() {
    setForm(emptyForm());
    setEditingId(null);
    setCreating(true);
    setError(null);
  }

  function startEdit(policy: PolicyRow) {
    setForm({
      actionType: policy.actionType as FormState["actionType"],
      name: policy.name,
      description: policy.description ?? "",
      thresholdPercent: policy.thresholdPercent ?? "",
      thresholdAmount: policy.thresholdAmount ?? "",
      currency: policy.currency ?? "USD",
      requiredApproverRole: policy.requiredApproverRole as FormState["requiredApproverRole"],
      allowRequesterSelfApprove: policy.allowRequesterSelfApprove,
      overdueAfterHours: policy.overdueAfterHours !== null ? String(policy.overdueAfterHours) : "",
      effectiveFrom: policy.effectiveFrom ?? "",
      effectiveTo: policy.effectiveTo ?? "",
    });
    setEditingId(policy.id);
    setCreating(false);
    setError(null);
  }

  function close() {
    setCreating(false);
    setEditingId(null);
    setError(null);
  }

  async function submitCreate() {
    if (!form.name.trim()) {
      setError("A policy name is required.");
      return;
    }
    if (form.actionType === "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD" && !form.thresholdPercent.trim()) {
      setError("A discount-percent threshold is required for this action type.");
      return;
    }
    if (form.actionType === "ORDER_VALUE_EXCEEDS_THRESHOLD" && (!form.thresholdAmount.trim() || !form.currency.trim())) {
      setError("A threshold amount and currency are required for this action type.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        actionType: form.actionType,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        requiredApproverRole: form.requiredApproverRole,
        allowRequesterSelfApprove: form.allowRequesterSelfApprove,
        overdueAfterHours: form.overdueAfterHours ? Number(form.overdueAfterHours) : undefined,
        effectiveFrom: form.effectiveFrom || undefined,
        effectiveTo: form.effectiveTo || undefined,
      };
      if (form.actionType === "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD") {
        body.thresholdPercent = form.thresholdPercent.trim();
      } else {
        body.thresholdAmount = form.thresholdAmount.trim();
        body.currency = form.currency.trim();
      }
      const response = await fetch("/api/approval-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to create this policy.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitEdit() {
    if (!editingId) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim() || undefined,
        description: form.description.trim() || undefined,
        requiredApproverRole: form.requiredApproverRole,
        allowRequesterSelfApprove: form.allowRequesterSelfApprove,
        overdueAfterHours: form.overdueAfterHours ? Number(form.overdueAfterHours) : null,
        effectiveFrom: form.effectiveFrom || null,
        effectiveTo: form.effectiveTo || null,
      };
      if (form.actionType === "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD") {
        body.thresholdPercent = form.thresholdPercent.trim();
      } else {
        body.thresholdAmount = form.thresholdAmount.trim();
        body.currency = form.currency.trim();
      }
      const response = await fetch(`/api/approval-policies/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to update this policy.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(policy: PolicyRow) {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/approval-policies/${policy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !policy.active }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to update this policy.");
        return;
      }
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  function renderForm(onSubmit: () => void, submitLabel: string, lockActionType: boolean) {
    return (
      <div className="mt-4 max-w-2xl space-y-2 rounded-lg border border-gray-100 p-4">
        <label className="block text-xs font-medium text-gray-600">
          Action type
          <select
            value={form.actionType}
            disabled={lockActionType}
            onChange={(event) => setForm((prev) => ({ ...prev, actionType: event.target.value as FormState["actionType"] }))}
            className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs disabled:bg-gray-50 disabled:text-gray-400"
          >
            <option value="QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD">{actionTypeLabels.QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD}</option>
            <option value="ORDER_VALUE_EXCEEDS_THRESHOLD">{actionTypeLabels.ORDER_VALUE_EXCEEDS_THRESHOLD}</option>
          </select>
        </label>
        {form.actionType === "ORDER_VALUE_EXCEEDS_THRESHOLD" && (
          <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
            <ShieldAlert size={13} />
            Not yet enforced -- no live gate is wired into order creation this milestone. This rule is configurable now
            so it is ready when that gate is added.
          </p>
        )}
        <label className="block text-xs font-medium text-gray-600">
          Name *
          <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
        </label>
        <label className="block text-xs font-medium text-gray-600">
          Description (optional)
          <textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
        </label>

        {form.actionType === "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD" ? (
          <label className="block text-xs font-medium text-gray-600">
            Discount threshold (%) *
            <input value={form.thresholdPercent} onChange={(event) => setForm((prev) => ({ ...prev, thresholdPercent: event.target.value }))} placeholder="e.g. 15" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-medium text-gray-600">
              Order value threshold *
              <input value={form.thresholdAmount} onChange={(event) => setForm((prev) => ({ ...prev, thresholdAmount: event.target.value }))} placeholder="e.g. 50000.0000" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
            </label>
            <label className="block text-xs font-medium text-gray-600">
              Currency *
              <input value={form.currency} onChange={(event) => setForm((prev) => ({ ...prev, currency: event.target.value.toUpperCase() }))} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
            </label>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-medium text-gray-600">
            Required approver role
            <select value={form.requiredApproverRole} onChange={(event) => setForm((prev) => ({ ...prev, requiredApproverRole: event.target.value as FormState["requiredApproverRole"] }))} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
              <option value="SALES_MANAGER">Sales Manager (or higher)</option>
              <option value="ADMINISTRATOR">Administrator only</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Overdue after (hours, optional)
            <input value={form.overdueAfterHours} onChange={(event) => setForm((prev) => ({ ...prev, overdueAfterHours: event.target.value }))} placeholder="e.g. 48" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-medium text-gray-600">
            Effective from (optional)
            <input type="date" value={form.effectiveFrom} onChange={(event) => setForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Effective to (optional)
            <input type="date" value={form.effectiveTo} onChange={(event) => setForm((prev) => ({ ...prev, effectiveTo: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
        </div>

        <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600">
          <input type="checkbox" checked={form.allowRequesterSelfApprove} onChange={(event) => setForm((prev) => ({ ...prev, allowRequesterSelfApprove: event.target.checked }))} />
          Allow a non-requester, non-preparer approver who is otherwise eligible (the requester and the quotation&rsquo;s preparer can never approve their own request regardless of this setting)
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Cancel</button>
          <button onClick={onSubmit} disabled={submitting} className="flex items-center gap-1 rounded-lg bg-[#173D2E] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
            {submitting && <Loader2 size={12} className="animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[#17251E]">Policies</h2>
        <button onClick={startCreate} className="flex items-center gap-1.5 rounded-lg bg-[#173D2E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#122E23]">
          <Plus size={13} />
          New policy
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {creating && renderForm(submitCreate, "Create policy", false)}

      <div className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
        {policies.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-semibold text-gray-600">No policies configured yet</p>
            <p className="mt-1 text-xs text-gray-400">Until a policy is created and active, no submission is gated -- normal quotations and orders proceed without requiring approval.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-y border-gray-100 bg-gray-50/70">
                  <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Policy</th>
                  <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Module</th>
                  <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Threshold</th>
                  <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Approver</th>
                  <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {policies.map((policy) => (
                  <Fragment key={policy.id}>
                    <tr className="border-b border-gray-50 align-top">
                      <td className="px-6 py-4">
                        <p className="text-xs font-semibold text-[#173D2E]">{policy.name}</p>
                        <p className="text-[10px] text-gray-400">{actionTypeLabels[policy.actionType] ?? policy.actionType}</p>
                        {policy.isMandatory && <span className="mt-1 inline-flex rounded-full bg-cyan-50 px-2 py-0.5 text-[9px] font-semibold text-cyan-700">Mandatory workflow</span>}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{moduleLabels[policy.module] ?? policy.module}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">
                        {policy.thresholdPercent ? `${policy.thresholdPercent}%` : policy.thresholdAmount ? `${policy.thresholdAmount} ${policy.currency ?? ""}` : "-"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{policy.requiredApproverRole}</td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${policy.active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                            {policy.active ? "Active" : "Inactive"}
                          </span>
                          {!policy.enforced && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-700">
                              <ShieldAlert size={9} />
                              Not yet enforced
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => toggleActive(policy)} disabled={submitting} className="text-[11px] font-semibold text-gray-500 hover:text-[#173D2E] disabled:opacity-50">
                            {policy.active ? "Deactivate" : "Activate"}
                          </button>
                          <button onClick={() => startEdit(policy)} className="text-gray-400 hover:text-[#173D2E]">
                            <Pencil size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editingId === policy.id && (
                      <tr>
                        <td colSpan={6} className="px-6 pb-4">
                          {renderForm(submitEdit, "Save changes", true)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
