import { NextRequest } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseSapCustomerMasterCsv } from "@/lib/sap-customer-master-csv";
import { planCustomerMasterImport, readCustomerMasterCsvUpload } from "@/lib/customer-master-import";

const SAMPLE_LIMIT = 20;
const ERROR_LIMIT = 100;

export async function POST(request: NextRequest) {
  const auth = await requireUserOrResponse();
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

    return Response.json(
      {
        success: true,
        message: "Customer-master CSV validated successfully.",
        fileName: upload.fileName,
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
