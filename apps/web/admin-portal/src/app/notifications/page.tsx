"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { cpApi, NotifySettings, NotifyRouting } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { SaveBanner } from "@/components/ui/save-banner";
import {
  Send,
  Mail,
  MessageCircle,
  Save,
  Loader2,
  Globe,
  RefreshCw,
  Eye,
  EyeOff,
  SlidersHorizontal,
  Settings2,
} from "lucide-react";

const REDACTED = "********";

type RoutingKey = keyof NotifyRouting;

const ROUTING_EVENTS: { key: RoutingKey; label: string; description: string; defaultTelegram: boolean; defaultEmail: boolean; emailSupported: boolean }[] = [
  { key: "slot_open",   label: "Slot Open",      description: "A new appointment slot was found",         defaultTelegram: true,  defaultEmail: false, emailSupported: false },
  { key: "booking",     label: "Booking",         description: "Appointment successfully booked",          defaultTelegram: true,  defaultEmail: true,  emailSupported: true  },
  { key: "agent_start", label: "Agent Started",   description: "Agent began processing a job",             defaultTelegram: true,  defaultEmail: false, emailSupported: false },
  { key: "agent_done",  label: "Agent Completed", description: "Agent finished a job (all outcomes)",      defaultTelegram: true,  defaultEmail: false, emailSupported: false },
  { key: "agent_fail",  label: "Agent Failed",    description: "Agent encountered a terminal error",       defaultTelegram: true,  defaultEmail: false, emailSupported: false },
  { key: "hitl",        label: "HITL Required",   description: "Human-in-the-loop input needed",           defaultTelegram: true,  defaultEmail: false, emailSupported: true  },
];

