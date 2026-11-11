import "server-only";
import type { SapProductRow } from "@/lib/sap-product-csv";
import type { CustomerMasterRow } from "@/lib/sap-customer-master-csv";
import type { GroupedInvoiceHeader, RawInvoiceLineRow } from "@/lib/invoice-reconciliation/csv";
import type { GroupedCreditNoteRow, RawCreditNoteRow } from "@/lib/returns-credits/csv";
import type { SapLiveCredentials } from "@/lib/integrations/sap/config";
import { sanitizeSapErrorMessage } from "@/lib/integrations/sap/config";
import {
  SapAdapterError,
  type SapAdapter,
  type SapConnectionHealth,
  type SapErrorCategory,
  type SapSalesOrderLookupResult,
  type SapSalesOrderResult,
  type SapSalesOrderSubmission,
} from "@/lib/integrations/sap/types";

/**
 * Milestone 9 (SAP Business One Integration). The real adapter --
 * targets SAP Business One's Service Layer REST API (spec section 5's
 * "Service-Layer-preferred" strategy).
 *
 * **UNVERIFIED AGAINST A REAL TENANT.** Everything in this file is
 * implemented against SAP's own PUBLICLY PUBLISHED Service Layer object
 * model (the `Items`, `ItemGroups`, `BusinessPartners`, `Orders`,
 * `Invoices` and `CreditNotes` resources, and their commonly documented
 * fields such as `ItemCode`, `CardCode`, `DocEntry`, `DocNum`, `NumAtCard`,
 * `DocumentLines`) -- never against Willsgrove's actual Bulawayo-hosted
 * company database, which this project has never had credentials or
 * network access to (spec sections 1 and 4's explicit prohibition on
 * guessing real SAP credentials/endpoints/company-DB details). Treat
 * every field mapping below as a documented, reasonable-faith starting
 * point that MUST be checked against the real tenant during the
 * "environment configuration, connection verification, authorised
 * testing" phase the spec's final engineering standard describes --
 * never as something already confirmed to work. See
 * docs/sap-integration/discovery-checklist.md for the exact items that
 * still need Bulawayo's confirmation before this adapter can honestly be
 * called REAL-SAP-TESTED (spec section 14's testing-claim distinction).
 *
 * Specific points flagged as unverified inline, not just here:
 *   - Idempotent duplicate-submission detection (spec section 7.2) has
 *     no universally-documented Service Layer mechanism; this adapter's
 *     best available substitute is filtering Orders by the standard
 *     NumAtCard ("customer reference") field, NOT a true idempotency
 *     key. If the real tenant exposes a custom field (a UDF) suited to
 *     this, switching to it is a safer follow-up once confirmed -- see
 *     createSalesOrder's and findSalesOrderByExternalReference's own
 *     comments.
 *   - BusinessPartners' branch/store code and price-list/payment-terms
 *     CODE (as opposed to SAP's own internal numeric IDs for those) are
 *     commonly implemented as User-Defined Fields specific to each SAP
 *     installation; this adapter does not guess a UDF name that doesn't
 *     exist in this project's inspected codebase or spec, and returns
 *     null for those rather than fabricate a mapping.
 *   - Session lifetime (B1SESSION cookie expiry) is commonly ~30 minutes
 *     but is itself a per-installation Service Layer configuration
 *     value; this adapter re-authenticates reactively on a 401 rather
 *     than assuming any specific lifetime.
 */

const SESSION_REUSE_WINDOW_MS = 25 * 60 * 1000; // conservative vs. the commonly-documented ~30 min default
const REQUEST_TIMEOUT_MS = 30_000;

interface SapSession {
  cookie: string;
  establishedAt: number;
}

/** Raw Service Layer error body shape, per SAP's own documented
 * convention: { "error": { "code": number, "message": { "lang": "en-us",
 * "value": string } } }. */
interface ServiceLayerErrorBody {
  error?: { code?: number; message?: { value?: string } };
}

export class ServiceLayerAdapter implements SapAdapter {
  private session: SapSession | null = null;

  constructor(private readonly credentials: SapLiveCredentials) {}

  private sanitize(message: string): string {
    return sanitizeSapErrorMessage(message, this.credentials);
  }

