import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV, ALL_ADMIN_ITEMS, breadcrumbsFor, groupOf, isActiveItem, matchNavItem } from "@/lib/admin/nav";

const root = join(__dirname, "..", "app");

describe("administration navigation", () => {
  it("every item points at a page that exists (no dead links)", () => {
    for (const item of ALL_ADMIN_ITEMS) expect(existsSync(join(root, item.href, "page.tsx")), item.href).toBe(true);
  });

  it("hrefs are unique and live under /admin; groups are not empty", () => {
    const hrefs = ALL_ADMIN_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.every((h) => h === "/admin" || h.startsWith("/admin/"))).toBe(true);
    expect(ADMIN_NAV.every((g) => g.items.length > 0)).toBe(true);
  });

  it("matches the longest owning item; /admin matches only exactly", () => {
    expect(matchNavItem("/admin")?.href).toBe("/admin");
    expect(matchNavItem("/admin/orders")?.href).toBe("/admin/orders");
    expect(matchNavItem("/admin/orders/abc123")?.href).toBe("/admin/orders");
    expect(matchNavItem("/admin/invoices/imports")?.href).toBe("/admin/invoices");
    expect(matchNavItem("/admin/orders/")?.href).toBe("/admin/orders");
    expect(matchNavItem("/admin/does-not-exist")).toBeNull();
    expect(matchNavItem("/orders")).toBeNull();
    expect(groupOf(matchNavItem("/admin/claims"))?.id).toBe("finance");
  });

  it("builds breadcrumbs whose last crumb is not a link", () => {
    expect(breadcrumbsFor("/admin")).toEqual([{ label: "Administration" }, { label: "Command centre" }]);
    const detail = breadcrumbsFor("/admin/orders/abc123");
    expect(detail.map((c) => c.label)).toEqual(["Administration", "Orders", "Record"]);
    expect(detail[0].href).toBe("/admin");
    expect(detail[1].href).toBe("/admin/orders");
    expect(detail.at(-1)?.href).toBeUndefined();
    expect(breadcrumbsFor("/admin/invoices/imports").map((c) => c.label)).toEqual(["Administration", "SAP invoices", "Import batches"]);
  });

  it("marks exactly one item active for a record page", () => {
    const active = ALL_ADMIN_ITEMS.filter((i) => isActiveItem(i, "/admin/customers/xyz"));
    expect(active.map((i) => i.href)).toEqual(["/admin/customers"]);
  });

  it("the removed /settings page is gone and nothing links to it", () => {
    expect(existsSync(join(root, "settings"))).toBe(false);
    expect(ALL_ADMIN_ITEMS.some((i) => i.href.includes("settings"))).toBe(false);
  });
});
