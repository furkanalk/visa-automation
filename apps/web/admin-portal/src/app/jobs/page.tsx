"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal, FormField } from "@/components/ui/modal";
import { cpApi, Job, JobEvent, JobRun } from "@/lib/api";
import { SaveBanner } from "@/components/ui/save-banner";
import {
  Briefcase,
  RefreshCw,
  Search,
  Eye,
  XCircle,
  RotateCcw,
  PlayCircle,
  X,
  Clock,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Settings,
  Trash2,
} from "lucide-react";

const statusColors: Record<string, "default" | "secondary" | "destructive" | "success" | "warning"> = {
  QUEUED: "secondary",
  LOGIN_PROCESS: "default",
  LOGGED_IN: "default",
  FORM_FILLING: "default",
  PROCESSING: "default",
  SLOT_SEARCHING: "default",
  SLOT_FOUND: "success",
  PAYMENT: "warning",
  WAITING_SLOT: "secondary",
  WAITING_HITL: "warning",
  PAUSED: "secondary",
  COMPLETED: "success",
  FAILED_RETRYABLE: "warning",
  FAILED_TERMINAL: "destructive",
  CANCELLED: "secondary",
};

/** Job is finished (no Cancel); includes scout slot-check outcomes (SLOT_FOUND, FAILED_RETRYABLE). */
const TERMINAL_STATES = ["COMPLETED", "FAILED_TERMINAL", "CANCELLED", "SLOT_FOUND", "FAILED_RETRYABLE"];
/** States that allow Retry: failed/cancelled; increments retry count (max_retries). */
const RETRYABLE_STATES = ["FAILED_RETRYABLE", "FAILED_TERMINAL", "CANCELLED"];
/** States that allow Requeue: put back in queue without incrementing retry count (e.g. continue after HITL or pause). */
const REQUEUEABLE_STATES = ["WAITING_HITL", "PAUSED", "CANCELLED"];

const JOBS_PAGE_SIZE = 10;
const HIDE_SLOT_CHECK_KEY = "jobs.hideSlotCheck";

function getDefaultHideSlotCheck(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(HIDE_SLOT_CHECK_KEY);
  if (stored === null) return true;
  return stored === "true";
}

