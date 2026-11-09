import { requireUserOrResponse } from "@/lib/auth/current-user";
import { computeCatalogueHealth } from "@/lib/catalogue-health";

const SAMPLE_LIMIT = 100;

// Read-only report -- GET, not POST, and no CSRF check (same rule this
// codebase already applies to every other read-only endpoint: CSRF
// protection is reserved for state-changing requests).
export async function GET() {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const report = await computeCatalogueHealth();

    return Response.json(
      {
        success: true,
        generatedAt: report.generatedAt,
        totalProducts: report.totalProducts,
        summary: {
          blankDescriptions: report.blankDescriptions.length,
          duplicateDescriptionGroups: report.duplicateDescriptions.length,
          duplicateDescriptionRows: report.duplicateDescriptionRowCount,
          nonBarcodeValues: report.nonBarcodeValues.length,
          leadingZeroCodes: report.leadingZeroCount,
          itemsWithoutUnit: report.itemsWithoutUnit,
          itemsWithoutVatCode: report.itemsWithoutVatCode,
        },
        blankDescriptions: report.blankDescriptions.slice(0, SAMPLE_LIMIT),
        duplicateDescriptions: report.duplicateDescriptions.slice(0, SAMPLE_LIMIT),
        nonBarcodeValues: report.nonBarcodeValues.slice(0, SAMPLE_LIMIT),
        leadingZeroCodes: report.leadingZeroCodes.slice(0, SAMPLE_LIMIT),
        sampleLimit: SAMPLE_LIMIT,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Catalogue health report failed:", error);
    return Response.json({ success: false, message: "Unable to compute the catalogue health report." }, { status: 500 });
  }
}
