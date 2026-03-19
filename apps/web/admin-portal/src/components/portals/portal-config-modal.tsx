"use client";

import { useState, useEffect, useMemo } from "react";
import { Modal, FormField } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { PortalConfig } from "@/lib/api";
import { Loader2, AlertCircle, ChevronDown, ChevronRight, FileJson, RotateCcw, Code } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Matches AS-VISA make-appointment selectors.
 * NOTE: travelDate, appointmentDate, appointmentTime are intentionally omitted —
 * travelDate comes from "Visa Information" (travelDateSingle/travelDateFrom),
 * appointmentDate is auto-picked by the agent from open_dates + algorithm,
 * appointmentTime is auto-selected by the agent from the portal's /SaatGetir response.
 */
const CUSTOMER_FORM_SCHEMA_EXAMPLE = `[
  { "key": "nationality", "label": "Nationality", "type": "select", "required": true, "options": [{"value": "TR", "label": "Turkey"}, {"value": "DE", "label": "Germany"}] },
  { "key": "appointment", "label": "Appointment type", "type": "select", "required": true },
  { "key": "travelSubject", "label": "Travel subject", "type": "select", "required": true },
  { "key": "passportNumber", "label": "Passport number", "type": "text", "required": true },
  { "key": "name", "label": "Name", "type": "text", "required": true },
  { "key": "surname", "label": "Surname", "type": "text", "required": true },
  { "key": "tcKimlikNo", "label": "TC Kimlik No", "type": "text" },
  { "key": "dogumYili", "label": "Birth year", "type": "number" },
  { "key": "phone", "label": "Phone", "type": "text" },
  { "key": "email", "label": "Email", "type": "text", "required": true }
]`;

interface PortalConfigModalProps {
  open: boolean;
  onClose: () => void;
  portal: PortalConfig | null;
  portalLoading?: boolean;
  onSave: (config: Record<string, unknown>, selectors: Record<string, unknown>) => Promise<void>;
  isSubmitting?: boolean;
}

