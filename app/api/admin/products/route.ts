import { NextRequest } from "next/server";
import { adminMutation, failure, ok } from "@/lib/admin/route";
import { productCreateSchema } from "@/lib/admin/validation";
import { createProduct } from "@/lib/admin/catalogue-admin";

/** POST /api/admin/products -- create a product (SAP item code is required and unique; never generated). */
export async function POST(request: NextRequest) {
  return adminMutation(request, productCreateSchema, async (input, actor) => {
    const result = await createProduct(input, actor.id);
    return result.ok ? ok({ id: result.id }) : failure(result);
  });
}
