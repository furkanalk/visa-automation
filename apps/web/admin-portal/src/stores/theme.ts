import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const getSystemTheme = (): "light" | "dark" => {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const applyTheme = (resolvedTheme: "light" | "dark") => {
  if (typeof document !== "undefined") {
    // Remove both classes first
    document.documentElement.classList.remove("light", "dark");
    // Add the new theme class
    document.documentElement.classList.add(resolvedTheme);
    // Also set a data attribute for debugging
    document.documentElement.setAttribute("data-theme", resolvedTheme);
    console.log("[Theme] Applied:", resolvedTheme, "Classes:", document.documentElement.className);
  }
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "light", // Default to light instead of system for predictability
      resolvedTheme: "light",

      setTheme: (theme: Theme) => {
        const resolvedTheme = theme === "system" ? getSystemTheme() : theme;
        console.log("[Theme] setTheme called:", { theme, resolvedTheme });
        applyTheme(resolvedTheme);
        set({ theme, resolvedTheme });
      },

      toggleTheme: () => {
        const currentResolved = get().resolvedTheme;
        const newResolved = currentResolved === "light" ? "dark" : "light";
        console.log("[Theme] toggleTheme:", currentResolved, "->", newResolved);
        applyTheme(newResolved);
        set({ theme: newResolved, resolvedTheme: newResolved });
      },
    }),
    {
      name: "visa-automation-theme",
      onRehydrateStorage: () => (state) => {
        // Apply theme after rehydration
        if (state) {
          const resolved = state.theme === "system" ? getSystemTheme() : state.theme;
          console.log("[Theme] Rehydrated:", { theme: state.theme, resolved });
          applyTheme(resolved);
        }
      },
    }
  )
);

// Listen for system theme changes
if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    const state = useThemeStore.getState();
    if (state.theme === "system") {
      const newResolved = e.matches ? "dark" : "light";
      useThemeStore.setState({ resolvedTheme: newResolved });
      applyTheme(newResolved);
    }
  });
}
