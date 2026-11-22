import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  CreateCustomerInput,
  FieldErrors,
  UpdateCustomerInput,
} from "@/lib/customer-validation";
import { buildCustomerListWhere, isFilterEffectivelyEmpty, type CustomerListQuery } from "@/lib/customer-queries";

export type MutationFailure = {
  ok: false;
  status: number;
  message: string;
  fieldErrors?: FieldErrors;
};

export type CreateCustomerResult =
  | { ok: true; id: string }
  | MutationFailure;

export type UpdateCustomerResult =
  | { ok: true; changed: boolean }
  | MutationFailure;

const TRANSACTION_OPTIONS = { maxWait: 15000, timeout: 15000 };

// The only unique column besides the id is sapCustomerCode, so any unique
// violation on the customer table is a duplicate SAP customer code.
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

const duplicateCodeFailure: MutationFailure = {
  ok: false,
  status: 409,
  message: "A customer with this SAP customer code already exists.",
  fieldErrors: { sapCustomerCode: "This SAP customer code is already used." },
};

// Real Business Data Onboarding round (spec PART A, Phase 4b): the only
// foreign key updateCustomer can violate is priceListId (Customer.priceList's
// onDelete: SetNull means a PriceList being deleted can never leave a
// dangling reference -- the only way to get a P2003 here is a request
// naming a price-list id that doesn't exist).
function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  );
}

const unknownPriceListFailure: MutationFailure = {
  ok: false,
  status: 400,
  message: "That price list could not be found.",
  fieldErrors: { priceListId: "This price list no longer exists. Refresh and try again." },
};

// Real-world fix (incident follow-up): see lib/customer-queries.ts's
// isFilterEffectivelyEmpty for why this exists -- a filter with no
// search/category/status/priceListId narrows nothing, so running it
// silently reassigns every customer, including ones a previous, correctly
// scoped bulk-assign already set. This is the guard that would have
// caught the production incident (a scoped TM-USD assign immediately
// overwritten by an unfiltered BHOLA assign, because the search box had
// been cleared in between).
const unfilteredBulkAssignNotConfirmed: MutationFailure = {
  ok: false,
  status: 400,
  message:
    "No search or filter is applied, so this would reassign every customer, including any already assigned to a different list. Add a filter, or explicitly confirm you intend to apply this to every customer.",
  fieldErrors: { filter: "This matches every customer -- confirm that's intended before running it." },
};

export async function createCustomer(
  input: CreateCustomerInput,
  // isDemo is intentionally not part of CreateCustomerInput (and therefore
  // never settable via the public /api/customers route) -- only
  // prisma/seed.ts passes { isDemo: true }, so a demo row can only ever be
  // produced by the seed script, never by an HTTP request.
  options?: { isDemo?: boolean }
): Promise<CreateCustomerResult> {
  const isDemo = options?.isDemo ?? false;

  try {
    const customer = await prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          name: input.name,
          sapCustomerCode: input.sapCustomerCode,
          email: input.email,
          phone: input.phone,
          category: input.category,
          notes: input.notes,
          isDemo,
          ...(input.location
            ? { locations: { create: { ...input.location, isDefault: true, isDemo } } }
            : {}),
        },
        select: { id: true },
      });

      await tx.auditEvent.create({
        data: {
          actorId: null,
          action: "CUSTOMER_CREATE",
          entityType: "Customer",
          entityId: created.id,
          afterData: {
            name: input.name,
            sapCustomerCode: input.sapCustomerCode,
            email: input.email,
            phone: input.phone,
            category: input.category,
            notes: input.notes,
            status: "ACTIVE",
            location: input.location,
          },
        },
      });

      return created;
    }, TRANSACTION_OPTIONS);

    return { ok: true, id: customer.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return duplicateCodeFailure;
    }

    throw error;
  }
}

const UPDATABLE_KEYS = [
  "name",
  "sapCustomerCode",
  "email",
  "phone",
  "category",
  "notes",
  "status",
  "priceListId",
] as const;

