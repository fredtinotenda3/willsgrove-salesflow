import { INTELLIGENCE_THRESHOLDS, type IntelligenceThresholds } from "@/lib/management-intelligence/thresholds";

/**
 * Registry of the business settings an administrator may change (pure).
 *
 * Only keys defined here can be stored. Each has a type, bounds, a default
 * and a plain statement of what it changes, so configuration is validated
 * rather than free-form. This is deliberately a SHORT list of operational
 * review lines and defaults. These are NOT configurable, by design, and are
 * enforced in code: authentication and session rules, role permissions,
 * CSRF, financial calculations (claim value, currency separation, credit
 * notes), approval-policy rules (those have their own managed screen) and
 * historical-record protection.
 */

export type SettingGroup = "management" | "quotations" | "operations";

export type SettingDefinition = {
  key: string;
  group: SettingGroup;
  label: string;
  description: string;
  unit: "count" | "days" | "percent";
  min: number;
  max: number;
  defaultValue: number;
  /** Where the setting takes effect, so nobody configures something that does nothing. */
  effect: string;
};

type ThresholdKey = keyof IntelligenceThresholds;

const mgmt = (key: ThresholdKey, label: string, unit: SettingDefinition["unit"], min: number, max: number, description: string): SettingDefinition => ({
  key: `management.${key}`,
  group: "management",
  label,
  description,
  unit,
  min,
  max,
  defaultValue: INTELLIGENCE_THRESHOLDS[key],
  effect: "Management intelligence on the nine management reports and the Management Action Centre.",
});

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  mgmt("minSample", "Minimum records before a rate is acted on", "count", 1, 100, "Below this many records a rate or share is reported as insufficient evidence."),
  mgmt("pickingAvailabilityLowPercent", "Picking availability: flag below", "percent", 1, 100, "Flag when less than this share of requested quantity is found at picking."),
  mgmt("pickingAvailabilityCriticalPercent", "Picking availability: critical below", "percent", 1, 100, "Escalate to critical below this share. Must be lower than the flag line."),
  mgmt("deliveryAcceptanceLowPercent", "Delivery acceptance: flag below", "percent", 1, 100, "Flag when less than this share of delivered quantity is accepted."),
  mgmt("deliveryAcceptanceCriticalPercent", "Delivery acceptance: critical below", "percent", 1, 100, "Escalate to critical below this share. Must be lower than the flag line."),
  mgmt("outstandingOrderAgeDays", "Outstanding order: flag after", "days", 1, 365, "Flag outstanding orders older than this."),
  mgmt("outstandingOrderCriticalAgeDays", "Outstanding order: critical after", "days", 1, 365, "Escalate to critical after this. Must be longer than the flag age."),
  mgmt("awaitingFulfilmentAgeDays", "Awaiting fulfilment: flag after", "days", 1, 365, "Flag approved orders not yet picked after this long."),
  mgmt("awaitingFulfilmentCriticalAgeDays", "Awaiting fulfilment: critical after", "days", 1, 365, "Escalate to critical after this. Must be longer than the flag age."),
  mgmt("statusConcentrationPercent", "Orders stuck at one stage: flag at", "percent", 10, 100, "Flag when this share of outstanding orders sits at a single stage."),
  mgmt("repeatShortageLines", "Repeated product shortage: lines", "count", 2, 100, "A product with this many short lines is a repeated shortage."),
  mgmt("repeatShortageCriticalLines", "Repeated product shortage: critical at", "count", 2, 200, "Escalate to critical at this many short lines. Must exceed the repeat line."),
  mgmt("repeatCustomerRejections", "Repeated customer rejections", "count", 2, 100, "A customer with this many rejected deliveries in the period is flagged."),
  mgmt("repeatCustomerClaims", "Repeat claims from one customer", "count", 2, 100, "A customer with this many claims is flagged."),
  mgmt("quotationAcceptanceLowPercent", "Quotation acceptance: flag below", "percent", 1, 100, "Flag a low share of issued quotations accepted."),
  mgmt("quotationConversionLowPercent", "Quotation to order conversion: flag below", "percent", 1, 100, "Flag a low share of accepted quotations converted to orders."),
  mgmt("quotationExpiredSharePercent", "Expired quotations: flag at", "percent", 1, 100, "Flag when this share of issued quotations expired."),
  mgmt("reasonConcentrationPercent", "One claim reason: flag above", "percent", 10, 100, "Flag a claim reason that makes up this share of claims."),
  mgmt("slowClaimResolutionDays", "Average claim resolution: flag above", "days", 1, 365, "Flag when resolved claims take longer than this on average."),
  mgmt("failedMessagesCritical", "Failed messages: raise priority at", "count", 1, 1000, "Raise a failed-messages finding to high priority at this many failures."),
  {
    key: "quotation.defaultValidityDays",
    group: "quotations",
    label: "Default quotation validity",
    description: "Number of days a new quotation is valid for when the form is opened. Sales staff can still choose any valid date.",
    unit: "days",
    min: 1,
    max: 365,
    defaultValue: 30,
    effect: "Pre-fills the Valid until date on the New Quotation form.",
  },
  {
    key: "admin.stuckOrderDays",
    group: "operations",
    label: "Stuck order: days without any update",
    description: "An order still in progress that has not changed for this many days is shown as stuck in the Administration Centre and the assignments view.",
    unit: "days",
    min: 1,
    max: 365,
    defaultValue: 7,
    effect: "Administration Centre and Assignment Management.",
  },
];

const BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));

export function getSettingDefinition(key: string): SettingDefinition | null {
  return BY_KEY.get(key) ?? null;
}

export type SettingValues = Record<string, number>;

/** Effective values: stored overrides (valid ones only) over registry defaults. */
export function resolveSettingValues(stored: { key: string; value: unknown }[]): SettingValues {
  const values: SettingValues = {};
  for (const def of SETTING_DEFINITIONS) values[def.key] = def.defaultValue;
  for (const row of stored) {
    const def = BY_KEY.get(row.key);
    if (def && isValidNumber(def, row.value)) values[def.key] = row.value as number;
  }
  return values;
}

function isValidNumber(def: SettingDefinition, value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= def.min && value <= def.max;
}

/** Pairs where one value must stay strictly below/above another, so an escalation line can never invert. */
const ORDERED_PAIRS: { lower: string; higher: string; message: string }[] = [
  { lower: "management.pickingAvailabilityCriticalPercent", higher: "management.pickingAvailabilityLowPercent", message: "The critical picking availability line must be lower than the flag line." },
  { lower: "management.deliveryAcceptanceCriticalPercent", higher: "management.deliveryAcceptanceLowPercent", message: "The critical delivery acceptance line must be lower than the flag line." },
  { lower: "management.outstandingOrderAgeDays", higher: "management.outstandingOrderCriticalAgeDays", message: "The critical outstanding-order age must be longer than the flag age." },
  { lower: "management.awaitingFulfilmentAgeDays", higher: "management.awaitingFulfilmentCriticalAgeDays", message: "The critical awaiting-fulfilment age must be longer than the flag age." },
  { lower: "management.repeatShortageLines", higher: "management.repeatShortageCriticalLines", message: "The critical shortage line count must exceed the repeat line count." },
];

export type SettingChangeCheck = { ok: true; value: number } | { ok: false; message: string };

export function validateSettingChange(key: string, rawValue: unknown, current: SettingValues): SettingChangeCheck {
  const def = BY_KEY.get(key);
  if (!def) return { ok: false, message: "Unknown setting." };
  if (typeof rawValue !== "number" || !Number.isInteger(rawValue)) return { ok: false, message: `${def.label} must be a whole number.` };
  if (rawValue < def.min || rawValue > def.max) return { ok: false, message: `${def.label} must be between ${def.min} and ${def.max}.` };
  const proposed = { ...current, [key]: rawValue };
  for (const pair of ORDERED_PAIRS) {
    if ((pair.lower === key || pair.higher === key) && !(proposed[pair.lower] < proposed[pair.higher])) return { ok: false, message: pair.message };
  }
  return { ok: true, value: rawValue };
}

/** Builds the rule-builder thresholds from effective settings. Keys the registry does not hold fall back to the code default. */
export function thresholdsFromValues(values: SettingValues): IntelligenceThresholds {
  const result: IntelligenceThresholds = { ...INTELLIGENCE_THRESHOLDS };
  for (const key of Object.keys(INTELLIGENCE_THRESHOLDS) as (keyof IntelligenceThresholds)[]) {
    const v = values[`management.${key}`];
    if (typeof v === "number") result[key] = v;
  }
  return result;
}
