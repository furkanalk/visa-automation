"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth";

const PUBLIC_PATHS = ["/login", "/register"];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated } = useAuthStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const isPublicPath = PUBLIC_PATHS.includes(pathname);

    if (!isAuthenticated && !isPublicPath) {
      router.push("/login");
    }

    if (isAuthenticated && isPublicPath) {
      router.push("/");
    }
  }, [isAuthenticated, pathname, router, mounted]);

  // Show nothing until mounted to prevent hydration mismatch
  if (!mounted) {
    return null;
  }

  // If on public path and not authenticated, show the page
  if (PUBLIC_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  // If not authenticated, don't render protected content
  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
