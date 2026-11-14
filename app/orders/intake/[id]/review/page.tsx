import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isValidId } from "@/lib/http";
import ReviewWorkspace from "./review-workspace";

/**
 * Milestone 2B / 2C. The server shell (auth + id validation) for the PO
 * intake review workspace -- same split as
 * app/communications/inbox/[id]/page.tsx + ReviewPanel: a thin Server
 * Component for the belt-and-suspenders auth/id check, with the actual
 * interactive work (loading the review session, editing lines,
 * confirming the order -- all via its own client-side fetches to
 * /api/po-intake/[id]/review and .../review/confirm, which already
 * enforce requireUserOrResponse()/isValidId() themselves) left entirely
 * to ReviewWorkspace (client).
 *
 * This page used to be that Client Component outright, reading the
 * document id via next/navigation's useParams() hook. With Cache
 * Components enabled (next.config.ts), Next.js tries to prerender a
 * static shell for every route, and a Client Component that calls
 * useParams() outside a <Suspense> boundary fails that production build
 * ("useParams() used in a Client Component outside of <Suspense>").
 * Resolving the id here via the `params` prop instead -- and handing it
 * down as a plain string -- removes the only useParams() call in this
 * route's tree, so there's nothing left for Cache Components to refuse
 * to prerender.
 */
export const instant = false;

type RouteParams = { params: Promise<{ id: string }> };

export default async function ReviewWorkspacePage({ params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  if (!isValidId(id)) {
    notFound();
  }

  return <ReviewWorkspace documentId={id} />;
}
