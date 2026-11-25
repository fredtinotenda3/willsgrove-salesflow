import { NextRequest } from "next/server";
import { z } from "zod";
import { adminMutation, failure, invalidId, ok } from "@/lib/admin/route";
import { reasonOnlySchema } from "@/lib/admin/validation";
import { isValidId } from "@/lib/http";
import { deleteContact, updateContact } from "@/lib/admin/customer-admin";

type Ctx = { params: Promise<{ id: string; contactId: string }> };

const text = (max: number) => z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional();
const contactUpdateSchema = z.object({ name: z.string().trim().min(2).max(120).optional(), role: text(80), email: z.string().trim().email().max(160).or(z.literal("")).transform((v) => (v === "" ? null : v)).nullable().optional(), phone: text(40), reason: z.string().trim().min(3).max(500) }).strict();

async function ids(context: Ctx) {
  const { id, contactId } = await context.params;
  return isValidId(id) && isValidId(contactId) ? { id, contactId } : null;
}

/** PATCH /api/admin/customers/[id]/contacts/[contactId] -- edits a contact. */
export async function PATCH(request: NextRequest, context: Ctx) {
  const p = await ids(context);
  if (!p) return invalidId();
  return adminMutation(request, contactUpdateSchema, async (input, actor) => {
    const { reason, ...fields } = input;
    const result = await updateContact(p.id, p.contactId, fields, reason, actor.id);
    return result.ok ? ok() : failure(result);
  });
}

/** DELETE /api/admin/customers/[id]/contacts/[contactId] -- removes a contact that no quotation or message references. */
export async function DELETE(request: NextRequest, context: Ctx) {
  const p = await ids(context);
  if (!p) return invalidId();
  return adminMutation(request, reasonOnlySchema, async (input, actor) => {
    const result = await deleteContact(p.id, p.contactId, input.reason, actor.id);
    return result.ok ? ok() : failure(result);
  });
}
