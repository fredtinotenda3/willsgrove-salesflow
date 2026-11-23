import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import PriceListDetail from "./price-list-detail";

/**
 * Next.js 16 (`cacheComponents: true`) fix for /price-lists/[id].
 *
 * This route used to be a single Client Component that unwrapped its
 * dynamic `params` Promise with React's `use(params)`. Under Cache
 * Components a dynamic route param is runtime data: reading it from a
 * Client Component with no Server Component above it leaves the whole
 * route un-prerenderable ("blocking route" / uncached data outside a
 * Suspense boundary). Every other dynamic detail page in this app
 * (e.g. app/quotations/[id], app/invoice-claims/[id]) avoids that by
 * being a Server Component that awaits `params` and hands plain props
 * to a client island -- this page now follows exactly that pattern.
 * `instant = false` is the same segment opt-out those pages use: the
 * detail view is allowed to block on its first navigation.
 *
 * The interactive entry table/editor is unchanged and lives in
 * ./price-list-detail.tsx (still a Client Component, now receiving `id`
 * as a prop instead of reading `params` itself).
 *
 * Auth: the client island's /api/price-lists/[id]/entries calls were
 * already authenticated server-side; the redirect here only makes an
 * unauthenticated visit land on /login the same way every other
 * Server Component page in this app does.
 */
export const instant = false;

type RouteParams = { params: Promise<{ id: string }> };

export default async function PriceListDetailPage({ params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  return <PriceListDetail id={id} />;
}
