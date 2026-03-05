import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: "staff" | "admin" | "super_admin";
  tenant_id: string;
  permissions: string[];
}

interface AuthState {
  user: StaffUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,

      login: async (email: string, password: string) => {
        const getCpApiUrl = () =>
          (typeof window !== "undefined" && localStorage.getItem("cp_api_url")) ||
          process.env.NEXT_PUBLIC_CP_API_URL ||
          "http://localhost:3001";

        const res = await fetch(`${getCpApiUrl()}/cp/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, tenant_id: "default" }),
        });
        const body = await res.json() as {
          success: boolean;
          data?: { staff: StaffUser & { permissions: unknown }; tenant_id: string };
          error?: { code: string; message: string };
        };

        if (!res.ok || !body.success || !body.data) {
          const err = new Error(body.error?.message ?? "Login failed");
          (err as any).code = body.error?.code;
          throw err;
        }

        const { staff, tenant_id } = body.data;
        const permissions = Array.isArray(staff.permissions) ? (staff.permissions as string[]) : [];

        // Staff portal requires: staff/admin/super_admin role AND staff_portal permission
        // super_admin always has access; admin also has access; staff needs staff_portal permission
        const hasAccess =
          staff.role === "super_admin" ||
          staff.role === "admin" ||
          permissions.includes("staff_portal");

        if (!hasAccess) {
          const err = new Error("Access denied. You need the staff_portal permission to access this portal.");
          (err as any).code = "ACCESS_DENIED";
          throw err;
        }

        if (typeof window !== "undefined") {
          localStorage.setItem("staff_tenant_id", tenant_id);
        }

        set({ user: { ...staff, permissions, tenant_id }, isAuthenticated: true });
        return true;
      },

      logout: () => {
        if (typeof window !== "undefined") {
          localStorage.removeItem("staff_tenant_id");
        }
        set({ user: null, isAuthenticated: false });
      },
    }),
    {
      name: "staff-portal-auth",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? sessionStorage : localStorage
      ),
    }
  )
);