export async function updateCustomer(
  id: string,
  changes: UpdateCustomerInput
): Promise<UpdateCustomerResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.customer.findUnique({
        where: { id },
        select: {
          name: true,
          sapCustomerCode: true,
          email: true,
          phone: true,
          category: true,
          notes: true,
          status: true,
          priceListId: true,
        },
      });

      if (!existing) {
        return {
          ok: false,
          status: 404,
          message: "Customer not found.",
        } satisfies MutationFailure;
      }

      const before: Record<string, string | null> = {};
      const after: Record<string, string | null> = {};
      const data: Prisma.CustomerUpdateInput = {};

      for (const key of UPDATABLE_KEYS) {
        const next = changes[key];

        if (next === undefined || next === existing[key]) {
          continue;
        }

        before[key] = existing[key];
        after[key] = next;
        Object.assign(data, { [key]: next });
      }

      if (Object.keys(after).length === 0) {
        return { ok: true, changed: false } as const;
      }

      await tx.customer.update({ where: { id }, data });

      await tx.auditEvent.create({
        data: {
          actorId: null,
          action: "CUSTOMER_UPDATE",
          entityType: "Customer",
          entityId: id,
          beforeData: before,
          afterData: after,
        },
      });

      return { ok: true, changed: true } as const;
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return duplicateCodeFailure;
    }

    if (isForeignKeyViolation(error)) {
      return unknownPriceListFailure;
    }

    throw error;
  }
}

export type BulkAssignPriceListResult =
  | { ok: true; matchedCount: number }
  | MutationFailure;

/**
 * Real-world fix (bulk price-list assignment): the real customer-master
 * export this business has carries no price-list column at all (see
 * app/price-lists/customers/page.tsx's own comment), so --
 * Customers assigned: 0 out of ~2,647 at the time this was written --
 * assigning one customer at a time through that page's existing
 * assignPriceList() is not a realistic path to ever finishing. This is
 * the deliberate, staff-driven alternative: assign EVERY customer
 * currently matching a filter (the exact same search/category/status/
 * priceListId filter already shown on /price-lists/customers, built by
 * the same buildCustomerListWhere() listCustomers uses, so "assign to
 * everyone matching my filter" can never target a different set than
 * what the staff member is looking at) to one target price list in a
 * single statement, rather than guessing a mapping from customer name
 * text -- that guess is exactly what this feature still leaves to a
 * human: they choose the filter (e.g. search "OK Supermarkets") and the
 * target list (e.g. OKUSDBYO) themselves, same deliberateness the
 * single-row assignment already had, just applied to many rows at once.
 *
 * An empty filter matches every customer -- not silently allowed (see the
 * production incident this round's unfilteredBulkAssignNotConfirmed
 * documents): it's still a legitimate action (e.g. assigning a
 * default/fallback list to everyone still unassigned), just one that now
 * requires the caller to say confirmedUnfiltered: true rather than that
 * being what an empty search box defaults to. The UI's live matched
 * count is still the first line of defense, but a client-side-only check
 * isn't enough for a mutation with this blast radius -- this is the
 * actual guard, enforced here regardless of what called it.
 */
export async function bulkAssignPriceList(
  filter: Pick<CustomerListQuery, "search" | "category" | "status" | "priceListId">,
  targetPriceListId: string | null,
  confirmedUnfiltered: boolean
): Promise<BulkAssignPriceListResult> {
  if (isFilterEffectivelyEmpty(filter) && !confirmedUnfiltered) {
    return unfilteredBulkAssignNotConfirmed;
  }

  if (targetPriceListId !== null) {
    const priceList = await prisma.priceList.findUnique({
      where: { id: targetPriceListId },
      select: { id: true },
    });

    if (!priceList) {
      return unknownPriceListFailure;
    }
  }

  const where = buildCustomerListWhere(filter);

  try {
    return await prisma.$transaction(async (tx) => {
      // Real-world fix (incident follow-up): snapshot what every matched
      // customer's priceListId was BEFORE this overwrites it, grouped by
      // list rather than one row per customer -- same "one audit row per
      // batch" principle the single afterData summary already followed,
      // just extended so a mistake like the production incident (an
      // unfiltered assign silently overwriting a correct one) can
      // actually be diagnosed and reversed from the audit log afterward,
      // not just detected after the fact.
      const beforeGroups = await tx.customer.groupBy({
        by: ["priceListId"],
        where,
        _count: { _all: true },
      });

      const { count } = await tx.customer.updateMany({
        where,
        data: { priceListId: targetPriceListId },
      });

      await tx.auditEvent.create({
        data: {
          actorId: null,
          action: "CUSTOMER_BULK_PRICE_LIST_ASSIGN",
          entityType: "Customer",
          entityId: "bulk",
          beforeData: {
            byPreviousPriceListId: beforeGroups.map((g) => ({
              priceListId: g.priceListId,
              count: g._count._all,
            })),
          },
          afterData: { filter, targetPriceListId, matchedCount: count },
        },
      });

      return { ok: true, matchedCount: count } as const;
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return unknownPriceListFailure;
    }

    throw error;
  }
}