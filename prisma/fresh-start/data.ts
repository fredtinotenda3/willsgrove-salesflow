/**
 * Showcase data for `npm run db:fresh-start`. Pure data -- no database
 * access -- so it can be read and edited safely. Everything here is
 * fictional and written as REAL rows (isDemo = false) so every screen,
 * report and chart (which exclude demo rows by default) shows it.
 */

export const TAX_CODES = [
  { code: "VAT15", description: "Standard-rated VAT (15%)", ratePercent: "15.00" },
  { code: "ZERO", description: "Zero-rated", ratePercent: "0.00" },
  { code: "EXEMPT", description: "VAT exempt", ratePercent: "0.00" },
] as const;

export type ProductSeed = {
  sapItemCode: string;
  itemName: string;
  barcode: string;
  category: string;
  unitOfMeasure: string;
  packSize: string | null;
  vatCode: "VAT15" | "ZERO" | "EXEMPT";
  /** Wholesale / retail price list unit prices (USD). */
  wholesale: string;
  retail: string;
};

export const PRODUCTS: ProductSeed[] = [
  { sapItemCode: "FRU-0001", itemName: "Apples Royal Gala", barcode: "6001000000011", category: "Fruit", unitOfMeasure: "KG", packSize: null, vatCode: "ZERO", wholesale: "2.10", retail: "2.60" },
  { sapItemCode: "FRU-0002", itemName: "Bananas Cavendish", barcode: "6001000000028", category: "Fruit", unitOfMeasure: "KG", packSize: null, vatCode: "ZERO", wholesale: "1.20", retail: "1.55" },
  { sapItemCode: "FRU-0003", itemName: "Oranges Valencia", barcode: "6001000000035", category: "Fruit", unitOfMeasure: "KG", packSize: null, vatCode: "ZERO", wholesale: "1.40", retail: "1.80" },
  { sapItemCode: "FRU-0004", itemName: "Lemons", barcode: "6001000000042", category: "Fruit", unitOfMeasure: "KG", packSize: null, vatCode: "ZERO", wholesale: "2.40", retail: "3.00" },
  { sapItemCode: "FRU-0005", itemName: "Strawberries Punnet 250g", barcode: "6001000000059", category: "Fruit", unitOfMeasure: "PNT", packSize: "250G", vatCode: "ZERO", wholesale: "1.60", retail: "2.10" },
  { sapItemCode: "FRU-0006", itemName: "Avocados Hass", barcode: "6001000000066", category: "Fruit", unitOfMeasure: "KG", packSize: null, vatCode: "ZERO", wholesale: "3.20", retail: "3.95" },
  { sapItemCode: "VEG-0001", itemName: "Tomatoes Round", barcode: "6001000000073", category: "Vegetables", unitOfMeasure: "KG", packSize: null, vatCode: "ZERO", wholesale: "1.10", retail: "1.45" },
  { sapItemCode: "VEG-0002", itemName: "Onions Brown", barcode: "6001000000080", category: "Vegetables", unitOfMeasure: "KG", packSize: null, vatCode: "ZERO", wholesale: "0.90", retail: "1.20" },
  { sapItemCode: "VEG-0003", itemName: "Potatoes Washed", barcode: "6001000000097", category: "Vegetables", unitOfMeasure: "KG", packSize: null, vatCode: "ZERO", wholesale: "0.85", retail: "1.15" },
  { sapItemCode: "VEG-0004", itemName: "Carrots", barcode: "6001000000103", category: "Vegetables", unitOfMeasure: "KG", packSize: null, vatCode: "ZERO", wholesale: "0.95", retail: "1.25" },
  { sapItemCode: "VEG-0005", itemName: "Cabbage Green", barcode: "6001000000110", category: "Vegetables", unitOfMeasure: "EA", packSize: null, vatCode: "ZERO", wholesale: "0.80", retail: "1.10" },
  { sapItemCode: "VEG-0006", itemName: "Butternut", barcode: "6001000000127", category: "Vegetables", unitOfMeasure: "KG", packSize: null, vatCode: "ZERO", wholesale: "0.90", retail: "1.20" },
  { sapItemCode: "VEG-0007", itemName: "Baby Spinach Bag 200g", barcode: "6001000000134", category: "Vegetables", unitOfMeasure: "EA", packSize: "200G", vatCode: "ZERO", wholesale: "1.30", retail: "1.70" },
  { sapItemCode: "VEG-0008", itemName: "Mixed Peppers Tray", barcode: "6001000000141", category: "Vegetables", unitOfMeasure: "EA", packSize: "3PK", vatCode: "ZERO", wholesale: "1.85", retail: "2.35" },
  { sapItemCode: "PRO-0001", itemName: "Horseradish Pickled Organic 135g", barcode: "6001000000158", category: "Processed", unitOfMeasure: "EA", packSize: "135G", vatCode: "VAT15", wholesale: "2.20", retail: "2.90" },
  { sapItemCode: "PRO-0002", itemName: "Apple Orange Mixed Punnet", barcode: "6001000000165", category: "Processed", unitOfMeasure: "PNT", packSize: null, vatCode: "VAT15", wholesale: "1.75", retail: "2.30" },
  { sapItemCode: "PRO-0003", itemName: "Mango Chutney 400g", barcode: "6001000000172", category: "Processed", unitOfMeasure: "EA", packSize: "400G", vatCode: "VAT15", wholesale: "2.50", retail: "3.20" },
  { sapItemCode: "PRO-0004", itemName: "Peanut Butter Crunchy 410g", barcode: "6001000000189", category: "Processed", unitOfMeasure: "EA", packSize: "410G", vatCode: "VAT15", wholesale: "2.80", retail: "3.60" },
  { sapItemCode: "HRB-0001", itemName: "Fresh Basil Pot", barcode: "6001000000196", category: "Herbs", unitOfMeasure: "EA", packSize: null, vatCode: "ZERO", wholesale: "1.00", retail: "1.40" },
  { sapItemCode: "HRB-0002", itemName: "Fresh Coriander Bunch", barcode: "6001000000202", category: "Herbs", unitOfMeasure: "EA", packSize: null, vatCode: "ZERO", wholesale: "0.50", retail: "0.75" },
];

