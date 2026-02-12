"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cpApi, HitlTask, HitlTaskStatus, HitlTaskType, Job } from "@/lib/api";
import {
  Hand,
  RefreshCw,
  Search,
  Eye,
  UserCheck,
  CheckCircle,
  XCircle,
  X,
  Clock,
  AlertCircle,
  KeyRound,
  FileQuestion,
  Shield,
  MessageSquare,
  Loader2,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";

const statusColors: Record<HitlTaskStatus, "default" | "secondary" | "destructive" | "success" | "warning"> = {
  PENDING: "warning",
  ASSIGNED: "default",
  RESOLVED: "success",
  EXPIRED: "secondary",
  CANCELLED: "destructive",
};

const typeIcons: Record<HitlTaskType, typeof KeyRound> = {
  TURNSTILE: Shield,
  CAPTCHA: ImageIcon,
  OTP: KeyRound,
  DOCUMENT_CLARIFICATION: FileQuestion,
  MANUAL_REVIEW: Eye,
  CUSTOM_INPUT: MessageSquare,
};

const typeLabels: Record<HitlTaskType, string> = {
  TURNSTILE: "Turnstile",
  CAPTCHA: "CAPTCHA",
  OTP: "OTP Code",
  DOCUMENT_CLARIFICATION: "Document",
  MANUAL_REVIEW: "Manual Review",
  CUSTOM_INPUT: "Custom Input",
};

export default function HITLPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");
  const [selectedTask, setSelectedTask] = useState<HitlTask | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const { data: tasks, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["hitl-tasks", statusFilter],
    queryFn: () =>
      cpApi.getHitlTasks(statusFilter !== "all" ? { status: statusFilter } : undefined),
    refetchInterval: statusFilter === "PENDING" ? 5000 : false, // Auto-refresh pending tasks
  });

  const { data: pendingCount } = useQuery({
    queryKey: ["hitl-pending-count"],
    queryFn: () => cpApi.getHitlPendingCount(),
    refetchInterval: 10000,
  });

  const assignMutation = useMutation({
    mutationFn: (id: string) => cpApi.assignHitlTask(id, user?.name || "admin"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hitl-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["hitl-pending-count"] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cpApi.cancelHitlTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hitl-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["hitl-pending-count"] });
      setSelectedTask(null);
    },
  });

  const filteredTasks = tasks?.items?.filter(
    (task) =>
      task.id.toLowerCase().includes(search.toLowerCase()) ||
      task.job_id.toLowerCase().includes(search.toLowerCase()) ||
      (task.type?.toLowerCase().includes(search.toLowerCase()) ?? false)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">HITL Tasks</h1>
          <p className="text-gray-500 dark:text-gray-400">Human-in-the-loop task management</p>
        </div>
        <div className="flex items-center gap-3">
          {(pendingCount?.count ?? 0) > 0 && (
            <Badge variant="warning" className="text-sm px-3 py-1">
              <AlertCircle className="h-4 w-4 mr-1" />
              {pendingCount?.count} Pending
            </Badge>
          )}
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
            placeholder="Search by ID, job, or type..."
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
          <option value="PENDING">Pending</option>
          <option value="ASSIGNED">Assigned</option>
          <option value="RESOLVED">Resolved</option>
          <option value="EXPIRED">Expired</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-gray-500 dark:text-gray-400">Loading tasks...</p>
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">Failed to load tasks</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 text-center max-w-md">
              {error instanceof Error ? error.message : "API server may be unavailable"}
            </p>
            <Button variant="outline" onClick={() => refetch()} className="mt-4">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : filteredTasks?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Hand className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No HITL tasks found</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 text-center max-w-md">
              {search || statusFilter !== "all" 
                ? "Try adjusting your filters or search query" 
                : "When jobs require human intervention (CAPTCHA, verification), tasks will appear here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredTasks?.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onView={() => setSelectedTask(task)}
              onAssign={() => assignMutation.mutate(task.id)}
              onCancel={() => cancelMutation.mutate(task.id)}
              isAssigning={assignMutation.isPending}
              isCancelling={cancelMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onAssign={() => assignMutation.mutate(selectedTask.id)}
          onCancel={() => cancelMutation.mutate(selectedTask.id)}
          isAssigning={assignMutation.isPending}
          isCancelling={cancelMutation.isPending}
        />
      )}
    </div>
  );
}

