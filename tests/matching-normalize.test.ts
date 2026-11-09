import { describe, it, expect } from "vitest";
import { normalizeMatchText, tokenize, diceCoefficient, selectConfidentMatch } from "@/lib/matching/normalize";

/**
 * Milestone 2B. Pure-logic unit tests for lib/matching/normalize.ts --
 * deliberately the ONE matching-engine test file with no @prisma/client
 * dependency anywhere in its import graph, so it runs unconditionally in
 * every environment including this sandbox (see
 * tests/matching-db.integration.test.ts's module comment for why the
 * rest of the matching/review engine cannot do the same).
 */

describe("normalizeMatchText", () => {
  it("lowercases, trims, and collapses internal whitespace", () => {
    expect(normalizeMatchText("  Baby   Marrow  ")).toBe("baby marrow");
  });

  it("strips diacritics", () => {
    expect(normalizeMatchText("Café Löwe")).toBe("cafe lowe");
  });

  it("strips light punctuation but keeps digits and unit words", () => {
    expect(normalizeMatchText("Baby Marrow, 250g (Punnet).")).toBe("baby marrow 250g punnet");
  });

  it("never strips pack-size or unit words -- that's what keeps different pack sizes from colliding", () => {
    expect(normalizeMatchText("Tomato 1kg Box")).toBe("tomato 1kg box");
    expect(normalizeMatchText("Tomato 5kg Box")).toBe("tomato 5kg box");
  });

  it("returns an empty string for empty or whitespace-only input", () => {
    expect(normalizeMatchText("")).toBe("");
    expect(normalizeMatchText("   ")).toBe("");
  });
});

describe("tokenize", () => {
  it("splits normalized text into tokens", () => {
    expect(tokenize("Baby Marrow 250G Punnet")).toEqual(["baby", "marrow", "250g", "punnet"]);
  });

  it("returns [] for empty input, never ['']", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("diceCoefficient", () => {
  it("returns 1 for two identical token sets", () => {
    const tokens = ["baby", "marrow", "250g", "punnet"];
    expect(diceCoefficient(tokens, [...tokens])).toBe(1);
  });

  it("returns 0 for two completely disjoint token sets", () => {
    expect(diceCoefficient(["apple", "pie"], ["carrot", "soup"])).toBe(0);
  });

  it("returns 0 when either input is empty, never NaN", () => {
    expect(diceCoefficient([], [])).toBe(0);
    expect(diceCoefficient([], ["tomato"])).toBe(0);
    expect(diceCoefficient(["tomato"], [])).toBe(0);
  });

  it("scores partial overlap between 0 and 1", () => {
    // {baby,marrow,250g,punnet} vs {baby,marrow,500g,punnet}: intersection=3, sizes 4+4
    const score = diceCoefficient(["baby", "marrow", "250g", "punnet"], ["baby", "marrow", "500g", "punnet"]);
    expect(score).toBeCloseTo((2 * 3) / (4 + 4), 10);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("treats duplicate tokens within one list as a set -- duplicates never inflate the score", () => {
    const a = diceCoefficient(["tomato", "tomato", "tomato"], ["tomato"]);
    const b = diceCoefficient(["tomato"], ["tomato"]);
    expect(a).toBe(b);
    expect(a).toBe(1);
  });

  it("naturally scores two different pack sizes of 'the same' product lower than a true match, since pack-size words are kept as tokens", () => {
    const description = tokenize("baby marrow 250g punnet");
    const sameProduct = diceCoefficient(description, tokenize("baby marrow 250g punnet"));
    const differentPackSize = diceCoefficient(description, tokenize("baby marrow 1kg box"));
    expect(sameProduct).toBe(1);
    expect(differentPackSize).toBeLessThan(sameProduct);
  });
});

describe("selectConfidentMatch", () => {
  const CONFIDENT = 0.72;
  const GAP = 0.15;

  it("returns null for an empty candidate list", () => {
    expect(selectConfidentMatch([], CONFIDENT, GAP)).toBeNull();
  });

  it("returns null when the top score is 0", () => {
    expect(selectConfidentMatch([{ score: 0 }], CONFIDENT, GAP)).toBeNull();
  });

  it("returns null when the top score is below the confidence threshold, even with no other candidates", () => {
    expect(selectConfidentMatch([{ score: 0.5 }], CONFIDENT, GAP)).toBeNull();
  });

  it("returns the top candidate when it clears the threshold and there is no second candidate", () => {
    const candidate = { score: 0.9, id: "only" };
    expect(selectConfidentMatch([candidate], CONFIDENT, GAP)).toBe(candidate);
  });

  it("returns the top candidate when it clears the threshold and is far enough ahead of the second", () => {
    const top = { score: 0.95, id: "top" };
    const second = { score: 0.5, id: "second" };
    expect(selectConfidentMatch([top, second], CONFIDENT, GAP)).toBe(top);
  });

  it("returns null when the top candidate clears the threshold but is too close to the second (ambiguous)", () => {
    const top = { score: 0.8, id: "top" };
    const second = { score: 0.75, id: "second" }; // gap of 0.05 < 0.15
    expect(selectConfidentMatch([top, second], CONFIDENT, GAP)).toBeNull();
  });

  it("is exclusive at the exact ambiguity-gap boundary (gap >= threshold passes)", () => {
    const top = { score: 0.9, id: "top" };
    const second = { score: 0.75, id: "second" }; // gap exactly 0.15
    expect(selectConfidentMatch([top, second], CONFIDENT, GAP)).toBe(top);
  });

  it("is inclusive at the exact confidence-threshold boundary", () => {
    const top = { score: 0.72, id: "top" };
    expect(selectConfidentMatch([top], CONFIDENT, GAP)).toBe(top);
  });
});