  private async login(): Promise<SapSession> {
    const url = `${this.credentials.baseUrl.replace(/\/+$/, "")}/Login`;
    let response: Response;
    try {
      response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          CompanyDB: this.credentials.companyDb,
          UserName: this.credentials.username,
          Password: this.credentials.password,
        }),
      });
    } catch (cause) {
      if (cause instanceof SapAdapterError) throw new SapAdapterError(cause.category, this.sanitize(cause.message), { retryable: cause.retryable, cause });
      throw new SapAdapterError("NETWORK_UNAVAILABLE", this.sanitize(describeNetworkError(cause)), { cause });
    }

    if (!response.ok) {
      const category = response.status === 401 || response.status === 403 ? "AUTHENTICATION_FAILURE" : categoryForStatus(response.status);
      const message = await extractErrorMessage(response);
      throw new SapAdapterError(category, this.sanitize(`SAP Service Layer login failed: ${message}`));
    }

    const cookie = extractSessionCookie(response);
    if (!cookie) {
      throw new SapAdapterError(
        "INTERNAL_ERROR",
        "SAP Service Layer login succeeded but returned no session cookie -- unexpected response shape, needs investigation against the real tenant."
      );
    }

    const session: SapSession = { cookie, establishedAt: Date.now() };
    this.session = session;
    return session;
  }

  private async ensureSession(): Promise<SapSession> {
    if (this.session && Date.now() - this.session.establishedAt < SESSION_REUSE_WINDOW_MS) {
      return this.session;
    }
    return this.login();
  }

  /** Core request helper: ensures a session, attaches it, retries once
   * on a 401 (session expired server-side earlier than our own reuse
   * window assumed), and maps every failure to a SapErrorCategory. */
  private async request<T>(path: string, init: RequestInit = {}, options?: { forceRelogin?: boolean }): Promise<T> {
    if (options?.forceRelogin) this.session = null;
    const session = await this.ensureSession();
    const url = `${this.credentials.baseUrl.replace(/\/+$/, "")}${path}`;

    let response: Response;
    try {
      response = await fetchWithTimeout(url, {
        ...init,
        headers: { "Content-Type": "application/json", Cookie: session.cookie, ...(init.headers ?? {}) },
      });
    } catch (cause) {
      if (cause instanceof SapAdapterError) throw new SapAdapterError(cause.category, this.sanitize(cause.message), { retryable: cause.retryable, cause });
      throw new SapAdapterError("NETWORK_UNAVAILABLE", this.sanitize(describeNetworkError(cause)), { cause });
    }

    if (response.status === 401 && !options?.forceRelogin) {
      // Session expired server-side sooner than SESSION_REUSE_WINDOW_MS
      // assumed -- re-authenticate once and retry, rather than failing
      // a request that has nothing actually wrong with it.
      return this.request<T>(path, init, { forceRelogin: true });
    }

    if (!response.ok) {
      const category = categoryForStatus(response.status);
      const message = await extractErrorMessage(response);
      throw new SapAdapterError(category, this.sanitize(message));
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async testConnection(): Promise<SapConnectionHealth> {
    try {
      await this.request<unknown>("/Items?$top=1&$select=ItemCode", { method: "GET" }, { forceRelogin: true });
      return { ok: true, checkedAt: new Date().toISOString(), message: "Connected to SAP Service Layer and authenticated successfully." };
    } catch (error) {
      if (error instanceof SapAdapterError) {
        return { ok: false, checkedAt: new Date().toISOString(), message: error.message, category: error.category };
      }
      return { ok: false, checkedAt: new Date().toISOString(), message: this.sanitize(String(error)), category: "INTERNAL_ERROR" };
    }
  }

  async getConnectionHealth(): Promise<SapConnectionHealth> {
    return this.testConnection();
  }

  async fetchProducts(): Promise<SapProductRow[]> {
    // ItemsGroupCode is a numeric FK into ItemGroups, not a display name
    // -- resolve it via a second call so SapProductRow.category is a
    // name, consistent with what the Milestone 1 CSV import produces
    // from an "ITEM GROUP" column. Unverified: whether ItemGroups is
    // readable by the credentials Bulawayo ultimately grants.
    const [itemsResult, groupsResult] = await Promise.all([
      this.request<{ value: SapItemRaw[] }>(
        "/Items?$select=ItemCode,ItemName,BarCode,ItemsGroupCode",
        { method: "GET" }
      ),
      this.request<{ value: SapItemGroupRaw[] }>("/ItemGroups?$select=Number,GroupName", { method: "GET" }).catch(
        () => ({ value: [] as SapItemGroupRaw[] })
      ),
    ]);

    const groupNameByCode = new Map(groupsResult.value.map((g) => [g.Number, g.GroupName]));

    return itemsResult.value.map((item): SapProductRow => ({
      sapItemCode: item.ItemCode,
      itemName: item.ItemName ?? "",
      barcode: isPlausibleBarcode(item.BarCode) ? item.BarCode! : null,
      category: (item.ItemsGroupCode !== undefined ? groupNameByCode.get(item.ItemsGroupCode) : undefined) ?? null,
      sourceData: {
        CODE: item.ItemCode,
        "ITEM DESCRIPTION": item.ItemName ?? "",
        BARCODE: item.BarCode ?? "",
        "ITEM GROUP": String(item.ItemsGroupCode ?? ""),
      },
    }));
  }

  async fetchCustomers(): Promise<CustomerMasterRow[]> {
    const result = await this.request<{ value: SapBusinessPartnerRaw[] }>(
      "/BusinessPartners?$filter=CardType eq 'cCustomer'&$select=CardCode,CardName,FederalTaxID,Currency,CreditLimit,Phone1,EmailAddress,ContactPerson,BPAddresses",
      { method: "GET" }
    );

    return result.value.map((bp): CustomerMasterRow => {
      const billToAddress = bp.BPAddresses?.find((a) => a.AddressType === "bo_BillTo") ?? bp.BPAddresses?.[0];
      return {
        customerCode: bp.CardCode,
        customerName: bp.CardName ?? "",
        tin: bp.FederalTaxID ?? null,
        // Unverified: VAT registration number is commonly a separate
        // field/UDF per installation (not FederalTaxID, which Service
        // Layer documents as the tax ID / TIN); left null rather than
        // guessed.
        vatNumber: null,
        currencyCode: bp.Currency ?? null,
        // Unverified: price-list CODE (vs. SAP's internal numeric
        // PriceList id) and payment-terms CODE are installation-specific
        // -- left null rather than fabricated from a numeric id.
        priceListCode: null,
        paymentTermsCode: null,
        // Unverified: branch/store code -- Willsgrove-specific concepts
        // with no standard Service Layer field; almost certainly a UDF
        // once Bulawayo confirms one exists.
        branchCode: null,
        storeCode: null,
        creditLimit: bp.CreditLimit !== undefined ? String(bp.CreditLimit) : null,
        creditHold: false, // Unverified: SAP's own field for this (Frozen) was not in the $select above pending confirmation it means the same thing as SalesFlow's "credit hold"
        addressLine1: billToAddress?.Street ?? null,
        city: billToAddress?.City ?? null,
        phone: bp.Phone1 ?? null,
        email: bp.EmailAddress ?? null,
        contactName: bp.ContactPerson ?? null,
        contactEmail: bp.EmailAddress ?? null,
        contactPhone: bp.Phone1 ?? null,
        sourceData: { CardCode: bp.CardCode, CardName: bp.CardName ?? "" },
      };
    });
  }

  async fetchInvoices(since?: Date): Promise<GroupedInvoiceHeader[]> {
    const filter = since ? `?$filter=DocDate ge '${since.toISOString().slice(0, 10)}'` : "";
    const result = await this.request<{ value: SapInvoiceRaw[] }>(`/Invoices${filter}`, { method: "GET" });
    return result.value.map(mapInvoiceToGroupedHeader);
  }

  async fetchCreditNotes(since?: Date): Promise<GroupedCreditNoteRow[]> {
    const filter = since ? `?$filter=DocDate ge '${since.toISOString().slice(0, 10)}'` : "";
    const result = await this.request<{ value: SapCreditNoteRaw[] }>(`/CreditNotes${filter}`, { method: "GET" });
    return result.value.map(mapCreditNoteToGroupedRow);
  }

  async createSalesOrder(submission: SapSalesOrderSubmission): Promise<SapSalesOrderResult> {
    // Unverified duplicate guard: Service Layer has no universally
    // documented native idempotency-key mechanism, so this checks for a
    // prior order carrying the same NumAtCard first. This is weaker than
    // the mock adapter's true idempotencyKey lookup and weaker than the
    // actual safety net this milestone relies on (IntegrationOperation's
    // own @unique columns at the SalesFlow database level) -- it exists
    // only to avoid an obviously duplicate SAP-side document when
    // retrying a request that may have already succeeded.
    const existing = await this.findSalesOrderByExternalReference(submission.idempotencyKey, submission.customerOrderReference);
    if (existing) return existing;

    const body = {
      CardCode: submission.sapCustomerCode,
      DocDate: submission.documentDate,
      NumAtCard: submission.customerOrderReference,
      DocCurrency: submission.currency,
      DocumentLines: submission.lines.map((line) => ({
        LineNum: line.lineNumber,
        ItemCode: line.sapItemCode,
        Quantity: Number(line.quantity),
        Price: Number(line.unitPrice),
      })),
    };

    const created = await this.request<SapOrderRaw>("/Orders", { method: "POST", body: JSON.stringify(body) });
    return { sapDocEntry: String(created.DocEntry), sapDocNum: String(created.DocNum), documentDate: created.DocDate ?? submission.documentDate };
  }

  async findSalesOrderByExternalReference(_idempotencyKey: string, customerOrderReference: string): Promise<SapSalesOrderLookupResult> {
    const escaped = customerOrderReference.replace(/'/g, "''");
    const result = await this.request<{ value: SapOrderRaw[] }>(
      `/Orders?$filter=NumAtCard eq '${escaped}'&$select=DocEntry,DocNum,DocDate`,
      { method: "GET" }
    );
    const match = result.value[0];
    if (!match) return null;
    return { sapDocEntry: String(match.DocEntry), sapDocNum: String(match.DocNum), documentDate: match.DocDate ?? "" };
  }

  async getSalesOrder(sapDocEntry: string): Promise<SapSalesOrderLookupResult> {
    try {
      const order = await this.request<SapOrderRaw>(`/Orders(${encodeURIComponent(sapDocEntry)})`, { method: "GET" });
      return { sapDocEntry: String(order.DocEntry), sapDocNum: String(order.DocNum), documentDate: order.DocDate ?? "" };
    } catch (error) {
      if (error instanceof SapAdapterError && error.category === "VALIDATION_FAILURE") return null;
      throw error;
    }
  }

  async getInvoice(sapDocEntry: string): Promise<GroupedInvoiceHeader | null> {
    try {
      const invoice = await this.request<SapInvoiceRaw>(`/Invoices(${encodeURIComponent(sapDocEntry)})`, { method: "GET" });
      return mapInvoiceToGroupedHeader(invoice);
    } catch (error) {
      if (error instanceof SapAdapterError && error.category === "VALIDATION_FAILURE") return null;
      throw error;
    }
  }

  async getCreditNote(sapDocEntry: string): Promise<GroupedCreditNoteRow | null> {
    try {
      const note = await this.request<SapCreditNoteRaw>(`/CreditNotes(${encodeURIComponent(sapDocEntry)})`, { method: "GET" });
      return mapCreditNoteToGroupedRow(note);
    } catch (error) {
      if (error instanceof SapAdapterError && error.category === "VALIDATION_FAILURE") return null;
      throw error;
    }
  }
}

// --- Raw Service Layer response shapes (unverified field presence --
// documented public object model only) ---------------------------------

interface SapItemRaw {
  ItemCode: string;
  ItemName?: string;
  BarCode?: string;
  ItemsGroupCode?: number;
}
interface SapItemGroupRaw {
  Number: number;
  GroupName: string;
}
interface SapBpAddressRaw {
  AddressType?: string;
  Street?: string;
  City?: string;
}
interface SapBusinessPartnerRaw {
  CardCode: string;
  CardName?: string;
  FederalTaxID?: string;
  Currency?: string;
  CreditLimit?: number;
  Phone1?: string;
  EmailAddress?: string;
  ContactPerson?: string;
  BPAddresses?: SapBpAddressRaw[];
}
interface SapDocumentLineRaw {
  LineNum?: number;
  ItemCode?: string;
  ItemDescription?: string;
  Quantity?: number;
  UnitMsr?: string;
  Price?: number;
  DiscountPercent?: number;
  VatGroup?: string;
  LineTotal?: number;
  BaseEntry?: number;
  BaseLine?: number;
}
interface SapInvoiceRaw {
  DocEntry: number;
  DocNum: number;
  CardCode?: string;
  CardName?: string;
  DocDate?: string;
  DocCurrency?: string;
  DocumentStatus?: string;
  Cancelled?: string;
  NumAtCard?: string;
  DocTotal?: number;
  VatSum?: number;
  DocumentLines?: SapDocumentLineRaw[];
}
interface SapCreditNoteRaw {
  DocEntry: number;
  DocNum: number;
  DocDate?: string;
  DocCurrency?: string;
  DocTotal?: number;
  Comments?: string;
  DocumentLines?: SapDocumentLineRaw[];
}
interface SapOrderRaw {
  DocEntry: number;
  DocNum: number;
  DocDate?: string;
}

const CANCELLED_STATUS_KEYWORDS = ["cancel", "cancelled", "canceled", "void", "voided", "reversed", "reversal"];

function mapInvoiceToGroupedHeader(raw: SapInvoiceRaw): GroupedInvoiceHeader {
  const docEntry = String(raw.DocEntry);
  const docNum = String(raw.DocNum);
  const statusText = raw.DocumentStatus ?? "";
  const isCancelledOrReversed = raw.Cancelled === "tYES" || CANCELLED_STATUS_KEYWORDS.some((kw) => statusText.toLowerCase().includes(kw));

  const lines: RawInvoiceLineRow[] = (raw.DocumentLines ?? []).map((line, index) => ({
    rowIndex: index + 1,
    docEntry,
    docNum,
    customerCode: raw.CardCode ?? null,
    customerName: raw.CardName ?? null,
    invoiceDate: raw.DocDate ?? null,
    currency: raw.DocCurrency ?? null,
    documentStatus: raw.DocumentStatus ?? null,
    orderReference: raw.NumAtCard ?? null,
    subtotal: raw.DocTotal !== undefined && raw.VatSum !== undefined ? String(raw.DocTotal - raw.VatSum) : null,
    taxTotal: raw.VatSum !== undefined ? String(raw.VatSum) : null,
    total: raw.DocTotal !== undefined ? String(raw.DocTotal) : null,
    lineNumber: line.LineNum !== undefined ? String(line.LineNum) : null,
    itemCode: line.ItemCode ?? null,
    itemDescription: line.ItemDescription ?? null,
    quantity: line.Quantity !== undefined ? String(line.Quantity) : null,
    unitOfMeasure: line.UnitMsr ?? null,
    unitPrice: line.Price !== undefined ? String(line.Price) : null,
    discount: line.DiscountPercent !== undefined ? String(line.DiscountPercent) : null,
    taxCode: line.VatGroup ?? null,
    lineTotal: line.LineTotal !== undefined ? String(line.LineTotal) : null,
    docLineNum: line.LineNum !== undefined ? String(line.LineNum) : null,
    rawSourceData: {},
  }));

  return {
    groupKey: `docEntry:${docEntry}`,
    docEntry,
    docNum,
    customerCode: raw.CardCode ?? null,
    customerName: raw.CardName ?? null,
    invoiceDate: raw.DocDate ?? null,
    currency: raw.DocCurrency ?? null,
    documentStatus: raw.DocumentStatus ?? null,
    orderReference: raw.NumAtCard ?? null,
    subtotal: raw.DocTotal !== undefined && raw.VatSum !== undefined ? String(raw.DocTotal - raw.VatSum) : null,
    taxTotal: raw.VatSum !== undefined ? String(raw.VatSum) : null,
    total: raw.DocTotal !== undefined ? String(raw.DocTotal) : null,
    isCancelledOrReversed,
    lines,
    firstRowSourceData: {},
  };
}

function mapCreditNoteToGroupedRow(raw: SapCreditNoteRaw): GroupedCreditNoteRow {
  const docEntry = String(raw.DocEntry);
  const docNum = String(raw.DocNum);
  // BaseEntry/BaseLine on the first line is the Service-Layer-documented
  // way a credit note references its base invoice -- unverified whether
  // Willsgrove's actual credit notes are always base-document-linked in
  // practice (spec section 12 already anticipates manual-override cases
  // this project's own existing returns-credits matching logic handles).
  const baseEntry = raw.DocumentLines?.[0]?.BaseEntry;

  const rows: RawCreditNoteRow[] = (raw.DocumentLines ?? []).map((_line, index) => ({
    rowIndex: index + 1,
    docEntry,
    docNum,
    baseInvoiceDocEntry: baseEntry !== undefined ? String(baseEntry) : null,
    baseInvoiceDocNum: null, // Unverified: Service Layer gives BaseEntry (an invoice DocEntry), not that invoice's DocNum, without a second lookup this adapter does not perform speculatively
    creditNoteDate: raw.DocDate ?? null,
    currency: raw.DocCurrency ?? null,
    amount: raw.DocTotal !== undefined ? String(raw.DocTotal) : null,
    notes: raw.Comments ?? null,
    rawSourceData: {},
  }));

  return {
    groupKey: `docEntry:${docEntry}`,
    docEntry,
    docNum,
    baseInvoiceDocEntry: baseEntry !== undefined ? String(baseEntry) : null,
    baseInvoiceDocNum: null,
    creditNoteDate: raw.DocDate ?? null,
    currency: raw.DocCurrency ?? null,
    amount: raw.DocTotal !== undefined ? String(raw.DocTotal) : null,
    notes: raw.Comments ?? null,
    rows,
    firstRowSourceData: {},
  };
}

function isPlausibleBarcode(value: string | undefined): boolean {
  return !!value && /^\d+$/.test(value);
}

function extractSessionCookie(response: Response): string | null {
  // Service Layer sets B1SESSION (and often ROUTEID, required when
  // behind a load balancer -- unverified whether Willsgrove's
  // deployment is load-balanced). Forward whatever Set-Cookie values
  // were received verbatim rather than reconstructing a cookie string by
  // hand, which is the only way to be correct in both cases.
  const raw = response.headers.get("set-cookie");
  if (!raw) return null;
  // A single Headers.get("set-cookie") can only return one combined
  // string in most fetch implementations when multiple Set-Cookie
  // headers were sent; getSetCookie() (Node 20+, Next.js's underlying
  // fetch) returns each separately when available.
  const headersWithGetSetCookie = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = typeof headersWithGetSetCookie.getSetCookie === "function" ? headersWithGetSetCookie.getSetCookie() : [raw];
  const pairs = values.map((v) => v.split(";")[0]).filter(Boolean);
  return pairs.length > 0 ? pairs.join("; ") : null;
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ServiceLayerErrorBody;
    const value = body.error?.message?.value;
    if (value) return `SAP Service Layer error ${body.error?.code ?? response.status}: ${value}`;
  } catch {
    // Response body wasn't JSON (or was empty) -- fall through to the
    // plain HTTP status, which is still informative.
  }
  return `SAP Service Layer returned HTTP ${response.status} ${response.statusText}`;
}

function categoryForStatus(status: number): SapErrorCategory {
  if (status === 401 || status === 403) return "PERMISSION_DENIED";
  // 404 ("no document with this DocEntry") is mapped to VALIDATION_FAILURE
  // rather than a dedicated NOT_FOUND category -- the adapter contract's
  // SapErrorCategory union (lib/integrations/sap/types.ts) has none, and
  // the single-document lookups that can legitimately 404
  // (getSalesOrder/getInvoice/getCreditNote) already catch exactly this
  // category to return null instead of throwing -- see their own code.
  if (status === 400 || status === 404 || status === 422) return "VALIDATION_FAILURE";
  if (status === 409) return "DUPLICATE_EXTERNAL_REFERENCE";
  if (status === 503 || status === 502 || status === 504) return "SERVICE_UNAVAILABLE";
  if (status === 408) return "TIMEOUT";
  return "INTERNAL_ERROR";
}

function describeNetworkError(cause: unknown): string {
  if (cause instanceof DOMException && cause.name === "AbortError") {
    return `SAP Service Layer request timed out after ${REQUEST_TIMEOUT_MS}ms -- whether SAP received and processed the request cannot be determined from this failure alone.`;
  }
  return `Could not reach SAP Service Layer: ${cause instanceof Error ? cause.message : String(cause)}`;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new SapAdapterError("TIMEOUT", describeNetworkError(cause), { cause });
    }
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}
