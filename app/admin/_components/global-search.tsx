"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { ALL_ADMIN_ITEMS } from "@/lib/admin/nav";

type Hit = { type: string; label: string; sub: string; href: string };

/** Header search: jumps to admin sections instantly and looks records up on the server (debounced). */
export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const box = useRef<HTMLDivElement>(null);
  const term = q.trim();

  useEffect(() => {
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setState("loading");
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal, cache: "no-store" });
        const data = (await res.json()) as { success?: boolean; hits?: Hit[] };
        if (!res.ok || !data.success) throw new Error("search failed");
        setHits(data.hits ?? []);
        setState("idle");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setState("error");
      }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [term]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pages = term.length >= 2 ? ALL_ADMIN_ITEMS.filter((i) => i.label.toLowerCase().includes(term.toLowerCase())).slice(0, 4) : [];
  const shownHits = term.length >= 2 ? hits : [];
  const close = () => { setOpen(false); setQ(""); };

  return (
    <div ref={box} className="relative" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
      <label className="relative block">
        <span className="sr-only">Search orders, customers, products, invoices, claims and users</span>
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7A887F]" aria-hidden />
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search records…" className="w-36 rounded-lg border border-[#D5DCD4] bg-[#F7F9F6] py-1.5 pl-9 pr-3 text-sm outline-none focus:w-64 focus:border-[#1F7A4D] focus:bg-white focus:ring-2 focus:ring-[#1F7A4D]/20 sm:w-52 sm:focus:w-72" style={{ transition: "width .15s" }} />
      </label>
      {open && term.length >= 2 ? (
        <div className="absolute right-0 z-50 mt-1 max-h-[70vh] w-[min(92vw,26rem)] overflow-y-auto rounded-xl border border-[#E3E8E2] bg-white p-1 shadow-xl" role="listbox" aria-label="Search results">
          {pages.map((p) => <Link key={p.href} href={p.href} onClick={close} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-[#F1F4F0]"><span className="font-medium">{p.label}</span><span className="text-[10px] uppercase tracking-wide text-[#7A887F]">Section</span></Link>)}
          {shownHits.map((h) => <Link key={`${h.type}-${h.href}`} href={h.href} onClick={close} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-[#F1F4F0]"><span className="min-w-0"><span className="block truncate font-medium">{h.label}</span><span className="block truncate text-xs text-[#7A887F]">{h.sub}</span></span><span className="shrink-0 rounded bg-[#EEF3EC] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#4B6B55]">{h.type}</span></Link>)}
          {state === "loading" ? <p className="px-3 py-2 text-xs text-[#7A887F]">Searching…</p> : null}
          {state === "error" ? <p className="px-3 py-2 text-xs text-red-700">Search is unavailable right now.</p> : null}
          {state === "idle" && pages.length === 0 && shownHits.length === 0 ? <p className="px-3 py-3 text-sm text-[#7A887F]">No matches for “{term}”.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
