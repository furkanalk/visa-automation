"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cpApi, type Job } from "@/lib/api";
import { Bot, Briefcase, Globe, Activity } from "lucide-react";

export default function Dashboard() {
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
    queryFn: () => cpApi.getJobs({ limit: "5" }),
    retry: false,
  });

  const stats = [
    {
      name: "Total Agents",
      value: agents?.total ?? 0,
      icon: Bot,
      description: `${agents?.items?.filter((a) => a.status === "ONLINE").length ?? 0} online`,
    },
    {
      name: "Active Jobs",
      value: systemStatus?.job_stats?.active ?? 0,
      icon: Briefcase,
      description: `${systemStatus?.job_stats?.completed ?? 0} completed`,
    },
    {
      name: "Portals",
      value: 1,
      icon: Globe,
      description: "AS-VISA configured",
    },
    {
      name: "System Health",
      value: statusLoading ? "..." : "Healthy",
      icon: Activity,
      description: `Uptime: ${Math.floor((systemStatus?.uptime_seconds ?? 0) / 3600)}h`,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-gray-500 dark:text-gray-400">Overview of your visa automation system</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.name}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {stat.name}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-gray-400 dark:text-gray-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

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
            {jobs?.items?.slice(0, 5).map((job: Job) => (
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
            )) ?? (
              <p className="text-gray-500 dark:text-gray-400 text-sm">No jobs found</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
