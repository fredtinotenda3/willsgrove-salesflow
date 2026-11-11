import { describe, it, expect } from "vitest";
import { determineAutoAdvanceTarget, type AutoAdvanceInput } from "@/lib/returns-credits/status-recompute";
import { matchCreditNoteToClaim, type MatchCandidateClaim } from "@/lib/returns-credits/matching";
import {
  suggestCreditNoteColumnMapping,
  validateCreditNoteColumnMapping,
  applyCreditNoteColumnMapping,
  groupIntoCreditNotes,
  parseCreditNoteCsvForPreview,
  type CreditNoteColumnMapping,
} from "@/lib/returns-credits/csv";
import { returnConditionRequiresDetail } from "@/lib/returns-credits/validation";

/**
 * Milestone 6B (Returns & Credit Notes). Pure, no-database unit tests for
 * lib/returns-credits/status-recompute.ts, matching.ts, csv.ts and
 * validation.ts -- none of these import @prisma/client, so (unlike the
 * DB-gated tests/returns-credits-db.integration.test.ts) they run in every
 * environment, including this sandbox. Mirrors tests/invoice-claims.test.ts
 * and tests/invoice-reconciliation.test.ts's own shape exactly.
 */

function autoAdvanceInput(overrides: Partial<AutoAdvanceInput>): AutoAdvanceInput {
  return {
    currentStatus: "APPROVED",
    latestApprovedDecision: null,
    approvedCreditAmount: null,
    actualCreditedTotal: "0.0000",
    hasReceivedReturn: false,
    ...overrides,
  };
}

