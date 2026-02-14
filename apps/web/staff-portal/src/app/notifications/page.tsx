"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { staffApi, Notification } from "@/lib/api";
import { formatTimeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  Bell,
  BellOff,
  ClipboardList,
  AlertTriangle,
  MessageSquare,
  Info,
  Check,
  RefreshCw,
} from "lucide-react";

const NOTIFICATION_ICONS: Record<Notification["type"], React.ElementType> = {
  task_assigned: ClipboardList,
  task_expired: AlertTriangle,
  escalation_response: MessageSquare,
  system: Info,
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();

  const { data: notificationsData, isLoading, refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => staffApi.getNotifications({ limit: "50" }),
    refetchInterval: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => staffApi.markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const unreadCount = notificationsData?.items?.filter((n) => !n.read).length || 0;

  const getNotificationStyle = (type: Notification["type"], read: boolean) => {
    if (read) return "bg-white dark:bg-slate-800 opacity-60";
    
    switch (type) {
      case "task_assigned":
        return "bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500";
      case "task_expired":
        return "bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500";
      case "escalation_response":
        return "bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-500";
      default:
        return "bg-gray-50 dark:bg-slate-800";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Notifications</h1>
          <p className="text-gray-500 dark:text-gray-400">
            Stay updated with task assignments and updates
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Badge variant="destructive">{unreadCount} unread</Badge>
          )}
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Notifications List */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          Loading notifications...
        </div>
      ) : notificationsData?.items && notificationsData.items.length > 0 ? (
        <div className="space-y-3">
          {notificationsData.items.map((notification) => {
            const Icon = NOTIFICATION_ICONS[notification.type] || Info;

            return (
              <Card
                key={notification.id}
                className={cn(
                  "transition-all cursor-pointer hover:shadow-md",
                  getNotificationStyle(notification.type, notification.read)
                )}
                onClick={() => {
                  if (!notification.read) {
                    markReadMutation.mutate(notification.id);
                  }
                }}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div
                      className={cn(
                        "p-2 rounded-lg shrink-0",
                        notification.type === "task_assigned"
                          ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600"
                          : notification.type === "task_expired"
                          ? "bg-red-100 dark:bg-red-900/30 text-red-600"
                          : notification.type === "escalation_response"
                          ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600"
                          : "bg-gray-100 dark:bg-slate-700 text-gray-600"
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h3
                          className={cn(
                            "font-medium",
                            notification.read
                              ? "text-gray-600 dark:text-gray-400"
                              : "text-gray-900 dark:text-white"
                          )}
                        >
                          {notification.title}
                        </h3>
                        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                          {formatTimeAgo(notification.created_at)}
                        </span>
                      </div>
                      <p
                        className={cn(
                          "text-sm mt-1",
                          notification.read
                            ? "text-gray-500 dark:text-gray-500"
                            : "text-gray-600 dark:text-gray-300"
                        )}
                      >
                        {notification.message}
                      </p>
                      {!notification.read && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            markReadMutation.mutate(notification.id);
                          }}
                        >
                          <Check className="h-4 w-4 mr-1" />
                          Mark as read
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <BellOff className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No notifications</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              You&apos;ll see task assignments and updates here.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
