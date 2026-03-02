"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { cpApi, customerApi, type PortalOpenSlots, type Customer } from "@/lib/api";
import { SaveBanner, type SaveBannerMessage } from "@/components/ui/save-banner";
import {
  CalendarSearch,
  RefreshCw,
  Users,
  Calendar,
  ChevronDown,
  ChevronRight,
  Play,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Clock,
  Zap,
} from "lucide-react";

// Parse YYYY-M-D or YYYY-MM-DD to a display string
function formatDate(raw: string): string {
  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return raw;
  const d = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])));
  return d.toLocaleDateString("tr-TR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface GrabModalState {
  open: boolean;
  portalId: string;
  portalName: string;
  openDates: string[]; // all open dates for this portal (customer filter applied server-side)
  selectedDate: string;
}

export default function SlotsPage() {
  const [expandedPortal, setExpandedPortal] = useState<string | null>(null);
  const [grabModal, setGrabModal] = useState<GrabModalState>({
    open: false, portalId: "", portalName: "", openDates: [], selectedDate: "",
  });
  const [grabMode, setGrabMode] = useState<"agent" | "manual" | null>(null);
  const [banner, setBanner] = useState<SaveBannerMessage | null>(null);

  const showBanner = (type: "success" | "error", text: string) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 6000);
  };

  const { data: slotsData, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["open-slots"],
    queryFn: () => cpApi.getOpenSlots(),
    refetchInterval: 60_000,
  });

  // Only fetch customers when agent mode is open
  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ["customers-for-grab", grabModal.portalId],
    queryFn: () => customerApi.list({ status: "active", portal_id: grabModal.portalId, limit: 500 }),
    enabled: grabModal.open && grabMode === "agent",
  });

  // Grab booking via SYNC agent — skips SLOT_SEARCHING, books immediately
  const grabMutation = useMutation({
    mutationFn: (customerId: string) =>
      cpApi.grabBooking({
        customer_id: customerId,
        portal_id: grabModal.portalId,
        open_dates: grabModal.openDates,
        preferred_date: grabModal.selectedDate, // the specific date the user clicked "Grab" on
      }),
    onSuccess: (result) => {
      showBanner(
        "success",
        `Job created (${result.job_id.slice(0, 8)}…) and assigned to agent "${result.agent_name}". Check the Jobs page.`,
      );
      setGrabModal((p) => ({ ...p, open: false }));
      setGrabMode(null);
    },
    onError: (err) => showBanner("error", err instanceof Error ? err.message : "Grab failed."),
  });

  const closeModal = () => {
    setGrabModal((p) => ({ ...p, open: false }));
    setGrabMode(null);
  };

  const portals: PortalOpenSlots[] = slotsData ?? [];
  const totalOpenDates = portals.reduce((sum, p) => sum + p.open_dates.length, 0);
  const portalsWithSlots = portals.filter((p) => p.open_dates.length > 0);

  return (
    <div className="space-y-6">
      {banner && <SaveBanner message={banner} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarSearch className="h-7 w-7 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Open Slots</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Live appointment availability from last scout run · auto-refreshes every 60s
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="gap-2"
        >
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Portals monitored</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white">{portals.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Portals with open slots</p>
            <p className={`text-3xl font-bold ${portalsWithSlots.length > 0 ? "text-emerald-500" : "text-gray-400"}`}>
              {portalsWithSlots.length}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total open dates</p>
            <p className={`text-3xl font-bold ${totalOpenDates > 0 ? "text-blue-500" : "text-gray-400"}`}>
              {totalOpenDates}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* States */}
      {isLoading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />Loading…
        </div>
      )}
      {isError && (
        <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <CardContent className="pt-5 flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            Failed to load open slots. Check that the CP server is running.
          </CardContent>
        </Card>
      )}
      {!isLoading && !isError && portals.length === 0 && (
        <Card className="border-gray-200 dark:border-slate-700">
          <CardContent className="pt-8 pb-8 text-center text-gray-500 dark:text-gray-400">
            No portals configured. Add portals in the Portals tab.
          </CardContent>
        </Card>
      )}

      {/* Portal list */}
      {portals.map((portal) => {
        const hasSlots = portal.open_dates.length > 0;
        const isExpanded = expandedPortal === portal.portal_id;

        return (
          <Card
            key={portal.portal_id}
            className={`bg-white dark:bg-slate-800 border ${
              hasSlots ? "border-emerald-200 dark:border-emerald-700" : "border-gray-100 dark:border-slate-700"
            }`}
          >
            <CardHeader
              className="cursor-pointer select-none pb-3"
              onClick={() => setExpandedPortal(isExpanded ? null : portal.portal_id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                  <div>
                    <CardTitle className="text-base font-semibold text-gray-900 dark:text-white">
                      {portal.portal_name}
                      <span className="ml-2 text-xs text-gray-400 font-normal font-mono">{portal.portal_id}</span>
                    </CardTitle>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <Clock className="h-3.5 w-3.5" />{formatRelative(portal.last_checked_at)}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <Users className="h-3.5 w-3.5" />
                        {portal.matching_customers}/{portal.total_active_customers} customers matched
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {hasSlots ? (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {portal.open_dates.length} open date{portal.open_dates.length !== 1 ? "s" : ""}
                    </Badge>
                  ) : (
                    <Badge className="bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-400 border-0">No slots</Badge>
                  )}
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0">
                {!hasSlots ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-3">
                    No open appointment dates detected for this portal in the last scout run.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                      Available appointment dates
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {portal.open_dates.map((date) => (
                        <div
                          key={date}
                          className="flex items-center justify-between rounded-lg border border-emerald-100 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                            <span className="text-sm text-gray-800 dark:text-gray-200 font-medium">{formatDate(date)}</span>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-800/40"
                            onClick={() => {
                              setGrabModal({
                                open: true,
                                portalId: portal.portal_id,
                                portalName: portal.portal_name,
                                openDates: portal.open_dates,
                                selectedDate: date,
                              });
                              setGrabMode(null);
                            }}
                          >
                            Grab
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}

      {/* Grab slot modal */}
      <Modal
        open={grabModal.open}
        onClose={closeModal}
        title={`Grab slot — ${grabModal.selectedDate ? formatDate(grabModal.selectedDate) : ""}`}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Portal: <span className="font-semibold">{grabModal.portalName}</span>
          </p>

          {/* Mode picker */}
          {grabMode === null && (
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => setGrabMode("agent")}
                className="flex flex-col items-center gap-2 rounded-xl border-2 border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 p-4 hover:border-blue-400 transition-colors"
              >
                <Zap className="h-6 w-6 text-blue-500" />
                <span className="font-semibold text-gray-800 dark:text-white text-sm">Agent (Sync)</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 text-center">
                  Pick a customer → assign to an idle SYNC agent immediately
                </span>
              </button>
              <button
                onClick={() => setGrabMode("manual")}
                className="flex flex-col items-center gap-2 rounded-xl border-2 border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-4 hover:border-amber-400 transition-colors"
              >
                <ExternalLink className="h-6 w-6 text-amber-500" />
                <span className="font-semibold text-gray-800 dark:text-white text-sm">Manual</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 text-center">
                  Open the booking portal directly in your browser
                </span>
              </button>
            </div>
          )}

          {/* Manual mode */}
          {grabMode === "manual" && (
            <div className="space-y-3 pt-2">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Open the portal and book manually for{" "}
                <span className="font-semibold text-emerald-600">{formatDate(grabModal.selectedDate)}</span>.
              </p>
              <Button className="w-full gap-2" onClick={() => { window.open("/portals", "_blank"); closeModal(); }}>
                <ExternalLink className="h-4 w-4" />
                Go to Portals page
              </Button>
            </div>
          )}

          {/* Agent (sync) mode — pick customer */}
          {grabMode === "agent" && (
            <div className="space-y-3 pt-2">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Select a customer — a booking job will be created with{" "}
                <span className="font-semibold text-emerald-600">{grabModal.openDates.length} open date(s)</span> pre-filled
                and assigned to an idle SYNC agent right away (no queue wait).
              </p>
              {customersLoading ? (
                <div className="flex items-center justify-center py-6 text-gray-400">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />Loading customers…
                </div>
              ) : !customersData || customersData.items.length === 0 ? (
                <div className="text-sm text-gray-500 py-4 text-center">
                  No active customers for this portal.
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-1.5 rounded-lg border border-gray-200 dark:border-slate-600 p-2">
                  {customersData.items.map((customer: Customer) => (
                    <button
                      key={customer.id}
                      disabled={grabMutation.isPending}
                      onClick={() => grabMutation.mutate(customer.id)}
                      className="w-full flex items-center justify-between rounded-lg px-3 py-2 hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors text-left disabled:opacity-50"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{customer.display_name}</p>
                        <p className="text-xs text-gray-400">{customer.portal_id}</p>
                      </div>
                      {grabMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                      ) : (
                        <Play className="h-4 w-4 text-blue-400" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {grabMode !== null && (
            <button onClick={() => setGrabMode(null)} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 mt-1">
              ← Back
            </button>
          )}
        </div>
      </Modal>
    </div>
  );
}
