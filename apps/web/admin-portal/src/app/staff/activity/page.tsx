"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { staffApi, type StaffActivityLog, type StaffLeaderboardEntry } from "@/lib/api";
import {
  Activity,
  Search,
  RefreshCw,
  Calendar,
  Trophy,
  TrendingUp,
  Clock,
  CheckCircle,
  Loader2,
  AlertCircle,
  User,
  LogIn,
  LogOut,
  ClipboardCheck,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Medal,
} from "lucide-react";

const ACTION_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  login: { label: "Login", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: <LogIn className="h-3 w-3" /> },
  logout: { label: "Logout", color: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400", icon: <LogOut className="h-3 w-3" /> },
  task_assigned: { label: "Task Assigned", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: <User className="h-3 w-3" /> },
  task_resolved: { label: "Task Resolved", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: <CheckCircle className="h-3 w-3" /> },
  task_escalated: { label: "Escalated", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", icon: <AlertTriangle className="h-3 w-3" /> },
  task_expired: { label: "Expired", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: <Clock className="h-3 w-3" /> },
  customer_viewed: { label: "Customer Viewed", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", icon: <User className="h-3 w-3" /> },
};

export default function StaffActivityPage() {
  const [staffIdFilter, setStaffIdFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [page, setPage] = useState(0);
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<'today' | 'week' | 'month' | 'all'>('week');
  const pageSize = 25;

  const { data: activityData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["staff-activity", staffIdFilter, actionFilter, page],
    queryFn: () => staffApi.getActivityLog({
      staff_id: staffIdFilter || undefined,
      action: actionFilter || undefined,
      limit: pageSize,
      offset: page * pageSize,
    }),
  });

  const { data: leaderboard, isLoading: leaderboardLoading } = useQuery({
    queryKey: ["staff-leaderboard", leaderboardPeriod],
    queryFn: () => staffApi.getLeaderboard(leaderboardPeriod),
  });

  const { data: dashboardStats } = useQuery({
    queryKey: ["staff-dashboard"],
    queryFn: () => staffApi.getDashboardStats(),
  });

  const totalPages = Math.ceil((activityData?.total || 0) / pageSize);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getMedalColor = (index: number) => {
    if (index === 0) return "text-yellow-500";
    if (index === 1) return "text-gray-400";
    if (index === 2) return "text-orange-600";
    return "text-gray-300";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Staff Activity</h1>
          <p className="text-gray-500 dark:text-gray-400">
            Monitor staff performance and activity
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Activity Feed */}
        <div className="lg:col-span-2 space-y-6">
          {/* Stats Overview */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-blue-500" />
                  <div>
                    <p className="text-xl font-bold">{dashboardStats?.onlineNow ?? 0}</p>
                    <p className="text-xs text-gray-500">Online Now</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-green-500" />
                  <div>
                    <p className="text-xl font-bold">{dashboardStats?.tasksToday ?? 0}</p>
                    <p className="text-xs text-gray-500">Tasks Today</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-purple-500" />
                  <div>
                    <p className="text-xl font-bold">{dashboardStats?.avgResolutionTime ?? 'N/A'}</p>
                    <p className="text-xs text-gray-500">Avg Time</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-orange-500" />
                  <div>
                    <p className="text-xl font-bold">{dashboardStats?.activeStaff ?? 0}</p>
                    <p className="text-xs text-gray-500">Active Staff</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-[200px]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Filter by Staff ID..."
                      value={staffIdFilter}
                      onChange={(e) => { setStaffIdFilter(e.target.value); setPage(0); }}
                      className="pl-10 border-transparent bg-blue-50 dark:bg-slate-700 shadow-sm focus:shadow-md focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                </div>
                <select
                  className="px-4 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 outline-none cursor-pointer transition-all duration-200"
                  value={actionFilter}
                  onChange={(e) => { setActionFilter(e.target.value); setPage(0); }}
                >
                  <option value="">All Actions</option>
                  <option value="login">Login</option>
                  <option value="logout">Logout</option>
                  <option value="task_assigned">Task Assigned</option>
                  <option value="task_resolved">Task Resolved</option>
                  <option value="task_escalated">Escalated</option>
                  <option value="task_expired">Expired</option>
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Activity Log */}
          {isLoading ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Loading activity...</p>
              </CardContent>
            </Card>
          ) : isError ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
                <p className="text-gray-500 dark:text-gray-400 font-medium">Failed to load activity</p>
                <p className="text-sm text-gray-400 mt-1">
                  {error instanceof Error ? error.message : "API server may be unavailable"}
                </p>
                <Button variant="outline" onClick={() => refetch()} className="mt-4">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
              </CardContent>
            </Card>
          ) : !activityData?.items.length ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Activity className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-4" />
                <p className="text-gray-500 dark:text-gray-400 font-medium">No activity found</p>
                <p className="text-sm text-gray-400 mt-1">
                  {staffIdFilter || actionFilter ? "Try adjusting your filters" : "Staff activity will appear here"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-100 dark:divide-slate-700">
                  {activityData.items.map((activity) => {
                    const config = ACTION_CONFIG[activity.action] || {
                      label: activity.action,
                      color: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400",
                      icon: <Activity className="h-3 w-3" />,
                    };
                    
                    return (
                      <div key={activity.id} className="p-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${config.color}`}>
                              {config.icon}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${config.color}`}>
                                  {config.label}
                                </span>
                                {activity.resource_type && (
                                  <span className="text-xs text-gray-500">
                                    on {activity.resource_type}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                Staff ID: {activity.staff_id.slice(0, 8)}...
                              </p>
                              {Boolean((activity.details as Record<string, unknown>)?.task_type) && (
                                <p className="text-xs text-gray-400 mt-0.5">
                                  Task type: {String((activity.details as Record<string, unknown>).task_type)}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              {formatTime(activity.created_at)}
                            </p>
                            {Boolean((activity.details as Record<string, unknown>)?.resolution_time_ms) && (
                              <p className="text-xs text-green-600">
                                {Math.round(Number((activity.details as Record<string, unknown>).resolution_time_ms) / 1000)}s resolution
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, activityData?.total || 0)} of {activityData?.total || 0}
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
        </div>

        {/* Leaderboard Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  Leaderboard
                </CardTitle>
                <select
                  className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-slate-700 border-none"
                  value={leaderboardPeriod}
                  onChange={(e) => setLeaderboardPeriod(e.target.value as typeof leaderboardPeriod)}
                >
                  <option value="today">Today</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="all">All Time</option>
                </select>
              </div>
            </CardHeader>
            <CardContent>
              {leaderboardLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : !leaderboard?.length ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <Trophy className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No data yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {leaderboard.map((entry, index) => (
                    <div
                      key={entry.staffId}
                      className={`flex items-center gap-3 p-3 rounded-lg ${
                        index === 0
                          ? 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'
                          : 'bg-gray-50 dark:bg-slate-800'
                      }`}
                    >
                      <div className={`font-bold text-lg ${getMedalColor(index)}`}>
                        {index < 3 ? <Medal className="h-6 w-6" /> : `#${index + 1}`}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">
                          {entry.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {entry.resolved} tasks resolved
                        </p>
                      </div>
                      {entry.avgTime > 0 && (
                        <div className="text-right">
                          <p className="text-xs text-gray-500">
                            {Math.round(entry.avgTime / 1000)}s avg
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-500" />
                Quick Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-500 dark:text-gray-400">Total Staff</span>
                <span className="font-medium">{dashboardStats?.totalStaff ?? 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 dark:text-gray-400">Active Staff</span>
                <span className="font-medium text-green-600">{dashboardStats?.activeStaff ?? 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 dark:text-gray-400">Online Now</span>
                <span className="font-medium text-blue-600">{dashboardStats?.onlineNow ?? 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 dark:text-gray-400">Tasks Today</span>
                <span className="font-medium text-purple-600">{dashboardStats?.tasksToday ?? 0}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
