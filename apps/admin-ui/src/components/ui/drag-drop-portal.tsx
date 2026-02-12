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

  const handleDragStart = (agentId: string) => {
    setDraggedAgent(agentId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, portalId: string) => {
    e.preventDefault();
    if (draggedAgent) {
      const agent = agents.find((a) => a.id === draggedAgent);
      if (agent) {
        const currentPortals = agent.desired_portals || [];
        if (!currentPortals.includes(portalId)) {
          onAssign(draggedAgent, [...currentPortals, portalId]);
        }
      }
    }
    setDraggedAgent(null);
  };

  const handleRemovePortal = (agentId: string, portalId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (agent) {
      const newPortals = (agent.desired_portals || []).filter((p) => p !== portalId);
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
              onDragStart={() => handleDragStart(agent.id)}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border cursor-grab active:cursor-grabbing",
                "bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700",
                "hover:border-primary/50 dark:hover:border-primary/50 transition-colors",
                draggedAgent === agent.id && "opacity-50 ring-2 ring-primary"
              )}
            >
              <GripVertical className="h-4 w-4 text-gray-400" />
              <span className="text-xl">🤖</span>
              <div className="flex-1">
                <p className="font-medium text-gray-900 dark:text-white text-sm">{agent.name}</p>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {agent.desired_portals?.map((portalId) => (
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
              a.desired_portals?.includes(portal.portal_id)
            );

            return (
              <div
                key={portal.id}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, portal.portal_id)}
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
                        className="inline-flex items-center text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded"
                      >
                        🤖 {agent.name}
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
