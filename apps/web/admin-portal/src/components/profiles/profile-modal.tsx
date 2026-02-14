"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal, FormField } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Profile, settingsApi, type SettingsGrouped } from "@/lib/api";
import { Loader2 } from "lucide-react";

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}

/** Build profile form default config from system_settings (portal, job, hitl, browser). */
function defaultConfigFromSettings(settings: SettingsGrouped | undefined): ProfileFormData["config"] | null {
  if (!settings) return null;
  const portal = settings.portal as Record<string, unknown> | undefined;
  const job = settings.job as Record<string, unknown> | undefined;
  const hitl = settings.hitl as Record<string, unknown> | undefined;
  const browser = settings.browser as Record<string, unknown> | undefined;
  if (!portal || !job) return null;
  return {
    rateLimit: {
      rpm: num(portal.rate_limit_actions_per_minute, 60),
      burstLimit: num(portal.rate_limit_burst, 10),
    },
    pacing: {
      minMs: num(portal.pacing_min_delay_ms, 1000),
      maxMs: num(portal.pacing_max_delay_ms, 3000),
    },
    timeouts: {
      navigationMs: num(portal.navigation_timeout_ms, 30000),
      actionMs: num(portal.action_timeout_ms, 10000),
      hitlMs: hitl ? num((hitl.task_timeout_minutes as number) * 60 * 1000, 300000) : 300000,
    },
    retry: {
      maxRetries: num(job.max_retries, 3),
      backoffMs: num(job.retry_slot_delay_min_ms, 5000),
    },
    browser: {
      headless: true,
      viewport: {
        width: num(browser?.viewport_width, 1280),
        height: num(browser?.viewport_height, 720),
      },
    },
    proxy: { url: "", username: "", password: "" },
    fingerprint: { enabled: false },
  };
}

interface ProfileFormData {
  name: string;
  description: string;
  is_default: boolean;
  config: {
    rateLimit: {
      rpm: number;
      burstLimit: number;
    };
    pacing: {
      minMs: number;
      maxMs: number;
    };
    timeouts: {
      navigationMs: number;
      actionMs: number;
      hitlMs: number;
    };
    retry: {
      maxRetries: number;
      backoffMs: number;
    };
    browser?: {
      headless: boolean;
      viewport: { width: number; height: number };
    };
    proxy?: {
      url: string;
      username?: string;
      password?: string;
    };
    fingerprint?: {
      enabled: boolean;
    };
  };
}

const defaultConfig: ProfileFormData["config"] = {
  rateLimit: {
    rpm: 60,
    burstLimit: 10,
  },
  pacing: {
    minMs: 1000,
    maxMs: 3000,
  },
  timeouts: {
    navigationMs: 30000,
    actionMs: 10000,
    hitlMs: 300000,
  },
  retry: {
    maxRetries: 3,
    backoffMs: 5000,
  },
  browser: {
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  proxy: {
    url: "",
    username: "",
    password: "",
  },
  fingerprint: {
    enabled: false,
  },
};

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: ProfileFormData) => Promise<void>;
  profile?: Profile | null;
  isSubmitting?: boolean;
}

