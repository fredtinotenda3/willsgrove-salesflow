import "server-only";
import { prisma } from "@/lib/prisma";
import { getSettingValues } from "./settings-store";
import { SETTING_DEFINITIONS } from "./settings-registry";

const OPEN_ORDER = ["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED", "PICKING"] as const;

export async function getAdminOverview() {
  const settings = await getSettingValues();
  const stuckDays = settings["admin.stuckOrderDays"];
  const stuckBefore = new Date(Date.now() - stuckDays * 24 * 60 * 60 * 1000);

  const [
    activeUsers, inactiveUsers, activeCustomers, inactiveCustomers, activeProducts, inactiveProducts,
    activePriceLists, inactivePriceLists, outstandingOrders, ordersNoSalesperson, stuckOrders,
    customersNoManager, claimsUnassigned, openClaims, pendingApprovals, openManagementActions,
    unassignedManagementActions, overriddenSettings, administrators, recentActivity, mustChange,
  ] = await Promise.all([
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.user.count({ where: { status: "INACTIVE" } }),
    prisma.customer.count({ where: { status: "ACTIVE" } }),
    prisma.customer.count({ where: { status: "INACTIVE" } }),
    prisma.product.count({ where: { status: "ACTIVE" } }),
    prisma.product.count({ where: { status: "INACTIVE" } }),
    prisma.priceList.count({ where: { status: "ACTIVE" } }),
    prisma.priceList.count({ where: { status: "INACTIVE" } }),
    prisma.customerOrder.count({ where: { status: { in: [...OPEN_ORDER] } } }),
    prisma.customerOrder.count({ where: { status: { in: [...OPEN_ORDER] }, salespersonId: null } }),
    prisma.customerOrder.count({ where: { status: { in: [...OPEN_ORDER] }, updatedAt: { lt: stuckBefore } } }),
    prisma.customer.count({ where: { status: "ACTIVE", accountManagerId: null } }),
    prisma.invoiceClaim.count({ where: { assignedToId: null, status: { notIn: ["RESOLVED", "REJECTED", "CLOSED"] } } }),
    prisma.invoiceClaim.count({ where: { status: { notIn: ["RESOLVED", "REJECTED", "CLOSED"] } } }),
    prisma.approvalRequest.count({ where: { status: "PENDING" } }),
    prisma.managementAction.count({ where: { status: { notIn: ["COMPLETED", "DISMISSED"] } } }),
    prisma.managementAction.count({ where: { assignedToId: null, status: { notIn: ["COMPLETED", "DISMISSED"] } } }),
    prisma.systemSetting.count(),
    prisma.user.count({ where: { role: "ADMINISTRATOR", status: "ACTIVE" } }),
    prisma.auditEvent.findMany({
      where: { action: { in: ["USER_CREATE", "USER_UPDATE", "USER_UPDATE_ROLE", "USER_ACTIVATE", "USER_DEACTIVATE", "USER_PASSWORD_RESET", "USER_REQUIRE_PASSWORD_CHANGE", "PRODUCT_CREATE", "PRODUCT_UPDATE", "PRODUCT_ACTIVATE", "PRODUCT_DEACTIVATE", "PRICE_LIST_UPDATE", "PRICE_LIST_ACTIVATE", "PRICE_LIST_DEACTIVATE", "ORDER_REASSIGN", "QUOTATION_REASSIGN", "CUSTOMER_ACCOUNT_MANAGER_ASSIGN", "CLAIM_REASSIGN", "MANAGEMENT_ACTION_REASSIGN", "SYSTEM_SETTING_UPDATE", "SYSTEM_SETTING_RESET", "AUDIT_EXPORT"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, actor: { select: { name: true } } },
    }),
    prisma.user.count({ where: { mustChangePassword: true, status: "ACTIVE" } }),
  ]);

  return {
    users: { active: activeUsers, inactive: inactiveUsers, administrators, mustChangePassword: mustChange },
    customers: { active: activeCustomers, inactive: inactiveCustomers, withoutManager: customersNoManager },
    products: { active: activeProducts, inactive: inactiveProducts },
    priceLists: { active: activePriceLists, inactive: inactivePriceLists },
    orders: { outstanding: outstandingOrders, withoutSalesperson: ordersNoSalesperson, stuck: stuckOrders, stuckDays },
    claims: { open: openClaims, unassigned: claimsUnassigned },
    approvals: { pending: pendingApprovals },
    managementActions: { open: openManagementActions, unassigned: unassignedManagementActions },
    configuration: { overridden: overriddenSettings, total: SETTING_DEFINITIONS.length },
    recentActivity,
  };
}
