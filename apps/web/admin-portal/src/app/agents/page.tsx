"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAgents, useCreateAgent, useUpdateAgent, useDeleteAgent } from "@/hooks/use-agents";
import { cpApi, type Agent } from "@/lib/api";
import { AgentModal } from "@/components/agents/agent-modal";
import { AgentSwimlanes } from "@/components/agents/agent-swimlanes";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SaveBanner } from "@/components/ui/save-banner";
import { Bot, Plus, RefreshCw, Trash2, Power, PowerOff, Settings2, CheckSquare, Square, Layers, Loader2, Edit, AlertCircle, LayoutGrid, Columns, ChevronDown, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

type ViewMode = "grid" | "swimlanes";

// FSM States with colors and labels
const FSM_STATES: Record<string, { label: string; color: string; bgColor: string }> = {
  QUEUED: { label: "Queued", color: "text-gray-600", bgColor: "bg-gray-100 dark:bg-gray-800" },
  LOGIN_PROCESS: { label: "Logging In", color: "text-blue-600", bgColor: "bg-blue-100 dark:bg-blue-900/30" },
  LOGGED_IN: { label: "Logged In", color: "text-blue-600", bgColor: "bg-blue-100 dark:bg-blue-900/30" },
  FORM_FILLING: { label: "Filling Form", color: "text-purple-600", bgColor: "bg-purple-100 dark:bg-purple-900/30" },
  PROCESSING: { label: "Processing", color: "text-indigo-600", bgColor: "bg-indigo-100 dark:bg-indigo-900/30" },
  SLOT_SEARCHING: { label: "Searching Slots", color: "text-orange-600", bgColor: "bg-orange-100 dark:bg-orange-900/30" },
  SLOT_FOUND: { label: "Slot Found!", color: "text-green-600", bgColor: "bg-green-100 dark:bg-green-900/30" },
  WAITING_SLOT: { label: "Waiting Slot", color: "text-yellow-600", bgColor: "bg-yellow-100 dark:bg-yellow-900/30" },
  WAITING_HITL: { label: "Needs Human", color: "text-red-600", bgColor: "bg-red-100 dark:bg-red-900/30" },
  COMPLETED: { label: "Completed", color: "text-green-600", bgColor: "bg-green-100 dark:bg-green-900/30" },
  CANCELLED: { label: "Cancelled", color: "text-gray-500", bgColor: "bg-gray-100 dark:bg-gray-800" },
  FAILED_RETRYABLE: { label: "Failed (Retry)", color: "text-orange-600", bgColor: "bg-orange-100 dark:bg-orange-900/30" },
  FAILED_TERMINAL: { label: "Failed", color: "text-red-600", bgColor: "bg-red-100 dark:bg-red-900/30" },
};

// Status dot: ONLINE = green, DRAINING = yellow, OFFLINE = gray (OFFLINE = disabled)
function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full",
        status === "ONLINE" && "bg-green-500 animate-pulse",
        status === "DRAINING" && "bg-yellow-500",
        (status === "OFFLINE" || status === "DISABLED") && "bg-gray-400"
      )}
    />
  );
}

// FSM State Badge component
function FSMStateBadge({ state, isLoading }: { state?: string; isLoading?: boolean }) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading...
      </div>
    );
  }
  
  if (!state) return null;
  
  const stateInfo = FSM_STATES[state] || { label: state, color: "text-gray-600", bgColor: "bg-gray-100" };
  
  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium",
      stateInfo.bgColor,
      stateInfo.color
    )}>
      <span className={cn(
        "h-1.5 w-1.5 rounded-full animate-pulse",
        state === "SLOT_SEARCHING" && "bg-orange-500",
        state === "SLOT_FOUND" && "bg-green-500",
        state === "WAITING_HITL" && "bg-red-500",
        state === "PROCESSING" && "bg-indigo-500",
        state === "LOGIN_PROCESS" && "bg-blue-500",
        !["SLOT_SEARCHING", "SLOT_FOUND", "WAITING_HITL", "PROCESSING", "LOGIN_PROCESS"].includes(state) && "bg-gray-500"
      )} />
      {stateInfo.label}
    </div>
  );
}

