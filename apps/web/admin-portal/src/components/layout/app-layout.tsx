"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { AuthGuard } from "./auth-guard";
import { useThemeStore } from "@/stores/theme";

const NO_LAYOUT_PATHS = ["/login"];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showLayout = !NO_LAYOUT_PATHS.includes(pathname);
  const [mounted, setMounted] = useState(false);
  
  // Subscribe to theme store to ensure re-renders on theme change
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent hydration mismatch
  if (!mounted) {
    return null;
  }

  return (
    <AuthGuard>
      {showLayout ? (
        <div className="flex h-screen transition-colors duration-300">
          <Sidebar />
          <main className="flex-1 overflow-auto bg-[#f0f7ff] dark:bg-slate-900 p-6 transition-colors duration-300">
            {children}
          </main>
        </div>
      ) : (
        <>{children}</>
      )}
    </AuthGuard>
  );
}
