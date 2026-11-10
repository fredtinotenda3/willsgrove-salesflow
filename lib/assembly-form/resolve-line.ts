/**
 * Milestone 3 completion (Warehouse Assembly Form & Partial Availability).
 *
 * Pure mapping from one of getOrderById's line objects to exactly what
 * the printed Warehouse Assembly Form needs to show for it: an SAP item
 * code and an official description, resolved with the same priority
 * lib/handover/build-handover-rows.ts already established for the
 * invoice handover -- live Product match first, then the
 * sapItemCodeSnapshot taken at order-entry time, then (if truly nothing
 * resolved) the customer's own original wording, so the form is never
 * left showing a blank product name.
 *
 * Deliberately its own small pure function here rather than a shared
 * export out of build-handover-rows.ts: that file's resolution produces
 * a different shape (a HandoverRow, with `matched`/`note` fields the
 * invoice-handover's three-way-fallback UI needs but this printed form
 * does not) and reads from a PickingLine/PickingSession, not a plain
 * OrderLine -- this form is printed *before* picking exists at all. Same
 * "mirror the convention, don't force a shared abstraction across two
 * genuinely different call sites" choice this project already makes
 * elsewhere (see app/fulfilment/[id]/picking-panel.tsx's own comment on
 * its client-side DECIMAL_PATTERN). No @prisma/client import anywhere in
 * this file, so it's statically importable and unit-testable exactly
 * like lib/picking/validation.ts and lib/handover/format-rows.ts.
 */
export type AssemblyFormLineInput = {
  lineNumber: number;
  originalProductDescription: string;
  sapItemCodeSnapshot: string | null;
  requestedQuantity: string;
  requestedUnitCode: string;
  productSapItemCode: string | null;
  officialProductDescription: string | null;
};

export type AssemblyFormLine = {
  lineNumber: number;
  sapItemCode: string | null;
  description: string;
  requestedQuantity: string;
  requestedUnitCode: string;
};

export function resolveAssemblyFormLine(line: AssemblyFormLineInput): AssemblyFormLine {
  return {
    lineNumber: line.lineNumber,
    sapItemCode: line.productSapItemCode ?? line.sapItemCodeSnapshot ?? null,
    description: line.officialProductDescription ?? line.originalProductDescription,
    requestedQuantity: line.requestedQuantity,
    requestedUnitCode: line.requestedUnitCode,
  };
}