export default function AgentsPage() {
  const [filter, setFilter] = useState<string>("");
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [bulkProfileDropdown, setBulkProfileDropdown] = useState(false);
  const [bulkStatusDropdown, setBulkStatusDropdown] = useState(false);
  const [bulkPortalDropdown, setBulkPortalDropdown] = useState(false);
  const [agentToDeleteId, setAgentToDeleteId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const showBanner = (type: "success" | "error", text: string) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 5000);
  };
  const { data: agents, isLoading, isError, error, refetch } = useAgents();
  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => cpApi.getProfiles(),
  });
  const { data: portals } = useQuery({
    queryKey: ["portals"],
    queryFn: () => cpApi.getPortals(),
  });
  
  // Fetch job statuses for agents with current jobs (using batch endpoint for performance)
  const agentJobIds = agents?.items?.filter(a => a.current_job_id).map(a => a.current_job_id!) ?? [];
  const { data: jobStatuses } = useQuery({
    queryKey: ["job-statuses", agentJobIds],
    queryFn: async () => {
      // Use batch endpoint instead of individual calls for better performance
      const statuses = await cpApi.batchGetJobStatuses(agentJobIds);
      // Filter out null values and return as Record<string, string>
      const result: Record<string, string> = {};
      for (const [jobId, status] of Object.entries(statuses)) {
        if (status) {
          result[jobId] = status;
        }
      }
      return result;
    },
    enabled: agentJobIds.length > 0,
    refetchInterval: 5000, // Poll every 5 seconds for live updates
  });
  
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();

  const filteredAgents = agents?.items?.filter(
    (agent) =>
      agent.name.toLowerCase().includes(filter.toLowerCase()) ||
      agent.mode.toLowerCase().includes(filter.toLowerCase())
  );

  const asyncCount = agents?.items?.filter((a) => a.mode === "ASYNC").length ?? 0;
  const syncCount = agents?.items?.filter((a) => a.mode === "SYNC").length ?? 0;
  const onlineCount = agents?.items?.filter((a) => a.status === "ONLINE").length ?? 0;
  const busyCount = agents?.items?.filter((a) => a.current_job_id).length ?? 0;

  const handleOpenCreateModal = () => {
    setEditingAgent(null);
    setModalOpen(true);
  };

  const handleOpenEditModal = (agent: Agent) => {
    setEditingAgent(agent);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingAgent(null);
  };

  const handleSubmitAgent = async (data: {
    name: string;
    mode: "ASYNC" | "SYNC";
    status?: Agent["status"];
    profile_id: string | null;
    desired_portals: string[];
    desired_concurrency: number;
  }) => {
    try {
      if (editingAgent) {
        await updateAgent.mutateAsync({
          id: editingAgent.id,
          data: {
            name: data.name,
            mode: data.mode,
            status: data.status,
            profile_id: data.profile_id,
            desired_portals: data.desired_portals,
            desired_concurrency: data.desired_concurrency,
          },
        });
      } else {
        await createAgent.mutateAsync({
          name: data.name,
          mode: data.mode,
          profile_id: data.profile_id || undefined,
          desired_portals: data.desired_portals,
          desired_concurrency: data.desired_concurrency,
        });
      }
      showBanner("success", "Saved.");
      handleCloseModal();
    } catch (err) {
      showBanner("error", err instanceof Error ? err.message : "Failed to save.");
    }
  };

  const handleToggleStatus = async (agent: Agent) => {
    const newStatus = agent.status === "ONLINE" ? "OFFLINE" : "ONLINE";
    await updateAgent.mutateAsync({ id: agent.id, data: { status: newStatus } });
  };

  const handleDeleteClick = (id: string) => {
    setAgentToDeleteId(id);
  };

  const handleDeleteConfirm = async () => {
    if (!agentToDeleteId) return;
    try {
      await deleteAgent.mutateAsync(agentToDeleteId);
      setSelectedAgents((prev) => {
        const next = new Set(prev);
        next.delete(agentToDeleteId);
        return next;
      });
      setAgentToDeleteId(null);
      showBanner("success", "Deleted.");
    } catch (err) {
      showBanner("error", err instanceof Error ? err.message : "Failed to delete.");
    }
  };

  const toggleSelectAgent = (id: string) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (selectedAgents.size === (filteredAgents?.length ?? 0)) {
      setSelectedAgents(new Set());
    } else {
      setSelectedAgents(new Set(filteredAgents?.map((a) => a.id) ?? []));
    }
  };

  const handleBulkDeleteClick = () => {
    if (selectedAgents.size === 0) return;
    setBulkDeleteOpen(true);
  };

  const handleBulkDeleteConfirm = async () => {
    const ids = Array.from(selectedAgents);
    try {
      for (const id of ids) {
        await deleteAgent.mutateAsync(id);
      }
      setSelectedAgents(new Set());
      setBulkDeleteOpen(false);
      showBanner("success", "Deleted.");
    } catch (err) {
      showBanner("error", err instanceof Error ? err.message : "Failed to delete.");
    }
  };

  const handleBulkAssignProfile = async (profileId: string | null) => {
    if (selectedAgents.size === 0) return;
    
    for (const id of selectedAgents) {
      await updateAgent.mutateAsync({ id, data: { profile_id: profileId } });
    }
    setBulkProfileDropdown(false);
  };

  const handleBulkChangeStatus = async (status: Agent["status"]) => {
    if (selectedAgents.size === 0) return;
    
    for (const id of selectedAgents) {
      await updateAgent.mutateAsync({ id, data: { status } });
    }
    setBulkStatusDropdown(false);
  };

  const handleBulkAssignPortal = async (portalIds: string[]) => {
    if (selectedAgents.size === 0) return;
    
    for (const id of selectedAgents) {
      await updateAgent.mutateAsync({ id, data: { desired_portals: portalIds } });
    }
    setBulkPortalDropdown(false);
  };

  const getProfileName = (profileId: string | null): string | null => {
    if (!profileId) return null;
    return profiles?.items?.find((p) => p.id === profileId)?.name ?? null;
  };

  const getJobState = (jobId: string | null) => {
    if (!jobId) return undefined;
    return jobStatuses?.[jobId];
  };

  const handleMoveAgent = async (agentId: string, newPortals: string[]) => {
    await updateAgent.mutateAsync({
      id: agentId,
      data: { desired_portals: newPortals },
    });
  };

  return (
    <div className="space-y-6">
      <SaveBanner message={banner} onDismiss={() => setBanner(null)} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Agents</h1>
          <p className="text-gray-500 dark:text-gray-400">Manage your worker agents</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex items-center bg-gray-100 dark:bg-slate-800 rounded-lg p-1">
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "p-2 rounded-md transition-colors",
                viewMode === "grid"
                  ? "bg-white dark:bg-slate-700 shadow-sm"
                  : "hover:bg-gray-200 dark:hover:bg-slate-700"
              )}
              title="Grid View"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("swimlanes")}
              className={cn(
                "p-2 rounded-md transition-colors",
                viewMode === "swimlanes"
                  ? "bg-white dark:bg-slate-700 shadow-sm"
                  : "hover:bg-gray-200 dark:hover:bg-slate-700"
              )}
              title="Swimlanes View"
            >
              <Columns className="h-4 w-4" />
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button size="sm" onClick={handleOpenCreateModal}>
            <Plus className="h-4 w-4 mr-1" />
            Create Agent
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{agents?.total ?? 0}</div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Total Agents</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <StatusDot status="ONLINE" />
              <span className="text-2xl font-bold text-green-600 dark:text-green-400">{onlineCount}</span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Online</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{busyCount}</div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Busy (Running Jobs)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{asyncCount}</div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Async Agents</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{syncCount}</div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Sync Agents</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Bulk Actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1">
          <Input
            placeholder="Filter agents..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-sm"
          />
          <button
            onClick={selectAll}
            className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            {selectedAgents.size === (filteredAgents?.length ?? 0) && filteredAgents?.length ? (
              <CheckSquare className="h-4 w-4" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            Select All
          </button>
        </div>
        {selectedAgents.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {selectedAgents.size} selected
            </span>

            {/* Bulk Assign Profile */}
            <div className="relative">
              <Button size="sm" variant="outline" onClick={() => { setBulkProfileDropdown(!bulkProfileDropdown); setBulkStatusDropdown(false); setBulkPortalDropdown(false); }}>
                <Layers className="h-4 w-4 mr-1" />
                Profile
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
              {bulkProfileDropdown && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setBulkProfileDropdown(false)} />
                  <div className="absolute right-0 mt-1 w-56 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 py-1 z-20 max-h-64 overflow-y-auto">
                    <button
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-500"
                      onClick={() => handleBulkAssignProfile(null)}
                    >
                      No Profile
                    </button>
                    {profiles?.items?.map((profile) => (
                      <button
                        key={profile.id}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
                        onClick={() => handleBulkAssignProfile(profile.id)}
                      >
                        <Settings2 className="h-4 w-4 text-gray-400" />
                        {profile.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Bulk Change Status */}
            <div className="relative">
              <Button size="sm" variant="outline" onClick={() => { setBulkStatusDropdown(!bulkStatusDropdown); setBulkProfileDropdown(false); setBulkPortalDropdown(false); }}>
                <Power className="h-4 w-4 mr-1" />
                Status
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
              {bulkStatusDropdown && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setBulkStatusDropdown(false)} />
                  <div className="absolute right-0 mt-1 w-44 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 py-1 z-20">
                    <button
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 text-green-600"
                      onClick={() => handleBulkChangeStatus("ONLINE")}
                    >
                      <Power className="h-4 w-4" />
                      Enable All
                    </button>
                    <button
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 text-gray-500"
                      onClick={() => handleBulkChangeStatus("OFFLINE")}
                    >
                      <PowerOff className="h-4 w-4" />
                      Disable All
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Bulk Assign Portal */}
            <div className="relative">
              <Button size="sm" variant="outline" onClick={() => { setBulkPortalDropdown(!bulkPortalDropdown); setBulkProfileDropdown(false); setBulkStatusDropdown(false); }}>
                <Globe className="h-4 w-4 mr-1" />
                Portal
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
              {bulkPortalDropdown && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setBulkPortalDropdown(false)} />
                  <div className="absolute right-0 mt-1 w-56 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 py-1 z-20 max-h-64 overflow-y-auto">
                    <button
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-500"
                      onClick={() => handleBulkAssignPortal([])}
                    >
                      Any Portal
                    </button>
                    {portals?.items?.map((portal) => (
                      <button
                        key={portal.id}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
                        onClick={() => handleBulkAssignPortal([portal.id])}
                      >
                        <Globe className="h-4 w-4 text-gray-400" />
                        {portal.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Bulk Delete */}
            <Button size="sm" variant="destructive" onClick={handleBulkDeleteClick}>
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-gray-500 dark:text-gray-400">Loading agents...</p>
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">Failed to load agents</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 text-center max-w-md">
              {error instanceof Error ? error.message : "API server may be unavailable"}
            </p>
            <Button variant="outline" onClick={() => refetch()} className="mt-4">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : viewMode === "swimlanes" && portals?.items ? (
        <AgentSwimlanes
          agents={filteredAgents || []}
          portals={portals.items}
          jobStatuses={jobStatuses}
          getProfileName={getProfileName}
          onEditAgent={handleOpenEditModal}
          onToggleStatus={handleToggleStatus}
          onDeleteAgent={handleDeleteClick}
          onMoveAgent={handleMoveAgent}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredAgents?.map((agent) => {
            const jobState = getJobState(agent.current_job_id);
            
            return (
              <Card
                key={agent.id}
                className={cn(
                  "relative cursor-pointer transition-all duration-200",
                  selectedAgents.has(agent.id) && "ring-2 ring-primary",
                  agent.current_job_id && "border-l-4 border-l-blue-500"
                )}
              >
                {/* Checkbox */}
                <button
                  onClick={() => toggleSelectAgent(agent.id)}
                  className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  {selectedAgents.has(agent.id) ? (
                    <CheckSquare className="h-5 w-5 text-primary" />
                  ) : (
                    <Square className="h-5 w-5" />
                  )}
                </button>

                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">🤖</span>
                    <div>
                      <CardTitle className="text-base text-gray-900 dark:text-white flex items-center gap-2">
                        {agent.name}
                        <StatusDot status={agent.status} />
                      </CardTitle>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span
                          className={
                            "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold " +
                            (agent.mode === "ASYNC"
                              ? "border-purple-400 bg-purple-100 text-purple-800 dark:border-purple-600 dark:bg-purple-900/40 dark:text-purple-300"
                              : "border-blue-400 bg-blue-100 text-blue-800 dark:border-blue-600 dark:bg-blue-900/40 dark:text-blue-300")
                          }
                        >
                          {agent.mode}
                        </span>
                        <Badge
                          variant={
                            agent.status === "ONLINE"
                              ? "success"
                              : agent.status === "DRAINING"
                              ? "warning"
                              : "secondary"
                          }
                        >
                          {agent.status === "ONLINE"
                            ? "Online"
                            : agent.status === "DRAINING"
                            ? "Draining"
                            : "Offline"}
                        </Badge>
                        {/* Profile: always show which profile the agent uses */}
                        <Badge variant="outline" className="flex items-center gap-1">
                          <Settings2 className="h-3 w-3" />
                          {getProfileName(agent.profile_id) ?? "Default"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* FSM State Display */}
                  {agent.current_job_id && (
                    <div className="mb-3 p-2 rounded-lg bg-gray-50 dark:bg-slate-800/50">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Current Job State</span>
                        <FSMStateBadge state={jobState} isLoading={!jobStatuses && agentJobIds.length > 0} />
                      </div>
                      <p className="text-xs font-mono text-gray-400 mt-1">
                        {agent.current_job_id.slice(0, 12)}...
                      </p>
                    </div>
                  )}
                  
                  <div className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
                    <div className="flex justify-between">
                      <span>Concurrency</span>
                      <span className="font-medium text-gray-900 dark:text-white">{agent.desired_concurrency}</span>
                    </div>
                    <div className="flex justify-between items-start gap-2">
                      <span>Portals</span>
                      <span className="font-medium text-gray-900 dark:text-white text-right min-w-0 flex-1 truncate">
                        {(() => {
                          const ids = Array.isArray(agent.desired_portals) ? agent.desired_portals : [];
                          if (ids.length === 0) return "Any";
                          const names = ids.map((pid) => portals?.items?.find((p) => p.portal_id === pid)?.name ?? pid).filter(Boolean);
                          const fullText = names.join(", ") || "—";
                          const maxVisible = 2;
                          if (names.length <= maxVisible) return fullText;
                          const visible = names.slice(0, maxVisible).join(", ");
                          const rest = names.length - maxVisible;
                          return (
                            <span title={fullText} className="cursor-help">
                              {visible} <span className="text-gray-500 dark:text-gray-400">+{rest}</span>
                            </span>
                          );
                        })()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Last Heartbeat</span>
                      <span className="text-gray-900 dark:text-white">
                        {agent.last_heartbeat_at
                          ? new Date(agent.last_heartbeat_at).toLocaleTimeString()
                          : "None"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-slate-700">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenEditModal(agent)}
                    >
                      <Edit className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleToggleStatus(agent)}
                      disabled={agent.current_job_id !== null}
                    >
                      {agent.status === "ONLINE" ? (
                        <>
                          <PowerOff className="h-3 w-3 mr-1" />
                          Disable
                        </>
                      ) : (
                        <>
                          <Power className="h-3 w-3 mr-1" />
                          Enable
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDeleteClick(agent.id)}
                      disabled={agent.current_job_id !== null}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!isLoading && filteredAgents?.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Bot className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No agents found</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 mb-4">
              {filter 
                ? "Try adjusting your search query" 
                : "Create an agent to start processing visa applications"}
            </p>
            <Button onClick={handleOpenCreateModal}>
              <Plus className="h-4 w-4 mr-2" />
              Create Agent
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Agent Modal */}
      <AgentModal
        open={modalOpen}
        onClose={handleCloseModal}
        onSubmit={handleSubmitAgent}
        agent={editingAgent}
        isSubmitting={createAgent.isPending || updateAgent.isPending}
      />

      <ConfirmDialog
        open={agentToDeleteId !== null}
        onClose={() => setAgentToDeleteId(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete agent"
        message="Are you sure you want to delete this agent?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        isLoading={deleteAgent.isPending}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDeleteConfirm}
        title="Delete agents"
        message={`Delete ${selectedAgents.size} selected agent(s)?`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        isLoading={deleteAgent.isPending}
      />
    </div>
  );
}
