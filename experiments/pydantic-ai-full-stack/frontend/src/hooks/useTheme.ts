// Light / dark / system theme. The choice lives in localStorage; the resolved theme is the `.dark`
// class on <html>, which index.html also sets before first paint (keep the key and logic in sync).
import { useSyncExternalStore } from "react";

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
const darkQuery = "(prefers-color-scheme: dark)";

const isChoice = (value: unknown): value is ThemeChoice =>
  value === "light" || value === "dark" || value === "system";

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isChoice(stored)) return stored;
  } catch {
    // Storage blocked (private mode, sandbox): fall back to the system theme.
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(darkQuery).matches;
}

export const resolveTheme = (choice: ThemeChoice, systemDark: boolean): ResolvedTheme =>
  choice === "system" ? (systemDark ? "dark" : "light") : choice;

interface ThemeState {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
}

let state: ThemeState | null = null;
const listeners = new Set<() => void>();

function current(): ThemeState {
  if (!state) {
    const choice = readChoice();
    state = { choice, resolved: resolveTheme(choice, systemPrefersDark()) };
  }
  return state;
}

function update(choice: ThemeChoice) {
  const resolved = resolveTheme(choice, systemPrefersDark());
  const previous = current();
  if (previous.choice !== choice || previous.resolved !== resolved) state = { choice, resolved };
  document.documentElement.classList.toggle("dark", resolved === "dark");
  for (const listener of listeners) listener();
}

export function setTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Not persisted; still applies for this page.
  }
  update(choice);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = typeof window.matchMedia === "function" ? window.matchMedia(darkQuery) : null;
  const onSystemChange = () => update(current().choice);
  // Another tab changed the choice.
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) update(readChoice());
  };
  media?.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current);
  return { ...theme, setTheme };
}
