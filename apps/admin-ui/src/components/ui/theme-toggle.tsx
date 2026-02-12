"use client";

import { Sun, Moon } from "lucide-react";
import { useThemeStore } from "@/stores/theme";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function ThemeToggle({ className, size = "md" }: ThemeToggleProps) {
  const { resolvedTheme, toggleTheme } = useThemeStore();

  const isDark = resolvedTheme === "dark";
  const iconSize = size === "sm" ? 16 : size === "md" ? 20 : 24;

  return (
    <button
      onClick={toggleTheme}
      className={cn(
        "relative rounded-full p-2 transition-all duration-500 ease-in-out",
        "hover:scale-110 active:scale-95",
        "focus:outline-none focus:ring-2 focus:ring-primary/50",
        isDark
          ? "bg-gray-800 text-yellow-300 hover:bg-gray-700"
          : "bg-yellow-100 text-yellow-600 hover:bg-yellow-200",
        size === "sm" && "h-8 w-8",
        size === "md" && "h-10 w-10",
        size === "lg" && "h-12 w-12",
        className
      )}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <div className="relative flex items-center justify-center">
        {/* Sun icon */}
        <Sun
          size={iconSize}
          className={cn(
            "absolute transition-all duration-500 ease-in-out",
            isDark
              ? "rotate-90 scale-0 opacity-0"
              : "rotate-0 scale-100 opacity-100"
          )}
        />
        {/* Moon icon */}
        <Moon
          size={iconSize}
          className={cn(
            "absolute transition-all duration-500 ease-in-out",
            isDark
              ? "rotate-0 scale-100 opacity-100"
              : "-rotate-90 scale-0 opacity-0"
          )}
        />
      </div>
    </button>
  );
}
