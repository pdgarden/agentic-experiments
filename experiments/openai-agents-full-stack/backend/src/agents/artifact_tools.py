"""Tools that create and revise chart artifacts in the run's session.

The spec is a JSON string: strict function schemas cannot describe a
free-form object. It is validated before anything is stored; a bad spec comes
back to the model as a ``ToolErrorText`` it can act on.
"""

from agents import RunContextWrapper
from agents.decorators import tool

from src.agents.tool_errors import tool_error
from src.artifacts.chart import validate_chart_spec
from src.artifacts.models import ChartContent
from src.artifacts.output import ArtifactOutput, ArtifactRef
from src.runs.context import RunContext

MAX_TITLE_CHARS = 120


class ArtifactNotFound(LookupError):
    pass


def _title(title: str) -> str:
    cleaned = " ".join(title.split())
    if not cleaned:
        raise ValueError("title must not be empty")
    return cleaned[:MAX_TITLE_CHARS]


@tool(failure_error_function=tool_error)
async def create_chart(
    ctx: RunContextWrapper[RunContext], title: str, spec: str
) -> str:
    """Create a chart, shown to the user and saved in this chat as an artifact.

    Args:
        title: A short title for the chart.
        spec: A Vega-Lite spec as a JSON string. Data must be inline in
            "data": {"values": [...]}; URLs are rejected.
    """
    run = ctx.context
    content = ChartContent(spec=validate_chart_spec(spec))
    record = await run.store.create_artifact(
        run.session_id, "chart", _title(title), content, run.run_id
    )
    return ArtifactOutput.of(
        ArtifactRef(record.id, record.kind, record.title, 1, created=True)
    )


@tool(failure_error_function=tool_error)
async def update_chart(
    ctx: RunContextWrapper[RunContext],
    artifact_id: str,
    spec: str,
    title: str | None = None,
) -> str:
    """Save a new version of a chart this chat already has, e.g. to change its type.

    Args:
        artifact_id: The id returned by create_chart.
        spec: The full new Vega-Lite spec as a JSON string, data inline.
        title: A new title, or null to keep the current one.
    """
    run = ctx.context
    content = ChartContent(spec=validate_chart_spec(spec))
    record = await run.store.add_artifact_version(
        artifact_id,
        run.session_id,
        content,
        run.run_id,
        title=_title(title) if title is not None else None,
    )
    if record is None:
        raise ArtifactNotFound(f"No chart {artifact_id!r} in this chat")
    return ArtifactOutput.of(
        ArtifactRef(
            record.id, record.kind, record.title, record.latest_version, created=False
        )
    )
