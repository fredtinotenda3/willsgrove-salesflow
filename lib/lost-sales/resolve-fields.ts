/**
 * Milestone 4 (Lost-Sales Management).
 *
 * Pure mapping used twice: once to resolve an UnfulfilledDemand's own
 * frozen SAP-code/description snapshot at creation time (from the
 * PickingLine's OrderLine), and once to resolve a SUBSTITUTE product's
 * snapshot at the moment a SUBSTITUTE_ACCEPTED decision is recorded (from
 * the live Product chosen as the substitute). Same priority
 * lib/handover/build-handover-rows.ts and
 * lib/assembly-form/resolve-line.ts already established: live Product
 * match first, then an order-time SAP-code snapshot, then (only for the
 * original line, never for a substitute, which has no "original wording"
 * of its own) the customer's own original wording -- so a record is
 * never left showing a blank product name.
 *
 * Deliberately its own small pure function here rather than a shared
 * export out of resolve-line.ts/build-handover-rows.ts: same "mirror the
 * convention, don't force a shared abstraction across genuinely different
 * call sites" choice this project already makes (see
 * lib/assembly-form/resolve-line.ts's own comment) -- this one has no
 * `originalProductDescription` fallback option at all for the substitute
 * case, which the other two call sites don't need to express. No
 * @prisma/client import, so it's statically importable and
 * unit-testable exactly like lib/picking/validation.ts.
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

export type ResolveSubstituteFieldsInput = {
  substituteSapItemCode: string | null;
  substituteItemName: string;
};

export type ResolvedSubstituteFields = {
  substituteSapItemCodeSnapshot: string | null;
  substituteProductDescriptionSnapshot: string;
};

/**
 * A substitute is always a live catalogue Product chosen at the moment of
 * acceptance (spec 4.5: "Record the substitute SAP item code and
 * description") -- there is no customer-wording fallback to reach for,
 * unlike the original line.
 */
export function resolveSubstituteFields(input: ResolveSubstituteFieldsInput): ResolvedSubstituteFields {
  return {
    substituteSapItemCodeSnapshot: input.substituteSapItemCode,
    substituteProductDescriptionSnapshot: input.substituteItemName,
  };
}
