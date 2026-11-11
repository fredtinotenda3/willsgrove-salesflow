import { z } from "zod";
import { decimalStringSchema, parseScaledDecimal } from "@/lib/picking/validation";

/**
 * Milestone 8 (Validation and Approvals). Pure logic only -- no
 * `@prisma/client` import, no database access -- so this file is safe to
 * import from a Client Component and to unit-test without a database,
 * same convention as lib/quotations/validation.ts and
 * lib/invoice-claims/validation.ts.
 */

// ---------------------------------------------------------------------------
// Controlled vocabularies. Mirror the schema's enums exactly (see
// prisma/schema.prisma's Milestone 8 header comment for the rationale
// behind each).
// ---------------------------------------------------------------------------

export const APPROVAL_REQUEST_STATUSES = ["DRAFT", "PENDING", "APPROVED", "REJECTED", "CANCELLED", "WITHDRAWN"] as const;
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUSES)[number];

export const APPROVAL_MODULES = ["QUOTATIONS", "ORDERS"] as const;
export type ApprovalModule = (typeof APPROVAL_MODULES)[number];

export const APPROVAL_ACTION_TYPES = ["QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD", "ORDER_VALUE_EXCEEDS_THRESHOLD"] as const;
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];

export const APPROVAL_EVENT_TYPES = ["SUBMITTED", "APPROVED", "REJECTED", "WITHDRAWN", "CANCELLED", "RESUBMITTED", "INVALIDATED"] as const;
export type ApprovalEventType = (typeof APPROVAL_EVENT_TYPES)[number];

export const APPROVER_ROLES = ["SALES_MANAGER", "ADMINISTRATOR"] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

/**
 * Which module a given actionType belongs to -- exhaustive, so adding an
 * actionType without updating this map is a compile error, not a
 * mismatched row silently saved.
 */
