"use client";

import Link from "next/link";
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
  Search,
  Bell,
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
        badge: "12",
      },
      {
        name: "New Order",
        href: "/orders/new",
        icon: Plus,
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
    ],
  },
];

export default function Sidebar() {
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
                const isDashboard = item.name === "Dashboard";

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`group flex items-center justify-between rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all ${
                      isDashboard
                        ? "bg-[#D7F36B] text-[#10271F] shadow-sm"
                        : "text-white/65 hover:bg-white/[0.07] hover:text-white"
                    }`}
                  >

                    <span className="flex items-center gap-3">

                      <Icon size={17} strokeWidth={1.9} />

                      {item.name}

                    </span>

                    {item.badge && (
                      <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white">
                        {item.badge}
                      </span>
                    )}

                  </Link>
                );
              })}

            </div>

          </div>
        ))}

      </nav>

      {/* Bottom settings */}
      <div className="border-t border-white/10 p-4">

        <Link
          href="/settings"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-white/60 transition hover:bg-white/[0.07] hover:text-white"
        >
          <Settings size={17} />
          Settings
        </Link>

        <div className="mt-4 flex items-center gap-3 rounded-xl bg-white/6 p-3">

          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#D7F36B] text-xs font-bold text-[#10271F]">
            SA
          </div>

          <div className="min-w-0 flex-1">

            <p className="truncate text-xs font-semibold">
              Sales Administrator
            </p>

            <p className="mt-0.5 text-[10px] text-white/40">
              Sales Department
            </p>

          </div>

          <ChevronDown size={15} className="text-white/40" />

        </div>

      </div>

    </aside>
  );
}