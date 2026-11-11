import "server-only";
import { prisma } from "@/lib/prisma";
import { computeExposureByCurrency, type CurrencyExposureBucket } from "@/lib/invoice-claims/financial";

/**
 * Milestone 6A. Dashboard/reporting aggregates (spec section 8).
 *
 * "Clearly label pending estimates vs. actual financial values" --
 * every money figure here comes from computeExposureByCurrency, which
 * itself labels actualSapCreditedAmount as unavailable (Milestone 6B).
 * Drill-down is supported by every bucket here carrying enough identity
 * (status/category/customerId/etc.) for the UI to re-query
 * /api/invoice-claims with that filter, rather than this endpoint
 * embedding full claim lists itself.
 */

export type InvoiceClaimsDashboard = {
  statusCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  priorityCounts: Record<string, number>;
  byCustomer: { customerId: string; customerName: string; claimCount: number }[];
  byResponsibleDepartment: { department: string; claimCount: number }[];
  byProduct: {
    sapItemCode: string;
    sapItemDescription: string | null;
    claimLineCount: number;
    qualityIssueCount: number;
  }[];
  exposureByCurrency: CurrencyExposureBucket[];
  averageResolutionDays: number | null;
  repeatComplaintCustomers: { customerId: string; customerName: string; claimCount: number }[];
};

const ALL_STATUSES = [
  "OPEN",
  "UNDER_INVESTIGATION",
  "AWAITING_CUSTOMER",
  "AWAITING_INTERNAL_ACTION",
  "APPROVED",
  "PARTIALLY_RESOLVED",
  "RESOLVED",
  "REJECTED",
  "CLOSED",
] as const;

export async function getInvoiceClaimsDashboard(options?: { includeDemo?: boolean }): Promise<InvoiceClaimsDashboard> {
  const includeDemo = options?.includeDemo ?? false;
  const baseWhere = includeDemo ? {} : { isDemo: false };

  const [statusGroups, categoryGroups, priorityGroups, customerGroups, departmentGroups, resolvedClaims, allClaims] = await Promise.all([
    prisma.invoiceClaim.groupBy({ by: ["status"], where: baseWhere, _count: { _all: true } }),
    prisma.invoiceClaim.groupBy({ by: ["category"], where: baseWhere, _count: { _all: true } }),
    prisma.invoiceClaim.groupBy({ by: ["priority"], where: baseWhere, _count: { _all: true } }),
    prisma.invoiceClaim.groupBy({ by: ["customerId"], where: baseWhere, _count: { _all: true }, orderBy: { _count: { customerId: "desc" } }, take: 20 }),
    prisma.claimResolution.groupBy({
      by: ["responsibleDepartment"],
      where: { responsibleDepartment: { not: null }, claim: baseWhere },
      _count: { _all: true },
    }),
    prisma.invoiceClaim.findMany({
      where: { ...baseWhere, resolvedAt: { not: null } },
      select: { claimDate: true, resolvedAt: true },
    }),
    prisma.invoiceClaim.findMany({ where: baseWhere, select: { id: true } }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const status of ALL_STATUSES) statusCounts[status] = 0;
  for (const row of statusGroups) statusCounts[row.status] = row._count._all;

  const categoryCounts: Record<string, number> = {};
  for (const row of categoryGroups) categoryCounts[row.category] = row._count._all;

  const priorityCounts: Record<string, number> = {};
  for (const row of priorityGroups) priorityCounts[row.priority] = row._count._all;

  const customerIds = customerGroups.map((row) => row.customerId);
  const customers = customerIds.length > 0 ? await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } }) : [];
  const customerNameById = new Map(customers.map((c) => [c.id, c.name]));

  const byCustomer = customerGroups.map((row) => ({
    customerId: row.customerId,
    customerName: customerNameById.get(row.customerId) ?? "(unknown)",
    claimCount: row._count._all,
  }));

  // Repeat complaints: the same byCustomer data, filtered to customers
  // with more than one claim -- a distinct business question from "top
  // customers by volume" (which can include a customer with exactly one
  // large claim), so computed as its own named list rather than implied.
  const repeatComplaintCustomers = byCustomer.filter((row) => row.claimCount > 1);

  const byResponsibleDepartment = departmentGroups
    .filter((row) => row.responsibleDepartment !== null)
    .map((row) => ({ department: row.responsibleDepartment as string, claimCount: row._count._all }));

  // "Products with recurring quality problems": every claim line grouped
  // by its snapshotted SAP item code, counted overall and specifically
  // for QUALITY_ISSUE-category claims. Read from InvoiceClaimLine's own
  // snapshot columns (display-only, per that model's own comment), never
  // re-joined to the live SapInvoiceLine for this count.
  const claimLinesWithProduct = await prisma.invoiceClaimLine.findMany({
    where: { claim: baseWhere, sapItemCodeSnapshot: { not: null } },
    select: { sapItemCodeSnapshot: true, sapItemDescriptionSnapshot: true, claim: { select: { category: true } } },
  });
  const productStats = new Map<string, { description: string | null; total: number; qualityIssue: number }>();
  for (const line of claimLinesWithProduct) {
    const code = line.sapItemCodeSnapshot as string;
    const entry = productStats.get(code) ?? { description: line.sapItemDescriptionSnapshot, total: 0, qualityIssue: 0 };
    entry.total += 1;
    if (line.claim.category === "QUALITY_ISSUE") entry.qualityIssue += 1;
    productStats.set(code, entry);
  }
  const byProduct = Array.from(productStats.entries())
    .map(([sapItemCode, stats]) => ({
      sapItemCode,
      sapItemDescription: stats.description,
      claimLineCount: stats.total,
      qualityIssueCount: stats.qualityIssue,
    }))
    .sort((a, b) => b.claimLineCount - a.claimLineCount)
    .slice(0, 20);

  // Average resolution time: mean of (resolvedAt - claimDate) in days,
  // across every claim that has reached a concluded status. claimDate is
  // a @db.Date (midnight UTC); resolvedAt is a full timestamp -- the
  // difference is still a meaningful day count for reporting purposes.
  let averageResolutionDays: number | null = null;
  if (resolvedClaims.length > 0) {
    const totalMs = resolvedClaims.reduce((sum, claim) => sum + (claim.resolvedAt!.getTime() - claim.claimDate.getTime()), 0);
    averageResolutionDays = totalMs / resolvedClaims.length / (1000 * 60 * 60 * 24);
  }

  const exposureByCurrency = await computeExposureByCurrency(allClaims.map((c) => c.id));

  return {
    statusCounts,
    categoryCounts,
    priorityCounts,
    byCustomer,
    byResponsibleDepartment,
    byProduct,
    exposureByCurrency,
    averageResolutionDays,
    repeatComplaintCustomers,
  };
}
