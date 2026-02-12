import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
        {
          "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300": variant === "default",
          "bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-gray-300": variant === "secondary",
          "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300": variant === "destructive",
          "border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300": variant === "outline",
          "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300": variant === "success",
          "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300": variant === "warning",
        },
        className
      )}
      {...props}
    />
  );
}

export { Badge };
