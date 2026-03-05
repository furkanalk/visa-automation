"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { SaveBanner } from "@/components/ui/save-banner";
import { staffApi, type StaffMember, type StaffRole, type StaffStatus } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import {
  Users,
  Search,
  Plus,
  MoreVertical,
  Edit,
  Trash2,
  UserCheck,
  UserX,
  Shield,
  ShieldCheck,
  Crown,
  Mail,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  RefreshCw,
  Activity,
  TrendingUp,
  Timer,
  Eye,
  EyeOff,
  KeyRound,
  Copy,
  Check,
  Send,
} from "lucide-react";

const ROLE_CONFIG: Record<StaffRole, { label: string; color: string; icon: React.ReactNode }> = {
  super_admin: { label: "Super admin", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: <Crown className="h-3 w-3" /> },
  admin: { label: "Admin", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: <Shield className="h-3 w-3" /> },
  staff: { label: "Staff", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: <Users className="h-3 w-3" /> },
};

function canManageRole(actorRole: string | undefined, targetRole: StaffRole): boolean {
  if (!actorRole) return false;
  if (actorRole === "super_admin") return true;
  if (actorRole === "admin") return targetRole === "staff";
  return false;
}

function assignableRoles(actorRole: string | undefined): StaffRole[] {
  if (actorRole === "super_admin") return ["super_admin", "admin", "staff"];
  if (actorRole === "admin") return ["staff"];
  return [];
}

/** API may return permissions as object (e.g. empty {} from DB); normalize to array. */
function staffPermissionsList(staff: StaffMember): string[] {
  return Array.isArray(staff.permissions) ? staff.permissions : [];
}

