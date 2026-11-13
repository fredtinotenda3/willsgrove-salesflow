import { Download, Filter } from "lucide-react";
import type { FilterOption } from "@/lib/reporting/filter-options";
import { DECISION_CATEGORIES, DECISION_PRIORITIES, DECISION_RECOMMENDATION_STATUSES } from "@/lib/reporting/decision-types";

/**
 * Milestone 11 (Operational BI), spec section 8: "a reusable, consistent
 * filtering experience across the operational reporting surface (date
 * range, customer, product, salesperson, status)." A plain GET <form> --
 * no client JS needed, works with cookies/auth exactly like following a
 * link, and is trivially testable (submitting it is just a navigation to
 * a URL with query params, the same contract app/api/reports/* already
 * parses with lib/reporting/filters.ts's parseReportFilters). The export
 * button is a second submit button on the SAME form with its own
 * `formAction` pointed at the CSV export route -- one filter bar, two
 * destinations, no duplicated field list and no JavaScript.
 *
 * `statusFilter`, when given, is deliberately ONE field, not five: each
 * report page passes only the ONE status dimension that's actually wired
 * up for it (see lib/reporting/*.ts's own top comments for which report
 * applies which filter) -- a dropdown that would silently do nothing is
 * worse than no dropdown at all.
 */

const FIELD_INPUT_CLASS =
  "h-[38px] w-full rounded-lg border border-[#E1E7E2] bg-white px-3 text-sm text-[#17251E] outline-none focus:border-[#78964A]";

/** Milestone 15 (Decision Intelligence). Human-readable labels for the three new fixed enums -- hardcoded here (rather than threaded through as props from each page) because, unlike `customers`/`salespeople`, these option sets are small, fixed schema enums with no per-tenant variation. */
const DECISION_CATEGORY_LABELS: Record<string, string> = {
  SALES: "Sales",
  CUSTOMER: "Customer",
  PRODUCT: "Product",
  COMMERCIAL_EXPOSURE: "Commercial exposure",
  OPERATIONAL: "Operational",
};

const DECISION_PRIORITY_LABELS: Record<string, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  INFORMATIONAL: "Informational",
};

const DECISION_RECOMMENDATION_STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

export type StatusFilterConfig = {
  queryKey: "orderStatus" | "quotationStatus" | "fulfilmentStatus" | "claimStatus" | "communicationStatus" | "lostSalesReason";
  label: string;
  options: { value: string; label: string }[];
};

