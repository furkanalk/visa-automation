"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Diff from "diff";
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
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Download,
  Trash2,
} from "lucide-react";
import { cpApi, WatcherSnapshot, WatcherSnapshotFull, WatcherConfig, WatcherIntervalConfig, WatcherRunHistoryItem } from "@/lib/api";
import { SaveBanner } from "@/components/ui/save-banner";

export default function WatcherPage() {
  const queryClient = useQueryClient();
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<WatcherSnapshotFull | null>(null);
  const [diffView, setDiffView] = useState(false);
  const [archiveModalSnapshot, setArchiveModalSnapshot] = useState<{ id: string } | null>(null);
  const [archiveSummary, setArchiveSummary] = useState("");
  const [archivedSectionOpen, setArchivedSectionOpen] = useState(false);
  const [runHistoryOpen, setRunHistoryOpen] = useState(true);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [snapshotHistoryOpen, setSnapshotHistoryOpen] = useState(true);

  // Fetch watcher status
  const { data: status, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["watcher-status"],
    queryFn: () => cpApi.getWatcherStatus(),
    refetchInterval: 30000,
  });

  // Fetch snapshots (non-archived; default list)
  const { data: snapshots, isLoading: snapshotsLoading, isError: snapshotsError, error: snapshotsErrorDetail, refetch: refetchSnapshots } = useQuery({
    queryKey: ["watcher-snapshots"],
    queryFn: () => cpApi.getSnapshots({ archived: "false", limit: "20" }),
  });

  // Archived snapshots (separate section)
  const { data: archivedSnapshots, refetch: refetchArchived } = useQuery({
    queryKey: ["watcher-snapshots", "archived"],
    queryFn: () => cpApi.getSnapshots({ archived: "true", limit: "20" }),
  });

  // Run history (7-day retention)
  const { data: runHistory } = useQuery({
    queryKey: ["watcher-run-history"],
    queryFn: () => cpApi.getWatcherRunHistory(50),
  });

  // Fetch slot-check interval (global)
  const { data: intervalData } = useQuery({
    queryKey: ["watcher-interval"],
    queryFn: () => cpApi.getWatcherInterval(),
  });
  const currentInterval: WatcherIntervalConfig = intervalData ?? {
    fixed_ms: 5 * 60 * 1000,
    jitter_ms: 60 * 1000,
  };

  // Scout (watcher) agents: agents with Scout profile; they only process slot-check queue
  const { data: scoutAgentsData } = useQuery({
    queryKey: ["agents", "scout"],
    queryFn: () => cpApi.getAgents({ is_scout: "true" }),
  });
  const scoutAgents = scoutAgentsData?.items ?? [];
  const onlineScoutAgents = scoutAgents.filter((a) => a.status === "ONLINE");

  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const showBanner = (type: "success" | "error", text: string) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 5000);
  };

  const runMutation = useMutation({
    mutationFn: () => cpApi.runWatcher(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watcher-status"] });
      queryClient.invalidateQueries({ queryKey: ["watcher-snapshots"] });
      queryClient.invalidateQueries({ queryKey: ["watcher-snapshots", "archived"] });
      queryClient.invalidateQueries({ queryKey: ["watcher-run-history"] });
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Run failed"),
  });

  const archiveSnapshotMutation = useMutation({
    mutationFn: ({ id, archived, archiveSummary: summary }: { id: string; archived: boolean; archiveSummary?: string }) =>
      cpApi.updateSnapshotArchive(id, archived, summary),
    onSuccess: (_, { archived }) => {
      queryClient.invalidateQueries({ queryKey: ["watcher-snapshots"] });
      queryClient.invalidateQueries({ queryKey: ["watcher-snapshots", "archived"] });
      queryClient.invalidateQueries({ queryKey: ["watcher-status"] });
      setArchiveModalSnapshot(null);
      setArchiveSummary("");
      showBanner("success", archived ? "Snapshot archived." : "Snapshot unarchived.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to update archive"),
  });

  const clearRunHistoryMutation = useMutation({
    mutationFn: () => cpApi.clearWatcherRunHistory(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["watcher-run-history"] });
      showBanner("success", `Run history cleared (${data?.data?.deleted ?? 0} entries removed).`);
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to clear run history"),
  });

  const clearSnapshotsMutation = useMutation({
    mutationFn: () => cpApi.clearWatcherSnapshots(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["watcher-snapshots"] });
      queryClient.invalidateQueries({ queryKey: ["watcher-snapshots", "archived"] });
      showBanner("success", `Snapshots cleared (${data?.data?.deleted ?? 0} removed).`);
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to clear snapshots"),
  });

  // Config state (interval: fixed or fixed + jitter; scheduling jitter in ms; optional time window)
  const [configForm, setConfigForm] = useState({
    enabled: false,
    time_window_enabled: false,
    window_start_hour: 0,
    window_end_hour: 23,
    scheduling_jitter_ms: 10 * 60 * 1000,
    notify_on_change: true,
    diff_mode: "hash" as "hash" | "selector",
    run_retention_days: 7,
    snapshot_retention_days: 7,
    html_diff_interval: "1d" as string,
    portals: [] as string[],
    interval_mode: "fixed_jitter" as "fixed" | "fixed_jitter",
    fixed_ms: 5 * 60 * 1000,
    jitter_ms: 60 * 1000,
  });

  // Portals list for watcher portal selection
  const { data: portalsList } = useQuery({
    queryKey: ["portals"],
    queryFn: () => cpApi.getPortals(),
    enabled: configModalOpen,
  });

  const hasScoutAgent = onlineScoutAgents.length > 0;

  // Save config (watcher config + interval in one flow)
  const saveConfigMutation = useMutation({
    mutationFn: async (data: typeof configForm) => {
      if (data.enabled && !hasScoutAgent) {
        throw new Error("Enable at least one Scout agent before enabling Watcher (Agents → create agent with Scout profile).");
      }
      await cpApi.updateWatcherInterval({
        fixed_ms: data.fixed_ms,
        jitter_ms:
          data.interval_mode === "fixed_jitter"
            ? (data.jitter_ms > 0 ? data.jitter_ms : 60 * 1000)
            : 0,
      });
      await cpApi.updateWatcherConfig({
        enabled: hasScoutAgent ? data.enabled : false,
        time_window_enabled: data.time_window_enabled,
        window_start_hour: data.window_start_hour,
        window_end_hour: data.window_end_hour,
        jitter_minutes: Math.round(data.scheduling_jitter_ms / 60000),
        notify_on_change: data.notify_on_change,
        diff_mode: data.diff_mode,
        run_retention_days: data.run_retention_days,
        snapshot_retention_days: data.snapshot_retention_days,
        html_diff_interval: data.html_diff_interval,
        portals: Array.isArray(data.portals) ? data.portals : [],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watcher-status"] });
      queryClient.invalidateQueries({ queryKey: ["watcher-interval"] });
      setConfigModalOpen(false);
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to save."),
  });

  // Open config modal (merge status.config and current interval)
  const handleOpenConfig = () => {
    const interval = currentInterval;
    if (status?.config) {
      setConfigForm({
        enabled: status.config.enabled,
        time_window_enabled: status.config.time_window_enabled ?? false,
        window_start_hour: status.config.window_start_hour,
        window_end_hour: status.config.window_end_hour,
        scheduling_jitter_ms: (status.config.jitter_minutes ?? 0) * 60 * 1000,
        notify_on_change: status.config.notify_on_change,
        diff_mode: status.config.diff_mode === "selector" ? "selector" : "hash",
        run_retention_days: status.config.run_retention_days ?? 7,
        snapshot_retention_days: status.config.snapshot_retention_days ?? 7,
        html_diff_interval: status.config.html_diff_interval ?? "1d",
        portals: Array.isArray(status.config.portals) ? status.config.portals : [],
        interval_mode: interval.jitter_ms > 0 ? "fixed_jitter" : "fixed",
        fixed_ms: interval.fixed_ms,
        jitter_ms: interval.jitter_ms,
      });
    } else {
      setConfigForm((f) => ({
        ...f,
        portals: Array.isArray(f.portals) ? f.portals : [],
        time_window_enabled: f.time_window_enabled ?? false,
        diff_mode: f.diff_mode ?? "hash",
        run_retention_days: f.run_retention_days ?? 7,
        snapshot_retention_days: f.snapshot_retention_days ?? 7,
        html_diff_interval: f.html_diff_interval ?? "1d",
        interval_mode: interval.jitter_ms > 0 ? "fixed_jitter" : "fixed",
        fixed_ms: interval.fixed_ms,
        jitter_ms: interval.jitter_ms,
      }));
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

  // Fetch latest archived snapshot for this portal (diff base; exclude current so we get a different snapshot to compare)
  const { data: latestArchivedSnapshot, isFetching: latestArchivedLoading, isError: latestArchivedError } = useQuery({
    queryKey: ["watcher-snapshot", "latest-archived", selectedSnapshot?.portal_id, selectedSnapshot?.id],
    queryFn: () =>
      cpApi.getLatestArchivedSnapshot(selectedSnapshot!.portal_id!, selectedSnapshot!.id),
    enabled: !!selectedSnapshot?.portal_id && diffView && snapshotModalOpen,
    retry: false,
  });

  const downloadSnapshotHtml = (id: string, filename: string) => {
    cpApi.getSnapshotHtml(id).then((html) => {
      const blob = new Blob([html], { type: "text/html" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };

  const copyHash = () => {
    if (selectedSnapshot?.html_hash) {
      navigator.clipboard.writeText(selectedSnapshot.html_hash);
      showBanner("success", "Hash copied to clipboard");
    }
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
      <SaveBanner message={banner} onDismiss={() => setBanner(null)} />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Site Watcher</h1>
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
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Slot check interval</p>
              <p className="font-medium text-gray-900 dark:text-white">
                {currentInterval.jitter_ms > 0 ? "Fixed + jitter" : "Fixed"}
              </p>
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

      {/* Scout agents (Watcher) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white">Scout agents (Watcher)</CardTitle>
        </CardHeader>
        <CardContent>
          {scoutAgents.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Eye className="h-8 w-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
              <p>No scout agents</p>
              <p className="text-sm">Create a profile with &quot;Scout&quot; role in Profiles, then assign it to an agent in Agents.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {scoutAgents.map((agent) => (
                <li
                  key={agent.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        agent.status === "ONLINE"
                          ? "bg-green-500"
                          : agent.status === "DRAINING"
                          ? "bg-yellow-500"
                          : "bg-gray-400"
                      }`}
                    />
                    <span className="font-medium text-gray-900 dark:text-white">{agent.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {agent.status}
                    </Badge>
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {agent.desired_portals?.length
                      ? `Portals: ${agent.desired_portals.join(", ")}`
                      : "Any portal"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Run Result */}
      {runMutation.isSuccess && runMutation.data && (
        <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
              <div>
                <p className="font-medium text-green-700 dark:text-green-300">
                  Watcher run completed
                </p>
                <p className="text-sm text-green-600 dark:text-green-400">
                  {runMutation.data.jobs_created != null && runMutation.data.jobs_created > 0
                    ? `${runMutation.data.jobs_created} slot-check job(s) created. Scout agents will run them; snapshots updated for ${runMutation.data.portals?.length ?? 0} portal(s).`
                    : runMutation.data.portals?.length
                    ? `Checked ${runMutation.data.portals.length} portal(s). No slot-check jobs (need at least one active customer per portal). Snapshots may appear below.`
                    : runMutation.data.message ?? "Run completed."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Run history (expandable, Excel export) */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setRunHistoryOpen((v) => !v)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Run history
              {runHistory?.items?.length != null && runHistory.items.length > 0 && (
                <Badge variant="secondary">{runHistory.items.length}</Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {runHistory?.items && runHistory.items.length > 0 && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!window.confirm("Clear all run history? This cannot be undone.")) return;
                      clearRunHistoryMutation.mutate();
                    }}
                    disabled={clearRunHistoryMutation.isPending}
                  >
                    {clearRunHistoryMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-1" />
                    )}
                    Clear
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const rows: string[][] = [
                        ["Run at", "Portals checked", "Jobs created", "Up", "Down", "No customers", "Message"],
                        ...runHistory.items.map((r) => [
                          new Date(r.run_at).toLocaleString(),
                          (r.portals_checked ?? []).join("; "),
                          String(r.jobs_created),
                          (r.up_portal_ids ?? []).join("; "),
                          (r.down_portal_ids ?? []).join("; "),
                          (r.up_portals_with_no_customers ?? []).join("; "),
                          r.message ?? "",
                        ]),
                      ];
                      const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
                      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `watcher-run-history-${new Date().toISOString().slice(0, 10)}.csv`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Export CSV
                  </Button>
                </>
              )}
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {runHistoryOpen ? "▼ Collapse" : "▶ Expand"}
              </span>
            </div>
          </div>
        </CardHeader>
        {runHistoryOpen && (
          <CardContent>
            {runHistory?.items && runHistory.items.length > 0 ? (
              <div className="max-h-[32rem] overflow-y-auto space-y-1">
                {runHistory.items.map((run) => (
                  <div
                    key={run.id}
                    className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden"
                  >
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 p-3 text-left hover:bg-gray-50 dark:hover:bg-slate-800/50"
                      onClick={() => setExpandedRunId((id) => (id === run.id ? null : run.id))}
                    >
                      {expandedRunId === run.id ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" />
                      )}
                      <span className="font-medium text-gray-900 dark:text-white shrink-0">
                        {new Date(run.run_at).toLocaleString()}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {run.message ?? ""}
                      </span>
                      <Badge variant="outline" className="ml-auto shrink-0">
                        {run.jobs_created} job(s)
                      </Badge>
                    </button>
                    {expandedRunId === run.id && (
                      <div className="border-t border-gray-200 dark:border-slate-700 p-4 bg-gray-50 dark:bg-slate-800/50 text-sm space-y-2">
                        <p><span className="font-medium text-gray-700 dark:text-gray-300">Portals checked:</span> {(run.portals_checked ?? []).join(", ") || "—"}</p>
                        <p><span className="font-medium text-gray-700 dark:text-gray-300">Up:</span> {(run.up_portal_ids ?? []).join(", ") || "—"}</p>
                        <p><span className="font-medium text-gray-700 dark:text-gray-300">Down:</span> {(run.down_portal_ids ?? []).join(", ") || "—"}</p>
                        <p><span className="font-medium text-gray-700 dark:text-gray-300">Up but no customers:</span> {(run.up_portals_with_no_customers ?? []).join(", ") || "—"}</p>
                        {run.message && <p><span className="font-medium text-gray-700 dark:text-gray-300">Message:</span> {run.message}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <Clock className="h-8 w-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                <p>No run history yet</p>
                <p className="text-sm">Run the watcher to see entries</p>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Snapshots List (collapsible) */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setSnapshotHistoryOpen((v) => !v)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
              <FileCode className="h-5 w-5" />
              Snapshots History
              {snapshots?.total != null && snapshots.total > 0 && (
                <Badge variant="secondary">{snapshots.total}</Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {snapshots?.total != null && snapshots.total > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!window.confirm("Clear all snapshots? This cannot be undone.")) return;
                    clearSnapshotsMutation.mutate();
                  }}
                  disabled={clearSnapshotsMutation.isPending}
                >
                  {clearSnapshotsMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-1" />
                  )}
                  Clear
                </Button>
              )}
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {snapshotHistoryOpen ? "▼ Collapse" : "▶ Expand"}
              </span>
            </div>
          </div>
        </CardHeader>
        {snapshotHistoryOpen && (
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
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                {snapshotsErrorDetail instanceof Error ? snapshotsErrorDetail.message : "Check your connection and try again."}
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => refetchSnapshots()}>
                Try again
              </Button>
            </div>
          ) : snapshots?.items && snapshots.items.length > 0 ? (
            <div className="max-h-[32rem] overflow-auto overflow-x-auto">
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
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewSnapshot(snapshot)}
                          >
                            <FileCode className="h-4 w-4 mr-1" />
                            View
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setArchiveModalSnapshot({ id: snapshot.id });
                              setArchiveSummary("");
                            }}
                            disabled={archiveSnapshotMutation.isPending}
                          >
                            <Archive className="h-4 w-4 mr-1" />
                            Archive
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <FileCode className="h-8 w-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
              <p>No snapshots yet</p>
              <p className="text-sm">Run the watcher to capture portal snapshots</p>
            </div>
          )}
        </CardContent>
        )}
      </Card>

      {/* Archived Snapshots (collapsible) */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setArchivedSectionOpen((v) => !v)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
              <Archive className="h-5 w-5" />
              Archived
              {archivedSnapshots?.items?.length != null && archivedSnapshots.items.length > 0 && (
                <Badge variant="secondary">{archivedSnapshots.items.length}</Badge>
              )}
            </CardTitle>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {archivedSectionOpen ? "▼ Collapse" : "▶ Expand"}
            </span>
          </div>
        </CardHeader>
        {archivedSectionOpen && (
          <CardContent>
            {archivedSnapshots?.items && archivedSnapshots.items.length > 0 ? (
              <div className="max-h-[32rem] overflow-auto overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-slate-700">
                      <th className="text-left p-3 font-medium text-gray-500 dark:text-gray-400">Portal</th>
                      <th className="text-left p-3 font-medium text-gray-500 dark:text-gray-400">Captured</th>
                      <th className="text-left p-3 font-medium text-gray-500 dark:text-gray-400">Archived</th>
                      <th className="text-left p-3 font-medium text-gray-500 dark:text-gray-400">Severity</th>
                      <th className="text-right p-3 font-medium text-gray-500 dark:text-gray-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {archivedSnapshots.items.map((snapshot) => (
                      <tr
                        key={snapshot.id}
                        className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/50"
                      >
                        <td className="p-3 font-medium text-gray-900 dark:text-white">{snapshot.portal_id}</td>
                        <td className="p-3 text-sm text-gray-500 dark:text-gray-400">
                          {new Date(snapshot.captured_at).toLocaleString()}
                        </td>
                        <td className="p-3 text-sm text-gray-500 dark:text-gray-400">
                          {snapshot.archived_at ? new Date(snapshot.archived_at).toLocaleString() : "—"}
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
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button type="button" variant="ghost" size="sm" onClick={() => handleViewSnapshot(snapshot)}>
                              <FileCode className="h-4 w-4 mr-1" />
                              View
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => archiveSnapshotMutation.mutate({ id: snapshot.id, archived: false })}
                              disabled={archiveSnapshotMutation.isPending}
                            >
                              <ArchiveRestore className="h-4 w-4 mr-1" />
                              Unarchive
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <Archive className="h-8 w-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                <p>No archived snapshots</p>
                <p className="text-sm">Archived snapshots are excluded from auto-removal</p>
              </div>
            )}
          </CardContent>
        )}
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
              onClick={() => saveConfigMutation.mutate(configForm)}
              disabled={saveConfigMutation.isPending || (configForm.enabled && !hasScoutAgent)}
              title={configForm.enabled && !hasScoutAgent ? "Add a Scout agent first to enable Watcher" : undefined}
            >
              {saveConfigMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {status?.disabled_reason === "no_scout_agent" && (
            <p className="text-sm text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 rounded">
              Watcher is disabled because no Scout agent is configured. Add an agent with the Scout profile (Agents) to enable.
            </p>
          )}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Continuous slot check (Enable Watcher)
            </label>
            <button
              type="button"
              disabled={!hasScoutAgent}
              title={!hasScoutAgent ? "Add a Scout agent first (Agents → Scout profile)" : undefined}
              onClick={() =>
                hasScoutAgent && setConfigForm((f) => ({ ...f, enabled: !f.enabled }))
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                !hasScoutAgent ? "bg-gray-200 dark:bg-slate-600 cursor-not-allowed opacity-60" : (configForm.enabled && hasScoutAgent) ? "bg-blue-600" : "bg-gray-300 dark:bg-slate-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  (configForm.enabled && hasScoutAgent) ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          {!hasScoutAgent && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {scoutAgents.length > 0
                ? "No Scout agent is online. Start the Scout agent (Agents) so it shows as online to enable the Watcher."
                : "Add at least one agent with the Scout profile (Agents) to enable the Watcher."}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={configForm.time_window_enabled}
              onClick={() =>
                setConfigForm((f) => ({ ...f, time_window_enabled: !f.time_window_enabled }))
              }
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                configForm.time_window_enabled ? "bg-blue-500" : "bg-gray-200 dark:bg-gray-600"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  configForm.time_window_enabled ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </button>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Restrict to time window
            </span>
          </div>
          {configForm.time_window_enabled && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Start Time">
                  <select
                    value={configForm.window_start_hour}
                    onChange={(e) =>
                      setConfigForm((f) => ({
                        ...f,
                        window_start_hour: parseInt(e.target.value),
                      }))
                    }
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="End Time">
                  <select
                    value={configForm.window_end_hour}
                    onChange={(e) =>
                      setConfigForm((f) => ({
                        ...f,
                        window_end_hour: parseInt(e.target.value),
                      }))
                    }
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Watcher will only run between{" "}
                <span className="font-medium">
                  {String(configForm.window_start_hour).padStart(2, "0")}:00
                </span>{" "}
                and{" "}
                <span className="font-medium">
                  {String(configForm.window_end_hour).padStart(2, "0")}:00
                </span>
                {configForm.window_start_hour > configForm.window_end_hour && (
                  <span className="ml-1 text-amber-500">(spans midnight)</span>
                )}
              </p>
            </div>
          )}

          <FormField label="Jitter (ms)" hint="Random delay to avoid detection patterns">
            <Input
              type="number"
              min={0}
              step={10000}
              value={configForm.scheduling_jitter_ms}
              onChange={(e) =>
                setConfigForm((f) => ({
                  ...f,
                  scheduling_jitter_ms: parseInt(e.target.value) || 0,
                }))
              }
            />
          </FormField>

          <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Slot check interval</p>
            <div className="flex gap-4 mb-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="intervalMode"
                  checked={configForm.interval_mode === "fixed"}
                  onChange={() => setConfigForm((f) => ({ ...f, interval_mode: "fixed" }))}
                  className="h-4 w-4"
                />
                <span>Fixed</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="intervalMode"
                  checked={configForm.interval_mode === "fixed_jitter"}
                  onChange={() =>
                    setConfigForm((f) => ({
                      ...f,
                      interval_mode: "fixed_jitter",
                      jitter_ms: f.jitter_ms > 0 ? f.jitter_ms : 60 * 1000,
                    }))
                  }
                  className="h-4 w-4"
                />
                <span>Fixed + jitter</span>
              </label>
            </div>
            <FormField label="Interval (ms)" hint="Base delay between watcher runs">
              <Input
                type="number"
                min={60000}
                step={60000}
                value={configForm.fixed_ms}
                onChange={(e) =>
                  setConfigForm((f) => ({ ...f, fixed_ms: parseInt(e.target.value) || 300000 }))
                }
              />
            </FormField>
            {configForm.interval_mode === "fixed_jitter" && (
              <div className="mt-4">
                <FormField label="Jitter (± ms)" hint="Random ± added to interval">
                  <Input
                    type="number"
                    min={0}
                    step={10000}
                    value={configForm.jitter_ms}
                    onChange={(e) =>
                      setConfigForm((f) => ({ ...f, jitter_ms: parseInt(e.target.value) || 0 }))
                    }
                  />
                </FormField>
              </div>
            )}
          </div>

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
                      checked={Array.isArray(configForm.portals) && configForm.portals.includes(p.portal_id)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setConfigForm((f) => ({
                          ...f,
                          portals: checked
                            ? [...(Array.isArray(f.portals) ? f.portals : []), p.portal_id]
                            : (Array.isArray(f.portals) ? f.portals : []).filter((id) => id !== p.portal_id),
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

          <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Snapshot diff</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              How to detect HTML changes: hash (full page) or selector (configured portal elements only).
            </p>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="diffMode"
                  checked={configForm.diff_mode === "hash"}
                  onChange={() => setConfigForm((f) => ({ ...f, diff_mode: "hash" }))}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Hash based</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="diffMode"
                  checked={configForm.diff_mode === "selector"}
                  onChange={() => setConfigForm((f) => ({ ...f, diff_mode: "selector" }))}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Selector based</span>
              </label>
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">HTML diff check</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              How often to run HTML snapshot/diff (slot checks still run on the main interval; this only throttles the HTML capture).
            </p>
            <select
              value={configForm.html_diff_interval}
              onChange={(e) => setConfigForm((f) => ({ ...f, html_diff_interval: e.target.value }))}
              className="h-9 w-full max-w-xs rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm text-gray-900 dark:text-gray-100"
            >
              <option value="every_run">Every run</option>
              <option value="1h">Every hour</option>
              <option value="3h">Every 3 hours</option>
              <option value="12h">Every 12 hours</option>
              <option value="1d">Daily</option>
              <option value="1w">Weekly</option>
            </select>
          </div>

          <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Retention (days)</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              How long to keep watcher run history and non-archived snapshots. Archived snapshots are kept indefinitely.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Run history (days)" hint="1–365">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={configForm.run_retention_days}
                  onChange={(e) =>
                    setConfigForm((f) => ({ ...f, run_retention_days: Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 7)) }))
                  }
                />
              </FormField>
              <FormField label="Snapshots (days)" hint="Non-archived only">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={configForm.snapshot_retention_days}
                  onChange={(e) =>
                    setConfigForm((f) => ({ ...f, snapshot_retention_days: Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 7)) }))
                  }
                />
              </FormField>
            </div>
          </div>
        </div>
      </Modal>

      {/* Archive snapshot modal */}
      <Modal
        open={!!archiveModalSnapshot}
        onClose={() => {
          setArchiveModalSnapshot(null);
          setArchiveSummary("");
        }}
        title="Archive snapshot"
        description="Add an optional note for this archived snapshot."
      >
        {archiveModalSnapshot && (
          <div className="space-y-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Summary / note (optional)
            </label>
            <textarea
              className="w-full min-h-[80px] rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-500"
              placeholder="e.g. Captcha layout changed, keeping for reference"
              value={archiveSummary}
              onChange={(e) => setArchiveSummary(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setArchiveModalSnapshot(null);
                  setArchiveSummary("");
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() =>
                  archiveSnapshotMutation.mutate({
                    id: archiveModalSnapshot.id,
                    archived: true,
                    archiveSummary: archiveSummary.trim() || undefined,
                  })
                }
                disabled={archiveSnapshotMutation.isPending}
              >
                {archiveSnapshotMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Archive className="h-4 w-4 mr-1" />
                )}
                Archive
              </Button>
            </div>
          </div>
        )}
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
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-xs text-gray-700 dark:text-gray-300 font-mono" title={selectedSnapshot.html_hash}>
                    {selectedSnapshot.html_hash.length > 44
                      ? `${selectedSnapshot.html_hash.slice(0, 20)}...${selectedSnapshot.html_hash.slice(-16)}`
                      : selectedSnapshot.html_hash}
                  </code>
                  <Button variant="outline" size="sm" onClick={copyHash} type="button">
                    Copy
                  </Button>
                </div>
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
            <div className="flex flex-wrap gap-2 items-center">
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
                type="button"
              >
                Diff View
              </Button>
              {!diffView && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadSnapshotHtml(selectedSnapshot.id, `snapshot-${selectedSnapshot.portal_id}-${selectedSnapshot.id.slice(0, 8)}.html`)}
                  type="button"
                >
                  Download HTML
                </Button>
              )}
            </div>

            {/* Content */}
            <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
              {diffView ? (
                (() => {
                  if (latestArchivedLoading) {
                    return (
                      <pre className="p-4 text-xs overflow-auto max-h-96 bg-gray-50 dark:bg-slate-900 text-gray-700 dark:text-gray-300">
                        Loading latest archived snapshot...
                      </pre>
                    );
                  }
                  if (latestArchivedError || !latestArchivedSnapshot) {
                    return (
                      <pre className="p-4 text-xs overflow-auto max-h-96 bg-gray-50 dark:bg-slate-900 text-gray-700 dark:text-gray-300">
                        No other archived snapshot for this portal to compare. Archive another snapshot for this portal to use as diff base.
                      </pre>
                    );
                  }
                  const oldHtml = latestArchivedSnapshot.html ?? "";
                  const newHtml = selectedSnapshot.html ?? "";
                  const patch = Diff.createTwoFilesPatch(
                    "archived.html",
                    "current.html",
                    oldHtml,
                    newHtml,
                    "Last archived",
                    "Current"
                  );
                  return (
                    <pre className="p-4 text-xs overflow-auto max-h-96 bg-gray-50 dark:bg-slate-900 text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
                      {patch.split("\n").map((line: string, i: number) => {
                        if (line.startsWith("+") && !line.startsWith("+++")) {
                          return <div key={i} className="text-green-700 dark:text-green-400 bg-green-500/10">{line}</div>;
                        }
                        if (line.startsWith("-") && !line.startsWith("---")) {
                          return <div key={i} className="text-red-700 dark:text-red-400 bg-red-500/10">{line}</div>;
                        }
                        return <div key={i}>{line}</div>;
                      })}
                    </pre>
                  );
                })()
              ) : (
                <pre className="p-4 text-xs overflow-auto max-h-96 bg-gray-50 dark:bg-slate-900 text-gray-700 dark:text-gray-300">
                  {selectedSnapshot.html ?? "No HTML content"}
                </pre>
              )}
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