function TaskCard({
  task,
  onView,
  onAssign,
  onCancel,
  isAssigning,
  isCancelling,
}: {
  task: HitlTask;
  onView: () => void;
  onAssign: () => void;
  onCancel: () => void;
  isAssigning: boolean;
  isCancelling: boolean;
}) {
  const TypeIcon = task.type ? typeIcons[task.type] : Hand;
  const isExpiringSoon =
    task.status === "PENDING" &&
    new Date(task.expires_at).getTime() - Date.now() < 5 * 60 * 1000; // 5 minutes

  return (
    <Card className={isExpiringSoon ? "border-amber-300 dark:border-amber-700" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TypeIcon className="h-5 w-5 text-gray-500" />
            <span className="font-medium text-gray-900 dark:text-white">
              {task.type ? typeLabels[task.type] : "Unknown"}
            </span>
          </div>
          <Badge variant={task.status ? statusColors[task.status] : "secondary"}>
            {task.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm space-y-1">
          <p className="text-gray-500 dark:text-gray-400">
            Job:{" "}
            <code className="bg-gray-100 dark:bg-slate-700 px-1 rounded">
              {task.job_id.slice(0, 12)}...
            </code>
          </p>
          <p className="text-gray-500 dark:text-gray-400">
            Created: {new Date(task.created_at).toLocaleString()}
          </p>
          {task.status === "PENDING" && (
            <p
              className={`flex items-center gap-1 ${
                isExpiringSoon ? "text-amber-600" : "text-gray-500 dark:text-gray-400"
              }`}
            >
              <Clock className="h-3 w-3" />
              Expires: {new Date(task.expires_at).toLocaleString()}
            </p>
          )}
        </div>

        {task.context?.prompt && (
          <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2">
            {task.context.prompt}
          </p>
        )}

        <div className="flex items-center gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={onView} className="flex-1">
            <Eye className="h-4 w-4 mr-1" />
            View
          </Button>
          {task.status === "PENDING" && (
            <>
              <Button
                size="sm"
                onClick={onAssign}
                disabled={isAssigning}
                className="flex-1"
              >
                {isAssigning ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <UserCheck className="h-4 w-4 mr-1" />
                )}
                Assign
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancel}
                disabled={isCancelling}
                className="text-red-500 hover:text-red-600"
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TaskDetailModal({
  task,
  onClose,
  onAssign,
  onCancel,
  isAssigning,
  isCancelling,
}: {
  task: HitlTask;
  onClose: () => void;
  onAssign: () => void;
  onCancel: () => void;
  isAssigning: boolean;
  isCancelling: boolean;
}) {
  const [resolution, setResolution] = useState("");
  const [notes, setNotes] = useState("");
  const queryClient = useQueryClient();

  const { data: taskDetail, isLoading } = useQuery({
    queryKey: ["hitl-task", task.id],
    queryFn: () => cpApi.getHitlTask(task.id),
  });

  const resolveMutation = useMutation({
    mutationFn: () =>
      cpApi.resolveHitlTask(task.id, {
        value: resolution,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hitl-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["hitl-pending-count"] });
      onClose();
    },
  });

  const TypeIcon = task.type ? typeIcons[task.type] : Hand;
  const canResolve =
    (task.status === "PENDING" || task.status === "ASSIGNED") && resolution.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <TypeIcon className="h-5 w-5 text-gray-500" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {task.type ? typeLabels[task.type] : "HITL Task"}
              </h2>
              <code className="text-xs text-gray-500">{task.id}</code>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={task.status ? statusColors[task.status] : "secondary"}>
              {task.status}
            </Badge>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md transition-colors"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[60vh] space-y-4">
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : (
            <>
              {/* Task Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 dark:bg-slate-900 rounded-md p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Job ID</p>
                  <code className="text-sm font-medium text-gray-900 dark:text-white">
                    {task.job_id.slice(0, 16)}...
                  </code>
                </div>
                <div className="bg-gray-50 dark:bg-slate-900 rounded-md p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Expires</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {new Date(task.expires_at).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Context */}
              {task.context && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">Task Context</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {task.context.prompt && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Prompt</p>
                        <p className="text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-900 p-3 rounded">
                          {task.context.prompt}
                        </p>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span>Input Type: {task.context.input_type}</span>
                    </div>
                    {task.context.screenshot_url && (
                      <a
                        href={task.context.screenshot_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-primary hover:underline"
                      >
                        <ImageIcon className="h-4 w-4" />
                        View Screenshot
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {task.context.options && task.context.options.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Options</p>
                        <div className="flex flex-wrap gap-2">
                          {task.context.options.map((opt, i) => (
                            <Badge key={i} variant="secondary">
                              {opt}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Job Info */}
              {taskDetail?.job && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">Associated Job</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-500">Visa Type:</span>{" "}
                        <span className="text-gray-900 dark:text-white">
                          {taskDetail.job.visa_type}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Status:</span>{" "}
                        <Badge variant="secondary">{taskDetail.job.status}</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Resolution (if resolved) */}
              {task.resolution && (
                <Card className="border-green-200 dark:border-green-800">
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm text-green-600">Resolution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-900 dark:text-white">
                      {task.resolution.value}
                    </p>
                    {task.resolution.notes && (
                      <p className="text-xs text-gray-500 mt-2">Notes: {task.resolution.notes}</p>
                    )}
                    {task.resolved_by && (
                      <p className="text-xs text-gray-500 mt-1">
                        Resolved by: {task.resolved_by} at{" "}
                        {new Date(task.resolved_at!).toLocaleString()}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Input Form (for pending/assigned tasks) */}
              {(task.status === "PENDING" || task.status === "ASSIGNED") && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">Resolve Task</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {task.context?.input_type === "select" && task.context.options ? (
                      <select
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value)}
                        className="w-full h-9 rounded-lg px-4 bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 outline-none cursor-pointer transition-all duration-200 text-sm"
                      >
                        <option value="">Select an option...</option>
                        {task.context.options.map((opt, i) => (
                          <option key={i} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        placeholder={
                          task.type === "OTP"
                            ? "Enter OTP code..."
                            : task.type === "CAPTCHA"
                            ? "Enter CAPTCHA text..."
                            : "Enter resolution..."
                        }
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value)}
                      />
                    )}
                    <Input
                      placeholder="Notes (optional)"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        {(task.status === "PENDING" || task.status === "ASSIGNED") && (
          <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
              {task.status === "PENDING" && (
                <Button
                  variant="outline"
                  onClick={onAssign}
                  disabled={isAssigning}
                >
                  {isAssigning ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <UserCheck className="h-4 w-4 mr-1" />
                  )}
                  Assign to Me
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={onCancel}
                disabled={isCancelling}
                className="text-red-500 hover:text-red-600"
              >
                {isCancelling ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4 mr-1" />
                )}
                Cancel Task
              </Button>
            </div>
            <Button
              onClick={() => resolveMutation.mutate()}
              disabled={!canResolve || resolveMutation.isPending}
            >
              {resolveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-1" />
              )}
              Resolve
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