export function ProfileModal({
  open,
  onClose,
  onSubmit,
  profile,
  isSubmitting,
}: ProfileModalProps) {
  const isEditing = !!profile;

  const [formData, setFormData] = useState<ProfileFormData>({
    name: "",
    description: "",
    is_default: false,
    config: defaultConfig, // replaced by profileDefaults when modal opens
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<"basic" | "config">("basic");

  const { data: settingsData } = useQuery({
    queryKey: ["settings-grouped-for-profile-defaults"],
    queryFn: () => settingsApi.getAll(),
    enabled: open,
    staleTime: 60_000,
  });

  const profileDefaults = defaultConfigFromSettings(settingsData) ?? defaultConfig;

  // Reset form when opening/closing or profile changes
  useEffect(() => {
    if (open) {
      if (profile) {
        setFormData({
          name: profile.name,
          description: profile.description || "",
          is_default: profile.is_default,
          config: {
            ...profileDefaults,
            ...(profile.config as ProfileFormData["config"]),
          },
        });
      } else {
        setFormData({
          name: "",
          description: "",
          is_default: false,
          config: profileDefaults,
        });
      }
      setErrors({});
      setActiveTab("basic");
    }
  }, [open, profile, profileDefaults]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    } else if (formData.name.length < 3) {
      newErrors.name = "Name must be at least 3 characters";
    }

    if (formData.config.rateLimit.rpm < 1) {
      newErrors.rpm = "RPM must be at least 1";
    }

    if (formData.config.pacing.minMs > formData.config.pacing.maxMs) {
      newErrors.pacing = "Min pacing must be less than max pacing";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    await onSubmit(formData);
  };

  const updateConfig = <K extends keyof ProfileFormData["config"]>(
    section: K,
    field: keyof ProfileFormData["config"][K],
    value: number | boolean | string
  ) => {
    setFormData((prev) => ({
      ...prev,
      config: {
        ...prev.config,
        [section]: {
          ...(prev.config[section] as object),
          [field]: value,
        },
      },
    }));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit Profile" : "Create Profile"}
      description={
        isEditing
          ? "Update profile configuration"
          : "Create a new agent profile"
      }
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEditing ? "Save Changes" : "Create Profile"}
          </Button>
        </>
      }
    >
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-slate-700 mb-4">
        <button
          type="button"
          onClick={() => setActiveTab("basic")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "basic"
              ? "border-primary text-primary"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Basic Info
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("config")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "config"
              ? "border-primary text-primary"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Configuration
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {activeTab === "basic" && (
          <>
            {/* Name */}
            <FormField label="Name" htmlFor="name" error={errors.name} required>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="e.g., Standard Profile"
              />
            </FormField>

            {/* Description */}
            <FormField label="Description" htmlFor="description">
              <Input
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="Optional description"
              />
            </FormField>

            {/* Default */}
            <FormField label="Default Profile">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_default}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      is_default: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Set as default profile for new agents
                </span>
              </label>
            </FormField>
          </>
        )}

        {activeTab === "config" && (
          <div className="space-y-6">
            {/* Rate Limiting */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                Rate Limiting
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  label="Requests per Minute"
                  htmlFor="rpm"
                  error={errors.rpm}
                >
                  <Input
                    id="rpm"
                    type="number"
                    min={1}
                    value={formData.config.rateLimit.rpm}
                    onChange={(e) =>
                      updateConfig(
                        "rateLimit",
                        "rpm",
                        parseInt(e.target.value, 10) || 1
                      )
                    }
                  />
                </FormField>
                <FormField label="Burst Limit" htmlFor="burstLimit">
                  <Input
                    id="burstLimit"
                    type="number"
                    min={1}
                    value={formData.config.rateLimit.burstLimit}
                    onChange={(e) =>
                      updateConfig(
                        "rateLimit",
                        "burstLimit",
                        parseInt(e.target.value, 10) || 1
                      )
                    }
                  />
                </FormField>
              </div>
            </div>

            {/* Pacing */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                Action Pacing (ms)
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  label="Min Delay"
                  htmlFor="pacingMin"
                  error={errors.pacing}
                >
                  <Input
                    id="pacingMin"
                    type="number"
                    min={0}
                    value={formData.config.pacing.minMs}
                    onChange={(e) =>
                      updateConfig(
                        "pacing",
                        "minMs",
                        parseInt(e.target.value, 10) || 0
                      )
                    }
                  />
                </FormField>
                <FormField label="Max Delay" htmlFor="pacingMax">
                  <Input
                    id="pacingMax"
                    type="number"
                    min={0}
                    value={formData.config.pacing.maxMs}
                    onChange={(e) =>
                      updateConfig(
                        "pacing",
                        "maxMs",
                        parseInt(e.target.value, 10) || 0
                      )
                    }
                  />
                </FormField>
              </div>
            </div>

            {/* Timeouts */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                Timeouts (ms)
              </h4>
              <div className="grid grid-cols-3 gap-4">
                <FormField label="Navigation" htmlFor="navTimeout">
                  <Input
                    id="navTimeout"
                    type="number"
                    min={1000}
                    value={formData.config.timeouts.navigationMs}
                    onChange={(e) =>
                      updateConfig(
                        "timeouts",
                        "navigationMs",
                        parseInt(e.target.value, 10) || 30000
                      )
                    }
                  />
                </FormField>
                <FormField label="Action" htmlFor="actionTimeout">
                  <Input
                    id="actionTimeout"
                    type="number"
                    min={1000}
                    value={formData.config.timeouts.actionMs}
                    onChange={(e) =>
                      updateConfig(
                        "timeouts",
                        "actionMs",
                        parseInt(e.target.value, 10) || 10000
                      )
                    }
                  />
                </FormField>
                <FormField label="HITL" htmlFor="hitlTimeout">
                  <Input
                    id="hitlTimeout"
                    type="number"
                    min={1000}
                    value={formData.config.timeouts.hitlMs}
                    onChange={(e) =>
                      updateConfig(
                        "timeouts",
                        "hitlMs",
                        parseInt(e.target.value, 10) || 300000
                      )
                    }
                  />
                </FormField>
              </div>
            </div>

            {/* Retry */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                Retry Settings
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Max Retries" htmlFor="maxRetries">
                  <Input
                    id="maxRetries"
                    type="number"
                    min={0}
                    max={10}
                    value={formData.config.retry.maxRetries}
                    onChange={(e) =>
                      updateConfig(
                        "retry",
                        "maxRetries",
                        parseInt(e.target.value, 10) || 0
                      )
                    }
                  />
                </FormField>
                <FormField label="Backoff (ms)" htmlFor="backoff">
                  <Input
                    id="backoff"
                    type="number"
                    min={0}
                    value={formData.config.retry.backoffMs}
                    onChange={(e) =>
                      updateConfig(
                        "retry",
                        "backoffMs",
                        parseInt(e.target.value, 10) || 0
                      )
                    }
                  />
                </FormField>
              </div>
            </div>

            {/* Proxy (optional) */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                Proxy (optional)
              </h4>
              <div className="grid grid-cols-1 gap-4">
                <FormField label="Proxy URL" htmlFor="proxyUrl">
                  <Input
                    id="proxyUrl"
                    type="url"
                    placeholder="http://proxy:8080"
                    value={formData.config.proxy?.url ?? ""}
                    onChange={(e) =>
                      updateConfig("proxy", "url", e.target.value)
                    }
                  />
                </FormField>
                <FormField label="Username" htmlFor="proxyUser">
                  <Input
                    id="proxyUser"
                    type="text"
                    placeholder="Optional"
                    value={formData.config.proxy?.username ?? ""}
                    onChange={(e) =>
                      updateConfig("proxy", "username", e.target.value)
                    }
                  />
                </FormField>
                <FormField label="Password" htmlFor="proxyPass">
                  <Input
                    id="proxyPass"
                    type="password"
                    placeholder="Optional"
                    value={formData.config.proxy?.password ?? ""}
                    onChange={(e) =>
                      updateConfig("proxy", "password", e.target.value)
                    }
                  />
                </FormField>
              </div>
            </div>

            {/* Fingerprint (optional) */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                Fingerprint
              </h4>
              <FormField label="Use browser fingerprinting">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.config.fingerprint?.enabled ?? false}
                    onChange={(e) =>
                      updateConfig(
                        "fingerprint",
                        "enabled",
                        e.target.checked
                      )
                    }
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Enable fingerprinting for this profile
                  </span>
                </label>
              </FormField>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
