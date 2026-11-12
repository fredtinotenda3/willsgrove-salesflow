import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Milestone 11 (Operational BI), spec section 8: "provide a reusable
 * filtering experience... by customer, product, salesperson." Populates
 * the <select> dropdowns on the reports UI with real, bounded option
 * lists -- not free-text ID entry, which would be unusable without
 * already knowing a cuid.
 *
 * Customer and salesperson lists are small and bounded in this business
 * (a few hundred active customers, a handful of sales staff at most), so
 * a capped, non-paginated list is appropriate here -- this is a filter
 * control's option list, not a report's own data, and spec section 11's
 * "never load an entire table into the browser" is about report ROWS,
 * not a few hundred {id, name} pairs used to populate a dropdown.
 *
 * Product is deliberately NOT given a dropdown: the real SAP item master
 * this schema was built from has roughly 7,500 rows (see Product model's
 * own schema comment), far too many to either load into a <select> or
 * meaningfully scroll through. The product filter on the reports UI is a
 * plain "Product ID" text field instead -- honest about what it can do,
 * rather than a dropdown nobody could use. A searchable product combobox
 * is a reasonable follow-up but out of scope for this milestone (spec
 * section 15: no speculative work beyond what's asked).
 */

export const FILTER_OPTION_CAP = 500;

export type FilterOption = { id: string; name: string };

export type ReportFilterOptions = {
  customers: FilterOption[];
  salespeople: FilterOption[];
};

export async function getReportFilterOptions(): Promise<ReportFilterOptions> {
  const [customers, salespeople] = await Promise.all([
    prisma.customer.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: FILTER_OPTION_CAP,
    }),
    prisma.user.findMany({
      where: { role: { in: ["SALESPERSON", "SALES_MANAGER"] }, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: FILTER_OPTION_CAP,
    }),
  ]);

  return { customers, salespeople };
}
