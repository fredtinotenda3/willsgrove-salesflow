
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseSapProductCsv } from "@/lib/sap-product-csv";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json(
        {
          success: false,
          message: "Please select a SAP product CSV file.",
        },
        { status: 400 }
      );
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      return Response.json(
        {
          success: false,
          message: "Only CSV files are supported.",
        },
        { status: 400 }
      );
    }

    if (file.size === 0) {
      return Response.json(
        {
          success: false,
          message: "The selected CSV file is empty.",
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json(
        {
          success: false,
          message: "The CSV file exceeds the 25 MB size limit.",
        },
        { status: 413 }
      );
    }

    const csvText = await file.text();
    const parsed = parseSapProductCsv(csvText);

    if (!parsed.success) {
      return Response.json(
        {
          success: false,
          message: "The SAP CSV file contains validation errors.",
          fileName: file.name,
          totalRows: parsed.totalRows,
          validRows: parsed.products.length,
          errorCount: parsed.errors.length,
          errors: parsed.errors,
          duplicateCodes: parsed.duplicateCodes,
        },
        { status: 422 }
      );
    }

    const sapItemCodes = parsed.products.map(
      (product) => product.sapItemCode
    );

    const existingProducts = await prisma.product.findMany({
      where: {
        sapItemCode: {
          in: sapItemCodes,
        },
      },
      select: {
        sapItemCode: true,
        itemName: true,
        barcode: true,
        category: true,
      },
    });

    const existingByCode = new Map(
      existingProducts.map((product) => [
        product.sapItemCode,
        product,
      ])
    );

    const newProducts = [];
    const unchangedProducts = [];
    const changedProducts = [];

    for (const product of parsed.products) {
      const existing = existingByCode.get(product.sapItemCode);

      if (!existing) {
        newProducts.push(product);
        continue;
      }

      const hasChanges =
        existing.itemName !== product.itemName ||
        existing.barcode !== product.barcode ||
        existing.category !== product.category;

      if (hasChanges) {
        changedProducts.push({
          sapItemCode: product.sapItemCode,
          current: existing,
          incoming: product,
        });
      } else {
        unchangedProducts.push(product);
      }
    }

    return Response.json({
      success: true,
      message: "SAP product CSV validated successfully.",
      fileName: file.name,
      summary: {
        totalRows: parsed.totalRows,
        validRows: parsed.products.length,
        newProducts: newProducts.length,
        changedProducts: changedProducts.length,
        unchangedProducts: unchangedProducts.length,
        errorCount: parsed.errors.length,
      },
      newProducts,
      changedProducts,
      unchangedProducts,
      errors: parsed.errors,
      duplicateCodes: parsed.duplicateCodes,
      importExecuted: false,
    });
  } catch (error) {
    console.error("SAP product import preview failed:", error);

    return Response.json(
      {
        success: false,
        message: "Unable to preview the SAP product import.",
      },
      { status: 500 }
    );
  }
}
