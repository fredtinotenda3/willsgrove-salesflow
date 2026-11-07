import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";

/** "Who am I" endpoint for client components (e.g. the sidebar user badge). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: true, user: null }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
