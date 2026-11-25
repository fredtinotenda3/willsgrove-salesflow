"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft, BarChart3, Boxes, Building2, ChevronDown, ClipboardCheck, Database, FileText, KeyRound, LayoutDashboard, LogOut, Menu, MessageSquare, PanelLeftClose, PanelLeftOpen, Plug, Receipt, ReceiptText,
  ScrollText, Settings2, ShieldCheck, ShoppingCart, Tags, Truck, Undo2, Users, UserCog, Warehouse, X, FileWarning, ListChecks,
} from "lucide-react";
import { ADMIN_NAV, breadcrumbsFor, isActiveItem, type AdminIconKey } from "@/lib/admin/nav";
import { GlobalSearch } from "./global-search";

const ICONS: Record<AdminIconKey, typeof Users> = {
  dashboard: LayoutDashboard, orders: ShoppingCart, quotations: FileText, customers: Building2, assignments: ListChecks, approvals: ClipboardCheck,
  invoices: Receipt, claims: FileWarning, credit: ReceiptText, returns: Undo2, products: Boxes, pricing: Tags, stock: Warehouse,
  deliveries: Truck, fleet: UserCog, integrations: Plug, communications: MessageSquare, reports: BarChart3,
  users: Users, configuration: Settings2, audit: ScrollText, data: Database,
};

const COLLAPSE_KEY = "sf-admin-sidebar-collapsed";
const COLLAPSE_EVENT = "sf-admin-sidebar";
const subscribe = (cb: () => void) => { window.addEventListener(COLLAPSE_EVENT, cb); window.addEventListener("storage", cb); return () => { window.removeEventListener(COLLAPSE_EVENT, cb); window.removeEventListener("storage", cb); }; };
const readCollapsed = () => { try { return window.localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } };

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";

/**
 * Administration shell: grouped left navigation (collapsible on desktop,
 * drawer on mobile), breadcrumb header, global search and account menu.
 * Navigation never scrolls horizontally. This is presentation only: access
 * is enforced by the server on every page and API route.
 */
