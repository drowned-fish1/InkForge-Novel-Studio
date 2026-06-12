import { useEffect, useState } from "react";
import { bridge } from "@/lib/browserBridge";

export type AppTheme = "light" | "dark";

const themeStorageKey = "inkforge.theme";

const isAppTheme = (value: string | null): value is AppTheme => value === "light" || value === "dark";

const getSystemTheme = (): AppTheme => (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");

export const getInitialTheme = (): AppTheme => {
  const storedTheme = window.localStorage.getItem(themeStorageKey);
  return isAppTheme(storedTheme) ? storedTheme : getSystemTheme();
};

export const applyTheme = (theme: AppTheme): void => {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  void bridge.setTheme?.(theme, isAppTheme(window.localStorage.getItem(themeStorageKey)));
};

export const initializeTheme = (): void => {
  applyTheme(getInitialTheme());
};

export const useAppTheme = () => {
  const [theme, setTheme] = useState<AppTheme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) {
      return;
    }
    const syncSystemTheme = () => {
      if (!isAppTheme(window.localStorage.getItem(themeStorageKey))) {
        setTheme(getSystemTheme());
      }
    };
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, []);

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      window.localStorage.setItem(themeStorageKey, next);
      return next;
    });
  };

  return { theme, toggleTheme };
};
