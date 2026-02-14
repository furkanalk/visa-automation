import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive" | "success";
  size?: "sm" | "md" | "lg";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", type = "button", ...props }, ref) => {
    return (
      <button
        type={type}
        className={cn(
          "inline-flex items-center justify-center rounded-md font-medium transition-colors cursor-pointer",
          "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500",
          "disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed",
          {
            "bg-blue-600 text-white hover:bg-blue-700 shadow-sm": variant === "default",
            "border border-blue-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200":
              variant === "outline",
            "hover:bg-blue-100 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-200":
              variant === "ghost",
            "bg-red-600 text-white hover:bg-red-700 shadow-sm": variant === "destructive",
            "bg-green-600 text-white hover:bg-green-700 shadow-sm": variant === "success",
          },
          {
            "h-8 px-3 text-sm": size === "sm",
            "h-10 px-4 text-sm": size === "md",
            "h-12 px-6 text-base": size === "lg",
          },
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
