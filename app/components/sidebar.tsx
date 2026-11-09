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
} from "lucide-react";

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

        <Link
          href="/settings"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-white/60 transition hover:bg-white/[0.07] hover:text-white"
        >
          <Settings size={17} />
          Settings
        </Link>

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