export const PRICE_LISTS = [
  { code: "WHOLESALE-USD", name: "Wholesale (USD)", currencyCode: "USD", key: "wholesale" as const },
  { code: "RETAIL-USD", name: "Retail Chains (USD)", currencyCode: "USD", key: "retail" as const },
];

export type CustomerSeed = {
  sapCustomerCode: string;
  name: string;
  category: string;
  city: string;
  addressLine1: string;
  email: string;
  phone: string;
  priceList: "WHOLESALE-USD" | "RETAIL-USD";
};

export const CUSTOMERS: CustomerSeed[] = [
  { sapCustomerCode: "C-1001", name: "Greenfield Supermarket Borrowdale", category: "Supermarket", city: "Harare", addressLine1: "Borrowdale Village Shopping Centre", email: "orders.borrowdale@greenfield.example", phone: "+263 242 000 101", priceList: "RETAIL-USD" },
  { sapCustomerCode: "C-1002", name: "Greenfield Supermarket Avondale", category: "Supermarket", city: "Harare", addressLine1: "King George Road, Avondale", email: "orders.avondale@greenfield.example", phone: "+263 242 000 102", priceList: "RETAIL-USD" },
  { sapCustomerCode: "C-1003", name: "Greenfield Supermarket Mutare", category: "Supermarket", city: "Mutare", addressLine1: "Herbert Chitepo Street", email: "orders.mutare@greenfield.example", phone: "+263 202 000 103", priceList: "RETAIL-USD" },
  { sapCustomerCode: "C-2001", name: "Baobab Hotel & Conference Centre", category: "Hospitality", city: "Harare", addressLine1: "12 Samora Machel Avenue", email: "kitchen@baobab.example", phone: "+263 242 000 201", priceList: "WHOLESALE-USD" },
  { sapCustomerCode: "C-2002", name: "Kopje Fresh Market", category: "Wholesale", city: "Bulawayo", addressLine1: "Josiah Tongogara Street", email: "buying@kopjefresh.example", phone: "+263 292 000 202", priceList: "WHOLESALE-USD" },
  { sapCustomerCode: "C-3001", name: "Sunrise Schools Catering", category: "Institutional", city: "Harare", addressLine1: "Mt Pleasant Industrial Park", email: "procurement@sunrise.example", phone: "+263 242 000 301", priceList: "WHOLESALE-USD" },
];

