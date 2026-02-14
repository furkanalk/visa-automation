"use client";

import { useState, useEffect } from "react";
import { Modal, FormField } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import type { PortalConfig } from "@/lib/api";
import { Loader2, AlertCircle } from "lucide-react";

interface PortalConfigModalProps {
  open: boolean;
  onClose: () => void;
  portal: PortalConfig | null;
  onSave: (config: Record<string, unknown>, selectors: Record<string, unknown>) => Promise<void>;
  isSubmitting?: boolean;
}

export function PortalConfigModal({
  open,
  onClose,
  portal,
  onSave,
  isSubmitting,
}: PortalConfigModalProps) {
  const [configJson, setConfigJson] = useState("{}");
  const [selectorsJson, setSelectorsJson] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && portal) {
      setConfigJson(
        JSON.stringify(portal.config ?? {}, null, 2)
      );
      setSelectorsJson(
        JSON.stringify(portal.selectors ?? {}, null, 2)
      );
      setError(null);
    }
  }, [open, portal]);

  const handleSave = async () => {
    setError(null);
    let config: Record<string, unknown>;
    let selectors: Record<string, unknown>;
    try {
      config = JSON.parse(configJson) as Record<string, unknown>;
    } catch {
      setError("Invalid JSON in Config");
      return;
    }
    try {
      selectors = JSON.parse(selectorsJson) as Record<string, unknown>;
    } catch {
      setError("Invalid JSON in Selectors");
      return;
    }
    await onSave(config, selectors);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={portal ? `Configure: ${portal.name || portal.portal_id}` : "Portal configuration"}
      description="Edit portal config and selectors as JSON. Invalid JSON will be rejected."
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        <FormField
          label="Config (JSON)"
          hint="Worker uses this for each job. Keys: timeouts (navigationMs, actionMs), pacing (minDelayMs, maxDelayMs, jitter), rateLimit (enabled, actionsPerMinute, burst), proxy, hitl (otpMode, captchaMode, maxWaitSeconds), selectorsVersion."
        >
          <textarea
            className="w-full px-3 py-2 rounded-lg bg-muted font-mono text-sm min-h-[140px] border border-input focus:ring-2 focus:ring-ring"
            value={configJson}
            onChange={(e) => setConfigJson(e.target.value)}
            spellCheck={false}
          />
        </FormField>
        <FormField label="Selectors (JSON)" hint="CSS selectors for login form, date picker, etc.">
          <textarea
            className="w-full px-3 py-2 rounded-lg bg-muted font-mono text-sm min-h-[120px] border border-input focus:ring-2 focus:ring-ring"
            value={selectorsJson}
            onChange={(e) => setSelectorsJson(e.target.value)}
            spellCheck={false}
          />
        </FormField>
      </div>
    </Modal>
  );
}
