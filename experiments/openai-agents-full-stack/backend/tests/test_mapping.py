from agents import Agent, Runner, function_tool
from agents.testing import ModelStep, assistant_message, function_call

from src.agents.tool_errors import ToolErrorText, tool_error
from src.events import AgentChanged, Event, TextDelta, ToolCall, ToolResult
from src.runs.mapping import EventMapper
from tests.fakes import call, say, scripted


@function_tool
def add(a: int, b: int) -> int:
    return a + b


@function_tool(failure_error_function=tool_error)
def explode() -> str:
    raise ValueError("boom")


async def run_mapped(agent: Agent[None], prompt: str = "go") -> list[Event]:
    mapper = EventMapper(agent.name)
    result = Runner.run_streamed(agent, prompt)
    events: list[Event] = []
    async for sdk_event in result.stream_events():
        events.extend(mapper.map(sdk_event))
    return events


async def test_text_tool_text_makes_two_segments() -> None:
    model = scripted(call("add", {"a": 2, "b": 3}), say("It is 5."))
    agent = Agent[None](name="assistant", model=model, tools=[add])

    events = await run_mapped(agent)

    assert [type(e) for e in events if not isinstance(e, TextDelta)] == [
        ToolCall,
        ToolResult,
    ]
    tool_call = next(e for e in events if isinstance(e, ToolCall))
    assert (tool_call.call_id, tool_call.name) == ("call_1", "add")
    assert tool_call.args == '{"a":2,"b":3}'
    result = next(e for e in events if isinstance(e, ToolResult))
    assert (result.call_id, result.result, result.is_error) == ("call_1", "5", False)

    deltas = [e for e in events if isinstance(e, TextDelta)]
    assert "".join(d.delta for d in deltas) == "It is 5."
    assert {d.segment_id for d in deltas} == {"s1"}
    model.assert_complete()


async def test_segments_split_around_tool_calls() -> None:
    model = scripted(
        ModelStep(
            output=[
                assistant_message("Let me add."),
                function_call("add", {"a": 1, "b": 1}, call_id="call_1"),
            ]
        ),
        say("It is 2."),
    )
    agent = Agent[None](name="assistant", model=model, tools=[add])

    events = await run_mapped(agent)

    segments: dict[str, str] = {}
    for event in events:
        if isinstance(event, TextDelta):
            text = segments.get(event.segment_id, "")
            segments[event.segment_id] = text + event.delta
    assert segments == {"s1": "Let me add.", "s2": "It is 2."}
    kinds = [e.type for e in events if e.type != "text_delta"]
    assert kinds == ["tool_call", "tool_result"]


async def test_tool_failure_is_flagged() -> None:
    model = scripted(call("explode", {}), say("It failed."))
    agent = Agent[None](name="assistant", model=model, tools=[explode])

    events = await run_mapped(agent)

    result = next(e for e in events if isinstance(e, ToolResult))
    assert result.is_error
    assert result.result == "ValueError: boom"
    assert isinstance(ToolErrorText("x"), str)


async def test_handoff_emits_agent_changed() -> None:
    model = scripted(call("transfer_to_expert", {}), say("Expert here."))
    expert = Agent[None](name="expert", model=model)
    triage = Agent[None](name="triage", model=model, handoffs=[expert])

    events = await run_mapped(triage)

    changes = [e for e in events if isinstance(e, AgentChanged)]
    assert [c.agent for c in changes] == ["expert"]
