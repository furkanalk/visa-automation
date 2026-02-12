import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const applyTheme = (theme: Theme) => {
  if (typeof document !== "undefined") {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(theme);
    document.documentElement.setAttribute("data-theme", theme);
    console.log("[Theme] Applied:", theme, "Classes:", document.documentElement.className);
  }
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "light",

      setTheme: (theme: Theme) => {
        console.log("[Theme] setTheme:", theme);
        applyTheme(theme);
        set({ theme });
      },

      toggleTheme: () => {
        const current = get().theme;
        const newTheme = current === "light" ? "dark" : "light";
        console.log("[Theme] toggle:", current, "->", newTheme);
        applyTheme(newTheme);
        set({ theme: newTheme });
      },
    }),
    {
      name: "staff-portal-theme",
      onRehydrateStorage: () => (state) => {
        if (state) {
          console.log("[Theme] Rehydrated:", state.theme);
          applyTheme(state.theme);
        }
      },
    }
  )
);
