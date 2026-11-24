
"use client";

import { useEffect, useState } from "react";
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
  X,
  MapPin,
  Server,
  DollarSign,
  ShoppingBag,
  Copy,
  Loader2,
  AlertTriangle,
  Truck,
  UserCog,
  Trash2,
  Search,
} from "lucide-react";
import Sidebar from "../components/sidebar";

type AppUser = {
  id: string;
  name: string;
  email: string;
  role: "SALESPERSON" | "SALES_MANAGER" | "ADMINISTRATOR";
  status: "ACTIVE" | "INACTIVE";
  mustChangePassword: boolean;
  isDemo: boolean;
  createdAt: string;
};

const ROLE_LABELS: Record<AppUser["role"], string> = {
  SALESPERSON: "Salesperson",
  SALES_MANAGER: "Sales Manager",
  ADMINISTRATOR: "Administrator",
};

// Final Operational Enhancements (spec Part 4). Personnel (drivers,
// driver's assistants, other named operational roles with no login
// account) and Vehicles -- see prisma/schema.prisma's Personnel model
// comment for why this is a separate roster from Users & Roles above,
// not a duplicate of it.
type Personnel = {
  id: string;
  name: string;
  role: "DRIVER" | "DRIVER_ASSISTANT" | "OTHER";
  roleDetail: string | null;
  phone: string | null;
  notes: string | null;
  status: "ACTIVE" | "INACTIVE";
  isDemo: boolean;
  createdAt: string;
  dispatchHistoryCount: number;
};

const PERSONNEL_ROLE_LABELS: Record<Personnel["role"], string> = {
  DRIVER: "Driver",
  DRIVER_ASSISTANT: "Driver's Assistant",
  OTHER: "Other",
};

type Vehicle = {
  id: string;
  registrationNumber: string;
  description: string | null;
  notes: string | null;
  status: "ACTIVE" | "INACTIVE";
  isDemo: boolean;
  createdAt: string;
  dispatchHistoryCount: number;
};

