import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import Sidebar from "../../components/sidebar";

export const ADMIN_SECTIONS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users & access" },
  { href: "/admin/assignments", label: "Assignments" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/price-lists", label: "Pricing" },
  { href: "/admin/configuration", label: "Configuration" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/data", label: "Data management" },
] as const;

/**
 * Server-side page guard + shell. The role check here is a convenience for
 * navigation (a clean redirect); it is NOT the security boundary -- every
 * /api/admin route re-verifies the session and ADMINISTRATOR role.
 */
export async function requireAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMINISTRATOR") redirect("/");
  return user;
}

export function AdminShell({ active, children }: { active: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen md:pl-[260px]">
        <nav aria-label="Administration sections" className="sticky top-0 z-30 flex gap-1 overflow-x-auto border-b border-[#E8EBE6] bg-white px-6 py-2">
          {ADMIN_SECTIONS.map((s) => (
            <Link key={s.href} href={s.href} aria-current={s.href === active ? "page" : undefined} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${s.href === active ? "bg-[#1F7A4D] text-white" : "text-[#4B5B52] hover:bg-[#F1F4F0]"}`}>
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="space-y-6 p-6">{children}</div>
      </main>
    </div>
  );
}