describe("Milestone 6B: determineAutoAdvanceTarget -- full decision matrix", () => {
  it("never advances from a non-APPROVED/PARTIALLY_RESOLVED status (nothing for this claim to recompute)", () => {
    for (const status of ["OPEN", "UNDER_INVESTIGATION", "AWAITING_CUSTOMER", "AWAITING_INTERNAL_ACTION", "RESOLVED", "REJECTED", "CLOSED"] as const) {
      const result = determineAutoAdvanceTarget(autoAdvanceInput({ currentStatus: status, latestApprovedDecision: "FULL_CREDIT_RECOMMENDED", approvedCreditAmount: "100.0000", actualCreditedTotal: "100.0000" }));
      expect(result.advance).toBe(false);
    }
  });

  it("never advances with no approved resolution at all (defensive -- APPROVED/PARTIALLY_RESOLVED should always have one)", () => {
    const result = determineAutoAdvanceTarget(autoAdvanceInput({ latestApprovedDecision: null }));
    expect(result.advance).toBe(false);
  });

  describe("PHYSICAL_RETURN_REQUIRED -- resolved purely by the warehouse receiving goods back, never by a credit note", () => {
    it("does not advance until a physical return has actually been received", () => {
      const result = determineAutoAdvanceTarget(autoAdvanceInput({ latestApprovedDecision: "PHYSICAL_RETURN_REQUIRED", hasReceivedReturn: false }));
      expect(result.advance).toBe(false);
    });

    it("auto-resolves once a physical return is received, regardless of any credit amount", () => {
      const result = determineAutoAdvanceTarget(autoAdvanceInput({ latestApprovedDecision: "PHYSICAL_RETURN_REQUIRED", hasReceivedReturn: true }));
      expect(result).toEqual({ advance: true, toStatus: "RESOLVED", reason: expect.any(String) });
    });
  });

  describe("non-credit-bearing decisions -- never acted on here", () => {
    it.each(["REPLACEMENT_APPROVED", "NO_ACTION_REQUIRED", "CLAIM_REJECTED", "DELIVERY_INVESTIGATION_REQUIRED", "OTHER"] as const)(
      "%s never advances even with actuals recorded",
      (decision) => {
        const result = determineAutoAdvanceTarget(autoAdvanceInput({ latestApprovedDecision: decision, actualCreditedTotal: "999.0000", hasReceivedReturn: true }));
        expect(result.advance).toBe(false);
      }
    );
  });

  describe("PARTIAL_CREDIT_RECOMMENDED -- any real credit note resolves it as PARTIALLY_RESOLVED, never silently escalated to RESOLVED", () => {
    it("does not advance with zero actual credit recorded yet", () => {
      const result = determineAutoAdvanceTarget(autoAdvanceInput({ latestApprovedDecision: "PARTIAL_CREDIT_RECOMMENDED", approvedCreditAmount: "50.0000", actualCreditedTotal: "0.0000" }));
      expect(result.advance).toBe(false);
    });

    it("advances APPROVED -> PARTIALLY_RESOLVED once any credit note is recorded", () => {
      const result = determineAutoAdvanceTarget(autoAdvanceInput({ currentStatus: "APPROVED", latestApprovedDecision: "PARTIAL_CREDIT_RECOMMENDED", approvedCreditAmount: "50.0000", actualCreditedTotal: "10.0000" }));
      expect(result).toEqual({ advance: true, toStatus: "PARTIALLY_RESOLVED", reason: expect.any(String) });
    });

    it("never escalates to RESOLVED even when the actual credit exactly matches the approved amount -- a manager explicitly chose 'partial'", () => {
      const result = determineAutoAdvanceTarget(autoAdvanceInput({ currentStatus: "APPROVED", latestApprovedDecision: "PARTIAL_CREDIT_RECOMMENDED", approvedCreditAmount: "50.0000", actualCreditedTotal: "50.0000" }));
      expect(result).toEqual({ advance: true, toStatus: "PARTIALLY_RESOLVED", reason: expect.any(String) });
    });

    it("does not re-advance when already PARTIALLY_RESOLVED (no-op, not an error)", () => {
      const result = determineAutoAdvanceTarget(autoAdvanceInput({ currentStatus: "PARTIALLY_RESOLVED", latestApprovedDecision: "PARTIAL_CREDIT_RECOMMENDED", approvedCreditAmount: "50.0000", actualCreditedTotal: "10.0000" }));
      expect(result.advance).toBe(false);
    });
  });

  describe.each(["FULL_CREDIT_RECOMMENDED", "PRICING_CORRECTION_REQUIRED"] as const)("%s -- resolved once the actual credited total reaches (or exceeds) what was approved", (decision) => {
    it("does not advance with zero actual credit recorded yet", () => {
      const result = determineAutoAdvanceTarget(autoAdvanceInput({ latestApprovedDecision: decision, approvedCreditAmount: "100.0000", actualCreditedTotal: "0.0000" }));
      expect(result.advance).toBe(false);
    });

    it("advances to PARTIALLY_RESOLVED on partial progress toward the approved amount", () => {
      const result = determineAutoAdvanceTarget(autoAdvanceInput({ currentStatus: "APPROVED", latestApprovedDecision: decision, approvedCreditAmount: "100.0000", actualCreditedTotal: "40.0000" }));
      expect(result).toEqual({ advance: true, toStatus: "PARTIALLY_RESOLVED", reason: expect.any(String) });
    });

    it("advances straight to RESOLVED once the actual credited total exactly matches the approved amount", () => {
      const result = determineAutoAdvanceTarget(autoAdvanceInput({ latestApprovedDecision: decision, approvedCreditAmount: "100.0000", actualCreditedTotal: "100.0000" }));
      expect(result).toEqual({ advance: true, toStatus: "RESOLVED", reason: expect.any(String) });
    });

    it("advances to RESOLVED (never clamped) even when SAP credited MORE than was approved -- the exception is surfaced elsewhere (financial.ts's actualExceedsApproved), not hidden here", () => {
      const result = determineAutoAdvanceTarget(autoAdvanceInput({ latestApprovedDecision: decision, approvedCreditAmount: "100.0000", actualCreditedTotal: "150.0000" }));
      expect(result).toEqual({ advance: true, toStatus: "RESOLVED", reason: expect.any(String) });
    });

    it("treats a missing/zero approved amount as never reaching full resolution via this path", () => {
      const result = determineAutoAdvanceTarget(autoAdvanceInput({ currentStatus: "APPROVED", latestApprovedDecision: decision, approvedCreditAmount: null, actualCreditedTotal: "10.0000" }));
      expect(result).toEqual({ advance: true, toStatus: "PARTIALLY_RESOLVED", reason: expect.any(String) });
    });

    it("does not re-advance when already PARTIALLY_RESOLVED and still below the approved amount (no-op)", () => {
      const result = determineAutoAdvanceTarget(autoAdvanceInput({ currentStatus: "PARTIALLY_RESOLVED", latestApprovedDecision: decision, approvedCreditAmount: "100.0000", actualCreditedTotal: "40.0000" }));
      expect(result.advance).toBe(false);
    });
  });
});

