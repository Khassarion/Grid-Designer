"""Persistence helpers for settings, presets, and undo history."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from layout.grid_layout import GridLayoutSettings
from models.source_item import SourceItem, TransformSnapshot

DEFAULT_PRESETS_PATH = Path.home() / ".obs_grid_layout" / "presets.json"


class PersistenceError(Exception):
    """Raised when save/load of layout data fails."""


def ensure_presets_dir(path: Path = DEFAULT_PRESETS_PATH) -> Path:
    """Create the presets directory if missing and return the file path."""
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def save_layout_json(
    path: Path,
    settings: GridLayoutSettings,
    sources: list[SourceItem],
    scene_name: str,
    extra: dict[str, Any] | None = None,
) -> None:
    """Save current layout configuration to a JSON file."""
    payload: dict[str, Any] = {
        "scene_name": scene_name,
        "settings": settings.to_dict(),
        "sources": [source.to_dict() for source in sources],
    }
    if extra:
        payload["extra"] = extra
    try:
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError as exc:
        raise PersistenceError(f"JSON 저장 실패: {exc}") from exc


def load_layout_json(path: Path) -> dict[str, Any]:
    """Load a layout JSON file and return parsed data."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PersistenceError(f"JSON 불러오기 실패: {exc}") from exc
    if not isinstance(data, dict):
        raise PersistenceError("JSON 형식이 올바르지 않습니다.")
    return data


def load_presets(path: Path = DEFAULT_PRESETS_PATH) -> dict[str, dict[str, Any]]:
    """Load named presets mapping name -> settings dict."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): v for k, v in data.items() if isinstance(v, dict)}


def save_presets(presets: dict[str, dict[str, Any]], path: Path = DEFAULT_PRESETS_PATH) -> None:
    """Persist all presets to disk."""
    ensure_presets_dir(path)
    try:
        path.write_text(json.dumps(presets, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError as exc:
        raise PersistenceError(f"프리셋 저장 실패: {exc}") from exc


def snapshots_to_dicts(snapshots: list[TransformSnapshot]) -> list[dict[str, Any]]:
    """Serialize undo snapshots."""
    return [snap.to_dict() for snap in snapshots]


def snapshots_from_dicts(items: list[dict[str, Any]]) -> list[TransformSnapshot]:
    """Deserialize undo snapshots."""
    result: list[TransformSnapshot] = []
    for item in items:
        result.append(
            TransformSnapshot(
                scene_name=str(item.get("scene_name", "")),
                scene_item_id=int(item.get("scene_item_id", 0)),
                source_name=str(item.get("source_name", "")),
                transform=dict(item.get("transform") or {}),
            )
        )
    return result