export function actionTypeModule(actionType: ApprovalActionType): ApprovalModule {
  switch (actionType) {
    case "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD":
      return "QUOTATIONS";
    case "ORDER_VALUE_EXCEEDS_THRESHOLD":
      return "ORDERS";
    default: {
      const exhaustive: never = actionType;
      throw new Error(`Unhandled approval action type: ${exhaustive}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Status transition graph (spec section 6). Exhaustive --
// Record<ApprovalRequestStatus, ...> makes a status added to
// APPROVAL_REQUEST_STATUSES without a matching entry here a compile
// error, same discipline as lib/quotations/validation.ts's
// QUOTATION_STATUS_TRANSITIONS and lib/invoice-claims/validation.ts's
// CLAIM_STATUS_TRANSITIONS.
//
// DRAFT is schema-complete but unreachable through any action built in
// this milestone (every v1 trigger auto-raises a request already at
// PENDING) -- its edges exist so a future manual-submission flow is
// additive, not a migration.
// ---------------------------------------------------------------------------

const APPROVAL_REQUEST_TRANSITIONS: Record<ApprovalRequestStatus, readonly ApprovalRequestStatus[]> = {
  DRAFT: ["PENDING", "CANCELLED", "WITHDRAWN"],
  PENDING: ["APPROVED", "REJECTED", "CANCELLED", "WITHDRAWN"],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
  WITHDRAWN: [],
};

export type ApprovalTransitionResult = { ok: true } | { ok: false; message: string };

export function validateApprovalStatusTransition(from: ApprovalRequestStatus, to: ApprovalRequestStatus): ApprovalTransitionResult {
  if (from === to) {
    return { ok: false, message: `The request is already ${to}.` };
  }
  const allowed = APPROVAL_REQUEST_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return { ok: false, message: `Cannot move an approval request from ${from} directly to ${to}.` };
  }
  return { ok: true };
}

export function isDecidedStatus(status: ApprovalRequestStatus): boolean {
  return status === "APPROVED" || status === "REJECTED";
}

export function isLiveStatus(status: ApprovalRequestStatus): boolean {
  return status === "DRAFT" || status === "PENDING";
}

/**
 * The integrity check for ApprovalRequest's typed-reference design
 * (spec section 2: "do not use arbitrary polymorphic references without
 * a deliberate integrity strategy"). Exactly one of quotationId/
 * customerOrderId must be set, and it must be the one `module` actually
 * names -- never a DB CHECK constraint, same "enforced in application
 * code" convention this schema already follows for every other
 * conditional business rule (e.g. QuotationLine's catalogued-vs-unlisted
 * XOR).
 */
export function validateApprovalTargetRef(
  module: ApprovalModule,
  refs: { quotationId?: string | null; customerOrderId?: string | null }
): ApprovalTransitionResult {
  const quotationId = refs.quotationId ?? null;
  const customerOrderId = refs.customerOrderId ?? null;
  const setCount = (quotationId !== null ? 1 : 0) + (customerOrderId !== null ? 1 : 0);

  if (setCount !== 1) {
    return { ok: false, message: "An approval request must reference exactly one business record." };
  }
  if (module === "QUOTATIONS" && quotationId === null) {
    return { ok: false, message: "A QUOTATIONS approval request must reference a quotationId." };
  }
  if (module === "ORDERS" && customerOrderId === null) {
    return { ok: false, message: "An ORDERS approval request must reference a customerOrderId." };
  }
  return { ok: true };
}

/**
 * Spec section 3's "a user requesting approval must not approve their
 * own request," plus section 7's explicit "quotation preparer versus
 * pricing exception approver" named pair. `relatedUserIds` carries every
 * user id who must be excluded regardless of the policy's own
 * `allowRequesterSelfApprove` flag -- the flag can widen who ELSE is
 * eligible, never remove these two specific blocks (requester,
 * preparer-of-record for the business record the request targets).
 */
export function canDecideOwnRequest(deciderUserId: string, relatedUserIds: readonly string[]): boolean {
  return relatedUserIds.includes(deciderUserId);
}

/**
 * Which roles satisfy a given required-approver role -- an implicit
 * hierarchy (ADMINISTRATOR can always do what SALES_MANAGER can),
 * matching every existing two-tier role check in this codebase (picking
 * authorization, claim-resolution approval, credit-note recording all
 * gate on the literal pair ["SALES_MANAGER", "ADMINISTRATOR"], never
 * SALES_MANAGER alone).
 */
export function eligibleApproverRoles(requiredRole: ApproverRole): readonly ApproverRole[] {
  return requiredRole === "SALES_MANAGER" ? ["SALES_MANAGER", "ADMINISTRATOR"] : ["ADMINISTRATOR"];
}

// ---------------------------------------------------------------------------
// Threshold evaluation. Pure, deterministic, no I/O -- callers
// (lib/approvals/quotation-gate.ts) supply already-fetched policy rows
// and already-computed quotation values.
// ---------------------------------------------------------------------------

export type QuotationApprovalSnapshot = {
  maxDiscountPercent: string; // the single highest QuotationLine.discountPercent across the quotation, "0" if none
  subtotal: string;
  discountTotal: string;
  vatTotal: string;
  total: string;
  currency: string;
  lineCount: number;
};

export type ThresholdPolicyLike = {
  id: string;
  actionType: ApprovalActionType;
  thresholdPercent: string | null;
  requiredApproverRole: ApproverRole;
};

/**
 * Evaluates every active QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD policy
 * against a snapshot. Returns the first (and, by convention, policies
 * should not overlap) policy whose threshold is exceeded, or null if
 * none fire -- "normal quotations should not require unnecessary
 * approval" (spec section 4A) is structurally true when the policy list
 * is empty or every threshold is strictly below the quotation's own max
 * discount.
 */
export function evaluateQuotationDiscountPolicies(
  policies: readonly ThresholdPolicyLike[],
  snapshot: QuotationApprovalSnapshot
): ThresholdPolicyLike | null {
  const discount = parseScaledDecimal(snapshot.maxDiscountPercent);
  if (discount === null) return null;

  let firing: { policy: ThresholdPolicyLike; threshold: bigint } | null = null;
  for (const policy of policies) {
    if (policy.actionType !== "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD") continue;
    if (policy.thresholdPercent === null) continue;
    const threshold = parseScaledDecimal(policy.thresholdPercent);
    if (threshold === null) continue;
    if (discount > threshold && (firing === null || threshold < firing.threshold)) {
      // The most restrictive (lowest) firing threshold wins when more
      // than one policy is active at once -- the request should reflect
      // whichever rule the quotation actually breached most severely,
      // not an arbitrary array order.
      firing = { policy, threshold };
    }
  }
  return firing?.policy ?? null;
}

/**
 * Whether a previously-submitted snapshot still matches the quotation's
 * current values -- the "revalidated at execution time, not merely
 * submission" check (spec section 6) and the "changes to material
 * financial values after approval must invalidate" check (spec section
 * 4A), implemented as the exact same comparison either way: an approval
 * is only ever good for the precise values it was judged against.
 */
export function snapshotsMatch(a: QuotationApprovalSnapshot, b: QuotationApprovalSnapshot): boolean {
  return (
    a.maxDiscountPercent === b.maxDiscountPercent &&
    a.subtotal === b.subtotal &&
    a.discountTotal === b.discountTotal &&
    a.vatTotal === b.vatTotal &&
    a.total === b.total &&
    a.currency === b.currency &&
    a.lineCount === b.lineCount
  );
}

// ---------------------------------------------------------------------------
// Zod input schemas.
// ---------------------------------------------------------------------------

export const decideApprovalRequestSchema = z.object({
  decisionReason: z.string().max(2000).optional(),
});
export type DecideApprovalRequestInput = z.infer<typeof decideApprovalRequestSchema>;

export const rejectApprovalRequestSchema = z.object({
  decisionReason: z.string().min(1, "A reason is required to reject an approval request.").max(2000),
});
export type RejectApprovalRequestInput = z.infer<typeof rejectApprovalRequestSchema>;

export const withdrawApprovalRequestSchema = z.object({
  decisionReason: z.string().max(2000).optional(),
});

export const cancelApprovalRequestSchema = z.object({
  cancellationReason: z.string().min(1, "A reason is required to cancel an approval request.").max(2000),
});
export type CancelApprovalRequestInput = z.infer<typeof cancelApprovalRequestSchema>;

const percentThresholdSchema = decimalStringSchema.refine(
  (value) => {
    const scaled = parseScaledDecimal(value);
    return scaled !== null && scaled >= BigInt(0) && scaled <= BigInt(100 * 10000);
  },
  { message: "Must be a percentage between 0 and 100." }
);

const basePolicySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  requiredApproverRole: z.enum(APPROVER_ROLES),
  allowRequesterSelfApprove: z.boolean().optional(),
  overdueAfterHours: z.number().int().positive().max(8760).optional(), // up to one year
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveFrom must be YYYY-MM-DD")
    .optional(),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveTo must be YYYY-MM-DD")
    .optional(),
  active: z.boolean().optional(),
});

const quotationDiscountPolicySchema = basePolicySchema.extend({
  actionType: z.literal("QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD"),
  thresholdPercent: percentThresholdSchema,
});

const orderValuePolicySchema = basePolicySchema.extend({
  actionType: z.literal("ORDER_VALUE_EXCEEDS_THRESHOLD"),
  thresholdAmount: decimalStringSchema,
  currency: z.string().min(1).max(10),
});

export const createApprovalPolicySchema = z.discriminatedUnion("actionType", [quotationDiscountPolicySchema, orderValuePolicySchema]);
export type CreateApprovalPolicyInput = z.infer<typeof createApprovalPolicySchema>;

export const updateApprovalPolicySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  thresholdPercent: percentThresholdSchema.optional(),
  thresholdAmount: decimalStringSchema.optional(),
  currency: z.string().min(1).max(10).optional(),
  requiredApproverRole: z.enum(APPROVER_ROLES).optional(),
  allowRequesterSelfApprove: z.boolean().optional(),
  overdueAfterHours: z.number().int().positive().max(8760).nullable().optional(),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  active: z.boolean().optional(),
});
export type UpdateApprovalPolicyInput = z.infer<typeof updateApprovalPolicySchema>;

export const listApprovalsQuerySchema = z.object({
  module: z.enum(APPROVAL_MODULES).optional(),
  actionType: z.enum(APPROVAL_ACTION_TYPES).optional(),
  status: z.enum(APPROVAL_REQUEST_STATUSES).optional(),
  requestedById: z.string().min(1).optional(),
  decidedById: z.string().min(1).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  currency: z.string().max(10).optional(),
});
export type ListApprovalsQuery = z.infer<typeof listApprovalsQuerySchema>;
