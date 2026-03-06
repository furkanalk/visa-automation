"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cpApi, type Agent, type PortalConfig } from "@/lib/api";
import { DragDropPortal } from "@/components/ui/drag-drop-portal";
import { PortalConfigModal } from "@/components/portals/portal-config-modal";
import { SaveBanner } from "@/components/ui/save-banner";
import { Globe, Settings, Power, PowerOff, ArrowLeftRight, Loader2, ChevronDown, ChevronRight, Link2, Users, AlertCircle, Gauge, KeyRound, ShieldCheck } from "lucide-react";

export default function PortalsPage() {
  const queryClient = useQueryClient();
  const [showDragDrop, setShowDragDrop] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [selectedPortal, setSelectedPortal] = useState<PortalConfig | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const showBanner = (type: "success" | "error", text: string) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 5000);
  };
  const [expandedPortalId, setExpandedPortalId] = useState<string | null>(null);

  const { data: portalsData, isLoading: portalsLoading, isError: portalsError, error: portalsErrorDetail, refetch: refetchPortals } = useQuery({
    queryKey: ["portals"],
    queryFn: () => cpApi.getPortals(),
  });

  const { data: agentsData } = useQuery({
    queryKey: ["agents"],
    queryFn: () => cpApi.getAgents(),
  });

  const { data: liveness } = useQuery({
    queryKey: ["portal-liveness"],
    queryFn: () => cpApi.getPortalLiveness(),
    refetchInterval: 60 * 1000,
  });

  const { data: fullPortal, isLoading: fullPortalLoading } = useQuery({
    queryKey: ["portal", selectedPortal?.id],
    queryFn: () => cpApi.getPortal(selectedPortal!.id),
    enabled: configModalOpen && !!selectedPortal?.id,
  });

  const portals = portalsData?.items ?? [];
  const agents = agentsData?.items ?? [];
  const portalForModal = fullPortal ?? selectedPortal;

  const updateAgent = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Agent> }) =>
      cpApi.updateAgent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      setAssignError(null);
      showBanner("success", "Saved.");
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Failed to update assignment";
      setAssignError(msg);
      showBanner("error", msg);
    },
  });

  const updatePortal = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PortalConfig> }) =>
      cpApi.updatePortal(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portals"] });
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to save."),
  });

  const enablePortal = useMutation({
    mutationFn: (id: string) => cpApi.enablePortal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portals"] });
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to update."),
  });

  const disablePortal = useMutation({
    mutationFn: (id: string) => cpApi.disablePortal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portals"] });
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to update."),
  });

  const handleAssignPortals = async (agentId: string, portalIds: string[]) => {
    await updateAgent.mutateAsync({
      id: agentId,
      data: { desired_portals: portalIds },
    });
  };

  const handleOpenConfig = (portal: PortalConfig) => {
    setSelectedPortal(portal);
    setConfigModalOpen(true);
  };

  const handleSavePortalConfig = async (
    config: Record<string, unknown>,
    selectors: Record<string, unknown>
  ) => {
    if (!selectedPortal) return;
    await updatePortal.mutateAsync({
      id: selectedPortal.id,
      data: { config, selectors },
    });
    setConfigModalOpen(false);
    setSelectedPortal(null);
  };

  const handleToggleEnabled = (portal: PortalConfig) => {
    if (portal.enabled) {
      disablePortal.mutate(portal.id);
    } else {
      enablePortal.mutate(portal.id);
    }
  };

  return (
    <div className="space-y-6">
      <SaveBanner message={banner} onDismiss={() => setBanner(null)} />
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
      {showDragDrop && agents.length > 0 && portals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Agent-Portal Assignment</CardTitle>
            <CardDescription>Drag agents to portals to assign them</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {assignError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
                {assignError}
              </div>
            )}
            <DragDropPortal
              agents={agents}
              portals={portals}
              onAssign={handleAssignPortals}
            />
          </CardContent>
        </Card>
      )}

      {portalsLoading ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading portals...</div>
      ) : portalsError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">Failed to load portals</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              {portalsErrorDetail instanceof Error ? portalsErrorDetail.message : "Check your connection and try again."}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => refetchPortals()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {portals.map((portal) => {
            const assignedAgents = agents.filter((a) =>
              Array.isArray(a.desired_portals) && a.desired_portals.includes(portal.portal_id)
            );
            const assignedAgentCount = assignedAgents.length;
            const isDetailsOpen = expandedPortalId === portal.id;
            const config = (portal.config ?? {}) as Record<string, unknown>;
            const rateLimit = (config.rateLimit ?? {}) as Record<string, unknown>;
            const hitl = (config.hitl ?? {}) as Record<string, unknown>;
            const rateLimitEnabled = Boolean(rateLimit.enabled);
            const otpMode = typeof hitl.otpMode === "string" ? hitl.otpMode : "";
            const captchaMode = typeof hitl.captchaMode === "string" ? hitl.captchaMode : "";
            const livenessItem = liveness?.items?.find((p) => p.portal_id === portal.portal_id);
            const statusUp = livenessItem?.status === "up";

            return (
              <Card key={portal.id} className="border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/80 dark:bg-slate-800/80 shadow-sm">
                        <Globe className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base text-gray-900 dark:text-white truncate">{portal.name}</CardTitle>
                        <CardDescription className="font-mono text-xs mt-0.5 text-gray-500 dark:text-gray-400">
                          {portal.portal_id}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {portal.enabled && livenessItem !== undefined && (
                        <Badge variant={statusUp ? "success" : "destructive"} className="text-[10px]">
                          {statusUp ? "Up" : "Down"}
                        </Badge>
                      )}
                      <Badge variant={portal.enabled ? "success" : "secondary"} className="shrink-0">
                        {portal.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                  </div>
                  {portal.base_url && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-600 dark:text-gray-400">
                      <Link2 className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                      <span className="truncate font-mono" title={portal.base_url}>{portal.base_url}</span>
                    </div>
                  )}
                  {portal.config && typeof (portal.config as Record<string, unknown>)?.selectorsVersion === 'string' && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Selectors: {(portal.config as Record<string, unknown>).selectorsVersion as string}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-3 text-sm">
                    {/* Rate limit / OTP / CAPTCHA indicators */}
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${rateLimitEnabled ? "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-700" : "bg-gray-50 text-gray-400 border-gray-200 dark:bg-slate-700/50 dark:text-gray-500 dark:border-slate-600"}`}>
                        <Gauge className="h-3 w-3" />
                        Rate Limit {rateLimitEnabled ? "On" : "Off"}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${otpMode && otpMode !== "disabled" ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-700" : "bg-gray-50 text-gray-400 border-gray-200 dark:bg-slate-700/50 dark:text-gray-500 dark:border-slate-600"}`}>
                        <KeyRound className="h-3 w-3" />
                        OTP{otpMode && otpMode !== "disabled" ? `: ${otpMode}` : ": off"}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${captchaMode && captchaMode !== "disabled" ? "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-700" : "bg-gray-50 text-gray-400 border-gray-200 dark:bg-slate-700/50 dark:text-gray-500 dark:border-slate-600"}`}>
                        <ShieldCheck className="h-3 w-3" />
                        CAPTCHA{captchaMode && captchaMode !== "disabled" ? `: ${captchaMode}` : ": off"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedPortalId(isDetailsOpen ? null : portal.id)}
                      className="flex w-full items-center justify-between rounded-lg py-2 px-2 -mx-2 text-left text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-gray-400" />
                        Assigned Agents
                      </span>
                      <span className="flex items-center gap-1 font-semibold text-gray-900 dark:text-white">
                        {assignedAgentCount}
                        {assignedAgentCount > 0 ? (
                          isDetailsOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )
                        ) : null}
                      </span>
                    </button>
                    {isDetailsOpen && assignedAgentCount > 0 && (
                      <ul className="list-none space-y-1 pl-6 text-gray-700 dark:text-gray-300">
                        {assignedAgents.map((a) => (
                          <li key={a.id} className="relative before:content-['•'] before:absolute before:-left-3 before:text-gray-400">{a.name}</li>
                        ))}
                      </ul>
                    )}
                    {isDetailsOpen && assignedAgentCount === 0 && (
                      <p className="text-gray-500 dark:text-gray-400 pl-1">No agents assigned</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-slate-700">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenConfig(portal)}
                    >
                      <Settings className="h-3 w-3 mr-1" />
                      Configure
                    </Button>
                    <Button
                      size="sm"
                      variant={portal.enabled ? "destructive" : "default"}
                      onClick={() => handleToggleEnabled(portal)}
                      disabled={
                        enablePortal.isPending || disablePortal.isPending
                      }
                    >
                      {(enablePortal.isPending || disablePortal.isPending) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : portal.enabled ? (
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

      {!portalsLoading && portals.length === 0 && (
        <div className="text-center py-12">
          <Globe className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">No portals configured</p>
        </div>
      )}

      <PortalConfigModal
        open={configModalOpen}
        onClose={() => {
          setConfigModalOpen(false);
          setSelectedPortal(null);
        }}
        portal={portalForModal}
        portalLoading={fullPortalLoading}
        onSave={handleSavePortalConfig}
        isSubmitting={updatePortal.isPending}
      />
    </div>
  );
}
