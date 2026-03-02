import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cpApi, type Agent, type CreateAgentData } from "@/lib/api";

export function useAgents(params?: Record<string, string>) {
  return useQuery({
    queryKey: ["agents", params],
    queryFn: () => cpApi.getAgents(params),
  });
}

export function useAgent(id: string) {
  return useQuery({
    queryKey: ["agents", id],
    queryFn: () => cpApi.getAgent(id),
    enabled: !!id,
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAgentData) => cpApi.createAgent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Agent> }) =>
      cpApi.updateAgent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useForceStopAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cpApi.forceStopAgent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["job-statuses"] });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cpApi.deleteAgent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useScaleAgents() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { async_count: number; sync_count: number }) =>
      cpApi.scaleAgents(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
