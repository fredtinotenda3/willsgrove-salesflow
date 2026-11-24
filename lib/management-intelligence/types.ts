/**
 * Management intelligence: shared vocabulary (pure, no I/O).
 *
 * Every recommendation answers the same questions in the same shape:
 * what happened (finding), the evidence, why it matters, what to do, who
 * should act, how urgent, and how success will be measured. Nothing here
 * is a target or a forecast: thresholds are named rule parameters
 * (see thresholds.ts) and every figure comes from a report that already
 * exists. Where the data cannot support a recommendation the builders
 * return an "insufficient evidence" note instead of advice.
 */

export const RESPONSIBLE_FUNCTIONS = ["PURCHASING", "WAREHOUSE", "QUALITY_CONTROL", "SALES", "FINANCE", "OPERATIONS", "MANAGEMENT"] as const;
export type ResponsibleFunction = (typeof RESPONSIBLE_FUNCTIONS)[number];

export const RESPONSIBLE_FUNCTION_LABELS: Record<ResponsibleFunction, string> = {
  PURCHASING: "Purchasing",
  WAREHOUSE: "Warehouse",
  QUALITY_CONTROL: "Quality Control",
  SALES: "Sales",
  FINANCE: "Finance",
  OPERATIONS: "Operations",
  MANAGEMENT: "Management",
};

export const FINDING_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type FindingPriority = (typeof FINDING_PRIORITIES)[number];

export const PRIORITY_LABELS: Record<FindingPriority, string> = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

/** Review window the recommendation asks for, derived from priority, never from a made-up deadline. */
export const TIMEFRAME_BY_PRIORITY: Record<FindingPriority, string> = {
  CRITICAL: "Act today",
  HIGH: "Within 3 working days",
  MEDIUM: "Within 2 weeks",
  LOW: "Review at the next monthly review",
};

/** Which Action Centre section a finding belongs to. */
export type FindingTag = "operational" | "financial" | "shortage" | "product-rejection" | "customer" | "commercial" | "communication";

export type EvidenceItem = { label: string; value: string };

export type FindingLink = { label: string; href: string };

export type ManagementFinding = {
  /** Stable identity inside its report, e.g. "aged-orders" or "product-shortage:ABC123". */
  key: string;
  reportId: string;
  /** Same topic raised from two reports (e.g. failed messages) is shown once in the Action Centre. */
  topic: string;
  tag: FindingTag;
  title: string;
  finding: string;
  evidence: EvidenceItem[];
  businessImpact: string;
  recommendedAction: string;
  responsibleFunction: ResponsibleFunction;
  priority: FindingPriority;
  timeframe: string;
  expectedOutcome: string;
  measurement: string;
  links: FindingLink[];
};

export type ManagementIntelligence = {
  reportId: string;
  findings: ManagementFinding[];
  /** Reasons the data could not support a recommendation. Shown instead of advice, never hidden. */
  insufficientEvidence: string[];
  /** True when the rules ran on enough data and found nothing that calls for action. */
  noActionIndicated: boolean;
};

export type FindingInput = Omit<ManagementFinding, "timeframe" | "reportId"> & { timeframe?: string };

export function makeFinding(reportId: string, input: FindingInput): ManagementFinding {
  return { ...input, reportId, timeframe: input.timeframe ?? TIMEFRAME_BY_PRIORITY[input.priority] };
}

export function priorityRank(priority: FindingPriority): number {
  return FINDING_PRIORITIES.indexOf(priority);
}

export function sortFindings<T extends { priority: FindingPriority; key: string }>(findings: readonly T[]): T[] {
  return [...findings].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.key.localeCompare(b.key));
}

export function finishIntelligence(reportId: string, findings: ManagementFinding[], insufficientEvidence: string[], sufficientDataChecked: boolean): ManagementIntelligence {
  return {
    reportId,
    findings: sortFindings(findings),
    insufficientEvidence,
    noActionIndicated: findings.length === 0 && insufficientEvidence.length === 0 && sufficientDataChecked,
  };
}
