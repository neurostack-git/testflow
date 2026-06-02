"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";

type Theme = "light" | "dark";

// Routes that must ALWAYS render in light mode regardless of stored preference.
const LIGHT_LOCKED = ["/", "/login", "/signup", "/onboarding"];

const STORAGE_KEY = "tf-theme";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  isLightLocked: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>("light");
  const isLightLocked = LIGHT_LOCKED.includes(pathname);

  // Hydrate stored preference once on mount
  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "light";
    setTheme(stored === "dark" ? "dark" : "light");
  }, []);

  // Apply/remove the .dark class on <html>. Light-locked routes never get it.
  useEffect(() => {
    const root = document.documentElement;
    if (!isLightLocked && theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme, isLightLocked]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isLightLocked }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
