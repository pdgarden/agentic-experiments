import { useCallback, useSyncExternalStore } from "react";

// The selected session lives in the URL hash (`#<session id>`), so a reload reopens it.

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

const read = () => decodeURIComponent(window.location.hash.slice(1)) || null;

export function useHashSession(): [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(subscribe, read);
  const select = useCallback((next: string | null) => {
    if (next) {
      window.location.hash = encodeURIComponent(next);
    } else {
      window.history.pushState(null, "", window.location.pathname + window.location.search);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  }, []);
  return [id, select];
}