export default function JobsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [hideSlotCheck, setHideSlotCheck] = useState(getDefaultHideSlotCheck);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [jobConfigForm, setJobConfigForm] = useState({
    completed_retention_value: 24,
    completed_retention_unit: "hours" as "hours" | "days",
    failed_retention_value: 168,
    failed_retention_unit: "hours" as "hours" | "days",
  });
  const queryClient = useQueryClient();

  const { data: jobs, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["jobs", statusFilter, page, hideSlotCheck],
    queryFn: () =>
      cpApi.getJobs({
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...(hideSlotCheck ? { exclude_slot_check: "true" } : {}),
        limit: String(JOBS_PAGE_SIZE),
        offset: String(page * JOBS_PAGE_SIZE),
      }),
  });

  const { data: globalSettings } = useQuery({
    queryKey: ["settings", "global"],
    queryFn: () => cpApi.settings.getGlobalSettings(),
    enabled: configModalOpen,
  });

  const onToggleHideSlotCheck = (checked: boolean) => {
    setHideSlotCheck(checked);
    try {
      localStorage.setItem(HIDE_SLOT_CHECK_KEY, String(checked));
    } catch {
      // ignore
    }
  };

  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [clearAllConfirm, setClearAllConfirm] = useState(false);
  const showBanner = (type: "success" | "error", text: string) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 5000);
  };

  const clearAllMutation = useMutation({
    mutationFn: () => cpApi.clearAllJobs(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setClearAllConfirm(false);
      setSelectedJob(null);
      showBanner("success", `Cleared ${data?.deleted ?? 0} job(s).`);
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to clear jobs."),
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => cpApi.stopJob(id, "Stopped by admin"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setSelectedJob(null);
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed."),
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => cpApi.retryJob(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setSelectedJob(null);
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed."),
  });

  const requeueMutation = useMutation({
    mutationFn: (id: string) => cpApi.requeueJob(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setSelectedJob(null);
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed."),
  });

  const saveJobConfigMutation = useMutation({
    mutationFn: async () => {
      const completedHours =
        jobConfigForm.completed_retention_unit === "days"
          ? jobConfigForm.completed_retention_value * 24
          : jobConfigForm.completed_retention_value;
      const failedHours =
        jobConfigForm.failed_retention_unit === "days"
          ? jobConfigForm.failed_retention_value * 24
          : jobConfigForm.failed_retention_value;
      await cpApi.settings.setGlobalValue("queue", "completed_retention_hours", Math.max(1, completedHours));
      await cpApi.settings.setGlobalValue("queue", "failed_retention_hours", Math.max(1, failedHours));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "global"] });
      setConfigModalOpen(false);
      showBanner("success", "Job retention saved. Restart CP for new retention to apply.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to save."),
  });

  const handleOpenJobConfig = () => setConfigModalOpen(true);

  useEffect(() => {
    if (!configModalOpen || !globalSettings?.items?.length) return;
    const queue = globalSettings.items.filter((s) => s.category === "queue");
    const num = (key: string, def: number) => {
      const s = queue.find((x) => x.key === key);
      if (s?.value == null) return def;
      return typeof s.value === "number" ? s.value : parseInt(String(s.value), 10) || def;
    };
    const ch = num("completed_retention_hours", 24);
    const fh = num("failed_retention_hours", 168);
    setJobConfigForm({
      completed_retention_value: ch >= 24 && ch % 24 === 0 ? ch / 24 : ch,
      completed_retention_unit: ch >= 24 && ch % 24 === 0 ? "days" : "hours",
      failed_retention_value: fh >= 24 && fh % 24 === 0 ? fh / 24 : fh,
      failed_retention_unit: fh >= 24 && fh % 24 === 0 ? "days" : "hours",
    });
  }, [configModalOpen, globalSettings?.items]);

  const total = jobs?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / JOBS_PAGE_SIZE));
  const filteredJobs = jobs?.items?.filter(
    (job) =>
      job.id.toLowerCase().includes(search.toLowerCase()) ||
      job.visa_type.toLowerCase().includes(search.toLowerCase()) ||
      (job.external_ref?.toLowerCase().includes(search.toLowerCase()) ?? false)
  );

  return (
    <div className="space-y-6">
      <SaveBanner message={banner} onDismiss={() => setBanner(null)} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Jobs</h1>
          <p className="text-gray-500 dark:text-gray-400">Monitor and manage visa automation jobs</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setClearAllConfirm(true)}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear all jobs
          </Button>
          <Button variant="outline" onClick={handleOpenJobConfig}>
            <Settings className="h-4 w-4 mr-1" />
            Configure
          </Button>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by ID, visa type, or ref..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 border-transparent bg-blue-50 dark:bg-slate-700 shadow-sm focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
          className="h-9 rounded-lg px-4 bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 outline-none cursor-pointer transition-all duration-200"
        >
          <option value="all">All Status</option>
          <option value="QUEUED">Queued</option>
          <option value="LOGIN_PROCESS">Login Process</option>
          <option value="PROCESSING">Processing</option>
          <option value="SLOT_SEARCHING">Slot Searching</option>
          <option value="SLOT_FOUND">Slot Found</option>
          <option value="WAITING_HITL">Waiting HITL</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED_RETRYABLE">Failed (Retryable)</option>
          <option value="FAILED_TERMINAL">Failed (Terminal)</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={hideSlotCheck}
            onChange={(e) => {
              onToggleHideSlotCheck(e.target.checked);
              setPage(0);
            }}
            className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-400"
          />
          Hide slot-check jobs
        </label>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-gray-500 dark:text-gray-400">Loading jobs...</p>
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="h-12 w-12 text-red-400 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">Failed to load jobs</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 text-center max-w-md">
              {error instanceof Error ? error.message : "API server may be unavailable"}
            </p>
            <Button variant="outline" onClick={() => refetch()} className="mt-4">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : !filteredJobs?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Briefcase className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No jobs found</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              {search || statusFilter !== "all" 
                ? "Try adjusting your filters or search query" 
                : "Jobs will appear here when created"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[64rem] overflow-auto overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
                    <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">Job ID</th>
                    <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">Visa Type</th>
                    <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">Status</th>
                    <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">Priority</th>
                    <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">Retries</th>
                    <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">Created</th>
                    <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs?.map((job) => (
                    <tr
                      key={job.id}
                      className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/50"
                    >
                      <td className="p-4">
                        <div className="flex flex-col">
                          <code className="text-sm bg-gray-100 dark:bg-slate-700 text-gray-900 dark:text-white px-2 py-1 rounded inline-block w-fit">
                            {job.id.slice(0, 12)}...
                          </code>
                          {job.external_ref && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              Ref: {job.external_ref}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-sm text-gray-900 dark:text-white">{job.visa_type}</td>
                      <td className="p-4">
                        <Badge variant={statusColors[job.status] || "secondary"}>{job.status}</Badge>
                      </td>
                      <td className="p-4 text-sm text-gray-900 dark:text-white">{job.priority}</td>
                      <td className="p-4 text-sm text-gray-900 dark:text-white">
                        {job.retry_count} / {job.max_retries}
                      </td>
                      <td className="p-4 text-sm text-gray-500 dark:text-gray-400">
                        {new Date(job.created_at).toLocaleString()}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedJob(job)}
                            title="View Details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {!TERMINAL_STATES.includes(job.status) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => stopMutation.mutate(job.id)}
                              disabled={stopMutation.isPending}
                              title="Cancel Job"
                              className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          )}
                          {RETRYABLE_STATES.includes(job.status) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => retryMutation.mutate(job.id)}
                              disabled={retryMutation.isPending}
                              title="Retry (uses one retry attempt; for failed/cancelled jobs)"
                              className="text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                          {REQUEUEABLE_STATES.includes(job.status) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => requeueMutation.mutate(job.id)}
                              disabled={requeueMutation.isPending}
                              title="Continue (put back in queue; does not use retry count)"
                              className="text-green-500 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
                            >
                              <PlayCircle className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-slate-700">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Page {page + 1} of {totalPages} ({total} jobs)
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Job Detail Modal */}
      {selectedJob && (
        <JobDetailModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onStop={() => stopMutation.mutate(selectedJob.id)}
          onRetry={() => retryMutation.mutate(selectedJob.id)}
          onRequeue={() => requeueMutation.mutate(selectedJob.id)}
          isStopPending={stopMutation.isPending}
          isRetryPending={retryMutation.isPending}
          isRequeuePending={requeueMutation.isPending}
        />
      )}

      {/* Clear all jobs confirm */}
      <Modal
        open={clearAllConfirm}
        onClose={() => setClearAllConfirm(false)}
        title="Clear all jobs"
        description="Permanently delete all jobs for this tenant. Job runs and events will be removed. This cannot be undone."
        size="sm"
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setClearAllConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => clearAllMutation.mutate()}
            disabled={clearAllMutation.isPending}
          >
            {clearAllMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-1" />
            )}
            Clear all
          </Button>
        </div>
      </Modal>

      {/* Job retention config modal */}
      <Modal
        open={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
        title="Job retention"
        description="How long to keep completed and failed job records before they are removed. Restart CP for changes to apply."
        size="md"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Completed jobs" hint="Keep for">
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  max={jobConfigForm.completed_retention_unit === "days" ? 365 : 8760}
                  value={jobConfigForm.completed_retention_value}
                  onChange={(e) =>
                    setJobConfigForm((f) => ({
                      ...f,
                      completed_retention_value: Math.max(1, parseInt(e.target.value, 10) || 24),
                    }))
                  }
                  className="flex-1"
                />
                <select
                  value={jobConfigForm.completed_retention_unit}
                  onChange={(e) =>
                    setJobConfigForm((f) => ({
                      ...f,
                      completed_retention_unit: e.target.value as "hours" | "days",
                    }))
                  }
                  className="h-9 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm text-gray-900 dark:text-gray-100 min-w-[80px]"
                >
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </div>
            </FormField>
            <FormField label="Failed jobs" hint="Keep for">
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  max={jobConfigForm.failed_retention_unit === "days" ? 365 : 8760}
                  value={jobConfigForm.failed_retention_value}
                  onChange={(e) =>
                    setJobConfigForm((f) => ({
                      ...f,
                      failed_retention_value: Math.max(1, parseInt(e.target.value, 10) || 168),
                    }))
                  }
                  className="flex-1"
                />
                <select
                  value={jobConfigForm.failed_retention_unit}
                  onChange={(e) =>
                    setJobConfigForm((f) => ({
                      ...f,
                      failed_retention_unit: e.target.value as "hours" | "days",
                    }))
                  }
                  className="h-9 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm text-gray-900 dark:text-gray-100 min-w-[80px]"
                >
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </div>
            </FormField>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfigModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveJobConfigMutation.mutate()} disabled={saveJobConfigMutation.isPending}>
              {saveJobConfigMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function JobDetailModal({
  job,
  onClose,
  onStop,
  onRetry,
  onRequeue,
  isStopPending,
  isRetryPending,
  isRequeuePending,
}: {
  job: Job;
  onClose: () => void;
  onStop: () => void;
  onRetry: () => void;
  onRequeue: () => void;
  isStopPending: boolean;
  isRetryPending: boolean;
  isRequeuePending: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"details" | "events" | "runs">("details");

  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ["job-events", job.id],
    queryFn: () => cpApi.getJobEvents(job.id, 50),
    enabled: activeTab === "events",
  });

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ["job-runs", job.id],
    queryFn: () => cpApi.getJobRuns(job.id),
    enabled: !!job.id,
  });

  const canStop = !TERMINAL_STATES.includes(job.status);
  const canRetry = RETRYABLE_STATES.includes(job.status);
  const canRequeue = REQUEUEABLE_STATES.includes(job.status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <Briefcase className="h-5 w-5 text-gray-500" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Job Details</h2>
              <code className="text-xs text-gray-500">{job.id}</code>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {(runs?.items?.[0]?.agent_name || job.locked_by) && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {runs?.items?.[0]?.agent_name ? `Agent: ${runs.items[0].agent_name}` : `Worker: ${job.locked_by}`}
              </span>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md transition-colors"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-slate-700">
          <button
            onClick={() => setActiveTab("details")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "details"
                ? "border-primary text-primary"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            Details
          </button>
          <button
            onClick={() => setActiveTab("events")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "events"
                ? "border-primary text-primary"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            Events Timeline
          </button>
          <button
            onClick={() => setActiveTab("runs")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "runs"
                ? "border-primary text-primary"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            Run History
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[60vh]">
          {activeTab === "details" && (
            <div className="space-y-4">
              {/* Status and Actions */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Status:</span>
                  <Badge variant={statusColors[job.status] || "secondary"} className="text-sm">
                    {job.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  {canStop && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={onStop}
                      disabled={isStopPending}
                    >
                      {isStopPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <XCircle className="h-4 w-4 mr-1" />}
                      Cancel
                    </Button>
                  )}
                  {canRetry && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onRetry}
                      disabled={isRetryPending}
                      title="Uses one retry attempt (for failed/cancelled jobs)"
                      className="text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                    >
                      {isRetryPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                      Retry
                    </Button>
                  )}
                  {canRequeue && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onRequeue}
                      disabled={isRequeuePending}
                      title="Put back in queue; does not use retry count (e.g. continue after HITL)"
                      className="text-green-600 border-green-300 hover:bg-green-50 dark:hover:bg-green-900/20"
                    >
                      {isRequeuePending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-1" />}
                      Continue
                    </Button>
                  )}
                </div>
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-4">
                <InfoCard label="Visa Type" value={job.visa_type} />
                <InfoCard label="Priority" value={String(job.priority)} />
                <InfoCard label="Retries" value={`${job.retry_count} / ${job.max_retries}`} />
                <InfoCard label="External Ref" value={job.external_ref || "-"} />
                <InfoCard label="Created" value={new Date(job.created_at).toLocaleString()} />
                <InfoCard
                  label="Updated"
                  value={`${new Date(job.updated_at).toLocaleString()}${job.status ? ` (${job.status})` : ""}`}
                />
                {job.locked_by && (
                  <InfoCard label="Locked By" value={job.locked_by} />
                )}
              </div>

              {/* Applicant Data */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Applicant Data</CardTitle>
                </CardHeader>
                <CardContent className="py-2">
                  <pre className="text-xs bg-gray-50 dark:bg-slate-900 p-3 rounded overflow-x-auto">
                    {JSON.stringify(job.applicant_data, null, 2)}
                  </pre>
                </CardContent>
              </Card>

              {/* Config */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Job Config</CardTitle>
                  {(job.config as Record<string, unknown>)?.slot_check_only === true && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Slot-check (scout) job: only checks for availability, does not book.
                    </p>
                  )}
                </CardHeader>
                <CardContent className="py-2">
                  <pre className="text-xs bg-gray-50 dark:bg-slate-900 p-3 rounded overflow-x-auto">
                    {JSON.stringify(job.config, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "events" && (
            <div className="space-y-2">
              {eventsLoading ? (
                <div className="text-center py-8 text-gray-500">Loading events...</div>
              ) : events?.items.length === 0 ? (
                <div className="text-center py-8 text-gray-500">No events recorded</div>
              ) : (
                <div className="relative pl-6 border-l-2 border-gray-200 dark:border-slate-700 space-y-4">
                  {events?.items.map((event) => (
                    <EventItem key={event.id} event={event} />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "runs" && (
            <div className="space-y-2">
              {runsLoading ? (
                <div className="text-center py-8 text-gray-500">Loading runs...</div>
              ) : (
                <>
                  <div className="text-sm text-gray-500 mb-4">
                    Total retry count: <span className="font-medium">{runs?.retry_count ?? 0}</span>
                  </div>
                  {runs?.items.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">No runs recorded</div>
                  ) : (
                    <div className="space-y-2">
                      {runs?.items.map((run) => (
                        <RunItem key={run.id} run={run} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 dark:bg-slate-900 rounded-md p-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">{value}</p>
    </div>
  );
}

/** Human-readable title for state_transition events in the timeline. */
function getStateTransitionTitle(payload: Record<string, unknown> | null): string {
  if (!payload) return "State transition";
  const toState = payload.to_state as string | undefined;
  const fromState = payload.from_state as string | undefined;
  const reason = payload.reason as string | undefined;
  const hitlType = payload.hitl_type as string | undefined;

  if (reason && typeof reason === "string") {
    const r = reason.toLowerCase();
    if (r.includes("slot found") || r.includes("notified")) return "Slot found";
    if (r.includes("hitl") && r.includes("triggered")) return hitlType ? `HITL: ${hitlType}` : "HITL triggered";
    if (r.includes("requeued") && r.includes("hitl")) return "Requeued after HITL";
    if (r.includes("no slots") && r.includes("retries")) return "Max retries exceeded";
    if (r.includes("no slots")) return "No slots, retry scheduled";
    if (reason.length < 50) return reason;
  }

  const labels: Record<string, string> = {
    QUEUED: "Queued",
    LOGIN_PROCESS: "Login started",
    LOGGED_IN: "Logged in",
    FORM_FILLING: "Form filling",
    PROCESSING: "Processing",
    SLOT_SEARCHING: "Slot searching",
    SLOT_FOUND: "Slot found",
    WAITING_SLOT: "Waiting for slot",
    WAITING_HITL: "Waiting for HITL",
    COMPLETED: "Completed",
    FAILED_RETRYABLE: "Failed (retryable)",
    FAILED: "Failed",
    CANCELLED: "Cancelled",
  };
  if (toState && labels[toState]) return labels[toState];
  if (fromState && toState) return `${fromState} → ${toState}`;
  return "State transition";
}

/** Structured summary lines for state_transition payload (no raw JSON needed to see key info). */
function StateTransitionSummary({ payload }: { payload: Record<string, unknown> }) {
  const fromState = payload.from_state as string | undefined;
  const toState = payload.to_state as string | undefined;
  const reason = payload.reason as string | undefined;
  const hitlType = payload.hitl_type as string | undefined;
  const workerId = payload.worker_id as string | undefined;
  const error = payload.error as string | undefined;
  const errorKind = payload.error_kind as string | undefined;
  const channel = payload.channel as string | undefined;
  const confirmationNumber = payload.confirmation_number as string | undefined;
  const nextRetryMs = payload.next_retry_ms as number | undefined;

  const lines: { label: string; value: string }[] = [];
  if (fromState && toState) lines.push({ label: "Transition", value: `${fromState} → ${toState}` });
  if (reason) lines.push({ label: "Reason", value: reason });
  if (hitlType) lines.push({ label: "HITL type", value: hitlType });
  if (workerId) lines.push({ label: "Worker", value: workerId });
  if (channel) lines.push({ label: "Channel", value: channel });
  if (confirmationNumber) lines.push({ label: "Confirmation", value: confirmationNumber });
  if (error) lines.push({ label: "Error", value: error });
  if (errorKind) lines.push({ label: "Error kind", value: errorKind });
  if (nextRetryMs !== undefined) lines.push({ label: "Next retry (ms)", value: String(nextRetryMs) });

  if (lines.length === 0) return null;
  return (
    <dl className="mt-2 space-y-1 text-xs">
      {lines.map(({ label, value }) => (
        <div key={label} className="flex gap-2 flex-wrap">
          <dt className="text-gray-500 dark:text-gray-400 shrink-0">{label}:</dt>
          <dd className="text-gray-900 dark:text-gray-100 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EventItem({ event }: { event: JobEvent }) {
  const getEventIcon = (type: string) => {
    switch (type?.toLowerCase()) {
      case "state_transition":
        return <ArrowRight className="h-4 w-4 text-blue-500" />;
      case "job_started":
        return <PlayCircle className="h-4 w-4 text-green-500" />;
      case "job_completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "job_failed":
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const payload = event.payload as Record<string, unknown> | null;
  const isStateTransition = event.event_type?.toLowerCase() === "state_transition";
  const displayTitle = isStateTransition
    ? getStateTransitionTitle(payload)
    : (event.event_type ?? "").replace(/_/g, " ");

  return (
    <div className="relative">
      <div className="absolute -left-[25px] w-4 h-4 bg-white dark:bg-slate-800 rounded-full border-2 border-gray-200 dark:border-slate-600 flex items-center justify-center">
        {getEventIcon(event.event_type)}
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-md p-3 border border-gray-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-gray-900 dark:text-white">{displayTitle}</span>
          <span className="text-xs text-gray-500">{new Date(event.created_at).toLocaleString()}</span>
        </div>
        {event.payload && Object.keys(event.payload).length > 0 && (
          <>
            {event.event_type?.toLowerCase() === "state_transition" ? (
              <StateTransitionSummary payload={event.payload as Record<string, unknown>} />
            ) : null}
            <details className="mt-2">
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 dark:hover:text-gray-400">
                Raw payload
              </summary>
              <pre className="text-xs bg-gray-50 dark:bg-slate-900 p-2 rounded mt-1 overflow-x-auto">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

function RunItem({ run }: { run: JobRun }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-slate-900 rounded-md">
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-xs">
            Attempt {run.attempt_number}
          </Badge>
          <Badge variant={statusColors[run.status] || "secondary"} className="text-xs">
            {run.status}
          </Badge>
          {run.agent_name && (
            <span className="text-sm text-gray-600 dark:text-gray-400">Agent: {run.agent_name}</span>
          )}
        </div>
        {(run.error_message || run.error_code) && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1 truncate" title={run.error_message ?? undefined}>
            {run.error_message || run.error_code}
          </p>
        )}
      </div>
      <span className="text-xs text-gray-500 shrink-0">
        {new Date(run.started_at).toLocaleString()}
        {run.finished_at && ` → ${new Date(run.finished_at).toLocaleString()}`}
      </span>
    </div>
  );
}
