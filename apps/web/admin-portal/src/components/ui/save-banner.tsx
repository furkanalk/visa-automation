"use client";

import { CheckCircle, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SaveBannerMessage {
  type: "success" | "error";
  text: string;
}

interface SaveBannerProps {
  message: SaveBannerMessage | null;
  onDismiss?: () => void;
}

export function SaveBanner({ message, onDismiss }: SaveBannerProps) {
  if (!message) return null;

  const isSuccess = message.type === "success";
  return (
    <div
      className={`rounded-lg flex items-center gap-2 p-4 ${
        isSuccess
          ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
          : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
      }`}
    >
      {isSuccess ? (
        <CheckCircle className="h-5 w-5 flex-shrink-0" />
      ) : (
        <AlertCircle className="h-5 w-5 flex-shrink-0" />
      )}
      <span className="flex-1">{message.text}</span>
      {onDismiss && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="flex-shrink-0 h-8 w-8 p-0 opacity-70 hover:opacity-100"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
