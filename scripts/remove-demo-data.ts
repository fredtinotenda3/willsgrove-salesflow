/**
 * One-command demo-data removal.
 *
 * Run with: npm run db:remove-demo  (see SETUP-WINDOWS.md)
 *
 * Deletes every row prisma/seed.ts marked isDemo: true -- and nothing
 * else. The admin account (never isDemo) and any real data created
 * through the application are untouched.
 *
 * Deletion order matters: the schema's onDelete: Restrict foreign keys
 * (see prisma/schema.prisma) mean a child row must be deleted before its
 * parent, or Postgres rejects the delete. This walks the dependency graph
 * leaves-first: verification/pricing/approval/status-history/document
 * rows that reference a demo order's lines or the order itself, then the
 * lines, then the orders, then locations, then customers, then products.
 * All in one transaction, so a partial run can never leave the database
 * in a half-cleaned state.
 *
 * Milestone 1 (Master data from SAP) added four models, each with its own
 * isDemo flag, so each is cleaned up independently rather than cascading
 * from an existing row:
 *   - CustomerContact -> Customer is onDelete: Restrict, so contacts must
 *     be deleted before the customers they belong to (same hard
 *     constraint as CustomerLocation -> Customer below).
 *   - PriceListEntry -> PriceList is onDelete: Restrict, so entries must
 *     be deleted before their price list. PriceListEntry -> Product is
 *     onDelete: SetNull, so it imposes no ordering against products.
 *   - PriceList is referenced by Customer.priceListId as onDelete:
 *     SetNull, so deleting a demo price list never blocks on customers
 *     (Postgres nulls the column instead of rejecting the delete) -- no
 *     ordering needed there.
 *   - TaxCode has no incoming foreign keys at all (Product.vatCode is a
 *     plain string, matching the existing sapItemCode/sapCustomerCode
 *     pattern, not an FK), so it can be deleted independently at any
 *     point.
 *
 * Milestone 6A (Invoice Claims Management) added four more models
 * (InvoiceClaim, InvoiceClaimLine, ClaimResolution,
 * InvoiceClaimAttachment), each with its own isDemo flag and every FK
 * onDelete: Restrict -- cleaned up as their own leaves-first group,
 * before the SapInvoice/SapInvoiceLine/CustomerOrder/Customer/User rows
 * they reference (see that block's own comment below for the exact
 * order).
 *
 * Milestone 6B (Returns & Credit Notes) added three more models
 * (ClaimReturn, CreditNote, CreditNoteImportBatch), each with its own
 * isDemo flag and every FK onDelete: Restrict. Deleted as their own
 * leaves-first group BEFORE the Milestone 6A block above's InvoiceClaim/
 * InvoiceClaimLine deletes (ClaimReturn.claimLineId and CreditNote.claimId
 * both reference them) and BEFORE the Milestone 5 block below's
 * SapInvoice delete (CreditNote.sapInvoiceId references it): ClaimReturn
 * first (it references CreditNote itself, as well as InvoiceClaim/
 * InvoiceClaimLine), then CreditNote, then CreditNoteImportBatch (which
 * CreditNote references).
 *
 * Milestone 0 fix (round 4): this is 12 sequential round trips over one
 * connection to a pooled Neon endpoint, and Prisma's *default* interactive
 * transaction timeout is 5000ms -- comfortably exceeded under real network
 * latency (confirmed: P2028 "Transaction already closed... timeout 5000ms,
 * however 5315ms passed"). The deletes stay sequential rather than being
 * parallelized with Promise.all: Prisma explicitly documents that issuing
 * concurrent queries against the *same* interactive-transaction client is
 * unsafe, since all of them share one underlying connection that isn't
 * guaranteed safe for concurrent use -- that would trade a timeout bug for
 * a harder-to-reproduce race. The timeout and maxWait below are raised
 * instead, which is the fix Prisma's own docs recommend for a transaction
 * that is simply slower than the default allows, not broken.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

// Generous on purpose: this script runs rarely (a manual, one-off cleanup
// command), never in a request path, so there's no latency budget it has
// to respect. 60s is comfortably above the slowest observed run (12 round
// trips to a cold-started pooled Postgres endpoint); 10s maxWait is how
// long to wait for a free connection from the pool before giving up, kept
// short so a genuinely stuck pool still fails fast and loud rather than
// hanging indefinitely.
const TRANSACTION_TIMEOUT_MS = 60_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;

async function main() {
  console.log("Removing demo data (isDemo: true rows only)...");

  const result = await prisma.$transaction(
    async (tx) => {
      const verifications = await tx.productVerification.deleteMany({
        where: { orderLine: { isDemo: true } },
      });

      const priceDecisions = await tx.priceDecision.deleteMany({
        where: { orderLine: { isDemo: true } },
      });

      const approvals = await tx.orderApproval.deleteMany({
        where: { order: { isDemo: true } },
      });

      const statusHistory = await tx.orderStatusHistory.deleteMany({
        where: { order: { isDemo: true } },
      });

      const documents = await tx.orderDocument.deleteMany({
        where: { order: { isDemo: true } },
      });

      // Milestone 6B (Returns & Credit Notes). Must come before the
      // Milestone 6A block immediately below (ClaimReturn/CreditNote both
      // reference InvoiceClaim and/or InvoiceClaimLine, Restrict) and
      // before the Milestone 5 SapInvoice delete further below
      // (CreditNote.sapInvoiceId, Restrict). ClaimReturn before CreditNote
      // (ClaimReturn.creditNoteId, Restrict); CreditNote before its own
      // CreditNoteImportBatch (Restrict).
      const claimReturns = await tx.claimReturn.deleteMany({
        where: { isDemo: true },
      });

      const creditNotes = await tx.creditNote.deleteMany({
        where: { isDemo: true },
      });

      const creditNoteImportBatches = await tx.creditNoteImportBatch.deleteMany({
        where: { isDemo: true },
      });

      // Milestone 6A (Invoice Claims Management). Every FK off these four
      // new tables is onDelete: Restrict, so every leaf must go before
      // its parent, and the whole group must go before SapInvoiceLine/
      // SapInvoice/CustomerOrder/Customer/User below (all of which
      // InvoiceClaim and/or InvoiceClaimLine reference). Attachments and
      // resolutions are both children of InvoiceClaim only (no deeper
      // dependents), so either order between them is safe; lines must
      // come after both (an attachment may reference a specific
      // claimLineId) and before the claim itself.
      const invoiceClaimAttachments = await tx.invoiceClaimAttachment.deleteMany({
        where: { isDemo: true },
      });

      const claimResolutions = await tx.claimResolution.deleteMany({
        where: { isDemo: true },
      });

      const invoiceClaimLines = await tx.invoiceClaimLine.deleteMany({
        where: { isDemo: true },
      });

      const invoiceClaims = await tx.invoiceClaim.deleteMany({
        where: { isDemo: true },
      });

      // Milestone 5 (SAP Invoice Reconciliation). Lines before their
      // invoice (Restrict), invoices before their import batch (Restrict),
      // and all three before orderLines/orders below -- SapInvoiceLine's
      // matchedOrderId/matchedOrderLineId FKs are Restrict, not SetNull,
      // the same "never silently lose traceability" choice this schema
      // makes everywhere else.
      const sapInvoiceLines = await tx.sapInvoiceLine.deleteMany({
        where: { isDemo: true },
      });

      const sapInvoices = await tx.sapInvoice.deleteMany({
        where: { isDemo: true },
      });

      const sapInvoiceImportBatches = await tx.sapInvoiceImportBatch.deleteMany({
        where: { isDemo: true },
      });

      const orderLines = await tx.orderLine.deleteMany({
        where: { isDemo: true },
      });

      const orders = await tx.customerOrder.deleteMany({
        where: { isDemo: true },
      });

      const stockLines = await tx.stockSnapshotLine.deleteMany({
        where: { product: { isDemo: true } },
      });

      // Milestone 1 master-data models. Entries before their list
      // (Restrict); the tax code table has no dependents at all.
      const priceListEntries = await tx.priceListEntry.deleteMany({
        where: { isDemo: true },
      });

      const priceLists = await tx.priceList.deleteMany({
        where: { isDemo: true },
      });

      const taxCodes = await tx.taxCode.deleteMany({
        where: { isDemo: true },
      });

      const locations = await tx.customerLocation.deleteMany({
        where: { isDemo: true },
      });

      // Contacts before customers (Restrict), same reasoning as locations
      // above.
      const customerContacts = await tx.customerContact.deleteMany({
        where: { isDemo: true },
      });

      const customers = await tx.customer.deleteMany({
        where: { isDemo: true },
      });

      const products = await tx.product.deleteMany({
        where: { isDemo: true },
      });

      // Defensive only: prisma/seed.ts does not create demo User rows (see
      // its comments on why), so this is expected to delete 0 rows. Kept
      // here so the script stays correct if that ever changes.
      await tx.session.deleteMany({ where: { user: { isDemo: true } } });
      const users = await tx.user.deleteMany({ where: { isDemo: true } });

      await tx.auditEvent.create({
        data: {
          actorId: null,
          action: "DEMO_DATA_REMOVED",
          entityType: "System",
          entityId: "demo-data-removal",
          afterData: {
            orders: orders.count,
            orderLines: orderLines.count,
            customers: customers.count,
            customerContacts: customerContacts.count,
            locations: locations.count,
            products: products.count,
            verifications: verifications.count,
            priceDecisions: priceDecisions.count,
            approvals: approvals.count,
            statusHistory: statusHistory.count,
            documents: documents.count,
            stockLines: stockLines.count,
            priceListEntries: priceListEntries.count,
            priceLists: priceLists.count,
            taxCodes: taxCodes.count,
            users: users.count,
            sapInvoiceLines: sapInvoiceLines.count,
            sapInvoices: sapInvoices.count,
            sapInvoiceImportBatches: sapInvoiceImportBatches.count,
            invoiceClaimAttachments: invoiceClaimAttachments.count,
            claimResolutions: claimResolutions.count,
            invoiceClaimLines: invoiceClaimLines.count,
            invoiceClaims: invoiceClaims.count,
            claimReturns: claimReturns.count,
            creditNotes: creditNotes.count,
            creditNoteImportBatches: creditNoteImportBatches.count,
          },
        },
      });

      return {
        orders: orders.count,
        orderLines: orderLines.count,
        customers: customers.count,
        customerContacts: customerContacts.count,
        locations: locations.count,
        products: products.count,
        priceListEntries: priceListEntries.count,
        priceLists: priceLists.count,
        taxCodes: taxCodes.count,
        users: users.count,
        sapInvoiceLines: sapInvoiceLines.count,
        sapInvoices: sapInvoices.count,
        sapInvoiceImportBatches: sapInvoiceImportBatches.count,
        invoiceClaimAttachments: invoiceClaimAttachments.count,
        claimResolutions: claimResolutions.count,
        invoiceClaimLines: invoiceClaimLines.count,
        invoiceClaims: invoiceClaims.count,
        claimReturns: claimReturns.count,
        creditNotes: creditNotes.count,
        creditNoteImportBatches: creditNoteImportBatches.count,
      };
    },
    {
      timeout: TRANSACTION_TIMEOUT_MS,
      maxWait: TRANSACTION_MAX_WAIT_MS,
    },
  );

  console.log("Demo data removed:");
  console.log(`  Orders:           ${result.orders}`);
  console.log(`  Order lines:      ${result.orderLines}`);
  console.log(`  Customers:        ${result.customers}`);
  console.log(`  Customer contacts: ${result.customerContacts}`);
  console.log(`  Customer locations: ${result.locations}`);
  console.log(`  Products:         ${result.products}`);
  console.log(`  Price list entries: ${result.priceListEntries}`);
  console.log(`  Price lists:      ${result.priceLists}`);
  console.log(`  Tax codes:        ${result.taxCodes}`);
  console.log(`  Users:            ${result.users}`);
  console.log(`  SAP invoice lines: ${result.sapInvoiceLines}`);
  console.log(`  SAP invoices:     ${result.sapInvoices}`);
  console.log(`  SAP invoice import batches: ${result.sapInvoiceImportBatches}`);
  console.log(`  Invoice claims:   ${result.invoiceClaims}`);
  console.log(`  Invoice claim lines: ${result.invoiceClaimLines}`);
  console.log(`  Claim resolutions: ${result.claimResolutions}`);
  console.log(`  Invoice claim attachments: ${result.invoiceClaimAttachments}`);
  console.log(`  Claim returns:    ${result.claimReturns}`);
  console.log(`  Credit notes:     ${result.creditNotes}`);
  console.log(`  Credit note import batches: ${result.creditNoteImportBatches}`);
}

main()
  .catch((error) => {
    console.error("Demo data removal failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
