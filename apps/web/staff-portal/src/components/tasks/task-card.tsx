"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn, formatTimeAgo, getTaskPriorityClass } from "@/lib/utils";
import type { HitlTask, HitlTaskType } from "@/lib/api";
import {
  Shield,
  Image,
  Key,
  FileQuestion,
  Eye,
  Keyboard,
  Clock,
  Play,
} from "lucide-react";

const TASK_TYPE_CONFIG: Record<
  HitlTaskType,
  { icon: React.ElementType; label: string; color: string }
> = {
  TURNSTILE: { icon: Shield, label: "Turnstile", color: "default" },
  CAPTCHA: { icon: Image, label: "CAPTCHA", color: "warning" },
  OTP: { icon: Key, label: "OTP Code", color: "destructive" },
  SECURITY_CODE: { icon: Key, label: "Security Code", color: "destructive" },
  DOCUMENT_CLARIFICATION: { icon: FileQuestion, label: "Document", color: "secondary" },
  MANUAL_REVIEW: { icon: Eye, label: "Review", color: "secondary" },
  CUSTOM_INPUT: { icon: Keyboard, label: "Input", color: "default" },
};

interface TaskCardProps {
  task: HitlTask;
  onSelect: () => void;
  isAssigned?: boolean;
}

export function TaskCard({ task, onSelect, isAssigned }: TaskCardProps) {
  const typeConfig = task.type ? TASK_TYPE_CONFIG[task.type] : null;
  const Icon = typeConfig?.icon || FileQuestion;

  return (
    <Card
      className={cn(
        "hover:shadow-md transition-shadow cursor-pointer",
        getTaskPriorityClass(task.expires_at),
        isAssigned && "ring-2 ring-blue-500"
      )}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "p-2 rounded-lg",
                task.type === "OTP" || task.type === "SECURITY_CODE"
                  ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                  : task.type === "CAPTCHA"
                  ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"
                  : "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant={typeConfig?.color as any || "default"}>
                  {typeConfig?.label || task.type || "Unknown"}
                </Badge>
                {isAssigned && (
                  <Badge variant="success">Assigned to you</Badge>
                )}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                {task.context?.prompt || "No description"}
              </p>
              <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatTimeAgo(task.created_at)}
                </span>
                <span className="font-mono">
                  Job: {task.job_id.slice(0, 8)}...
                </span>
              </div>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}>
            <Play className="h-4 w-4 mr-1" />
            Start
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
