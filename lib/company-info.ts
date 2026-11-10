/**
 * Milestone 3 completion (Warehouse Assembly Form & Partial Availability).
 *
 * Willsgrove's own identification, for documents meant to leave the
 * screen as physical paper (the Warehouse Assembly Form is the first of
 * these; the SAP Invoice Handover deliberately has no company letterhead
 * of its own, since it's a data file for SAP, not a document a human
 * reads on paper). Deliberately a plain constants module -- no @prisma/
 * client import, no "server-only" -- so it's safe to import from a
 * Server Component, a Client Component, or a future print/export path
 * alike, same reasoning as lib/order-display.ts's own module comment.
 *
 * Mirrors exactly what app/settings/page.tsx already shows as this
 * business's workspace identity (company/branch/address) -- not invented
 * fresh for this feature -- so the two can't drift apart. If Settings'
 * mocked values are ever wired up to a real, persisted setting, this is
 * the one place to update to read from it instead.
 */
export const COMPANY_NAME = "Willsgrove Farm Enterprises";
export const COMPANY_BRANCH = "Harare Branch";
export const COMPANY_ADDRESS = "Birmingham Road, Southerton, Harare";
export const COMPANY_TAGLINE = "Sales Operations Platform · Harare";
