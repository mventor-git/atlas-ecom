import * as React from "react";

/**
 * The mode is one class on `<html>`, set before first paint by the inline script
 * in `index.html`, so a reload in dark never flashes light. This module owns the
 * choice after that: an explicit `light`/`dark` persists in `localStorage`, and
 * anything else follows `prefers-color-scheme`, which is the fallback the
 * server-rendered pages lacked.
 */

export const THEME_STORAGE_KEY = "atlas-ecom-theme";
export const DARK_CLASS = "dark";

export type Theme = "light" | "dark";

/** An unrecognised stored value is treated as no choice, not as an error. */
export function readStoredTheme(storage: Pick<Storage, "getItem"> | null = safeStorage()): Theme | null {
  const value = storage?.getItem(THEME_STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

export function systemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(stored: Theme | null): Theme {
  return stored ?? systemTheme();
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // A blocked storage is a browser privacy mode, not a failure to render.
    return null;
  }
}

export function applyThemeClass(theme: Theme, root: HTMLElement | null = document.documentElement): void {
  if (root === null) return;
  root.classList.toggle(DARK_CLASS, theme === "dark");
  root.style.colorScheme = theme;
}

export interface ThemeContextValue {
  readonly theme: Theme;
  setTheme(next: Theme): void;
  toggle(): void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(() => resolveTheme(readStoredTheme()));

  const setTheme = React.useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Still switches for this session when storage is unavailable.
    }
    setThemeState(next);
  }, []);

  React.useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  // With no stored choice the mode follows the system, including a change to it
  // while the tab is open. A stored choice is the visitor's and does not move.
  React.useEffect(() => {
    if (readStoredTheme() !== null) return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => setThemeState(query.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggle: () => setTheme(theme === "light" ? "dark" : "light"),
    }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = React.useContext(ThemeContext);
  if (value === null) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