describe("Milestone 6B: matchCreditNoteToClaim -- conservative automatic matching", () => {
  function candidate(claimId: string, overrides: Partial<MatchCandidateClaim> = {}): MatchCandidateClaim {
    return {
      claimId,
      status: "APPROVED",
      latestApprovedDecision: "FULL_CREDIT_RECOMMENDED",
      approvedCreditAmount: "100.0000",
      actualCreditedTotal: "0.0000",
      ...overrides,
    };
  }

  it("matches the single qualifying candidate", () => {
    const result = matchCreditNoteToClaim([candidate("claim-1")]);
    expect(result?.claimId).toBe("claim-1");
  });

  it("never matches when zero candidates qualify (lands UNMATCHED, never a guess)", () => {
    expect(matchCreditNoteToClaim([])).toBeNull();
  });

  it("never matches when MULTIPLE candidates qualify -- ambiguous, lands UNMATCHED for manual reconciliation", () => {
    const result = matchCreditNoteToClaim([candidate("claim-1"), candidate("claim-2")]);
    expect(result).toBeNull();
  });

  it("excludes a candidate not in APPROVED/PARTIALLY_RESOLVED status", () => {
    const result = matchCreditNoteToClaim([candidate("claim-1", { status: "RESOLVED" })]);
    expect(result).toBeNull();
  });

  it("excludes a candidate whose latest approved decision is not credit-bearing", () => {
    const result = matchCreditNoteToClaim([candidate("claim-1", { latestApprovedDecision: "PHYSICAL_RETURN_REQUIRED" })]);
    expect(result).toBeNull();
  });

  it("excludes a candidate with no remaining exposure (already fully credited) -- never routes a further credit note to a claim that doesn't need it", () => {
    const result = matchCreditNoteToClaim([candidate("claim-1", { approvedCreditAmount: "100.0000", actualCreditedTotal: "100.0000" })]);
    expect(result).toBeNull();
  });

  it("still qualifies a PARTIALLY_RESOLVED claim with outstanding exposure", () => {
    const result = matchCreditNoteToClaim([candidate("claim-1", { status: "PARTIALLY_RESOLVED", approvedCreditAmount: "100.0000", actualCreditedTotal: "40.0000" })]);
    expect(result?.claimId).toBe("claim-1");
  });

  it("resolves ambiguity when only one of several candidates still has outstanding exposure", () => {
    const result = matchCreditNoteToClaim([
      candidate("claim-1", { approvedCreditAmount: "100.0000", actualCreditedTotal: "100.0000" }), // fully credited, excluded
      candidate("claim-2", { approvedCreditAmount: "50.0000", actualCreditedTotal: "0.0000" }),
    ]);
    expect(result?.claimId).toBe("claim-2");
  });
});

