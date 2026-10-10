"""Validation of chart specs written by the model.

A chart is a Vega-Lite spec the frontend renders with ``vega-embed``. The spec
must be self-contained: data is inline (``data.values``), never fetched, so a
chart cannot make the browser load anything. It is checked against the
Vega-Lite JSON schema vendored next to this module, which matches the
``vega-lite`` version the frontend renders with (refresh it when that version
changes: ``frontend/node_modules/vega-lite/build/vega-lite-schema.json``).

Errors are short and say where the problem is: the tool returns them to the
model, which can then fix the spec and retry.
"""

import json
from functools import cache
from pathlib import Path
from typing import Any, cast

from jsonschema import Draft7Validator
from jsonschema import exceptions as jsonschema_errors
from jsonschema.exceptions import ValidationError

SCHEMA_PATH = Path(__file__).parent / "vega-lite.v6.schema.json"
MAX_SPEC_BYTES = 256 * 1024
_MAX_LISTED_VALUES = 15
_INLINE_DATA_KEYS = frozenset({"values", "datasets"})


class ChartSpecError(ValueError):
    """A spec the frontend must not render; the message is for the model."""


@cache
def _validator() -> Draft7Validator:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return Draft7Validator(schema)


def validate_chart_spec(raw: str) -> dict[str, Any]:
    """The parsed spec, or ``ChartSpecError`` saying what to fix."""
    size = len(raw.encode())
    if size > MAX_SPEC_BYTES:
        raise ChartSpecError(
            f"Spec is {size // 1024} KB, over the {MAX_SPEC_BYTES // 1024} KB limit:"
            " aggregate the data first (e.g. with run_python)."
        )
    try:
        parsed: object = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ChartSpecError(f"Spec is not valid JSON: {error}")
    if not isinstance(parsed, dict):
        raise ChartSpecError("Spec must be a JSON object.")
    spec = cast("dict[str, Any]", parsed)

    remote = _remote_data_path(spec)
    if remote is not None:
        raise ChartSpecError(
            f"Data must be inline: found a URL at {remote}. Put the rows in"
            " data.values instead."
        )

    # ``$schema`` names a version (often v5); the vendored schema is what counts.
    checked = {key: value for key, value in spec.items() if key != "$schema"}
    problem = _first_error(checked)
    if problem is not None:
        raise ChartSpecError(f"Invalid Vega-Lite spec: {_describe(problem)}")
    return spec


def _first_error(spec: dict[str, Any]) -> ValidationError | None:
    """The most relevant schema violation; the stubs leave these untyped."""
    errors = cast("list[ValidationError]", list(_validator().iter_errors(spec)))  # pyright: ignore[reportUnknownMemberType]
    best_match = jsonschema_errors.best_match  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    return cast("ValidationError | None", best_match(errors))


def _remote_data_path(node: object, path: str = "spec") -> str | None:
    """Where the spec would fetch something, if anywhere.

    Every ``url`` key is rejected, wherever it is: data, layers, lookups,
    image marks and the ``url`` channel all fetch through the same loader.
    Inline rows (``values``, ``datasets``) are data, not spec: a row may have
    a ``url`` column.
    """
    if isinstance(node, dict):
        items = cast("dict[str, object]", node)
        if "url" in items:
            return f"{path}.url"
        for key, value in items.items():
            if key in _INLINE_DATA_KEYS:
                continue
            found = _remote_data_path(value, f"{path}.{key}")
            if found is not None:
                return found
    elif isinstance(node, list):
        values = cast("list[object]", node)
        for index, value in enumerate(values):
            found = _remote_data_path(value, f"{path}[{index}]")
            if found is not None:
                return found
    return None


def _describe(error: ValidationError) -> str:
    """``at <path>: <message>``, listing allowed values when the schema has them."""
    where = "".join(
        f"[{part}]" if isinstance(part, int) else f".{part}"
        for part in error.absolute_path
    )
    message = error.message
    if len(message) > 200:
        message = message[:200] + "…"
    allowed: list[str] = []
    for sub in [error, *(error.context or [])]:
        if sub.validator == "enum":
            allowed.extend(
                json.dumps(v) for v in cast("list[Any]", sub.validator_value)
            )
        elif sub.validator == "const":
            allowed.append(json.dumps(sub.validator_value))
    hint = ""
    if allowed:
        unique = list(dict.fromkeys(allowed))
        listed = ", ".join(unique[:_MAX_LISTED_VALUES])
        more = ", …" if len(unique) > _MAX_LISTED_VALUES else ""
        hint = f" (expected one of: {listed}{more})"
    return f"at spec{where}: {message}{hint}"
