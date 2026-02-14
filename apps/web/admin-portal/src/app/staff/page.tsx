"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { staffApi, type StaffMember, type StaffRole, type StaffStatus } from "@/lib/api";
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
} from "lucide-react";

const ROLE_CONFIG: Record<StaffRole, { label: string; color: string; icon: React.ReactNode }> = {
  staff: { label: "Staff", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: <Users className="h-3 w-3" /> },
  senior_staff: { label: "Senior Staff", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", icon: <ShieldCheck className="h-3 w-3" /> },
  supervisor: { label: "Supervisor", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", icon: <Shield className="h-3 w-3" /> },
  admin: { label: "Admin", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: <Crown className="h-3 w-3" /> },
};

const STATUS_CONFIG: Record<StaffStatus, { label: string; color: string }> = {
  active: { label: "Active", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  inactive: { label: "Inactive", color: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
  suspended: { label: "Suspended", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

const PERMISSIONS = [
  { id: "captcha", label: "Captcha" },
  { id: "otp", label: "OTP" },
  { id: "document_review", label: "Document Review" },
  { id: "manual_booking", label: "Manual Booking" },
  { id: "escalation", label: "Escalation" },
  { id: "admin", label: "Admin Panel" },
];

export default function StaffPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [staffToDelete, setStaffToDelete] = useState<StaffMember | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    role: "staff" as StaffRole,
    permissions: [] as string[],
  });

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-list"] });
      queryClient.invalidateQueries({ queryKey: ["staff-dashboard"] });
      setIsModalOpen(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof staffApi.update>[1] }) =>
      staffApi.update(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-list"] });
      setIsModalOpen(false);
      setEditingStaff(null);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: staffApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-list"] });
      queryClient.invalidateQueries({ queryKey: ["staff-dashboard"] });
      setStaffToDelete(null);
    },
  });

  const suspendMutation = useMutation({
    mutationFn: staffApi.suspend,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-list"] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: staffApi.activate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-list"] });
    },
  });

  const resetForm = () => {
    setFormData({ email: "", name: "", role: "staff", permissions: [] });
  };

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
      permissions: staff.permissions,
    });
    setEditingStaff(staff);
    setIsModalOpen(true);
    setActiveDropdown(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingStaff) {
      updateMutation.mutate({
        id: editingStaff.id,
        updates: {
          name: formData.name,
          role: formData.role,
          permissions: formData.permissions,
        },
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
          <Button onClick={openCreateModal}>
            <Plus className="h-4 w-4 mr-2" />
            Add Staff
          </Button>
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
              <option value="staff">Staff</option>
              <option value="senior_staff">Senior Staff</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Admin</option>
            </select>
            <select
              className="px-4 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 outline-none cursor-pointer transition-all duration-200"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
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
            <Button onClick={openCreateModal} className="mt-4">
              <Plus className="h-4 w-4 mr-2" />
              Add Staff
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
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
                          <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${statusConfig.color}`}>
                            {statusConfig.label}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-1">
                            {staff.permissions.slice(0, 3).map(p => (
                              <span key={p} className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-slate-700 rounded capitalize">
                                {p.replace('_', ' ')}
                              </span>
                            ))}
                            {staff.permissions.length > 3 && (
                              <span className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-slate-700 rounded">
                                +{staff.permissions.length - 3}
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
                          <div className="relative">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setActiveDropdown(activeDropdown === staff.id ? null : staff.id)}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                            {activeDropdown === staff.id && (
                              <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 py-1 z-10">
                                <button
                                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
                                  onClick={() => openEditModal(staff)}
                                >
                                  <Edit className="h-4 w-4" />
                                  Edit
                                </button>
                                {staff.status === 'active' ? (
                                  <button
                                    className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 text-orange-600"
                                    onClick={() => { suspendMutation.mutate(staff.id); setActiveDropdown(null); }}
                                  >
                                    <UserX className="h-4 w-4" />
                                    Suspend
                                  </button>
                                ) : (
                                  <button
                                    className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 text-green-600"
                                    onClick={() => { activateMutation.mutate(staff.id); setActiveDropdown(null); }}
                                  >
                                    <UserCheck className="h-4 w-4" />
                                    Activate
                                  </button>
                                )}
                                <hr className="my-1 border-gray-100 dark:border-slate-700" />
                                <button
                                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 text-red-600"
                                  onClick={() => { setStaffToDelete(staff); setActiveDropdown(null); }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
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
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              disabled={!!editingStaff}
              required
              placeholder="staff@example.com"
            />
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
              onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value as StaffRole }))}
            >
              <option value="staff">Staff</option>
              <option value="senior_staff">Senior Staff</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Permissions</label>
            <div className="grid grid-cols-2 gap-2">
              {PERMISSIONS.map(p => (
                <label key={p.id} className="flex items-center gap-2 p-2 rounded border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.permissions.includes(p.id)}
                    onChange={() => togglePermission(p.id)}
                    className="rounded"
                  />
                  <span className="text-sm">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
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

      {/* Click outside to close dropdown */}
      {activeDropdown && (
        <div className="fixed inset-0 z-0" onClick={() => setActiveDropdown(null)} />
      )}
    </div>
  );
}
