"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cpApi, AuditLog } from "@/lib/api";
import {
  ScrollText,
  Download,
  Filter,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Search,
  Loader2,
} from "lucide-react";

const ACTION_TYPES = [
  { value: "", label: "All Actions" },
  { value: "create", label: "Create" },
  { value: "update", label: "Update" },
  { value: "delete", label: "Delete" },
  { value: "login", label: "Login" },
  { value: "logout", label: "Logout" },
  { value: "assign", label: "Assign" },
  { value: "resolve", label: "Resolve" },
];

const RESOURCE_TYPES = [
  { value: "", label: "All Resources" },
  { value: "agent", label: "Agent" },
  { value: "profile", label: "Profile" },
  { value: "portal", label: "Portal" },
  { value: "job", label: "Job" },
  { value: "hitl_task", label: "HITL Task" },
  { value: "user", label: "User" },
  { value: "settings", label: "Settings" },
];

export default function AuditPage() {
  const [filters, setFilters] = useState({
    action: "",
    resource_type: "",
    actor_id: "",
    from: "",
    to: "",
    limit: "50",
  });
  const [showFilters, setShowFilters] = useState(false);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  // Build query params
  const queryParams: Record<string, string> = { limit: filters.limit };
  if (filters.action) queryParams.action = filters.action;
  if (filters.resource_type) queryParams.resource_type = filters.resource_type;
  if (filters.actor_id) queryParams.actor_id = filters.actor_id;
  if (filters.from) queryParams.from = filters.from;
  if (filters.to) queryParams.to = filters.to;

  const { data: logs, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["audit-logs", queryParams],
    queryFn: () => cpApi.getAuditLogs(queryParams),
  });

  const handleExport = () => {
    if (!logs?.items) return;

    const csvContent = [
      ["Time", "Actor Type", "Actor ID", "Actor Name", "Action", "Resource Type", "Resource ID", "Changes"].join(","),
      ...logs.items.map((log) =>
        [
          new Date(log.created_at).toISOString(),
          log.actor_type,
          log.actor_id ?? "",
          log.actor_name ?? "",
          log.action,
          log.resource_type,
          log.resource_id ?? "",
          JSON.stringify(log.changes || {}).replace(/"/g, '""'),
        ]
          .map((v) => `"${v}"`)
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getActionColor = (action: string) => {
    if (action.includes("create") || action.includes("add")) return "default";
    if (action.includes("update") || action.includes("assign")) return "secondary";
    if (action.includes("delete") || action.includes("remove")) return "destructive";
    return "outline";
  };

  const clearFilters = () => {
    setFilters({
      action: "",
      resource_type: "",
      actor_id: "",
      from: "",
      to: "",
      limit: "50",
    });
  };

  const hasActiveFilters =
    filters.action || filters.resource_type || filters.actor_id || filters.from || filters.to;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Audit Logs</h1>
          <p className="text-gray-500 dark:text-gray-400">System activity and change history</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={!logs?.items?.length}>
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader
          className="cursor-pointer"
          onClick={() => setShowFilters(!showFilters)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-gray-500" />
              <CardTitle className="text-lg text-gray-900 dark:text-white">Filters</CardTitle>
              {hasActiveFilters && (
                <Badge variant="secondary" className="ml-2">
                  Active
                </Badge>
              )}
            </div>
            {showFilters ? (
              <ChevronUp className="h-5 w-5 text-gray-500" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-500" />
            )}
          </div>
        </CardHeader>
        {showFilters && (
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                  Action
                </label>
                <select
                  value={filters.action}
                  onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
                  className="w-full px-4 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 outline-none cursor-pointer transition-all duration-200"
                >
                  {ACTION_TYPES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                  Resource Type
                </label>
                <select
                  value={filters.resource_type}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, resource_type: e.target.value }))
                  }
                  className="w-full px-4 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 outline-none cursor-pointer transition-all duration-200"
                >
                  {RESOURCE_TYPES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                  Actor ID
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search actor..."
                    value={filters.actor_id}
                    onChange={(e) => setFilters((f) => ({ ...f, actor_id: e.target.value }))}
                    className="pl-9 border-transparent bg-blue-50 dark:bg-slate-700 shadow-sm focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                  From Date
                </label>
                <Input
                  type="datetime-local"
                  value={filters.from}
                  onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                  To Date
                </label>
                <Input
                  type="datetime-local"
                  value={filters.to}
                  onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-500 dark:text-gray-400">Show:</label>
                <select
                  value={filters.limit}
                  onChange={(e) => setFilters((f) => ({ ...f, limit: e.target.value }))}
                  className="px-3 py-1 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 outline-none cursor-pointer transition-all duration-200 text-sm"
                >
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                </select>
                <span className="text-sm text-gray-500 dark:text-gray-400">entries</span>
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear Filters
                </Button>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Logs Table */}
      {isLoading ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-gray-500 dark:text-gray-400">Loading audit logs...</p>
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <ScrollText className="h-12 w-12 text-red-400 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">Failed to load audit logs</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 text-center max-w-md">
              {error instanceof Error ? error.message : "API server may be unavailable"}
            </p>
            <Button variant="outline" onClick={() => refetch()} className="mt-4">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : logs?.items && logs.items.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
                    <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">
                      Time
                    </th>
                    <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">
                      Actor
                    </th>
                    <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">
                      Action
                    </th>
                    <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">
                      Resource
                    </th>
                    <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {logs.items.map((log) => (
                    <React.Fragment key={log.id}>
                      <tr
                        className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer"
                        onClick={() =>
                          setExpandedLog(expandedLog === log.id ? null : log.id)
                        }
                      >
                        <td className="p-4 text-sm text-gray-500 dark:text-gray-400">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="p-4">
                          <Badge variant="outline" className="mr-2">
                            {log.actor_type}
                          </Badge>
                          <span className="text-sm text-gray-900 dark:text-white">
                            {log.actor_name?.trim()
                              ? log.actor_name
                              : log.actor_id != null
                                ? String(log.actor_id).length > 12
                                  ? `${String(log.actor_id).slice(0, 12)}…`
                                  : String(log.actor_id)
                                : "—"}
                          </span>
                        </td>
                        <td className="p-4">
                          <Badge variant={getActionColor(log.action) as "default" | "secondary" | "destructive" | "outline"}>
                            {log.action}
                          </Badge>
                        </td>
                        <td className="p-4 text-sm">
                          <span className="text-gray-600 dark:text-gray-300">
                            {log.resource_type}
                          </span>
                          <span className="text-gray-400 mx-1">/</span>
                          <span className="text-gray-900 dark:text-white font-mono">
                            {log.resource_id != null ? `${String(log.resource_id).slice(0, 8)}...` : "—"}
                          </span>
                        </td>
                        <td className="p-4">
                          {log.changes && Object.keys(log.changes).length > 0 ? (
                            <Button variant="ghost" size="sm">
                              {expandedLog === log.id ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </Button>
                          ) : (
                            <span className="text-gray-400 text-sm">-</span>
                          )}
                        </td>
                      </tr>
                      {expandedLog === log.id && log.changes && (
                        <tr className="bg-gray-50 dark:bg-slate-800/30">
                          <td colSpan={5} className="p-4">
                            <div className="space-y-2">
                              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Changes:
                              </p>
                              <pre className="text-xs bg-gray-100 dark:bg-slate-900 p-3 rounded overflow-auto max-h-48 text-gray-700 dark:text-gray-300">
                                {JSON.stringify(log.changes, null, 2)}
                              </pre>
                              {log.metadata && Object.keys(log.metadata).length > 0 && (
                                <>
                                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-4">
                                    Metadata:
                                  </p>
                                  <pre className="text-xs bg-gray-100 dark:bg-slate-900 p-3 rounded overflow-auto max-h-32 text-gray-700 dark:text-gray-300">
                                    {JSON.stringify(log.metadata, null, 2)}
                                  </pre>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <ScrollText className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No audit logs found</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              {hasActiveFilters 
                ? "Try adjusting your filters to see more results" 
                : "Activity logs will appear here as actions are performed"}
            </p>
            {hasActiveFilters && (
              <Button variant="outline" onClick={clearFilters} className="mt-4">
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Footer */}
      {logs?.total !== undefined && logs.total > 0 && (
        <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
          Showing {logs.items?.length ?? 0} of {logs.total} entries
        </div>
      )}
    </div>
  );
}
