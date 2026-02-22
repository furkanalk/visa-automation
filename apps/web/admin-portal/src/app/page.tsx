"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cpApi, type Job } from "@/lib/api";
import { Bot, Briefcase, Globe, Activity, RefreshCw } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const HISTORY_PERIODS = ["24h", "3d", "7d"] as const;
type HistoryPeriod = (typeof HISTORY_PERIODS)[number];

function formatAxisTime(iso: string, period: string) {
  const d = new Date(iso);
  if (period === "24h") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Dashboard() {
  const [historyPeriodActivity, setHistoryPeriodActivity] = useState<HistoryPeriod>("7d");
  const [historyPeriodJobStatus, setHistoryPeriodJobStatus] = useState<HistoryPeriod>("7d");
  const queryClient = useQueryClient();

  const { data: systemStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["system-status"],
    queryFn: () => cpApi.getSystemStatus(),
    retry: false,
  });

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: () => cpApi.getAgents(),
    retry: false,
  });

  const { data: jobs } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => cpApi.getJobs({ limit: "5", exclude_slot_check: "true" }),
    retry: false,
  });

  const { data: historyActivity, isLoading: historyActivityLoading } = useQuery({
    queryKey: ["dashboard-history", "activity", historyPeriodActivity],
    queryFn: () => cpApi.getDashboardHistory(historyPeriodActivity),
    retry: false,
    refetchInterval: 5 * 60 * 1000, // 5 min
  });

  const { data: historyJobStatus, isLoading: historyJobStatusLoading } = useQuery({
    queryKey: ["dashboard-history", "job-status", historyPeriodJobStatus],
    queryFn: () => cpApi.getDashboardHistory(historyPeriodJobStatus),
    retry: false,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: liveness, isLoading: livenessLoading } = useQuery({
    queryKey: ["portal-liveness"],
    queryFn: () => cpApi.getPortalLiveness(),
    retry: false,
    refetchInterval: 60 * 1000, // 1 min
  });

  const isRefreshing = Boolean(
    statusLoading ||
    historyActivityLoading ||
    historyJobStatusLoading ||
    livenessLoading ||
    queryClient.isFetching({ queryKey: ["system-status"] }) ||
    queryClient.isFetching({ queryKey: ["agents"] }) ||
    queryClient.isFetching({ queryKey: ["jobs"] }) ||
    queryClient.isFetching({ queryKey: ["dashboard-history"] }) ||
    queryClient.isFetching({ queryKey: ["portal-liveness"] })
  );

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["system-status"] });
    void queryClient.invalidateQueries({ queryKey: ["agents"] });
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard-history"] });
    void queryClient.invalidateQueries({ queryKey: ["portal-liveness"] });
  };

  const stats = [
    {
      name: "Total Agents",
      value: agents?.total ?? 0,
      icon: Bot,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-100 dark:bg-blue-900/30",
      description: `${agents?.items?.filter((a) => a.status === "ONLINE").length ?? 0} online`,
    },
    {
      name: "Active Jobs",
      value: systemStatus?.job_stats?.active ?? 0,
      icon: Briefcase,
      iconColor: "text-violet-500",
      iconBg: "bg-violet-100 dark:bg-violet-900/30",
      description: `${systemStatus?.job_stats?.completed ?? 0} completed`,
    },
    {
      name: "Portals",
      value: liveness?.items?.length ?? 0,
      icon: Globe,
      iconColor: "text-emerald-500",
      iconBg: "bg-emerald-100 dark:bg-emerald-900/30",
      description: livenessLoading
        ? "Checking…"
        : liveness?.items?.length
          ? `${liveness.items.filter((p) => p.status === "up").length} up`
          : "No portals",
    },
    {
      name: "System Health",
      value: (() => {
        if (statusLoading) return "...";
        const ram = systemStatus?.memory_percent ?? 0;
        if (ram >= 98) return "Critical";
        if (ram >= 90) return "Degraded";
        return "Healthy";
      })(),
      icon: Activity,
      iconColor: "text-amber-500",
      iconBg: "bg-amber-100 dark:bg-amber-900/30",
      description: (() => {
        const s = systemStatus?.uptime_seconds ?? 0;
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ram = systemStatus?.memory_percent != null ? ` · RAM: ${systemStatus.memory_percent}%` : "";
        const load = systemStatus?.load_1m != null ? ` · Load: ${systemStatus.load_1m}` : "";
        return `Uptime: ${h}h ${m}m${ram}${load}`;
      })(),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          <p className="text-gray-500 dark:text-gray-400">Overview of your visa automation system</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="shrink-0"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.name}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {stat.name}
              </CardTitle>
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${stat.iconBg}`}>
                <stat.icon className={`h-7 w-7 ${stat.iconColor}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</div>
              {stat.description != null && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{stat.description}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Agent & job activity graph */}
      <Card className="min-w-0">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Agent & job activity</CardTitle>
            <select
              className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              value={historyPeriodActivity}
              onChange={(e) => setHistoryPeriodActivity(e.target.value as HistoryPeriod)}
            >
              {HISTORY_PERIODS.map((p) => (
                <option key={p} value={p}>
                  Last {p === "24h" ? "24 hours" : p === "3d" ? "3 days" : "7 days"}
                </option>
              ))}
            </select>
          </CardHeader>
          <CardContent>
            {historyActivityLoading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            ) : !historyActivity?.points?.length ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No history yet. Data is recorded every 5 minutes.</p>
            ) : (
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={historyActivity.points.map((p) => ({
                      ...p,
                      time: formatAxisTime(p.timestamp, historyActivity.period),
                    }))}
                    margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-slate-700" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} className="text-gray-500 dark:text-slate-400" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} className="text-gray-500 dark:text-slate-400" />
                    <Tooltip
                      contentStyle={{
                        borderRadius: "6px",
                        backgroundColor: "var(--chart-tooltip-bg, #1e293b)",
                        border: "1px solid var(--chart-tooltip-border, #334155)",
                        color: "var(--chart-tooltip-text, #f1f5f9)",
                      }}
                      labelStyle={{ color: "var(--chart-tooltip-text, #f1f5f9)" }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="online_agents" name="Online agents" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="active_jobs" name="Active jobs" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

      {/* Job status over time (completed / failed / cancelled) */}
      {!historyJobStatusLoading && historyJobStatus?.points?.length ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Job status</CardTitle>
            <select
              className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              value={historyPeriodJobStatus}
              onChange={(e) => setHistoryPeriodJobStatus(e.target.value as HistoryPeriod)}
            >
              {HISTORY_PERIODS.map((p) => (
                <option key={p} value={p}>
                  Last {p === "24h" ? "24 hours" : p === "3d" ? "3 days" : "7 days"}
                </option>
              ))}
            </select>
          </CardHeader>
          <CardContent>
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={historyJobStatus.points.map((p) => ({
                    ...p,
                    time: formatAxisTime(p.timestamp, historyJobStatus.period),
                  }))}
                  margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-slate-700" />
                  <XAxis dataKey="time" tick={{ fontSize: 11 }} className="text-gray-500 dark:text-slate-400" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} className="text-gray-500 dark:text-slate-400" />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "6px",
                      backgroundColor: "var(--chart-tooltip-bg, #1e293b)",
                      border: "1px solid var(--chart-tooltip-border, #334155)",
                      color: "var(--chart-tooltip-text, #f1f5f9)",
                    }}
                    labelStyle={{ color: "var(--chart-tooltip-text, #f1f5f9)" }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="completed_jobs" name="Completed" stroke="#22c55e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="failed_jobs" name="Failed" stroke="#ef4444" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="cancelled_jobs" name="Cancelled" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Agents</CardTitle>
          </CardHeader>
          <CardContent>
            {agents?.items?.slice(0, 5).map((agent) => (
              <div
                key={agent.id}
                className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-slate-700 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div className="text-2xl">🤖</div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{agent.name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{agent.mode}</p>
                  </div>
                </div>
                <Badge
                  variant={agent.status === "ONLINE" ? "success" : "secondary"}
                >
                  {agent.status}
                </Badge>
              </div>
            )) ?? (
              <p className="text-gray-500 dark:text-gray-400 text-sm">No agents found</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {jobs?.items && jobs.items.length > 0 ? (
              jobs.items.slice(0, 5).map((job: Job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-slate-700 last:border-0"
                >
                  <div>
                    <p className="font-medium font-mono text-sm text-gray-900 dark:text-white">
                      {job.id.slice(0, 8)}...
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{job.visa_type}</p>
                  </div>
                  <Badge
                    variant={
                      job.status === "COMPLETED"
                        ? "success"
                        : job.status === "FAILED_TERMINAL"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {job.status}
                  </Badge>
                </div>
              ))
            ) : (
              <p className="text-gray-500 dark:text-gray-400 text-sm">No jobs yet</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
