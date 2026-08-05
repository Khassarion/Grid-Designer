"""Grid layout calculation for OBS source placement."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any


class AspectRatio(str, Enum):
    """Supported cell aspect-ratio modes."""

    FREE = "free"
    RATIO_16_9 = "16:9"
    RATIO_4_3 = "4:3"


@dataclass
class GridLayoutSettings:
    """User-configurable placement rectangle and grid options."""

    start_x: float = 0.0
    start_y: float = 0.0
    width: float = 1920.0
    height: float = 1080.0
    columns: int = 4
    gap: float = 10.0
    padding: float = 20.0
    keep_square: bool = False
    aspect_ratio: AspectRatio = AspectRatio.FREE

    def to_dict(self) -> dict[str, Any]:
        """Serialize settings for JSON save/load and presets."""
        data = asdict(self)
        data["aspect_ratio"] = self.aspect_ratio.value
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> GridLayoutSettings:
        """Deserialize settings from a dictionary."""
        aspect = data.get("aspect_ratio", AspectRatio.FREE.value)
        if isinstance(aspect, AspectRatio):
            aspect_ratio = aspect
        else:
            aspect_ratio = AspectRatio(str(aspect))

        return cls(
            start_x=float(data.get("start_x", 0.0)),
            start_y=float(data.get("start_y", 0.0)),
            width=float(data.get("width", 1920.0)),
            height=float(data.get("height", 1080.0)),
            columns=max(1, int(data.get("columns", 4))),
            gap=float(data.get("gap", 10.0)),
            padding=float(data.get("padding", 20.0)),
            keep_square=bool(data.get("keep_square", False)),
            aspect_ratio=aspect_ratio,
        )


@dataclass(frozen=True)
class GridCell:
    """Absolute position and size of one grid cell."""

    index: int
    row: int
    col: int
    x: float
    y: float
    width: float
    height: float


def _fit_aspect(width: float, height: float, ratio_w: float, ratio_h: float) -> tuple[float, float]:
    """Shrink a rectangle so it matches the given aspect ratio."""
    if width <= 0 or height <= 0 or ratio_w <= 0 or ratio_h <= 0:
        return max(0.0, width), max(0.0, height)

    target = ratio_w / ratio_h
    current = width / height
    if current > target:
        fitted_width = height * target
        return fitted_width, height
    fitted_height = width / target
    return width, fitted_height


def compute_grid(item_count: int, settings: GridLayoutSettings) -> list[GridCell]:
    """Compute cell rectangles for ``item_count`` items.

    Algorithm:
        rows = ceil(N / columns)
        cellWidth / cellHeight fill the padded area evenly, then optional
        square / aspect-ratio constraints shrink and center each cell.
    """
    if item_count <= 0:
        return []

    columns = max(1, settings.columns)
    rows = max(1, math.ceil(item_count / columns))
    padding = max(0.0, settings.padding)
    gap = max(0.0, settings.gap)

    usable_width = settings.width - padding * 2 - gap * (columns - 1)
    usable_height = settings.height - padding * 2 - gap * (rows - 1)
    raw_cell_w = usable_width / columns if columns else 0.0
    raw_cell_h = usable_height / rows if rows else 0.0

    cell_w = max(0.0, raw_cell_w)
    cell_h = max(0.0, raw_cell_h)

    if settings.keep_square:
        size = min(cell_w, cell_h)
        cell_w = size
        cell_h = size
    elif settings.aspect_ratio == AspectRatio.RATIO_16_9:
        cell_w, cell_h = _fit_aspect(cell_w, cell_h, 16.0, 9.0)
    elif settings.aspect_ratio == AspectRatio.RATIO_4_3:
        cell_w, cell_h = _fit_aspect(cell_w, cell_h, 4.0, 3.0)

    # Center cells inside their raw slots when constrained.
    offset_x = max(0.0, (raw_cell_w - cell_w) / 2.0)
    offset_y = max(0.0, (raw_cell_h - cell_h) / 2.0)

    cells: list[GridCell] = []
    for index in range(item_count):
        row = index // columns
        col = index % columns
        x = settings.start_x + padding + col * (raw_cell_w + gap) + offset_x
        y = settings.start_y + padding + row * (raw_cell_h + gap) + offset_y
        cells.append(
            GridCell(
                index=index,
                row=row,
                col=col,
                x=x,
                y=y,
                width=cell_w,
                height=cell_h,
            )
        )
    return cells
