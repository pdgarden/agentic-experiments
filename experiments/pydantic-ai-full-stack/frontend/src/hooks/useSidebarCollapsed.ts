// Whether the sidebar is collapsed to an icon rail. Kept in localStorage; ⌘B / Ctrl+B toggles it.
// Below `md` the expanded sidebar overlays the chat, so it always starts collapsed there.
import { useCallback, useEffect, useState } from "react";

export const SIDEBAR_STORAGE_KEY = "sidebar-collapsed";
export const NARROW_QUERY = "(max-width: 767px)";

export const isNarrow = () => window.matchMedia?.(NARROW_QUERY).matches ?? false;

function readCollapsed(): boolean {
  if (isNarrow()) return true;
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false; // Storage blocked: start expanded.
  }
}

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    if (isNarrow()) return; // The overlay's state is not a preference.
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((value) => !value), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "b") return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  /** Close the overlay after a pick on a narrow screen; a no-op on wider ones. */
  const collapseIfNarrow = useCallback(() => {
    if (isNarrow()) setCollapsed(true);
  }, []);

  return { collapsed, toggle, collapseIfNarrow };
}
