"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";
import { staffApi } from "@/lib/api";
import {
  ClipboardList,
  History,
  Bell,
  LogOut,
  Sun,
  Moon,
  User,
} from "lucide-react";

const navigation = [
  { name: "My Tasks", href: "/", icon: ClipboardList },
  { name: "History", href: "/history", icon: History },
  { name: "Notifications", href: "/notifications", icon: Bell },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();

  // Fetch pending count for badge
  const { data: pendingData } = useQuery({
    queryKey: ["pending-count"],
    queryFn: () => staffApi.getPendingCount(),
    refetchInterval: 10000,
  });

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <div className="flex h-full w-64 flex-col bg-blue-900 dark:bg-slate-950 transition-colors duration-300">
      {/* Header */}
      <div className="flex h-16 shrink-0 items-center justify-between px-6">
        <span className="text-xl font-bold text-white">Staff Portal</span>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-full hover:bg-blue-800 dark:hover:bg-slate-800 transition-colors"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? (
            <Sun className="h-5 w-5 text-yellow-300" />
          ) : (
            <Moon className="h-5 w-5 text-white" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col px-4 py-4">
        <ul role="list" className="flex flex-1 flex-col gap-y-1">
          {navigation.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            const showBadge = item.href === "/" && pendingData?.count && pendingData.count > 0;

            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className={cn(
                    "group flex gap-x-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-blue-800 dark:bg-slate-800 text-white"
                      : "text-blue-100 hover:bg-blue-800 dark:hover:bg-slate-800 hover:text-white"
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {item.name}
                  {showBadge && (
                    <span className="ml-auto inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold leading-none text-white bg-red-500 rounded-full">
                      {pendingData.count}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User section */}
      <div className="border-t border-blue-800 dark:border-slate-800 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-blue-700 dark:bg-slate-700 flex items-center justify-center">
              <User className="h-4 w-4 text-white" />
            </div>
            <div className="text-sm">
              <p className="font-medium text-white">{user?.name || "Staff"}</p>
              <p className="text-blue-200 dark:text-slate-400 text-xs capitalize">
                {user?.role?.replace("_", " ") || "staff"}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 text-blue-200 hover:text-white hover:bg-blue-800 dark:hover:bg-slate-800 rounded-md transition-colors"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