type SettingsSection =
  | "workspace"
  | "users"
  | "personnel"
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

  const [users, setUsers] = useState<AppUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; role: AppUser["role"] } | null>(null);

  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState<{ name: string; email: string; role: AppUser["role"] }>({
    name: "",
    email: "",
    role: "SALESPERSON",
  });
  const [addUserError, setAddUserError] = useState<string | null>(null);
  const [addingUser, setAddingUser] = useState(false);
  const [pendingUserAction, setPendingUserAction] = useState<string | null>(null);

  // Shown once, right after a user is created -- the temporary password is
  // never retrievable again after this (see lib/auth/password.ts).
  const [createdCredential, setCreatedCredential] = useState<{ email: string; password: string } | null>(null);

  // Final Operational Enhancements (spec Part 4). Personnel & Vehicles.
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [personnelLoading, setPersonnelLoading] = useState(true);
  const [personnelError, setPersonnelError] = useState<string | null>(null);
  const [personnelSearch, setPersonnelSearch] = useState("");

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);
  const [vehicleSearch, setVehicleSearch] = useState("");

  const [showAddPersonnel, setShowAddPersonnel] = useState(false);
  const [newPersonnel, setNewPersonnel] = useState<{ name: string; role: Personnel["role"]; roleDetail: string; phone: string }>({
    name: "",
    role: "DRIVER",
    roleDetail: "",
    phone: "",
  });
  const [addPersonnelError, setAddPersonnelError] = useState<string | null>(null);
  const [addingPersonnel, setAddingPersonnel] = useState(false);
  const [pendingPersonnelAction, setPendingPersonnelAction] = useState<string | null>(null);

  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [newVehicle, setNewVehicle] = useState<{ registrationNumber: string; description: string }>({ registrationNumber: "", description: "" });
  const [addVehicleError, setAddVehicleError] = useState<string | null>(null);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [pendingVehicleAction, setPendingVehicleAction] = useState<string | null>(null);

  // Pure fetch + parse, with no setState calls, so it can be safely called
  // directly from the mount effect below without tripping the
  // react-hooks/set-state-in-effect rule (calling setState synchronously
  // within an effect body -- even via an invoked async function's
  // pre-`await` statements -- forces an extra synchronous render on
  // mount). `loadUsers()` below wraps this with the loading/error state
  // transitions for the manual-refresh call sites (after creating or
  // toggling a user), where resetting those flags is actually desired.
  async function fetchUsersList(): Promise<
    { success: true; users: AppUser[] } | { success: false; message: string }
  > {
    try {
      const response = await fetch("/api/users", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        return { success: false, message: data.message ?? "Unable to load users." };
      }
      return { success: true, users: data.users };
    } catch {
      return {
        success: false,
        message: "Could not reach the server. Check your connection and try again.",
      };
    }
  }

  async function loadUsers() {
    setUsersLoading(true);
    setUsersError(null);
    const result = await fetchUsersList();
    if (!result.success) {
      setUsersError(result.message);
      setUsersLoading(false);
      return;
    }
    setUsers(result.users);
    setUsersLoading(false);
  }

  // Final Operational Enhancements (spec Part 4). Same fetch/parse shape
  // as fetchUsersList()/loadUsers() above.
  async function fetchPersonnelList(search?: string): Promise<{ success: true; personnel: Personnel[] } | { success: false; message: string }> {
    try {
      const query = search && search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
      const response = await fetch(`/api/personnel${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        return { success: false, message: data.message ?? "Unable to load personnel." };
      }
      return { success: true, personnel: data.personnel };
    } catch {
      return { success: false, message: "Could not reach the server. Check your connection and try again." };
    }
  }

  async function loadPersonnel(search?: string) {
    setPersonnelLoading(true);
    setPersonnelError(null);
    const result = await fetchPersonnelList(search);
    if (!result.success) {
      setPersonnelError(result.message);
      setPersonnelLoading(false);
      return;
    }
    setPersonnel(result.personnel);
    setPersonnelLoading(false);
  }

  async function fetchVehiclesList(search?: string): Promise<{ success: true; vehicles: Vehicle[] } | { success: false; message: string }> {
    try {
      const query = search && search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
      const response = await fetch(`/api/vehicles${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        return { success: false, message: data.message ?? "Unable to load vehicles." };
      }
      return { success: true, vehicles: data.vehicles };
    } catch {
      return { success: false, message: "Could not reach the server. Check your connection and try again." };
    }
  }

  async function loadVehicles(search?: string) {
    setVehiclesLoading(true);
    setVehiclesError(null);
    const result = await fetchVehiclesList(search);
    if (!result.success) {
      setVehiclesError(result.message);
      setVehiclesLoading(false);
      return;
    }
    setVehicles(result.vehicles);
    setVehiclesLoading(false);
  }

  useEffect(() => {
    let ignore = false;

    // No setState before this `await`-equivalent `.then()` boundary: the
    // initial `usersLoading`/`usersError` state already reflects "loading,
    // no error" (see the `useState` calls above), so nothing needs
    // resetting on mount -- only the result of the fetch needs applying.
    fetchUsersList().then((result) => {
      if (ignore) return;
      if (!result.success) {
        setUsersError(result.message);
      } else {
        setUsers(result.users);
      }
      setUsersLoading(false);
    });

    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (ignore) return;
        if (data.user) {
          setCurrentUser({ id: data.user.id, role: data.user.role });
        }
      })
      .catch(() => {});

    fetchPersonnelList().then((result) => {
      if (ignore) return;
      if (!result.success) {
        setPersonnelError(result.message);
      } else {
        setPersonnel(result.personnel);
      }
      setPersonnelLoading(false);
    });

    fetchVehiclesList().then((result) => {
      if (ignore) return;
      if (!result.success) {
        setVehiclesError(result.message);
      } else {
        setVehicles(result.vehicles);
      }
      setVehiclesLoading(false);
    });

    return () => {
      ignore = true;
    };
  }, []);

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
      id: "personnel",
      label: "Personnel & Vehicles",
      description: "Drivers, assistants and the vehicle register",
      icon: Truck,
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
    window.setTimeout(() => setSavedMessage(""), 6000);
  }

  function saveWorkspace() {
    showSaved("Not saved: workspace details are display-only. Stored business settings are under Administration > Configuration.");
  }

  function saveRules() {
    showSaved("Not saved: these are display-only. Quotation validity and management thresholds are configured under Administration > Configuration; approval thresholds under Approval policies.");
  }

  function saveNotifications() {
    showSaved("Not saved: per-user notification preferences are not supported yet. Notifications are always delivered in-app.");
  }

  async function addUser() {
    setAddUserError(null);

    if (!newUser.name.trim() || !newUser.email.trim()) {
      setAddUserError("Please enter the user's name and email address.");
      return;
    }

    setAddingUser(true);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newUser.name.trim(),
          email: newUser.email.trim(),
          role: newUser.role,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setAddUserError(
          data.fieldErrors?.email ?? data.fieldErrors?.name ?? data.message ?? "Unable to create the user."
        );
        return;
      }

      setCreatedCredential({ email: newUser.email.trim(), password: data.temporaryPassword });
      setNewUser({ name: "", email: "", role: "SALESPERSON" });
      setShowAddUser(false);
      await loadUsers();
    } catch {
      setAddUserError("Could not reach the server. Check your connection and try again.");
    } finally {
      setAddingUser(false);
    }
  }

  async function toggleUserStatus(user: AppUser) {
    const nextStatus = user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setPendingUserAction(user.id);

    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        showSaved(data.message ?? "Unable to update this user.");
        return;
      }

      await loadUsers();
      showSaved(`${user.name} is now ${nextStatus === "ACTIVE" ? "active" : "inactive"}.`);
    } catch {
      showSaved("Could not reach the server. Check your connection and try again.");
    } finally {
      setPendingUserAction(null);
    }
  }

  // Final Operational Enhancements (spec Part 4). Personnel actions.
  async function addPersonnel() {
    setAddPersonnelError(null);
    if (!newPersonnel.name.trim()) {
      setAddPersonnelError("Please enter a name.");
      return;
    }
    if (newPersonnel.role === "OTHER" && !newPersonnel.roleDetail.trim()) {
      setAddPersonnelError("Please enter a detail for the Other role.");
      return;
    }

    setAddingPersonnel(true);
    try {
      const response = await fetch("/api/personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPersonnel.name.trim(),
          role: newPersonnel.role,
          roleDetail: newPersonnel.roleDetail.trim() || undefined,
          phone: newPersonnel.phone.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setAddPersonnelError(data.fieldErrors?.name ?? data.fieldErrors?.roleDetail ?? data.message ?? "Unable to create this personnel record.");
        return;
      }
      setNewPersonnel({ name: "", role: "DRIVER", roleDetail: "", phone: "" });
      setShowAddPersonnel(false);
      await loadPersonnel(personnelSearch);
    } catch {
      setAddPersonnelError("Could not reach the server. Check your connection and try again.");
    } finally {
      setAddingPersonnel(false);
    }
  }

  async function togglePersonnelStatus(record: Personnel) {
    const nextStatus = record.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setPendingPersonnelAction(record.id);
    try {
      const response = await fetch(`/api/personnel/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        showSaved(data.message ?? "Unable to update this personnel record.");
        return;
      }
      await loadPersonnel(personnelSearch);
      showSaved(`${record.name} is now ${nextStatus === "ACTIVE" ? "active" : "inactive"}.`);
    } catch {
      showSaved("Could not reach the server. Check your connection and try again.");
    } finally {
      setPendingPersonnelAction(null);
    }
  }

  async function removePersonnel(record: Personnel) {
    if (!window.confirm(`Delete ${record.name}? This cannot be undone.`)) return;
    setPendingPersonnelAction(record.id);
    try {
      const response = await fetch(`/api/personnel/${record.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        showSaved(data.message ?? "Unable to delete this personnel record.");
        return;
      }
      await loadPersonnel(personnelSearch);
      showSaved(`${record.name} was deleted.`);
    } catch {
      showSaved("Could not reach the server. Check your connection and try again.");
    } finally {
      setPendingPersonnelAction(null);
    }
  }

  // Final Operational Enhancements (spec Part 4). Vehicle actions --
  // exact mirror of the Personnel actions above.
  async function addVehicle() {
    setAddVehicleError(null);
    if (!newVehicle.registrationNumber.trim()) {
      setAddVehicleError("Please enter a registration number.");
      return;
    }

    setAddingVehicle(true);
    try {
      const response = await fetch("/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registrationNumber: newVehicle.registrationNumber.trim(),
          description: newVehicle.description.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setAddVehicleError(data.fieldErrors?.registrationNumber ?? data.message ?? "Unable to create this vehicle.");
        return;
      }
      setNewVehicle({ registrationNumber: "", description: "" });
      setShowAddVehicle(false);
      await loadVehicles(vehicleSearch);
    } catch {
      setAddVehicleError("Could not reach the server. Check your connection and try again.");
    } finally {
      setAddingVehicle(false);
    }
  }

  async function toggleVehicleStatus(vehicle: Vehicle) {
    const nextStatus = vehicle.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setPendingVehicleAction(vehicle.id);
    try {
      const response = await fetch(`/api/vehicles/${vehicle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        showSaved(data.message ?? "Unable to update this vehicle.");
        return;
      }
      await loadVehicles(vehicleSearch);
      showSaved(`${vehicle.registrationNumber} is now ${nextStatus === "ACTIVE" ? "active" : "inactive"}.`);
    } catch {
      showSaved("Could not reach the server. Check your connection and try again.");
    } finally {
      setPendingVehicleAction(null);
    }
  }

  async function removeVehicle(vehicle: Vehicle) {
    if (!window.confirm(`Delete ${vehicle.registrationNumber}? This cannot be undone.`)) return;
    setPendingVehicleAction(vehicle.id);
    try {
      const response = await fetch(`/api/vehicles/${vehicle.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        showSaved(data.message ?? "Unable to delete this vehicle.");
        return;
      }
      await loadVehicles(vehicleSearch);
      showSaved(`${vehicle.registrationNumber} was deleted.`);
    } catch {
      showSaved("Could not reach the server. Check your connection and try again.");
    } finally {
      setPendingVehicleAction(null);
    }
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
    (user) => user.status === "ACTIVE"
  ).length;

  const isAdmin = currentUser?.role === "ADMINISTRATOR";

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
                Partially live
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                Users &amp; Roles below is real: it reads and writes actual
                application users, and only an Administrator account can
                add a user or change a user&apos;s status. Workspace,
                Order Processing, Notifications and System Information are
                display-only -- changes there are not stored. Stored business
                configuration (quotation validity, management thresholds,
                idle-order days) is under Administration &gt; Configuration,
                available to Administrators.
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
                  {createdCredential && (
                    <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-emerald-900">
                            User created -- share this temporary password now
                          </p>
                          <p className="mt-1 text-xs leading-5 text-emerald-800">
                            This password for <strong>{createdCredential.email}</strong> is shown
                            only once and cannot be retrieved again. The user must change it the
                            first time they sign in.
                          </p>
                        </div>
                        <button
                          onClick={() => setCreatedCredential(null)}
                          className="rounded-lg p-1.5 text-emerald-700 hover:bg-emerald-100"
                          aria-label="Dismiss"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 py-3">
                        <code className="flex-1 select-all text-sm font-semibold text-emerald-900">
                          {createdCredential.password}
                        </code>
                        <button
                          onClick={() => navigator.clipboard?.writeText(createdCredential.password)}
                          className="flex items-center gap-1.5 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                        >
                          <Copy size={13} />
                          Copy
                        </button>
                      </div>
                    </div>
                  )}

                  <SettingsPanel
                    title="Users & Roles"
                    description="Application users and their access roles. This section is live."
                    icon={Users}
                    action={
                      isAdmin ? (
                        <button
                          onClick={() => {
                            setAddUserError(null);
                            setShowAddUser(true);
                          }}
                          className="flex items-center gap-2 rounded-xl bg-[#183B2D] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#24513D]"
                        >
                          <UserPlus size={15} />
                          Add User
                        </button>
                      ) : undefined
                    }
                  >
                    {!isAdmin && (
                      <div className="mb-5 flex items-start gap-2 rounded-xl border border-[#E8EDE8] bg-[#F7F9F6] p-3 text-xs text-[#68766D]">
                        <ShieldCheck size={15} className="mt-0.5 shrink-0" />
                        Only an Administrator can add users or change their status.
                      </div>
                    )}

                    {usersError && (
                      <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                        {usersError}
                      </div>
                    )}

                    <div className="mb-5 grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-[#F7F9F6] p-4">
                        <p className="text-xs text-[#849087]">
                          Total users
                        </p>
                        <p className="mt-1 text-2xl font-bold">
                          {usersLoading ? "—" : users.length}
                        </p>
                      </div>
                      <div className="rounded-xl bg-[#F7F9F6] p-4">
                        <p className="text-xs text-[#849087]">
                          Active users
                        </p>
                        <p className="mt-1 text-2xl font-bold">
                          {usersLoading ? "—" : activeUsers}
                        </p>
                      </div>
                    </div>

                    {usersLoading ? (
                      <div className="flex items-center justify-center gap-2 py-10 text-xs text-[#849087]">
                        <Loader2 size={16} className="animate-spin" />
                        Loading users…
                      </div>
                    ) : (
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
                                  .filter(Boolean)
                                  .slice(0, 2)
                                  .join("")
                                  .toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">
                                  {user.name}
                                  {user.mustChangePassword && (
                                    <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                      Password not yet set
                                    </span>
                                  )}
                                </p>
                                <p className="truncate text-xs text-[#849087]">
                                  {user.email}
                                </p>
                                <p className="mt-1 text-xs font-medium text-[#52645A]">
                                  {ROLE_LABELS[user.role]}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <span
                                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                  user.status === "ACTIVE"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {user.status === "ACTIVE" ? "Active" : "Inactive"}
                              </span>

                              {isAdmin && (
                                <button
                                  onClick={() => toggleUserStatus(user)}
                                  disabled={pendingUserAction === user.id || user.id === currentUser?.id}
                                  title={
                                    user.id === currentUser?.id
                                      ? "You cannot deactivate your own account."
                                      : undefined
                                  }
                                  className="rounded-lg border border-[#E3E9E3] px-3 py-2 text-xs font-semibold text-[#52645A] hover:bg-[#F7F9F6] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {pendingUserAction === user.id
                                    ? "Saving…"
                                    : user.status === "ACTIVE"
                                      ? "Deactivate"
                                      : "Activate"}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}

                        {users.length === 0 && (
                          <p className="py-6 text-center text-xs text-[#849087]">
                            No users found.
                          </p>
                        )}
                      </div>
                    )}
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

              {activeSection === "personnel" && (
                <>
                  <SettingsPanel
                    title="Drivers & Assistants"
                    description="The roster dispatch selects from -- people with no login account. This section is live."
                    icon={UserCog}
                    action={
                      isAdmin ? (
                        <button
                          onClick={() => {
                            setAddPersonnelError(null);
                            setShowAddPersonnel(true);
                          }}
                          className="flex items-center gap-2 rounded-xl bg-[#183B2D] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#24513D]"
                        >
                          <UserPlus size={15} />
                          Add Personnel
                        </button>
                      ) : undefined
                    }
                  >
                    {!isAdmin && (
                      <div className="mb-5 flex items-start gap-2 rounded-xl border border-[#E8EDE8] bg-[#F7F9F6] p-3 text-xs text-[#68766D]">
                        <ShieldCheck size={15} className="mt-0.5 shrink-0" />
                        Only an Administrator can add, edit or deactivate personnel.
                      </div>
                    )}

                    <div className="mb-4 flex items-center gap-2">
                      <div className="relative flex-1 max-w-sm">
                        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9AA49D]" />
                        <input
                          value={personnelSearch}
                          onChange={(e) => setPersonnelSearch(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void loadPersonnel(personnelSearch);
                          }}
                          placeholder="Search by name or phone"
                          className="settings-input w-full pl-8"
                        />
                      </div>
                      <button
                        onClick={() => void loadPersonnel(personnelSearch)}
                        className="rounded-lg border border-[#E3E9E3] px-3 py-2 text-xs font-semibold text-[#52645A] hover:bg-[#F7F9F6]"
                      >
                        Search
                      </button>
                    </div>

                    {personnelError && (
                      <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                        {personnelError}
                      </div>
                    )}

                    {personnelLoading ? (
                      <div className="flex items-center justify-center gap-2 py-10 text-xs text-[#849087]">
                        <Loader2 size={16} className="animate-spin" />
                        Loading personnel…
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {personnel.map((record) => (
                          <div
                            key={record.id}
                            className="flex flex-col justify-between gap-4 rounded-xl border border-[#E8EDE8] p-4 sm:flex-row sm:items-center"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{record.name}</p>
                              <p className="mt-1 text-xs font-medium text-[#52645A]">
                                {PERSONNEL_ROLE_LABELS[record.role]}
                                {record.role === "OTHER" && record.roleDetail ? ` -- ${record.roleDetail}` : ""}
                              </p>
                              <p className="mt-0.5 text-[11px] text-[#9AA49D]">
                                {record.phone ?? "No phone on file"} · {record.dispatchHistoryCount} dispatch
                                {record.dispatchHistoryCount === 1 ? "" : "es"} on record
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                  record.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {record.status === "ACTIVE" ? "Active" : "Inactive"}
                              </span>

                              {isAdmin && (
                                <>
                                  <button
                                    onClick={() => togglePersonnelStatus(record)}
                                    disabled={pendingPersonnelAction === record.id}
                                    className="rounded-lg border border-[#E3E9E3] px-3 py-2 text-xs font-semibold text-[#52645A] hover:bg-[#F7F9F6] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {record.status === "ACTIVE" ? "Deactivate" : "Activate"}
                                  </button>
                                  <button
                                    onClick={() => removePersonnel(record)}
                                    disabled={pendingPersonnelAction === record.id}
                                    title={record.dispatchHistoryCount > 0 ? "Has dispatch history -- deactivate instead" : "Delete"}
                                    className="rounded-lg border border-[#E3E9E3] p-2 text-[#9B3B3B] hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {pendingPersonnelAction === record.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}

                        {personnel.length === 0 && <p className="py-6 text-center text-xs text-[#849087]">No personnel found.</p>}
                      </div>
                    )}
                  </SettingsPanel>

                  <SettingsPanel
                    title="Vehicles"
                    description="The registered truck/vehicle list dispatch selects from. This section is live."
                    icon={Truck}
                    action={
                      isAdmin ? (
                        <button
                          onClick={() => {
                            setAddVehicleError(null);
                            setShowAddVehicle(true);
                          }}
                          className="flex items-center gap-2 rounded-xl bg-[#183B2D] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#24513D]"
                        >
                          <Truck size={15} />
                          Add Vehicle
                        </button>
                      ) : undefined
                    }
                  >
                    <div className="mb-4 flex items-center gap-2">
                      <div className="relative flex-1 max-w-sm">
                        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9AA49D]" />
                        <input
                          value={vehicleSearch}
                          onChange={(e) => setVehicleSearch(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void loadVehicles(vehicleSearch);
                          }}
                          placeholder="Search by registration or description"
                          className="settings-input w-full pl-8"
                        />
                      </div>
                      <button
                        onClick={() => void loadVehicles(vehicleSearch)}
                        className="rounded-lg border border-[#E3E9E3] px-3 py-2 text-xs font-semibold text-[#52645A] hover:bg-[#F7F9F6]"
                      >
                        Search
                      </button>
                    </div>

                    {vehiclesError && (
                      <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                        {vehiclesError}
                      </div>
                    )}

                    {vehiclesLoading ? (
                      <div className="flex items-center justify-center gap-2 py-10 text-xs text-[#849087]">
                        <Loader2 size={16} className="animate-spin" />
                        Loading vehicles…
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {vehicles.map((vehicle) => (
                          <div
                            key={vehicle.id}
                            className="flex flex-col justify-between gap-4 rounded-xl border border-[#E8EDE8] p-4 sm:flex-row sm:items-center"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{vehicle.registrationNumber}</p>
                              <p className="mt-1 text-xs text-[#52645A]">{vehicle.description ?? "No description on file"}</p>
                              <p className="mt-0.5 text-[11px] text-[#9AA49D]">
                                {vehicle.dispatchHistoryCount} dispatch{vehicle.dispatchHistoryCount === 1 ? "" : "es"} on record
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                  vehicle.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {vehicle.status === "ACTIVE" ? "Active" : "Inactive"}
                              </span>

                              {isAdmin && (
                                <>
                                  <button
                                    onClick={() => toggleVehicleStatus(vehicle)}
                                    disabled={pendingVehicleAction === vehicle.id}
                                    className="rounded-lg border border-[#E3E9E3] px-3 py-2 text-xs font-semibold text-[#52645A] hover:bg-[#F7F9F6] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {vehicle.status === "ACTIVE" ? "Deactivate" : "Activate"}
                                  </button>
                                  <button
                                    onClick={() => removeVehicle(vehicle)}
                                    disabled={pendingVehicleAction === vehicle.id}
                                    title={vehicle.dispatchHistoryCount > 0 ? "Has dispatch history -- deactivate instead" : "Delete"}
                                    className="rounded-lg border border-[#E3E9E3] p-2 text-[#9B3B3B] hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {pendingVehicleAction === vehicle.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}

                        {vehicles.length === 0 && <p className="py-6 text-center text-xs text-[#849087]">No vehicles found.</p>}
                      </div>
                    )}
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
      {showAddUser && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Add User</h2>
                <p className="mt-1 text-xs text-[#849087]">
                  Creates a real account with a system-generated temporary
                  password. The new user must change it at first login.
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

            {addUserError && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {addUserError}
              </div>
            )}

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
                    setNewUser({ ...newUser, role: e.target.value as AppUser["role"] })
                  }
                  className="settings-input"
                >
                  <option value="SALESPERSON">Salesperson</option>
                  <option value="SALES_MANAGER">Sales Manager</option>
                  <option value="ADMINISTRATOR">Administrator</option>
                </select>
              </Field>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowAddUser(false)}
                disabled={addingUser}
                className="flex-1 rounded-xl border border-[#E3E9E3] px-4 py-3 text-sm font-semibold text-[#68766D] hover:bg-[#F7F9F6] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={addUser}
                disabled={addingUser}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#183B2D] px-4 py-3 text-sm font-semibold text-white hover:bg-[#24513D] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {addingUser && <Loader2 size={15} className="animate-spin" />}
                {addingUser ? "Adding…" : "Add User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Final Operational Enhancements (spec Part 4): Add personnel modal */}
      {showAddPersonnel && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Add Personnel</h2>
                <p className="mt-1 text-xs text-[#849087]">A named roster entry with no login account.</p>
              </div>
              <button onClick={() => setShowAddPersonnel(false)} className="rounded-lg p-2 text-[#849087] hover:bg-[#F3F5F2]" aria-label="Close">
                <X size={19} />
              </button>
            </div>

            {addPersonnelError && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {addPersonnelError}
              </div>
            )}

            <div className="space-y-4">
              <Field label="Full Name">
                <input
                  value={newPersonnel.name}
                  onChange={(e) => setNewPersonnel({ ...newPersonnel, name: e.target.value })}
                  placeholder="Enter full name"
                  className="settings-input"
                />
              </Field>

              <Field label="Role">
                <select
                  value={newPersonnel.role}
                  onChange={(e) => setNewPersonnel({ ...newPersonnel, role: e.target.value as Personnel["role"] })}
                  className="settings-input"
                >
                  <option value="DRIVER">Driver</option>
                  <option value="DRIVER_ASSISTANT">Driver&apos;s Assistant</option>
                  <option value="OTHER">Other</option>
                </select>
              </Field>

              {newPersonnel.role === "OTHER" && (
                <Field label="Role Detail">
                  <input
                    value={newPersonnel.roleDetail}
                    onChange={(e) => setNewPersonnel({ ...newPersonnel, roleDetail: e.target.value })}
                    placeholder="Describe the role"
                    className="settings-input"
                  />
                </Field>
              )}

              <Field label="Phone (optional)">
                <input
                  value={newPersonnel.phone}
                  onChange={(e) => setNewPersonnel({ ...newPersonnel, phone: e.target.value })}
                  placeholder="Enter phone number"
                  className="settings-input"
                />
              </Field>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowAddPersonnel(false)}
                disabled={addingPersonnel}
                className="flex-1 rounded-xl border border-[#E3E9E3] px-4 py-3 text-sm font-semibold text-[#68766D] hover:bg-[#F7F9F6] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={addPersonnel}
                disabled={addingPersonnel}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#183B2D] px-4 py-3 text-sm font-semibold text-white hover:bg-[#24513D] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {addingPersonnel && <Loader2 size={15} className="animate-spin" />}
                {addingPersonnel ? "Adding…" : "Add Personnel"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Final Operational Enhancements (spec Part 4): Add vehicle modal */}
      {showAddVehicle && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Add Vehicle</h2>
                <p className="mt-1 text-xs text-[#849087]">Registered for selection on the Dispatch screen.</p>
              </div>
              <button onClick={() => setShowAddVehicle(false)} className="rounded-lg p-2 text-[#849087] hover:bg-[#F3F5F2]" aria-label="Close">
                <X size={19} />
              </button>
            </div>

            {addVehicleError && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {addVehicleError}
              </div>
            )}

            <div className="space-y-4">
              <Field label="Registration Number">
                <input
                  value={newVehicle.registrationNumber}
                  onChange={(e) => setNewVehicle({ ...newVehicle, registrationNumber: e.target.value })}
                  placeholder="e.g. ABC 1234"
                  className="settings-input"
                />
              </Field>

              <Field label="Description (optional)">
                <input
                  value={newVehicle.description}
                  onChange={(e) => setNewVehicle({ ...newVehicle, description: e.target.value })}
                  placeholder="e.g. Isuzu 5-tonne truck"
                  className="settings-input"
                />
              </Field>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowAddVehicle(false)}
                disabled={addingVehicle}
                className="flex-1 rounded-xl border border-[#E3E9E3] px-4 py-3 text-sm font-semibold text-[#68766D] hover:bg-[#F7F9F6] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={addVehicle}
                disabled={addingVehicle}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#183B2D] px-4 py-3 text-sm font-semibold text-white hover:bg-[#24513D] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {addingVehicle && <Loader2 size={15} className="animate-spin" />}
                {addingVehicle ? "Adding…" : "Add Vehicle"}
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

