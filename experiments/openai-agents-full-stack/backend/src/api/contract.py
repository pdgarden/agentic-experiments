"""Publish the stream contract in the OpenAPI schema.

FastAPI cannot infer the SSE item type when the endpoint yields
``ServerSentEvent`` (needed to set ``id``), so the event union would be
missing from the schema the frontend types are generated from. This adds the
``Event`` and ``Part`` unions to ``components.schemas`` and points the events
route's SSE ``data`` at ``Event``.
"""

from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from pydantic import TypeAdapter

from src.api.runs import EVENTS_ROUTE_NAME
from src.events import Event
from src.parts import Part

_REF = "#/components/schemas/{model}"
_CONTRACT: dict[str, Any] = {"Event": Event, "Part": Part}


def _contract_schemas() -> dict[str, Any]:
    schemas: dict[str, Any] = {}
    for name, type_ in _CONTRACT.items():
        schema = TypeAdapter(type_).json_schema(ref_template=_REF, mode="serialization")
        schemas.update(schema.pop("$defs", {}))
        schemas[name] = schema
    return schemas


def install_contract(app: FastAPI) -> None:
    def openapi() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
        components = schema.setdefault("components", {}).setdefault("schemas", {})
        components.update(_contract_schemas())

        content = next(
            operation["responses"]["200"]["content"]
            for methods in schema["paths"].values()
            for operation in methods.values()
            if operation["operationId"].startswith(f"{EVENTS_ROUTE_NAME}_")
        )
        item = content["text/event-stream"]["itemSchema"]
        item["required"] = ["data"]
        item["properties"]["data"] = {
            "type": "string",
            "contentMediaType": "application/json",
            "contentSchema": {"$ref": _REF.format(model="Event")},
        }
        app.openapi_schema = schema
        return schema

    app.openapi = openapi
