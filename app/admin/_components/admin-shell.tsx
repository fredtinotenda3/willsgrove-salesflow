import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";

/**
 * Per-page guard. The shell itself (sidebar, header, breadcrumbs) lives in
 * app/admin/layout.tsx; every admin page still calls this first because a
 * layout is not a security boundary (it is skipped on client-side
 * navigations). Every /api/admin route re-verifies independently.
 */
export async function requireAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMINISTRATOR") redirect("/");
  return user;
}
