
"use client";

import { useState } from "react";
import {
  Building2,
  Users,
  ClipboardCheck,
  Bell,
  ShieldCheck,
  Settings as SettingsIcon,
  Save,
  Info,
  CheckCircle2,
  LockKeyhole,
  Mail,
  Package,
  FileText,
  Database,
  ChevronRight,
  UserPlus,
  Pencil,
  X,
  MapPin,
  Server,
  DollarSign,
  ShoppingBag,
} from "lucide-react";
import Sidebar from "../components/sidebar";

type SettingsSection =
  | "workspace"
  | "users"
  | "processing"
  | "notifications"
  | "system";

type Role = {
  name: string;
  description: string;
  permissions: string[];
  color: string;
};

const initialRoles: Role[] = [
  {
    name: "Salesperson",
    description: "Handles customer orders and prepares order records.",
    permissions: [
      "Receive customer orders",
      "Create and edit draft orders",
      "Review extracted order information",
      "Prepare orders for verification",
    ],
    color: "bg-blue-50 text-blue-700",
  },
  {
    name: "Sales Manager",
    description: "Reviews order accuracy and authorizes sales decisions.",
    permissions: [
      "Review submitted orders",
      "Verify products, quantities and units",
      "Approve selling prices",
      "Approve or reject orders",
    ],
    color: "bg-violet-50 text-violet-700",
  },
  {
    name: "Administrator",
    description: "Manages application configuration and user access.",
    permissions: [
      "Manage users and roles",
      "Configure workspace settings",
      "Manage application preferences",
      "View system activity",
    ],
    color: "bg-emerald-50 text-emerald-700",
  },
];

