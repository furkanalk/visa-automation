"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { customerApi, cpApi, type Customer, type CustomerStatus, type CustomerCounts, type PortalConfig, type Profile } from "@/lib/api";
import {
  Plus,
  Search,
  Filter,
  Loader2,
  User,
  Pause,
  Play,
  Trash2,
  Edit,
  Eye,
  Rocket,
  Users,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

type ViewMode = "list" | "detail" | "create" | "edit";

interface CustomerFormData {
  display_name: string;
  internal_ref: string;
  portal_id: string;
  profile_id: string;
  priority: number;
  tags: string;
  notify_email: string;
  notify_phone: string;
  notify_telegram_chat_id: string;
  visa_type: string;
  appointment_city: string;
  preferred_date_from: string;
  preferred_date_to: string;
  family_size: number;
  vip: boolean;
  requires_otp_staff: boolean;
}

const initialFormData: CustomerFormData = {
  display_name: "",
  internal_ref: "",
  portal_id: "as-visa",
  profile_id: "",
  priority: 50,
  tags: "",
  notify_email: "",
  notify_phone: "",
  notify_telegram_chat_id: "",
  visa_type: "tourist",
  appointment_city: "",
  preferred_date_from: "",
  preferred_date_to: "",
  family_size: 1,
  vip: false,
  requires_otp_staff: false,
};

const STATUS_CONFIG: Record<CustomerStatus, { label: string; color: string; icon: React.ReactNode }> = {
  active: { label: "Active", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: <CheckCircle className="h-3 w-3" /> },
  paused: { label: "Paused", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", icon: <Pause className="h-3 w-3" /> },
  completed: { label: "Completed", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: <CheckCircle className="h-3 w-3" /> },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400", icon: <XCircle className="h-3 w-3" /> },
};

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState<CustomerFormData>(initialFormData);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteCustomerId, setDeleteCustomerId] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const pageSize = 20;

  // Fetch customers
  const { data: customersData, isLoading: customersLoading, isError: customersError, error: customerErrorMsg, refetch: refetchCustomers } = useQuery({
    queryKey: ["customers", search, statusFilter, page],
    queryFn: () => customerApi.list({
      search: search || undefined,
      status: statusFilter || undefined,
      limit: pageSize,
      offset: page * pageSize,
    }),
  });

  // Fetch portals for dropdown
  const { data: portals } = useQuery({
    queryKey: ["portals"],
    queryFn: () => cpApi.getPortals(),
  });

  // Fetch profiles for dropdown
  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => cpApi.getProfiles(),
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: CustomerFormData) => {
      return customerApi.create({
        display_name: data.display_name,
        internal_ref: data.internal_ref || null,
        portal_id: data.portal_id,
        profile_id: data.profile_id || null,
        priority: data.priority,
        tags: data.tags ? data.tags.split(",").map(t => t.trim()) : [],
        notify_email: data.notify_email || null,
        notify_phone: data.notify_phone || null,
        notify_telegram_chat_id: data.notify_telegram_chat_id || null,
        status: "active",
        preferences: {
          visa_type: data.visa_type || undefined,
          appointment_city: data.appointment_city || undefined,
          preferred_dates: data.preferred_date_from && data.preferred_date_to
            ? { from: data.preferred_date_from, to: data.preferred_date_to }
            : undefined,
          family_size: data.family_size,
        },
        flags: {
          vip: data.vip,
          requires_otp_staff: data.requires_otp_staff,
        },
        slot_check_policy: {},
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setViewMode("list");
      setFormData(initialFormData);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CustomerFormData }) => {
      return customerApi.update(id, {
        display_name: data.display_name,
        internal_ref: data.internal_ref || null,
        portal_id: data.portal_id,
        profile_id: data.profile_id || null,
        priority: data.priority,
        tags: data.tags ? data.tags.split(",").map(t => t.trim()) : [],
        notify_email: data.notify_email || null,
        notify_phone: data.notify_phone || null,
        notify_telegram_chat_id: data.notify_telegram_chat_id || null,
        preferences: {
          visa_type: data.visa_type || undefined,
          appointment_city: data.appointment_city || undefined,
          preferred_dates: data.preferred_date_from && data.preferred_date_to
            ? { from: data.preferred_date_from, to: data.preferred_date_to }
            : undefined,
          family_size: data.family_size,
        },
        flags: {
          vip: data.vip,
          requires_otp_staff: data.requires_otp_staff,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setViewMode("list");
      setSelectedCustomer(null);
      setFormData(initialFormData);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => customerApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setShowDeleteModal(false);
      setDeleteCustomerId(null);
    },
  });

  // Pause/Resume mutations
  const pauseMutation = useMutation({
    mutationFn: (id: string) => customerApi.pause(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => customerApi.resume(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });

  // Trigger slot check
  const triggerSlotCheckMutation = useMutation({
    mutationFn: (id: string) => customerApi.triggerSlotCheck(id),
  });

  const handleEdit = (customer: Customer) => {
    setSelectedCustomer(customer);
    setFormData({
      display_name: customer.display_name,
      internal_ref: customer.internal_ref || "",
      portal_id: customer.portal_id,
      profile_id: customer.profile_id || "",
      priority: customer.priority,
      tags: customer.tags.join(", "),
      notify_email: customer.notify_email || "",
      notify_phone: customer.notify_phone || "",
      notify_telegram_chat_id: customer.notify_telegram_chat_id || "",
      visa_type: customer.preferences.visa_type || "",
      appointment_city: customer.preferences.appointment_city || "",
      preferred_date_from: customer.preferences.preferred_dates?.from || "",
      preferred_date_to: customer.preferences.preferred_dates?.to || "",
      family_size: customer.preferences.family_size || 1,
      vip: customer.flags.vip || false,
      requires_otp_staff: customer.flags.requires_otp_staff || false,
    });
    setViewMode("edit");
  };

  const handleCreate = () => {
    setFormData(initialFormData);
    setSelectedCustomer(null);
    setViewMode("create");
  };

  const handleCancel = () => {
    setViewMode("list");
    setSelectedCustomer(null);
    setFormData(initialFormData);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (viewMode === "create") {
      createMutation.mutate(formData);
    } else if (viewMode === "edit" && selectedCustomer) {
      updateMutation.mutate({ id: selectedCustomer.id, data: formData });
    }
  };

  const counts = customersData?.counts || { active: 0, paused: 0, completed: 0, cancelled: 0 };
  const totalPages = Math.ceil((customersData?.total || 0) / pageSize);

  // List View
  if (viewMode === "list") {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Customers</h1>
            <p className="text-muted-foreground">Manage customer profiles and slot check scheduling</p>
          </div>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Add Customer
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active</p>
                  <p className="text-2xl font-bold text-green-600">{counts.active}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-600 opacity-20" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Paused</p>
                  <p className="text-2xl font-bold text-yellow-600">{counts.paused}</p>
                </div>
                <Pause className="h-8 w-8 text-yellow-600 opacity-20" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Completed</p>
                  <p className="text-2xl font-bold text-blue-600">{counts.completed}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-blue-600 opacity-20" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold">{customersData?.total || 0}</p>
                </div>
                <Users className="h-8 w-8 text-muted-foreground opacity-20" />
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
                    placeholder="Search by name or reference..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                    className="pl-10 border-transparent bg-blue-50 dark:bg-slate-700 shadow-sm focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500"
                  />
                </div>
              </div>
              <select
                className="px-4 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 outline-none cursor-pointer transition-all duration-200"
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
              >
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Customer List */}
        <Card>
          <CardContent className="p-0">
            {customersLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : customersError ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <AlertCircle className="h-12 w-12 mb-4 text-red-400" />
                <p className="font-medium">Failed to load customers</p>
                <p className="text-sm text-gray-400 mt-1">
                  {customerErrorMsg instanceof Error ? customerErrorMsg.message : "API server may be unavailable"}
                </p>
                <Button variant="outline" className="mt-4" onClick={() => refetchCustomers()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
              </div>
            ) : !customersData?.items.length ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Users className="h-12 w-12 mb-4 opacity-20" />
                <p>No customers found</p>
                <Button variant="outline" className="mt-4" onClick={handleCreate}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add First Customer
                </Button>
              </div>
            ) : (
              <div className="divide-y">
                {customersData.items.map((customer) => {
                  const statusConfig = STATUS_CONFIG[customer.status];
                  return (
                    <div
                      key={customer.id}
                      className="p-4 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <User className="h-5 w-5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">
                                {customer.display_name}
                              </span>
                              {customer.flags.vip && (
                                <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                                  VIP
                                </Badge>
                              )}
                              <Badge className={statusConfig.color}>
                                {statusConfig.icon}
                                <span className="ml-1">{statusConfig.label}</span>
                              </Badge>
                            </div>
                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                              {customer.internal_ref && (
                                <span>Ref: {customer.internal_ref}</span>
                              )}
                              <span>Portal: {customer.portal_id}</span>
                              <span>Priority: {customer.priority}</span>
                              <span>Jobs: {customer.total_jobs}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {customer.status === "active" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => triggerSlotCheckMutation.mutate(customer.id)}
                              disabled={triggerSlotCheckMutation.isPending}
                            >
                              <Rocket className="h-4 w-4" />
                            </Button>
                          )}
                          {customer.status === "active" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => pauseMutation.mutate(customer.id)}
                              disabled={pauseMutation.isPending}
                            >
                              <Pause className="h-4 w-4" />
                            </Button>
                          )}
                          {customer.status === "paused" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => resumeMutation.mutate(customer.id)}
                              disabled={resumeMutation.isPending}
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                          )}
                          <Button variant="outline" size="sm" onClick={() => handleEdit(customer)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => { setDeleteCustomerId(customer.id); setShowDeleteModal(true); }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, customersData?.total || 0)} of {customersData?.total || 0}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        <Modal
          open={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          title="Delete Customer"
          footer={
            <>
              <Button variant="outline" onClick={() => setShowDeleteModal(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteCustomerId && deleteMutation.mutate(deleteCustomerId)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Delete"
                )}
              </Button>
            </>
          }
        >
          <p>Are you sure you want to delete this customer? This action will mark them as cancelled.</p>
        </Modal>
      </div>
    );
  }

  // Create/Edit Form
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={handleCancel}>
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <h1 className="text-2xl font-bold">
          {viewMode === "create" ? "Add Customer" : "Edit Customer"}
        </h1>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 md:grid-cols-2">
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Display Name *</label>
                <Input
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Internal Reference</label>
                <Input
                  value={formData.internal_ref}
                  onChange={(e) => setFormData({ ...formData, internal_ref: e.target.value })}
                  placeholder="e.g., CUS-001"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Tags (comma separated)</label>
                <Input
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="vip, priority, family"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Priority (1-100)</label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 50 })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Portal Config */}
          <Card>
            <CardHeader>
              <CardTitle>Portal Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Portal *</label>
                <select
                  className="w-full px-4 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 outline-none cursor-pointer transition-all duration-200"
                  value={formData.portal_id}
                  onChange={(e) => setFormData({ ...formData, portal_id: e.target.value })}
                  required
                >
                  {portals?.items.map((portal: PortalConfig) => (
                    <option key={portal.id} value={portal.portal_id}>
                      {portal.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Agent Profile</label>
                <select
                  className="w-full px-4 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 outline-none cursor-pointer transition-all duration-200"
                  value={formData.profile_id}
                  onChange={(e) => setFormData({ ...formData, profile_id: e.target.value })}
                >
                  <option value="">Default Profile</option>
                  {profiles?.items.map((profile: Profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Visa Type</label>
                <select
                  className="w-full px-4 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 outline-none cursor-pointer transition-all duration-200"
                  value={formData.visa_type}
                  onChange={(e) => setFormData({ ...formData, visa_type: e.target.value })}
                >
                  <option value="tourist">Tourist</option>
                  <option value="business">Business</option>
                  <option value="student">Student</option>
                  <option value="work">Work</option>
                  <option value="transit">Transit</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Appointment City</label>
                <Input
                  value={formData.appointment_city}
                  onChange={(e) => setFormData({ ...formData, appointment_city: e.target.value })}
                  placeholder="e.g., Istanbul"
                />
              </div>
            </CardContent>
          </Card>

          {/* Preferred Dates */}
          <Card>
            <CardHeader>
              <CardTitle>Preferred Dates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">From Date</label>
                  <Input
                    type="date"
                    value={formData.preferred_date_from}
                    onChange={(e) => setFormData({ ...formData, preferred_date_from: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">To Date</label>
                  <Input
                    type="date"
                    value={formData.preferred_date_to}
                    onChange={(e) => setFormData({ ...formData, preferred_date_to: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Family Size</label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={formData.family_size}
                  onChange={(e) => setFormData({ ...formData, family_size: parseInt(e.target.value) || 1 })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Email</label>
                <Input
                  type="email"
                  value={formData.notify_email}
                  onChange={(e) => setFormData({ ...formData, notify_email: e.target.value })}
                  placeholder="customer@example.com"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Phone</label>
                <Input
                  type="tel"
                  value={formData.notify_phone}
                  onChange={(e) => setFormData({ ...formData, notify_phone: e.target.value })}
                  placeholder="+90 555 123 4567"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Telegram Chat ID</label>
                <Input
                  value={formData.notify_telegram_chat_id}
                  onChange={(e) => setFormData({ ...formData, notify_telegram_chat_id: e.target.value })}
                  placeholder="123456789"
                />
              </div>
            </CardContent>
          </Card>

          {/* Flags */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Special Flags</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.vip}
                    onChange={(e) => setFormData({ ...formData, vip: e.target.checked })}
                    className="rounded"
                  />
                  <span>VIP Customer</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.requires_otp_staff}
                    onChange={(e) => setFormData({ ...formData, requires_otp_staff: e.target.checked })}
                    className="rounded"
                  />
                  <span>Requires OTP from Staff</span>
                </label>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Form Actions */}
        <div className="flex justify-end gap-4 mt-6">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {(createMutation.isPending || updateMutation.isPending) && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            {viewMode === "create" ? "Create Customer" : "Save Changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
