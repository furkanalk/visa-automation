"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Agent, PortalConfig } from "@/lib/api";
import {
  Bot,
  Globe,
  Power,
  PowerOff,
  Settings,
  ChevronRight,
  Loader2,
  MoreVertical,
  Edit,
  Trash2,
  ArrowRight,
  StopCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AgentSwimlanesProps {
  agents: Agent[];
  portals: PortalConfig[];
  jobStatuses?: Record<string, string>;
  getProfileName?: (profileId: string | null) => string | null;
  onEditAgent: (agent: Agent) => void;
  onToggleStatus: (agent: Agent) => void;
  onForceStop?: (agent: Agent) => void;
  onDeleteAgent: (id: string) => void;
  onMoveAgent: (agentId: string, newPortals: string[]) => void;
}

// Status dot: ONLINE = green, DRAINING = yellow, OFFLINE/DISABLED = gray
function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        status === "ONLINE" && "bg-green-500",
        status === "DRAINING" && "bg-yellow-500",
        (status === "OFFLINE" || status === "DISABLED") && "bg-gray-400"
      )}
    />
  );
}

// Mini agent card for swimlane
function AgentCard({
  agent,
  jobStatus,
  profileName,
  onEdit,
  onToggle,
  onForceStop,
  onDelete,
  onMove,
  allPortals,
}: {
  agent: Agent;
  jobStatus?: string;
  profileName?: string | null;
  onEdit: () => void;
  onToggle: () => void;
  onForceStop?: () => void;
  onDelete: () => void;
  onMove: (newPortals: string[]) => void;
  allPortals: PortalConfig[];
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  return (
    <div className="group relative bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-3 shadow-sm hover:shadow-md transition-all duration-200">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <StatusDot status={agent.status} />
              <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
                {agent.name}
              </span>
            </div>
            <div className="flex items-center gap-1 flex-wrap text-xs text-gray-500 dark:text-gray-400">
              <span className={cn(
                "px-1.5 py-0.5 rounded text-xs",
                agent.mode === "ASYNC" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
              )}>
                {agent.mode}
              </span>
              <span className="text-gray-400 dark:text-gray-500">• {profileName ?? "Default"}</span>
              {agent.current_job_id && (
                <span className="text-green-600 dark:text-green-400">• Working</span>
              )}
            </div>
          </div>
        </div>

        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => setShowMenu(!showMenu)}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>

          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => { setShowMenu(false); setShowMoveMenu(false); }} />
              <div className="absolute right-0 mt-1 w-40 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 py-1 z-20">
                <button
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
                  onClick={() => { onEdit(); setShowMenu(false); }}
                >
                  <Edit className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
                  onClick={() => { onToggle(); setShowMenu(false); }}
                >
                  {agent.status === "ONLINE" ? (
                    <>
                      <PowerOff className="h-3.5 w-3.5" />
                      Disable
                    </>
                  ) : (
                    <>
                      <Power className="h-3.5 w-3.5" />
                      Enable
                    </>
                  )}
                </button>
                {onForceStop && (agent.status === "ONLINE" || agent.status === "DRAINING") && (
                  <button
                    className="w-full px-3 py-2 text-left text-sm hover:bg-amber-50 dark:hover:bg-amber-900/20 flex items-center gap-2 text-amber-600 dark:text-amber-400"
                    onClick={() => { onForceStop(); setShowMenu(false); }}
                  >
                    <StopCircle className="h-3.5 w-3.5" />
                    Force stop
                  </button>
                )}
                <div className="relative">
                  <button
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center justify-between gap-2"
                    onClick={() => setShowMoveMenu(!showMoveMenu)}
                  >
                    <span className="flex items-center gap-2">
                      <ArrowRight className="h-3.5 w-3.5" />
                      Move to...
                    </span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>

                  {showMoveMenu && (
                    <div className="absolute left-full top-0 ml-1 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 py-1 z-30 max-h-64 overflow-y-auto">
                      {allPortals.map((portal) => {
                        const desired = Array.isArray(agent.desired_portals) ? agent.desired_portals : [];
                        const isCurrentPortal = desired.includes(portal.id);
                        return (
                          <button
                            key={portal.id}
                            className={cn(
                              "w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2",
                              isCurrentPortal && "bg-blue-50 dark:bg-blue-900/20"
                            )}
                            onClick={() => {
                              if (!isCurrentPortal) {
                                onMove([portal.id]);
                              }
                              setShowMenu(false);
                              setShowMoveMenu(false);
                            }}
                            disabled={isCurrentPortal}
                          >
                            <Globe className="h-3.5 w-3.5 text-gray-400" />
                            <span className="truncate">{portal.name}</span>
                            {isCurrentPortal && <span className="text-xs text-blue-500 ml-auto">Current</span>}
                          </button>
                        );
                      })}
                      <hr className="my-1" />
                      <button
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 text-gray-500"
                        onClick={() => {
                          onMove([]); // Clear portals (unassigned)
                          setShowMenu(false);
                          setShowMoveMenu(false);
                        }}
                      >
                        <span className="truncate">Unassigned</span>
                      </button>
                    </div>
                  )}
                </div>
                <hr className="my-1" />
                <button
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 text-red-600"
                  onClick={() => { onDelete(); setShowMenu(false); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Job status */}
      {jobStatus && (
        <div className="mt-2 text-xs">
          <span className={cn(
            "px-2 py-0.5 rounded-full",
            jobStatus === "SLOT_FOUND" && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
            jobStatus === "WAITING_HITL" && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
            jobStatus === "SLOT_SEARCHING" && "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
            !["SLOT_FOUND", "WAITING_HITL", "SLOT_SEARCHING"].includes(jobStatus) && "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400"
          )}>
            {jobStatus.replace(/_/g, ' ')}
          </span>
        </div>
      )}
    </div>
  );
}