export default function SettingsPage() {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("workspace");

  const [savedMessage, setSavedMessage] = useState("");

  const [workspace, setWorkspace] = useState({
    company: "Willsgrove Farm Enterprises",
    branch: "Harare Branch",
    department: "Sales Department",
    currency: "USD",
    timezone: "Africa/Harare",
    address: "Birmingham Road, Southerton, Harare",
  });

  const [rules, setRules] = useState({
    requireProductVerification: true,
    requireQuantityVerification: true,
    requireUnitVerification: true,
    requireSellingPriceApproval: true,
    preserveOriginalCustomerPO: true,
    recheckStockBeforeApproval: true,
    preventUnapprovedOrders: true,
    allowSAPWriteAccess: false,
  });

  const [notifications, setNotifications] = useState({
    newOrder: true,
    pendingVerification: true,
    orderApproved: true,
    orderRejected: true,
    deliveryUpdates: false,
    emailNotifications: true,
    inAppNotifications: true,
  });

  const [users, setUsers] = useState([
    {
      id: 1,
      name: "Sales Administrator",
      email: "sales.admin@example.com",
      role: "Administrator",
      status: "Active",
    },
    {
      id: 2,
      name: "Sales Manager",
      email: "sales.manager@example.com",
      role: "Sales Manager",
      status: "Active",
    },
    {
      id: 3,
      name: "Sales User",
      email: "sales.user@example.com",
      role: "Salesperson",
      status: "Active",
    },
  ]);

  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    role: "Salesperson",
  });

  const sections: {
    id: SettingsSection;
    label: string;
    description: string;
    icon: typeof Building2;
  }[] = [
    {
      id: "workspace",
      label: "Workspace",
      description: "Company and branch details",
      icon: Building2,
    },
    {
      id: "users",
      label: "Users & Roles",
      description: "Application users and access roles",
      icon: Users,
    },
    {
      id: "processing",
      label: "Order Processing",
      description: "Order verification and approval rules",
      icon: ClipboardCheck,
    },
    {
      id: "notifications",
      label: "Notifications",
      description: "Application notification preferences",
      icon: Bell,
    },
    {
      id: "system",
      label: "System Information",
      description: "Application and integration status",
      icon: ShieldCheck,
    },
  ];

  function showSaved(message: string) {
    setSavedMessage(message);
    window.setTimeout(() => setSavedMessage(""), 3000);
  }

  function saveWorkspace() {
    showSaved("Workspace settings saved in this prototype.");
  }

  function saveRules() {
    showSaved("Order processing preferences saved in this prototype.");
  }

  function saveNotifications() {
    showSaved("Notification preferences saved in this prototype.");
  }

  function addUser() {
    if (!newUser.name.trim() || !newUser.email.trim()) {
      alert("Please enter the user's name and email address.");
      return;
    }

    const emailExists = users.some(
      (user) => user.email.toLowerCase() === newUser.email.trim().toLowerCase()
    );

    if (emailExists) {
      alert("A user with this email address already exists.");
      return;
    }

    setUsers((current) => [
      ...current,
      {
        id: Math.max(0, ...current.map((user) => user.id)) + 1,
        name: newUser.name.trim(),
        email: newUser.email.trim(),
        role: newUser.role,
        status: "Active",
      },
    ]);

    setNewUser({
      name: "",
      email: "",
      role: "Salesperson",
    });

    setShowAddUser(false);
    showSaved("Demo user added to the local page state.");
  }

  function toggleUserStatus(id: number) {
    setUsers((current) =>
      current.map((user) =>
        user.id === id
          ? {
              ...user,
              status: user.status === "Active" ? "Inactive" : "Active",
            }
          : user
      )
    );
  }

  function toggleRule(key: keyof typeof rules) {
    setRules((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function toggleNotification(key: keyof typeof notifications) {
    setNotifications((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  const activeUsers = users.filter(
    (user) => user.status === "Active"
  ).length;

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <main className="min-w-0 flex-1 px-4 py-6 md:ml-[260px] md:px-8 md:py-8">
        <div className="mx-auto max-w-[1450px]">
          {/* Header */}
          <div className="mb-8">
            <div className="mb-2 flex items-center gap-2 text-sm text-[#718078]">
              <span>SalesFlow</span>
              <span>/</span>
              <span className="font-medium text-[#17251E]">Settings</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
                Settings
              </h1>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                Demo configuration
              </span>
            </div>

            <p className="mt-2 text-sm text-[#718078]">
              Manage your SalesFlow workspace, users and order processing
              preferences.
            </p>
          </div>

          {/* Save notification */}
          {savedMessage && (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
              <CheckCircle2 size={18} />
              {savedMessage}
            </div>
          )}

          {/* Demo notice */}
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <Info size={19} className="mt-0.5 shrink-0 text-amber-700" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Prototype settings
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                Changes are held in local page state and are not saved to a
                database. User roles and processing rules are demonstrations,
                not enforced security controls.
              </p>
            </div>
          </div>

          {/* Summary cards */}
          <div className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard
              icon={Building2}
              label="Workspace"
              value="Harare Branch"
              description="Current demo workspace"
            />
            <SummaryCard
              icon={Users}
              label="Registered Users"
              value={String(users.length)}
              description={`${activeUsers} active users`}
            />
            <SummaryCard
              icon={ShieldCheck}
              label="SAP Integration"
              value="Not Connected"
              description="No live SAP access"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            {/* Settings navigation */}
            <aside className="h-fit rounded-2xl border border-[#E7ECE7] bg-white p-3 shadow-sm">
              <div className="px-3 pb-3 pt-2">
                <p className="text-xs font-bold uppercase tracking-wider text-[#9AA49D]">
                  Configuration
                </p>
              </div>

              <div className="space-y-1">
                {sections.map((section) => {
                  const Icon = section.icon;
                  const selected = activeSection === section.id;

                  return (
                    <button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${
                        selected
                          ? "bg-[#EDF3E9] text-[#31543C]"
                          : "text-[#68766D] hover:bg-[#F7F9F6]"
                      }`}
                    >
                      <Icon size={19} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">
                          {section.label}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#8A968D]">
                          {section.description}
                        </p>
                      </div>
                      <ChevronRight
                        size={15}
                        className={selected ? "text-[#496A42]" : "text-[#AAB3AC]"}
                      />
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Settings content */}
            <div className="min-w-0 space-y-6">
              {activeSection === "workspace" && (
                <SettingsPanel
                  title="Workspace Configuration"
                  description="Basic company, branch and regional settings."
                  icon={Building2}
                >
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    <Field label="Company Name">
                      <input
                        value={workspace.company}
                        onChange={(e) =>
                          setWorkspace({
                            ...workspace,
                            company: e.target.value,
                          })
                        }
                        className="settings-input"
                      />
                    </Field>

                    <Field label="Branch">
                      <input
                        value={workspace.branch}
                        onChange={(e) =>
                          setWorkspace({
                            ...workspace,
                            branch: e.target.value,
                          })
                        }
                        className="settings-input"
                      />
                    </Field>

                    <Field label="Department">
                      <input
                        value={workspace.department}
                        onChange={(e) =>
                          setWorkspace({
                            ...workspace,
                            department: e.target.value,
                          })
                        }
                        className="settings-input"
                      />
                    </Field>

                    <Field label="Default Currency">
                      <select
                        value={workspace.currency}
                        onChange={(e) =>
                          setWorkspace({
                            ...workspace,
                            currency: e.target.value,
                          })
                        }
                        className="settings-input"
                      >
                        <option value="USD">USD - US Dollar</option>
                        <option value="ZWG">ZWG - Zimbabwe Gold</option>
                      </select>
                    </Field>

                    <Field label="Time Zone">
                      <select
                        value={workspace.timezone}
                        onChange={(e) =>
                          setWorkspace({
                            ...workspace,
                            timezone: e.target.value,
                          })
                        }
                        className="settings-input"
                      >
                        <option value="Africa/Harare">
                          Africa/Harare
                        </option>
                        <option value="UTC">UTC</option>
                      </select>
                    </Field>

                    <Field label="Company Address">
                      <input
                        value={workspace.address}
                        onChange={(e) =>
                          setWorkspace({
                            ...workspace,
                            address: e.target.value,
                          })
                        }
                        className="settings-input"
                      />
                    </Field>
                  </div>

                  <div className="mt-6 flex items-center gap-2 rounded-xl bg-[#F7F9F6] p-4 text-xs text-[#718078]">
                    <MapPin size={16} />
                    Branch configuration is currently a single-workspace
                    demonstration.
                  </div>

                  <SaveButton onClick={saveWorkspace} />
                </SettingsPanel>
              )}

              {activeSection === "users" && (
                <>
                  <SettingsPanel
                    title="Users & Roles"
                    description="Review application users and their proposed access roles."
                    icon={Users}
                    action={
                      <button
                        onClick={() => setShowAddUser(true)}
                        className="flex items-center gap-2 rounded-xl bg-[#183B2D] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#24513D]"
                      >
                        <UserPlus size={15} />
                        Add User
                      </button>
                    }
                  >
                    <div className="mb-5 grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-[#F7F9F6] p-4">
                        <p className="text-xs text-[#849087]">
                          Total users
                        </p>
                        <p className="mt-1 text-2xl font-bold">
                          {users.length}
                        </p>
                      </div>
                      <div className="rounded-xl bg-[#F7F9F6] p-4">
                        <p className="text-xs text-[#849087]">
                          Active users
                        </p>
                        <p className="mt-1 text-2xl font-bold">
                          {activeUsers}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {users.map((user) => (
                        <div
                          key={user.id}
                          className="flex flex-col justify-between gap-4 rounded-xl border border-[#E8EDE8] p-4 sm:flex-row sm:items-center"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EDF3E9] text-sm font-bold text-[#496A42]">
                              {user.name
                                .split(" ")
                                .map((part) => part[0])
                                .slice(0, 2)
                                .join("")
                                .toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">
                                {user.name}
                              </p>
                              <p className="truncate text-xs text-[#849087]">
                                {user.email}
                              </p>
                              <p className="mt-1 text-xs font-medium text-[#52645A]">
                                {user.role}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                user.status === "Active"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {user.status}
                            </span>

                            <button
                              onClick={() => toggleUserStatus(user.id)}
                              className="rounded-lg border border-[#E3E9E3] px-3 py-2 text-xs font-semibold text-[#52645A] hover:bg-[#F7F9F6]"
                            >
                              {user.status === "Active"
                                ? "Deactivate"
                                : "Activate"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </SettingsPanel>

                  <SettingsPanel
                    title="Role Definitions"
                    description="Proposed responsibilities for each SalesFlow role."
                    icon={LockKeyhole}
                  >
                    <div className="space-y-4">
                      {initialRoles.map((role) => (
                        <div
                          key={role.name}
                          className="rounded-xl border border-[#E8EDE8] p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-bold">
                              {role.name}
                            </h3>
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${role.color}`}
                            >
                              Proposed role
                            </span>
                          </div>

                          <p className="mt-1 text-xs text-[#849087]">
                            {role.description}
                          </p>

                          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {role.permissions.map((permission) => (
                              <div
                                key={permission}
                                className="flex items-start gap-2 text-xs text-[#52645A]"
                              >
                                <CheckCircle2
                                  size={14}
                                  className="mt-0.5 shrink-0 text-emerald-600"
                                />
                                {permission}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </SettingsPanel>
                </>
              )}

              {activeSection === "processing" && (
                <SettingsPanel
                  title="Order Processing Rules"
                  description="Define the checks that should be completed before an order is approved."
                  icon={ClipboardCheck}
                >
                  <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 p-4">
                    <p className="text-sm font-semibold text-blue-900">
                      Recommended order controls
                    </p>
                    <p className="mt-1 text-xs leading-5 text-blue-800">
                      These rules reflect the proposed SalesFlow workflow.
                      They are not yet enforced by a backend.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <RuleToggle
                      icon={Package}
                      title="Require product verification"
                      description="Confirm the exact product code and description before approval."
                      checked={rules.requireProductVerification}
                      onChange={() => toggleRule("requireProductVerification")}
                    />

                    <RuleToggle
                      icon={ClipboardCheck}
                      title="Require quantity verification"
                      description="Check the requested quantity against the original customer order."
                      checked={rules.requireQuantityVerification}
                      onChange={() => toggleRule("requireQuantityVerification")}
                    />

                    <RuleToggle
                      icon={Package}
                      title="Require unit verification"
                      description="Confirm that units, grades and pack sizes match exactly."
                      checked={rules.requireUnitVerification}
                      onChange={() => toggleRule("requireUnitVerification")}
                    />

                    <RuleToggle
                      icon={DollarSign}
                      title="Require selling price approval"
                      description="Compare customer-submitted prices with Willsgrove-approved prices."
                      checked={rules.requireSellingPriceApproval}
                      onChange={() => toggleRule("requireSellingPriceApproval")}
                    />

                    <RuleToggle
                      icon={FileText}
                      title="Preserve original customer PO"
                      description="Keep the original document or message attached to its order record."
                      checked={rules.preserveOriginalCustomerPO}
                      onChange={() => toggleRule("preserveOriginalCustomerPO")}
                    />

                    <RuleToggle
                      icon={Package}
                      title="Recheck stock before approval"
                      description="Treat stock-in-hand as a snapshot, not a guaranteed reservation."
                      checked={rules.recheckStockBeforeApproval}
                      onChange={() => toggleRule("recheckStockBeforeApproval")}
                    />

                    <RuleToggle
                      icon={ShieldCheck}
                      title="Prevent unapproved orders from proceeding"
                      description="Require verification and approval before an order advances."
                      checked={rules.preventUnapprovedOrders}
                      onChange={() => toggleRule("preventUnapprovedOrders")}
                    />

                    <RuleToggle
                      icon={Database}
                      title="Allow SAP write access"
                      description="Permit SalesFlow to create or update records in SAP Business One."
                      checked={rules.allowSAPWriteAccess}
                      onChange={() => toggleRule("allowSAPWriteAccess")}
                      warning
                    />
                  </div>

                  <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-xs font-semibold text-amber-900">
                      SAP integration safeguard
                    </p>
                    <p className="mt-1 text-xs leading-5 text-amber-800">
                      SAP write access remains disabled by default. This
                      prototype does not connect to SAP, create invoices,
                      or update inventory.
                    </p>
                  </div>

                  <SaveButton onClick={saveRules} />
                </SettingsPanel>
              )}

              {activeSection === "notifications" && (
                <SettingsPanel
                  title="Notification Preferences"
                  description="Choose which events should generate application notifications."
                  icon={Bell}
                >
                  <h3 className="mb-3 text-sm font-bold">
                    Order Events
                  </h3>

                  <div className="space-y-1">
                    <RuleToggle
                      icon={ShoppingBag}
                      title="New order received"
                      description="Notify users when a new customer order is registered."
                      checked={notifications.newOrder}
                      onChange={() => toggleNotification("newOrder")}
                    />

                    <RuleToggle
                      icon={ClipboardCheck}
                      title="Order awaiting verification"
                      description="Notify the relevant team when an order needs checking."
                      checked={notifications.pendingVerification}
                      onChange={() => toggleNotification("pendingVerification")}
                    />

                    <RuleToggle
                      icon={CheckCircle2}
                      title="Order approved"
                      description="Notify users when an order passes approval."
                      checked={notifications.orderApproved}
                      onChange={() => toggleNotification("orderApproved")}
                    />

                    <RuleToggle
                      icon={Info}
                      title="Order rejected"
                      description="Notify users when an order is rejected or returned for correction."
                      checked={notifications.orderRejected}
                      onChange={() => toggleNotification("orderRejected")}
                    />

                    <RuleToggle
                      icon={Package}
                      title="Delivery updates"
                      description="Notify users about dispatch and delivery events."
                      checked={notifications.deliveryUpdates}
                      onChange={() => toggleNotification("deliveryUpdates")}
                    />
                  </div>

                  <div className="my-6 border-t border-[#EEF1ED]" />

                  <h3 className="mb-3 text-sm font-bold">
                    Notification Channels
                  </h3>

                  <div className="space-y-1">
                    <RuleToggle
                      icon={Mail}
                      title="Email notifications"
                      description="Send notifications to configured user email addresses."
                      checked={notifications.emailNotifications}
                      onChange={() => toggleNotification("emailNotifications")}
                    />

                    <RuleToggle
                      icon={Bell}
                      title="In-app notifications"
                      description="Display notifications inside the SalesFlow application."
                      checked={notifications.inAppNotifications}
                      onChange={() => toggleNotification("inAppNotifications")}
                    />
                  </div>

                  <SaveButton onClick={saveNotifications} />
                </SettingsPanel>
              )}

              {activeSection === "system" && (
                <>
                  <SettingsPanel
                    title="Application Information"
                    description="Technical details about this SalesFlow prototype."
                    icon={SettingsIcon}
                  >
                    <div className="space-y-4">
                      <SystemRow
                        icon={Building2}
                        label="Application"
                        value="Willsgrove SalesFlow"
                      />
                      <SystemRow
                        icon={Server}
                        label="Application version"
                        value="0.1.0 - Prototype"
                      />
                      <SystemRow
                        icon={Database}
                        label="Database"
                        value="Not configured"
                      />
                      <SystemRow
                        icon={ShieldCheck}
                        label="Authentication"
                        value="Not configured"
                      />
                      <SystemRow
                        icon={FileText}
                        label="Audit logging"
                        value="Not configured"
                      />
                    </div>
                  </SettingsPanel>

                  <SettingsPanel
                    title="External Integrations"
                    description="Current connection status of external systems."
                    icon={Database}
                  >
                    <IntegrationRow
                      name="SAP Business One"
                      description="ERP products, customers, stock and sales documents."
                      status="Not connected"
                    />
                    <IntegrationRow
                      name="Email"
                      description="Customer purchase order intake."
                      status="Not connected"
                    />
                    <IntegrationRow
                      name="WhatsApp Business"
                      description="Customer order intake and document capture."
                      status="Not connected"
                    />
                  </SettingsPanel>

                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-start gap-3">
                      <Info
                        size={18}
                        className="mt-0.5 shrink-0 text-amber-700"
                      />
                      <div>
                        <p className="text-sm font-semibold text-amber-900">
                          Before production deployment
                        </p>
                        <p className="mt-1 text-xs leading-5 text-amber-800">
                          Production use will require secure authentication,
                          server-side role enforcement, persistent storage,
                          audit logging, backups and controlled integration
                          credentials.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="mt-8 border-t border-[#E5EAE5] pt-5 text-center text-xs text-[#9AA49D]">
            Willsgrove SalesFlow · From customer order to delivery
          </div>
        </div>
      </main>

      {/* Add user modal */}
      {showAddUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Add User</h2>
                <p className="mt-1 text-xs text-[#849087]">
                  Add an illustrative user to this prototype.
                </p>
              </div>
              <button
                onClick={() => setShowAddUser(false)}
                className="rounded-lg p-2 text-[#849087] hover:bg-[#F3F5F2]"
                aria-label="Close"
              >
                <X size={19} />
              </button>
            </div>

            <div className="space-y-4">
              <Field label="Full Name">
                <input
                  value={newUser.name}
                  onChange={(e) =>
                    setNewUser({ ...newUser, name: e.target.value })
                  }
                  placeholder="Enter full name"
                  className="settings-input"
                />
              </Field>

              <Field label="Email Address">
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) =>
                    setNewUser({ ...newUser, email: e.target.value })
                  }
                  placeholder="name@example.com"
                  className="settings-input"
                />
              </Field>

              <Field label="Role">
                <select
                  value={newUser.role}
                  onChange={(e) =>
                    setNewUser({ ...newUser, role: e.target.value })
                  }
                  className="settings-input"
                >
                  <option value="Salesperson">Salesperson</option>
                  <option value="Sales Manager">Sales Manager</option>
                  <option value="Administrator">Administrator</option>
                </select>
              </Field>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowAddUser(false)}
                className="flex-1 rounded-xl border border-[#E3E9E3] px-4 py-3 text-sm font-semibold text-[#68766D] hover:bg-[#F7F9F6]"
              >
                Cancel
              </button>
              <button
                onClick={addUser}
                className="flex-1 rounded-xl bg-[#183B2D] px-4 py-3 text-sm font-semibold text-white hover:bg-[#24513D]"
              >
                Add User
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsPanel({
  title,
  description,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  description: string;
  icon: typeof Building2;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm md:p-6">
      <div className="mb-6 flex flex-col justify-between gap-4 border-b border-[#EEF1ED] pb-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-[#F2F6F1] p-2.5 text-[#496A42]">
            <Icon size={20} />
          </div>
          <div>
            <h2 className="font-bold">{title}</h2>
            <p className="mt-1 text-xs text-[#849087]">{description}</p>
          </div>
        </div>
        {action}
      </div>

      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold text-[#59675E]">
        {label}
      </span>
      {children}
    </label>
  );
}

function SaveButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="mt-6 flex justify-end">
      <button
        onClick={onClick}
        className="flex items-center gap-2 rounded-xl bg-[#183B2D] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#24513D]"
      >
        <Save size={16} />
        Save Changes
      </button>
    </div>
  );
}

function RuleToggle({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
  warning = false,
}: {
  icon: typeof Building2;
  title: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  warning?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#F0F2EF] py-4 last:border-0">
      <div className="flex min-w-0 items-start gap-3">
        <div
          className={`mt-0.5 rounded-lg p-2 ${
            warning
              ? "bg-amber-50 text-amber-700"
              : "bg-[#F5F7F4] text-[#718078]"
          }`}
        >
          <Icon size={17} />
        </div>
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-[#849087]">
            {description}
          </p>
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-[#496A42]" : "bg-[#D7DDD7]"
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  description,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium text-[#849087]">{label}</p>
        <Icon size={19} className="text-[#718B60]" />
      </div>
      <p className="truncate text-lg font-bold">{value}</p>
      <p className="mt-1 text-xs text-[#849087]">{description}</p>
    </div>
  );
}

function SystemRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#F0F2EF] pb-4 last:border-0 last:pb-0">
      <div className="flex items-center gap-3">
        <Icon size={17} className="text-[#849087]" />
        <span className="text-sm text-[#68766D]">{label}</span>
      </div>
      <span className="text-right text-sm font-semibold">{value}</span>
    </div>
  );
}

function IntegrationRow({
  name,
  description,
  status,
}: {
  name: string;
  description: string;
  status: string;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 border-b border-[#F0F2EF] py-4 first:pt-0 last:border-0 last:pb-0 sm:flex-row sm:items-center">
      <div>
        <p className="text-sm font-semibold">{name}</p>
        <p className="mt-1 text-xs text-[#849087]">{description}</p>
      </div>
      <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
        {status}
      </span>
    </div>
  );
}

