"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cpApi, type Agent } from "@/lib/api";
import { DragDropPortal } from "@/components/ui/drag-drop-portal";
import { Globe, Settings, Power, PowerOff, ArrowLeftRight } from "lucide-react";

export default function PortalsPage() {
  const queryClient = useQueryClient();
  const [showDragDrop, setShowDragDrop] = useState(false);

  const { data: portals, isLoading } = useQuery({
    queryKey: ["portals"],
    queryFn: () => cpApi.getPortals(),
  });

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: () => cpApi.getAgents(),
  });

  const updateAgent = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Agent> }) =>
      cpApi.updateAgent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  const handleAssignPortals = async (agentId: string, portalIds: string[]) => {
    await updateAgent.mutateAsync({
      id: agentId,
      data: { desired_portals: portalIds },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Portals</h1>
          <p className="text-gray-500 dark:text-gray-400">Configure visa portal connections</p>
        </div>
        <Button
          variant={showDragDrop ? "default" : "outline"}
          onClick={() => setShowDragDrop(!showDragDrop)}
        >
          <ArrowLeftRight className="h-4 w-4 mr-2" />
          {showDragDrop ? "Hide Assignment" : "Assign Agents"}
        </Button>
      </div>

      {/* Drag & Drop Assignment Panel */}
      {showDragDrop && agents?.items && portals?.items && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Agent-Portal Assignment</CardTitle>
            <CardDescription>Drag agents to portals to assign them</CardDescription>
          </CardHeader>
          <CardContent>
            <DragDropPortal
              agents={agents.items}
              portals={portals.items}
              onAssign={handleAssignPortals}
            />
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading portals...</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {portals?.items?.map((portal) => {
            const assignedAgentCount = agents?.items?.filter((a) =>
              a.desired_portals?.includes(portal.portal_id)
            ).length ?? 0;

            return (
              <Card key={portal.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                      <CardTitle className="text-base text-gray-900 dark:text-white">{portal.name}</CardTitle>
                    </div>
                    <Badge variant={portal.enabled ? "success" : "secondary"}>
                      {portal.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                  <CardDescription className="font-mono text-xs">
                    {portal.portal_id}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between text-gray-500 dark:text-gray-400">
                      <span>Assigned Agents</span>
                      <span className="font-medium text-gray-900 dark:text-white">{assignedAgentCount}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-slate-700">
                    <Button size="sm" variant="outline">
                      <Settings className="h-3 w-3 mr-1" />
                      Configure
                    </Button>
                    <Button size="sm" variant={portal.enabled ? "destructive" : "default"}>
                      {portal.enabled ? (
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
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!isLoading && portals?.items?.length === 0 && (
        <div className="text-center py-12">
          <Globe className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">No portals configured</p>
        </div>
      )}
    </div>
  );
}
