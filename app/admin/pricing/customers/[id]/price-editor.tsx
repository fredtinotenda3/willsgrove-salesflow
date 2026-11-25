"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export type EditorRow = {
  productId: string;
  sapItemCode: string;
  itemName: string;
  unitOfMeasure: string | null;
  unitPrice: string | null;
  currencyCode: string | null;
  source: "CUSTOMER_OVERRIDE" | "PRICE_LIST" | null;
  priceListCode: string | null;
  listPrice: string | null;
  currencyMismatch: boolean;
};

type Props = { customerId: string; rows: EditorRow[]; effectiveCurrency: string | null };

const PRICE = /^\d{1,14}(\.\d{1,4})?$/;

async function call(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; results?: { productId: string; status: string; message?: string }[]; outcomes?: { line: number; sapItemCode: string; status: string; message?: string }[]; summary?: Record<string, number> };
  return { ok: res.ok && data.success !== false, data };
}

export function PriceEditor({ customerId, rows, effectiveCurrency }: Props) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const base = `/api/admin/customers/${customerId}/prices`;

  const dirty = useMemo(
    () =>
      rows
        .filter((r) => drafts[r.productId] !== undefined && drafts[r.productId].trim() !== (r.source === "CUSTOMER_OVERRIDE" ? (r.unitPrice ?? "") : ""))
        .map((r) => ({ row: r, value: drafts[r.productId].trim() })),
    [rows, drafts]
  );

  async function saveAll() {
    const bad: Record<string, string> = {};
    for (const { row, value } of dirty) if (value !== "" && !PRICE.test(value)) bad[row.productId] = "Up to 4 decimals.";
    setErrors(bad);
    if (Object.keys(bad).length > 0) return toast.error("Fix the highlighted prices first.");
    // Clearing a field that has no override is a no-op, not a removal.
    const items = dirty.filter(({ row, value }) => value !== "" || row.source === "CUSTOMER_OVERRIDE").map(({ row, value }) => ({ productId: row.productId, unitPrice: value === "" ? null : value }));
    if (items.length === 0) return;
    setBusy(true);
    try {
      const { ok, data } = await call(`${base}/bulk`, "POST", { items, reason: "Admin edit" });
      if (!ok) {
        const failed: Record<string, string> = {};
        for (const r of data.results ?? []) if (r.status === "FAILED") failed[r.productId] = r.message ?? "Rejected.";
        setErrors(failed);
        return toast.error(data.message ?? "Nothing was saved.");
      }
      toast.success(`${items.length} price${items.length === 1 ? "" : "s"} saved.`);
      setDrafts({});
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeOverride(productId: string) {
    setBusy(true);
    try {
      const { ok, data } = await call(base, "DELETE", { productId, reason: "Removed override" });
      if (!ok) return toast.error(data.message ?? "Could not remove.");
      toast.success("Override removed; the price list applies again.");
      setDrafts((d) => {
        const next = { ...d };
        delete next[productId];
        return next;
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]">
            <tr><th className="px-4 py-2">Product</th><th className="px-4 py-2">Current price</th><th className="px-4 py-2">Source</th><th className="px-4 py-2">Price list</th><th className="px-4 py-2">Customer price ({effectiveCurrency ?? "set currency"})</th><th className="px-4 py-2" /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId} className="border-t border-[#EEF1ED] align-top">
                <td className="px-4 py-2"><span className="font-mono text-xs text-[#849087]">{r.sapItemCode}</span><div>{r.itemName}{r.unitOfMeasure ? <span className="ml-1 text-xs text-[#849087]">/ {r.unitOfMeasure}</span> : null}</div></td>
                <td className="px-4 py-2 tabular-nums">{r.unitPrice ? `${r.currencyCode} ${r.unitPrice}` : <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">No price</span>}</td>
                <td className="px-4 py-2 text-xs">
                  {r.source === "CUSTOMER_OVERRIDE" ? <span className="rounded bg-blue-50 px-2 py-0.5 font-semibold text-blue-800">Customer override</span> : r.source === "PRICE_LIST" ? <span className="rounded bg-gray-100 px-2 py-0.5 font-semibold text-gray-700">Inherited · {r.priceListCode}</span> : "—"}
                  {r.currencyMismatch ? <div className="mt-1 text-amber-700">Override ignored: wrong currency.</div> : null}
                </td>
                <td className="px-4 py-2 text-xs tabular-nums text-[#849087]">{r.listPrice ?? "—"}</td>
                <td className="px-4 py-2">
                  <input
                    inputMode="decimal"
                    aria-label={`Customer price for ${r.sapItemCode}`}
                    value={drafts[r.productId] ?? (r.source === "CUSTOMER_OVERRIDE" ? (r.unitPrice ?? "") : "")}
                    placeholder={r.source === "PRICE_LIST" ? `inherits ${r.unitPrice}` : "no override"}
                    onChange={(e) => setDrafts((d) => ({ ...d, [r.productId]: e.target.value }))}
                    className={`w-36 rounded-lg border px-2 py-1 text-sm tabular-nums ${errors[r.productId] ? "border-red-400" : "border-[#DDE3DC]"}`}
                  />
                  {errors[r.productId] ? <div className="mt-1 text-xs text-red-700">{errors[r.productId]}</div> : null}
                </td>
                <td className="px-4 py-2 text-right">{r.source === "CUSTOMER_OVERRIDE" ? <button disabled={busy} onClick={() => removeOverride(r.productId)} className="rounded-lg border border-[#DDE3DC] px-3 py-1 text-xs font-semibold hover:bg-red-50 disabled:opacity-50">Remove override</button> : null}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[#849087]">No products match.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-[#F7F8F6] px-4 py-2">
        <span className="text-xs text-[#849087]">{dirty.length} unsaved change{dirty.length === 1 ? "" : "s"}. Clear a field to remove that customer&apos;s own price. Saving is all-or-nothing.</span>
        <button disabled={busy || dirty.length === 0} onClick={saveAll} className="rounded-lg bg-[#173D2E] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Saving…" : `Save ${dirty.length || ""} change${dirty.length === 1 ? "" : "s"}`}</button>
      </div>
    </div>
  );
}

export function ImportPanel({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<{ ok: boolean; message?: string; outcomes: { line: number; sapItemCode: string; status: string; message?: string }[]; summary?: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/admin/customers/${customerId}/prices/import`;

  async function run(dryRun: boolean) {
    if (!csv) return;
    setBusy(true);
    try {
      const { ok, data } = await call(url, "POST", { csv, dryRun });
      setReport({ ok, message: data.message, outcomes: data.outcomes ?? [], summary: data.summary });
      if (ok && !dryRun) {
        toast.success("Prices imported.");
        setCsv(null);
        setFileName("");
        router.refresh();
      } else if (!ok) toast.error(data.message ?? "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={async (e) => { const f = e.target.files?.[0]; setReport(null); if (!f) return setCsv(null); if (f.size > 180000) { toast.error("File too large (max ~180 KB). Split it."); return; } setFileName(f.name); setCsv(await f.text()); }} />
        <button disabled={!csv || busy} onClick={() => run(true)} className="rounded-lg border border-[#DDE3DC] px-3 py-1.5 text-xs font-semibold disabled:opacity-40">Validate (no changes)</button>
        <button disabled={!csv || busy || !report?.ok || report?.outcomes.length === 0} onClick={() => run(false)} className="rounded-lg bg-[#173D2E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Import {fileName}</button>
        <a href={`/api/admin/customers/${customerId}/prices/export?template=1`} className="text-xs font-semibold text-[#1F7A4D]">Download template</a>
      </div>
      {report ? (
        <div className={`rounded-lg border p-3 ${report.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
          <p className="font-semibold">{report.ok ? `Valid. ${Object.entries(report.summary ?? {}).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ")}. Press Import to apply.` : report.message}</p>
          {report.outcomes.filter((o) => o.status === "FAILED").slice(0, 25).map((o) => <p key={`${o.line}-${o.sapItemCode}`} className="text-xs text-red-800">Line {o.line}{o.sapItemCode ? ` (${o.sapItemCode})` : ""}: {o.message}</p>)}
        </div>
      ) : null}
    </div>
  );
}
