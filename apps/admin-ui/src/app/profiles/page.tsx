"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cpApi, Profile } from "@/lib/api";
import { ProfileModal } from "@/components/profiles/profile-modal";
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
  const queryClient = useQueryClient();

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => cpApi.getProfiles(),
  });

  const createProfile = useMutation({
    mutationFn: (data: Parameters<typeof cpApi.createProfile>[0]) => cpApi.createProfile(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profiles"] }),
  });

  const updateProfile = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Profile> }) =>
      cpApi.updateProfile(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profiles"] }),
  });

  const deleteProfile = useMutation({
    mutationFn: (id: string) => cpApi.deleteProfile(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profiles"] }),
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
    config: Record<string, unknown>;
  }) => {
    if (editingProfile) {
      await updateProfile.mutateAsync({
        id: editingProfile.id,
        data: {
          name: data.name,
          description: data.description,
          is_default: data.is_default,
          config: data.config,
        },
      });
    } else {
      await createProfile.mutateAsync({
        name: data.name,
        description: data.description,
        is_default: data.is_default,
        config: data.config,
      });
    }
    handleCloseModal();
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this profile?")) {
      await deleteProfile.mutateAsync(id);
    }
  };

  return (
    <div className="space-y-6">
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
            const rateLimit = getConfigValue(profile.config, ["rateLimit", "rpm"]);
            const pacingMin = getConfigValue(profile.config, ["pacing", "minMs"]);
            const pacingMax = getConfigValue(profile.config, ["pacing", "maxMs"]);
            const navTimeout = getConfigValue(profile.config, ["timeouts", "navigationMs"]);
            const maxRetries = getConfigValue(profile.config, ["retry", "maxRetries"]);

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
                    {maxRetries && (
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Max Retries</span>
                        <span className="text-gray-900 dark:text-white">{maxRetries}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-slate-700">
                    <Button size="sm" variant="outline" onClick={() => handleOpenEditModal(profile)}>
                      <Edit className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(profile.id)}
                      disabled={profile.is_default}
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
    </div>
  );
}
