import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-white shadow dark:bg-blue-600",
        secondary: "border-blue-200 bg-blue-100 dark:bg-slate-700 text-blue-800 dark:text-gray-100",
        destructive: "border-transparent bg-red-500 dark:bg-red-600 text-white shadow",
        outline: "border-blue-300 dark:border-slate-600 text-gray-900 dark:text-gray-100",
        success: "border-transparent bg-green-500 dark:bg-green-600 text-white",
        warning: "border-transparent bg-yellow-500 dark:bg-yellow-600 text-white",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
