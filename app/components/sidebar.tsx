"use client";

import { useEffect, useState } from "react";
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
  Settings,
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
} from "lucide-react";
import NotificationBell from "./notification-bell";

const navigation = [
  {
    title: "WORKSPACE",
    items: [
      {
        name: "Dashboard",
        href: "/",
        icon: LayoutDashboard,
      },
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
      // Milestone 7 (Quotations Management). Sits alongside Orders/PO
      // Intake, not under Operations -- a quotation is the pre-order
      // sales step (spec section 2: "used by sales staff when a customer
      // requests pricing information before placing an order"), not an
      // operational/fulfilment concern like the items below it.
      {
        name: "Quotations",
        href: "/quotations",
        icon: FileText,
      },
      // Milestone 8 (Validation and Approvals). Cross-module -- sits
      // alongside Quotations/Orders rather than under Operations, since
      // it serves every module with an approval workflow (today:
      // Quotations' pricing/discount exceptions), not one operational
      // step.
      {
        name: "Approvals",
        href: "/approvals",
        icon: ShieldCheck,
      },
    ],
  },
  {
    title: "SALES MANAGEMENT",
    items: [
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
      // Milestone 4 (Lost-Sales Management). Unlike /fulfilment and
      // /deliveries above, there was no pre-existing dead placeholder
      // link for this -- added fresh.
      {
        name: "Lost Sales",
        href: "/lost-sales",
        icon: TrendingDown,
      },
      // Milestone 5 (SAP Invoice Reconciliation). Same "no pre-existing
      // dead placeholder link" situation as Lost Sales above.
      {
        name: "Invoice Reconciliation",
        href: "/invoice-reconciliation",
        icon: Receipt,
      },
      // Milestone 6A (Invoice Claims Management). Same "no pre-existing
      // dead placeholder link" situation as Lost Sales/Invoice
      // Reconciliation above.
      {
        name: "Invoice Claims",
        href: "/invoice-claims",
        icon: FileWarning,
      },
      // Milestone 6B (Returns & Credit Notes). Same "no pre-existing dead
      // placeholder link" situation as Lost Sales/Invoice Reconciliation/
      // Invoice Claims above.
      {
        name: "Returns & Credits",
        href: "/returns-credits",
        icon: Undo2,
      },
      // Milestone 10 (Communication Channels & Fulfilment). The outbound
      // message log (quotation/order/dispatch/delivery notifications) --
      // same "no pre-existing dead placeholder link" situation as Lost
      // Sales/Invoice Reconciliation/Invoice Claims/Returns & Credits
      // above.
      {
        name: "Communications",
        href: "/communications",
        icon: Send,
      },
    ],
  },
  {
    title: "INSIGHTS",
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
    title: "SAP MASTER DATA",
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
      {
        name: "Price Lists Import",
        href: "/price-lists/import",
        icon: Tags,
      },
      {
        name: "Customer Master Import",
        href: "/customers/master-import",
        icon: Building2,
      },
      // Milestone 9 (SAP Business One Integration). The connection/sync
      // dashboard, not another CSV import -- sits here anyway since
      // every existing item in this section is already "something to do
      // with getting SAP master data into SalesFlow," and this is the
      // same thing done automatically instead of by hand.
      {
        name: "SAP Integration",
        href: "/integrations/sap",
        icon: Plug,
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
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-65 flex-col border-r border-white/10 bg-[#10271F] text-white">

      {/* Brand */}
      <div className="flex h-19 items-center gap-3 border-b border-white/10 px-6">

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#D7F36B] text-[#10271F]">
          <Leaf size={23} strokeWidth={2.5} />
        </div>

        <div>
          <h1 className="text-[16px] font-bold tracking-tight">
            Willsgrove
          </h1>

          <p className="text-[11px] font-medium tracking-[0.13em] text-white/50">
            SALESFLOW
          </p>
        </div>

      </div>

      {/* Workspace selector */}
      <div className="px-4 pt-5">

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

        {navigation.map((section) => (
          <div key={section.title}>

            <p className="mb-3 px-3 text-[10px] font-bold tracking-[0.14em] text-white/35">
              {section.title}
            </p>

            <div className="space-y-1">

              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isActivePath(pathname, item.href);

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`group flex items-center justify-between rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all ${
                      active
                        ? "bg-[#D7F36B] text-[#10271F] shadow-sm"
                        : "text-white/65 hover:bg-white/[0.07] hover:text-white"
                    }`}
                  >

                    <span className="flex items-center gap-3">

                      <Icon size={17} strokeWidth={1.9} />

                      {item.name}

                    </span>

                  </Link>
                );
              })}

            </div>

          </div>
        ))}

      </nav>

      {/* Bottom settings */}
      <div className="relative border-t border-white/10 p-4">

        <div className="flex items-center gap-1">
          <Link
            href="/settings"
            className="flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-white/60 transition hover:bg-white/[0.07] hover:text-white"
          >
            <Settings size={17} />
            Settings
          </Link>
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
          className="mt-4 flex w-full items-center gap-3 rounded-xl bg-white/6 p-3 text-left transition hover:bg-white/10"
        >

          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#D7F36B] text-xs font-bold text-[#10271F]">
            {user ? initialsFor(user.name) : "…"}
          </div>

          <div className="min-w-0 flex-1">

            <p className="truncate text-xs font-semibold">
              {user ? user.name : "Loading…"}
            </p>

            <p className="mt-0.5 truncate text-[10px] text-white/40">
              {user ? (ROLE_LABELS[user.role] ?? user.role) : ""}
            </p>

          </div>

          <ChevronDown size={15} className={`shrink-0 text-white/40 transition-transform ${menuOpen ? "rotate-180" : ""}`} />

        </button>

      </div>

    </aside>
  );
}