const STATUS_CONFIG: Record<StaffStatus, { label: string; color: string }> = {
  active: { label: "Active", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  inactive: { label: "Inactive", color: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
  suspended: { label: "Suspended", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  pending: { label: "Pending", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
};

const PERMISSIONS = [
  { id: "staff_portal", label: "Staff Portal", description: "Can log in to the Staff Portal (HITL tasks)" },
  { id: "admin_panel", label: "Admin Panel", description: "Can log in to the Admin Portal (management)" },
  { id: "captcha", label: "Captcha", description: "Can solve CAPTCHA tasks in Staff Portal" },
  { id: "otp", label: "OTP", description: "Can solve OTP / Security Code tasks in Staff Portal" },
  { id: "escalation", label: "Escalation", description: "Can escalate tasks to admin" },
  { id: "manual_trigger", label: "Manual Trigger", description: "Can manually start jobs, select slots, trigger watcher actions" },
];

/** Default permissions pre-filled when creating a new staff member by role. User can override. */
const DEFAULT_PERMISSIONS_BY_ROLE: Record<StaffRole, string[]> = {
  staff: ["staff_portal", "captcha", "otp", "escalation"],
  admin: ["staff_portal", "admin_panel", "captcha", "otp", "escalation", "manual_trigger"],
  super_admin: [],
};

export default function StaffPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canEditStaffEmail = user?.role === "super_admin";
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [staffToDelete, setStaffToDelete] = useState<StaffMember | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const showBanner = (type: "success" | "error", text: string) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 5000);
  };
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownAnchor, setDropdownAnchor] = useState<{ top: number; right: number } | null>(null);

  // Invite result dialog (shown when SMTP not configured)
  const [inviteResult, setInviteResult] = useState<{ staffName: string; inviteUrl: string } | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  // Password change state (super_admin only)
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    role: "staff" as StaffRole,
    permissions: DEFAULT_PERMISSIONS_BY_ROLE["staff"] as string[],
  });
  const [formErrors, setFormErrors] = useState<{ email?: string }>({});

  // Queries
  const { data: staffData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["staff-list", search, roleFilter, statusFilter],
    queryFn: () => staffApi.list({
      search: search || undefined,
      role: roleFilter as StaffRole || undefined,
      status: statusFilter as StaffStatus || undefined,
      limit: 50,
    }),
  });

  const { data: dashboardStats } = useQuery({
    queryKey: ["staff-dashboard"],
    queryFn: () => staffApi.getDashboardStats(),
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: staffApi.create,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["staff-list"] });
      queryClient.invalidateQueries({ queryKey: ["staff-dashboard"] });
      setIsModalOpen(false);
      resetForm();
      if (!result.email_sent && result.invite_url) {
        setInviteResult({ staffName: result.name, inviteUrl: result.invite_url });
      } else {
        showBanner("success", "Staff created. Invite email sent.");
      }
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to save."),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof staffApi.update>[1] }) =>
      staffApi.update(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-list"] });
      setIsModalOpen(false);
      setEditingStaff(null);
      resetForm();
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to save."),
  });

  const deleteMutation = useMutation({
    mutationFn: staffApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-list"] });
      queryClient.invalidateQueries({ queryKey: ["staff-dashboard"] });
      setStaffToDelete(null);
      showBanner("success", "Deleted.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to delete."),
  });

  const suspendMutation = useMutation({
    mutationFn: staffApi.suspend,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-list"] });
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to update."),
  });

  const activateMutation = useMutation({
    mutationFn: staffApi.activate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-list"] });
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to update."),
  });

  const setPasswordMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      staffApi.setPassword(id, password),
    onSuccess: () => {
      setNewPassword("");
      setShowPassword(false);
      showBanner("success", "Password updated.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to update password."),
  });

  const resendInviteMutation = useMutation({
    mutationFn: (id: string) => staffApi.resendInvite(id),
    onSuccess: (result, id) => {
      setActiveDropdown(null);
      setDropdownAnchor(null);
      if (!result.email_sent && result.invite_url) {
        const staff = staffData?.items.find((s) => s.id === id);
        setInviteResult({ staffName: staff?.name ?? "Staff", inviteUrl: result.invite_url });
      } else {
        showBanner("success", "Invite email re-sent.");
      }
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to resend invite."),
  });

  const resetForm = () => {
    setFormData({ email: "", name: "", role: "staff", permissions: DEFAULT_PERMISSIONS_BY_ROLE["staff"] });
    setFormErrors({});
    setNewPassword("");
    setShowPassword(false);
  };

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  const openCreateModal = () => {
    resetForm();
    setEditingStaff(null);
    setIsModalOpen(true);
  };

  const openEditModal = (staff: StaffMember) => {
    setFormData({
      email: staff.email,
      name: staff.name,
      role: staff.role,
      permissions: staffPermissionsList(staff),
    });
    setEditingStaff(staff);
    setIsModalOpen(true);
    setActiveDropdown(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});
    if (!editingStaff) {
      const email = formData.email.trim();
      if (!email || !isValidEmail(email)) {
        setFormErrors({ email: "Please enter a valid email address (e.g. name@example.com)." });
        return;
      }
    }
    if (editingStaff) {
      const updates: { name: string; role: StaffRole; permissions: string[]; email?: string } = {
        name: formData.name,
        role: formData.role,
        permissions: formData.permissions,
      };
      if (canEditStaffEmail) updates.email = formData.email.trim() || undefined;
      updateMutation.mutate({
        id: editingStaff.id,
        updates,
      });
    } else {
      createMutation.mutate(formData);
    }
  };

  const togglePermission = (permission: string) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter(p => p !== permission)
        : [...prev.permissions, permission],
    }));
  };

  const formatLastActive = (date: string | null) => {
    if (!date) return "Never";
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      <SaveBanner message={banner} onDismiss={() => setBanner(null)} />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Staff Management</h1>
          <p className="text-gray-500 dark:text-gray-400">
            Manage staff members and their permissions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {assignableRoles(user?.role).length > 0 && (
          <Button onClick={openCreateModal}>
            <Plus className="h-4 w-4 mr-2" />
            Add Staff
          </Button>
        )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Users className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {dashboardStats?.totalStaff ?? 0}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Total Staff</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <UserCheck className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {dashboardStats?.activeStaff ?? 0}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Active</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <Activity className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {dashboardStats?.onlineNow ?? 0}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Online Now</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                <TrendingUp className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {dashboardStats?.tasksToday ?? 0}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Tasks Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 border-transparent bg-blue-50 dark:bg-slate-700 shadow-sm focus:shadow-md focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>
            <select
              className="px-4 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 outline-none cursor-pointer transition-all duration-200"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">All Roles</option>
              <option value="super_admin">Super admin</option>
              <option value="admin">Admin</option>
              <option value="staff">Staff</option>
            </select>
            <select
              className="px-4 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 outline-none cursor-pointer transition-all duration-200"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Staff List */}
      {isLoading ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-gray-500 dark:text-gray-400">Loading staff members...</p>
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">Failed to load staff</p>
            <p className="text-sm text-gray-400 mt-1">
              {error instanceof Error ? error.message : "API server may be unavailable"}
            </p>
            <Button variant="outline" onClick={() => refetch()} className="mt-4">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : !staffData?.items.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Users className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No staff members found</p>
            <p className="text-sm text-gray-400 mt-1">
              {search || roleFilter || statusFilter ? "Try adjusting your filters" : "Add staff members to get started"}
            </p>
            {assignableRoles(user?.role).length > 0 && (
              <Button onClick={openCreateModal} className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Add Staff
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto rounded-xl overflow-hidden">
              <table className="w-full">
                <thead className="bg-blue-50 dark:bg-slate-800 border-b border-blue-100 dark:border-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Staff Member</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Permissions</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Performance</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last Active</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {staffData.items.map((staff) => {
                    const roleConfig = ROLE_CONFIG[staff.role];
                    const statusConfig = STATUS_CONFIG[staff.status];
                    const canManage = canManageRole(user?.role, staff.role);
                    return (
                      <tr key={staff.id} className="hover:bg-blue-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <span className="text-primary font-medium">
                                {staff.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-900 dark:text-white">{staff.name}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                {staff.email}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${roleConfig.color}`}>
                            {roleConfig.icon}
                            {roleConfig.label}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${statusConfig?.color ?? 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'}`}>
                            {statusConfig?.label ?? (staff.status === 'suspended' ? 'Suspended' : staff.status)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-1">
                            {staffPermissionsList(staff).slice(0, 3).map(p => (
                              <span key={p} className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-slate-700 rounded capitalize">
                                {p.replace('_', ' ')}
                              </span>
                            ))}
                            {staffPermissionsList(staff).length > 3 && (
                              <span
                                className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-slate-700 rounded cursor-help"
                                title={staffPermissionsList(staff)
                                  .slice(3)
                                  .map((p) => p.replace(/_/g, " "))
                                  .join(", ")}
                              >
                                +{staffPermissionsList(staff).length - 3}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-sm">
                            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                              <CheckCircle className="h-3 w-3 text-green-500" />
                              {staff.metrics.resolved_tasks ?? 0} resolved
                            </div>
                            {staff.metrics.success_rate !== undefined && (
                              <div className="text-xs text-gray-500">
                                {staff.metrics.success_rate}% success rate
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                            <Clock className="h-3 w-3" />
                            {formatLastActive(staff.last_active_at)}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right">
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                if (activeDropdown === staff.id) {
                                  setActiveDropdown(null);
                                  setDropdownAnchor(null);
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setDropdownAnchor({
                                    top: rect.bottom + 4,
                                    right: window.innerWidth - rect.right,
                                  });
                                  setActiveDropdown(staff.id);
                                }
                              }}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions dropdown: render in portal so it appears above table/overflow */}
      {typeof document !== "undefined" &&
       activeDropdown &&
       dropdownAnchor &&
       (() => {
         const staff = staffData?.items?.find((s) => s.id === activeDropdown);
         if (!staff) return null;
         return createPortal(
           <>
             <div
               className="fixed inset-0 z-[9998]"
               aria-hidden
               onClick={() => {
                 setActiveDropdown(null);
                 setDropdownAnchor(null);
               }}
             />
             <div
               className="fixed z-[9999] w-48 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-gray-200 dark:border-slate-700 py-1"
               style={{ top: dropdownAnchor.top, right: dropdownAnchor.right }}
               role="menu"
            >
               <button
                 className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 rounded-t-xl"
                 role="menuitem"
                 onClick={() => {
                   openEditModal(staff);
                   setActiveDropdown(null);
                   setDropdownAnchor(null);
                 }}
               >
                 <Edit className="h-4 w-4" />
                 Edit
               </button>
               {staff.status === "active" && (
                 <button
                   className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 text-orange-600"
                   role="menuitem"
                   title="Mark as suspended (staff cannot use staff features until activated again)"
                   onClick={() => {
                     suspendMutation.mutate(staff.id);
                     setActiveDropdown(null);
                     setDropdownAnchor(null);
                   }}
                 >
                   <UserX className="h-4 w-4" />
                   Suspend
                 </button>
               )}
               {(staff.status === "suspended" || staff.status === "inactive") && (
                 <button
                   className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 text-green-600"
                   role="menuitem"
                   onClick={() => {
                     activateMutation.mutate(staff.id);
                     setActiveDropdown(null);
                     setDropdownAnchor(null);
                   }}
                 >
                   <UserCheck className="h-4 w-4" />
                   Activate
                 </button>
               )}
               {staff.status === "pending" && (
                 <button
                   className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 text-amber-600"
                   role="menuitem"
                   onClick={() => resendInviteMutation.mutate(staff.id)}
                   disabled={resendInviteMutation.isPending}
                 >
                   {resendInviteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                   Resend Invite
                 </button>
               )}
               <hr className="my-1 border-gray-100 dark:border-slate-700" />
               <button
                 className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 text-red-600 rounded-b-xl"
                 role="menuitem"
                 onClick={() => {
                   setStaffToDelete(staff);
                   setActiveDropdown(null);
                   setDropdownAnchor(null);
                 }}
               >
                 <Trash2 className="h-4 w-4" />
                 Delete
               </button>
             </div>
           </>,
           document.body
         );
       })()}

      {/* Create/Edit Modal */}
      <Modal
        open={isModalOpen}
        onClose={() => { setIsModalOpen(false); setEditingStaff(null); resetForm(); }}
        title={editingStaff ? "Edit Staff Member" : "Add Staff Member"}
        footer={
          <>
            <Button variant="outline" onClick={() => { setIsModalOpen(false); setEditingStaff(null); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingStaff ? "Save Changes" : "Add Staff"}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <Input
              type="email"
              value={formData.email}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, email: e.target.value }));
                if (formErrors.email) setFormErrors(prev => ({ ...prev, email: undefined }));
              }}
              disabled={!!editingStaff && !canEditStaffEmail}
              required
              placeholder="staff@example.com"
              className={formErrors.email ? "border-red-500 dark:border-red-500" : ""}
            />
            {formErrors.email && (
              <p className="mt-1 text-sm text-red-500">{formErrors.email}</p>
            )}
            {editingStaff && !canEditStaffEmail && (
              <p className="mt-1 text-sm text-red-500">No permission granted. Only super_admin can update email.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              required
              placeholder="Full name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label>
            <select
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              value={formData.role}
              onChange={(e) => {
                const newRole = e.target.value as StaffRole;
                setFormData(prev => ({
                  ...prev,
                  role: newRole,
                  // Only auto-fill permissions when creating (not editing existing staff)
                  ...(!editingStaff ? { permissions: DEFAULT_PERMISSIONS_BY_ROLE[newRole] } : {}),
                }));
              }}
            >
              {assignableRoles(user?.role).map((r) => (
                <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Permissions</label>
            {formData.role === "super_admin" ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                Super admin bypasses all permission checks — no need to assign permissions.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {PERMISSIONS.map(p => (
                  <label key={p.id} title={p.description} className="flex items-center gap-2 p-2 rounded border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.permissions.includes(p.id)}
                      onChange={() => togglePermission(p.id)}
                      className="rounded"
                    />
                    <div>
                      <span className="text-sm font-medium">{p.label}</span>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">{p.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
          {/* Password section — only visible when editing */}
          {editingStaff && (
            <div className="pt-2 border-t border-gray-100 dark:border-slate-700">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1">
                <KeyRound className="h-3.5 w-3.5" />
                Password
              </label>
              {user?.role === "super_admin" ? (
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New password (min 8 chars)"
                      minLength={8}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={newPassword.length < 8 || setPasswordMutation.isPending}
                    onClick={() => setPasswordMutation.mutate({ id: editingStaff.id, password: newPassword })}
                  >
                    {setPasswordMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set"}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600">
                  <span className="text-gray-400 tracking-widest text-sm">••••••••</span>
                  <span className="text-xs text-gray-400 ml-auto">Only super_admin can change passwords</span>
                </div>
              )}
            </div>
          )}
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      {staffToDelete && (
        <Modal
          open={true}
          onClose={() => setStaffToDelete(null)}
          title="Delete Staff Member"
          footer={
            <>
              <Button variant="outline" onClick={() => setStaffToDelete(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate(staffToDelete.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Delete
              </Button>
            </>
          }
        >
          <p className="text-gray-600 dark:text-gray-400">
            Are you sure you want to delete <strong>{staffToDelete.name}</strong>? This action cannot be undone.
          </p>
        </Modal>
      )}

      {/* Invite Link Modal (shown when SMTP not configured) */}
      {inviteResult && (
        <Modal
          open={true}
          onClose={() => { setInviteResult(null); setInviteCopied(false); }}
          title="Share Invite Link"
          footer={
            <Button onClick={() => { setInviteResult(null); setInviteCopied(false); }}>Done</Button>
          }
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800 dark:text-amber-300">
                <p className="font-medium">Invite email could not be sent</p>
                <p className="mt-1 text-amber-700 dark:text-amber-400">
                  Email (SMTP) is not configured in Notifications settings. Share this link manually with <strong>{inviteResult.staffName}</strong>.
                </p>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Invite Link</label>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="flex-1 px-3 py-2 text-xs bg-gray-100 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-md break-all font-mono select-all">
                  {inviteResult.inviteUrl}
                </code>
                <button
                  type="button"
                  className="shrink-0 p-2 rounded-md border border-gray-200 dark:border-slate-600 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                  onClick={() => {
                    navigator.clipboard.writeText(inviteResult.inviteUrl);
                    setInviteCopied(true);
                    setTimeout(() => setInviteCopied(false), 2000);
                  }}
                  title="Copy to clipboard"
                >
                  {inviteCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-gray-500" />}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">This link expires in 7 days. To enable email invites, configure SMTP in <strong>Notifications → Email</strong>.</p>
            </div>
          </div>
        </Modal>
      )}

      {/* Click outside to close dropdown */}
      {activeDropdown && (
        <div className="fixed inset-0 z-0" onClick={() => setActiveDropdown(null)} />
      )}
    </div>
  );
}
