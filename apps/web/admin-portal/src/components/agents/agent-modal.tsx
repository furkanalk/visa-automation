"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal, FormField } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cpApi, Agent, Profile, PortalConfig } from "@/lib/api";
import { Loader2, X } from "lucide-react";

interface AgentFormData {
  name: string;
  mode: "ASYNC" | "SYNC";
  status?: "ONLINE" | "OFFLINE" | "DISABLED" | "DRAINING";
  profile_id: string | null;
  desired_portals: string[];
  desired_concurrency: number;
}

interface AgentModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: AgentFormData) => Promise<void>;
  agent?: Agent | null;
  isSubmitting?: boolean;
}

export function AgentModal({
  open,
  onClose,
  onSubmit,
  agent,
  isSubmitting,
}: AgentModalProps) {
  const isEditing = !!agent;

  const [formData, setFormData] = useState<AgentFormData>({
    name: "",
    mode: "ASYNC",
    status: "ONLINE",
    profile_id: null,
    desired_portals: [],
    desired_concurrency: 1,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load profiles for selection
  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => cpApi.getProfiles(),
    enabled: open,
  });

  // Load portals for selection
  const { data: portals } = useQuery({
    queryKey: ["portals"],
    queryFn: () => cpApi.getPortals(),
    enabled: open,
  });

  // Default profile for new agents: is_default one, else first in list
  const defaultProfileId =
    profiles?.items?.find((p) => p.is_default)?.id ?? profiles?.items?.[0]?.id ?? null;

  // Reset form when opening/closing or agent changes (or profiles load for create)
  useEffect(() => {
    if (!open) return;
    if (agent) {
      setFormData({
        name: agent.name,
        mode: agent.mode,
        status: agent.status,
        profile_id: agent.profile_id,
        desired_portals: Array.isArray(agent.desired_portals) ? agent.desired_portals : [],
        desired_concurrency: agent.desired_concurrency || 1,
      });
    } else {
      setFormData({
        name: "",
        mode: "ASYNC",
        status: "ONLINE",
        profile_id: defaultProfileId,
        desired_portals: [],
        desired_concurrency: 1,
      });
    }
    setErrors({});
  }, [open, agent, defaultProfileId]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    } else if (formData.name.length < 3) {
      newErrors.name = "Name must be at least 3 characters";
    }

    if (formData.desired_concurrency < 1) {
      newErrors.desired_concurrency = "Concurrency must be at least 1";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    await onSubmit(formData);
  };

  const togglePortal = (portalId: string) => {
    setFormData((prev) => ({
      ...prev,
      desired_portals: prev.desired_portals.includes(portalId)
        ? prev.desired_portals.filter((p) => p !== portalId)
        : [...prev.desired_portals, portalId],
    }));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit Agent" : "Create Agent"}
      description={
        isEditing
          ? "Update agent configuration"
          : "Create a new worker agent"
      }
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEditing ? "Save Changes" : "Create Agent"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <FormField label="Name" htmlFor="name" error={errors.name} required>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="e.g., agent-async-1"
          />
        </FormField>

        {/* Mode */}
        <FormField label="Mode" htmlFor="mode" required>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={formData.mode === "ASYNC" ? "default" : "outline"}
              onClick={() =>
                setFormData((prev) => ({ ...prev, mode: "ASYNC" }))
              }
              className="flex-1"
            >
              Async
            </Button>
            <Button
              type="button"
              variant={formData.mode === "SYNC" ? "default" : "outline"}
              onClick={() =>
                setFormData((prev) => ({ ...prev, mode: "SYNC" }))
              }
              className="flex-1"
            >
              Sync
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {formData.mode === "ASYNC"
              ? "Async agents handle slot searching and long-running tasks"
              : "Sync agents handle user-triggered operations with direct feedback"}
          </p>
        </FormField>

        {/* Status (only for editing) */}
        {isEditing && (
          <FormField label="Status" htmlFor="status">
            <select
              id="status"
              value={formData.status}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  status: e.target.value as Agent["status"],
                }))
              }
              className="w-full h-9 rounded-lg px-4 bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 outline-none cursor-pointer transition-all duration-200 text-sm"
            >
              <option value="ONLINE">Online</option>
              <option value="OFFLINE">Offline</option>
              <option
                value="DRAINING"
                disabled={!agent?.current_job_id}
                title={!agent?.current_job_id ? "No active job (Draining only when a job is running)" : undefined}
              >
                Draining{!agent?.current_job_id ? " (no active job)" : ""}
              </option>
            </select>
            {!agent?.current_job_id && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Draining is only available when the agent has an active job.</p>
            )}
          </FormField>
        )}

        {/* Profile */}
        <FormField label="Profile" htmlFor="profile">
          <select
            id="profile"
            value={formData.profile_id ?? ""}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                profile_id: e.target.value || null,
              }))
            }
            className="w-full h-9 rounded-lg px-4 bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:bg-white dark:focus:bg-slate-600 outline-none cursor-pointer transition-all duration-200 text-sm"
          >
            {profiles?.items?.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
                {profile.is_default && " (default)"}
              </option>
            ))}
          </select>
          {profiles?.items?.length === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Create a profile first in Profiles.</p>
          )}
        </FormField>

        {/* Concurrency */}
        <FormField
          label="Concurrency"
          htmlFor="concurrency"
          error={errors.desired_concurrency}
        >
          <Input
            id="concurrency"
            type="number"
            min={1}
            max={10}
            value={formData.desired_concurrency}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                desired_concurrency: parseInt(e.target.value, 10) || 1,
              }))
            }
          />
          <p className="text-xs text-gray-500 mt-1">
            Number of concurrent jobs this agent can handle
          </p>
        </FormField>

        {/* Portals */}
        <FormField label="Assigned Portals">
          <div className="space-y-2">
            {portals?.items?.map((portal) => (
              <label
                key={portal.id}
                className="flex items-center gap-2 p-2 rounded-md border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={formData.desired_portals.includes(portal.portal_id)}
                  onChange={() => togglePortal(portal.portal_id)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-900 dark:text-white">
                  {portal.name}
                </span>
                {!portal.enabled && (
                  <Badge variant="secondary" className="text-xs">
                    Disabled
                  </Badge>
                )}
              </label>
            ))}
            {(!portals?.items || portals.items.length === 0) && (
              <p className="text-sm text-gray-500">No portals configured</p>
            )}
          </div>

          {/* Selected portals badges */}
          {formData.desired_portals.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {formData.desired_portals.map((portalId) => {
                const portal = portals?.items?.find(
                  (p) => p.portal_id === portalId
                );
                return (
                  <Badge
                    key={portalId}
                    variant="secondary"
                    className="flex items-center gap-1"
                  >
                    {portal?.name || portalId}
                    <button
                      type="button"
                      onClick={() => togglePortal(portalId)}
                      className="ml-1 hover:text-red-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}
        </FormField>
      </form>
    </Modal>
  );
}
