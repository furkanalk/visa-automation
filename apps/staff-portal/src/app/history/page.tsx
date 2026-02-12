"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";
import { staffApi, HitlTask, HitlTaskType } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import {
  History as HistoryIcon,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Search,
  Key,
  Image,
  Shield,
  FileQuestion,
  Eye,
  Keyboard,
} from "lucide-react";

const TASK_TYPE_ICONS: Record<HitlTaskType, React.ElementType> = {
  TURNSTILE: Shield,
  CAPTCHA: Image,
  OTP: Key,
  DOCUMENT_CLARIFICATION: FileQuestion,
  MANUAL_REVIEW: Eye,
  CUSTOM_INPUT: Keyboard,
};

export default function HistoryPage() {
  const { user } = useAuthStore();
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: historyData, isLoading } = useQuery({
    queryKey: ["task-history", user?.id],
    queryFn: () => staffApi.getMyHistory(user?.id || "", { limit: "100" }),
    enabled: !!user?.id,
  });

  const filteredTasks = historyData?.items?.filter((task) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      task.id.toLowerCase().includes(query) ||
      task.job_id.toLowerCase().includes(query) ||
      task.type?.toLowerCase().includes(query) ||
      task.resolution?.value.toLowerCase().includes(query)
    );
  });

  const getStatusBadge = (task: HitlTask) => {
    if (task.status === "RESOLVED") {
      return <Badge variant="success">Resolved</Badge>;
    }
    if (task.status === "EXPIRED") {
      return <Badge variant="destructive">Expired</Badge>;
    }
    if (task.status === "CANCELLED") {
      return <Badge variant="secondary">Cancelled</Badge>;
    }
    return <Badge variant="outline">{task.status}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Task History</h1>
        <p className="text-gray-500 dark:text-gray-400">
          View your completed and resolved tasks
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by task ID, job ID, or type..."
          className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
        />
      </div>

      {/* Stats Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {historyData?.items?.filter((t) => t.status === "RESOLVED").length || 0}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Resolved</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {historyData?.items?.filter((t) => t.status === "EXPIRED").length || 0}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Expired</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <HistoryIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {historyData?.total || 0}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* History List */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          Loading history...
        </div>
      ) : filteredTasks && filteredTasks.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-200 dark:divide-slate-700">
              {filteredTasks.map((task) => {
                const Icon = task.type ? TASK_TYPE_ICONS[task.type] : FileQuestion;
                const isExpanded = expandedTask === task.id;

                return (
                  <div key={task.id} className="p-4">
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-gray-100 dark:bg-slate-800">
                          <Icon className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 dark:text-white">
                              {task.type || "Unknown"}
                            </span>
                            {getStatusBadge(task)}
                          </div>
                          <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                            <span>{formatDate(task.resolved_at || task.created_at)}</span>
                            <span className="font-mono text-xs">
                              {task.job_id.slice(0, 8)}...
                            </span>
                          </div>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 ml-12 p-4 bg-gray-50 dark:bg-slate-800 rounded-lg space-y-3">
                        <div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Task ID
                          </p>
                          <code className="text-sm text-gray-900 dark:text-white">
                            {task.id}
                          </code>
                        </div>
                        {task.context?.prompt && (
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                              Prompt
                            </p>
                            <p className="text-sm text-gray-700 dark:text-gray-300">
                              {task.context.prompt}
                            </p>
                          </div>
                        )}
                        {task.resolution && (
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                              Resolution
                            </p>
                            <p className="text-sm text-gray-900 dark:text-white font-mono">
                              {task.resolution.value}
                            </p>
                            {task.resolution.notes && (
                              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                Notes: {task.resolution.notes}
                              </p>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                          <span>Created: {formatDate(task.created_at)}</span>
                          {task.resolved_at && (
                            <span>Resolved: {formatDate(task.resolved_at)}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <HistoryIcon className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No history yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Your completed tasks will appear here.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