function parseJsonSafe(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function PortalConfigModal({
  open,
  onClose,
  portal,
  portalLoading,
  onSave,
  isSubmitting,
}: PortalConfigModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [showRawConfig, setShowRawConfig] = useState(false);

  const configObj = useMemo(() => {
    if (!open || !portal) return {};
    return parseJsonSafe(portal.config);
  }, [open, portal]);

  const selectorsObj = useMemo(() => {
    if (!open || !portal) return {};
    return parseJsonSafe(portal.selectors);
  }, [open, portal]);

  const [timeouts, setTimeouts] = useState({ navigationMs: "", actionMs: "" });
  const [pacing, setPacing] = useState({ minDelayMs: "", maxDelayMs: "", jitter: "" });
  const [pacingEnabled, setPacingEnabled] = useState(false);
  const [pacingExpanded, setPacingExpanded] = useState(false);
  const [rateLimit, setRateLimit] = useState({
    enabled: false,
    actionsPerMinute: "",
    burst: "",
  });
  const [rateLimitExpanded, setRateLimitExpanded] = useState(false);
  const [hitl, setHitl] = useState({
    otpMode: "",
    captchaMode: "",
    maxWaitSeconds: "",
  });
  const [selectorsVersion, setSelectorsVersion] = useState("");
  const [timingEnabled, setTimingEnabled] = useState(false);
  const [timingExpanded, setTimingExpanded] = useState(false);
  const [timing, setTiming] = useState({
    minRunDurationMs: "",
    mouseMoveIntervalMs: "",
    mouseMoveSegmentsMin: "",
    mouseMoveSegmentsMax: "",
    mouseMoveJitterPx: "",
    mouseMoveStepsMin: "",
    mouseMoveStepsMax: "",
    mouseMoveDelayMinMs: "",
    mouseMoveDelayMaxMs: "",
  });
  const [mouseEnabled, setMouseEnabled] = useState(false);
  const [mouseExpanded, setMouseExpanded] = useState(false);
  const [slotHunt, setSlotHunt] = useState({
    maxPolls: "",
    pollDelayMinMs: "",
    pollDelayMaxMs: "",
  });
  const [slotHuntExpanded, setSlotHuntExpanded] = useState(false);
  const [rawConfigJson, setRawConfigJson] = useState("{}");
  const [showRawCustomerFormSchema, setShowRawCustomerFormSchema] = useState(false);
  const [customerFormSchemaJson, setCustomerFormSchemaJson] = useState("[]");

  useEffect(() => {
    if (!open || !portal) return;
    setError(null);
    const c = configObj;
    const t = (c.timeouts as Record<string, unknown>) ?? {};
    const p = (c.pacing as Record<string, unknown>) ?? {};
    const r = (c.rateLimit as Record<string, unknown>) ?? {};
    const h = (c.hitl as Record<string, unknown>) ?? {};
    setTimeouts({
      navigationMs: t.navigationMs != null ? String(t.navigationMs) : "",
      actionMs: t.actionMs != null ? String(t.actionMs) : "",
    });
    setPacing({
      minDelayMs: p.minDelayMs != null ? String(p.minDelayMs) : "",
      maxDelayMs: p.maxDelayMs != null ? String(p.maxDelayMs) : "",
      jitter: p.jitter != null ? String(p.jitter) : "",
    });
    const hasPacing = (p.minDelayMs != null && Number(p.minDelayMs) > 0) || (p.maxDelayMs != null && Number(p.maxDelayMs) > 0);
    setPacingEnabled(!!hasPacing);
    setRateLimit({
      enabled: Boolean(r.enabled),
      actionsPerMinute: r.actionsPerMinute != null ? String(r.actionsPerMinute) : "",
      burst: r.burst != null ? String(r.burst) : "",
    });
    setHitl({
      otpMode: typeof h.otpMode === "string" ? h.otpMode : "",
      captchaMode: typeof h.captchaMode === "string" ? h.captchaMode : "",
      maxWaitSeconds: h.maxWaitSeconds != null ? String(h.maxWaitSeconds) : "",
    });
    setSelectorsVersion(typeof c.selectorsVersion === "string" ? c.selectorsVersion : "");
    setTiming({
      minRunDurationMs: c.minRunDurationMs != null ? String(c.minRunDurationMs) : "",
      mouseMoveIntervalMs: c.mouseMoveIntervalMs != null ? String(c.mouseMoveIntervalMs) : "",
      mouseMoveSegmentsMin: c.mouseMoveSegmentsMin != null ? String(c.mouseMoveSegmentsMin) : "",
      mouseMoveSegmentsMax: c.mouseMoveSegmentsMax != null ? String(c.mouseMoveSegmentsMax) : "",
      mouseMoveJitterPx: c.mouseMoveJitterPx != null ? String(c.mouseMoveJitterPx) : "",
      mouseMoveStepsMin: c.mouseMoveStepsMin != null ? String(c.mouseMoveStepsMin) : "",
      mouseMoveStepsMax: c.mouseMoveStepsMax != null ? String(c.mouseMoveStepsMax) : "",
      mouseMoveDelayMinMs: c.mouseMoveDelayMinMs != null ? String(c.mouseMoveDelayMinMs) : "",
      mouseMoveDelayMaxMs: c.mouseMoveDelayMaxMs != null ? String(c.mouseMoveDelayMaxMs) : "",
    });
    setTimingEnabled(c.minRunDurationMs != null && Number(c.minRunDurationMs) > 0);
    setMouseEnabled(c.mouseMoveIntervalMs != null && Number(c.mouseMoveIntervalMs) > 0);
    const sh = (c.slotHunt as Record<string, unknown>) ?? {};
    setSlotHunt({
      maxPolls: sh.maxPolls != null ? String(sh.maxPolls) : "",
      pollDelayMinMs: sh.pollDelayMinMs != null ? String(sh.pollDelayMinMs) : "",
      pollDelayMaxMs: sh.pollDelayMaxMs != null ? String(sh.pollDelayMaxMs) : "",
    });
    setRawConfigJson(JSON.stringify(c, null, 2));
    const schema = c.customerFormSchema;
    if (Array.isArray(schema)) {
      setCustomerFormSchemaJson(JSON.stringify(schema, null, 2));
    } else {
      setCustomerFormSchemaJson("[]");
    }
  }, [open, portal, configObj]);

  const buildConfig = (): Record<string, unknown> => {
    if (showRawConfig) {
      try {
        return JSON.parse(rawConfigJson) as Record<string, unknown>;
      } catch {
        return configObj;
      }
    }
    const out: Record<string, unknown> = { ...configObj };
    const num = (s: string) => (s === "" ? undefined : Number(s));
    if (timeouts.navigationMs !== "" || timeouts.actionMs !== "") {
      out.timeouts = {
        ...(out.timeouts as Record<string, unknown>),
        navigationMs: num(timeouts.navigationMs),
        actionMs: num(timeouts.actionMs),
      } as Record<string, unknown>;
    }
    out.pacing = pacingEnabled
      ? {
          ...(out.pacing as Record<string, unknown>),
          minDelayMs: num(pacing.minDelayMs) ?? 500,
          maxDelayMs: num(pacing.maxDelayMs) ?? 2000,
          jitter: num(pacing.jitter) ?? 0.2,
        }
      : { minDelayMs: 0, maxDelayMs: 0, jitter: 0 };
    out.rateLimit = {
      ...(out.rateLimit as Record<string, unknown>),
      enabled: rateLimit.enabled,
      actionsPerMinute: num(rateLimit.actionsPerMinute) ?? 30,
      burst: num(rateLimit.burst) ?? 5,
    } as Record<string, unknown>;
    if (hitl.otpMode !== "" || hitl.captchaMode !== "" || hitl.maxWaitSeconds !== "") {
      out.hitl = {
        ...(out.hitl as Record<string, unknown>),
        otpMode: hitl.otpMode || undefined,
        captchaMode: hitl.captchaMode || undefined,
        maxWaitSeconds: num(hitl.maxWaitSeconds),
      } as Record<string, unknown>;
    }
    if (selectorsVersion !== "") out.selectorsVersion = selectorsVersion;
    if (slotHunt.maxPolls !== "" || slotHunt.pollDelayMinMs !== "" || slotHunt.pollDelayMaxMs !== "") {
      out.slotHunt = {
        maxPolls: num(slotHunt.maxPolls) ?? 12,
        pollDelayMinMs: num(slotHunt.pollDelayMinMs) ?? 1500,
        pollDelayMaxMs: num(slotHunt.pollDelayMaxMs) ?? 3000,
      } as Record<string, unknown>;
    }
    if (timingEnabled && timing.minRunDurationMs !== "") out.minRunDurationMs = num(timing.minRunDurationMs);
    if (mouseEnabled) {
      // Always persist every mouse field with a concrete value so that settings round-trip correctly.
      // Blank fields fall back to the placeholder defaults shown in the UI.
      const mv = (field: string, defaultVal: number) =>
        field !== "" ? (num(field) ?? defaultVal) : defaultVal;
      out.mouseMoveIntervalMs    = mv(timing.mouseMoveIntervalMs,    10000);
      out.mouseMoveSegmentsMin   = mv(timing.mouseMoveSegmentsMin,   10);
      out.mouseMoveSegmentsMax   = mv(timing.mouseMoveSegmentsMax,   16);
      out.mouseMoveJitterPx      = mv(timing.mouseMoveJitterPx,      3);
      out.mouseMoveStepsMin      = mv(timing.mouseMoveStepsMin,      6);
      out.mouseMoveStepsMax      = mv(timing.mouseMoveStepsMax,      20);
      out.mouseMoveDelayMinMs    = mv(timing.mouseMoveDelayMinMs,    15);
      out.mouseMoveDelayMaxMs    = mv(timing.mouseMoveDelayMaxMs,    42);
    } else {
      // Explicitly zero out so that the reload condition (mouseMoveIntervalMs > 0) correctly shows disabled.
      out.mouseMoveIntervalMs = 0;
      delete out.mouseMoveSegmentsMin;
      delete out.mouseMoveSegmentsMax;
      delete out.mouseMoveJitterPx;
      delete out.mouseMoveStepsMin;
      delete out.mouseMoveStepsMax;
      delete out.mouseMoveDelayMinMs;
      delete out.mouseMoveDelayMaxMs;
    }
    try {
      const schema = JSON.parse(customerFormSchemaJson);
      if (Array.isArray(schema)) out.customerFormSchema = schema;
    } catch {
      // leave existing or omit
    }
    return out;
  };

  const handleSave = async () => {
    setError(null);
    const selectors = selectorsObj;
    let config: Record<string, unknown>;
    if (showRawConfig) {
      try {
        config = JSON.parse(rawConfigJson) as Record<string, unknown>;
      } catch {
        setError("Invalid JSON in Config");
        return;
      }
    } else {
      config = buildConfig();
    }
    await onSave(config, selectors);
    onClose();
  };

  const textareaClass = cn(
    "w-full px-3 py-2 rounded-lg font-mono text-sm border transition-colors",
    "min-h-[12vh]",
    "bg-white dark:bg-slate-800",
    "border-gray-200 dark:border-slate-600",
    "text-gray-900 dark:text-gray-100",
    "placeholder:text-gray-400 dark:placeholder:text-gray-500",
    "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 dark:focus:border-slate-500"
  );
  const textareaClassLarge = cn(textareaClass, "min-h-[24vh]");
  const textareaClassCustomerForm = cn(textareaClass, "min-h-[24vh]");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={portal ? `Configure: ${portal.name || portal.portal_id}` : "Portal configuration"}
      description="Edit portal config and selectors. Values are used by the worker for each job."
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting || portalLoading}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {portalLoading && (
          <div className="flex items-center justify-center py-8 text-gray-500 dark:text-gray-400">
            <Loader2 className="h-8 w-8 animate-spin mr-2" />
            Loading portal config…
          </div>
        )}

        {!portalLoading && portal && (
          <>
            {error && (
              <div
                className={cn(
                  "flex items-center gap-2 p-3 rounded-lg text-sm",
                  "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
                )}
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="grid gap-6 sm:grid-cols-2">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-slate-600 pb-1">
                  Timeouts
                </h3>
                <FormField label="Navigation (ms)" hint="Page load timeout">
                  <Input
                    type="number"
                    min={0}
                    value={timeouts.navigationMs}
                    onChange={(e) => setTimeouts((t) => ({ ...t, navigationMs: e.target.value }))}
                    placeholder="e.g. 30000"
                  />
                </FormField>
                <FormField label="Action (ms)" hint="Single action timeout">
                  <Input
                    type="number"
                    min={0}
                    value={timeouts.actionMs}
                    onChange={(e) => setTimeouts((t) => ({ ...t, actionMs: e.target.value }))}
                    placeholder="e.g. 10000"
                  />
                </FormField>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-slate-600 pb-1">
                  HITL (human in the loop)
                </h3>
                <FormField label="OTP mode" hint="pause = wait for human; auto = use provider; skip = don't request OTP">
                  <select
                    value={hitl.otpMode}
                    onChange={(e) => setHitl((h) => ({ ...h, otpMode: e.target.value }))}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-sm transition-colors",
                      "bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600",
                      "text-gray-900 dark:text-gray-100",
                      "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 dark:focus:border-slate-500"
                    )}
                  >
                    <option value="">—</option>
                    <option value="pause">pause (wait for human)</option>
                    <option value="auto">auto (use provider)</option>
                    <option value="skip">skip</option>
                    {hitl.otpMode && !["pause", "auto", "skip"].includes(hitl.otpMode) && (
                      <option value={hitl.otpMode}>{hitl.otpMode}</option>
                    )}
                  </select>
                </FormField>
                <FormField label="Captcha mode" hint="hitl = human solves; solver = automated; skip = don't solve">
                  <select
                    value={hitl.captchaMode}
                    onChange={(e) => setHitl((h) => ({ ...h, captchaMode: e.target.value }))}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-sm transition-colors",
                      "bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600",
                      "text-gray-900 dark:text-gray-100",
                      "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 dark:focus:border-slate-500"
                    )}
                  >
                    <option value="">—</option>
                    <option value="hitl">hitl (human solves)</option>
                    <option value="solver">solver (automated)</option>
                    <option value="skip">skip</option>
                    {hitl.captchaMode && !["hitl", "solver", "skip"].includes(hitl.captchaMode) && (
                      <option value={hitl.captchaMode}>{hitl.captchaMode}</option>
                    )}
                  </select>
                </FormField>
                <FormField label="Max wait (seconds)">
                  <Input
                    type="number"
                    min={0}
                    value={hitl.maxWaitSeconds}
                    onChange={(e) =>
                      setHitl((h) => ({ ...h, maxWaitSeconds: e.target.value }))
                    }
                    placeholder="e.g. 300"
                  />
                </FormField>
              </section>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30 p-3 space-y-2">
              <button
                type="button"
                onClick={() => setPacingExpanded(!pacingExpanded)}
                className={cn(
                  "flex items-center gap-2 text-sm font-medium w-full text-left",
                  "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                )}
              >
                {pacingExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Pacing (delay between actions)
                {pacingEnabled && (
                  <Badge variant="secondary" className="text-xs font-normal">On</Badge>
                )}
              </button>
              {pacingExpanded && (
                <div className="pl-6 pt-1 space-y-3 border-l-2 border-gray-200 dark:border-slate-600 ml-1">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Delay between actions (min–max ms + jitter). When on, agent waits a random time in this range before each step; when off, no delay.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="pacingEnabled"
                      checked={pacingEnabled}
                      onChange={(e) => setPacingEnabled(e.target.checked)}
                      className={cn(
                        "rounded border-gray-300 dark:border-slate-600",
                        "text-blue-600 focus:ring-blue-500",
                        "bg-white dark:bg-slate-800"
                      )}
                    />
                    <label htmlFor="pacingEnabled" className="text-sm text-gray-700 dark:text-gray-300">
                      Enable delay between actions
                    </label>
                  </div>
                  {pacingEnabled && (
                    <>
                      <FormField label="Min delay (ms)" hint="Minimum wait">
                        <Input
                          type="number"
                          min={0}
                          value={pacing.minDelayMs}
                          onChange={(e) => setPacing((p) => ({ ...p, minDelayMs: e.target.value }))}
                          placeholder="e.g. 500"
                        />
                      </FormField>
                      <FormField label="Max delay (ms)" hint="Maximum wait">
                        <Input
                          type="number"
                          min={0}
                          value={pacing.maxDelayMs}
                          onChange={(e) => setPacing((p) => ({ ...p, maxDelayMs: e.target.value }))}
                          placeholder="e.g. 2000"
                        />
                      </FormField>
                      <FormField label="Jitter" hint="0–1; adds randomness to delay">
                        <Input
                          type="number"
                          min={0}
                          max={1}
                          step={0.1}
                          value={pacing.jitter}
                          onChange={(e) => setPacing((p) => ({ ...p, jitter: e.target.value }))}
                          placeholder="e.g. 0.2"
                        />
                      </FormField>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30 p-3 space-y-2">
              <button
                type="button"
                onClick={() => setRateLimitExpanded(!rateLimitExpanded)}
                className={cn(
                  "flex items-center gap-2 text-sm font-medium w-full text-left",
                  "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                )}
              >
                {rateLimitExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Rate limit
                {rateLimit.enabled && (
                  <Badge variant="secondary" className="text-xs font-normal">On</Badge>
                )}
              </button>
              {rateLimitExpanded && (
                <div className="pl-6 pt-1 space-y-3 border-l-2 border-gray-200 dark:border-slate-600 ml-1">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Max actions per minute; burst = max consecutive actions. Used in agent form/slot steps via rateLimiter.take().
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="rateLimitEnabled"
                      checked={rateLimit.enabled}
                      onChange={(e) =>
                        setRateLimit((r) => ({ ...r, enabled: e.target.checked }))
                      }
                      className={cn(
                        "rounded border-gray-300 dark:border-slate-600",
                        "text-blue-600 focus:ring-blue-500",
                        "bg-white dark:bg-slate-800"
                      )}
                    />
                    <label htmlFor="rateLimitEnabled" className="text-sm text-gray-700 dark:text-gray-300">
                      Enable rate limit
                    </label>
                  </div>
                  {rateLimit.enabled && (
                    <>
                      <FormField label="Actions per minute" hint="Max actions per minute">
                        <Input
                          type="number"
                          min={0}
                          value={rateLimit.actionsPerMinute}
                          onChange={(e) =>
                            setRateLimit((r) => ({ ...r, actionsPerMinute: e.target.value }))
                          }
                          placeholder="e.g. 30"
                        />
                      </FormField>
                      <FormField label="Burst" hint="Max consecutive actions">
                        <Input
                          type="number"
                          min={0}
                          value={rateLimit.burst}
                          onChange={(e) => setRateLimit((r) => ({ ...r, burst: e.target.value }))}
                          placeholder="e.g. 5"
                        />
                      </FormField>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30 p-3 space-y-2">
              <button
                type="button"
                onClick={() => setSlotHuntExpanded(!slotHuntExpanded)}
                className={cn(
                  "flex items-center gap-2 text-sm font-medium w-full text-left",
                  "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                )}
              >
                {slotHuntExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Slot hunt
                {(slotHunt.maxPolls !== "" || slotHunt.pollDelayMinMs !== "" || slotHunt.pollDelayMaxMs !== "") && (
                  <Badge variant="secondary" className="text-xs font-normal">Set</Badge>
                )}
              </button>
              {slotHuntExpanded && (
                <div className="pl-6 pt-1 space-y-3 border-l-2 border-gray-200 dark:border-slate-600 ml-1">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Availability polling: max polls and delay range between polls (portal-specific).
                  </p>
                  <FormField label="Max polls" hint="Max availability checks before giving up (e.g. 12)">
                    <Input
                      type="number"
                      min={1}
                      value={slotHunt.maxPolls}
                      onChange={(e) => setSlotHunt((s) => ({ ...s, maxPolls: e.target.value }))}
                      placeholder="12"
                    />
                  </FormField>
                  <FormField label="Poll delay min (ms)" hint="Min sleep between polls">
                    <Input
                      type="number"
                      min={0}
                      value={slotHunt.pollDelayMinMs}
                      onChange={(e) => setSlotHunt((s) => ({ ...s, pollDelayMinMs: e.target.value }))}
                      placeholder="1500"
                    />
                  </FormField>
                  <FormField label="Poll delay max (ms)" hint="Max sleep between polls (jittered between min–max)">
                    <Input
                      type="number"
                      min={0}
                      value={slotHunt.pollDelayMaxMs}
                      onChange={(e) => setSlotHunt((s) => ({ ...s, pollDelayMaxMs: e.target.value }))}
                      placeholder="3000"
                    />
                  </FormField>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30 p-3 space-y-2">
              <button
                type="button"
                onClick={() => setTimingExpanded(!timingExpanded)}
                className={cn(
                  "flex items-center gap-2 text-sm font-medium w-full text-left",
                  "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                )}
              >
                {timingExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Timing
                {timingEnabled && (
                  <Badge variant="secondary" className="text-xs font-normal">On</Badge>
                )}
              </button>
              {timingExpanded && (
                <div className="pl-6 pt-1 space-y-3 border-l-2 border-gray-200 dark:border-slate-600 ml-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="timingEnabled"
                      checked={timingEnabled}
                      onChange={(e) => setTimingEnabled(e.target.checked)}
                      className={cn(
                        "rounded border-gray-300 dark:border-slate-600",
                        "text-blue-600 focus:ring-blue-500",
                        "bg-white dark:bg-slate-800"
                      )}
                    />
                    <label htmlFor="timingEnabled" className="text-sm text-gray-700 dark:text-gray-300">
                      Enable min run duration
                    </label>
                  </div>
                  {timingEnabled && (
                    <FormField
                      label="Min run duration (ms)"
                      hint="Run sleeps until this (e.g. 40500 = 40.5s)"
                    >
                      <Input
                        type="number"
                        min={0}
                        value={timing.minRunDurationMs}
                        onChange={(e) =>
                          setTiming((t) => ({ ...t, minRunDurationMs: e.target.value }))
                        }
                        placeholder="e.g. 40500"
                      />
                    </FormField>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30 p-3 space-y-2">
              <button
                type="button"
                onClick={() => setMouseExpanded(!mouseExpanded)}
                className={cn(
                  "flex items-center gap-2 text-sm font-medium w-full text-left",
                  "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                )}
              >
                {mouseExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Mouse movement
                {mouseEnabled && (
                  <Badge variant="secondary" className="text-xs font-normal">On</Badge>
                )}
              </button>
              {mouseExpanded && (
                <div className="pl-6 pt-1 space-y-3 border-l-2 border-gray-200 dark:border-slate-600 ml-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="mouseEnabled"
                      checked={mouseEnabled}
                      onChange={(e) => setMouseEnabled(e.target.checked)}
                      className={cn(
                        "rounded border-gray-300 dark:border-slate-600",
                        "text-blue-600 focus:ring-blue-500",
                        "bg-white dark:bg-slate-800"
                      )}
                    />
                    <label htmlFor="mouseEnabled" className="text-sm text-gray-700 dark:text-gray-300">
                      Enable human-like mouse
                    </label>
                  </div>
                  {mouseEnabled && (
                    <>
                      <FormField
                        label="Interval (ms)"
                        hint="Wander every N ms (e.g. 10000 = 10s)"
                      >
                        <Input
                          type="number"
                          min={0}
                          value={timing.mouseMoveIntervalMs}
                          onChange={(e) =>
                            setTiming((t) => ({ ...t, mouseMoveIntervalMs: e.target.value }))
                          }
                          placeholder="e.g. 10000"
                        />
                      </FormField>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Optional: waypoints, jitter, speed. Blank = defaults.
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <FormField label="Segments min" hint="Waypoints (default 10)">
                          <Input
                            type="number"
                            min={1}
                            value={timing.mouseMoveSegmentsMin}
                            onChange={(e) =>
                              setTiming((t) => ({ ...t, mouseMoveSegmentsMin: e.target.value }))
                            }
                            placeholder="10"
                          />
                        </FormField>
                        <FormField label="Segments max" hint="(default 16)">
                          <Input
                            type="number"
                            min={1}
                            value={timing.mouseMoveSegmentsMax}
                            onChange={(e) =>
                              setTiming((t) => ({ ...t, mouseMoveSegmentsMax: e.target.value }))
                            }
                            placeholder="16"
                          />
                        </FormField>
                        <FormField label="Jitter (px)" hint="(default 3)">
                          <Input
                            type="number"
                            min={0}
                            value={timing.mouseMoveJitterPx}
                            onChange={(e) =>
                              setTiming((t) => ({ ...t, mouseMoveJitterPx: e.target.value }))
                            }
                            placeholder="3"
                          />
                        </FormField>
                        <FormField label="Steps min" hint="Slower if higher (default 6)">
                          <Input
                            type="number"
                            min={1}
                            value={timing.mouseMoveStepsMin}
                            onChange={(e) =>
                              setTiming((t) => ({ ...t, mouseMoveStepsMin: e.target.value }))
                            }
                            placeholder="6"
                          />
                        </FormField>
                        <FormField label="Steps max" hint="(default 20)">
                          <Input
                            type="number"
                            min={1}
                            value={timing.mouseMoveStepsMax}
                            onChange={(e) =>
                              setTiming((t) => ({ ...t, mouseMoveStepsMax: e.target.value }))
                            }
                            placeholder="20"
                          />
                        </FormField>
                        <FormField label="Delay min (ms)" hint="(default 15)">
                          <Input
                            type="number"
                            min={0}
                            value={timing.mouseMoveDelayMinMs}
                            onChange={(e) =>
                              setTiming((t) => ({ ...t, mouseMoveDelayMinMs: e.target.value }))
                            }
                            placeholder="15"
                          />
                        </FormField>
                        <FormField label="Delay max (ms)" hint="(default 42)">
                          <Input
                            type="number"
                            min={0}
                            value={timing.mouseMoveDelayMaxMs}
                            onChange={(e) =>
                              setTiming((t) => ({ ...t, mouseMoveDelayMaxMs: e.target.value }))
                            }
                            placeholder="42"
                          />
                        </FormField>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <FormField
              label="Selectors version"
              hint="Optional version tag for selectors"
            >
              <Input
                value={selectorsVersion}
                onChange={(e) => setSelectorsVersion(e.target.value)}
                placeholder="e.g. v1"
              />
            </FormField>

            <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30 p-3">
              <button
                type="button"
                onClick={() => setShowRawCustomerFormSchema(!showRawCustomerFormSchema)}
                className={cn(
                  "flex items-center gap-1 text-sm font-medium w-full text-left",
                  "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                )}
              >
                {showRawCustomerFormSchema ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Customer form fields (schema)
              </button>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 mb-2">
                Fields shown when adding or editing a customer for this portal. Keys should match the site form (and selectors). Stored in customer preferences and used by the agent.
              </p>
              {showRawCustomerFormSchema && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => setCustomerFormSchemaJson(CUSTOMER_FORM_SCHEMA_EXAMPLE)}
                    >
                      <FileJson className="h-3 w-3 mr-1" />
                      Insert example (AS-VISA style)
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => setCustomerFormSchemaJson("[]")}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Reset
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(customerFormSchemaJson);
                          setCustomerFormSchemaJson(JSON.stringify(parsed, null, 2));
                        } catch {
                          // leave as-is if invalid
                        }
                      }}
                    >
                      <Code className="h-3 w-3 mr-1" />
                      Beautify JSON
                    </Button>
                  </div>
                  <textarea
                    className={textareaClassCustomerForm}
                    value={customerFormSchemaJson}
                    onChange={(e) => setCustomerFormSchemaJson(e.target.value)}
                    spellCheck={false}
                    placeholder="[]"
                  />
                </div>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowRawConfig(!showRawConfig)}
                className={cn(
                  "flex items-center gap-1 text-sm font-medium",
                  "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                )}
              >
                {showRawConfig ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Advanced: edit full config as JSON
              </button>
              {showRawConfig && (
                <FormField
                  label=""
                  hint="Full config object. Overrides form values when saved."
                >
                  <textarea
                    className={textareaClassLarge}
                    value={rawConfigJson}
                    onChange={(e) => setRawConfigJson(e.target.value)}
                    spellCheck={false}
                  />
                </FormField>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
