"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  Warehouse,
  ClipboardList,
  Truck,
  BarChart3,
  ChevronDown,
  Leaf,
  Plus,
  KeyRound,
  LogOut,
  Percent,
  Boxes,
  Tags,
  Building2,
  Activity,
  Inbox,
  TrendingDown,
  Receipt,
  FileWarning,
  Undo2,
  FileText,
  ShieldCheck,
  Plug,
  MessageSquare,
  Send,
  PackageCheck,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  DollarSign,
  BadgeDollarSign,
} from "lucide-react";
import NotificationBell from "./notification-bell";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SIDEBAR_PREFERENCE_EVENT, readSidebarCollapsed, writeSidebarCollapsed } from "@/lib/ui/sidebar-preference";

// Collapse preference lives in localStorage (per browser) and is read through
// useSyncExternalStore, so server render and first client render agree
// (expanded) and the stored value applies right after hydration without a
// setState-in-effect. The layout itself is driven by an attribute on <html>
// (see the sidebar block in app/globals.css) so the ~50 pages that hard-code
// their own `md:pl-[260px]` content offset follow the sidebar without edits.
function subscribeSidebarPreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SIDEBAR_PREFERENCE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SIDEBAR_PREFERENCE_EVENT, onChange);
  };
}
const getSidebarCollapsedSnapshot = () => readSidebarCollapsed(window.localStorage);
const getSidebarCollapsedServerSnapshot = () => false;

/**
 * Workflow/Navigation/Performance round, Part 4: professional sidebar
 * and site-wide navigation.
 *
 * Section layout follows the spec's own suggested grouping (Overview /
 * Sales Operations / Fulfilment / After-Sales / Reports & Intelligence /
 * Administration), adapted to what this codebase actually has -- per the
 * spec's own instruction to "only include entries that actually exist":
 *
 * - "Ready for Invoice" is a STATUS filter on the Orders list
 *   (lib/order-queries.ts's `status` param), not a separate route, so it
 *   has no entry of its own -- it's reached via Orders' own tabs.
 * - "Users and Permissions," "Personnel," and "Vehicles" (the spec's
 *   suggested Administration items) live in the Administration Centre
 *   (/admin/users, /admin/fleet), reached through the single
 *   Administration entry below. The former /settings page was removed:
 *   everything functional on it exists in /admin, and its remaining tabs
 *   had no behaviour behind them.
 * - "Reports & Intelligence" is deliberately kept as ONE entry (Reports)
 *   rather than six (Management/Operational/Sales Performance/Customer
 *   Intelligence/Product Intelligence/Decision Intelligence): /reports
 *   is already a hub page that links to every one of those, with its own
 *   role-based gating per card (app/reports/page.tsx's
 *   `canSeeManagementReports`). Splitting it into six sidebar entries
 *   would duplicate that gating in a second place and add visual
 *   complexity the spec explicitly asks to avoid.
 * - /deliveries/history ("Delivered History," the older per-dispatch
 *   physical-delivery view) and /approvals/policies keep their existing
 *   no-direct-sidebar-entry status -- both are already reachable via an
 *   in-page link from their parent page (confirmed by a full-codebase
 *   reachability check), so adding a second, direct path would be
 *   redundant, not a fix.
 * - Every entry below maps to a route confirmed to exist under app/ by
 *   enumerating every page.tsx in the repository; nothing here is
 *   aspirational.
 *
 * Real Business Data Onboarding round, Phase 8 (Navigation corrections,
 * task #213, spec sections 17-19): the task's own wording -- "Delivered
 * Orders only under Operations (remove from Sales Management), Invoice
 * Claims Management under Operations" -- names a section called
 * "Operations" that does not exist verbatim in this file; the spec text
 * itself was not available to re-read in this session (it was pasted
 * inline in an earlier turn that has since fallen out of context, not
 * saved as a file this repository or its uploads retain). Rather than
 * invent a literal quote, this was resolved by direct investigation of
 * the CURRENT repository state: a full-codebase search found no
 * "Delivered Orders" entry anywhere under this file's SALES OPERATIONS
 * section (or any other sales-facing surface) today -- that half of the
 * requirement already held before this phase touched anything. What
 * this phase DID change: "FULFILMENT" below is renamed to "OPERATIONS"
 * (its plain real-world synonym -- picking/dispatch/delivery/delivered-
 * orders IS the operations side of the business), and "Invoice Claims"
 * is moved into it from AFTER-SALES, since the task pairs it with
 * Delivered Orders under one common "Operations" target. Nothing else
 * in AFTER-SALES (Invoice Reconciliation, Returns & Credits, Lost Sales,
 * Communications) was moved -- the task names Invoice Claims
 * specifically, and moving items it didn't name would be exactly the
 * kind of unrequested, undocumented reorganization this project's own
 * standing instructions warn against.
 *
 * `roles` (optional, on individual items only): the small number of
 * entries whose PAGE ITSELF denies a role server-side today --
 * /integrations/sap (redirects SALESPERSON to "/") and
 * /customers/master-import (its own POST API is
 * SALES_MANAGER/ADMINISTRATOR-only, matching the page's existing
 * client-side gate). Hiding these from a role that cannot use them
 * either way closes the spec's "avoid exposing restricted pages to
 * unauthorized users" gap -- previously every item was shown to every
 * authenticated role regardless of what the destination page actually
 * allowed. This is link-visibility only: every real access decision
 * continues to be enforced server-side exactly as before, so a hidden
 * link is a UX improvement, never the security boundary itself.
 */
