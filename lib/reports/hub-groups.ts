/**
 * Reports & Analytics hub: the report routes, grouped by the question
 * they answer. Pure data + one pure filter, so the grouping and the
 * role-visibility rule are unit-tested.
 *
 * The role flag here only decides what the HUB SHOWS. It is a UX filter, not
 * the security boundary: every management report page redirects non-managers
 * and every management API route calls requireManagementReportAccess()
 * server-side. Keep this list and those checks in step.
 */
export type ReportAccess = "all" | "management";

export type ReportEntry = {
  href: string;
  title: string;
  description: string;
  access: ReportAccess;
  /** lucide icon name, resolved in the page so this module stays free of React imports. */
  icon: "trending-up" | "users" | "truck" | "trending-down" | "dollar-sign" | "file-warning" | "building" | "package" | "message-square" | "lightbulb" | "clipboard-list";
};

export type ReportGroup = { id: string; title: string; description: string; entries: ReportEntry[] };

export const REPORT_GROUPS: ReportGroup[] = [
  {
    id: "sales",
    title: "Sales & orders",
    description: "How enquiries become orders, and who is converting them.",
    entries: [
      { href: "/reports/pipeline", title: "Sales Pipeline & Orders", description: "Conversion rates and bottlenecks from request through to order, with cohort-safe rates.", access: "all", icon: "trending-up" },
      { href: "/reports/sales-performance", title: "Sales Performance", description: "Salesperson attribution confidence, revenue, customer activity and lost-sales breakdowns.", access: "management", icon: "users" },
    ],
  },
  {
    id: "fulfilment",
    title: "Fulfilment & supply",
    description: "What we could and could not supply, and what it cost us.",
    entries: [
      { href: "/reports/fulfilment", title: "Picking & Fulfilment", description: "Picking availability, dispatch and delivery performance, never blending picked with delivered.", access: "all", icon: "truck" },
      { href: "/lost-sales/analytics", title: "Lost Sales Analytics", description: "Requested vs unavailable quantity and value, shortage rankings and an order-level drilldown.", access: "all", icon: "trending-down" },
    ],
  },
  {
    id: "financial",
    title: "Financial exposure & claims",
    description: "Money at risk after delivery. SAP remains the system of record; claims are not credit notes.",
    entries: [
      { href: "/reports/financial-exposure", title: "Financial Exposure", description: "Reconciliation, claims, returns and credit notes by currency.", access: "all", icon: "dollar-sign" },
      { href: "/invoice-claims/dashboard", title: "Invoice Claims Dashboard", description: "Rejected products, delivered vs accepted vs rejected quantity, reasons and unresolved exposure.", access: "all", icon: "file-warning" },
    ],
  },
  {
    id: "customers-products",
    title: "Customers & products",
    description: "Independent rankings by value, frequency, recency and problems.",
    entries: [
      { href: "/reports/customer-intelligence", title: "Customer Intelligence", description: "Customer rankings by invoice line value, purchase frequency and recency, plus open claims.", access: "management", icon: "building" },
      { href: "/reports/product-intelligence", title: "Product Intelligence", description: "Ten independent product rankings: revenue, lost sales, claims, returns, declining activity and data quality.", access: "management", icon: "package" },
    ],
  },
  {
    id: "communications",
    title: "Communications",
    description: "Channel health and the intake backlog.",
    entries: [
      { href: "/reports/communications", title: "Communications & Exceptions", description: "Channel health, intake backlog and delivery exceptions across email and WhatsApp.", access: "all", icon: "message-square" },
    ],
  },
  {
    id: "management",
    title: "Management & decisions",
    description: "Recommendations and the periodic management pack.",
    entries: [
      { href: "/reports/decision-intelligence", title: "Decision Intelligence", description: "Deterministic, explainable recommendations with a lifecycle and full history.", access: "management", icon: "lightbulb" },
      { href: "/reports/management/actions", title: "Management Action Centre", description: "Every finding from the nine management reports in one place: what to do, who should act, how urgent, and the status of each action.", access: "management", icon: "clipboard-list" },
      { href: "/reports/management", title: "Management Reports", description: "Daily, weekly and monthly summaries, outstanding orders, picking shortages and delivery exceptions.", access: "management", icon: "clipboard-list" },
    ],
  },
];

/** Groups/entries the viewer may see; a group with no visible entry is dropped entirely. */
export function visibleReportGroups(role: string, groups: readonly ReportGroup[] = REPORT_GROUPS): ReportGroup[] {
  const isManagement = role === "SALES_MANAGER" || role === "ADMINISTRATOR";
  return groups
    .map((group) => ({ ...group, entries: group.entries.filter((entry) => entry.access === "all" || isManagement) }))
    .filter((group) => group.entries.length > 0);
}
