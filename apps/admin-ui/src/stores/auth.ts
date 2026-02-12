import { create } from "zustand";
import { persist } from "zustand/middleware";

interface User {
  id: string;
  email: string;
  name: string;
  role: "super_admin" | "admin" | "staff";
  tenant_id: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

// For MVP: simple hardcoded auth
const ADMIN_USERS: Record<string, { password: string; user: User }> = {
  "admin@visa-automation.local": {
    password: "admin123", // Change in production!
    user: {
      id: "admin-1",
      email: "admin@visa-automation.local",
      name: "Admin User",
      role: "super_admin",
      tenant_id: "default",
    },
  },
  "staff@visa-automation.local": {
    password: "staff123",
    user: {
      id: "staff-1",
      email: "staff@visa-automation.local",
      name: "Staff User",
      role: "staff",
      tenant_id: "default",
    },
  },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      login: async (email: string, password: string) => {
        // MVP: Simple credential check
        const userRecord = ADMIN_USERS[email.toLowerCase()];
        
        if (userRecord && userRecord.password === password) {
          const token = btoa(`${email}:${Date.now()}`);
          // Store tenant_id for API requests
          if (typeof window !== "undefined") {
            localStorage.setItem("admin_tenant_id", userRecord.user.tenant_id);
          }
          set({
            user: userRecord.user,
            token,
            isAuthenticated: true,
          });
          return true;
        }
        
        return false;
      },

      logout: () => {
        // Clear tenant_id on logout
        if (typeof window !== "undefined") {
          localStorage.removeItem("admin_tenant_id");
        }
        set({
          user: null,
          token: null,
          isAuthenticated: false,
        });
      },
    }),
    {
      name: "visa-automation-auth",
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
