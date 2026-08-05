"""Source and transform data models."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SourceItem:
    """Represents a filterable OBS scene item eligible for grid layout."""

    scene_item_id: int
    source_name: str
    input_kind: str
    selected: bool = True
    index: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Serialize this source for JSON persistence."""
        return {
            "scene_item_id": self.scene_item_id,
            "source_name": self.source_name,
            "input_kind": self.input_kind,
            "selected": self.selected,
            "index": self.index,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SourceItem:
        """Deserialize a source from JSON data."""
        return cls(
            scene_item_id=int(data["scene_item_id"]),
            source_name=str(data["source_name"]),
            input_kind=str(data.get("input_kind", "")),
            selected=bool(data.get("selected", True)),
            index=int(data.get("index", 0)),
        )


@dataclass
class TransformSnapshot:
    """Stores a scene item transform for undo restore."""

    scene_name: str
    scene_item_id: int
    source_name: str
    transform: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this snapshot for debugging or persistence."""
        return {
            "scene_name": self.scene_name,
            "scene_item_id": self.scene_item_id,
            "source_name": self.source_name,
            "transform": dict(self.transform),
        }
