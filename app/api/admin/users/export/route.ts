import { adminRead } from "@/lib/admin/route";
import { prisma } from "@/lib/prisma";
import { toCsv } from "@/lib/admin/csv";

/** GET /api/admin/users/export -- user register. Never includes password hashes. */
export async function GET() {
  return adminRead(async (actor) => {
    const rows = await prisma.user.findMany({ orderBy: { name: "asc" }, select: { name: true, email: true, role: true, status: true, department: true, createdAt: true } });
    await prisma.auditEvent.create({ data: { actorId: actor.id, action: "DATA_EXPORT", entityType: "User", entityId: "export", afterData: { rows: rows.length } } });
    const csv = toCsv(["name", "email", "role", "status", "department", "createdAt"], rows.map((r) => [r.name, r.email, r.role, r.status, r.department, r.createdAt.toISOString()]));
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="users.csv"', "Cache-Control": "no-store" } });
  });
}
