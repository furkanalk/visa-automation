import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface User {
  id: string;
  email: string;
  name: string;
  role: "super_admin" | "admin" | "staff";
  tenant_id: string;
  permissions: string[];
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
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
        const body = await res.json() as { success: boolean; data?: { staff: User & { permissions: unknown }; tenant_id: string }; error?: { code: string; message: string } };

        if (!res.ok || !body.success || !body.data) {
          const code = body.error?.code;
          const msg = body.error?.message ?? "Login failed";
          // Re-throw specific errors so the login page can show them properly
          const err = new Error(msg);
          (err as any).code = code;
          throw err;
        }

        const { staff, tenant_id } = body.data;
        const permissions = Array.isArray(staff.permissions) ? (staff.permissions as string[]) : [];

        // Admin portal requires: super_admin OR admin role OR admin_panel permission
        const hasAccess =
          staff.role === "super_admin" ||
          staff.role === "admin" ||
          permissions.includes("admin_panel");

        if (!hasAccess) {
          const err = new Error("Access denied. Admin portal requires admin role or admin_panel permission.");
          (err as any).code = "ACCESS_DENIED";
          throw err;
        }

        if (typeof window !== "undefined") {
          localStorage.setItem("admin_tenant_id", tenant_id);
        }

        const token = btoa(`${email}:${Date.now()}`);
        set({
          user: { ...staff, permissions, tenant_id },
          token,
          isAuthenticated: true,
        });
        return true;
      },

      logout: () => {
        if (typeof window !== "undefined") {
          localStorage.removeItem("admin_tenant_id");
        }
        set({ user: null, token: null, isAuthenticated: false });
      },
    }),
    {
      name: "visa-automation-auth",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? sessionStorage : localStorage
      ),
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
