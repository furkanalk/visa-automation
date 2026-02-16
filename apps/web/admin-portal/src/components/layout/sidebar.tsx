"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { ThemeToggle } from "@/components/ui/theme-toggle";
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
  Sliders,
  UserCog,
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
  { name: "Audit Logs", href: "/audit", icon: ScrollText },
  { name: "Config", href: "/config", icon: Sliders },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <div className="flex h-full w-64 flex-col bg-[var(--bg-sidebar)] dark:bg-slate-950 transition-colors duration-300">
      <div className="flex h-16 shrink-0 items-center justify-between px-6">
        <span className="text-xl font-bold text-white">Visor Manager</span>
        <ThemeToggle size="sm" />
      </div>
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
