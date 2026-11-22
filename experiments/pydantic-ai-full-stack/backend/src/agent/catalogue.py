"""The model catalogue (`models.json`): which models the UI offers and how to reach them through the gateway."""

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

ThinkingLevel = Literal["off", "low", "medium", "high"]
THINKING_LEVELS: tuple[ThinkingLevel, ...] = ("off", "low", "medium", "high")


class ProfileOverrides(BaseModel):
    """`OpenAIChatModel` profile fields some gateway models need (see PLAN.md, *thinking compatibility*)."""

    openai_chat_thinking_field: str | None = None
    openai_chat_send_back_thinking_parts: Literal["auto", "tags", "field", False] | None = None
    openai_chat_thinking_requires_field_on_tool_calls: bool | None = None


class CatalogueModel(BaseModel):
    id: str
    label: str
    litellm_name: str
    thinking: bool = False
    context_window: int | None = None
    profile: ProfileOverrides = Field(default_factory=ProfileOverrides)

    def profile_dict(self) -> dict[str, Any]:
        profile: dict[str, Any] = self.profile.model_dump(exclude_none=True)
        if self.context_window is not None:
            profile["context_window"] = self.context_window
        return profile


class Catalogue(BaseModel):
    default_model: str
    utility_model: str
    models: list[CatalogueModel]

    @model_validator(mode="after")
    def _check_ids(self) -> "Catalogue":
        ids = [m.id for m in self.models]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate model ids in the catalogue")
        for name in (self.default_model, self.utility_model):
            if name not in ids:
                raise ValueError(f"{name!r} is not a catalogue model")
        return self

    def get(self, model_id: str) -> CatalogueModel | None:
        return next((m for m in self.models if m.id == model_id), None)

    def thinking_setting(self, model_id: str, level: ThinkingLevel) -> Literal[False, "low", "medium", "high"]:
        """The unified `thinking` model setting for a run; off for models that don't think."""
        model = self.get(model_id)
        if model is None or not model.thinking or level == "off":
            return False
        return level


def load_catalogue(path: Path) -> Catalogue:
    return Catalogue.model_validate(json.loads(path.read_text()))
