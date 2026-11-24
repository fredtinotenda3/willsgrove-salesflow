import { describe, expect, it } from "vitest";
import { REPORT_GROUPS, visibleReportGroups } from "@/lib/reports/hub-groups";

const MANAGEMENT_ROUTES = ["/reports/sales-performance", "/reports/customer-intelligence", "/reports/product-intelligence", "/reports/decision-intelligence", "/reports/management"];
const ORIGINAL_TEN = [
  "/reports/pipeline", "/reports/fulfilment", "/reports/financial-exposure", "/reports/communications", "/lost-sales/analytics",
  "/reports/sales-performance", "/reports/customer-intelligence", "/reports/product-intelligence", "/reports/decision-intelligence", "/reports/management",
];

const hrefs = (role: string) => visibleReportGroups(role).flatMap((g) => g.entries.map((e) => e.href));

describe("report hub grouping", () => {
  it("keeps every one of the original ten routes, each exactly once", () => {
    const all = REPORT_GROUPS.flatMap((g) => g.entries.map((e) => e.href));
    for (const route of ORIGINAL_TEN) expect(all.filter((h) => h === route)).toHaveLength(1);
  });
  it("hides all five management reports from a salesperson", () => {
    const visible = hrefs("SALESPERSON");
    for (const route of MANAGEMENT_ROUTES) expect(visible).not.toContain(route);
    expect(visible).toContain("/reports/pipeline");
  });
  it("shows every route to managers and administrators", () => {
    for (const role of ["SALES_MANAGER", "ADMINISTRATOR"]) for (const route of ORIGINAL_TEN) expect(hrefs(role)).toContain(route);
  });
  it("drops a group with nothing visible instead of rendering an empty heading", () => {
    const groups = visibleReportGroups("SALESPERSON");
    expect(groups.every((g) => g.entries.length > 0)).toBe(true);
    expect(groups.find((g) => g.id === "management")).toBeUndefined();
  });
  it("treats an unknown role as non-management", () => {
    for (const route of MANAGEMENT_ROUTES) expect(hrefs("")).not.toContain(route);
  });
});
