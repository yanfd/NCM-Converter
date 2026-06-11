import { useState, useEffect, useCallback } from "react";

export type Theme = "general" | "light" | "frutiger-aero";

const THEME_KEY = "ncm-converter-theme";

const THEME_LABELS: Record<Theme, string> = {
  general: "General",
  light: "Light",
  "frutiger-aero": "Frutiger Aero",
};

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && saved in THEME_LABELS) return saved as Theme;
    return "general";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  return { theme, setTheme, labels: THEME_LABELS };
}
