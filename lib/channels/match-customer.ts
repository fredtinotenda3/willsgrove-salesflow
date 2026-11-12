import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Suggests a
 * customer/contact match for an inbound MessageIntake's raw fromAddress
 * -- NEVER auto-confirmed. Same "never silently guess" principle the
 * existing invoice-reconciliation matcher already follows (lib/
 * invoice-reconciliation/matching.ts): a suggestion this function
 * returns is written to MessageIntake.customerId/customerContactId as a
 * hint only, and a human reviewer can accept, change, or clear it before
 * ever converting/linking the intake to a real commercial transaction
 * (spec point 1's "support human review").
 *
 * Deliberately returns at most ONE suggestion, never a ranked list --
 * when more than one customer plausibly matches (two different
 * customers happen to share a contact's email, or a phone-number
 * heuristic hits more than one row), returning null is the honest
 * answer: a reviewer with no suggestion is more careful than a reviewer
 * shown an arbitrary pick with the same confident styling as a certain
 * match.
 */

export type CustomerMatchSuggestion = {
  customerId: string;
  customerContactId: string | null;
};

export async function matchCustomerForAddress(
  fromAddress: string,
  channel: "EMAIL" | "WHATSAPP"
): Promise<CustomerMatchSuggestion | null> {
  if (channel === "EMAIL") {
    return matchByEmail(fromAddress);
  }
  return matchByPhone(fromAddress);
}

async function matchByEmail(rawAddress: string): Promise<CustomerMatchSuggestion | null> {
  const email = normalizeEmail(rawAddress);
  if (!email) return null;

  const [customers, contacts] = await Promise.all([
    prisma.customer.findMany({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true }, take: 2 }),
    prisma.customerContact.findMany({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, customerId: true }, take: 2 }),
  ]);

  // Ambiguous across either table, or across both combined -- bail out
  // rather than guess which one the reviewer meant.
  const distinctCustomerIds = new Set([...customers.map((c) => c.id), ...contacts.map((c) => c.customerId)]);
  if (distinctCustomerIds.size !== 1) return null;

  const customerId = [...distinctCustomerIds][0];
  const matchedContact = contacts.find((c) => c.customerId === customerId);
  return { customerId, customerContactId: matchedContact?.id ?? null };
}

async function matchByPhone(rawAddress: string): Promise<CustomerMatchSuggestion | null> {
  // Zimbabwe mobile numbers vary in how they're written across a
  // WhatsApp sender id (which arrives E.164-shaped, e.g. "263771234567")
  // versus however a customer's phone number was keyed into SalesFlow
  // (Milestone 1 import, or typed by hand -- "0771234567", "+263 77 123
  // 4567", etc.). Rather than guess a single canonical format, this
  // matches on the last 9 digits (a Zimbabwe subscriber number's length
  // once the country code and/or leading trunk "0" are stripped), which
  // tolerates every formatting variant actually seen in this project's
  // own CSV imports (docs/sap-exports) without needing a phone-number
  // parsing library this project does not otherwise depend on.
  const digits = rawAddress.replace(/\D/g, "");
  if (digits.length < 9) return null;
  const last9 = digits.slice(-9);

  const [customers, contacts] = await Promise.all([
    prisma.customer.findMany({ where: { phone: { contains: last9 } }, select: { id: true }, take: 2 }),
    prisma.customerContact.findMany({ where: { phone: { contains: last9 } }, select: { id: true, customerId: true }, take: 2 }),
  ]);

  const distinctCustomerIds = new Set([...customers.map((c) => c.id), ...contacts.map((c) => c.customerId)]);
  if (distinctCustomerIds.size !== 1) return null;

  const customerId = [...distinctCustomerIds][0];
  const matchedContact = contacts.find((c) => c.customerId === customerId);
  return { customerId, customerContactId: matchedContact?.id ?? null };
}

function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  // Deliberately permissive (not a full RFC 5322 validator -- this
  // project has no such dependency and inbound provider data is already
  // a real address by construction); just enough to reject obviously
  // malformed input before using it in a query.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}
