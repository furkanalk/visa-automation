"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cpApi, Profile } from "@/lib/api";
import { ProfileModal } from "@/components/profiles/profile-modal";
import { SaveBanner } from "@/components/ui/save-banner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Plus, Edit, Trash2, Star, Settings2 } from "lucide-react";

// Helper to safely get nested config values
function getConfigValue(config: Record<string, unknown>, path: string[]): string | null {
  let value: unknown = config;
  for (const key of path) {
    if (value && typeof value === "object" && key in value) {
      value = (value as Record<string, unknown>)[key];
    } else {
      return null;
    }
  }
  return value !== null && value !== undefined ? String(value) : null;
}

export default function ProfilesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [profileToDelete, setProfileToDelete] = useState<Profile | null>(null);
  const queryClient = useQueryClient();

  const showBanner = (type: "success" | "error", text: string) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 5000);
  };

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => cpApi.getProfiles(),
  });

  const createProfile = useMutation({
    mutationFn: (data: Parameters<typeof cpApi.createProfile>[0]) => cpApi.createProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to save."),
  });

  const updateProfile = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Profile> }) =>
      cpApi.updateProfile(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      showBanner("success", "Saved.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to save."),
  });

  const deleteProfile = useMutation({
    mutationFn: (id: string) => cpApi.deleteProfile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      setProfileToDelete(null);
      showBanner("success", "Deleted.");
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Failed to delete."),
  });

  const handleOpenCreateModal = () => {
    setEditingProfile(null);
    setModalOpen(true);
  };

  const handleOpenEditModal = (profile: Profile) => {
    setEditingProfile(profile);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingProfile(null);
  };

  const handleSubmitProfile = async (data: {
    name: string;
    description: string;
    is_default: boolean;
    is_scout: boolean;
    config: Record<string, unknown>;
  }) => {
    if (editingProfile) {
      await updateProfile.mutateAsync({
        id: editingProfile.id,
        data: {
          name: data.name,
          description: data.description,
          is_default: data.is_default,
          is_scout: data.is_scout,
          config: data.config,
        },
      });
    } else {
      await createProfile.mutateAsync({
        name: data.name,
        description: data.description,
        is_default: data.is_default,
        is_scout: data.is_scout,
        config: data.config,
      });
    }
    handleCloseModal();
  };

  const handleDeleteClick = (profile: Profile) => {
    if (profile.is_default) return;
    setProfileToDelete(profile);
  };

  const handleDeleteConfirm = () => {
    if (profileToDelete) deleteProfile.mutate(profileToDelete.id);
  };

  return (
    <div className="space-y-6">
      <SaveBanner message={banner} onDismiss={() => setBanner(null)} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Profiles</h1>
          <p className="text-gray-500 dark:text-gray-400">Agent configuration profiles</p>
        </div>
        <Button onClick={handleOpenCreateModal}>
          <Plus className="h-4 w-4 mr-1" />
          Create Profile
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading profiles...</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {profiles?.items?.map((profile) => {
            const rateLimit = getConfigValue(profile.config, ["rateLimit", "actionsPerMinute"]) ?? getConfigValue(profile.config, ["rateLimit", "rpm"]);
            const pacingMin = getConfigValue(profile.config, ["pacing", "minDelayMs"]) ?? getConfigValue(profile.config, ["pacing", "minMs"]);
            const pacingMax = getConfigValue(profile.config, ["pacing", "maxDelayMs"]) ?? getConfigValue(profile.config, ["pacing", "maxMs"]);
            const navTimeout = getConfigValue(profile.config, ["timeouts", "navigationMs"]);
            const maxAttempts = getConfigValue(profile.config, ["retry", "maxRetries"]) ?? getConfigValue(profile.config, ["retry", "maxAttempts"]);

            return (
              <Card key={profile.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Settings2 className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                      <CardTitle className="text-base text-gray-900 dark:text-white">{profile.name}</CardTitle>
                    </div>
                    {profile.is_default && (
                      <Badge variant="secondary">
                        <Star className="h-3 w-3 mr-1" />
                        Default
                      </Badge>
                    )}
                  </div>
                  {profile.description && (
                    <CardDescription>{profile.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    {rateLimit && (
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Rate Limit</span>
                        <span className="text-gray-900 dark:text-white">{rateLimit} rpm</span>
                      </div>
                    )}
                    {pacingMin && pacingMax && (
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Pacing</span>
                        <span className="text-gray-900 dark:text-white">{pacingMin}-{pacingMax}ms</span>
                      </div>
                    )}
                    {navTimeout && (
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Navigation Timeout</span>
                        <span className="text-gray-900 dark:text-white">{navTimeout}ms</span>
                      </div>
                    )}
                    {maxAttempts && (
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Max retries</span>
                        <span className="text-gray-900 dark:text-white">{maxAttempts}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-slate-700">
                    <Button size="sm" variant="outline" onClick={() => handleOpenEditModal(profile)}>
                      <Edit className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                    <span title={profile.is_default ? "Default profile cannot be deleted." : undefined} className="inline-block">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteClick(profile)}
                        disabled={profile.is_default}
                        title={profile.is_default ? "Default profile cannot be deleted." : "Delete profile"}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!isLoading && profiles?.items?.length === 0 && (
        <div className="text-center py-12">
          <Settings2 className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">No profiles found</p>
          <Button className="mt-4" onClick={handleOpenCreateModal}>
            Create your first profile
          </Button>
        </div>
      )}

      {/* Profile Modal */}
      <ProfileModal
        open={modalOpen}
        onClose={handleCloseModal}
        onSubmit={handleSubmitProfile}
        profile={editingProfile}
        isSubmitting={createProfile.isPending || updateProfile.isPending}
      />

      <ConfirmDialog
        open={profileToDelete !== null}
        onClose={() => setProfileToDelete(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete profile"
        message="Are you sure you want to delete this profile?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        isLoading={deleteProfile.isPending}
      />
    </div>
  );
}