// Portal swimlane
function PortalSwimlane({
  portal,
  agents,
  jobStatuses,
  getProfileName,
  onEditAgent,
  onToggleStatus,
  onForceStop,
  onDeleteAgent,
  onMoveAgent,
  allPortals,
}: {
  portal: PortalConfig | null;
  agents: Agent[];
  jobStatuses?: Record<string, string>;
  getProfileName?: (profileId: string | null) => string | null;
  onEditAgent: (agent: Agent) => void;
  onToggleStatus: (agent: Agent) => void;
  onForceStop?: (agent: Agent) => void;
  onDeleteAgent: (id: string) => void;
  onMoveAgent: (agentId: string, newPortals: string[]) => void;
  allPortals: PortalConfig[];
}) {
  const onlineCount = agents.filter(a => a.status === "ONLINE").length;
  const busyCount = agents.filter(a => a.current_job_id).length;

  return (
    <div className="flex flex-col min-w-[280px] max-w-[320px] bg-gray-50 dark:bg-slate-900 rounded-lg">
      {/* Swimlane Header */}
      <div className="p-3 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <div className={cn(
            "h-8 w-8 rounded-lg flex items-center justify-center",
            portal ? "bg-blue-100 dark:bg-blue-900/30" : "bg-gray-200 dark:bg-slate-700"
          )}>
            <Globe className={cn("h-4 w-4", portal ? "text-blue-600 dark:text-blue-400" : "text-gray-400")} />
          </div>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white text-sm">
              {portal?.name || "Unassigned"}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {agents.length} agents • {onlineCount} online • {busyCount} busy
            </p>
          </div>
        </div>
      </div>

      {/* Agent Cards */}
      <div className="p-2 space-y-2 flex-1 overflow-y-auto max-h-[calc(100vh-320px)]">
        {agents.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
            No agents
          </div>
        ) : (
          agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              jobStatus={agent.current_job_id ? jobStatuses?.[agent.current_job_id] : undefined}
              profileName={getProfileName?.(agent.profile_id ?? null) ?? "Default"}
              onEdit={() => onEditAgent(agent)}
              onToggle={() => onToggleStatus(agent)}
              onForceStop={onForceStop ? () => onForceStop(agent) : undefined}
              onDelete={() => onDeleteAgent(agent.id)}
              onMove={(newPortals) => onMoveAgent(agent.id, newPortals)}
              allPortals={allPortals}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function AgentSwimlanes({
  agents,
  portals,
  jobStatuses,
  getProfileName,
  onEditAgent,
  onToggleStatus,
  onForceStop,
  onDeleteAgent,
  onMoveAgent,
}: AgentSwimlanesProps) {
  // Group agents by primary portal (desired_portals contains portal_id strings, e.g. "as-visa")
  const agentsByPortal = new Map<string | null, Agent[]>();
  
  for (const portal of portals) {
    agentsByPortal.set(portal.portal_id, []);
  }
  agentsByPortal.set(null, []); // Unassigned

  for (const agent of agents) {
    const desired = Array.isArray(agent.desired_portals) ? agent.desired_portals : [];
    const primaryPortalId = desired[0] || null;
    const existing = agentsByPortal.get(primaryPortalId) || [];
    existing.push(agent);
    agentsByPortal.set(primaryPortalId, existing);
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {/* Portal swimlanes */}
      {portals.map((portal) => (
        <PortalSwimlane
          key={portal.id}
          portal={portal}
          agents={agentsByPortal.get(portal.portal_id) || []}
          jobStatuses={jobStatuses}
          getProfileName={getProfileName}
          onEditAgent={onEditAgent}
          onToggleStatus={onToggleStatus}
          onForceStop={onForceStop}
          onDeleteAgent={onDeleteAgent}
          onMoveAgent={onMoveAgent}
          allPortals={portals}
        />
      ))}

      {(agentsByPortal.get(null)?.length ?? 0) > 0 && (
        <PortalSwimlane
          portal={null}
          agents={agentsByPortal.get(null) || []}
          jobStatuses={jobStatuses}
          getProfileName={getProfileName}
          onEditAgent={onEditAgent}
          onToggleStatus={onToggleStatus}
          onForceStop={onForceStop}
          onDeleteAgent={onDeleteAgent}
          onMoveAgent={onMoveAgent}
          allPortals={portals}
        />
      )}
    </div>
  );
}
