"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Initial = { id?: string; sapItemCode?: string; itemName?: string; barcode?: string | null; category?: string | null; unitOfMeasure?: string | null; packSize?: string | null; vatCode?: string | null; isVariableWeight?: boolean };

/** Create (no id) or edit (id) a product. The SAP item code is editable only at creation. */
export function ProductFormDialog({ initial, label }: { initial?: Initial; label?: string }) {
  const router = useRouter();
  const editing = !!initial?.id;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ sapItemCode: initial?.sapItemCode ?? "", itemName: initial?.itemName ?? "", barcode: initial?.barcode ?? "", category: initial?.category ?? "", unitOfMeasure: initial?.unitOfMeasure ?? "", packSize: initial?.packSize ?? "", vatCode: initial?.vatCode ?? "", isVariableWeight: initial?.isVariableWeight ?? false, reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    setBusy(true); setError(null); setErrors({});
    const body = { ...f, ...(editing ? {} : { reason: undefined }) } as Record<string, unknown>;
    if (editing) delete body.sapItemCode;
    for (const k of ["barcode", "category", "unitOfMeasure", "packSize", "vatCode"]) if (body[k] === "") body[k] = null;
    if (!editing) delete body.reason;
    try {
      const res = await fetch(editing ? `/api/admin/products/${initial!.id}` : "/api/admin/products", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) { setError(data.message ?? "Not saved."); setErrors(data.fieldErrors ?? {}); return; }
      setOpen(false);
      if (!editing && data.id) router.push(`/admin/products/${data.id}`); else router.refresh();
    } catch { setError("Network error. Nothing was changed."); } finally { setBusy(false); }
  }

  const input = (k: keyof typeof f, label: string, opts: { disabled?: boolean; required?: boolean } = {}) => (
    <label className="block text-xs font-semibold text-[#4B5B52]">{label}
      <input value={String(f[k])} disabled={opts.disabled} onChange={(e) => set(k, e.target.value)} className="mt-1 w-full rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-normal disabled:bg-[#F1F4F0]" />
      {errors[k] ? <span className="text-xs font-normal text-red-700">{errors[k]}</span> : null}
    </label>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={editing ? "rounded-lg border border-[#DDE3DC] px-3 py-1.5 text-xs font-semibold" : "rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white"}>{label ?? (editing ? "Edit" : "Add product")}</button>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label={editing ? "Edit product" : "Add product"} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <div className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold">{editing ? "Edit product" : "Add product"}</h3>
            {input("sapItemCode", "SAP item code", { disabled: editing })}
            {input("itemName", "Item name")}
            <div className="grid grid-cols-2 gap-3">{input("barcode", "Barcode")}{input("category", "Category")}{input("unitOfMeasure", "Unit of measure")}{input("packSize", "Pack size")}{input("vatCode", "VAT code")}
              <label className="flex items-end gap-2 pb-2 text-xs font-semibold text-[#4B5B52]"><input type="checkbox" checked={f.isVariableWeight} onChange={(e) => set("isVariableWeight", e.target.checked)} />Variable weight</label></div>
            {editing ? input("reason", "Reason for change (audit log)") : null}
            {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm">Cancel</button><button type="button" disabled={busy} onClick={submit} className="rounded-lg bg-[#1F7A4D] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button></div>
          </div>
        </div>
      ) : null}
    </>
  );
}