function buildDefaultRouting(): NotifyRouting {
  const r: NotifyRouting = {};
  for (const ev of ROUTING_EVENTS) {
    r[ev.key] = { telegram: ev.defaultTelegram, email: ev.defaultEmail };
  }
  return r;
}

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
  const [telegramOpsChatId, setTelegramOpsChatId] = useState("");
  const [telegramBookingsChatId, setTelegramBookingsChatId] = useState("");
  const [telegramWatcherChatId, setTelegramWatcherChatId] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [fallbackEmail, setFallbackEmail] = useState("");
  const [emailOverride, setEmailOverride] = useState("");
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [testEmailTo, setTestEmailTo] = useState("visorhq.notify@outlook.com");
  const [routing, setRouting] = useState<NotifyRouting>(buildDefaultRouting());
  const [bookingSendToCustomer, setBookingSendToCustomer] = useState(false);
  const [routingModalOpen, setRoutingModalOpen] = useState(false);

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
      const ids = settings.telegram_chat_ids ?? [];
      setTelegramOpsChatId(ids[0] ?? "");
      setTelegramBookingsChatId(ids[1] ?? "");
      setTelegramWatcherChatId(ids[2] ?? "");
      setEmailEnabled(settings.email_enabled);
      setSmtpHost(settings.smtp_host || "");
      setSmtpPort(String(settings.smtp_port || 587));
      setSmtpUser(settings.smtp_user || "");
      setSmtpPass(settings.smtp_pass === "***REDACTED***" ? "" : settings.smtp_pass || "");
      setSmtpFrom(settings.smtp_from || "");
      setSmtpSecure(settings.smtp_secure);
      setFallbackEmail(settings.fallback_email || "");
      setEmailOverride(settings.email_override || "");
      setWebhookEnabled(settings.webhook_enabled);
      setWebhookUrl(settings.webhook_url || "");
      setWebhookSecret(settings.webhook_secret === "***REDACTED***" ? "" : settings.webhook_secret || "");
      // Merge saved routing over defaults so new events default gracefully
      const savedRouting = settings.notify_routing ?? {};
      const merged = buildDefaultRouting();
      for (const ev of ROUTING_EVENTS) {
        if (savedRouting[ev.key] !== undefined) {
          merged[ev.key] = {
            telegram: savedRouting[ev.key]?.telegram ?? ev.defaultTelegram,
            email:    savedRouting[ev.key]?.email    ?? ev.defaultEmail,
          };
        }
      }
      setRouting(merged);
      setBookingSendToCustomer(settings.booking_send_to_customer ?? false);
    }
  }, [settings]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (data: Parameters<typeof cpApi.updateNotifySettings>[0]) =>
      cpApi.updateNotifySettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notify-settings"] });
      setSaveMessage({ type: "success", text: "Saved." });
      setTimeout(() => setSaveMessage(null), 6000);
    },
    onError: (error: Error) => {
      setSaveMessage({ type: "error", text: error.message });
      setTimeout(() => setSaveMessage(null), 10000);
    },
  });

  // Test mutations (send explicit message so we can verify data is really sent)
  const testTelegramMutation = useMutation({
    mutationFn: () =>
      cpApi.testTelegram(
        undefined,
        `🔔 Vizeself – Test\n\nThis is a test from the Admin Portal.\nSent at: ${new Date().toISOString()}`
      ),
    onSuccess: (data) => {
      const sent = (data?.details as { sent?: number })?.sent;
      const text =
        sent != null && sent > 0
          ? `Test message sent to ${sent} chat(s) (Ops, Bookings, Watcher).`
          : "Test message sent.";
      setSaveMessage({ type: "success", text });
      setTimeout(() => setSaveMessage(null), 6000);
    },
    onError: (error: Error) => {
      setSaveMessage({ type: "error", text: `Telegram test failed: ${error.message}` });
      setTimeout(() => setSaveMessage(null), 10000);
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
        to: testEmailTo || undefined,
      }),
    onSuccess: () => {
      setSaveMessage({ type: "success", text: "Test email sent." });
      setTimeout(() => setSaveMessage(null), 6000);
    },
    onError: (error: Error) => {
      setSaveMessage({ type: "error", text: `Email test failed: ${error.message}` });
      setTimeout(() => setSaveMessage(null), 10000);
    },
  });

  const handleSave = () => {
    const ops = telegramOpsChatId.trim();
    const bookings = telegramBookingsChatId.trim();
    const watcher = telegramWatcherChatId.trim();
    const parsedChatIds = [ops, bookings, watcher].filter(Boolean);

    // Build updates; only super_admin may send secret fields (otherwise we'd overwrite with REDACTED)
    const updates: Parameters<typeof cpApi.updateNotifySettings>[0] = {
      telegram_enabled: telegramEnabled,
      email_enabled: emailEnabled,
      webhook_enabled: webhookEnabled,
      telegram_chat_ids: telegramEnabled ? parsedChatIds : [],
      smtp_host: emailEnabled ? (smtpHost || null) : null,
      smtp_port: emailEnabled && smtpPort ? parseInt(smtpPort, 10) : null,
      smtp_user: emailEnabled ? (smtpUser || null) : null,
      smtp_from: emailEnabled ? (smtpFrom || null) : null,
      smtp_secure: smtpSecure,
      fallback_email: fallbackEmail.trim() || null,
      email_override: emailOverride.trim() || null,
      webhook_url: webhookEnabled ? (webhookUrl || null) : null,
      notify_routing: routing,
      booking_send_to_customer: bookingSendToCustomer,
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

      <SaveBanner message={saveMessage} onDismiss={() => setSaveMessage(null)} />

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
                  placeholder={!settings?.telegram_bot_token && !telegramToken ? "Enter bot token" : undefined}
                  value={
                    isSuperAdmin
                      ? (telegramToken || (settings?.telegram_bot_token === "***REDACTED***" ? REDACTED : ""))
                      : (settings?.telegram_bot_token === "***REDACTED***" || telegramToken ? REDACTED : "")
                  }
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
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Ops Chat ID</label>
                <Input
                  placeholder="-1003416093784:3"
                  value={telegramOpsChatId}
                  onChange={(e) => setTelegramOpsChatId(e.target.value)}
                  className="mt-1"
                  disabled={!telegramEnabled}
                />
                <p className="text-xs text-gray-500 mt-1">Telegram group/topic for ops (e.g. chat_id or chat_id:thread_id for topic).</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Bookings Chat ID</label>
                <Input
                  placeholder="-1003416093784:5"
                  value={telegramBookingsChatId}
                  onChange={(e) => setTelegramBookingsChatId(e.target.value)}
                  className="mt-1"
                  disabled={!telegramEnabled}
                />
                <p className="text-xs text-gray-500 mt-1">Telegram group/topic for bookings (e.g. chat_id or chat_id:thread_id for topic).</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Watcher Chat ID</label>
                <Input
                  placeholder="e.g. -1001234567890 or -1001234567890:95 (topic)"
                  value={telegramWatcherChatId}
                  onChange={(e) => setTelegramWatcherChatId(e.target.value)}
                  className="mt-1"
                  disabled={!telegramEnabled}
                />
                <p className="text-xs text-gray-500 mt-1">Telegram group/topic for watcher (slot-check jobs created, HTML drift).</p>
              </div>
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
            <div className="grid grid-cols-2 gap-4">
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
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">System Recipient</label>
                <Input
                  placeholder="visorhq.notify@outlook.com"
                  value={fallbackEmail}
                  onChange={(e) => setFallbackEmail(e.target.value)}
                  className="mt-1"
                  disabled={!emailEnabled}
                />
                <p className="text-xs text-gray-500 mt-1">Ops emails (bookings, failures) are sent here.</p>
              </div>
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
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Test Recipient</label>
              <Input
                placeholder="test@example.com"
                value={testEmailTo}
                onChange={(e) => setTestEmailTo(e.target.value)}
                className="mt-1"
                disabled={!emailEnabled}
              />
              <p className="text-xs text-gray-500 mt-1">Address used when clicking "Test Email".</p>
            </div>
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

        {/* Routing */}
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
                  <SlidersHorizontal className="h-5 w-5" />
                  Notification Routing
                </CardTitle>
                <CardDescription className="mt-1">
                  Per-event channel control — choose which events go to Telegram and/or Email.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setRoutingModalOpen(true)}>
                <Settings2 className="h-4 w-4 mr-1.5" />
                Configure
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Summary chips */}
            <div className="flex flex-wrap gap-2">
              {ROUTING_EVENTS.map((ev) => {
                const r = routing[ev.key] ?? { telegram: ev.defaultTelegram, email: ev.defaultEmail };
                const tg = r.telegram ?? ev.defaultTelegram;
                const em = r.email ?? ev.defaultEmail;
                return (
                  <button
                    key={ev.key}
                    type="button"
                    onClick={() => setRoutingModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors text-sm cursor-pointer"
                  >
                    <span className="font-medium text-gray-800 dark:text-gray-200">{ev.label}</span>
                    <span className={`h-2 w-2 rounded-full ${tg && telegramEnabled ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"}`} title="Telegram" />
                    <span className={`h-2 w-2 rounded-full ${ev.emailSupported && em && emailEnabled ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`} title={ev.emailSupported ? "Email" : "Email not supported"} />
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3 mt-3">
              <span className="flex items-center gap-1 text-xs text-gray-400"><span className="h-2 w-2 rounded-full bg-blue-500 inline-block" /> Telegram active</span>
              <span className="flex items-center gap-1 text-xs text-gray-400"><span className="h-2 w-2 rounded-full bg-green-500 inline-block" /> Email active</span>
              <span className="flex items-center gap-1 text-xs text-gray-400"><span className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600 inline-block" /> Off / channel disabled</span>
            </div>
            {bookingSendToCustomer && emailEnabled && (
              <div className="mt-3 flex items-center gap-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                Customer booking confirmation email is enabled.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Routing Modal */}
      <Modal
        open={routingModalOpen}
        onClose={() => setRoutingModalOpen(false)}
        title="Notification Routing"
        description="Choose which channels each event type uses. Changes take effect after Save All."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setRoutingModalOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setRoutingModalOpen(false);
                handleSave();
              }}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Save & Close
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {/* Routing table */}
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2.5 px-4 font-medium text-gray-700 dark:text-gray-300">Event</th>
                  <th className="text-left py-2.5 px-4 font-medium text-gray-500 dark:text-gray-400 hidden sm:table-cell">Description</th>
                  <th className="py-2.5 px-5 font-medium text-center">
                    <span className="flex items-center justify-center gap-1.5">
                      <MessageCircle className="h-4 w-4 text-blue-500" />
                      Telegram
                    </span>
                  </th>
                  <th className="py-2.5 px-5 font-medium text-center">
                    <span className="flex items-center justify-center gap-1.5">
                      <Mail className="h-4 w-4 text-green-500" />
                      Email
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROUTING_EVENTS.map((ev, i) => {
                  const r = routing[ev.key] ?? { telegram: ev.defaultTelegram, email: ev.defaultEmail };
                  return (
                    <tr
                      key={ev.key}
                      className={`border-b border-gray-100 dark:border-gray-800 last:border-0 ${i % 2 === 0 ? "" : "bg-gray-50/60 dark:bg-gray-800/20"}`}
                    >
                      <td className="py-3 px-4 font-medium text-gray-900 dark:text-white whitespace-nowrap">{ev.label}</td>
                      <td className="py-3 px-4 text-gray-500 dark:text-gray-400 hidden sm:table-cell">{ev.description}</td>
                      <td className="py-3 px-5 text-center">
                        <label className="inline-flex flex-col items-center gap-0.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={r.telegram ?? ev.defaultTelegram}
                            disabled={!telegramEnabled}
                            onChange={(e) =>
                              setRouting((prev) => ({
                                ...prev,
                                [ev.key]: { ...r, telegram: e.target.checked },
                              }))
                            }
                            className="h-4 w-4 rounded border-gray-300 accent-blue-600"
                          />
                          {!telegramEnabled && <span className="text-xs text-gray-400">off</span>}
                        </label>
                      </td>
                      <td className="py-3 px-5 text-center">
                        {ev.emailSupported ? (
                        <label className="inline-flex flex-col items-center gap-0.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={r.email ?? ev.defaultEmail}
                            disabled={!emailEnabled}
                            onChange={(e) =>
                              setRouting((prev) => ({
                                ...prev,
                                [ev.key]: { ...r, email: e.target.checked },
                              }))
                            }
                            className="h-4 w-4 rounded border-gray-300 accent-green-600"
                          />
                          {!emailEnabled && <span className="text-xs text-gray-400">off</span>}
                        </label>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-600" title="Email not implemented for this event">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-400 dark:text-gray-500">
            Channels must be enabled (Telegram / SMTP) for routing to take effect. Unchecking suppresses the send even when the channel is on.
          </p>

          {/* Customer booking email */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50/50 dark:bg-gray-800/30">
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Mail className="h-4 w-4 text-green-500 shrink-0" />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">Send booking confirmation to customer</span>
                  <Badge variant="secondary" className="text-xs">Booking only</Badge>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 ml-6">
                  Sends a clean customer-facing email to <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">applicant_data.email</code> after a successful booking — no internal job IDs, just confirmation number, date and service.
                </p>
              </div>
              <button
                type="button"
                disabled={!emailEnabled}
                onClick={() => emailEnabled && setBookingSendToCustomer((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors mt-0.5 ${
                  !emailEnabled ? "bg-gray-200 dark:bg-slate-600 cursor-not-allowed opacity-50" : bookingSendToCustomer ? "bg-green-500" : "bg-gray-300 dark:bg-slate-600"
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${bookingSendToCustomer && emailEnabled ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>
            {!emailEnabled && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 ml-6">Enable Email (SMTP) above to use this feature.</p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
