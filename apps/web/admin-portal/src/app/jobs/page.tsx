"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cpApi, Job, JobEvent } from "@/lib/api";
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

const TERMINAL_STATES = ["COMPLETED", "FAILED_TERMINAL", "CANCELLED"];
const RETRYABLE_STATES = ["FAILED_RETRYABLE", "FAILED_TERMINAL", "CANCELLED"];

export default function JobsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const queryClient = useQueryClient();

  const { data: jobs, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["jobs", statusFilter],
    queryFn: () => cpApi.getJobs(statusFilter !== "all" ? { status: statusFilter } : undefined),
  });

  // Job actions mutations
  const stopMutation = useMutation({
    mutationFn: (id: string) => cpApi.stopJob(id, "Stopped by admin"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setSelectedJob(null);
    },
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => cpApi.retryJob(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setSelectedJob(null);
    },
  });

  const requeueMutation = useMutation({
    mutationFn: (id: string) => cpApi.requeueJob(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setSelectedJob(null);
    },
  });

  const filteredJobs = jobs?.items?.filter(
    (job) =>
      job.id.toLowerCase().includes(search.toLowerCase()) ||
      job.visa_type.toLowerCase().includes(search.toLowerCase()) ||
      (job.external_ref?.toLowerCase().includes(search.toLowerCase()) ?? false)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Jobs</h1>
          <p className="text-gray-500 dark:text-gray-400">Monitor and manage visa automation jobs</p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
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
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-lg px-4 bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 outline-none cursor-pointer transition-all duration-200"
        >
          <option value="all">All Status</option>
          <option value="QUEUED">Queued</option>
          <option value="LOGIN_PROCESS">Login Process</option>
          <option value="PROCESSING">Processing</option>
          <option value="SLOT_SEARCHING">Slot Searching</option>
          <option value="WAITING_HITL">Waiting HITL</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED_RETRYABLE">Failed (Retryable)</option>
          <option value="FAILED_TERMINAL">Failed (Terminal)</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
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
            <div className="overflow-x-auto">
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
                              title="Retry Job"
                              className="text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                          {(job.status === "CANCELLED" || job.status === "PAUSED") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => requeueMutation.mutate(job.id)}
                              disabled={requeueMutation.isPending}
                              title="Requeue Job"
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
    enabled: activeTab === "runs",
  });

  const canStop = !TERMINAL_STATES.includes(job.status);
  const canRetry = RETRYABLE_STATES.includes(job.status);
  const canRequeue = job.status === "CANCELLED" || job.status === "PAUSED";

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
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
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
                      className="text-green-600 border-green-300 hover:bg-green-50 dark:hover:bg-green-900/20"
                    >
                      {isRequeuePending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-1" />}
                      Requeue
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
                <InfoCard label="Updated" value={new Date(job.updated_at).toLocaleString()} />
                {job.completed_at && (
                  <InfoCard label="Completed" value={new Date(job.completed_at).toLocaleString()} />
                )}
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
                      {runs?.items.map((event) => (
                        <RunItem key={event.id} event={event} />
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

function EventItem({ event }: { event: JobEvent }) {
  const getEventIcon = (type: string) => {
    switch (type) {
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

  return (
    <div className="relative">
      <div className="absolute -left-[25px] w-4 h-4 bg-white dark:bg-slate-800 rounded-full border-2 border-gray-200 dark:border-slate-600 flex items-center justify-center">
        {getEventIcon(event.event_type)}
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-md p-3 border border-gray-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-gray-900 dark:text-white">{event.event_type}</span>
          <span className="text-xs text-gray-500">{new Date(event.created_at).toLocaleString()}</span>
        </div>
        {event.payload && Object.keys(event.payload).length > 0 && (
          <pre className="text-xs bg-gray-50 dark:bg-slate-900 p-2 rounded mt-2 overflow-x-auto">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function RunItem({ event }: { event: JobEvent }) {
  const payload = event.payload as Record<string, string> | null;
  const fromState = payload?.from_state;
  const toState = payload?.to_state;

  return (
    <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-slate-900 rounded-md">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          {fromState && toState ? (
            <>
              <Badge variant="secondary" className="text-xs">
                {fromState}
              </Badge>
              <ArrowRight className="h-3 w-3 text-gray-400" />
              <Badge variant={statusColors[toState] || "secondary"} className="text-xs">
                {toState}
              </Badge>
            </>
          ) : (
            <span className="text-sm text-gray-700 dark:text-gray-300">{event.event_type}</span>
          )}
        </div>
      </div>
      <span className="text-xs text-gray-500">{new Date(event.created_at).toLocaleString()}</span>
    </div>
  );
}
