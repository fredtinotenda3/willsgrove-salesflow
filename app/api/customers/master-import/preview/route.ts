import { NextRequest } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseSapCustomerMasterCsv } from "@/lib/sap-customer-master-csv";
import { planCustomerMasterImport, readCustomerMasterCsvUpload } from "@/lib/customer-master-import";

const SAMPLE_LIMIT = 20;
const ERROR_LIMIT = 100;

export async function POST(request: NextRequest) {
  // Final completion phase, section 9: customer master data (credit
  // limits, credit holds, TIN/VAT, pricing assignment) is restricted to
  // SALES_MANAGER/ADMINISTRATOR -- unlike the other CSV-import routes in
  // this codebase (price-list, tax-code), which deliberately follow the
  // project's "no dedicated role for this action" precedent, this one is
  // explicitly scoped by the directive to be role-gated. Gating the
  // preview too (not just the execute route below) avoids a confusing
  // flow where a SALESPERSON can review a full import plan and then only
  // discover at confirm time that they can't run it.
  const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;

  try {
    const formData = await request.formData();
    const upload = await readCustomerMasterCsvUpload(formData);

    if (!upload.ok) {
      return Response.json({ success: false, message: upload.message }, { status: upload.status });
    }

    const parsed = parseSapCustomerMasterCsv(upload.csvText);

    if (!parsed.success) {
      return Response.json(
        {
          success: false,
          message: "The customer-master CSV file contains validation errors.",
          fileName: upload.fileName,
          totalRows: parsed.totalRows,
          validRows: parsed.rows.length,
          errorCount: parsed.errors.length,
          errors: parsed.errors.slice(0, ERROR_LIMIT),
          errorsTruncated: parsed.errors.length > ERROR_LIMIT,
          duplicateCodes: parsed.duplicateCodes.slice(0, ERROR_LIMIT),
        },
        { status: 422 }
      );
    }

    const plan = await planCustomerMasterImport(parsed.rows);

    // Real Business Data Onboarding round: tell the operator which header
    // layout was actually detected, and -- for LEAN -- which real columns
    // in their source file have no home in the Customer schema and are
    // therefore NOT being written anywhere, so that fact is visible
    // before they confirm, never silently dropped. See
    // lib/sap-customer-master-csv.ts's module comment for the full story.
    const layoutNote =
      parsed.layout === "LEAN"
        ? `This file uses the Business Partner list layout (BP Code / BP Name only). ` +
          `TIN, VAT, currency, price list, payment terms, branch/store, credit limit, ` +
          `address and contact columns are not present in this file and will be left blank.` +
          (parsed.unmappedInformationalColumns && parsed.unmappedInformationalColumns.length > 0
            ? ` The following columns ARE present in the source file but have no field on the ` +
              `Customer record yet, so they are not being imported: ${parsed.unmappedInformationalColumns.join(", ")}.`
            : "")
        : null;

    return Response.json(
      {
        success: true,
        message: "Customer-master CSV validated successfully.",
        fileName: upload.fileName,
        layout: parsed.layout,
        layoutNote,
        summary: {
          totalRows: parsed.totalRows,
          validRows: parsed.rows.length,
          newCustomers: plan.newCustomers.length,
          changedCustomers: plan.changedCustomers.length,
          unchangedCustomers: plan.unchangedCount,
          unmatchedPriceListCodes: plan.unmatchedPriceListCodes.length,
        },
        newSample: plan.newCustomers.slice(0, SAMPLE_LIMIT).map((c) => ({
          customerCode: c.row.customerCode,
          customerName: c.row.customerName,
          tin: c.row.tin,
          vatNumber: c.row.vatNumber,
          storeCode: c.row.storeCode,
        })),
        changedSample: plan.changedCustomers.slice(0, SAMPLE_LIMIT).map((c) => ({
          code: c.code,
          current: { name: c.current.name, storeCode: c.current.storeCode },
          incoming: { name: c.incoming.customerName, storeCode: c.incoming.storeCode },
        })),
        unmatchedPriceListCodes: plan.unmatchedPriceListCodes,
        sampleLimit: SAMPLE_LIMIT,
        importExecuted: false,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Customer master import preview failed:", error);
    return Response.json({ success: false, message: "Unable to preview the customer master import." }, { status: 500 });
  }
}