const navigation = [
  {
    title: "OVERVIEW",
    items: [
      {
        name: "Dashboard",
        href: "/",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    title: "SALES OPERATIONS",
    items: [
      {
        name: "Orders",
        href: "/orders",
        icon: ShoppingCart,
      },
      {
        name: "New Order",
        href: "/orders/new",
        icon: Plus,
      },
      {
        name: "PO Intake",
        href: "/orders/intake",
        icon: Inbox,
      },
      // Milestone 10 (Communication Channels & Fulfilment). The raw
      // email/WhatsApp/manual message queue, reviewed by a human BEFORE
      // anything here reaches PO Intake above -- a deliberately separate
      // entry, not a tab on PO Intake, since a message doesn't become a
      // PO (or a follow-up to an existing order/quotation) until a
      // reviewer says so.
      {
        name: "Message Inbox",
        href: "/communications/inbox",
        icon: MessageSquare,
      },
      // Milestone 7 (Quotations Management). A quotation is the
      // pre-order sales step (spec section 2: "used by sales staff when
      // a customer requests pricing information before placing an
      // order") -- sales-side, same as Orders/PO Intake above.
      {
        name: "Quotations",
        href: "/quotations",
        icon: FileText,
      },
      // Milestone 8 (Validation and Approvals). Cross-module in principle
      // (serves every module with an approval workflow), but today that
      // is only Quotations' pricing/discount exceptions -- kept next to
      // Quotations rather than invented a new top-level section for a
      // single consumer.
      {
        name: "Approvals",
        href: "/approvals",
        icon: ShieldCheck,
      },
      {
        name: "Customers",
        href: "/customers",
        icon: Users,
      },
      {
        name: "Products",
        href: "/products",
        icon: Package,
      },
      {
        name: "Stock in Hand",
        href: "/stock",
        icon: Warehouse,
      },
    ],
  },
  {
    // Real Business Data Onboarding round, Phase 8: renamed from
    // "FULFILMENT" -- see this file's module comment.
    title: "OPERATIONS",
    items: [
      {
        name: "Picking & Fulfilment",
        href: "/fulfilment",
        icon: ClipboardList,
      },
      {
        name: "Dispatch & Delivery",
        href: "/deliveries",
        icon: Truck,
      },
      // Real-world fix ("the page delivered-orders is not showing
      // delivered orders... nothing is coming from sap, so records are of
      // this system"): this nav item used to point at /delivered-orders,
      // which lib/delivered-orders/queries.ts builds entirely from
      // InvoiceDeliveryRecord -> SapInvoice -- rows that only exist after
      // a manual "Import SAP invoices" CSV run, which this business
      // doesn't do. That page is, by design, always empty here; it was
      // never the bug, it was just the wrong link. The native equivalent
      // -- an order whose own DispatchRecord(s) actually reached DELIVERED,
      // zero SAP/invoice data involved -- already exists at
      // /deliveries/history (see lib/fulfilment/queries.ts's own
      // listDeliveredOrders, "Final completion phase, section 7"), and is
      // already linked from the Dispatch Queue page as "Delivered
      // History." Pointing the main nav item there instead is the fix:
      // same label, same icon, now backed by real data. /delivered-orders
      // itself is left in place (not deleted) pending a decision on the
      // wider SAP-invoice-reconciliation question.
      {
        name: "Delivered Orders",
        href: "/deliveries/history",
        icon: PackageCheck,
      },
      // Real Business Data Onboarding round, Phase 8: moved here from
      // AFTER-SALES, grouped with Delivered Orders under Operations --
      // see this file's module comment.
      {
        name: "Invoice Claims",
        href: "/invoice-claims",
        icon: FileWarning,
      },
    ],
  },
  {
    title: "AFTER-SALES",
    items: [
      {
        name: "Invoice Reconciliation",
        href: "/invoice-reconciliation",
        icon: Receipt,
      },
      {
        name: "Returns & Credits",
        href: "/returns-credits",
        icon: Undo2,
      },
      {
        name: "Lost Sales",
        href: "/lost-sales",
        icon: TrendingDown,
      },
      {
        name: "Communications",
        href: "/communications",
        icon: Send,
      },
    ],
  },
  {
    title: "REPORTS & INTELLIGENCE",
    items: [
      {
        name: "Reports",
        href: "/reports",
        icon: BarChart3,
      },
      {
        name: "Catalogue Health",
        href: "/catalogue/health",
        icon: Activity,
      },
    ],
  },
  {
    title: "ADMINISTRATION",
    items: [
      {
        name: "Tax Codes Import",
        href: "/tax-codes/import",
        icon: Percent,
      },
      {
        name: "Item Master Import",
        href: "/item-master/import",
        icon: Boxes,
      },
      // Follow-up fix ("Price should also have its own page too... like
      // customer and products pages") -- the landing page (stats, table,
      // Add + Import buttons); "Price Lists Import" below stays as its
      // own direct link too, same precedent "Customer Master Import"
      // already sets alongside the Customers landing page.
      {
        name: "Price Lists",
        href: "/price-lists",
        icon: BadgeDollarSign,
      },
      {
        name: "Price Lists Import",
        href: "/price-lists/import",
        icon: Tags,
      },
      // Real Business Data Onboarding round (spec PART A, Phase 4b):
      // customers have no price list assigned until staff assign one by
      // hand here (the real customer-master export has no price-list
      // column -- see app/price-lists/customers/page.tsx's own comment).
      {
        name: "Customer Pricing",
        href: "/price-lists/customers",
        icon: DollarSign,
      },
      // The underlying import API is SALES_MANAGER/ADMINISTRATOR-only
      // (app/api/customers/master-import/route.ts), matching this page's
      // own existing client-side role gate -- hidden from SALESPERSON
      // here too, see this file's module comment.
      {
        name: "Customer Master Import",
        href: "/customers/master-import",
        icon: Building2,
        roles: ["SALES_MANAGER", "ADMINISTRATOR"],
      },
      // The page itself redirects SALESPERSON to "/"
      // (app/integrations/sap/page.tsx) -- hidden here too, see this
      // file's module comment.
      {
        name: "SAP Integration",
        href: "/integrations/sap",
        icon: Plug,
        roles: ["SALES_MANAGER", "ADMINISTRATOR"],
      },
      // Administration Centre. ADMINISTRATOR only; every /admin page and
      // /api/admin route re-checks the role on the server.
      {
        name: "Administration",
        href: "/admin",
        icon: ShieldCheck,
        roles: ["ADMINISTRATOR"],
      },
    ],
  },
];

const ROLE_LABELS: Record<string, string> = {
  SALESPERSON: "Salesperson",
  SALES_MANAGER: "Sales Manager",
  ADMINISTRATOR: "Administrator",
};

type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

/**
 * A route is "active" when it's an exact match, or the current path is a
 * sub-path of it -- except for "/" (Dashboard), which only matches exactly
 * (otherwise it would light up for every single route, which was the
 * original bug: Dashboard was hardcoded as always-highlighted).
 */
function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initialsFor(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const [user, setUser] = useState<SessionUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Part 4: mobile behavior. `mobileNavOpen` is the off-canvas drawer's
  // open/closed state (<md viewports only -- at md and above the aside
  // is always visible via the "md:translate-x-0" class below, regardless
  // of this state). `isDesktop` mirrors the same "md" breakpoint in JS
  // (not just CSS) so the drawer can be made properly inert -- not just
  // visually hidden -- for keyboard/screen-reader users on narrow
  // viewports when it's closed; without this, a closed drawer would
  // still be in the tab order, a real accessibility gap, not merely a
  // cosmetic one.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const updateIsDesktop = () => setIsDesktop(mediaQuery.matches);
    updateIsDesktop();
    mediaQuery.addEventListener("change", updateIsDesktop);
    return () => mediaQuery.removeEventListener("change", updateIsDesktop);
  }, []);

  // Close the mobile drawer on every navigation -- without this, following
  // a link would leave the drawer open (and, on narrow viewports, covering
  // the whole page) on the destination route. Adjusted during render
  // (React's documented pattern for resetting state when a value changes)
  // rather than in an effect, which would call setState synchronously on
  // mount/update and trigger an extra render pass for no benefit here.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileNavOpen(false);
  }

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.user) {
          setUser(data.user);
        }
      })
      .catch(() => {
        // Sidebar renders fine without a resolved user (e.g. briefly during
        // a redirect); the real enforcement is server-side per route, not
        // this display.
      });

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const drawerVisible = isDesktop || mobileNavOpen;

  const collapsed = useSyncExternalStore(subscribeSidebarPreference, getSidebarCollapsedSnapshot, getSidebarCollapsedServerSnapshot);
  // Collapsed only ever applies at md and above (the mobile drawer always shows labels).
  const showCollapsed = collapsed && isDesktop;

  useEffect(() => {
    document.documentElement.dataset.sidebar = collapsed ? "collapsed" : "expanded";
  }, [collapsed]);

  function toggleCollapsed() {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    writeSidebarCollapsed(storage, !collapsed);
    window.dispatchEvent(new Event(SIDEBAR_PREFERENCE_EVENT));
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <>

      {/* Part 4: mobile nav toggle. A floating, always-reachable button
          rather than a second fixed header bar -- a header bar would need
          every page's own top padding adjusted too (the same inconsistency
          already fixed for the sidebar's left offset above), while a
          floating button needs no changes outside this component. Hidden
          at md and above, where the sidebar itself is always visible. */}
      <button
        type="button"
        onClick={() => setMobileNavOpen((open) => !open)}
        aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={mobileNavOpen}
        aria-controls="app-sidebar"
        className="fixed left-4 top-4 z-50 flex h-11 w-11 items-center justify-center rounded-xl bg-[#10271F] text-white shadow-lg ring-1 ring-white/10 transition hover:bg-[#15362A] md:hidden"
      >
        {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Backdrop, mobile only, closes the drawer on outside click. */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="app-sidebar"
        aria-hidden={!drawerVisible}
        inert={!drawerVisible}
        className={`fixed left-0 top-0 z-40 flex h-screen w-65 flex-col border-r border-white/10 bg-[#10271F] text-white transition-transform duration-200 md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >

      {/* Brand */}
      <div className="sf-collapse-center flex h-19 items-center gap-3 border-b border-white/10 px-6">

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#D7F36B] text-[#10271F]">
          <Leaf size={23} strokeWidth={2.5} />
        </div>

        <div className="sf-label">
          <h1 className="text-[16px] font-bold tracking-tight">
            Willsgrove
          </h1>

          <p className="text-[11px] font-medium tracking-[0.13em] text-white/50">
            SALESFLOW
          </p>
        </div>

      </div>

      {/* Workspace selector */}
      <div className="sf-label px-4 pt-5">

        <button className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/6 px-3 py-3 text-left transition hover:bg-white/10">

          <div className="flex items-center gap-3">

            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#D7F36B]/15 text-[#D7F36B]">
              <Warehouse size={17} />
            </div>

            <div>
              <p className="text-xs font-semibold">
                Sales Department
              </p>

              <p className="mt-0.5 text-[10px] text-white/45">
                Harare Branch
              </p>
            </div>

          </div>

          <ChevronDown size={16} className="text-white/50" />

        </button>

      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-7 overflow-y-auto px-4 py-7">

        {navigation.map((section) => {
          // An item with a `roles` allowlist (see this file's module
          // comment) is hidden from anyone not in it -- and, while the
          // session is still loading (user === null), hidden by default
          // rather than shown-then-possibly-retracted, consistent with
          // least-privilege: a restricted link should never flash into
          // view before the role that would hide it is actually known.
          const visibleItems = section.items.filter(
            (item) => !("roles" in item) || (user !== null && (item.roles as readonly string[]).includes(user.role)),
          );
          if (visibleItems.length === 0) return null;

          return (
          <div key={section.title}>

            <p className="sf-label mb-3 px-3 text-[10px] font-bold tracking-[0.14em] text-white/35">
              {section.title}
            </p>

            <div className="space-y-1">

              {visibleItems.map((item) => {
                const Icon = item.icon;
                const active = isActivePath(pathname, item.href);
                const linkClassName = `sf-collapse-center group flex items-center justify-between rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all ${
                  active
                    ? "bg-[#D7F36B] text-[#10271F] shadow-sm"
                    : "text-white/65 hover:bg-white/[0.07] hover:text-white"
                }`;
                const linkContent = (
                  <span className="flex items-center gap-3">
                    <Icon size={17} strokeWidth={1.9} className="shrink-0" />
                    <span className="sf-label">{item.name}</span>
                  </span>
                );
                // A collapsed link has no visible text, so it keeps its
                // accessible name via aria-label and gets a tooltip on
                // hover AND keyboard focus (Radix tooltips open on focus).
                const withTooltip = (node: React.ReactElement) =>
                  showCollapsed ? (
                    <Tooltip key={item.name}>
                      <TooltipTrigger asChild>{node}</TooltipTrigger>
                      <TooltipContent side="right">{item.name}</TooltipContent>
                    </Tooltip>
                  ) : (
                    node
                  );

                // Real-world bug fix: "New Order and Repeat Order are
                // navigating to created order id instead" of opening a
                // blank form. Root cause: Next's client Router Cache
                // (this app runs with cacheComponents: true, see
                // next.config.ts) can reuse the PREVIOUSLY rendered
                // /orders/new component instance -- including its
                // createdOrder "success screen" state -- on a soft
                // client-side <Link> navigation back to it, so a staff
                // member who had just submitted an order saw THAT old
                // order's "Order Received" confirmation again instead of
                // a blank form, every time they came back to start
                // another one. A plain <a> forces a full browser
                // navigation, which always discards all client state --
                // the one guaranteed-correct fix regardless of exactly
                // which Next.js caching layer was reusing the instance.
                // Full writeup + the three other entry points this same
                // fix had to be applied to: app/orders/new/page.tsx's own
                // comment above its `createdOrder` state.
                if (item.href === "/orders/new") {
                  return withTooltip(
                    <a key={item.name} href={item.href} className={linkClassName} aria-label={item.name} aria-current={active ? "page" : undefined}>
                      {linkContent}
                    </a>,
                  );
                }

                return withTooltip(
                  <Link key={item.name} href={item.href} className={linkClassName} aria-label={item.name} aria-current={active ? "page" : undefined}>
                    {linkContent}
                  </Link>,
                );
              })}

            </div>

          </div>
          );
        })}

      </nav>

      {/* Bottom settings */}
      <div className="relative border-t border-white/10 p-4">

        <button
          type="button"
          onClick={toggleCollapsed}
          aria-pressed={collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="sf-collapse-center mb-2 hidden w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-white/60 transition hover:bg-white/[0.07] hover:text-white md:flex"
        >
          {collapsed ? <PanelLeftOpen size={17} className="shrink-0" /> : <PanelLeftClose size={17} className="shrink-0" />}
          <span className="sf-label">Collapse</span>
        </button>

        <div className="flex items-center gap-1">
          <NotificationBell />
        </div>

        {menuOpen && (
          <div className="absolute bottom-[72px] left-4 right-4 z-10 overflow-hidden rounded-xl border border-white/10 bg-[#152E24] shadow-lg">
            <Link
              href="/change-password"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 px-4 py-3 text-xs font-medium text-white/75 transition hover:bg-white/[0.07] hover:text-white"
            >
              <KeyRound size={14} />
              Change password
            </Link>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex w-full items-center gap-2 border-t border-white/10 px-4 py-3 text-xs font-medium text-white/75 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-50"
            >
              <LogOut size={14} />
              {loggingOut ? "Signing out…" : "Log out"}
            </button>
          </div>
        )}

        <button
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={user ? `Account menu for ${user.name}` : "Account menu"}
          className="sf-collapse-center mt-4 flex w-full items-center gap-3 rounded-xl bg-white/6 p-3 text-left transition hover:bg-white/10"
        >

          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#D7F36B] text-xs font-bold text-[#10271F]">
            {user ? initialsFor(user.name) : "…"}
          </div>

          <div className="sf-label min-w-0 flex-1">

            <p className="truncate text-xs font-semibold">
              {user ? user.name : "Loading…"}
            </p>

            <p className="mt-0.5 truncate text-[10px] text-white/40">
              {user ? (ROLE_LABELS[user.role] ?? user.role) : ""}
            </p>

          </div>

          <ChevronDown size={15} className={`sf-label shrink-0 text-white/40 transition-transform ${menuOpen ? "rotate-180" : ""}`} />

        </button>

      </div>

      </aside>

    </>
  );
}