export const PERSONNEL = [
  { name: "Fred Moyo", role: "DRIVER" as const, phone: "+263 77 000 0001" },
  { name: "Tendai Chikafu", role: "DRIVER" as const, phone: "+263 77 000 0002" },
  { name: "Lameck Ncube", role: "DRIVER_ASSISTANT" as const, phone: "+263 77 000 0003" },
  { name: "Joseph Banda", role: "DRIVER_ASSISTANT" as const, phone: "+263 77 000 0004" },
];

export const VEHICLES = [
  { registrationNumber: "ABC1234", notes: "5-tonne refrigerated truck" },
  { registrationNumber: "AEF5678", notes: "3-tonne box truck" },
];

/**
 * Order scenarios. `stage` is how far through the lifecycle the order is
 * taken using the application's own functions. Quantities are per product
 * code; `found` (picking) defaults to the full quantity, `rejected`
 * (delivery) to nothing.
 */
export type ScenarioLine = {
  code: string;
  qty: string;
  /** Picking: quantity actually found (rest is recorded as unavailable). */
  found?: string;
  /** Delivery: quantity rejected on delivery, and why (a standard claim reason key). */
  rejected?: string;
  reason?: "PRICING_DISPUTE" | "QUALITY_ISSUE" | "SHORT_DELIVERY" | "OVERSUPPLY" | "EXPIRED_PRODUCT" | "NO_BARCODE" | "BARCODE_SCANNING_ISSUE" | "DUPLICATE_ENTRY";
};

export type Stage = "RECEIVED" | "PENDING_VERIFICATION" | "APPROVED" | "READY_TO_INVOICE" | "DISPATCHED" | "DELIVERED";

export type OrderScenario = {
  key: string;
  customer: string; // sapCustomerCode
  source: "EMAIL" | "WHATSAPP" | "MANUAL";
  stage: Stage;
  /** How many days ago the order was placed (spreads the trend charts). */
  daysAgo: number;
  lines: ScenarioLine[];
};

