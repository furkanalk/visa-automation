"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { TaskCard } from "@/components/tasks/task-card";
import { OtpInput } from "@/components/tasks/otp-input";
import { CaptchaInput } from "@/components/tasks/captcha-input";
import { useAuthStore } from "@/stores/auth";
import { staffApi, HitlTask } from "@/lib/api";
import { cn, formatDate } from "@/lib/utils";
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  Shield,
  Image,
  Key,
  Send,
  ArrowUp,
} from "lucide-react";

export default function MyTasksPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [selectedTask, setSelectedTask] = useState<HitlTask | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [notes, setNotes] = useState("");
  const [showEscalate, setShowEscalate] = useState(false);
  const [escalateReason, setEscalateReason] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "assigned">("all");

  // Fetch tasks
  const { data: tasksData, isLoading, refetch } = useQuery({
    queryKey: ["my-tasks", filter],
    queryFn: () => {
      const params: Record<string, string> = { limit: "50" };
      if (filter === "pending") params.status = "PENDING";
      if (filter === "assigned") params.status = "ASSIGNED";
      return staffApi.getMyTasks(params);
    },
    refetchInterval: 5000,
  });

  // Assign task mutation
  const assignMutation = useMutation({
    mutationFn: (taskId: string) => staffApi.assignTask(taskId, user?.id || ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["pending-count"] });
    },
  });

  // Resolve task mutation
  const resolveMutation = useMutation({
    mutationFn: ({ taskId, value }: { taskId: string; value: string }) =>
      staffApi.resolveTask(taskId, { value, notes: notes || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["pending-count"] });
      setSelectedTask(null);
      setInputValue("");
      setNotes("");
    },
  });

  // Escalate task mutation
  const escalateMutation = useMutation({
    mutationFn: ({ taskId, reason }: { taskId: string; reason: string }) =>
      staffApi.escalateTask(taskId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      setSelectedTask(null);
      setShowEscalate(false);
      setEscalateReason("");
    },
  });

  const handleSelectTask = async (task: HitlTask) => {
    setSelectedTask(task);
    setInputValue("");
    setNotes("");

    // Auto-assign if pending
    if (task.status === "PENDING") {
      assignMutation.mutate(task.id);
    }
  };

  const handleSubmit = () => {
    if (!selectedTask || !inputValue.trim()) return;
    resolveMutation.mutate({ taskId: selectedTask.id, value: inputValue });
  };

  const handleEscalate = () => {
    if (!selectedTask || !escalateReason.trim()) return;
    escalateMutation.mutate({ taskId: selectedTask.id, reason: escalateReason });
  };

  const pendingCount = tasksData?.items?.filter((t) => t.status === "PENDING").length || 0;
  const assignedCount = tasksData?.items?.filter((t) => t.status === "ASSIGNED").length || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Tasks</h1>
          <p className="text-gray-500 dark:text-gray-400">
            Handle HITL tasks requiring human input
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30">
                <Clock className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {pendingCount}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Pending</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Shield className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {assignedCount}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Assigned to me</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {tasksData?.total || 0}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Total tasks</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {(["all", "pending", "assigned"] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "pending" ? "Pending" : "My Tasks"}
          </Button>
        ))}
      </div>

      {/* Task List */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          Loading tasks...
        </div>
      ) : tasksData?.items && tasksData.items.length > 0 ? (
        <div className="space-y-3">
          {tasksData.items
            .filter((task) => task.status === "PENDING" || task.status === "ASSIGNED")
            .map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onSelect={() => handleSelectTask(task)}
                isAssigned={task.assigned_to === user?.id}
              />
            ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No pending tasks</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Great work! Check back later for new tasks.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Task Modal */}
      <Modal
        open={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        title={
          selectedTask?.type === "OTP"
            ? "Enter OTP Code"
            : selectedTask?.type === "CAPTCHA"
            ? "Solve CAPTCHA"
            : selectedTask?.type === "TURNSTILE"
            ? "Verify Turnstile"
            : "Complete Task"
        }
        description={selectedTask?.context?.prompt}
        size="lg"
        footer={
          showEscalate ? (
            <>
              <Button variant="outline" onClick={() => setShowEscalate(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleEscalate}
                disabled={!escalateReason.trim() || escalateMutation.isPending}
              >
                <ArrowUp className="h-4 w-4 mr-1" />
                Escalate
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setShowEscalate(true)}>
                <ArrowUp className="h-4 w-4 mr-1" />
                Escalate
              </Button>
              <Button
                variant="success"
                onClick={handleSubmit}
                disabled={!inputValue.trim() || resolveMutation.isPending}
              >
                <Send className="h-4 w-4 mr-1" />
                Submit
              </Button>
            </>
          )
        }
      >
        {selectedTask && (
          <div className="space-y-6">
            {/* Task Info */}
            <div className="p-4 bg-gray-50 dark:bg-slate-800 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant={selectedTask.status === "ASSIGNED" ? "success" : "warning"}>
                  {selectedTask.status}
                </Badge>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Expires: {formatDate(selectedTask.expires_at)}
                </span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Job: <code className="font-mono">{selectedTask.job_id}</code>
              </p>
            </div>

            {/* Screenshot if available */}
            {selectedTask.context?.screenshot_url && (
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Screenshot
                </p>
                <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
                  <img
                    src={selectedTask.context.screenshot_url}
                    alt="Task screenshot"
                    className="w-full max-h-64 object-contain bg-gray-100 dark:bg-slate-900"
                  />
                </div>
              </div>
            )}

            {/* Input based on task type */}
            {showEscalate ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Escalation Reason
                </label>
                <Textarea
                  value={escalateReason}
                  onChange={(e) => setEscalateReason(e.target.value)}
                  placeholder="Explain why this task needs admin attention..."
                  rows={4}
                />
              </div>
            ) : selectedTask.type === "OTP" ? (
              <div className="py-4">
                <p className="text-center text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Enter the 6-digit code
                </p>
                <OtpInput
                  value={inputValue}
                  onChange={setInputValue}
                  disabled={resolveMutation.isPending}
                />
              </div>
            ) : selectedTask.type === "CAPTCHA" ? (
              <CaptchaInput
                imageUrl={selectedTask.context?.screenshot_url}
                value={inputValue}
                onChange={setInputValue}
                disabled={resolveMutation.isPending}
              />
            ) : selectedTask.context?.input_type === "select" &&
              selectedTask.context?.options ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Select an option
                </label>
                <div className="grid gap-2">
                  {selectedTask.context.options.map((option) => (
                    <button
                      key={option}
                      onClick={() => setInputValue(option)}
                      className={cn(
                        "p-3 text-left border rounded-lg transition-colors",
                        inputValue === option
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
                          : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800"
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Your Response
                </label>
                <Input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Enter your response..."
                  disabled={resolveMutation.isPending}
                />
              </div>
            )}

            {/* Notes (always show for non-escalate) */}
            {!showEscalate && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Notes (optional)
                </label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any notes about this task..."
                  rows={2}
                />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
