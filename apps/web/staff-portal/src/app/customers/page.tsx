"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { customerApi, type RedactedCustomer } from "@/lib/api";
import {
  Users,
  Search,
  Loader2,
  AlertCircle,
  RefreshCw,
  CheckCircle,
  Pause,
  XCircle,
  Star,
  Briefcase,
  Calendar,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Eye,
} from "lucide-react";

type CustomerStatus = 'active' | 'paused' | 'completed' | 'cancelled';

const STATUS_CONFIG: Record<CustomerStatus, { label: string; color: string; icon: React.ReactNode }> = {
  active: { label: "Active", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: <CheckCircle className="h-3 w-3" /> },
  paused: { label: "Paused", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", icon: <Pause className="h-3 w-3" /> },
  completed: { label: "Completed", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: <CheckCircle className="h-3 w-3" /> },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400", icon: <XCircle className="h-3 w-3" /> },
};

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState<RedactedCustomer | null>(null);
  const pageSize = 20;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["customers-redacted", search, statusFilter, page],
    queryFn: () => customerApi.list({
      search: search || undefined,
      status: statusFilter || undefined,
      limit: pageSize,
      offset: page * pageSize,
    }),
  });

  const totalPages = Math.ceil((data?.total || 0) / pageSize);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Customers</h1>
          <p className="text-gray-500 dark:text-gray-400">
            View assigned customers and their status
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by reference..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  className="pl-10 border-transparent bg-blue-50 dark:bg-slate-700 shadow-sm focus:shadow-md focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>
            <select
              className="px-4 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 outline-none cursor-pointer transition-all duration-200"
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
      {isLoading ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-gray-500 dark:text-gray-400">Loading customers...</p>
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">Failed to load customers</p>
            <p className="text-sm text-gray-400 mt-1">
              {error instanceof Error ? error.message : "API server may be unavailable"}
            </p>
            <Button variant="outline" onClick={() => refetch()} className="mt-4">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : !data?.items.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Users className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No customers found</p>
            <p className="text-sm text-gray-400 mt-1">
              {search || statusFilter ? "Try adjusting your filters" : "Customers will appear here when added"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.items.map((customer) => {
            const statusConfig = STATUS_CONFIG[customer.status];
            return (
              <Card
                key={customer.id}
                className="cursor-pointer hover:shadow-lg transition-all duration-200"
                onClick={() => setSelectedCustomer(customer)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <Users className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {customer.display_name}
                        </p>
                        {customer.internal_ref && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Ref: {customer.internal_ref}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {customer.flags.vip && (
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 rounded-full">
                          <Star className="h-3 w-3 mr-1" />
                          VIP
                        </span>
                      )}
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusConfig.color}`}>
                        {statusConfig.icon}
                        {statusConfig.label}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                      <Briefcase className="h-4 w-4" />
                      <span>Portal: {customer.portal_id}</span>
                    </div>
                    {customer.preferences.visa_type && (
                      <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                        <span className="capitalize">{customer.preferences.visa_type} Visa</span>
                      </div>
                    )}
                    {customer.preferences.appointment_city && (
                      <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                        <MapPin className="h-4 w-4" />
                        <span>{customer.preferences.appointment_city}</span>
                      </div>
                    )}
                    {customer.preferences.preferred_dates && (
                      <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                        <Calendar className="h-4 w-4" />
                        <span>
                          {customer.preferences.preferred_dates.from} - {customer.preferences.preferred_dates.to}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100 dark:border-slate-700">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      <span className="font-medium">{customer.total_jobs}</span> jobs • 
                      <span className="font-medium ml-1">{customer.successful_bookings}</span> bookings
                    </div>
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedCustomer(customer); }}>
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, data?.total || 0)} of {data?.total || 0}
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

      {/* Customer Detail Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setSelectedCustomer(null)}>
          <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Customer Details</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setSelectedCustomer(null)}>
                <XCircle className="h-5 w-5" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-lg font-medium text-gray-900 dark:text-white">
                    {selectedCustomer.display_name}
                  </p>
                  {selectedCustomer.internal_ref && (
                    <p className="text-sm text-gray-500">Ref: {selectedCustomer.internal_ref}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 dark:bg-slate-800 p-3 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Status</p>
                  <p className="font-medium capitalize">{selectedCustomer.status}</p>
                </div>
                <div className="bg-gray-50 dark:bg-slate-800 p-3 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Priority</p>
                  <p className="font-medium">{selectedCustomer.priority}</p>
                </div>
                <div className="bg-gray-50 dark:bg-slate-800 p-3 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Portal</p>
                  <p className="font-medium">{selectedCustomer.portal_id}</p>
                </div>
                <div className="bg-gray-50 dark:bg-slate-800 p-3 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Visa Type</p>
                  <p className="font-medium capitalize">{selectedCustomer.preferences.visa_type || 'N/A'}</p>
                </div>
              </div>

              {selectedCustomer.notify_email && (
                <div className="bg-gray-50 dark:bg-slate-800 p-3 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Email (Redacted)</p>
                  <p className="font-mono text-sm">{selectedCustomer.notify_email}</p>
                </div>
              )}

              {selectedCustomer.notify_phone && (
                <div className="bg-gray-50 dark:bg-slate-800 p-3 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Phone (Redacted)</p>
                  <p className="font-mono text-sm">{selectedCustomer.notify_phone}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Total Jobs</p>
                  <p className="text-xl font-bold text-primary">{selectedCustomer.total_jobs}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Successful Bookings</p>
                  <p className="text-xl font-bold text-green-600">{selectedCustomer.successful_bookings}</p>
                </div>
              </div>

              {selectedCustomer.last_slot_found_at && (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Last slot found: {new Date(selectedCustomer.last_slot_found_at).toLocaleString()}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
