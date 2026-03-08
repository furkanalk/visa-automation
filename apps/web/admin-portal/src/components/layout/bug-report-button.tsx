"use client";

import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { cpApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Bug, X, Paperclip, Send, Loader2, CheckCircle, AlertCircle, ChevronDown } from "lucide-react";

const TIME_OPTIONS = [
  { label: "Last 2 minutes", value: 2 },
  { label: "Last 5 minutes", value: 5 },
  { label: "Last 10 minutes", value: 10 },
  { label: "Last 30 minutes", value: 30 },
  { label: "Last 1 hour", value: 60 },
];

const FIXED_TO = "visorhq.notify@outlook.com";

export function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [timeWindow, setTimeWindow] = useState(5);
  const [attachment, setAttachment] = useState<{ base64: string; name: string; mime: string } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      cpApi.sendBugReport({
        title: title.trim(),
        description: description.trim(),
        timeWindowMinutes: timeWindow,
        to: FIXED_TO,
        ...(attachment
          ? {
              attachmentBase64: attachment.base64,
              attachmentName: attachment.name,
              attachmentMime: attachment.mime,
            }
          : {}),
      }),
    onSuccess: (data) => {
      setResult({ ok: true, msg: `Report sent to ${data.sent_to}` });
      setTimeout(() => {
        setOpen(false);
        resetForm();
      }, 2500);
    },
    onError: (err: Error) => {
      setResult({ ok: false, msg: err.message });
    },
  });

  function resetForm() {
    setTitle("");
    setDescription("");
    setTimeWindow(5);
    setAttachment(null);
    setResult(null);
  }

  function handleClose() {
    if (isPending) return;
    setOpen(false);
    resetForm();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      setAttachment({ base64, name: file.name, mime: file.type || "application/octet-stream" });
    };
    reader.readAsDataURL(file);
    // reset so same file can be re-selected
    e.target.value = "";
  }

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !isPending;

  return (
    <>
      {/* Sidebar trigger button */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "group flex w-full items-center gap-x-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          "text-gray-500 hover:bg-gray-800/70 hover:text-red-400"
        )}
        title="Report a bug"
      >
        <Bug className="h-5 w-5 shrink-0 text-gray-600 group-hover:text-red-400 transition-colors" />
        <span>Report Bug</span>
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(2px)" }}
          onClick={(e) => e.target === e.currentTarget && handleClose()}
        >
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            style={{ maxHeight: "90vh" }}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-red-600 to-red-700 dark:from-red-700 dark:to-red-900">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                  <Bug className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-white font-semibold text-base leading-tight">Report a Bug</h2>
                  <p className="text-red-200 text-xs">Logs will be attached automatically</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                disabled={isPending}
                className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition-colors disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">

              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Briefly describe the issue…"
                  maxLength={120}
                  disabled={isPending}
                  className={cn(
                    "w-full px-3 py-2 rounded-lg border text-sm",
                    "bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100",
                    "border-gray-200 dark:border-slate-700",
                    "focus:outline-none focus:ring-2 focus:ring-red-400/50 focus:border-red-400",
                    "disabled:opacity-50 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  )}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What happened? What were you doing? What did you expect?"
                  rows={4}
                  disabled={isPending}
                  className={cn(
                    "w-full px-3 py-2 rounded-lg border text-sm resize-none",
                    "bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100",
                    "border-gray-200 dark:border-slate-700",
                    "focus:outline-none focus:ring-2 focus:ring-red-400/50 focus:border-red-400",
                    "disabled:opacity-50 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  )}
                />
              </div>

              {/* Time window */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                  Include logs from…
                </label>                <div className="relative">
                  <select
                    value={timeWindow}
                    onChange={(e) => setTimeWindow(Number(e.target.value))}
                    disabled={isPending}
                    className={cn(
                      "w-full appearance-none px-3 py-2 pr-9 rounded-lg border text-sm",
                      "bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100",
                      "border-gray-200 dark:border-slate-700",
                      "focus:outline-none focus:ring-2 focus:ring-red-400/50 focus:border-red-400",
                      "disabled:opacity-50 cursor-pointer"
                    )}
                  >
                    {TIME_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Logs from <code className="bg-gray-100 dark:bg-slate-700 px-1 rounded">visa-cp</code>,{" "}
                  <code className="bg-gray-100 dark:bg-slate-700 px-1 rounded">visa-dp</code>,{" "}
                  <code className="bg-gray-100 dark:bg-slate-700 px-1 rounded">visa-admin-portal</code> and{" "}
                  <code className="bg-gray-100 dark:bg-slate-700 px-1 rounded">visa-mock-portal</code> will be included.
                </p>
              </div>

              {/* Attachment */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                  Attachment <span className="text-gray-400 font-normal normal-case">(optional)</span>
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileChange}
                  className="hidden"
                  accept="image/*,.pdf,.txt,.log,.json,.csv"
                />
                {attachment ? (
                  <div className="flex items-center gap-3 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <Paperclip className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                    <span className="text-sm text-green-700 dark:text-green-300 truncate flex-1">{attachment.name}</span>
                    <button
                      onClick={() => setAttachment(null)}
                      disabled={isPending}
                      className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isPending}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed w-full",
                      "border-gray-200 dark:border-slate-700 text-gray-400 dark:text-gray-500",
                      "hover:border-red-300 hover:text-red-400 dark:hover:border-red-700 dark:hover:text-red-400",
                      "transition-colors text-sm disabled:opacity-50"
                    )}
                  >
                    <Paperclip className="w-4 h-4" />
                    <span>Attach a file (screenshot, log, etc.)</span>
                  </button>
                )}
              </div>

              {/* Result message */}
              {result && (
                <div className={cn(
                  "flex items-start gap-2 px-4 py-3 rounded-lg text-sm",
                  result.ok
                    ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800"
                    : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
                )}>
                  {result.ok
                    ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                  <span>{result.msg}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between gap-3 bg-gray-50 dark:bg-slate-900/50">
              <button
                onClick={handleClose}
                disabled={isPending}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => mutate()}
                disabled={!canSubmit}
                className={cn(
                  "flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all",
                  canSubmit
                    ? "bg-red-600 hover:bg-red-700 text-white shadow-sm hover:shadow-md"
                    : "bg-gray-200 dark:bg-slate-700 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                )}
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Sending…</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Send Report</span>
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
}
