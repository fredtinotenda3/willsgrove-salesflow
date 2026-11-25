import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { AdminFrame } from "./_components/admin-frame";

/**
 * Administration layout. The role check here gives a clean redirect and keeps
 * the sidebar from rendering for the wrong people; it is NOT the security
 * boundary. Every admin page calls requireAdminPage() itself and every
 * /api/admin route re-verifies the session and ADMINISTRATOR role against the
 * database, because layouts do not re-run on every client navigation.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMINISTRATOR") redirect("/");
  return <AdminFrame user={{ name: user.name, email: user.email }}>{children}</AdminFrame>;
}
