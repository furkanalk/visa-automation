"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cpApi } from "@/lib/api";
import {
  Save,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Server,
  Building,
  Loader2,
  Globe,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // API settings (stored in localStorage)
  const [cpApiUrl, setCpApiUrl] = useState("");
  const [publicApiUrl, setPublicApiUrl] = useState("");

  // Load settings from localStorage
  useEffect(() => {
    setCpApiUrl(localStorage.getItem("cp_api_url") || process.env.NEXT_PUBLIC_CP_API_URL || "http://localhost:3001");
    setPublicApiUrl(localStorage.getItem("public_api_url") || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000");
  }, []);

  // System status
  const { data: systemStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery({
    queryKey: ["system-status"],
    queryFn: () => cpApi.getSystemStatus(),
    retry: false,
  });

  // Health check
  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ["health"],
    queryFn: () => cpApi.getHealth(),
    retry: false,
  });

  const handleSaveApiSettings = () => {
    localStorage.setItem("cp_api_url", cpApiUrl);
    localStorage.setItem("public_api_url", publicApiUrl);
    setSaveMessage({ type: "success", text: "API settings saved. Please refresh the page for changes to take effect." });
    setTimeout(() => setSaveMessage(null), 5000);
  };

  const handleRefreshStatus = () => {
    refetchStatus();
    refetchHealth();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-gray-500 dark:text-gray-400">System configuration</p>
        </div>
        <Button variant="outline" onClick={handleRefreshStatus}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh Status
        </Button>
      </div>

      {/* Save Message */}
      {saveMessage && (
        <div
          className={`p-4 rounded-lg flex items-center gap-2 ${
            saveMessage.type === "success"
              ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
              : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
          }`}
        >
          {saveMessage.type === "success" ? (
            <CheckCircle className="h-5 w-5" />
          ) : (
            <AlertCircle className="h-5 w-5" />
          )}
          {saveMessage.text}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* API Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
              <Globe className="h-5 w-5" />
              API Configuration
            </CardTitle>
            <CardDescription>Configure API endpoints</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Control Plane API URL</label>
              <Input
                value={cpApiUrl}
                onChange={(e) => setCpApiUrl(e.target.value)}
                placeholder="http://localhost:3001"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Public API URL</label>
              <Input
                value={publicApiUrl}
                onChange={(e) => setPublicApiUrl(e.target.value)}
                placeholder="http://localhost:3000"
                className="mt-1"
              />
            </div>
            <Button onClick={handleSaveApiSettings}>
              <Save className="h-4 w-4 mr-1" />
              Save Changes
            </Button>
          </CardContent>
        </Card>

        {/* Current User */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
              <Building className="h-5 w-5" />
              Current Session
            </CardTitle>
            <CardDescription>Your current session information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">User</label>
              <Input value={user?.name || "Unknown"} disabled className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Role</label>
              <div className="mt-1">
                <Badge variant={user?.role === "super_admin" ? "default" : "secondary"}>
                  {user?.role || "Unknown"}
                </Badge>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tenant ID</label>
              <Input value="default" disabled className="mt-1" />
            </div>
          </CardContent>
        </Card>

        {/* System Status */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
              <Server className="h-5 w-5" />
              System Status
            </CardTitle>
            <CardDescription>Current system health and statistics</CardDescription>
          </CardHeader>
          <CardContent>
            {statusLoading || healthLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-4">
                <div className="p-4 rounded-lg bg-gray-50 dark:bg-slate-900">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Version</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {systemStatus?.version || "Unknown"}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-gray-50 dark:bg-slate-900">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Uptime</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {systemStatus?.uptime_seconds
                      ? `${Math.floor(systemStatus.uptime_seconds / 3600)}h ${Math.floor(
                          (systemStatus.uptime_seconds % 3600) / 60
                        )}m`
                      : "Unknown"}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-gray-50 dark:bg-slate-900">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Health</p>
                  <Badge
                    variant={
                      health?.status === "healthy"
                        ? "success"
                        : health?.status === "degraded"
                        ? "warning"
                        : "destructive"
                    }
                    className="mt-1"
                  >
                    {health?.status || "Unknown"}
                  </Badge>
                </div>
                <div className="p-4 rounded-lg bg-gray-50 dark:bg-slate-900">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Agents</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {systemStatus?.agent_stats?.online || 0} / {systemStatus?.agent_stats?.total || 0}
                  </p>
                </div>
              </div>
            )}

            {/* Health Checks */}
            {health?.checks && Object.keys(health.checks).length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Health Checks</h4>
                <div className="space-y-2">
                  {Object.entries(health.checks).map(([name, check]) => (
                    <div
                      key={name}
                      className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-slate-900"
                    >
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{name}</span>
                      <div className="flex items-center gap-2">
                        {check.latency_ms !== undefined && (
                          <span className="text-xs text-gray-500">{check.latency_ms}ms</span>
                        )}
                        <Badge
                          variant={
                            check.status === "healthy"
                              ? "success"
                              : check.status === "degraded"
                              ? "warning"
                              : "destructive"
                          }
                        >
                          {check.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Job Stats */}
            {systemStatus?.job_stats && (
              <div className="mt-6">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Job Statistics</h4>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="p-4 rounded-lg bg-gray-50 dark:bg-slate-900">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Jobs</p>
                    <p className="text-2xl font-semibold text-gray-900 dark:text-white">
                      {systemStatus.job_stats.total}
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-gray-50 dark:bg-slate-900">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Active Jobs</p>
                    <p className="text-2xl font-semibold text-blue-600">
                      {systemStatus.job_stats.active}
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-gray-50 dark:bg-slate-900">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Completed Jobs</p>
                    <p className="text-2xl font-semibold text-green-600">
                      {systemStatus.job_stats.completed}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
