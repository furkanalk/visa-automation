"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cpApi } from "@/lib/api";
import { Save, RefreshCw, Building, Loader2, Globe, FlaskConical, ExternalLink, Briefcase, ScrollText, Settings, ChevronDown, ChevronRight, AlertCircle, RotateCcw, Sliders } from "lucide-react";
import { SaveBanner } from "@/components/ui/save-banner";
import { useAuthStore } from "@/stores/auth";
import { settingsApi, type SystemSetting } from "@/lib/api";

const DEFAULT_MOCK_URLS: Record<string, string> = {};

type SettingsTab = "general" | "mock" | "queue" | "audit" | "config";

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    tabParam === "mock" ? "mock" : tabParam === "queue" ? "queue" : tabParam === "audit" ? "audit" : tabParam === "config" ? "config" : "general"
  );
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (tabParam === "mock") setActiveTab("mock");
    else if (tabParam === "queue") setActiveTab("queue");
    else if (tabParam === "audit") setActiveTab("audit");
    else if (tabParam === "config") setActiveTab("config");
  }, [tabParam]);

  // API settings (stored in localStorage)
  const [cpApiUrl, setCpApiUrl] = useState("");
  const [publicApiUrl, setPublicApiUrl] = useState("");
  const [adminPortalUrl, setAdminPortalUrl] = useState("");

  // Load settings from localStorage
  useEffect(() => {
    setCpApiUrl(localStorage.getItem("cp_api_url") || process.env.NEXT_PUBLIC_CP_API_URL || "http://localhost:3001");
    setPublicApiUrl(localStorage.getItem("public_api_url") || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000");
  }, []);

  // Load admin_portal_url from DB
  useEffect(() => {
    cpApi.settings.getCategory("general")
      .then((cat) => {
        const val = cat?.admin_portal_url;
        if (val && typeof val === "string") setAdminPortalUrl(val);
        else setAdminPortalUrl(process.env.NEXT_PUBLIC_CP_API_URL?.replace(":3001", ":3000") ?? "http://localhost:3000");
      })
      .catch(() => setAdminPortalUrl("http://localhost:3000"));
  }, []);

  const handleSaveApiSettings = () => {
    // Only Admin Portal URL is user-editable here (stored in DB, read by CP for invite emails).
    // CP API URL and Public API URL come from build-time env vars — read-only.
    if (adminPortalUrl.trim()) {
      cpApi.settings.setValue("general", "admin_portal_url", adminPortalUrl.trim())
        .catch(() => {});
    }
    setSaveMessage({ type: "success", text: "Saved." });
    setTimeout(() => setSaveMessage(null), 5000);
  };

  // ── Config tab state ──────────────────────────────────────────────────────
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [editedValues, setEditedValues] = useState<Map<string, { category: string; key: string; value: unknown; originalValue: unknown }>>(new Map());

  const { data: allSettings, isLoading: configLoading, isError: configError, error: configErr, refetch: refetchConfig } = useQuery({
    queryKey: ["system-settings"],
    queryFn: () => settingsApi.getList(),
    enabled: activeTab === "config",
  });

  const configSaveMutation = useMutation({
    mutationFn: async (updates: Array<{ category: string; key: string; value: unknown }>) => {
      await settingsApi.bulkUpdate(updates);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["system-settings"] });
      setEditedValues(new Map());
      setSaveMessage({ type: "success", text: "Settings saved successfully." });
      setTimeout(() => setSaveMessage(null), 5000);
    },
    onError: (err) => {
      setSaveMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save." });
      setTimeout(() => setSaveMessage(null), 5000);
    },
  });

  const groupedSettings = (() => {
    if (!allSettings?.items) return new Map<string, SystemSetting[]>();
    const seen = new Set<string>();
    const grouped = new Map<string, SystemSetting[]>();
    for (const setting of allSettings.items) {
      const k = `${setting.category}.${setting.key}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!grouped.has(setting.category)) grouped.set(setting.category, []);
      grouped.get(setting.category)!.push(setting);
    }
    return grouped;
  })();

  const getEditKey = (cat: string, key: string) => `${cat}.${key}`;

  const handleConfigValueChange = (setting: SystemSetting, newValue: string) => {
    const editKey = getEditKey(setting.category, setting.key);
    let parsed: unknown = newValue;
    if (setting.value_type === "number") parsed = parseFloat(newValue) || 0;
    else if (setting.value_type === "boolean") parsed = newValue === "true";
    else if (setting.value_type === "json" || setting.value_type === "array") {
      try { parsed = JSON.parse(newValue); } catch { parsed = newValue; }
    }
    if (JSON.stringify(parsed) === JSON.stringify(setting.value)) {
      const next = new Map(editedValues); next.delete(editKey); setEditedValues(next);
    } else {
      setEditedValues(new Map(editedValues).set(editKey, { category: setting.category, key: setting.key, value: parsed, originalValue: setting.value }));
    }
  };

  const getConfigDisplayValue = (setting: SystemSetting): string => {
    const ed = editedValues.get(getEditKey(setting.category, setting.key));
    const val = ed ? ed.value : setting.value;
    if (setting.value_type === "json" || setting.value_type === "array") return JSON.stringify(val, null, 2);
    return String(val);
  };

  const getDisplayType = (setting: SystemSetting): string => {
    if (setting.value_type === "boolean") return "boolean";
    if (setting.value_type === "json") return "json";
    if (setting.value_type === "array") return "array";
    if (setting.value_type === "string") return "string";
    if (setting.value_type === "number") {
      const val = editedValues.get(getEditKey(setting.category, setting.key))?.value ?? setting.value;
      const n = typeof val === "number" ? val : Number(val);
      return Number.isInteger(n) ? "integer" : "float";
    }
    return setting.value_type;
  };

  const getUnit = (setting: SystemSetting): string | null => {
    const k = setting.key.toLowerCase();
    const d = (setting.description ?? "").toLowerCase();
    if (k.endsWith("_ms") || d.includes("millisecond")) return "ms";
    if (k.endsWith("_seconds") || k.includes("ttl_seconds") || d.includes("second")) return "s";
    if (k.includes("_minutes") || d.includes("minute")) return "min";
    if (k.includes("_hours") || d.includes("hour")) return "h";
    if (k.includes("viewport_width") || k.includes("viewport_height")) return "px";
    if (k.includes("per_minute") || k.includes("actions_per_minute")) return "/min";
    return null;
  };

  const getCategoryDescription = (category: string): string => {
    const map: Record<string, string> = {
      system: "Agent-pool (async/sync counts, max per worker), heartbeat, config refresh",
      job: "Job processing and retry settings",
      queue: "Queue management and retention",
      portal: "Portal automation timeouts and pacing",
      slot_hunt: "Slot hunting behavior",
      hitl: "Human-in-the-loop settings",
      notify: "Notification deduplication",
      browser: "Browser viewport settings",
      pagination: "API pagination defaults",
      watcher: "Site drift watcher",
      audit: "Audit log settings",
      features: "Feature flags",
      fsm: "State machine settings",
      health: "Health check parameters",
    };
    return map[category] ?? "Configuration settings";
  };

  // Mock tab: settings and portals
  const { data: mockSettings, isLoading: mockLoading } = useQuery({
    queryKey: ["settings", "mock"],
    queryFn: () => cpApi.settings.getCategory("mock"),
  });
  const { data: portalsData } = useQuery({
    queryKey: ["portals"],
    queryFn: () => cpApi.getPortals(),
  });
  const portals = portalsData?.items ?? [];
  const [mockEnabled, setMockEnabled] = useState(false);
  const [mockDefaultBaseUrl, setMockDefaultBaseUrl] = useState("");
  const [portalUrls, setPortalUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (mockSettings) {
      setMockEnabled(mockSettings.enabled === true || mockSettings.enabled === "true");
      setMockDefaultBaseUrl(typeof mockSettings.default_base_url === "string" ? mockSettings.default_base_url : "");
      const urls = mockSettings.portal_urls as Record<string, string> | undefined;
      setPortalUrls(urls && typeof urls === "object" ? { ...urls } : {});
    }
  }, [mockSettings]);
  // Mock portal slot availability toggles (proxied through CP to avoid browser Docker DNS issues)
  const [slotAvailability, setSlotAvailability] = useState<Record<string, boolean>>({});
  const [slotTogglePending, setSlotTogglePending] = useState<Record<string, boolean>>({});

  // Fetch current slot availability via CP proxy
  const { data: mockSlotData } = useQuery({
    queryKey: ['cp-mock-portal-config', 'as-visa'],
    queryFn: () => cpApi.mockPortal.getConfig('as-visa'),
    enabled: activeTab === 'mock',
    retry: false,
  });

  useEffect(() => {
    if (mockSlotData?.slots) {
      setSlotAvailability((prev) => ({ ...prev, 'as-visa': mockSlotData.slots.hasAvailability ?? false }));
    }
  }, [mockSlotData]);

  const toggleSlotAvailability = async (portalId: string, value: boolean) => {
    setSlotTogglePending((p) => ({ ...p, [portalId]: true }));
    try {
      await cpApi.mockPortal.setConfig(portalId, { slots: { hasAvailability: value } });
      setSlotAvailability((prev) => ({ ...prev, [portalId]: value }));
      void queryClient.invalidateQueries({ queryKey: ['cp-mock-portal-config', portalId] });
    } finally {
      setSlotTogglePending((p) => ({ ...p, [portalId]: false }));
    }
  };

  const mockSaveMutation = useMutation({    mutationFn: async () => {
      const updates = [
        { category: "mock", key: "enabled", value: mockEnabled },
        // default_base_url is read-only (set via MOCK_PORTAL_BASE_URL env var)
        { category: "mock", key: "portal_urls", value: portalUrls },
      ];
      await cpApi.settings.bulkUpdate(updates);
    },
    onSuccess: () => {
      const nextMock = { enabled: mockEnabled, default_base_url: mockDefaultBaseUrl || undefined, portal_urls: portalUrls };
      queryClient.setQueryData(["settings", "mock"], nextMock);
      queryClient.invalidateQueries({ queryKey: ["settings", "mock"] });
      setSaveMessage({ type: "success", text: "Mock settings saved." });
      setTimeout(() => setSaveMessage(null), 5000);
    },
    onError: (err) => {
      setSaveMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save mock settings." });
      setTimeout(() => setSaveMessage(null), 5000);
    },
  });
  const setPortalUrl = (portalId: string, url: string) => {
    setPortalUrls((prev) => (url.trim() ? { ...prev, [portalId]: url.trim() } : (() => { const n = { ...prev }; delete n[portalId]; return n; })()));
  };

  // Queue tab: global job/queue retention (super_admin only)
  const { data: globalSettings } = useQuery({
    queryKey: ["settings", "global"],
    queryFn: () => cpApi.settings.getGlobalSettings(),
    enabled: activeTab === "queue" || activeTab === "audit",
  });
  const [queueForm, setQueueForm] = useState({
    completed_retention_hours: 24,
    failed_retention_hours: 168,
    completed_max_count: 1000,
    failed_max_count: 5000,
  });
  useEffect(() => {
    if (activeTab !== "queue" || !globalSettings?.items?.length) return;
    const queue = globalSettings.items.filter((s) => s.category === "queue");
    const num = (key: string, d: number) => {
      const s = queue.find((x) => x.key === key);
      if (s?.value == null) return d;
      return typeof s.value === "number" ? s.value : parseInt(String(s.value), 10) || d;
    };
    setQueueForm({
      completed_retention_hours: num("completed_retention_hours", 24),
      failed_retention_hours: num("failed_retention_hours", 168),
      completed_max_count: num("completed_max_count", 1000),
      failed_max_count: num("failed_max_count", 5000),
    });
  }, [activeTab, globalSettings?.items]);

  const [auditForm, setAuditForm] = useState({ retention_days: 90 });
  useEffect(() => {
    if (activeTab !== "audit" || !globalSettings?.items?.length) return;
    const audit = globalSettings.items.filter((s) => s.category === "audit");
    const s = audit.find((x) => x.key === "retention_days");
    const val = s?.value != null ? (typeof s.value === "number" ? s.value : parseInt(String(s.value), 10) || 90) : 90;
    setAuditForm({ retention_days: Math.max(1, Math.min(365, val)) });
  }, [activeTab, globalSettings?.items]);
  const auditSaveMutation = useMutation({
    mutationFn: async () => {
      await cpApi.settings.setGlobalValue("audit", "retention_days", auditForm.retention_days);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "global"] });
      setSaveMessage({ type: "success", text: "Audit retention saved. Next prune run will use the new value." });
      setTimeout(() => setSaveMessage(null), 5000);
    },
    onError: (err) => {
      setSaveMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save." });
      setTimeout(() => setSaveMessage(null), 5000);
    },
  });

  const queueSaveMutation = useMutation({
    mutationFn: async () => {
      await cpApi.settings.setGlobalValue("queue", "completed_retention_hours", queueForm.completed_retention_hours);
      await cpApi.settings.setGlobalValue("queue", "failed_retention_hours", queueForm.failed_retention_hours);
      await cpApi.settings.setGlobalValue("queue", "completed_max_count", queueForm.completed_max_count);
      await cpApi.settings.setGlobalValue("queue", "failed_max_count", queueForm.failed_max_count);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "global"] });
      setSaveMessage({ type: "success", text: "Queue settings saved. Restart CP for new retention to apply to queue options." });
      setTimeout(() => setSaveMessage(null), 5000);
    },
    onError: (err) => {
      setSaveMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save." });
      setTimeout(() => setSaveMessage(null), 5000);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-gray-500 dark:text-gray-400">System configuration</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-slate-700">
        <button
          type="button"
          onClick={() => setActiveTab("general")}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
            activeTab === "general"
              ? "bg-white dark:bg-slate-800 text-gray-900 dark:text-white border border-b-0 border-gray-200 dark:border-slate-700"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          General
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("mock")}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-1.5 ${
            activeTab === "mock"
              ? "bg-white dark:bg-slate-800 text-gray-900 dark:text-white border border-b-0 border-gray-200 dark:border-slate-700"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          <FlaskConical className="h-4 w-4" />
          Mock
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("queue")}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-1.5 ${
            activeTab === "queue"
              ? "bg-white dark:bg-slate-800 text-gray-900 dark:text-white border border-b-0 border-gray-200 dark:border-slate-700"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          <Briefcase className="h-4 w-4" />
          Queue
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("audit")}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-1.5 ${
            activeTab === "audit"
              ? "bg-white dark:bg-slate-800 text-gray-900 dark:text-white border border-b-0 border-gray-200 dark:border-slate-700"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          <ScrollText className="h-4 w-4" />
          Audit
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("config")}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-1.5 ${
            activeTab === "config"
              ? "bg-white dark:bg-slate-800 text-gray-900 dark:text-white border border-b-0 border-gray-200 dark:border-slate-700"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          <Sliders className="h-4 w-4" />
          Config
        </button>
      </div>

      <SaveBanner message={saveMessage} onDismiss={() => setSaveMessage(null)} />

      {activeTab === "mock" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
                <FlaskConical className="h-5 w-5" />
                Mock mode
              </CardTitle>
              <CardDescription>
                When enabled, workers use the mock URLs below instead of each portal&apos;s real base URL. Use this for testing against the mock portal (e.g. npm run dev:mock).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mockEnabled}
                  onChange={(e) => setMockEnabled(e.target.checked)}
                  className="rounded border-gray-300 dark:border-slate-600 h-4 w-4"
                />
                <span className="text-sm font-medium text-gray-900 dark:text-gray-300">Use mock portals</span>
              </label>
              <p className="text-xs text-muted-foreground bg-muted/50 dark:bg-slate-800/50 rounded px-2 py-1.5">
                When ON, workers (DP) get portal config from CP and receive the mock URLs below instead of production. Toggle OFF to use real portal URLs again.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Default base URL</label>
                {/* <p className="text-xs text-muted-foreground mb-2">
                  Read-only — set via <code>MOCK_PORTAL_BASE_URL</code> env var in DP container (requires restart).
                  Workers get <code>base + "/" + portal_id</code> automatically: adding a new portal needs no env change.
                </p> */}
                <Input
                  value={mockDefaultBaseUrl}
                  disabled
                  placeholder="http://mock-portal:3004"
                  className="max-w-md mb-4 font-mono text-xs bg-gray-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Mock portal URLs (overrides)</h4>
                <p className="text-xs text-muted-foreground mb-3">Optional per-portal URL override. Leave empty to use Default base URL + /portal_id automatically.</p>
                {mockLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </div>
                ) : (
                  <div className="space-y-3">
                    {portals.length === 0 ? (
                      <p className="text-sm text-gray-500">No portals configured. Add portals under Portals first.</p>
                    ) : (
                      portals.map((portal: { portal_id: string; name: string }) => (
                        <div key={portal.portal_id} className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-28 shrink-0">{portal.name}</span>
                          <Input
                            value={portalUrls[portal.portal_id] ?? ""}
                            onChange={(e) => setPortalUrl(portal.portal_id, e.target.value)}
                            placeholder={DEFAULT_MOCK_URLS[portal.portal_id] ?? "https://mock.example.com/" + portal.portal_id}
                            className="max-w-md flex-1 min-w-[200px]"
                          />
                          {DEFAULT_MOCK_URLS[portal.portal_id] && (
                            <a
                              href={(portalUrls[portal.portal_id] || DEFAULT_MOCK_URLS[portal.portal_id]).replace(/\/$/, "")}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Open
                            </a>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              <Button onClick={() => mockSaveMutation.mutate()} disabled={mockSaveMutation.isPending}>
                {mockSaveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Save mock settings
              </Button>
            </CardContent>
          </Card>

          {/* Slot availability toggles (calls mock portal API directly) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
                <FlaskConical className="h-5 w-5" />
                Mock portal slot availability
              </CardTitle>
              <CardDescription>
                Toggle whether each mock portal returns open appointment slots. Calls the mock portal&apos;s own API directly.
                Requires mock portal to be running and reachable at the configured URL above.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {portals.length === 0 ? (
                <p className="text-sm text-gray-500">No portals configured.</p>
              ) : (
                portals.map((portal: { portal_id: string; name: string }) => {
                  const hasSlots = slotAvailability[portal.portal_id] ?? false;
                  const pending = slotTogglePending[portal.portal_id] ?? false;
                  return (
                    <div key={portal.portal_id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-slate-800/50">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{portal.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {hasSlots
                            ? '🟢 Slots available — dateDisabled empty, all days open'
                            : '🔴 No slots — all days blocked'}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => toggleSlotAvailability(portal.portal_id, !hasSlots)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                          hasSlots ? 'bg-green-500' : 'bg-gray-300 dark:bg-slate-600'
                        } ${pending ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            hasSlots ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })
              )}
              <p className="text-xs text-muted-foreground bg-muted/50 dark:bg-slate-800/50 rounded px-2 py-1.5">
                Changes take effect immediately on the mock portal — no restart needed. The DP agent picks up the new state on the next poll cycle.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "queue" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
                <Briefcase className="h-5 w-5" />
                Queue &amp; job retention
              </CardTitle>
              <CardDescription>
                How long to keep completed and failed jobs in the queue (BullMQ). Only super_admin can change. CP restart may be needed for new retention to apply to queue options.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {user?.role !== "super_admin" ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">You need super_admin role to edit these settings.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Completed jobs retention (hours)</label>
                      <Input
                        type="number"
                        min={1}
                        max={8760}
                        value={queueForm.completed_retention_hours}
                        onChange={(e) => setQueueForm((f) => ({ ...f, completed_retention_hours: Math.max(1, parseInt(e.target.value, 10) || 24) }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Failed jobs retention (hours)</label>
                      <Input
                        type="number"
                        min={1}
                        max={8760}
                        value={queueForm.failed_retention_hours}
                        onChange={(e) => setQueueForm((f) => ({ ...f, failed_retention_hours: Math.max(1, parseInt(e.target.value, 10) || 168) }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max completed jobs to retain</label>
                      <Input
                        type="number"
                        min={100}
                        value={queueForm.completed_max_count}
                        onChange={(e) => setQueueForm((f) => ({ ...f, completed_max_count: Math.max(100, parseInt(e.target.value, 10) || 1000) }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max failed jobs to retain</label>
                      <Input
                        type="number"
                        min={100}
                        value={queueForm.failed_max_count}
                        onChange={(e) => setQueueForm((f) => ({ ...f, failed_max_count: Math.max(100, parseInt(e.target.value, 10) || 5000) }))}
                      />
                    </div>
                  </div>
                  <Button onClick={() => queueSaveMutation.mutate()} disabled={queueSaveMutation.isPending}>
                    {queueSaveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                    Save queue settings
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "audit" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
                <ScrollText className="h-5 w-5" />
                Audit log retention
              </CardTitle>
              <CardDescription>
                How many days to keep audit logs. Older entries are pruned daily. Only super_admin can change.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {user?.role !== "super_admin" ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">You need super_admin role to edit this setting.</p>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Retention (days)</label>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={auditForm.retention_days}
                      onChange={(e) =>
                        setAuditForm((f) => ({ ...f, retention_days: Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 90)) }))
                      }
                      className="max-w-xs"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">1–365 days. Default: 90.</p>
                  </div>
                  <Button onClick={() => auditSaveMutation.mutate()} disabled={auditSaveMutation.isPending}>
                    {auditSaveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                    Save audit retention
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "general" && (
      <div className="grid gap-6 md:grid-cols-2">
        {/* API Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
              <Globe className="h-5 w-5" />
              API Configuration
            </CardTitle>
            <CardDescription>Configure API endpoints</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Control Plane API URL</label>
              <Input
                value={cpApiUrl}
                disabled
                className="mt-1 font-mono text-xs bg-gray-50 dark:bg-slate-800"
              />
              {/* <p className="text-xs text-gray-400 mt-1">Set via <code>NEXT_PUBLIC_CP_API_URL</code> env var (build-time).</p> */}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Public API URL</label>
              <Input
                value={publicApiUrl}
                disabled
                className="mt-1 font-mono text-xs bg-gray-50 dark:bg-slate-800"
              />
              {/* <p className="text-xs text-gray-400 mt-1">Set via <code>NEXT_PUBLIC_API_URL</code> env var (build-time).</p> */}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Admin Portal URL</label>
              <Input
                value={adminPortalUrl}
                onChange={(e) => setAdminPortalUrl(e.target.value)}
                placeholder="http://localhost:3000"
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">
                Used in staff invite emails. Must be reachable by the email recipient (e.g. <code>https://admin.vizeself.com</code>).
              </p>
            </div>
            <Button onClick={handleSaveApiSettings}>
              <Save className="h-4 w-4 mr-1" />
              Save
            </Button>
          </CardContent>
        </Card>

        {/* Current User */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
              <Building className="h-5 w-5" />
              Current Session
            </CardTitle>
            <CardDescription>Your current session information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">User</label>
              <Input value={user?.name || "Unknown"} disabled className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Role</label>
              <div className="mt-1">
                <Badge variant={user?.role === "super_admin" ? "default" : "secondary"}>
                  {user?.role || "Unknown"}
                </Badge>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tenant ID</label>
              <Input value="default" disabled className="mt-1" />
            </div>
          </CardContent>
        </Card>

      </div>
      )}

      {activeTab === "config" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Runtime-configurable settings stored in DB. Changes take effect without restart (CP polls for updates).
            </p>
            <div className="flex items-center gap-2">
              {editedValues.size > 0 && (
                <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-900/20">
                  {editedValues.size} unsaved change{editedValues.size !== 1 ? "s" : ""}
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchConfig()}
                disabled={configLoading}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Refresh
              </Button>
              <Button
                onClick={() => configSaveMutation.mutate(Array.from(editedValues.values()).map((v) => ({ category: v.category, key: v.key, value: v.value })))}
                disabled={editedValues.size === 0 || configSaveMutation.isPending}
                size="sm"
              >
                {configSaveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Save Changes
              </Button>
            </div>
          </div>

          {configLoading && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Loading configuration…</p>
              </CardContent>
            </Card>
          )}
          {configError && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
                <p className="text-gray-500 dark:text-gray-400 font-medium">Failed to load configuration</p>
                <p className="text-sm text-gray-400 mt-1 text-center max-w-md">
                  {configErr instanceof Error ? configErr.message : "API server may be unavailable"}
                </p>
                <Button variant="outline" onClick={() => refetchConfig()} className="mt-4">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
              </CardContent>
            </Card>
          )}

          {!configLoading && !configError && Array.from(groupedSettings.entries()).map(([category, categorySettings]) => (
            <Card key={category}>
              <CardHeader
                className="cursor-pointer hover:bg-muted/50 transition-colors py-3"
                onClick={() => {
                  setExpandedCategories((prev) => {
                    const next = new Set(prev);
                    next.has(category) ? next.delete(category) : next.add(category);
                    return next;
                  });
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {expandedCategories.has(category) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-sm capitalize">{category.replace(/_/g, " ")}</CardTitle>
                    <Badge variant="secondary" className="ml-1 text-xs">{categorySettings.length}</Badge>
                  </div>
                  <CardDescription className="text-xs">{getCategoryDescription(category)}</CardDescription>
                </div>
              </CardHeader>

              {expandedCategories.has(category) && (
                <CardContent>
                  <div className="space-y-3">
                    {categorySettings.map((setting) => {
                      const editKey = getEditKey(setting.category, setting.key);
                      const isEdited = editedValues.has(editKey);
                      return (
                        <div
                          key={setting.id}
                          className={`p-3 rounded-lg border ${isEdited ? "border-yellow-300 bg-yellow-50/50 dark:border-yellow-600 dark:bg-yellow-900/20" : "border-border"}`}
                        >
                          <div className="flex items-start justify-between gap-4 mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-sm font-medium">{setting.key}</span>
                              <Badge variant="outline" className="text-xs">{getDisplayType(setting)}</Badge>
                              {getUnit(setting) && <span className="text-xs text-gray-500 font-mono">({getUnit(setting)})</span>}
                              {setting.isGlobal && <Badge variant="secondary" className="text-xs">Global</Badge>}
                              {setting.is_sensitive && <Badge variant="destructive" className="text-xs">Sensitive</Badge>}
                            </div>
                            {isEdited && (
                              <Button variant="ghost" size="sm" onClick={() => { const next = new Map(editedValues); next.delete(editKey); setEditedValues(next); }}>
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                          {setting.description && <p className="text-xs text-muted-foreground mb-2">{setting.description}</p>}
                          <div className="mt-1">
                            {setting.value_type === "boolean" ? (
                              <select
                                className="w-full px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 text-sm outline-none focus:ring-2 focus:ring-blue-400"
                                value={getConfigDisplayValue(setting)}
                                onChange={(e) => handleConfigValueChange(setting, e.target.value)}
                              >
                                <option value="true">true</option>
                                <option value="false">false</option>
                              </select>
                            ) : setting.value_type === "json" || setting.value_type === "array" ? (
                              <textarea
                                className="w-full px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 text-sm outline-none focus:ring-2 focus:ring-blue-400 font-mono min-h-[80px]"
                                value={getConfigDisplayValue(setting)}
                                onChange={(e) => handleConfigValueChange(setting, e.target.value)}
                              />
                            ) : (
                              <div className="flex items-center gap-2">
                                <Input
                                  type={setting.value_type === "number" ? "number" : "text"}
                                  value={getConfigDisplayValue(setting)}
                                  onChange={(e) => handleConfigValueChange(setting, e.target.value)}
                                  className="font-mono text-sm flex-1"
                                />
                                {getUnit(setting) && <span className="text-xs text-gray-500 font-medium shrink-0 w-8">{getUnit(setting)}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
