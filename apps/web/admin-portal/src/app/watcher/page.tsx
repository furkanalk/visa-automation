"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal, FormField } from "@/components/ui/modal";
import {
  Eye,
  Play,
  Clock,
  AlertTriangle,
  Settings,
  CheckCircle,
  XCircle,
  RefreshCw,
  FileCode,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { cpApi, WatcherSnapshot, WatcherSnapshotFull, WatcherConfig } from "@/lib/api";

export default function WatcherPage() {
  const queryClient = useQueryClient();
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<WatcherSnapshotFull | null>(null);
  const [diffView, setDiffView] = useState(false);

  // Fetch watcher status
  const { data: status, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["watcher-status"],
    queryFn: () => cpApi.getWatcherStatus(),
    refetchInterval: 30000,
  });

  // Fetch snapshots
  const { data: snapshots, isLoading: snapshotsLoading, isError: snapshotsError } = useQuery({
    queryKey: ["watcher-snapshots"],
    queryFn: () => cpApi.getSnapshots({ limit: "20" }),
  });

  // Run watcher mutation
  const runMutation = useMutation({
    mutationFn: () => cpApi.runWatcher(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watcher-status"] });
      queryClient.invalidateQueries({ queryKey: ["watcher-snapshots"] });
    },
  });

  // Config state
  const [configForm, setConfigForm] = useState({
    enabled: false,
    window_start_hour: 0,
    window_end_hour: 23,
    jitter_minutes: 10,
    notify_on_change: true,
    portals: [] as string[],
  });

  // Portals list for watcher portal selection
  const { data: portalsList } = useQuery({
    queryKey: ["portals"],
    queryFn: () => cpApi.getPortals(),
    enabled: configModalOpen,
  });

  // Update config mutation
  const updateConfigMutation = useMutation({
    mutationFn: (data: typeof configForm) => cpApi.updateWatcherConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watcher-status"] });
      setConfigModalOpen(false);
    },
  });

  // Open config modal
  const handleOpenConfig = () => {
    if (status?.config) {
      setConfigForm({
        enabled: status.config.enabled,
        window_start_hour: status.config.window_start_hour,
        window_end_hour: status.config.window_end_hour,
        jitter_minutes: status.config.jitter_minutes,
        notify_on_change: status.config.notify_on_change,
        portals: status.config.portals ?? [],
      });
    } else {
      setConfigForm((f) => ({ ...f, portals: f.portals ?? [] }));
    }
    setConfigModalOpen(true);
  };

  // View snapshot
  const handleViewSnapshot = async (snapshot: WatcherSnapshot) => {
    const full = await cpApi.getSnapshot(snapshot.id);
    setSelectedSnapshot(full);
    setSnapshotModalOpen(true);
    setDiffView(false);
  };

  const getSeverityColor = (severity: string | null) => {
    switch (severity) {
      case "critical":
        return "destructive";
      case "major":
        return "warning";
      case "minor":
        return "secondary";
      default:
        return "outline";
    }
  };

  const getSeverityIcon = (severity: string | null) => {
    switch (severity) {
      case "critical":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "major":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case "minor":
        return <Eye className="h-4 w-4 text-blue-500" />;
      default:
        return <CheckCircle className="h-4 w-4 text-green-500" />;
    }
  };

  const diffsDetected = status?.last_results?.filter((r) => r.changed).length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Site Watcher</h1>
          <p className="text-gray-500 dark:text-gray-400">Monitor portal changes and drift detection</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleOpenConfig}>
            <Settings className="h-4 w-4 mr-1" />
            Configure
          </Button>
          <Button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
          >
            {runMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            Run Now
          </Button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div
                className={`h-3 w-3 rounded-full ${
                  status?.status === "enabled"
                    ? "bg-green-500"
                    : status?.status === "disabled"
                    ? "bg-yellow-500"
                    : "bg-gray-400"
                }`}
              />
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
                <p className="font-medium text-gray-900 dark:text-white capitalize">
                  {isLoading ? "Loading..." : isError ? "Unavailable" : (status?.status ?? "Unknown")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-gray-400 dark:text-gray-500" />
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Last Run</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {status?.config?.last_run_at
                    ? new Date(status.config.last_run_at).toLocaleString()
                    : "Never"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Eye className="h-8 w-8 text-gray-400 dark:text-gray-500" />
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Snapshots</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {snapshots?.total ?? 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle
                className={`h-8 w-8 ${
                  diffsDetected > 0
                    ? "text-yellow-500"
                    : "text-gray-400 dark:text-gray-500"
                }`}
              />
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Diffs Detected</p>
                <p className="font-medium text-gray-900 dark:text-white">{diffsDetected}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Run Result */}
      {runMutation.isSuccess && (
        <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <div>
                <p className="font-medium text-green-700 dark:text-green-300">
                  Watcher run triggered
                </p>
                <p className="text-sm text-green-600 dark:text-green-400">
                  Checking {runMutation.data?.portals.length} portal(s). Results will appear below.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Last Results */}
      {status?.last_results && status.last_results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-gray-900 dark:text-white">Latest Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {status.last_results.map((result) => (
                <div
                  key={result.snapshot_id}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-800 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {getSeverityIcon(result.diff_severity)}
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {result.portal_id}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {new Date(result.captured_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {result.changed && (
                      <Badge variant={getSeverityColor(result.diff_severity) as "default" | "secondary" | "destructive" | "outline"}>
                        {result.diff_severity}
                      </Badge>
                    )}
                    {result.diff_summary && (
                      <span className="text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate">
                        {result.diff_summary}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Snapshots List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white">Snapshots History</CardTitle>
        </CardHeader>
        <CardContent>
          {snapshotsLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p className="text-gray-500 dark:text-gray-400">Loading snapshots...</p>
            </div>
          ) : snapshotsError ? (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertTriangle className="h-12 w-12 text-red-400 mb-4" />
              <p className="text-gray-500 dark:text-gray-400 font-medium">Failed to load snapshots</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">API server may be unavailable</p>
            </div>
          ) : snapshots?.items && snapshots.items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-slate-700">
                    <th className="text-left p-3 font-medium text-gray-500 dark:text-gray-400">
                      Portal
                    </th>
                    <th className="text-left p-3 font-medium text-gray-500 dark:text-gray-400">
                      Captured
                    </th>
                    <th className="text-left p-3 font-medium text-gray-500 dark:text-gray-400">
                      Severity
                    </th>
                    <th className="text-left p-3 font-medium text-gray-500 dark:text-gray-400">
                      Summary
                    </th>
                    <th className="text-right p-3 font-medium text-gray-500 dark:text-gray-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.items.map((snapshot) => (
                    <tr
                      key={snapshot.id}
                      className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/50"
                    >
                      <td className="p-3 font-medium text-gray-900 dark:text-white">
                        {snapshot.portal_id}
                      </td>
                      <td className="p-3 text-sm text-gray-500 dark:text-gray-400">
                        {new Date(snapshot.captured_at).toLocaleString()}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          {getSeverityIcon(snapshot.diff_severity)}
                          <Badge
                            variant={
                              getSeverityColor(snapshot.diff_severity) as
                                | "default"
                                | "secondary"
                                | "destructive"
                                | "outline"
                            }
                          >
                            {snapshot.diff_severity ?? "none"}
                          </Badge>
                        </div>
                      </td>
                      <td className="p-3 text-sm text-gray-600 dark:text-gray-300 max-w-xs truncate">
                        {snapshot.diff_summary ?? "-"}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewSnapshot(snapshot)}
                        >
                          <FileCode className="h-4 w-4 mr-1" />
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Eye className="h-8 w-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
              <p>No snapshots yet</p>
              <p className="text-sm">Run the watcher to capture portal snapshots</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Config Modal */}
      <Modal
        open={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
        title="Watcher Configuration"
        description="Configure automated drift detection"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfigModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => updateConfigMutation.mutate(configForm)}
              disabled={updateConfigMutation.isPending}
            >
              {updateConfigMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Enable Watcher
            </label>
            <button
              type="button"
              onClick={() =>
                setConfigForm((f) => ({ ...f, enabled: !f.enabled }))
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                configForm.enabled ? "bg-blue-600" : "bg-gray-300 dark:bg-slate-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  configForm.enabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Window Start Hour (0-23)">
              <Input
                type="number"
                min={0}
                max={23}
                value={configForm.window_start_hour}
                onChange={(e) =>
                  setConfigForm((f) => ({
                    ...f,
                    window_start_hour: parseInt(e.target.value) || 0,
                  }))
                }
              />
            </FormField>
            <FormField label="Window End Hour (0-23)">
              <Input
                type="number"
                min={0}
                max={23}
                value={configForm.window_end_hour}
                onChange={(e) =>
                  setConfigForm((f) => ({
                    ...f,
                    window_end_hour: parseInt(e.target.value) || 23,
                  }))
                }
              />
            </FormField>
          </div>

          <FormField label="Jitter Minutes" hint="Random delay to avoid detection patterns">
            <Input
              type="number"
              min={0}
              max={60}
              value={configForm.jitter_minutes}
              onChange={(e) =>
                setConfigForm((f) => ({
                  ...f,
                  jitter_minutes: parseInt(e.target.value) || 0,
                }))
              }
            />
          </FormField>

          <FormField
            label="Portals to watch"
            hint="Leave empty to watch all enabled portals"
          >
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 border border-gray-200 dark:border-slate-600 rounded-lg">
              {(portalsList?.items ?? []).length === 0 ? (
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  No portals configured
                </span>
              ) : (
                (portalsList?.items ?? []).map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={configForm.portals?.includes(p.portal_id) ?? false}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setConfigForm((f) => ({
                          ...f,
                          portals: checked
                            ? [...(f.portals ?? []), p.portal_id]
                            : (f.portals ?? []).filter((id) => id !== p.portal_id),
                        }));
                      }}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <span className="text-gray-700 dark:text-gray-300">
                      {p.name || p.portal_id}
                    </span>
                  </label>
                ))
              )}
            </div>
          </FormField>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Notify on Change
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Send notifications when drift is detected
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setConfigForm((f) => ({ ...f, notify_on_change: !f.notify_on_change }))
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                configForm.notify_on_change
                  ? "bg-blue-600"
                  : "bg-gray-300 dark:bg-slate-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  configForm.notify_on_change ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
      </Modal>

      {/* Snapshot Detail Modal */}
      <Modal
        open={snapshotModalOpen}
        onClose={() => {
          setSnapshotModalOpen(false);
          setSelectedSnapshot(null);
        }}
        title={`Snapshot: ${selectedSnapshot?.portal_id}`}
        description={`Captured: ${selectedSnapshot?.captured_at ? new Date(selectedSnapshot.captured_at).toLocaleString() : ""}`}
        size="xl"
      >
        {selectedSnapshot && (
          <div className="space-y-4">
            {/* Info */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-slate-800 rounded-lg">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Severity</p>
                <Badge
                  variant={
                    getSeverityColor(selectedSnapshot.diff_severity) as
                      | "default"
                      | "secondary"
                      | "destructive"
                      | "outline"
                  }
                >
                  {selectedSnapshot.diff_severity ?? "none"}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">HTML Hash</p>
                <code className="text-xs text-gray-700 dark:text-gray-300">
                  {selectedSnapshot.html_hash.slice(0, 16)}...
                </code>
              </div>
              {selectedSnapshot.diff_summary && (
                <div className="col-span-2">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Summary</p>
                  <p className="text-sm text-gray-900 dark:text-white">
                    {selectedSnapshot.diff_summary}
                  </p>
                </div>
              )}
            </div>

            {/* Toggle */}
            <div className="flex gap-2">
              <Button
                variant={diffView ? "outline" : "default"}
                size="sm"
                onClick={() => setDiffView(false)}
              >
                HTML Source
              </Button>
              <Button
                variant={diffView ? "default" : "outline"}
                size="sm"
                onClick={() => setDiffView(true)}
                disabled={!selectedSnapshot.previous_snapshot_id}
              >
                Diff View
              </Button>
            </div>

            {/* Content */}
            <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <pre className="p-4 text-xs overflow-auto max-h-96 bg-gray-50 dark:bg-slate-900 text-gray-700 dark:text-gray-300">
                {diffView
                  ? "Diff view requires loading previous snapshot..."
                  : selectedSnapshot.html?.slice(0, 10000) ?? "No HTML content"}
                {selectedSnapshot.html && selectedSnapshot.html.length > 10000 && "\n\n... (truncated)"}
              </pre>
            </div>

            {/* Screenshot */}
            {selectedSnapshot.screenshot_path && (
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Screenshot
                </p>
                <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-2">
                  <a
                    href={selectedSnapshot.screenshot_path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="h-4 w-4" />
                    View Screenshot
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
