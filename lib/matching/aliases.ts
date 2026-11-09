/**
 * Milestone 2B. Alias lookup and learning for both products and
 * customers -- the mechanism behind "the system gets better at
 * recognizing this customer's own wording over time" from the approved
 * Milestone 2 report. Two tables (ProductAlias, CustomerAlias;
 * prisma/schema.prisma), same shape and lifecycle: created the first
 * time a human confirms a FUZZY suggestion or picks a MANUAL match,
 * strengthened (timesConfirmed incremented) every time the same mapping
 * is confirmed again, looked up before any fuzzy scoring runs at all
 * (an exact alias hit is a stronger signal than any amount of token
 * overlap and is never re-scored).
 *
 * Both record* functions are find-or-create (an UPSERT by lookup, not a
 * blind create) run inside the caller's own transaction -- always called
 * from inside lib/review/confirm-review.ts's single order-confirmation
 * transaction, never as a side effect of simply viewing a suggestion.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeMatchText } from "@/lib/matching/normalize";

export type ProductAliasMatch = { productId: string; aliasId: string };
export type CustomerAliasMatch = { customerId: string; aliasId: string };

/**
 * Looks up a product alias for the given free text, customer-specific
 * alias taking precedence over a global one with the same normalized
 * text -- a customer-specific mapping is strictly more specific
 * information and should never be shadowed by a coincidentally-matching
 * global one. Two queries rather than one OR'd query so the precedence
 * is explicit in code, not dependent on ORDER BY/LIMIT semantics.
 */
export async function lookupProductAlias(
  description: string,
  customerId: string | null
): Promise<ProductAliasMatch | null> {
  const normalizedText = normalizeMatchText(description);
  if (normalizedText === "") return null;

  if (customerId) {
    const customerSpecific = await prisma.productAlias.findFirst({
      where: { customerId, normalizedText },
      select: { id: true, productId: true },
    });
    if (customerSpecific) {
      return { productId: customerSpecific.productId, aliasId: customerSpecific.id };
    }
  }

  const global = await prisma.productAlias.findFirst({
    where: { customerId: null, normalizedText },
    select: { id: true, productId: true },
  });
  return global ? { productId: global.productId, aliasId: global.id } : null;
}

export async function lookupCustomerAlias(headerText: string): Promise<CustomerAliasMatch | null> {
  const normalizedText = normalizeMatchText(headerText);
  if (normalizedText === "") return null;

  const alias = await prisma.customerAlias.findFirst({
    where: { normalizedText },
    select: { id: true, customerId: true },
  });
  return alias ? { customerId: alias.customerId, aliasId: alias.id } : null;
}

/**
 * Records that `rawText` means `productId`, scoped to `customerId` (null
 * for a global alias) -- find-or-create, incrementing timesConfirmed on
 * a repeat rather than creating a duplicate row. Must run inside `tx`
 * (the caller's open transaction; see lib/review/confirm-review.ts) so
 * this write is atomic with the order confirmation it's learning from --
 * an alias is never recorded for a line that didn't actually get
 * accepted into a real order.
 *
 * If a different alias already exists for this exact (customerId,
 * normalizedText) pointing at a DIFFERENT product, this call re-points it
 * to the new productId and resets timesConfirmed to 1 rather than
 * incrementing a stale count -- a human just told the system, again,
 * that this text means a (possibly different) product right now; an
 * old count from a previous, now-overridden mapping should not inflate
 * confidence in whatever it means today.
 */
export async function recordProductAlias(
  tx: Prisma.TransactionClient,
  params: { rawText: string; productId: string; customerId: string | null; createdById: string; isDemo?: boolean }
): Promise<void> {
  const normalizedText = normalizeMatchText(params.rawText);
  if (normalizedText === "") return;

  const existing = await tx.productAlias.findFirst({
    where: { customerId: params.customerId, normalizedText },
    select: { id: true, productId: true, timesConfirmed: true },
  });

  if (!existing) {
    await tx.productAlias.create({
      data: {
        customerId: params.customerId,
        rawText: params.rawText,
        normalizedText,
        productId: params.productId,
        createdById: params.createdById,
        isDemo: params.isDemo ?? false,
      },
    });
    return;
  }

  await tx.productAlias.update({
    where: { id: existing.id },
    data:
      existing.productId === params.productId
        ? { timesConfirmed: { increment: 1 }, lastConfirmedAt: new Date() }
        : { productId: params.productId, timesConfirmed: 1, lastConfirmedAt: new Date() },
  });
}

/** Same find-or-re-point-or-create behavior as recordProductAlias, for CustomerAlias. */
export async function recordCustomerAlias(
  tx: Prisma.TransactionClient,
  params: { rawText: string; customerId: string; createdById: string; isDemo?: boolean }
): Promise<void> {
  const normalizedText = normalizeMatchText(params.rawText);
  if (normalizedText === "") return;

  const existing = await tx.customerAlias.findFirst({
    where: { normalizedText },
    select: { id: true, customerId: true },
  });

  if (!existing) {
    await tx.customerAlias.create({
      data: {
        rawText: params.rawText,
        normalizedText,
        customerId: params.customerId,
        createdById: params.createdById,
        isDemo: params.isDemo ?? false,
      },
    });
    return;
  }

  await tx.customerAlias.update({
    where: { id: existing.id },
    data:
      existing.customerId === params.customerId
        ? { timesConfirmed: { increment: 1 }, lastConfirmedAt: new Date() }
        : { customerId: params.customerId, timesConfirmed: 1, lastConfirmedAt: new Date() },
  });
}
