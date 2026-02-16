"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { settingsApi, type SystemSetting } from "@/lib/api";
import {
  Save,
  CheckCircle,
  Loader2,
  Settings,
  ChevronDown,
  ChevronRight,
  Edit2,
  RotateCcw,
  AlertCircle,
  Globe,
  Building,
  RefreshCw,
} from "lucide-react";

interface EditedValue {
  category: string;
  key: string;
  value: unknown;
  originalValue: unknown;
}

export default function ConfigPage() {
  const queryClient = useQueryClient();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [editedValues, setEditedValues] = useState<Map<string, EditedValue>>(new Map());
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Fetch all settings
  const { data: settings, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["system-settings"],
    queryFn: () => settingsApi.getList(),
  });

  // Fetch categories
  const { data: categories } = useQuery({
    queryKey: ["settings-categories"],
    queryFn: () => settingsApi.getCategories(),
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (updates: Array<{ category: string; key: string; value: unknown }>) => {
      await settingsApi.bulkUpdate(updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-settings"] });
      setEditedValues(new Map());
      setSaveMessage({ type: "success", text: "Settings saved successfully" });
      setTimeout(() => setSaveMessage(null), 3000);
    },
    onError: (error) => {
      setSaveMessage({ type: "error", text: `Failed to save: ${error}` });
    },
  });

  // Group settings by category (dedupe by category+key so each setting appears once)
  const groupedSettings = React.useMemo(() => {
    if (!settings?.items) return new Map<string, SystemSetting[]>();
    const seen = new Set<string>();
    const grouped = new Map<string, SystemSetting[]>();
    for (const setting of settings.items) {
      const key = `${setting.category}.${setting.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!grouped.has(setting.category)) {
        grouped.set(setting.category, []);
      }
      grouped.get(setting.category)!.push(setting);
    }
    return grouped;
  }, [settings]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const getEditKey = (category: string, key: string) => `${category}.${key}`;

  const handleValueChange = (setting: SystemSetting, newValue: string) => {
    const editKey = getEditKey(setting.category, setting.key);
    let parsedValue: unknown = newValue;

    // Parse based on value type
    if (setting.value_type === "number") {
      parsedValue = parseFloat(newValue) || 0;
    } else if (setting.value_type === "boolean") {
      parsedValue = newValue === "true";
    } else if (setting.value_type === "json" || setting.value_type === "array") {
      try {
        parsedValue = JSON.parse(newValue);
      } catch {
        parsedValue = newValue;
      }
    }

    // Check if value is different from original
    const originalValue = setting.value;
    if (JSON.stringify(parsedValue) === JSON.stringify(originalValue)) {
      editedValues.delete(editKey);
      setEditedValues(new Map(editedValues));
    } else {
      setEditedValues(new Map(editedValues.set(editKey, {
        category: setting.category,
        key: setting.key,
        value: parsedValue,
        originalValue,
      })));
    }
  };

  const handleResetValue = (setting: SystemSetting) => {
    const editKey = getEditKey(setting.category, setting.key);
    editedValues.delete(editKey);
    setEditedValues(new Map(editedValues));
  };

  const handleSaveAll = () => {
    const updates = Array.from(editedValues.values()).map((v) => ({
      category: v.category,
      key: v.key,
      value: v.value,
    }));
    saveMutation.mutate(updates);
  };

  const getDisplayValue = (setting: SystemSetting): string => {
    const editKey = getEditKey(setting.category, setting.key);
    const edited = editedValues.get(editKey);
    const value = edited ? edited.value : setting.value;
    
    if (setting.value_type === "json" || setting.value_type === "array") {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  };

  /** Display type for UI: integer, float, boolean, string, json, array */
  const getDisplayType = (setting: SystemSetting): string => {
    if (setting.value_type === "boolean") return "boolean";
    if (setting.value_type === "json") return "json";
    if (setting.value_type === "array") return "array";
    if (setting.value_type === "string") return "string";
    if (setting.value_type === "number") {
      const editKey = getEditKey(setting.category, setting.key);
      const edited = editedValues.get(editKey);
      const value = edited ? edited.value : setting.value;
      const n = typeof value === "number" ? value : Number(value);
      return Number.isInteger(n) ? "integer" : "float";
    }
    return setting.value_type;
  };

  /** Infer unit from key (and optionally description) for display */
  const getUnit = (setting: SystemSetting): string | null => {
    const k = setting.key.toLowerCase();
    const d = (setting.description ?? "").toLowerCase();
    if (k.endsWith("_ms") || k.includes("_ms") || d.includes("millisecond")) return "ms";
    if (k.endsWith("_seconds") || k.includes("_seconds") || k.includes("ttl_seconds") || d.includes("second")) return "s";
    if (k.includes("_minutes") || k.includes("timeout_minutes") || d.includes("minute")) return "min";
    if (k.includes("_hours") || k.includes("retention_hours") || d.includes("hour")) return "h";
    if (k.includes("viewport_width") || k.includes("viewport_height") || d.includes("viewport")) return "px";
    if (k.includes("per_minute") || k.includes("actions_per_minute")) return "/min";
    return null;
  };

  const getCategoryIcon = (category: string) => {
    const icons: Record<string, React.ReactNode> = {
      system: <Settings className="h-4 w-4" />,
      job: <AlertCircle className="h-4 w-4" />,
      portal: <Globe className="h-4 w-4" />,
      hitl: <Building className="h-4 w-4" />,
    };
    return icons[category] || <Settings className="h-4 w-4" />;
  };

  const getCategoryDescription = (category: string) => {
    const descriptions: Record<string, string> = {
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
    return descriptions[category] || "Configuration settings";
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">System Configuration</h1>
          <p className="text-muted-foreground">Manage system-wide settings and defaults</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-gray-500 dark:text-gray-400">Loading configuration...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">System Configuration</h1>
          <p className="text-muted-foreground">Manage system-wide settings and defaults</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">Failed to load configuration</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 text-center max-w-md">
              {error instanceof Error ? error.message : "API server may be unavailable"}
            </p>
            <Button variant="outline" onClick={() => refetch()} className="mt-4">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">System Configuration</h1>
          <p className="text-muted-foreground">
            Manage runtime-configurable settings stored in the database
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editedValues.size > 0 && (
            <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-900/20">
              {editedValues.size} unsaved changes
            </Badge>
          )}
          <Button
            onClick={handleSaveAll}
            disabled={editedValues.size === 0 || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>
      </div>

      {/* Save Message */}
      {saveMessage && (
        <div
          className={`p-3 rounded-md flex items-center gap-2 ${
            saveMessage.type === "success"
              ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
              : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
          }`}
        >
          {saveMessage.type === "success" ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          {saveMessage.text}
        </div>
      )}

      {/* Categories */}
      <div className="space-y-4">
        {Array.from(groupedSettings.entries()).map(([category, categorySettings]) => (
          <Card key={category}>
            <CardHeader
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => toggleCategory(category)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {expandedCategories.has(category) ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  {getCategoryIcon(category)}
                  <CardTitle className="capitalize">{category.replace(/_/g, " ")}</CardTitle>
                  <Badge variant="secondary" className="ml-2">
                    {categorySettings.length}
                  </Badge>
                </div>
                <CardDescription>{getCategoryDescription(category)}</CardDescription>
              </div>
            </CardHeader>

            {expandedCategories.has(category) && (
              <CardContent>
                <div className="space-y-4">
                  {categorySettings.map((setting) => {
                    const editKey = getEditKey(setting.category, setting.key);
                    const isEdited = editedValues.has(editKey);

                    return (
                      <div
                        key={setting.id}
                        className={`p-4 rounded-lg border ${
                          isEdited
                            ? "border-yellow-300 bg-yellow-50/50 dark:border-yellow-600 dark:bg-yellow-900/20"
                            : "border-border"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-sm font-medium">
                                {setting.key}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {getDisplayType(setting)}
                              </Badge>
                              {getUnit(setting) && (
                                <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                                  ({getUnit(setting)})
                                </span>
                              )}
                              {setting.isGlobal && (
                                <Badge variant="secondary" className="text-xs">
                                  Global
                                </Badge>
                              )}
                              {setting.is_sensitive && (
                                <Badge variant="destructive" className="text-xs">
                                  Sensitive
                                </Badge>
                              )}
                            </div>
                            {setting.description && (
                              <p className="text-sm text-muted-foreground mt-1">
                                {setting.description}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {isEdited && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleResetValue(setting)}
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>

                        <div className="mt-3">
                          {setting.value_type === "boolean" ? (
                            <select
                              className="w-full px-4 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 outline-none cursor-pointer transition-all duration-200"
                              value={getDisplayValue(setting)}
                              onChange={(e) => handleValueChange(setting, e.target.value)}
                            >
                              <option value="true">true</option>
                              <option value="false">false</option>
                            </select>
                          ) : setting.value_type === "json" || setting.value_type === "array" ? (
                            <textarea
                              className="w-full px-4 py-2 rounded-lg bg-blue-50 dark:bg-slate-700 text-gray-700 dark:text-gray-200 shadow-sm focus:shadow-md focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 outline-none font-mono text-sm min-h-[100px] transition-all duration-200"
                              value={getDisplayValue(setting)}
                              onChange={(e) => handleValueChange(setting, e.target.value)}
                            />
                          ) : (
                            <div className="flex items-center gap-2">
                              <Input
                                type={setting.value_type === "number" ? "number" : "text"}
                                value={getDisplayValue(setting)}
                                onChange={(e) => handleValueChange(setting, e.target.value)}
                                className="font-mono flex-1"
                              />
                              {getUnit(setting) && (
                                <span className="text-sm text-gray-500 dark:text-gray-400 font-medium shrink-0 w-8">
                                  {getUnit(setting)}
                                </span>
                              )}
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
    </div>
  );
}
