"""Streamlit chat UI: pick a past conversation or start a new one."""

import uuid

import streamlit as st
from streamlit.delta_generator import DeltaGenerator

from src.agent_config import setup_observability
from src.agent_runtime import (
    AgentWorker,
    AssistantText,
    HistoryEntry,
    TextDelta,
    ToolCall,
    ToolOutput,
    TurnDone,
    TurnFailed,
    UserText,
    list_sessions,
    pretty_json,
)


@st.cache_resource
def get_worker() -> AgentWorker:
    setup_observability()
    return AgentWorker()


def render_tool_call(call: ToolCall, output: ToolOutput | None) -> None:
    with st.expander(f"🔧 {call.name}", expanded=False):
        st.caption("arguments")
        st.code(pretty_json(call.arguments), language="json")
        if output is not None:
            st.caption("output")
            st.code(output.output, language="text")


def render_history(entries: list[HistoryEntry]) -> None:
    outputs = {e.call_id: e for e in entries if isinstance(e, ToolOutput)}
    index = 0
    while index < len(entries):
        if isinstance(entries[index], UserText):
            with st.chat_message("user"):
                st.markdown(entries[index].text)
            index += 1
            continue

        block: list[HistoryEntry] = []
        while index < len(entries) and not isinstance(entries[index], UserText):
            block.append(entries[index])
            index += 1
        with st.chat_message("assistant"):
            for entry in block:
                if isinstance(entry, AssistantText):
                    st.markdown(entry.text)
                elif isinstance(entry, ToolCall):
                    render_tool_call(entry, outputs.get(entry.call_id))


def stream_turn(worker: AgentWorker, session_id: str, prompt: str) -> None:
    """Render one turn as it happens, then let the rerun replay it from the db."""
    events = worker.start_turn(session_id, prompt)
    placeholder = st.empty()
    buffer = ""
    panels: dict[str, DeltaGenerator] = {}
    final_output = ""
    error: BaseException | None = None

    while (event := events.get()) is not None:
        if isinstance(event, TurnDone):
            final_output = event.final_output
        elif isinstance(event, TurnFailed):
            error = event.error
        elif isinstance(event, TextDelta):
            buffer += event.text
            placeholder.markdown(buffer + "▌")
        elif isinstance(event, ToolCall):
            placeholder.markdown(buffer)
            panel = st.expander(f"🔧 {event.name}", expanded=True)
            panel.caption("arguments")
            panel.code(pretty_json(event.arguments), language="json")
            panels[event.call_id] = panel
            placeholder, buffer = st.empty(), ""
        elif isinstance(event, ToolOutput):
            panel = panels.get(event.call_id)
            if panel is not None:
                panel.caption("output")
                panel.code(event.output, language="text")

    placeholder.markdown(buffer or final_output)
    if error is not None:
        st.error(f"{type(error).__name__}: {error}")


def main() -> None:
    st.set_page_config(page_title="Agent chat", page_icon="💬")
    worker = get_worker()

    if "session_id" not in st.session_state:
        known = list_sessions()
        st.session_state.session_id = (
            known[0].session_id if known else f"chat-{uuid.uuid4().hex[:8]}"
        )
    current: str = st.session_state.session_id

    with st.sidebar:
        st.header("Conversations")
        if st.button("➕ New chat", use_container_width=True):
            st.session_state.session_id = f"chat-{uuid.uuid4().hex[:8]}"
            st.rerun()

        sessions = list_sessions()
        # A conversation with no message yet has no row in the database.
        if all(info.session_id != current for info in sessions):
            st.button(
                f"{current} · new",
                use_container_width=True,
                disabled=True,
                type="primary",
            )
        for info in sessions:
            if st.button(
                info.label,
                key=f"session-{info.session_id}",
                use_container_width=True,
                type="primary" if info.session_id == current else "secondary",
            ):
                st.session_state.session_id = info.session_id
                st.rerun()

    st.caption(f"Conversation `{current}`")
    render_history(worker.history(current))

    prompt = st.chat_input("Message the agent")
    if prompt:
        with st.chat_message("user"):
            st.markdown(prompt)
        with st.chat_message("assistant"):
            stream_turn(worker, current, prompt)
        st.rerun()


main()
