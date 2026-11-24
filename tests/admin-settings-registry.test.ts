import { describe, expect, it } from "vitest";
import { INTELLIGENCE_THRESHOLDS } from "@/lib/management-intelligence/thresholds";
import { SETTING_DEFINITIONS, getSettingDefinition, resolveSettingValues, thresholdsFromValues, validateSettingChange } from "@/lib/admin/settings-registry";

const defaults = () => resolveSettingValues([]);

describe("settings registry", () => {
  it("defaults equal the built-in thresholds, so an empty store changes no behaviour", () => {
    const t = thresholdsFromValues(defaults());
    expect(t).toEqual(INTELLIGENCE_THRESHOLDS);
    expect(defaults()["quotation.defaultValidityDays"]).toBe(30);
  });
  it("every default sits inside its own bounds", () => {
    for (const d of SETTING_DEFINITIONS) { expect(d.defaultValue).toBeGreaterThanOrEqual(d.min); expect(d.defaultValue).toBeLessThanOrEqual(d.max); }
  });
  it("rejects unknown keys, non-integers and out-of-range values", () => {
    expect(validateSettingChange("security.sessionHours", 99, defaults()).ok).toBe(false);
    expect(validateSettingChange("quotation.defaultValidityDays", 12.5, defaults()).ok).toBe(false);
    expect(validateSettingChange("quotation.defaultValidityDays", "30", defaults()).ok).toBe(false);
    expect(validateSettingChange("quotation.defaultValidityDays", 0, defaults()).ok).toBe(false);
    expect(validateSettingChange("quotation.defaultValidityDays", 366, defaults()).ok).toBe(false);
    expect(validateSettingChange("quotation.defaultValidityDays", 45, defaults())).toEqual({ ok: true, value: 45 });
  });
  it("never lets an escalation line invert", () => {
    const v = defaults();
    expect(validateSettingChange("management.outstandingOrderCriticalAgeDays", v["management.outstandingOrderAgeDays"], v).ok).toBe(false);
    expect(validateSettingChange("management.outstandingOrderAgeDays", v["management.outstandingOrderCriticalAgeDays"] + 1, v).ok).toBe(false);
    expect(validateSettingChange("management.pickingAvailabilityCriticalPercent", v["management.pickingAvailabilityLowPercent"], v).ok).toBe(false);
    expect(validateSettingChange("management.outstandingOrderCriticalAgeDays", v["management.outstandingOrderAgeDays"] + 5, v).ok).toBe(true);
  });
  it("ignores stored values that are invalid or unknown (falls back to the default)", () => {
    const v = resolveSettingValues([{ key: "quotation.defaultValidityDays", value: "banana" }, { key: "nope", value: 5 }, { key: "admin.stuckOrderDays", value: 10 }]);
    expect(v["quotation.defaultValidityDays"]).toBe(30);
    expect(v["admin.stuckOrderDays"]).toBe(10);
    expect("nope" in v).toBe(false);
  });
  it("configured thresholds flow into the rule parameters", () => {
    const t = thresholdsFromValues(resolveSettingValues([{ key: "management.minSample", value: 9 }]));
    expect(t.minSample).toBe(9);
  });
  it("exposes no security or financial keys", () => {
    for (const d of SETTING_DEFINITIONS) expect(d.key).toMatch(/^(management|quotation|admin)\./);
    expect(getSettingDefinition("auth.password")).toBeNull();
  });
});
