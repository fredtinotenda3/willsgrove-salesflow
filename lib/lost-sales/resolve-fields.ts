/**
 * Milestone 4 (Lost-Sales Management).
 *
 * Pure mapping that resolves an UnfulfilledDemand's own frozen
 * SAP-code/description snapshot at creation time (from the PickingLine's
 * OrderLine). Same priority lib/handover/build-handover-rows.ts and
 * lib/assembly-form/resolve-line.ts already established: live Product
 * match first, then an order-time SAP-code snapshot, then the customer's
 * own original wording -- so a record is never left showing a blank
 * product name.
 *
 * Deliberately its own small pure function here rather than a shared
 * export out of resolve-line.ts/build-handover-rows.ts: same "mirror the
 * convention, don't force a shared abstraction across genuinely different
 * call sites" choice this project already makes (see
 * lib/assembly-form/resolve-line.ts's own comment). No @prisma/client
 * import, so it's statically importable and unit-testable exactly like
 * lib/picking/validation.ts.
 *
 * Real Business Data Onboarding round (spec PART A): resolveSubstituteFields
 * (the equivalent resolver for a SUBSTITUTE_ACCEPTED decision's substitute
 * product) is removed from this file -- no surviving code path ever
 * records a new SUBSTITUTE_ACCEPTED decision any more (see
 * lib/lost-sales/validation.ts's module comment), so nothing calls it.
 * CustomerDecisionEvent.substituteSapItemCodeSnapshot/
 * substituteProductDescriptionSnapshot stay as schema columns, readable
 * for any pre-existing row, but no new row-builder exists to populate
 * them any more.
 */
export type ResolveOriginalDemandFieldsInput = {
  originalProductDescription: string;
  sapItemCodeSnapshot: string | null;
  productSapItemCode: string | null;
  officialProductDescription: string | null;
};

export type ResolvedDemandFields = {
  sapItemCodeSnapshot: string | null;
  productDescriptionSnapshot: string;
};

export function resolveOriginalDemandFields(input: ResolveOriginalDemandFieldsInput): ResolvedDemandFields {
  return {
    sapItemCodeSnapshot: input.productSapItemCode ?? input.sapItemCodeSnapshot ?? null,
    productDescriptionSnapshot: input.officialProductDescription ?? input.originalProductDescription,
  };
}
