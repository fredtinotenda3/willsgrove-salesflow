import { NextRequest } from "next/server";
import { z } from "zod";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { createContact } from "@/lib/admin/customer-admin";

type Ctx = { params: Promise<{ id: string }> };

const text = (max: number) => z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional();
export const contactCreateSchema = z.object({ name: z.string().trim().min(2).max(120), role: text(80), email: z.string().trim().email().max(160).or(z.literal("")).transform((v) => (v === "" ? null : v)).nullable().optional(), phone: text(40), reason: z.string().trim().min(3).max(500) }).strict();

/** POST /api/admin/customers/[id]/contacts -- adds a contact person to the customer. */
export async function POST(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, contactCreateSchema, async (input, actor) => {
    const { reason, ...fields } = input;
    const result = await createContact(id, fields, reason, actor.id);
    return result.ok ? ok({ id: result.id }) : failure(result);
  });
}
