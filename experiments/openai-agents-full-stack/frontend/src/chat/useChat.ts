import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api } from "@/api/client";
import { queryKeys, sessionQuery } from "@/api/queries";
import { type EventSourceFactory, subscribeRun } from "@/api/stream";
import type { InputPart } from "@/api/types";
import { activeRun, chatReducer, initialChat } from "@/chat/state";

/**
 * A session's runs: history from the API, folded, plus the live tail of the run in
 * progress. A run still running on load (e.g. after a page reload) is resumed after its
 * last stored event.
 */
export function useChat(sessionId: string, createSource?: EventSourceFactory) {
  const queryClient = useQueryClient();
  const detail = useQuery(sessionQuery(sessionId));
  const [state, dispatch] = useReducer(chatReducer, initialChat);
  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    if (detail.data) dispatch({ type: "loaded", runs: detail.data.runs });
  }, [detail.data]);

  const active = activeRun(state);
  const activeId = active?.id;
  // Read at subscription time only: a new seq must not resubscribe.
  const lastSeq = useRef(0);
  lastSeq.current = active?.lastSeq ?? 0;

  useEffect(() => {
    if (!activeId) return;
    setStreamError(null);
    return subscribeRun(
      activeId,
      lastSeq.current,
      {
        onEvent: (event) => {
          dispatch({ type: "event", runId: activeId, event });
          if (event.type === "run_finished") {
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
          }
        },
        onError: (error) => {
          setStreamError(error.message);
          void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
        },
      },
      createSource,
    );
  }, [activeId, sessionId, queryClient, createSource]);

  const send = useCallback(
    async (parts: InputPart[]) => {
      const runId = await api.startRun(sessionId, parts);
      dispatch({ type: "started", runId, input: parts });
      // The first message sets the session title.
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions, exact: true });
    },
    [sessionId, queryClient],
  );

  const cancel = useCallback(async () => {
    if (activeId) await api.cancelRun(activeId);
  }, [activeId]);

  return {
    runs: state.runs,
    running: active !== undefined,
    loading: detail.isPending,
    loadError: detail.error,
    streamError,
    send,
    cancel,
  };
}
