"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cpApi, NotifySettings } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import {
  Send,
  Mail,
  MessageCircle,
  Save,
  CheckCircle,
  AlertCircle,
  Loader2,
  Globe,
  RefreshCw,
  Eye,
  EyeOff,
} from "lucide-react";

const REDACTED = "********";

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === "super_admin";
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showTelegramToken, setShowTelegramToken] = useState(false);
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);

  // Form state
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatIds, setTelegramChatIds] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  // Fetch current settings
  const { data: settings, isLoading, refetch } = useQuery({
    queryKey: ["notify-settings"],
    queryFn: () => cpApi.getNotifySettings(),
  });

  // Update form when settings are loaded
  useEffect(() => {
    if (settings) {
      setTelegramEnabled(settings.telegram_enabled);
      setTelegramToken(settings.telegram_bot_token === "***REDACTED***" ? "" : settings.telegram_bot_token || "");
      setTelegramChatIds(settings.telegram_chat_ids?.join(", ") || "");
      setEmailEnabled(settings.email_enabled);
      setSmtpHost(settings.smtp_host || "");
      setSmtpPort(String(settings.smtp_port || 587));
      setSmtpUser(settings.smtp_user || "");
      setSmtpPass(settings.smtp_pass === "***REDACTED***" ? "" : settings.smtp_pass || "");
      setSmtpFrom(settings.smtp_from || "");
      setSmtpSecure(settings.smtp_secure);
      setWebhookEnabled(settings.webhook_enabled);
      setWebhookUrl(settings.webhook_url || "");
      setWebhookSecret(settings.webhook_secret === "***REDACTED***" ? "" : settings.webhook_secret || "");
    }
  }, [settings]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (data: Parameters<typeof cpApi.updateNotifySettings>[0]) =>
      cpApi.updateNotifySettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notify-settings"] });
      setSaveMessage({ type: "success", text: "Settings saved successfully" });
      setTimeout(() => setSaveMessage(null), 3000);
    },
    onError: (error: Error) => {
      setSaveMessage({ type: "error", text: error.message });
      setTimeout(() => setSaveMessage(null), 5000);
    },
  });

  // Test mutations (send explicit message so we can verify data is really sent)
  const testTelegramMutation = useMutation({
    mutationFn: () =>
      cpApi.testTelegram(
        undefined,
        `🔔 Visa Automation – Test\n\nThis is a test from the Admin Portal.\nSent at: ${new Date().toISOString()}`
      ),
    onSuccess: () => {
      setSaveMessage({ type: "success", text: "Telegram test message sent!" });
      setTimeout(() => setSaveMessage(null), 3000);
    },
    onError: (error: Error) => {
      setSaveMessage({ type: "error", text: `Telegram test failed: ${error.message}` });
      setTimeout(() => setSaveMessage(null), 5000);
    },
  });

  const testEmailMutation = useMutation({
    mutationFn: () =>
      cpApi.testEmail({
        smtp_host: smtpHost || undefined,
        smtp_port: smtpPort ? parseInt(smtpPort, 10) : undefined,
        smtp_user: smtpUser || undefined,
        smtp_pass: isSuperAdmin && smtpPass ? smtpPass : undefined,
        smtp_from: smtpFrom || undefined,
        smtp_secure: smtpSecure,
        to: settings?.fallback_email || settings?.email_override || smtpFrom || undefined,
      }),
    onSuccess: () => {
      setSaveMessage({ type: "success", text: "Test email sent!" });
      setTimeout(() => setSaveMessage(null), 3000);
    },
    onError: (error: Error) => {
      setSaveMessage({ type: "error", text: `Email test failed: ${error.message}` });
      setTimeout(() => setSaveMessage(null), 5000);
    },
  });

  const handleSave = () => {
    // Parse chat IDs, send empty array if cleared
    const parsedChatIds = telegramChatIds
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id);

    // Build updates; only super_admin may send secret fields (otherwise we'd overwrite with REDACTED)
    const updates: Parameters<typeof cpApi.updateNotifySettings>[0] = {
      telegram_enabled: telegramEnabled,
      email_enabled: emailEnabled,
      webhook_enabled: webhookEnabled,
      telegram_chat_ids: telegramEnabled ? (parsedChatIds.length > 0 ? parsedChatIds : []) : [],
      smtp_host: emailEnabled ? (smtpHost || null) : null,
      smtp_port: emailEnabled && smtpPort ? parseInt(smtpPort, 10) : null,
      smtp_user: emailEnabled ? (smtpUser || null) : null,
      smtp_from: emailEnabled ? (smtpFrom || null) : null,
      smtp_secure: smtpSecure,
      webhook_url: webhookEnabled ? (webhookUrl || null) : null,
    };
    if (isSuperAdmin) {
      if (telegramEnabled) updates.telegram_bot_token = telegramToken || null;
      if (emailEnabled && smtpPass !== REDACTED) updates.smtp_pass = smtpPass || null;
      if (webhookEnabled && webhookSecret !== REDACTED) updates.webhook_secret = webhookSecret || null;
    }

    saveMutation.mutate(updates);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Notifications</h1>
          <p className="text-gray-500 dark:text-gray-400">Configure notification channels</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save All
          </Button>
        </div>
      </div>

      {/* Save Message */}
      {saveMessage && (
        <div
          className={`p-4 rounded-lg flex items-center gap-2 ${
            saveMessage.type === "success"
              ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
              : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
          }`}
        >
          {saveMessage.type === "success" ? (
            <CheckCircle className="h-5 w-5" />
          ) : (
            <AlertCircle className="h-5 w-5" />
          )}
          {saveMessage.text}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Telegram */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
                <MessageCircle className="h-5 w-5" />
                Telegram
              </CardTitle>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={telegramEnabled}
                  onChange={(e) => setTelegramEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-500">Enabled</span>
              </label>
            </div>
            <CardDescription>Send notifications via Telegram bot</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Bot Token</label>
              <div className="relative flex items-center gap-1 mt-1">
                <Input
                  type={isSuperAdmin && showTelegramToken ? "text" : "password"}
                  placeholder={settings?.telegram_bot_token && !isSuperAdmin ? REDACTED : "Enter bot token"}
                  value={isSuperAdmin ? telegramToken : (telegramToken ? REDACTED : "")}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  disabled={!telegramEnabled || !isSuperAdmin}
                  className="pr-9"
                />
                {isSuperAdmin && (
                  <button
                    type="button"
                    className="absolute right-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    onClick={() => setShowTelegramToken((v) => !v)}
                    title={showTelegramToken ? "Hide" : "Show"}
                  >
                    {showTelegramToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
              </div>
              {!isSuperAdmin && (settings?.telegram_bot_token || telegramToken) && (
                <p className="text-xs text-gray-500 mt-1">Only super_admin can view or edit the token.</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Chat IDs</label>
              <Input
                placeholder="-1001234567890, -1009876543210"
                value={telegramChatIds}
                onChange={(e) => setTelegramChatIds(e.target.value)}
                className="mt-1"
                disabled={!telegramEnabled}
              />
              <p className="text-xs text-gray-500 mt-1">Comma-separated chat IDs (e.g. for Ops and Booking). Add IDs here; they can be chosen when editing customers.</p>
            </div>
            <Button
              variant="outline"
              onClick={() => testTelegramMutation.mutate()}
              disabled={!telegramEnabled || testTelegramMutation.isPending}
            >
              {testTelegramMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-1" />
              )}
              Test Telegram
            </Button>
          </CardContent>
        </Card>

        {/* Email */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
                <Mail className="h-5 w-5" />
                Email (SMTP)
              </CardTitle>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={emailEnabled}
                  onChange={(e) => setEmailEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-500">Enabled</span>
              </label>
            </div>
            <CardDescription>Send notifications via email</CardDescription>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Outlook personal: smtp-mail.outlook.com, port 587, TLS off (STARTTLS). Office 365 work: smtp.office365.com, enable SMTP AUTH for the mailbox. For automation, Microsoft Graph + OAuth2 is more reliable than SMTP.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">SMTP Host</label>
                <Input
                  placeholder="smtp.gmail.com, smtp-mail.outlook.com, smtp.office365.com"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  className="mt-1"
                  disabled={!emailEnabled}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Port</label>
                <Input
                  placeholder="587"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  className="mt-1"
                  disabled={!emailEnabled}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">User</label>
                <Input
                  placeholder="user@example.com"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  className="mt-1"
                  disabled={!emailEnabled}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
                <div className="relative flex items-center gap-1 mt-1">
                  <Input
                    type={isSuperAdmin && showSmtpPass ? "text" : "password"}
                    placeholder={settings?.smtp_pass && !isSuperAdmin ? REDACTED : "Enter password"}
                    value={isSuperAdmin ? smtpPass : (smtpPass ? REDACTED : "")}
                    onChange={(e) => setSmtpPass(e.target.value)}
                    disabled={!emailEnabled || !isSuperAdmin}
                    className="pr-9"
                  />
                  {isSuperAdmin && (
                    <button
                      type="button"
                      className="absolute right-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                      onClick={() => setShowSmtpPass((v) => !v)}
                      title={showSmtpPass ? "Hide" : "Show"}
                    >
                      {showSmtpPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                </div>
                {!isSuperAdmin && (settings?.smtp_pass || smtpPass) && (
                  <p className="text-xs text-gray-500 mt-1">Only super_admin can view or edit the password.</p>
                )}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">From Address</label>
              <Input
                placeholder="notifications@example.com"
                value={smtpFrom}
                onChange={(e) => setSmtpFrom(e.target.value)}
                className="mt-1"
                disabled={!emailEnabled}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={smtpSecure}
                onChange={(e) => setSmtpSecure(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
                disabled={!emailEnabled}
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Use TLS/SSL</span>
            </label>
            <Button
              variant="outline"
              onClick={() => testEmailMutation.mutate()}
              disabled={!emailEnabled || !smtpHost?.trim() || !smtpFrom?.trim() || testEmailMutation.isPending}
              title={emailEnabled && (!smtpHost?.trim() || !smtpFrom?.trim()) ? "Fill SMTP Host and From to test" : undefined}
            >
              {testEmailMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-1" />
              )}
              Test Email
            </Button>
          </CardContent>
        </Card>

        {/* Webhook */}
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
                <Globe className="h-5 w-5" />
                Webhook
              </CardTitle>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={webhookEnabled}
                  onChange={(e) => setWebhookEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-500">Enabled</span>
              </label>
            </div>
            <CardDescription>Send notifications to a webhook endpoint</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Webhook URL</label>
                <Input
                  placeholder="https://your-webhook-endpoint.com/notify"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="mt-1"
                  disabled={!webhookEnabled}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Secret (optional)</label>
                <div className="relative flex items-center gap-1 mt-1">
                  <Input
                    type={isSuperAdmin && showWebhookSecret ? "text" : "password"}
                    placeholder={settings?.webhook_secret && !isSuperAdmin ? REDACTED : "Enter secret for signature"}
                    value={isSuperAdmin ? webhookSecret : (webhookSecret ? REDACTED : "")}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                    disabled={!webhookEnabled || !isSuperAdmin}
                    className="pr-9"
                  />
                  {isSuperAdmin && (
                    <button
                      type="button"
                      className="absolute right-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                      onClick={() => setShowWebhookSecret((v) => !v)}
                      title={showWebhookSecret ? "Hide" : "Show"}
                    >
                      {showWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                </div>
                {!isSuperAdmin && (settings?.webhook_secret || webhookSecret) && (
                  <p className="text-xs text-gray-500 mt-1">Only super_admin can view or edit the secret.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