describe("Milestone 6B: csv.ts -- column mapping, parsing, grouping", () => {
  const CSV_HEADER = "DocEntry,DocNum,BaseDocEntry,BaseInvoice,DocDate,DocCur,DocTotal,Comments";

  function row(fields: Record<string, string>): string {
    const order = CSV_HEADER.split(",");
    return order.map((h) => fields[h] ?? "").join(",");
  }

  const FULL_MAPPING: CreditNoteColumnMapping = {
    docEntry: "DocEntry",
    docNum: "DocNum",
    baseInvoiceDocEntry: "BaseDocEntry",
    baseInvoiceDocNum: "BaseInvoice",
    creditNoteDate: "DocDate",
    currency: "DocCur",
    amount: "DocTotal",
    notes: "Comments",
  };

  it("parses a well-formed CSV for preview", () => {
    const csv = [CSV_HEADER, row({ DocEntry: "801", DocNum: "CN-001", DocTotal: "50.0000" })].join("\n");
    const result = parseCreditNoteCsvForPreview(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.sourceHeaders).toContain("DocNum");
      expect(result.preview.totalDataRows).toBe(1);
    }
  });

  it("suggests a sensible column mapping from real SAP B1-style headers", () => {
    const suggested = suggestCreditNoteColumnMapping(CSV_HEADER.split(","));
    expect(suggested.docNum).toBe("DocNum");
    expect(suggested.amount).toBe("DocTotal");
    expect(suggested.currency).toBe("DocCur");
  });

  it("validateCreditNoteColumnMapping rejects a mapping missing a required field (docNum/amount)", () => {
    const incomplete = { ...FULL_MAPPING, amount: null };
    const result = validateCreditNoteColumnMapping(incomplete, CSV_HEADER.split(","));
    expect(result.ok).toBe(false);
  });

  it("validateCreditNoteColumnMapping rejects the same column mapped twice", () => {
    const clashing = { ...FULL_MAPPING, notes: FULL_MAPPING.docNum };
    const result = validateCreditNoteColumnMapping(clashing, CSV_HEADER.split(","));
    expect(result.ok).toBe(false);
  });

  it("rejects a row missing DocNum or an unparseable amount, rather than guessing", () => {
    const csv = [
      CSV_HEADER,
      row({ DocEntry: "801", DocNum: "", DocTotal: "50.0000" }), // missing docNum
      row({ DocEntry: "802", DocNum: "CN-002", DocTotal: "not-a-number" }), // bad amount
      row({ DocEntry: "803", DocNum: "CN-003", DocTotal: "" }), // missing amount
    ].join("\n");

    const { rows, errors } = applyCreditNoteColumnMapping(csv, FULL_MAPPING);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(3);
  });

  it("accepts a decimal amount up to 4 places and preserves it verbatim", () => {
    const csv = [CSV_HEADER, row({ DocEntry: "801", DocNum: "CN-001", DocTotal: "123.4567" })].join("\n");
    const { rows, errors } = applyCreditNoteColumnMapping(csv, FULL_MAPPING);
    expect(errors).toHaveLength(0);
    expect(rows[0]!.amount).toBe("123.4567");
  });

  it("groups flattened rows into one credit note per DocEntry, taking header-level amount from the FIRST row only (never summed)", () => {
    const csv = [
      CSV_HEADER,
      row({ DocEntry: "801", DocNum: "CN-001", DocTotal: "50.0000", Comments: "line 1" }),
      row({ DocEntry: "801", DocNum: "CN-001", DocTotal: "50.0000", Comments: "line 2" }),
      row({ DocEntry: "802", DocNum: "CN-002", DocTotal: "25.0000" }),
    ].join("\n");

    const { rows } = applyCreditNoteColumnMapping(csv, FULL_MAPPING);
    const groups = groupIntoCreditNotes(rows);
    expect(groups).toHaveLength(2);

    const cn801 = groups.find((g) => g.docEntry === "801")!;
    expect(cn801.rows).toHaveLength(2);
    expect(cn801.amount).toBe("50.0000"); // not 100 -- never summed across rows

    const cn802 = groups.find((g) => g.docEntry === "802")!;
    expect(cn802.amount).toBe("25.0000");
  });

  it("groups by DocNum when DocEntry is absent from the export", () => {
    const headerNoDocEntry = CSV_HEADER.replace("DocEntry,", "");
    const fields = { DocNum: "CN-010", DocTotal: "10.0000" } as Record<string, string>;
    const dataRow = headerNoDocEntry.split(",").map((h) => fields[h] ?? "").join(",");
    const csv = [headerNoDocEntry, dataRow].join("\n");
    const mappingNoDocEntry = { ...FULL_MAPPING, docEntry: null };
    const { rows } = applyCreditNoteColumnMapping(csv, mappingNoDocEntry);
    const groups = groupIntoCreditNotes(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.groupKey).toBe("docNum:CN-010");
  });
});

describe("Milestone 6B: validation.ts -- 'Other requires detail'", () => {
  it("only OTHER requires a return-condition detail", () => {
    expect(returnConditionRequiresDetail("OTHER")).toBe(true);
    expect(returnConditionRequiresDetail("DAMAGED")).toBe(false);
    expect(returnConditionRequiresDetail("GOOD_RESALABLE")).toBe(false);
    expect(returnConditionRequiresDetail("EXPIRED")).toBe(false);
  });
});