export function ReportFilterBar({
  viewAction,
  exportAction,
  searchParams,
  customers,
  salespeople,
  showCustomer = true,
  showProduct = false,
  showSalesperson = false,
  showCurrency = false,
  showProductCategory = false,
  showProductSearch = false,
  showSapItemCode = false,
  showDecisionCategory = false,
  showPriority = false,
  showRecommendationStatus = false,
  statusFilter,
}: {
  viewAction: string;
  exportAction?: string;
  searchParams: Record<string, string | undefined>;
  customers: FilterOption[];
  salespeople: FilterOption[];
  showCustomer?: boolean;
  showProduct?: boolean;
  showSalesperson?: boolean;
  /** Milestone 12. A free-text 3-letter currency code field, same "no dropdown, honest about it" treatment as the Product ID field -- there is no bounded currency-option list anywhere in this codebase to populate a <select> from (CustomerOrder.currency/SapInvoice.currencyCode are both free-form strings, not a schema enum). */
  showCurrency?: boolean;
  /** Milestone 14. Product.category, free text -- no controlled taxonomy exists on this schema (spec section 3), same "no dropdown, honest about it" treatment as Product ID/Currency above. All three new M14 fields below are deliberately optional on lib/reporting/types.ts's ReportFilters -- see that file's own comment. */
  showProductCategory?: boolean;
  /** Milestone 14. Free-text search against a SAP item code or its most recent invoice-line description. */
  showProductSearch?: boolean;
  /** Milestone 14. Exact SAP item code -- distinct from the pre-existing `showProduct` (Product.id) field above; M14's own reports filter by sapItemCode, never by Product.id (spec section 3). */
  showSapItemCode?: boolean;
  /** Milestone 15. DecisionCategory enum -- distinct from `statusFilter` below (which carries exactly one of five pre-existing M11 status dimensions); this report has three of its own new enum filters, so each gets its own show-flag rather than overloading `statusFilter`. */
  showDecisionCategory?: boolean;
  /** Milestone 15. DecisionPriority enum. */
  showPriority?: boolean;
  /** Milestone 15. DecisionRecommendationStatus enum -- the recommendation's lifecycle status, not to be confused with any order/quotation/claim status above. */
  showRecommendationStatus?: boolean;
  statusFilter?: StatusFilterConfig;
}) {
  const get = (key: string) => searchParams[key] ?? "";

  return (
    <form method="GET" action={viewAction} className="mb-6 rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-[#496A42]">
        <Filter size={14} />
        Filters
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Field label="From">
          <input type="date" name="dateFrom" defaultValue={get("dateFrom")} className={FIELD_INPUT_CLASS} />
        </Field>

        <Field label="To">
          <input type="date" name="dateTo" defaultValue={get("dateTo")} className={FIELD_INPUT_CLASS} />
        </Field>

        {showCustomer && (
          <Field label="Customer">
            <select name="customerId" defaultValue={get("customerId")} className={FIELD_INPUT_CLASS}>
              <option value="">All customers</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {showSalesperson && (
          <Field label="Salesperson">
            <select name="salespersonId" defaultValue={get("salespersonId")} className={FIELD_INPUT_CLASS}>
              <option value="">All salespeople</option>
              {salespeople.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {showProduct && (
          <Field label="Product ID" hint="Exact SAP item ID -- no search yet">
            <input type="text" name="productId" defaultValue={get("productId")} placeholder="e.g. clxyz..." className={FIELD_INPUT_CLASS} />
          </Field>
        )}

        {showCurrency && (
          <Field label="Currency" hint="3-letter code, e.g. USD">
            <input
              type="text"
              name="currency"
              defaultValue={get("currency")}
              placeholder="USD"
              maxLength={3}
              className={`${FIELD_INPUT_CLASS} uppercase`}
            />
          </Field>
        )}

        {showSapItemCode && (
          <Field label="SAP item code" hint="Exact match">
            <input type="text" name="sapItemCode" defaultValue={get("sapItemCode")} placeholder="e.g. 10001234" className={FIELD_INPUT_CLASS} />
          </Field>
        )}

        {showProductCategory && (
          <Field label="Product category" hint="Free text, exact match -- no fixed list">
            <input type="text" name="productCategory" defaultValue={get("productCategory")} className={FIELD_INPUT_CLASS} />
          </Field>
        )}

        {showProductSearch && (
          <Field label="Search products" hint="SAP item code or description">
            <input type="text" name="productSearch" defaultValue={get("productSearch")} className={FIELD_INPUT_CLASS} />
          </Field>
        )}

        {showDecisionCategory && (
          <Field label="Decision category">
            <select name="decisionCategory" defaultValue={get("decisionCategory")} className={FIELD_INPUT_CLASS}>
              <option value="">All categories</option>
              {DECISION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {DECISION_CATEGORY_LABELS[c] ?? c}
                </option>
              ))}
            </select>
          </Field>
        )}

        {showPriority && (
          <Field label="Priority">
            <select name="priority" defaultValue={get("priority")} className={FIELD_INPUT_CLASS}>
              <option value="">All priorities</option>
              {DECISION_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {DECISION_PRIORITY_LABELS[p] ?? p}
                </option>
              ))}
            </select>
          </Field>
        )}

        {showRecommendationStatus && (
          <Field label="Recommendation status">
            <select name="recommendationStatus" defaultValue={get("recommendationStatus")} className={FIELD_INPUT_CLASS}>
              <option value="">All statuses</option>
              {DECISION_RECOMMENDATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {DECISION_RECOMMENDATION_STATUS_LABELS[s] ?? s}
                </option>
              ))}
            </select>
          </Field>
        )}

        {statusFilter && (
          <Field label={statusFilter.label}>
            <select name={statusFilter.queryKey} defaultValue={get(statusFilter.queryKey)} className={FIELD_INPUT_CLASS}>
              <option value="">All statuses</option>
              {statusFilter.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Demo data">
          <label className="flex h-[38px] items-center gap-2 text-sm text-[#536158]">
            <input type="checkbox" name="includeDemo" value="true" defaultChecked={get("includeDemo") === "true"} className="h-4 w-4 rounded border-gray-300" />
            Include demo records
          </label>
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#EEF1ED] pt-4">
        <button type="submit" className="flex h-10 items-center gap-2 rounded-xl bg-[#183B2D] px-4 text-sm font-semibold text-white transition hover:bg-[#24513D]">
          Apply filters
        </button>
        <a href={viewAction} className="text-sm font-semibold text-[#718078] hover:text-[#17251E]">
          Reset
        </a>
        {exportAction && (
          <button
            type="submit"
            formAction={exportAction}
            className="ml-auto flex h-10 items-center gap-2 rounded-xl border border-[#D7E0D5] px-4 text-sm font-semibold text-[#17251E] transition hover:bg-gray-50"
          >
            <Download size={15} />
            Export CSV
          </button>
        )}
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[#718078]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-[#A6AFA4]">{hint}</span>}
    </label>
  );
}
