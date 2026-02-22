"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal, FormField } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Profile, settingsApi, type SettingsGrouped } from "@/lib/api";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}

/** Build profile form default config from system_settings (portal, job, hitl, browser). Portal-shaped keys. */
function defaultConfigFromSettings(settings: SettingsGrouped | undefined): ProfileFormData["config"] | null {
  if (!settings) return null;
  const portal = settings.portal as Record<string, unknown> | undefined;
  const job = settings.job as Record<string, unknown> | undefined;
  const hitlSettings = settings.hitl as Record<string, unknown> | undefined;
  const browser = settings.browser as Record<string, unknown> | undefined;
  if (!portal || !job) return null;
  const hitlMaxSec = hitlSettings ? num((hitlSettings.task_timeout_minutes as number) * 60, 300) : 300;
  return {
    config_priority: "portal_over_profile",
    rateLimit: {
      enabled: true,
      actionsPerMinute: num(portal.rate_limit_actions_per_minute, 30),
      burst: num(portal.rate_limit_burst, 5),
    },
    pacing: {
      minDelayMs: num(portal.pacing_min_delay_ms, 500),
      maxDelayMs: num(portal.pacing_max_delay_ms, 2000),
      jitter: 0.2,
    },
    timeouts: {
      navigationMs: num(portal.navigation_timeout_ms, 30000),
      actionMs: num(portal.action_timeout_ms, 10000),
    },
    hitl: {
      otpMode: "pause",
      captchaMode: "hitl",
      maxWaitSeconds: hitlMaxSec,
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

type ConfigPriority = "profile_over_portal" | "portal_over_profile";

interface ProfileFormData {
  name: string;
  description: string;
  is_default: boolean;
  is_scout: boolean;
  config: {
    config_priority?: ConfigPriority;
    /** When true (default for scout), watcher creates slot-check-only jobs. Only relevant when is_scout is true. */
    slot_check_only?: boolean;
    rateLimit: {
      enabled: boolean;
      actionsPerMinute: number;
      burst: number;
    };
    pacing: {
      minDelayMs: number;
      maxDelayMs: number;
      jitter: number;
    };
    timeouts: {
      navigationMs: number;
      actionMs: number;
    };
    hitl: {
      otpMode: string;
      captchaMode: string;
      maxWaitSeconds: number;
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
    minRunDurationMs?: number;
    mouseMoveIntervalMs?: number;
  };
}

const defaultConfig: ProfileFormData["config"] = {
  config_priority: "portal_over_profile",
  slot_check_only: false,
  rateLimit: {
    enabled: true,
    actionsPerMinute: 30,
    burst: 5,
  },
  pacing: {
    minDelayMs: 500,
    maxDelayMs: 2000,
    jitter: 0.2,
  },
  timeouts: {
    navigationMs: 30000,
    actionMs: 10000,
  },
  hitl: {
    otpMode: "pause",
    captchaMode: "hitl",
    maxWaitSeconds: 300,
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
    is_scout: false,
    config: defaultConfig, // replaced by profileDefaults when modal opens
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<"basic" | "config">("basic");
  const [pacingEnabled, setPacingEnabled] = useState(true);
  const [pacingExpanded, setPacingExpanded] = useState(false);
  const [rateLimitExpanded, setRateLimitExpanded] = useState(false);
  const [timingEnabled, setTimingEnabled] = useState(false);
  const [timingExpanded, setTimingExpanded] = useState(false);
  const [mouseEnabled, setMouseEnabled] = useState(false);
  const [mouseExpanded, setMouseExpanded] = useState(false);

  const { data: settingsData } = useQuery({
    queryKey: ["settings-grouped-for-profile-defaults"],
    queryFn: () => settingsApi.getAll(),
    enabled: open,
    staleTime: 60_000,
  });

  // Memoize so effect doesn't run every render (would overwrite user input)
  const profileDefaults = useMemo(
    () => defaultConfigFromSettings(settingsData) ?? defaultConfig,
    [settingsData]
  );

  // Reset tab only when modal opens (so Configuration tab stays when profileDefaults loads later)
  useEffect(() => {
    if (open) setActiveTab("basic");
  }, [open]);

  // Normalize profile config from API (may have legacy rpm/burstLimit/minMs or portal-shaped keys).
  const normalizeProfileConfig = (raw: Record<string, unknown>, profile?: Profile | null): ProfileFormData["config"] => {
    const base = { ...profileDefaults };
    const r = raw.rateLimit as Record<string, unknown> | undefined;
    const p = raw.pacing as Record<string, unknown> | undefined;
    const t = raw.timeouts as Record<string, unknown> | undefined;
    const h = raw.hitl as Record<string, unknown> | undefined;
    return {
      ...base,
      ...raw,
      config_priority: (raw.config_priority as ConfigPriority) ?? base.config_priority,
      rateLimit: {
        enabled: r?.enabled ?? base.rateLimit.enabled,
        actionsPerMinute: r?.actionsPerMinute ?? r?.rpm ?? base.rateLimit.actionsPerMinute,
        burst: r?.burst ?? r?.burstLimit ?? base.rateLimit.burst,
      },
      pacing: {
        minDelayMs: p?.minDelayMs ?? p?.minMs ?? base.pacing.minDelayMs,
        maxDelayMs: p?.maxDelayMs ?? p?.maxMs ?? base.pacing.maxDelayMs,
        jitter: p?.jitter ?? base.pacing.jitter,
      },
      timeouts: {
        navigationMs: t?.navigationMs ?? base.timeouts.navigationMs,
        actionMs: t?.actionMs ?? base.timeouts.actionMs,
      },
      hitl: h
        ? {
            otpMode: (h.otpMode as string) || base.hitl.otpMode,
            captchaMode: (h.captchaMode as string) || base.hitl.captchaMode,
            maxWaitSeconds: num(h.maxWaitSeconds, base.hitl.maxWaitSeconds),
          }
        : base.hitl,
      minRunDurationMs: (raw.minRunDurationMs as number) ?? base.minRunDurationMs,
      mouseMoveIntervalMs: (raw.mouseMoveIntervalMs as number) ?? base.mouseMoveIntervalMs,
      slot_check_only: (raw.slot_check_only as boolean) ?? (profile?.is_scout ? true : base.slot_check_only ?? false),
    } as ProfileFormData["config"];
  };

  // Reset form only when modal opens, profile id changes, or profileDefaults (settings) first loads.
  useEffect(() => {
    if (!open) return;
    if (profile) {
      const config = normalizeProfileConfig((profile.config || {}) as Record<string, unknown>, profile);
      setFormData({
        name: profile.name,
        description: profile.description || "",
        is_default: profile.is_default,
        is_scout: profile.is_scout ?? false,
        config,
      });
      setPacingEnabled(config.pacing.minDelayMs > 0 || config.pacing.maxDelayMs > 0);
      setTimingEnabled((config.minRunDurationMs ?? 0) > 0);
      setMouseEnabled((config.mouseMoveIntervalMs ?? 0) > 0);
    } else {
      setFormData({
        name: "",
        description: "",
        is_default: false,
        is_scout: false,
        config: profileDefaults,
      });
      setPacingEnabled(profileDefaults.pacing.minDelayMs > 0 || profileDefaults.pacing.maxDelayMs > 0);
      setTimingEnabled((profileDefaults.minRunDurationMs ?? 0) > 0);
      setMouseEnabled((profileDefaults.mouseMoveIntervalMs ?? 0) > 0);
    }
    setErrors({});
  }, [open, profile?.id, profileDefaults]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    } else if (formData.name.length < 3) {
      newErrors.name = "Name must be at least 3 characters";
    }

    if (formData.config.rateLimit.actionsPerMinute < 1) {
      newErrors.rpm = "Actions per minute must be at least 1";
    }

    if (formData.config.pacing.minDelayMs > formData.config.pacing.maxDelayMs) {
      newErrors.pacing = "Min delay must be less than max delay";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const configToSend = { ...formData.config };
    if (!pacingEnabled) {
      configToSend.pacing = { minDelayMs: 0, maxDelayMs: 0, jitter: 0 };
    }
    if (!timingEnabled) {
      delete configToSend.minRunDurationMs;
    }
    if (!mouseEnabled) {
      delete configToSend.mouseMoveIntervalMs;
    }
    await onSubmit({ ...formData, config: configToSend });
  };

  type Config = ProfileFormData["config"];
  const updateConfig = <
    S extends keyof NonNullable<Config>,
    K extends keyof NonNullable<NonNullable<Config>[S]>
  >(
    section: S,
    key: K,
    value: NonNullable<NonNullable<Config>[S]>[K]
  ) => {
    setFormData((prev) => ({
      ...prev,
      config: {
        ...prev.config,
        [section]: {
          ...(prev.config[section] as object),
          [key]: value,
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
            {/* Config priority: profile vs portal when both define same key */}
            <FormField
              label="Config priority"
              htmlFor="config_priority"
              hint="When this profile and the portal both define the same setting (e.g. rate limit, pacing), which value is used?"
            >
              <select
                id="config_priority"
                value={formData.config.config_priority ?? "portal_over_profile"}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      config_priority: e.target.value as ConfigPriority,
                    },
                  }))
                }
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              >
                <option value="portal_over_profile">Portal wins (portal over profile)</option>
                <option value="profile_over_portal">Profile wins (profile over portal)</option>
              </select>
            </FormField>
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

            {/* Scout (Watcher) */}
            <FormField label="Scout (Watcher) profile">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_scout}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setFormData((prev) => ({
                      ...prev,
                      is_scout: checked,
                      config: { ...prev.config, slot_check_only: checked ? true : prev.config.slot_check_only },
                    }));
                  }}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Agents with this profile only process the slot-check (watcher) queue
                </span>
              </label>
            </FormField>

            {formData.is_scout && (
              <FormField label="Slot check only" hint="Watcher-created jobs only check availability; they do not book. Turn off for dry-run that still runs full flow (rare).">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.config.slot_check_only !== false}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        config: { ...prev.config, slot_check_only: e.target.checked },
                      }))
                    }
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Create slot-check-only jobs (recommended for scout)
                  </span>
                </label>
              </FormField>
            )}
          </>
        )}

        {activeTab === "config" && (
          <div className="space-y-6">
            {/* Timeouts — same as portal */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-slate-600 pb-1 mb-3">
                Timeouts (ms)
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Navigation" htmlFor="navTimeout" hint="Page load timeout">
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
                <FormField label="Action" htmlFor="actionTimeout" hint="Single action timeout">
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
              </div>
            </div>

            {/* HITL — same as portal (before Pacing) */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-slate-600 pb-1 mb-3">
                HITL (human in the loop)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="OTP mode" htmlFor="hitlOtp" hint="pause / auto / skip">
                  <select
                    id="hitlOtp"
                    value={formData.config.hitl.otpMode}
                    onChange={(e) =>
                      updateConfig("hitl", "otpMode", e.target.value)
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="pause">pause (wait for human)</option>
                    <option value="auto">auto (use provider)</option>
                    <option value="skip">skip</option>
                  </select>
                </FormField>
                <FormField label="Captcha mode" htmlFor="hitlCaptcha" hint="hitl / solver / skip">
                  <select
                    id="hitlCaptcha"
                    value={formData.config.hitl.captchaMode}
                    onChange={(e) =>
                      updateConfig("hitl", "captchaMode", e.target.value)
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="hitl">hitl (human solves)</option>
                    <option value="solver">solver (automated)</option>
                    <option value="skip">skip</option>
                  </select>
                </FormField>
                <FormField label="Max wait (seconds)" htmlFor="hitlMaxWait">
                  <Input
                    id="hitlMaxWait"
                    type="number"
                    min={0}
                    value={formData.config.hitl.maxWaitSeconds}
                    onChange={(e) =>
                      updateConfig(
                        "hitl",
                        "maxWaitSeconds",
                        parseInt(e.target.value, 10) || 300
                      )
                    }
                  />
                </FormField>
              </div>
            </div>

            {/* Pacing — collapsible + enable (like portal) */}
            <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30 p-3 space-y-2">
              <button
                type="button"
                onClick={() => setPacingExpanded(!pacingExpanded)}
                className={cn(
                  "flex items-center gap-2 text-sm font-medium w-full text-left",
                  "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                )}
              >
                {pacingExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Pacing (delay between actions)
                {pacingEnabled && <Badge variant="secondary" className="text-xs font-normal">On</Badge>}
              </button>
              {pacingExpanded && (
                <div className="pl-6 pt-1 space-y-3 border-l-2 border-gray-200 dark:border-slate-600 ml-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="pacingEnabled"
                      checked={pacingEnabled}
                      onChange={(e) => setPacingEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-800"
                    />
                    <label htmlFor="pacingEnabled" className="text-sm text-gray-700 dark:text-gray-300">Enable delay between actions</label>
                  </div>
                  {pacingEnabled && (
                    <div className="grid grid-cols-3 gap-4">
                      <FormField label="Min delay (ms)" htmlFor="pacingMin" error={errors.pacing}>
                        <Input id="pacingMin" type="number" min={0} value={formData.config.pacing.minDelayMs} onChange={(e) => updateConfig("pacing", "minDelayMs", parseInt(e.target.value, 10) || 0)} />
                      </FormField>
                      <FormField label="Max delay (ms)" htmlFor="pacingMax">
                        <Input id="pacingMax" type="number" min={0} value={formData.config.pacing.maxDelayMs} onChange={(e) => updateConfig("pacing", "maxDelayMs", parseInt(e.target.value, 10) || 0)} />
                      </FormField>
                      <FormField label="Jitter" htmlFor="pacingJitter" hint="0–1">
                        <Input id="pacingJitter" type="number" min={0} max={1} step={0.1} value={formData.config.pacing.jitter} onChange={(e) => updateConfig("pacing", "jitter", parseFloat(e.target.value) || 0)} />
                      </FormField>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Rate limit — collapsible (like portal) */}
            <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30 p-3 space-y-2">
              <button
                type="button"
                onClick={() => setRateLimitExpanded(!rateLimitExpanded)}
                className={cn(
                  "flex items-center gap-2 text-sm font-medium w-full text-left",
                  "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                )}
              >
                {rateLimitExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Rate limit
                {formData.config.rateLimit.enabled && <Badge variant="secondary" className="text-xs font-normal">On</Badge>}
              </button>
              {rateLimitExpanded && (
                <div className="pl-6 pt-1 space-y-3 border-l-2 border-gray-200 dark:border-slate-600 ml-1">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="rateLimitEnabled" checked={formData.config.rateLimit.enabled} onChange={(e) => updateConfig("rateLimit", "enabled", e.target.checked)} className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-800" />
                    <label htmlFor="rateLimitEnabled" className="text-sm text-gray-700 dark:text-gray-300">Enable rate limit</label>
                  </div>
                  {formData.config.rateLimit.enabled && (
                    <div className="grid grid-cols-2 gap-4">
                      <FormField label="Actions per minute" htmlFor="rpm" error={errors.rpm}>
                        <Input id="rpm" type="number" min={1} value={formData.config.rateLimit.actionsPerMinute} onChange={(e) => updateConfig("rateLimit", "actionsPerMinute", parseInt(e.target.value, 10) || 1)} />
                      </FormField>
                      <FormField label="Burst" htmlFor="burst">
                        <Input id="burst" type="number" min={1} value={formData.config.rateLimit.burst} onChange={(e) => updateConfig("rateLimit", "burst", parseInt(e.target.value, 10) || 1)} />
                      </FormField>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Timing — collapsible + enable (like portal) */}
            <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30 p-3 space-y-2">
              <button
                type="button"
                onClick={() => setTimingExpanded(!timingExpanded)}
                className={cn(
                  "flex items-center gap-2 text-sm font-medium w-full text-left",
                  "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                )}
              >
                {timingExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Timing
                {timingEnabled && <Badge variant="secondary" className="text-xs font-normal">On</Badge>}
              </button>
              {timingExpanded && (
                <div className="pl-6 pt-1 space-y-3 border-l-2 border-gray-200 dark:border-slate-600 ml-1">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="timingEnabled" checked={timingEnabled} onChange={(e) => setTimingEnabled(e.target.checked)} className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-800" />
                    <label htmlFor="timingEnabled" className="text-sm text-gray-700 dark:text-gray-300">Enable min run duration</label>
                  </div>
                  {timingEnabled && (
                    <FormField label="Min run duration (ms)" htmlFor="minRunDuration" hint="Same as portal">
                      <Input id="minRunDuration" type="number" min={0} value={formData.config.minRunDurationMs ?? ""} onChange={(e) => { const v = e.target.value; setFormData((prev) => ({ ...prev, config: { ...prev.config, minRunDurationMs: v === "" ? undefined : parseInt(v, 10) || 0 } })); }} placeholder="Leave empty to disable" />
                    </FormField>
                  )}
                </div>
              )}
            </div>

            {/* Mouse — collapsible + enable (like portal) */}
            <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30 p-3 space-y-2">
              <button
                type="button"
                onClick={() => setMouseExpanded(!mouseExpanded)}
                className={cn(
                  "flex items-center gap-2 text-sm font-medium w-full text-left",
                  "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                )}
              >
                {mouseExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Mouse movement
                {mouseEnabled && <Badge variant="secondary" className="text-xs font-normal">On</Badge>}
              </button>
              {mouseExpanded && (
                <div className="pl-6 pt-1 space-y-3 border-l-2 border-gray-200 dark:border-slate-600 ml-1">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="mouseEnabled" checked={mouseEnabled} onChange={(e) => setMouseEnabled(e.target.checked)} className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-800" />
                    <label htmlFor="mouseEnabled" className="text-sm text-gray-700 dark:text-gray-300">Enable human-like mouse</label>
                  </div>
                  {mouseEnabled && (
                    <FormField label="Mouse move interval (ms)" htmlFor="mouseMoveInterval" hint="Same as portal">
                      <Input id="mouseMoveInterval" type="number" min={0} value={formData.config.mouseMoveIntervalMs ?? ""} onChange={(e) => { const v = e.target.value; setFormData((prev) => ({ ...prev, config: { ...prev.config, mouseMoveIntervalMs: v === "" ? undefined : parseInt(v, 10) || 0 } })); }} placeholder="Leave empty to disable" />
                    </FormField>
                  )}
                </div>
              )}
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
