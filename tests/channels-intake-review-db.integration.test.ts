import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 10 (Communication Channels & Fulfilment). DB-backed
 * acceptance tests for the message-intake review layer
 * (lib/channels/intake-review.ts) -- recordInboundMessage's idempotent
 * dedup on externalMessageId, every review action's "already reviewed"
 * refusal once a message has left RECEIVED, and the one path that
 * matters most: convertMessageIntakeToPoIntake actually calling the
 * EXISTING, unmodified lib/po-intake.ts pipeline and producing a real
 * OrderDocument -- against a REAL database through a REAL generated
 * @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same reason as
 * tests/picking-db.integration.test.ts and
 * tests/fulfilment-db.integration.test.ts: @prisma/client in this sandbox
 * is a stale stub that does not know about MessageIntake/MessageAttachment
 * at all (see docs/milestones/PROGRESS.md's Milestone 10 "Honest
 * verification results"). Every lib touched here is imported with a
 * dynamic `await import(...)` INSIDE the (skippable) test bodies below,
 * never a static top-of-file import.
 *
 * On a machine where `prisma generate` has actually run against the real
 * schema (including this milestone's migration), set
 * RUN_DB_INTEGRATION_TESTS=1 to include it:
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` at least once first (an admin user
 * must already exist). No customer is required -- every message here
 * uses an address that deliberately matches no existing Customer/
 * CustomerContact, so matchCustomerForAddress always returns null and
 * this test never depends on seeded customer data beyond the admin user.
 *
 * Every row this test creates is marked isDemo: true.
 */
const RUN_DB_INTEGRATION_TESTS =
  Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 10: message intake review", () => {
  let skipAll = false;
  let adminId: string;

  const createdIntakeIds: string[] = [];
  const createdOrderDocumentIds: string[] = [];
  const uniqueSuffix = `inttest-${Date.now()}`;

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    if (!admin) {
      console.log(
        "Skipping Milestone 10 message-intake review DB integration test: need an admin user. " +
          "Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }
    adminId = admin.id;
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      await prisma.auditEvent.deleteMany({ where: { entityType: "MessageIntake" } });
      // MessageAttachment rows cascade-delete with their MessageIntake.
      await prisma.messageIntake.deleteMany({ where: { id: { in: createdIntakeIds } } });
      for (const documentId of createdOrderDocumentIds) {
        await prisma.orderDocument.delete({ where: { id: documentId } }).catch(() => undefined);
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it("recordInboundMessage dedups on externalMessageId -- a redelivered webhook never creates a second row", async () => {
    if (skipAll) return;
    const { recordInboundMessage } = await import("@/lib/channels/intake-review");

    const externalMessageId = `wamid-${uniqueSuffix}-dedup`;
    const first = await recordInboundMessage({
      channel: "WHATSAPP",
      externalMessageId,
      fromAddress: `26377${uniqueSuffix.slice(-7)}`,
      bodyText: "Hello, I'd like to place an order.",
      isDemo: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.message);
    createdIntakeIds.push(first.messageIntakeId);
    expect(first.duplicate).toBe(false);

    const redelivered = await recordInboundMessage({
      channel: "WHATSAPP",
      externalMessageId,
      fromAddress: `26377${uniqueSuffix.slice(-7)}`,
      bodyText: "Hello, I'd like to place an order.",
      isDemo: true,
    });
    expect(redelivered.ok).toBe(true);
    if (!redelivered.ok) throw new Error(redelivered.message);
    expect(redelivered.duplicate).toBe(true);
    expect(redelivered.messageIntakeId).toBe(first.messageIntakeId);

    const { prisma } = await import("@/lib/prisma");
    const count = await prisma.messageIntake.count({ where: { externalMessageId } });
    expect(count).toBe(1);
  });

  it("rejects an empty sender address and an oversized attachment", async () => {
    if (skipAll) return;
    const { recordInboundMessage, MAX_ATTACHMENT_BYTES } = await import("@/lib/channels/intake-review");

    const noSender = await recordInboundMessage({ channel: "MANUAL", fromAddress: "   ", bodyText: "x", isDemo: true });
    expect(noSender.ok).toBe(false);
    if (!noSender.ok) expect(noSender.status).toBe(400);

    const tooBig = await recordInboundMessage({
      channel: "MANUAL",
      fromAddress: `oversize-${uniqueSuffix}@example.com`,
      bodyText: "x",
      attachments: [{ bytes: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1), originalFileName: "big.bin", claimedMimeType: "application/octet-stream" }],
      isDemo: true,
    });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.status).toBe(413);
  });

  it("every review action refuses once a message has already been reviewed, and refuses marking itself a duplicate of itself", async () => {
    if (skipAll) return;
    const { recordInboundMessage, ignoreMessageIntake, markMessageIntakeDuplicate, linkMessageIntakeToOrder } = await import("@/lib/channels/intake-review");

    const created = await recordInboundMessage({
      channel: "MANUAL",
      fromAddress: `review-twice-${uniqueSuffix}@example.com`,
      bodyText: "Just checking on my last delivery.",
      isDemo: true,
    });
    if (!created.ok) throw new Error(created.message);
    createdIntakeIds.push(created.messageIntakeId);

    const selfDuplicate = await markMessageIntakeDuplicate(created.messageIntakeId, adminId, created.messageIntakeId);
    expect(selfDuplicate.ok).toBe(false);
    if (!selfDuplicate.ok) expect(selfDuplicate.status).toBe(400);

    const ignored = await ignoreMessageIntake(created.messageIntakeId, adminId, "General chat, not a transaction.");
    expect(ignored.ok).toBe(true);

    const secondReview = await ignoreMessageIntake(created.messageIntakeId, adminId);
    expect(secondReview.ok).toBe(false);
    if (!secondReview.ok) expect(secondReview.status).toBe(409);

    const linkAfterIgnored = await linkMessageIntakeToOrder(created.messageIntakeId, adminId, "non-existent-order-id");
    expect(linkAfterIgnored.ok).toBe(false);
    // 404 (order not found) is checked before the "already reviewed" 409 in
    // linkMessageIntakeToOrder's own order, so either refusal is acceptable
    // here -- what matters is that it never silently succeeds a second time.
  });

  it("convertMessageIntakeToPoIntake calls the existing createPoIntake pipeline and produces a real OrderDocument, then refuses a second conversion", async () => {
    if (skipAll) return;
    const { recordInboundMessage, convertMessageIntakeToPoIntake } = await import("@/lib/channels/intake-review");
    const { prisma } = await import("@/lib/prisma");

    const created = await recordInboundMessage({
      channel: "EMAIL",
      fromAddress: `convert-${uniqueSuffix}@example.com`,
      fromDisplayName: "Test Customer",
      subject: "Purchase order",
      bodyText: `Please supply 10 x Baby Marrow 250G ${uniqueSuffix}. Deliver to our usual address.`,
      isDemo: true,
    });
    if (!created.ok) throw new Error(created.message);
    createdIntakeIds.push(created.messageIntakeId);

    const converted = await convertMessageIntakeToPoIntake(created.messageIntakeId, adminId, { reviewNotes: "Looks like a real order." });
    expect(converted.ok).toBe(true);
    if (!converted.ok) throw new Error(converted.message);
    expect(converted.resultingOrderDocumentId).toBeTruthy();
    createdOrderDocumentIds.push(converted.resultingOrderDocumentId!);

    const intakeAfter = await prisma.messageIntake.findUniqueOrThrow({
      where: { id: created.messageIntakeId },
      select: { status: true, reviewedById: true, resultingOrderDocumentId: true },
    });
    expect(intakeAfter.status).toBe("CONVERTED");
    expect(intakeAfter.reviewedById).toBe(adminId);
    expect(intakeAfter.resultingOrderDocumentId).toBe(converted.resultingOrderDocumentId);

    const document = await prisma.orderDocument.findUnique({ where: { id: converted.resultingOrderDocumentId! }, select: { id: true, uploadedById: true } });
    expect(document).not.toBeNull();
    // Attributed to the reviewer who made the call, never to the message
    // itself -- the exact distinction this milestone's design decision
    // ("convert... attributing the resulting OrderDocument to the
    // reviewer, never to the message") requires.
    expect(document!.uploadedById).toBe(adminId);

    const secondConvert = await convertMessageIntakeToPoIntake(created.messageIntakeId, adminId);
    expect(secondConvert.ok).toBe(false);
    if (!secondConvert.ok) expect(secondConvert.status).toBe(409);
  });
});
