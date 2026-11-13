import { z } from "zod";
import { DECISION_RECOMMENDATION_STATUSES } from "@/lib/reporting/decision-types";

/**
 * Milestone 15 (Decision Intelligence). Request-body validation for the
 * one mutation this milestone's API surface exposes -- the
 * recommendation status-update endpoint -- same zod `safeParse` + "a
 * note is optional, length-capped" shape every existing approvals
 * decision schema in lib/approvals/validation.ts already uses.
 */
export const updateDecisionRecommendationStatusSchema = z.object({
  status: z.enum(DECISION_RECOMMENDATION_STATUSES),
  note: z.string().max(2000).optional(),
});
export type UpdateDecisionRecommendationStatusInput = z.infer<typeof updateDecisionRecommendationStatusSchema>;
