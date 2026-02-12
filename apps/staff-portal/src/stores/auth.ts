import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: "staff" | "senior_staff";
  tenant_id: string;
}

interface AuthState {
  user: StaffUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

// Mock staff users for MVP
const MOCK_STAFF: Record<string, { password: string; user: StaffUser }> = {
  "staff@example.com": {
    password: "staff123",
    user: {
      id: "staff-1",
      name: "John Staff",
      email: "staff@example.com",
      role: "staff",
      tenant_id: "default",
    },
  },
  "senior@example.com": {
    password: "senior123",
    user: {
      id: "staff-2",
      name: "Jane Senior",
      email: "senior@example.com",
      role: "senior_staff",
      tenant_id: "default",
    },
  },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,

      login: async (email: string, password: string) => {
        // MVP: Mock authentication
        const staffRecord = MOCK_STAFF[email.toLowerCase()];
        if (staffRecord && staffRecord.password === password) {
          // Store tenant_id for API requests
          if (typeof window !== "undefined") {
            localStorage.setItem("staff_tenant_id", staffRecord.user.tenant_id);
          }
          set({ user: staffRecord.user, isAuthenticated: true });
          return true;
        }
        return false;
      },

      logout: () => {
        // Clear tenant_id on logout
        if (typeof window !== "undefined") {
          localStorage.removeItem("staff_tenant_id");
        }
        set({ user: null, isAuthenticated: false });
      },
    }),
    {
      name: "staff-portal-auth",
    }
  )
);
