
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return Response.json(
      {
        success: true,
        application: "Willsgrove SalesFlow",
        database: "connected",
        message: "Database connection is healthy.",
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Database health check failed:", error);

    return Response.json(
      {
        success: false,
        application: "Willsgrove SalesFlow",
        database: "disconnected",
        message: "Could not connect to the database.",
      },
      { status: 503 }
    );
  }
}
