import { useCallback, useSyncExternalStore } from "react";

// The open conversation lives in the URL hash (`#<conversation id>`), so a reload reopens it.

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

const read = () => {
  const value = window.location.hash.slice(1);
  return value ? decodeURIComponent(value) : null;
};

function navigate(id: string | null) {
  if (id) {
    window.location.hash = encodeURIComponent(id);
  } else {
    window.history.pushState(null, "", window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
}

export function useHashConversation(): [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(subscribe, read);
  const select = useCallback((next: string | null) => navigate(next), []);
  return [id, select];
}

/** A conversation id made on the client: the AI SDK chat id is the conversation id. */
export const newConversationId = () => crypto.randomUUID().replaceAll("-", "");
