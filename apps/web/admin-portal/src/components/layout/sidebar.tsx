"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cpApi } from "@/lib/api";
import {
  LayoutDashboard,
  Bot,
  Settings2,
  Globe,
  Briefcase,
  Hand,
  Bell,
  Eye,
  ScrollText,
  Settings,
  LogOut,
  Users,
  UserCog,
  Loader2,
  CalendarSearch,
} from "lucide-react";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Customers", href: "/customers", icon: Users },
  { name: "Staff", href: "/staff", icon: UserCog },
  { name: "Agents", href: "/agents", icon: Bot },
  { name: "Profiles", href: "/profiles", icon: Settings2 },
  { name: "Portals", href: "/portals", icon: Globe },
  { name: "Jobs", href: "/jobs", icon: Briefcase },
  { name: "HITL", href: "/hitl", icon: Hand },
  { name: "Notifications", href: "/notifications", icon: Bell },
  { name: "Watcher", href: "/watcher", icon: Eye },
  { name: "Slots", href: "/slots", icon: CalendarSearch },
  { name: "Audit Logs", href: "/audit", icon: ScrollText },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const { data: mockSettings, isLoading: mockLoading } = useQuery({
    queryKey: ["settings", "mock"],
    queryFn: () => cpApi.settings.getCategory("mock"),
  });
  const mockEnabled = mockSettings?.enabled === true || mockSettings?.enabled === "true";

  const { data: systemStatus, isError: systemStatusError } = useQuery({
    queryKey: ["system-status"],
    queryFn: () => cpApi.getSystemStatus(),
    retry: false,
    refetchInterval: 30 * 1000,
  });
  const { data: healthData } = useQuery({
    queryKey: ["health"],
    queryFn: () => cpApi.getHealth(),
    retry: false,
    refetchInterval: 30 * 1000,
  });

  type LivenessLabel = "Healthy" | "Unstable" | "Down";
  const online = systemStatus?.agent_stats?.online ?? 0;
  const total = systemStatus?.agent_stats?.total ?? 0;
  const healthOk = healthData?.status === "healthy";
  let liveness: LivenessLabel = "Healthy";
  if (systemStatusError || !systemStatus) {
    liveness = "Down";
  } else if (total > 0 && online === 0) {
    liveness = "Down";
  } else if (!healthOk || (total > 0 && online < total)) {
    liveness = "Unstable";
  }
  const dotColorClass =
    liveness === "Healthy"
      ? "bg-emerald-400"
      : liveness === "Unstable"
        ? "bg-amber-400"
        : "bg-red-400";

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <div
      className={cn(
        "flex h-full w-64 flex-col bg-[var(--bg-sidebar)] dark:bg-slate-950 transition-colors duration-300",
        mockEnabled && "border-l-2 border-amber-500/80"
      )}
    >
      <div className="flex h-16 shrink-0 items-center justify-between px-4">
        <div className="flex flex-col">
          <span className="text-xl font-bold text-white leading-tight">Vizeself Manager</span>
          {systemStatus?.version && (
            <span className="text-[10px] text-gray-500 leading-tight font-mono">v{systemStatus.version}</span>
          )}
        </div>
        <ThemeToggle size="sm" />
      </div>
      {/* Live | Mock: subtle pill with liveness (Healthy / Unstable / Down) */}
      <Link
        href="/settings?tab=mock"
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-2 mx-3 mb-2 rounded-lg border transition-all duration-200",
          "hover:brightness-110",
          !mockEnabled
            ? "bg-blue-500/15 border-blue-400/40 text-blue-200"
            : "bg-amber-500/15 border-amber-400/40 text-amber-200"
        )}
        title="Change in Settings → Mock"
      >
        {mockLoading ? (
          <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
        ) : (
          <>
            <div className="flex items-center gap-2 min-w-0">
              {!mockEnabled && (
                <span
                  className={cn(
                    "inline-block w-2 h-2 rounded-full flex-shrink-0 animate-live-blink",
                    dotColorClass
                  )}
                  aria-hidden
                />
              )}
              <span className="text-sm font-medium truncate">
                {!mockEnabled ? "Live" : "Mock"}
              </span>
            </div>
            {!mockEnabled && (
              <span className="text-xs opacity-70 truncate flex-shrink-0" title={liveness}>
                {liveness}
              </span>
            )}
          </>
        )}
      </Link>
      <nav className="flex flex-1 flex-col px-4 py-4">
        <ul role="list" className="flex flex-1 flex-col gap-y-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href || 
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className={cn(
                    "group flex gap-x-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-gray-800 text-white"
                      : "text-gray-400 hover:bg-gray-800 hover:text-white"
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-gray-800 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium">
              {user?.name?.charAt(0) || "A"}
            </div>
            <div className="text-sm">
              <p className="font-medium text-white">{user?.name || "User"}</p>
              <p className="text-gray-400 text-xs">{user?.role || "admin"}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
