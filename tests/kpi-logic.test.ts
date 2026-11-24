import { describe, expect, it } from "vitest";
import { deltaDirection, deltaTone, describeDelta, statusFromThresholds, targetProgress, usableSparkline } from "@/lib/kpi/kpi-logic";

describe("deltaTone (business meaning, not arrow direction)", () => {
  it("treats a rise in revenue as favourable and a rise in lost sales as unfavourable", () => {
    expect(deltaTone(10, "up-good")).toBe("favourable");
    expect(deltaTone(10, "down-good")).toBe("unfavourable");
    expect(deltaTone(-10, "up-good")).toBe("unfavourable");
    expect(deltaTone(-10, "down-good")).toBe("favourable");
  });
  it("is neutral for neutral polarity and for negligible change", () => {
    expect(deltaTone(25, "neutral")).toBe("neutral");
    expect(deltaTone(0.01, "up-good")).toBe("neutral");
    expect(deltaDirection(0)).toBe("flat");
  });
  it("is null when there is no change figure (no fabricated trend)", () => {
    expect(deltaTone(null, "up-good")).toBeNull();
    expect(deltaTone(Number.NaN, "up-good")).toBeNull();
    expect(deltaDirection(undefined)).toBeNull();
  });
});

describe("describeDelta", () => {
  it("produces a screen-reader sentence including the judgement", () => {
    expect(describeDelta(12.5, "down-good", "vs previous 7 days")).toBe("Up 12.5% vs previous 7 days, unfavourable.");
    expect(describeDelta(-3, "down-good")).toBe("Down 3.0%, favourable.");
    expect(describeDelta(0, "up-good")).toBe("Unchanged.");
    expect(describeDelta(null, "up-good")).toBeNull();
  });
});

describe("statusFromThresholds", () => {
  it("never invents a status without thresholds or a value", () => {
    expect(statusFromThresholds(5, undefined)).toBeNull();
    expect(statusFromThresholds(null, { warnAt: 1, criticalAt: 2, higherIsWorse: true })).toBeNull();
  });
  it("bands when higher is worse", () => {
    const t = { warnAt: 5, criticalAt: 10, higherIsWorse: true };
    expect(statusFromThresholds(4, t)).toBe("healthy");
    expect(statusFromThresholds(5, t)).toBe("warning");
    expect(statusFromThresholds(10, t)).toBe("critical");
  });
  it("bands when lower is worse", () => {
    const t = { warnAt: 90, criticalAt: 75, higherIsWorse: false };
    expect(statusFromThresholds(95, t)).toBe("healthy");
    expect(statusFromThresholds(90, t)).toBe("warning");
    expect(statusFromThresholds(70, t)).toBe("critical");
  });
});

describe("targetProgress", () => {
  it("computes progress and clamps only the drawn bar", () => {
    expect(targetProgress(50, 200)).toEqual({ percent: 25, barPercent: 25, reached: false });
    expect(targetProgress(300, 200)).toEqual({ percent: 150, barPercent: 100, reached: true });
  });
  it("is null without a real positive target", () => {
    expect(targetProgress(5, null)).toBeNull();
    expect(targetProgress(5, 0)).toBeNull();
    expect(targetProgress(null, 10)).toBeNull();
  });
});

describe("usableSparkline", () => {
  it("requires at least three real points and drops nulls instead of zero-filling", () => {
    expect(usableSparkline([1, 2])).toBeNull();
    expect(usableSparkline([1, null, 3, undefined, 5])).toEqual([1, 3, 5]);
    expect(usableSparkline([null, null, 4])).toBeNull();
    expect(usableSparkline(undefined)).toBeNull();
  });
});
