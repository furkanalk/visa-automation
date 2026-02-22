"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { SaveBanner } from "@/components/ui/save-banner";
import { customerApi, cpApi, type Customer, type CustomerStatus, type CustomerCounts, type PortalConfig, type CustomerFormFieldSchema } from "@/lib/api";
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

/** Keys that are always in "visa" section; don't show again in portal-specific. */
const GENERAL_PREFERENCE_KEYS = ["idNo", "passportNumber", "name", "surname", "middleName", "birthDate", "email", "phone"] as const;

type TravelDateMode = "auto" | "single" | "range";
type TravelDateAlgorithm = "nearest" | "farthest" | "middle" | "1month" | "2months";

interface CustomerFormData {
  display_name: string;
  internal_ref: string;
  portal_id: string;
  priority: number;
  tags: string;
  idNo: string;
  passportNumber: string;
  name: string;
  surname: string;
  middleName: string;
  birthDate: string;
  email: string;
  phone: string;
  travelDateMode: TravelDateMode;
  travelDateAlgorithm: TravelDateAlgorithm;
  travelDateSingle: string;
  travelDateFrom: string;
  travelDateTo: string;
  notify_email: string;
  notify_phone: string;
  notify_telegram_chat_id: string;
  customer_telegram_chat_id: string;
  useSameEmail: boolean;
  useSamePhone: boolean;
  useDefaultTelegram: boolean;
  vip: boolean;
}

/** Portal-specific field values (keys match schema); stored in customer.preferences */
type DynamicPreferences = Record<string, string | number | boolean>;

const initialFormData: CustomerFormData = {
  display_name: "",
  internal_ref: "",
  portal_id: "",
  priority: 50,
  tags: "",
  idNo: "",
  passportNumber: "",
  name: "",
  surname: "",
  middleName: "",
  birthDate: "",
  email: "",
  phone: "",
  travelDateMode: "auto",
  travelDateAlgorithm: "nearest",
  travelDateSingle: "",
  travelDateFrom: "",
  travelDateTo: "",
  notify_email: "",
  notify_phone: "",
  notify_telegram_chat_id: "",
  customer_telegram_chat_id: "",
  useSameEmail: true,
  useSamePhone: true,
  useDefaultTelegram: true,
  vip: false,
};

