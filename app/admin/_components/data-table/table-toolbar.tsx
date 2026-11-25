"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Columns3, Download, Search, X } from "lucide-react";

export type FilterDef = { name: string; label: string; options: { value: string; label: string }[] };
export type ToolbarColumn = { key: string; label: string; defaultHidden?: boolean };

const COL_EVENT = "sf-admin-columns";
const storageKey = (tableId: string) => `sf-admin-cols:${tableId}`;

function readHidden(tableId: string, defaults: string): string {
  try { return window.localStorage.getItem(storageKey(tableId)) ?? defaults; } catch { return defaults; }
}
function subscribeCols(cb: () => void) {
  window.addEventListener(COL_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(COL_EVENT, cb); window.removeEventListener("storage", cb); };
}

/** Column visibility, remembered per table in this browser. The server renders every column; hiding is CSS-only so nothing is lost on reload. */
function useHiddenColumns(tableId: string, defaults: string[]) {
  const defaultJson = JSON.stringify(defaults);
  const json = useSyncExternalStore(subscribeCols, () => readHidden(tableId, defaultJson), () => defaultJson);
  let hidden: string[] = defaults;
  try { const parsed = JSON.parse(json); if (Array.isArray(parsed)) hidden = parsed.filter((x): x is string => typeof x === "string"); } catch { /* keep defaults */ }
  const set = (next: string[]) => {
    try { window.localStorage.setItem(storageKey(tableId), JSON.stringify(next)); } catch { /* private mode: not persisted */ }
    window.dispatchEvent(new Event(COL_EVENT));
  };
  return { hidden, set };
}

export function TableToolbar({ tableId, searchName = "q", searchPlaceholder = "Search…", search = true, filters = [], columns = [], exportHref, children }: { tableId: string; searchName?: string; searchPlaceholder?: string; search?: boolean; filters?: FilterDef[]; columns?: ToolbarColumn[]; exportHref?: string; children?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const urlQ = sp.get(searchName) ?? "";
  const [text, setText] = useState(urlQ);
  const lastUrlQ = useRef(urlQ);
  const [colsOpen, setColsOpen] = useState(false);
  const { hidden, set } = useHiddenColumns(tableId, columns.filter((c) => c.defaultHidden).map((c) => c.key));

  function push(mutate: (p: URLSearchParams) => void) {
    const p = new URLSearchParams(sp.toString());
    mutate(p);
    p.delete("page");
    start(() => router.replace(p.size ? `${pathname}?${p}` : pathname, { scroll: false }));
  }

  // Keep the box in step when the URL changes from elsewhere (back button, "clear filters").
  useEffect(() => {
    if (urlQ !== lastUrlQ.current) { lastUrlQ.current = urlQ; setText(urlQ); }
  }, [urlQ]);

  // Debounced search so typing does not issue a request per keystroke.
  useEffect(() => {
    if (text === urlQ) return;
    const t = setTimeout(() => { lastUrlQ.current = text; push((p) => (text.trim() ? p.set(searchName, text.trim()) : p.delete(searchName))); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const activeFilters = filters.filter((f) => sp.get(f.name));
  const anyActive = !!urlQ || activeFilters.length > 0;
  const exportQuery = new URLSearchParams(sp.toString());
  exportQuery.delete("page"); exportQuery.delete("pageSize");
  const exportUrl = exportHref ? `${exportHref}${exportHref.includes("?") ? "&" : "?"}${exportQuery}` : null;

  return (
    <div className="space-y-2">
      <style>{hidden.map((k) => `[data-table="${tableId}"] [data-col="${k}"]{display:none}`).join("")}</style>
      <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
        {search ? <label className="relative min-w-[200px] flex-1 sm:max-w-sm">
          <span className="sr-only">Search</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7A887F]" aria-hidden />
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={searchPlaceholder} className="w-full rounded-lg border border-[#D5DCD4] bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#1F7A4D] focus:ring-2 focus:ring-[#1F7A4D]/20" />
        </label> : null}
        {filters.map((f) => (
          <label key={f.name} className="text-xs">
            <span className="sr-only">{f.label}</span>
            <select value={sp.get(f.name) ?? ""} onChange={(e) => push((p) => (e.target.value ? p.set(f.name, e.target.value) : p.delete(f.name)))} className={`rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-[#1F7A4D] ${sp.get(f.name) ? "border-[#1F7A4D] text-[#14211B]" : "border-[#D5DCD4] text-[#5F6F66]"}`}>
              <option value="">{f.label}</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ))}
        {children}
        {anyActive ? <button type="button" onClick={() => { setText(""); lastUrlQ.current = ""; push((p) => { p.delete(searchName); filters.forEach((f) => p.delete(f.name)); }); }} className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium text-[#4B6B55] hover:bg-[#F1F4F0]"><X size={13} aria-hidden />Clear filters</button> : null}
        <div className="ml-auto flex items-center gap-2">
          {columns.length ? (
            <div className="relative">
              <button type="button" onClick={() => setColsOpen((o) => !o)} aria-expanded={colsOpen} className="inline-flex items-center gap-1.5 rounded-lg border border-[#D5DCD4] bg-white px-3 py-2 text-xs font-semibold text-[#14211B] hover:bg-[#F1F4F0]"><Columns3 size={14} aria-hidden />Columns</button>
              {colsOpen ? (
                <div className="absolute right-0 z-30 mt-1 w-52 rounded-lg border border-[#E3E8E2] bg-white p-2 shadow-lg" onKeyDown={(e) => { if (e.key === "Escape") setColsOpen(false); }}>
                  {columns.map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[#F7F8F6]">
                      <input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => set(hidden.includes(c.key) ? hidden.filter((k) => k !== c.key) : [...hidden, c.key])} className="accent-[#1F7A4D]" />{c.label}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {exportUrl ? <a href={exportUrl} className="inline-flex items-center gap-1.5 rounded-lg border border-[#D5DCD4] bg-white px-3 py-2 text-xs font-semibold text-[#14211B] hover:bg-[#F1F4F0]"><Download size={14} aria-hidden />Export CSV</a> : null}
        </div>
      </div>
    </div>
  );
}
