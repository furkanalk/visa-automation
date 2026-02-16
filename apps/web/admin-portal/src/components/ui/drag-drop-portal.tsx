"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { GripVertical, X } from "lucide-react";
import type { Agent, PortalConfig } from "@/lib/api";

interface DragDropPortalProps {
  agents: Agent[];
  portals: PortalConfig[];
  onAssign: (agentId: string, portalIds: string[]) => void;
}

export function DragDropPortal({ agents, portals, onAssign }: DragDropPortalProps) {
  const [draggedAgent, setDraggedAgent] = useState<string | null>(null);

  const getDesiredPortals = (agent: Agent): string[] =>
    Array.isArray(agent.desired_portals) ? agent.desired_portals : [];

  const handleDragStart = (e: React.DragEvent, agentId: string) => {
    setDraggedAgent(agentId);
    e.dataTransfer.setData("text/plain", agentId);
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/json", JSON.stringify({ agentId }));
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("text/plain") || e.dataTransfer.types.includes("application/json")) {
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };

  const getAgentIdFromEvent = (e: React.DragEvent): string | null => {
    try {
      const json = e.dataTransfer.getData("application/json");
      if (json) {
        const data = JSON.parse(json) as { agentId?: string };
        if (data.agentId) return data.agentId;
      }
    } catch {
      // ignore
    }
    const text = e.dataTransfer.getData("text/plain");
    return text || null;
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as HTMLElement;
    const portalEl = target.closest?.("[data-portal-id]");
    const portalId = portalEl?.getAttribute("data-portal-id") ?? (e.currentTarget as HTMLElement).getAttribute("data-portal-id");
    if (!portalId) return;
    const agentId = draggedAgent || getAgentIdFromEvent(e);
    setDraggedAgent(null);
    if (agentId) {
      const agent = agents.find((a) => a.id === agentId);
      if (agent) {
        const currentPortals = getDesiredPortals(agent);
        if (!currentPortals.includes(portalId)) {
          onAssign(agentId, [...currentPortals, portalId]);
        }
      }
    }
  };

  const handleRemovePortal = (agentId: string, portalId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (agent) {
      const newPortals = getDesiredPortals(agent).filter((p) => p !== portalId);
      onAssign(agentId, newPortals);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Agents Panel */}
      <div className="space-y-4">
        <h3 className="font-semibold text-gray-900 dark:text-white">Agents</h3>
        <div className="space-y-2">
          {agents.map((agent) => (
            <div
              key={agent.id}
              draggable
              onDragStart={(e) => handleDragStart(e, agent.id)}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border cursor-grab active:cursor-grabbing",
                "bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700",
                "hover:border-primary/50 dark:hover:border-primary/50 transition-colors",
                draggedAgent === agent.id && "opacity-50 ring-2 ring-primary"
              )}
            >
              <GripVertical className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="text-xl shrink-0">🤖</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 dark:text-white text-sm">{agent.name}</p>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {getDesiredPortals(agent).map((portalId) => (
                    <span
                      key={portalId}
                      className="inline-flex items-center gap-1 text-xs bg-primary/10 dark:bg-primary/20 text-primary px-2 py-0.5 rounded"
                    >
                      {portalId}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemovePortal(agent.id, portalId);
                        }}
                        className="hover:text-red-500"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              <span
                className={cn(
                  "shrink-0 text-xs font-medium px-2 py-1 rounded",
                  agent.status === "ONLINE"
                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                    : "bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400"
                )}
              >
                {agent.status === "ONLINE" ? "Online" : "Offline"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Portals Panel */}
      <div className="space-y-4">
        <h3 className="font-semibold text-gray-900 dark:text-white">Portals (Drop Zone)</h3>
        <div className="space-y-2">
          {portals.map((portal) => {
            const assignedAgents = agents.filter((a) =>
              getDesiredPortals(a).includes(portal.portal_id)
            );

            return (
              <div
                key={portal.id}
                data-portal-id={portal.portal_id}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className={cn(
                  "p-4 rounded-lg border-2 border-dashed min-h-[80px]",
                  "bg-gray-50 dark:bg-slate-800/50",
                  "border-gray-300 dark:border-slate-600",
                  draggedAgent && "border-primary bg-primary/5 dark:bg-primary/10"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900 dark:text-white">{portal.name}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                    {portal.portal_id}
                  </span>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {assignedAgents.length === 0 ? (
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                      Drag agents here to assign
                    </p>
                  ) : (
                    assignedAgents.map((agent) => (
                      <span
                        key={agent.id}
                        className="group inline-flex items-center gap-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 pl-2 pr-1 py-1 rounded"
                      >
                        🤖 {agent.name}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemovePortal(agent.id, portal.portal_id);
                          }}
                          className="opacity-0 group-hover:opacity-100 ml-0.5 p-0.5 rounded hover:bg-green-200 dark:hover:bg-green-800/50 text-green-800 dark:text-green-300 transition-opacity"
                          title="Remove assignment"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