export const SCENARIOS: OrderScenario[] = [
  { key: "S01", customer: "C-1001", source: "EMAIL", stage: "RECEIVED", daysAgo: 0, lines: [{ code: "FRU-0001", qty: "40" }, { code: "VEG-0001", qty: "60" }, { code: "HRB-0001", qty: "24" }] },
  { key: "S02", customer: "C-2001", source: "WHATSAPP", stage: "RECEIVED", daysAgo: 0, lines: [{ code: "VEG-0003", qty: "120" }, { code: "VEG-0002", qty: "80" }] },
  { key: "S03", customer: "C-1002", source: "MANUAL", stage: "PENDING_VERIFICATION", daysAgo: 1, lines: [{ code: "FRU-0002", qty: "90" }, { code: "FRU-0005", qty: "48" }] },
  { key: "S04", customer: "C-2002", source: "EMAIL", stage: "PENDING_VERIFICATION", daysAgo: 1, lines: [{ code: "PRO-0003", qty: "36" }, { code: "PRO-0004", qty: "36" }] },
  { key: "S05", customer: "C-3001", source: "EMAIL", stage: "APPROVED", daysAgo: 2, lines: [{ code: "VEG-0004", qty: "70" }, { code: "VEG-0005", qty: "50" }, { code: "VEG-0006", qty: "40" }] },
  { key: "S06", customer: "C-1003", source: "WHATSAPP", stage: "READY_TO_INVOICE", daysAgo: 3, lines: [{ code: "FRU-0003", qty: "60" }, { code: "FRU-0004", qty: "20" }] },
  // Shortages -> automatic lost sales
  { key: "S07", customer: "C-1001", source: "EMAIL", stage: "READY_TO_INVOICE", daysAgo: 5, lines: [{ code: "FRU-0006", qty: "30", found: "18" }, { code: "VEG-0007", qty: "40", found: "40" }, { code: "FRU-0005", qty: "36", found: "20" }] },
  { key: "S08", customer: "C-1002", source: "MANUAL", stage: "READY_TO_INVOICE", daysAgo: 8, lines: [{ code: "FRU-0001", qty: "50", found: "35" }, { code: "VEG-0001", qty: "45", found: "45" }] },
  { key: "S09", customer: "C-2002", source: "EMAIL", stage: "READY_TO_INVOICE", daysAgo: 12, lines: [{ code: "VEG-0008", qty: "30", found: "12" }, { code: "HRB-0002", qty: "60", found: "60" }] },
  { key: "S10", customer: "C-2001", source: "WHATSAPP", stage: "READY_TO_INVOICE", daysAgo: 16, lines: [{ code: "FRU-0002", qty: "100", found: "70" }, { code: "FRU-0003", qty: "80", found: "80" }] },
  // Dispatched, not yet delivered
  { key: "S11", customer: "C-1003", source: "EMAIL", stage: "DISPATCHED", daysAgo: 2, lines: [{ code: "PRO-0001", qty: "10" }, { code: "PRO-0002", qty: "10" }] },
  // Delivered with rejected products (Invoice Claims page)
  { key: "S12", customer: "C-1001", source: "EMAIL", stage: "DELIVERED", daysAgo: 4, lines: [{ code: "PRO-0001", qty: "10", rejected: "2", reason: "QUALITY_ISSUE" }, { code: "PRO-0002", qty: "10", rejected: "4", reason: "SHORT_DELIVERY" }] },
  { key: "S13", customer: "C-1002", source: "WHATSAPP", stage: "DELIVERED", daysAgo: 6, lines: [{ code: "FRU-0001", qty: "40", rejected: "6", reason: "EXPIRED_PRODUCT" }, { code: "FRU-0005", qty: "24", rejected: "24", reason: "PRICING_DISPUTE" }] },
  { key: "S14", customer: "C-1003", source: "MANUAL", stage: "DELIVERED", daysAgo: 9, lines: [{ code: "VEG-0001", qty: "50", rejected: "8", reason: "QUALITY_ISSUE" }, { code: "VEG-0004", qty: "30" }] },
  { key: "S15", customer: "C-2002", source: "EMAIL", stage: "DELIVERED", daysAgo: 11, lines: [{ code: "PRO-0003", qty: "24", rejected: "3", reason: "NO_BARCODE" }, { code: "PRO-0004", qty: "24", rejected: "2", reason: "BARCODE_SCANNING_ISSUE" }] },
  { key: "S16", customer: "C-2001", source: "EMAIL", stage: "DELIVERED", daysAgo: 14, lines: [{ code: "VEG-0003", qty: "100", rejected: "10", reason: "OVERSUPPLY" }, { code: "VEG-0002", qty: "60", rejected: "5", reason: "DUPLICATE_ENTRY" }] },
  // Delivered cleanly
  { key: "S17", customer: "C-3001", source: "EMAIL", stage: "DELIVERED", daysAgo: 7, lines: [{ code: "VEG-0006", qty: "80" }, { code: "VEG-0005", qty: "60" }] },
  { key: "S18", customer: "C-1001", source: "MANUAL", stage: "DELIVERED", daysAgo: 18, lines: [{ code: "FRU-0003", qty: "70" }, { code: "HRB-0001", qty: "30" }] },
];
