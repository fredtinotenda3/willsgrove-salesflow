import { Download, Filter } from "lucide-react";
import { DatePicker } from "../../components/date-picker";
import { FormSelect } from "../../components/form-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FilterOption } from "@/lib/reporting/filter-options";
import { DECISION_CATEGORIES, DECISION_PRIORITIES, DECISION_RECOMMENDATION_STATUSES } from "@/lib/reporting/decision-types";
import { LOST_SALE_REASON_LABELS, LOST_SALE_SOURCE_VALUES, LOST_SALE_SOURCE_LABELS } from "@/lib/lost-sales/display";

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

const FIELD_INPUT_CLASS = "h-9 text-sm md:text-sm";

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
  queryKey:
    | "orderStatus"
    | "quotationStatus"
    | "fulfilmentStatus"
    | "claimStatus"
    | "communicationStatus"
    | "lostSalesReason"
    // Additional Implementation Requirements (spec section 3). Reuses
    // the same generic one-status-dropdown slot every other report
    // already uses, rather than adding yet another show-flag -- see
    // this type's own existing entries for the precedent.
    | "unfulfilledDemandStatus";
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
  showLostSalesReason = false,
  showLostSaleSource = false,
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
  /**
   * Additional Implementation Requirements (spec section 3). LostSaleReason
   * enum, as its own dropdown rather than through the single `statusFilter`
   * slot -- the lost-sales analytics page needs BOTH this and
   * unfulfilledDemandStatus (via `statusFilter`) filterable at once, which
   * the one-slot `statusFilter` mechanism can't express alone. Other pages
   * (e.g. app/reports/sales-performance/page.tsx) that only need
   * lostSalesReason continue to pass it through `statusFilter` as before --
   * this is a new, additive option, not a replacement for that usage.
   */
  showLostSalesReason?: boolean;
  /**
   * Follow-up fix ("add source filters" for the consolidated lost-sales
   * view). LostSaleSource ("SHORTAGE" | "RETURNED_PRODUCT"), its own
   * dedicated dropdown for the exact same reason showLostSalesReason's
   * own comment gives above: the lost-sales analytics page needs this
   * AND unfulfilledDemandStatus (via `statusFilter`) AND
   * lostSalesReason filterable at once, so this gets its own slot
   * rather than overloading `statusFilter`.
   */
  showLostSaleSource?: boolean;
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
        {/* shadcn calendar + popover; hidden inputs keep this a plain GET form. Not wrapped in <label> (a label would re-dispatch clicks to the trigger). */}
        <div className="block">
          <Label className="mb-1.5 block text-xs font-medium text-[#718078]">From</Label>
          <DatePicker name="dateFrom" defaultValue={get("dateFrom")} placeholder="From" aria-label="From date" />
        </div>

        <div className="block">
          <Label className="mb-1.5 block text-xs font-medium text-[#718078]">To</Label>
          <DatePicker name="dateTo" defaultValue={get("dateTo")} placeholder="To" aria-label="To date" />
        </div>

        {showCustomer && (
          <Field label="Customer">
            <FormSelect name="customerId" defaultValue={get("customerId")} options={[{ value: "", label: "All customers" }, ...customers.map((c) => ({ value: c.id, label: c.name }))]} className="h-9 w-full text-sm" />
          </Field>
        )}

        {showSalesperson && (
          <Field label="Salesperson">
            <FormSelect name="salespersonId" defaultValue={get("salespersonId")} options={[{ value: "", label: "All salespeople" }, ...salespeople.map((s) => ({ value: s.id, label: s.name }))]} className="h-9 w-full text-sm" />
          </Field>
        )}

        {showProduct && (
          <Field label="Product ID" hint="Exact SAP item ID -- no search yet">
            <Input type="text" name="productId" defaultValue={get("productId")} placeholder="e.g. clxyz..." className={FIELD_INPUT_CLASS} />
          </Field>
        )}

        {showCurrency && (
          <Field label="Currency" hint="3-letter code, e.g. USD">
            <Input
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
            <Input type="text" name="sapItemCode" defaultValue={get("sapItemCode")} placeholder="e.g. 10001234" className={FIELD_INPUT_CLASS} />
          </Field>
        )}

        {showProductCategory && (
          <Field label="Product category" hint="Free text, exact match -- no fixed list">
            <Input type="text" name="productCategory" defaultValue={get("productCategory")} className={FIELD_INPUT_CLASS} />
          </Field>
        )}

        {showProductSearch && (
          <Field label="Search products" hint="SAP item code or description">
            <Input type="text" name="productSearch" defaultValue={get("productSearch")} className={FIELD_INPUT_CLASS} />
          </Field>
        )}

        {showDecisionCategory && (
          <Field label="Decision category">
            <FormSelect name="decisionCategory" defaultValue={get("decisionCategory")} options={[{ value: "", label: "All categories" }, ...DECISION_CATEGORIES.map((c) => ({ value: c, label: DECISION_CATEGORY_LABELS[c] ?? c }))]} className="h-9 w-full text-sm" />
          </Field>
        )}

        {showPriority && (
          <Field label="Priority">
            <FormSelect name="priority" defaultValue={get("priority")} options={[{ value: "", label: "All priorities" }, ...DECISION_PRIORITIES.map((p) => ({ value: p, label: DECISION_PRIORITY_LABELS[p] ?? p }))]} className="h-9 w-full text-sm" />
          </Field>
        )}

        {showRecommendationStatus && (
          <Field label="Recommendation status">
            <FormSelect name="recommendationStatus" defaultValue={get("recommendationStatus")} options={[{ value: "", label: "All statuses" }, ...DECISION_RECOMMENDATION_STATUSES.map((s) => ({ value: s, label: DECISION_RECOMMENDATION_STATUS_LABELS[s] ?? s }))]} className="h-9 w-full text-sm" />
          </Field>
        )}

        {showLostSalesReason && (
          <Field label="Loss reason">
            <FormSelect name="lostSalesReason" defaultValue={get("lostSalesReason")} options={[{ value: "", label: "All reasons" }, ...Object.keys(LOST_SALE_REASON_LABELS).map((value) => ({ value: value, label: LOST_SALE_REASON_LABELS[value] }))]} className="h-9 w-full text-sm" />
          </Field>
        )}

        {showLostSaleSource && (
          <Field label="Loss source">
            <FormSelect name="lostSaleSource" defaultValue={get("lostSaleSource")} options={[{ value: "", label: "All sources" }, ...LOST_SALE_SOURCE_VALUES.map((value) => ({ value: value, label: LOST_SALE_SOURCE_LABELS[value] }))]} className="h-9 w-full text-sm" />
          </Field>
        )}

        {statusFilter && (
          <Field label={statusFilter.label}>
            <FormSelect name={statusFilter.queryKey} defaultValue={get(statusFilter.queryKey)} options={[{ value: "", label: "All statuses" }, ...statusFilter.options.map((o) => ({ value: o.value, label: o.label }))]} className="h-9 w-full text-sm" />
          </Field>
        )}

        <Field label="Demo data">
          <Label className="flex h-9 items-center gap-2 text-sm font-normal text-[#536158]">
            <Checkbox name="includeDemo" value="true" defaultChecked={get("includeDemo") === "true"} />
            Include demo records
          </Label>
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#EEF1ED] pt-4">
        <Button type="submit" className="bg-[#183B2D] hover:bg-[#24513D]">
          Apply filters
        </Button>
        <Button asChild variant="link" className="text-[#718078] hover:text-[#17251E]">
          <a href={viewAction}>Reset</a>
        </Button>
        {exportAction && (
          <Button type="submit" variant="outline" formAction={exportAction} className="ml-auto">
            <Download size={15} />
            Export CSV
          </Button>
        )}
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <Label className="mb-1.5 block text-xs font-medium text-[#718078]">{label}</Label>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-[#A6AFA4]">{hint}</span>}
    </div>
  );
}
