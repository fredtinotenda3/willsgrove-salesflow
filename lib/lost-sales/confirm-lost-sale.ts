import "server-only";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import {
  computeLostSaleConsumption,
  deriveUnfulfilledDemandStatus,
  validateLostSaleReason,
  type DecisionSourceValue,
  type LostSaleReasonValue,
} from "@/lib/lost-sales/validation";
import { resolveEstimatedLostSaleValue } from "@/lib/lost-sales/estimate-value";

/**
 * Milestone 4 (Lost-Sales Management).
 *
 * Confirms a genuine lost sale -- always its own deliberate, explicit
 * action (spec section 3's central rule: "never automatically classify
 * unavailable products as lost sales"), never implied automatically by a
 * cancellation decision alone. Role-restricted to SALES_MANAGER/
 * ADMINISTRATOR, enforced at the API route (same two-tier pattern as
 * lib/picking/authorize-picking.ts) -- never duplicated into this
 * function itself.
 *
 * The confirmed quantity is drawn from (cancelledQuantity -
 * confirmedLostQuantity) first, then any shortfall from
 * outstandingQuantity -- see computeLostSaleConsumption's own comment
 * for the exact rule this implements (spec test scenario 12: conversion
 * from outstanding demand to confirmed lost quantity where appropriate).
 */
export type ConfirmLostSaleInput = {
  unfulfilledDemandId: string;
  quantity: string;
  reason: LostSaleReasonValue;
  reasonDetail?: string;
  decisionSource: DecisionSourceValue;
  remarks?: string;
};

export type ConfirmLostSaleResult =
  | {
      ok: true;
      record: {
        id: string;
        quantity: string;
        estimatedUnitPrice: string | null;
        estimatedValue: string | null;
        estimatedValueSource: "ORDER_LINE_APPROVED_PRICE" | "PRICE_LIST_ENTRY" | null;
      };
      demand: { id: string; status: string };
    }
  | { ok: false; status: number; message: string };

export async function confirmLostSale(input: ConfirmLostSaleInput, actorId: string): Promise<ConfirmLostSaleResult> {
  const reasonCheck = validateLostSaleReason(input.reason, input.reasonDetail);
  if (!reasonCheck.ok) {
    return { ok: false, status: 400, message: reasonCheck.message };
  }

  const demand = await prisma.unfulfilledDemand.findUnique({
    where: { id: input.unfulfilledDemandId },
    select: {
      id: true,
      orderLineId: true,
      customerId: true,
      productId: true,
      sapItemCodeSnapshot: true,
      unavailableQuantity: true,
      outstandingQuantity: true,
      cancelledQuantity: true,
      substitutedQuantity: true,
      confirmedLostQuantity: true,
    },
  });
  if (!demand) {
    return { ok: false, status: 404, message: "Unfulfilled demand record not found." };
  }

  const consumption = computeLostSaleConsumption(
    input.quantity,
    demand.cancelledQuantity.toString(),
    demand.confirmedLostQuantity.toString(),
    demand.outstandingQuantity.toString()
  );
  if (!consumption.ok) {
    return { ok: false, status: 400, message: consumption.message };
  }

  const newStatus = deriveUnfulfilledDemandStatus({
    unavailableQuantity: demand.unavailableQuantity.toString(),
    outstandingQuantity: consumption.newOutstandingQuantity,
    cancelledQuantity: consumption.newCancelledQuantity,
    substitutedQuantity: demand.substitutedQuantity.toString(),
    confirmedLostQuantity: consumption.newConfirmedLostQuantity,
  });

  const confirmedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const estimate = await resolveEstimatedLostSaleValue(tx, {
      orderLineId: demand.orderLineId,
      customerId: demand.customerId,
      productId: demand.productId,
      sapItemCodeSnapshot: demand.sapItemCodeSnapshot,
      quantity: input.quantity,
      asOf: confirmedAt,
    });

    const record = await tx.lostSaleRecord.create({
      data: {
        unfulfilledDemandId: demand.id,
        quantity: input.quantity,
        reason: input.reason,
        reasonDetail: input.reasonDetail ?? null,
        decisionSource: input.decisionSource,
        estimatedUnitPrice: estimate?.unitPrice ?? null,
        estimatedValue: estimate?.value ?? null,
        estimatedValueSource: estimate?.source ?? null,
        remarks: input.remarks ?? null,
        confirmedById: actorId,
        confirmedAt,
      },
      select: { id: true },
    });

    const updatedDemand = await tx.unfulfilledDemand.update({
      where: { id: demand.id },
      data: {
        cancelledQuantity: consumption.newCancelledQuantity,
        confirmedLostQuantity: consumption.newConfirmedLostQuantity,
        outstandingQuantity: consumption.newOutstandingQuantity,
        status: newStatus,
      },
      select: { id: true, status: true },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "LOST_SALE_CONFIRMED",
        entityType: "UnfulfilledDemand",
        entityId: demand.id,
        beforeData: {
          cancelledQuantity: demand.cancelledQuantity.toString(),
          confirmedLostQuantity: demand.confirmedLostQuantity.toString(),
          outstandingQuantity: demand.outstandingQuantity.toString(),
        },
        afterData: {
          lostSaleRecordId: record.id,
          quantity: input.quantity,
          cancelledQuantity: consumption.newCancelledQuantity,
          confirmedLostQuantity: consumption.newConfirmedLostQuantity,
          outstandingQuantity: consumption.newOutstandingQuantity,
          status: newStatus,
        },
      },
    });

    return {
      recordId: record.id,
      estimatedUnitPrice: estimate?.unitPrice ?? null,
      estimatedValue: estimate?.value ?? null,
      estimatedValueSource: estimate?.source ?? null,
      demandId: updatedDemand.id,
      status: updatedDemand.status as string,
    };
  }, TRANSACTION_OPTIONS);

  return {
    ok: true,
    record: {
      id: result.recordId,
      quantity: input.quantity,
      estimatedUnitPrice: result.estimatedUnitPrice,
      estimatedValue: result.estimatedValue,
      estimatedValueSource: result.estimatedValueSource,
    },
    demand: { id: result.demandId, status: result.status },
  };
}