export function AdminFrame({ user, children }: { user: { name: string; email: string }; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const [drawer, setDrawer] = useState<string | null>(null); // pathname the drawer was opened on: auto-closes on navigation
  const drawerOpen = drawer === pathname;
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const crumbs = breadcrumbsFor(pathname);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const toggleCollapsed = () => {
    try { window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "0" : "1"); } catch { /* not persisted */ }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  };
  async function logout() {
    setSigningOut(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally { router.replace("/login"); router.refresh(); }
  }

  const sidebar = (mobile: boolean) => {
    const slim = collapsed && !mobile;
    return (
      <div className="flex h-full flex-col bg-[#10271F] text-white">
        <div className={`flex items-center gap-2 border-b border-white/10 px-4 py-4 ${slim ? "justify-center px-2" : ""}`}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#D7F36B] text-[#10271F]"><ShieldCheck size={17} aria-hidden /></span>
          {!slim ? <div className="min-w-0"><p className="truncate text-sm font-semibold leading-tight">Control Centre</p><p className="truncate text-[11px] text-white/50">Willsgrove SalesFlow</p></div> : null}
          {mobile ? <button type="button" onClick={() => setDrawer(null)} aria-label="Close navigation" className="ml-auto rounded p-1 text-white/70 hover:bg-white/10"><X size={18} /></button> : null}
        </div>
        <nav aria-label="Administration" className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-2 py-3">
          {ADMIN_NAV.map((group) => {
            const open = slim || !closedGroups.has(group.id);
            const single = group.items.length === 1 && group.id === "overview";
            return (
              <div key={group.id}>
                {!slim && !single ? (
                  <button type="button" onClick={() => setClosedGroups((s) => { const n = new Set(s); if (n.has(group.id)) n.delete(group.id); else n.add(group.id); return n; })} aria-expanded={open} className="flex w-full items-center justify-between rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/45 hover:text-white/70">
                    {group.label}<ChevronDown size={12} className={`transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden />
                  </button>
                ) : slim && !single ? <div className="mx-2 border-t border-white/10" aria-hidden /> : null}
                {open ? (
                  <ul className="mt-0.5 space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = ICONS[item.icon];
                      const active = isActiveItem(item, pathname);
                      return (
                        <li key={item.href}>
                          <Link href={item.href} title={slim ? item.label : undefined} aria-label={slim ? item.label : undefined} aria-current={active ? "page" : undefined} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition ${slim ? "justify-center" : ""} ${active ? "bg-white/[0.12] text-white shadow-[inset_2px_0_0_#D7F36B]" : "text-white/65 hover:bg-white/[0.07] hover:text-white"}`}>
                            <Icon size={16} className="shrink-0" aria-hidden />
                            {!slim ? <span className="truncate">{item.label}</span> : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-2">
          <Link href="/" title="Back to the application" className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-white/65 hover:bg-white/[0.07] hover:text-white ${slim ? "justify-center" : ""}`}><ArrowLeft size={16} aria-hidden />{!slim ? "Back to application" : <span className="sr-only">Back to application</span>}</Link>
          {!mobile ? <button type="button" onClick={toggleCollapsed} aria-pressed={collapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className={`mt-0.5 hidden w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-white/65 hover:bg-white/[0.07] hover:text-white md:flex ${slim ? "justify-center" : ""}`}>{collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}{!slim ? "Collapse" : null}</button> : null}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F4F6F3] text-[#14211B]">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow">Skip to content</a>
      <aside className={`fixed inset-y-0 left-0 z-40 hidden transition-[width] duration-150 md:block ${collapsed ? "w-[68px]" : "w-[248px]"}`}>{sidebar(false)}</aside>
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Administration navigation">
          <button type="button" aria-label="Close navigation" onClick={() => setDrawer(null)} className="absolute inset-0 bg-black/50" />
          <div className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] shadow-2xl">{sidebar(true)}</div>
        </div>
      ) : null}
      <div className={`transition-[padding] duration-150 ${collapsed ? "md:pl-[68px]" : "md:pl-[248px]"}`}>
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[#E3E8E2] bg-white/95 px-3 py-2.5 backdrop-blur sm:px-5">
          <button type="button" onClick={() => setDrawer(pathname)} aria-label="Open navigation" className="rounded-lg p-2 text-[#14211B] hover:bg-[#F1F4F0] md:hidden"><Menu size={20} /></button>
          <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-xs text-[#6B7B72] sm:flex">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                {i > 0 ? <span aria-hidden className="text-[#B3BDB4]">/</span> : null}
                {c.href ? <Link href={c.href} className="truncate hover:text-[#14211B] hover:underline">{c.label}</Link> : <span aria-current="page" className="truncate font-medium text-[#14211B]">{c.label}</span>}
              </span>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2"><GlobalSearch />
            <div className="relative">
              <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label={`Account menu for ${user.name}`} className="flex items-center gap-2 rounded-lg p-1 hover:bg-[#F1F4F0]">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#D7F36B] text-xs font-bold text-[#10271F]">{initials(user.name)}</span>
                <span className="hidden text-left lg:block"><span className="block max-w-[140px] truncate text-xs font-semibold leading-tight">{user.name}</span><span className="block text-[10px] text-[#7A887F]">Administrator</span></span>
              </button>
              {menuOpen ? (
                <div className="absolute right-0 z-40 mt-1 w-56 overflow-hidden rounded-xl border border-[#E3E8E2] bg-white shadow-lg" onKeyDown={(e) => { if (e.key === "Escape") setMenuOpen(false); }}>
                  <div className="border-b border-[#EEF1ED] px-3 py-2"><p className="truncate text-sm font-semibold">{user.name}</p><p className="truncate text-xs text-[#7A887F]">{user.email}</p></div>
                  <Link href="/change-password" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-[#F7F8F6]"><KeyRound size={14} aria-hidden />Change password</Link>
                  <button type="button" onClick={logout} disabled={signingOut} className="flex w-full items-center gap-2 border-t border-[#EEF1ED] px-3 py-2.5 text-sm hover:bg-[#F7F8F6] disabled:opacity-50"><LogOut size={14} aria-hidden />{signingOut ? "Signing out…" : "Log out"}</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main id="admin-main" className="mx-auto w-full max-w-[1480px] space-y-5 px-3 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