const TRAVEL_ALGORITHM_LABELS: Record<TravelDateAlgorithm, string> = {
  nearest: "Nearest available",
  farthest: "Farthest available",
  middle: "Mid-range (balanced)",
  "1month": "Within 4–6 weeks",
  "2months": "Within 8–12 weeks",
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
  /** Portal-specific field values; keys match portal's customerFormSchema */
  const [dynamicPreferences, setDynamicPreferences] = useState<DynamicPreferences>({});
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteCustomerId, setDeleteCustomerId] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelCustomerId, setCancelCustomerId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const showBanner = (type: "success" | "error", text: string) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 5000);
  };

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

  // Fetch notify settings for Telegram chat dropdown (chats configured in Notifications)
  const { data: notifySettings } = useQuery({
    queryKey: ["notify-settings"],
    queryFn: () => cpApi.getNotifySettings(),
  });
  const telegramChatIds = notifySettings?.telegram_chat_ids ?? [];

  // Selected portal and its customer form schema (for create/edit)
  const selectedPortal = formData.portal_id
    ? portals?.items?.find((p: PortalConfig) => p.portal_id === formData.portal_id)
    : null;
  const rawCustomerFormSchema = (selectedPortal?.config?.customerFormSchema as CustomerFormFieldSchema[] | undefined) ?? [];
  const customerFormSchema = rawCustomerFormSchema.filter(
    (f) => !(GENERAL_PREFERENCE_KEYS as readonly string[]).includes(f.key)
  );

  const buildPreferences = (data: CustomerFormData) => {
    const prefs: Record<string, unknown> = {
      idNo: data.idNo || undefined,
      passportNumber: data.passportNumber || undefined,
      name: data.name || undefined,
      surname: data.surname || undefined,
      middleName: data.middleName || undefined,
      birthDate: data.birthDate || undefined,
      email: data.email || undefined,
      phone: data.phone || undefined,
      travelDateMode: data.travelDateMode,
      travelDateAlgorithm: data.travelDateAlgorithm,
      ...(data.travelDateMode === "single" && data.travelDateSingle
        ? { travelDateSingle: data.travelDateSingle }
        : {}),
      ...(data.travelDateMode === "range" && (data.travelDateFrom || data.travelDateTo)
        ? { travelDateFrom: data.travelDateFrom || undefined, travelDateTo: data.travelDateTo || undefined }
        : {}),
      ...(data.customer_telegram_chat_id ? { customer_telegram_chat_id: data.customer_telegram_chat_id } : {}),
      ...dynamicPreferences,
    };
    return prefs;
  };

  const getNotifyEmail = (data: CustomerFormData) => (data.useSameEmail ? data.email : data.notify_email) || null;
  const getNotifyPhone = (data: CustomerFormData) => (data.useSamePhone ? data.phone : data.notify_phone) || null;
  const getNotifyTelegramChatId = (data: CustomerFormData) => (data.useDefaultTelegram ? null : data.notify_telegram_chat_id) || null;

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: CustomerFormData) => {
      return customerApi.create({
        display_name: data.display_name,
        internal_ref: data.internal_ref || null,
        portal_id: data.portal_id,
        priority: data.priority,
        tags: data.tags ? data.tags.split(",").map(t => t.trim()) : [],
        notify_email: getNotifyEmail(data),
        notify_phone: getNotifyPhone(data),
        notify_telegram_chat_id: getNotifyTelegramChatId(data),
        status: "active",
        preferences: buildPreferences(data),
        flags: { vip: data.vip },
        slot_check_policy: {},
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setViewMode("list");
      setFormData(initialFormData);
      setDynamicPreferences({});
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to save."),
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CustomerFormData }) => {
      return customerApi.update(id, {
        display_name: data.display_name,
        internal_ref: data.internal_ref || null,
        portal_id: data.portal_id,
        priority: data.priority,
        tags: data.tags ? data.tags.split(",").map(t => t.trim()) : [],
        notify_email: getNotifyEmail(data),
        notify_phone: getNotifyPhone(data),
        notify_telegram_chat_id: getNotifyTelegramChatId(data),
        preferences: buildPreferences(data),
        flags: { vip: data.vip },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setViewMode("list");
      setSelectedCustomer(null);
      setFormData(initialFormData);
      setDynamicPreferences({});
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to save."),
  });

  // Delete mutation (permanent/hard delete)
  const deleteMutation = useMutation({
    mutationFn: (id: string) => customerApi.delete(id, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setShowDeleteModal(false);
      setDeleteCustomerId(null);
      showBanner("success", "Deleted.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to delete."),
  });

  // Cancel mutation (set status to cancelled)
  const cancelMutation = useMutation({
    mutationFn: (id: string) => customerApi.update(id, { status: "cancelled" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setShowCancelModal(false);
      setCancelCustomerId(null);
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to update."),
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => customerApi.pause(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to update."),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => customerApi.resume(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to update."),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => customerApi.update(id, { status: "active" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to update."),
  });

  // Trigger slot check (currently only logs the action; job creation not yet implemented)
  const [slotCheckMessage, setSlotCheckMessage] = useState<string | null>(null);
  const triggerSlotCheckMutation = useMutation({
    mutationFn: (id: string) => customerApi.triggerSlotCheck(id),
    onSuccess: (data) => {
      setSlotCheckMessage(data.job_id ? `Job started. Job ID: ${data.job_id}` : data.message);
      setTimeout(() => setSlotCheckMessage(null), 6000);
    },
  });

  const handleEdit = (customer: Customer) => {
    setSelectedCustomer(customer);
    const prefs = customer.preferences as Record<string, unknown> | undefined;
    const p = prefs && typeof prefs === "object" ? prefs : {};
    const getStr = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
    const getNumStr = (k: string) => (p[k] != null && p[k] !== "" ? String(p[k]) : "");
    setFormData({
      display_name: customer.display_name,
      internal_ref: customer.internal_ref || "",
      portal_id: customer.portal_id,
      priority: customer.priority,
      tags: customer.tags.join(", "),
      idNo: getStr("idNo"),
      passportNumber: getStr("passportNumber"),
      name: getStr("name"),
      surname: getStr("surname"),
      middleName: getStr("middleName"),
      birthDate: getStr("birthDate") || (p.birthYear != null && p.birthYear !== "" ? `${p.birthYear}-01-01` : ""),
      email: getStr("email"),
      phone: getStr("phone"),
      travelDateMode: (p.travelDateMode as TravelDateMode) || "auto",
      travelDateAlgorithm: (p.travelDateAlgorithm as TravelDateAlgorithm) || "nearest",
      travelDateSingle: getStr("travelDateSingle"),
      travelDateFrom: getStr("travelDateFrom"),
      travelDateTo: getStr("travelDateTo"),
      notify_email: customer.notify_email || "",
      notify_phone: customer.notify_phone || "",
      notify_telegram_chat_id: customer.notify_telegram_chat_id || "",
      useSameEmail: customer.notify_email === (p.email as string) || !customer.notify_email,
      useSamePhone: customer.notify_phone === (p.phone as string) || !customer.notify_phone,
      useDefaultTelegram: !customer.notify_telegram_chat_id,
      vip: customer.flags.vip || false,
      customer_telegram_chat_id: (prefs && typeof prefs === "object" && typeof prefs.customer_telegram_chat_id === "string" ? prefs.customer_telegram_chat_id : "") || "",
    });
    const travelKeys = ["travelDateMode", "travelDateAlgorithm", "travelDateSingle", "travelDateFrom", "travelDateTo"];
    const reservedPrefKeys = ["customer_telegram_chat_id"];
    const dyn: DynamicPreferences = {};
    if (prefs && typeof prefs === "object") {
      for (const [k, v] of Object.entries(prefs)) {
        if (
          (GENERAL_PREFERENCE_KEYS as readonly string[]).indexOf(k) === -1 &&
          travelKeys.indexOf(k) === -1 &&
          reservedPrefKeys.indexOf(k) === -1 &&
          (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
        )
          dyn[k] = v;
      }
    }
    setDynamicPreferences(dyn);
    setViewMode("edit");
  };

  const handleCreate = () => {
    setFormData(initialFormData);
    setDynamicPreferences({});
    setSelectedCustomer(null);
    setViewMode("create");
  };

  const handleCancel = () => {
    setViewMode("list");
    setSelectedCustomer(null);
    setFormData(initialFormData);
    setDynamicPreferences({});
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
        <SaveBanner message={banner} onDismiss={() => setBanner(null)} />
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

        {slotCheckMessage && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 px-4 py-2 text-sm text-blue-800 dark:text-blue-200">
            {slotCheckMessage}
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active</p>
                  <p className="text-2xl font-bold text-green-600">{counts.active}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-600 opacity-50" />
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
                <Pause className="h-8 w-8 text-yellow-600 opacity-50" />
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
                <CheckCircle className="h-8 w-8 text-blue-600 opacity-50" />
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
                <Users className="h-8 w-8 text-muted-foreground opacity-50" />
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
                              title="Start slot check. Job is queued; an async agent assigned to this customer's portal will pick it up. (Sync agents do not auto-take queue jobs. In Portals, assign the customer's portal to at least one async agent.)"
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
                              title="Pause customer"
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
                              title="Resume customer"
                              onClick={() => resumeMutation.mutate(customer.id)}
                              disabled={resumeMutation.isPending}
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                          )}
                          {customer.status === "cancelled" && (
                            <Button
                              variant="outline"
                              size="sm"
                              title="Reactivate customer (set status to active)"
                              onClick={() => reactivateMutation.mutate(customer.id)}
                              disabled={reactivateMutation.isPending}
                            >
                              <Play className="h-4 w-4" />
                              Reactivate
                            </Button>
                          )}
                          <Button variant="outline" size="sm" onClick={() => handleEdit(customer)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          {customer.status !== "cancelled" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-amber-600 hover:text-amber-700"
                              title="Cancel customer (set status to cancelled)"
                              onClick={() => { setCancelCustomerId(customer.id); setShowCancelModal(true); }}
                            >
                              <XCircle className="h-4 w-4" />
                              Cancel
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            title="Permanently delete customer"
                            onClick={() => { setDeleteCustomerId(customer.id); setShowDeleteModal(true); }}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
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

        {/* Cancel (set status to cancelled) Modal */}
        <Modal
          open={showCancelModal}
          onClose={() => setShowCancelModal(false)}
          title="Cancel Customer"
          footer={
            <>
              <Button variant="outline" onClick={() => setShowCancelModal(false)}>Close</Button>
              <Button
                variant="secondary"
                onClick={() => cancelCustomerId && cancelMutation.mutate(cancelCustomerId)}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set to Cancelled"}
              </Button>
            </>
          }
        >
          <p>Set this customer&apos;s status to <strong>Cancelled</strong>? They will stop receiving slot checks. You can reactivate them later with the Reactivate button.</p>
        </Modal>

        {/* Delete (permanent) Confirmation Modal */}
        <Modal
          open={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          title="Permanently Delete Customer"
          footer={
            <>
              <Button variant="outline" onClick={() => setShowDeleteModal(false)}>Close</Button>
              <Button
                variant="destructive"
                onClick={() => deleteCustomerId && deleteMutation.mutate(deleteCustomerId)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Delete Permanently"
                )}
              </Button>
            </>
          }
        >
          <p>Are you sure you want to <strong>permanently delete</strong> this customer? This cannot be undone and will remove all related data.</p>
        </Modal>
      </div>
    );
  }

  // Create/Edit Form
  return (
    <div className="space-y-6">
      <SaveBanner message={banner} onDismiss={() => setBanner(null)} />
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
          {/* Basic Information: display name, internal ref, priority, tags, portal */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4">
              <CardTitle className="text-base">Basic Information</CardTitle>
              <label className="flex items-center gap-2 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={formData.vip}
                  onChange={(e) => setFormData({ ...formData, vip: e.target.checked })}
                  className="rounded border-gray-300 dark:border-slate-600"
                />
                <span className="text-sm font-medium">VIP Customer</span>
              </label>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Display name *</label>
                <Input
                  className="mt-1"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Internal reference</label>
                <Input
                  className="mt-1"
                  value={formData.internal_ref}
                  onChange={(e) => setFormData({ ...formData, internal_ref: e.target.value })}
                  placeholder="e.g. CUS-001"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Priority (1-100)</label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    className="mt-1"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 50 })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Tags (comma separated)</label>
                  <Input
                    className="mt-1"
                    value={formData.tags}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                    placeholder="vip, priority"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Portal *</label>
                <select
                  className="mt-1 w-full px-4 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-600 focus:ring-2 focus:ring-blue-400 outline-none cursor-pointer"
                  value={formData.portal_id}
                  onChange={(e) => {
                    setFormData({ ...formData, portal_id: e.target.value });
                    setDynamicPreferences((prev) => (e.target.value !== formData.portal_id ? {} : prev));
                  }}
                  required
                >
                  <option value="">— Select portal —</option>
                  {portals?.items?.map((portal: PortalConfig) => (
                    <option key={portal.id} value={portal.portal_id}>
                      {portal.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground mt-0.5">Portal for appointments; fields below depend on the selected portal.</p>
              </div>
            </CardContent>
          </Card>

          {/* Notifications: right of Basic Information */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Notifications</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Where to send notifications when a slot is found.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-sm font-medium">Email</label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.useSameEmail}
                      onChange={(e) => setFormData({ ...formData, useSameEmail: e.target.checked })}
                      className="rounded border-gray-300 dark:border-slate-600"
                    />
                    Same as Visa Information
                  </label>
                </div>
                <Input
                  className="mt-1"
                  type="email"
                  value={formData.useSameEmail ? formData.email : formData.notify_email}
                  onChange={(e) => setFormData({ ...formData, notify_email: e.target.value })}
                  disabled={formData.useSameEmail}
                  placeholder="customer@example.com"
                />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-sm font-medium">Phone</label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.useSamePhone}
                      onChange={(e) => setFormData({ ...formData, useSamePhone: e.target.checked })}
                      className="rounded border-gray-300 dark:border-slate-600"
                    />
                    Same as Visa Information
                  </label>
                </div>
                <Input
                  className="mt-1"
                  type="tel"
                  value={formData.useSamePhone ? formData.phone : formData.notify_phone}
                  onChange={(e) => setFormData({ ...formData, notify_phone: e.target.value })}
                  disabled={formData.useSamePhone}
                  placeholder="+90 555 123 4567"
                />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <label className="text-sm font-medium">Telegram (System)</label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.useDefaultTelegram}
                      onChange={(e) => setFormData({ ...formData, useDefaultTelegram: e.target.checked })}
                      className="rounded border-gray-300 dark:border-slate-600"
                    />
                    Use default (from Settings → Notifications)
                  </label>
                </div>
                <select
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-600 text-sm focus:ring-2 focus:ring-blue-400 outline-none cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                  value={formData.useDefaultTelegram ? (telegramChatIds[0] ?? "") : formData.notify_telegram_chat_id}
                  onChange={(e) => setFormData({ ...formData, notify_telegram_chat_id: e.target.value })}
                  disabled={formData.useDefaultTelegram}
                >
                  <option value="">None</option>
                  {!formData.useDefaultTelegram && formData.notify_telegram_chat_id && !telegramChatIds.includes(formData.notify_telegram_chat_id) && (
                    <option value={formData.notify_telegram_chat_id}>{formData.notify_telegram_chat_id} (current)</option>
                  )}
                  {telegramChatIds.map((chatId) => (
                    <option key={chatId} value={chatId}>
                      {chatId}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {formData.useDefaultTelegram
                    ? "Uses the default chat from Settings → Notifications."
                    : telegramChatIds.length === 0
                      ? "Add Telegram chat IDs in Settings → Notifications."
                      : "Chat list from Settings → Notifications."}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Customer (optional)</label>
                <Input
                  className="mt-1"
                  value={formData.customer_telegram_chat_id}
                  onChange={(e) => setFormData({ ...formData, customer_telegram_chat_id: e.target.value })}
                  placeholder="Telegram chat ID"
                />
                <p className="text-xs text-muted-foreground mt-0.5">Customer-specific Telegram chat ID; no default.</p>
              </div>
            </CardContent>
          </Card>

          {/* Visa Information: full width, multi-column grid */}
          <Card className="md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Visa Information</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Applicant identity and contact; the agent uses these when filling the form.</p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="text-sm font-medium">ID No (e.g. national ID)</label>
                  <Input
                    className="mt-1"
                    value={formData.idNo}
                    onChange={(e) => setFormData({ ...formData, idNo: e.target.value })}
                    placeholder="National ID"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Passport number *</label>
                  <Input
                    className="mt-1"
                    value={formData.passportNumber}
                    onChange={(e) => setFormData({ ...formData, passportNumber: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">First name *</label>
                  <Input
                    className="mt-1"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Last name *</label>
                  <Input
                    className="mt-1"
                    value={formData.surname}
                    onChange={(e) => setFormData({ ...formData, surname: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Middle name (optional)</label>
                  <Input
                    className="mt-1"
                    value={formData.middleName}
                    onChange={(e) => setFormData({ ...formData, middleName: e.target.value })}
                    placeholder="Middle name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Birth date</label>
                  <Input
                    type="date"
                    className="mt-1"
                    value={formData.birthDate}
                    onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Email *</label>
                  <Input
                    type="email"
                    className="mt-1"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Phone *</label>
                  <Input
                    type="tel"
                    className="mt-1"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-600">
                <label className="text-sm font-medium">Travel date</label>
                <p className="text-xs text-muted-foreground mt-0.5">If left empty, the agent picks by algorithm; if set, that date or range is used.</p>
                <div className="mt-2 flex flex-wrap gap-3 items-end">
                  <div className="min-w-[180px]">
                    <select
                      className="w-full px-3 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-600 text-sm"
                      value={formData.travelDateMode}
                      onChange={(e) => setFormData({ ...formData, travelDateMode: e.target.value as TravelDateMode })}
                    >
                      <option value="auto">Agent picks (algorithm)</option>
                      <option value="single">Single date</option>
                      <option value="range">Date range</option>
                    </select>
                  </div>
                  {formData.travelDateMode === "auto" && (
                    <div className="min-w-[180px]">
                      <select
                        className="w-full px-3 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-600 text-sm"
                        value={formData.travelDateAlgorithm}
                        onChange={(e) => setFormData({ ...formData, travelDateAlgorithm: e.target.value as TravelDateAlgorithm })}
                      >
                        {(Object.keys(TRAVEL_ALGORITHM_LABELS) as TravelDateAlgorithm[]).map((algo) => (
                          <option key={algo} value={algo}>
                            {TRAVEL_ALGORITHM_LABELS[algo]}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {formData.travelDateMode === "single" && (
                    <Input
                      type="date"
                      className="w-[180px]"
                      value={formData.travelDateSingle}
                      onChange={(e) => setFormData({ ...formData, travelDateSingle: e.target.value })}
                    />
                  )}
                  {formData.travelDateMode === "range" && (
                    <>
                      <Input
                        type="date"
                        className="w-[160px]"
                        value={formData.travelDateFrom}
                        onChange={(e) => setFormData({ ...formData, travelDateFrom: e.target.value })}
                        placeholder="From"
                      />
                      <Input
                        type="date"
                        className="w-[160px]"
                        value={formData.travelDateTo}
                        onChange={(e) => setFormData({ ...formData, travelDateTo: e.target.value })}
                        placeholder="To"
                      />
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Portal-specific fields (from portal config → customer form schema) */}
          {formData.portal_id && (
            <Card className="md:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Portal-specific information</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selectedPortal?.name || formData.portal_id}. If appointment date/time is left empty, the agent picks automatically or by algorithm; if set, that value is used.
                </p>
              </CardHeader>
              <CardContent>
                {customerFormSchema.length === 0 ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    No form fields defined for this portal. Add them in <strong>Portals → {selectedPortal?.name || formData.portal_id} → Configure</strong> under &quot;Customer form fields&quot;.
                  </p>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {customerFormSchema.map((field) => {
                      const value = dynamicPreferences[field.key];
                      const setValue = (v: string | number | boolean) =>
                        setDynamicPreferences((prev) => ({ ...prev, [field.key]: v }));
                      return (
                        <div key={field.key}>
                          <label className="text-sm font-medium">
                            {field.label}
                            {field.required ? " *" : ""}
                          </label>
                          {field.type === "select" && (
                            <select
                              className="w-full px-4 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-600 mt-1 focus:ring-2 focus:ring-blue-400 outline-none cursor-pointer"
                              value={value != null ? String(value) : ""}
                              onChange={(e) => setValue(e.target.value)}
                              required={field.required}
                            >
                              <option value="">—</option>
                              {(field.options ?? []).map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          )}
                          {field.type === "checkbox" && (
                            <div className="mt-1">
                              <input
                                type="checkbox"
                                checked={value === true}
                                onChange={(e) => setValue(e.target.checked)}
                                className="rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                              />
                            </div>
                          )}
                          {field.type === "text" && (
                            <Input
                              className="mt-1"
                              value={value != null ? String(value) : ""}
                              onChange={(e) => setValue(e.target.value)}
                              placeholder={field.placeholder}
                              required={field.required}
                            />
                          )}
                          {field.type === "number" && (
                            <Input
                              type="number"
                              className="mt-1"
                              value={value != null ? String(value) : ""}
                              onChange={(e) => setValue(e.target.value ? Number(e.target.value) : "")}
                              placeholder={field.placeholder}
                              required={field.required}
                            />
                          )}
                          {field.type === "date" && (
                            <Input
                              type="date"
                              className="mt-1"
                              value={value != null ? String(value) : ""}
                              onChange={(e) => setValue(e.target.value)}
                              required={field.required}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
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
