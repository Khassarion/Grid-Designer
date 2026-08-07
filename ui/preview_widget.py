"""Preview canvas that visualizes the computed grid layout."""

from __future__ import annotations

from PyQt6.QtCore import QPointF, QRectF, Qt, pyqtSignal
from PyQt6.QtGui import QColor, QFont, QPainter, QPen
from PyQt6.QtWidgets import QWidget

from layout.grid_layout import GridCell, GridLayoutSettings, compute_grid


class PreviewWidget(QWidget):
    """Draws the placement rectangle and numbered grid cells.

    Supports drag-and-drop reordering of cells by dragging a cell onto another.
    """

    order_changed = pyqtSignal(int, int)  # from_index, to_index

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setMinimumSize(420, 280)
        self.setMouseTracking(True)

        self._settings = GridLayoutSettings()
        self._item_count = 0
        self._labels: list[str] = []
        self._cells: list[GridCell] = []
        self._drag_index: int | None = None
        self._hover_index: int | None = None
        self._drag_pos = QPointF()

        self.setAutoFillBackground(True)
        palette = self.palette()
        palette.setColor(self.backgroundRole(), QColor("#1e1e1e"))
        self.setPalette(palette)

    def set_preview(
        self,
        settings: GridLayoutSettings,
        item_count: int,
        labels: list[str] | None = None,
    ) -> None:
        """Update preview data and repaint."""
        self._settings = settings
        self._item_count = max(0, item_count)
        self._labels = list(labels or [])
        self._cells = compute_grid(self._item_count, self._settings)
        self.update()

    def cells(self) -> list[GridCell]:
        """Return the currently computed cells."""
        return list(self._cells)

    def _scene_to_widget(self) -> tuple[float, float, float, float]:
        """Return scale and offset mapping OBS coords -> widget coords."""
        margin = 16.0
        avail_w = max(1.0, self.width() - margin * 2)
        avail_h = max(1.0, self.height() - margin * 2)

        scene_w = max(1.0, self._settings.width)
        scene_h = max(1.0, self._settings.height)
        scale = min(avail_w / scene_w, avail_h / scene_h)

        draw_w = scene_w * scale
        draw_h = scene_h * scale
        offset_x = (self.width() - draw_w) / 2.0
        offset_y = (self.height() - draw_h) / 2.0
        return scale, offset_x, offset_y, margin

    def _cell_rect_widget(self, cell: GridCell) -> QRectF:
        scale, ox, oy, _ = self._scene_to_widget()
        local_x = cell.x - self._settings.start_x
        local_y = cell.y - self._settings.start_y
        return QRectF(
            ox + local_x * scale,
            oy + local_y * scale,
            max(1.0, cell.width * scale),
            max(1.0, cell.height * scale),
        )

    def _hit_test(self, pos: QPointF) -> int | None:
        for cell in self._cells:
            if self._cell_rect_widget(cell).contains(pos):
                return cell.index
        return None

    def paintEvent(self, event) -> None:  # noqa: N802
        del event
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        scale, ox, oy, _ = self._scene_to_widget()
        area = QRectF(ox, oy, self._settings.width * scale, self._settings.height * scale)

        painter.fillRect(area, QColor("#2b2b2b"))
        painter.setPen(QPen(QColor("#6aa9ff"), 2))
        painter.drawRect(area)

        pad = self._settings.padding * scale
        if pad > 0 and area.width() > pad * 2 and area.height() > pad * 2:
            inner = area.adjusted(pad, pad, -pad, -pad)
            painter.setPen(QPen(QColor("#555555"), 1, Qt.PenStyle.DashLine))
            painter.drawRect(inner)

        font = QFont(self.font())
        font.setBold(True)
        painter.setFont(font)

        for cell in self._cells:
            rect = self._cell_rect_widget(cell)
            is_hover = self._hover_index == cell.index
            is_drag = self._drag_index == cell.index

            fill = QColor("#3d5a80") if not is_hover else QColor("#4a7ab5")
            if is_drag:
                fill = QColor("#98c1d9")
            painter.fillRect(rect, fill)
            painter.setPen(QPen(QColor("#e0fbfc"), 1))
            painter.drawRect(rect)

            label = str(cell.index + 1)
            if cell.index < len(self._labels):
                name = self._labels[cell.index]
                if len(name) > 14:
                    name = name[:13] + "…"
                label = f"{cell.index + 1}\n{name}"

            painter.setPen(QColor("#ffffff"))
            painter.drawText(rect, int(Qt.AlignmentFlag.AlignCenter), label)

        if self._drag_index is not None and 0 <= self._drag_index < len(self._cells):
            cell = self._cells[self._drag_index]
            ghost = QRectF(
                0,
                0,
                max(40.0, cell.width * scale * 0.8),
                max(28.0, cell.height * scale * 0.8),
            )
            ghost.moveCenter(self._drag_pos)
            painter.fillRect(ghost, QColor(152, 193, 217, 160))
            painter.setPen(QPen(QColor("#ffffff"), 1))
            painter.drawRect(ghost)
            painter.drawText(ghost, int(Qt.AlignmentFlag.AlignCenter), str(cell.index + 1))

        painter.setPen(QColor("#bbbbbb"))
        meta = (
            f"{self._item_count} items  |  "
            f"{self._settings.columns} cols  |  "
            f"{self._settings.width:.0f}×{self._settings.height:.0f}"
        )
        painter.drawText(
            QRectF(8, self.height() - 22, self.width() - 16, 18),
            int(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter),
            meta,
        )
        painter.end()

    def mousePressEvent(self, event) -> None:  # noqa: N802
        if event.button() == Qt.MouseButton.LeftButton:
            idx = self._hit_test(event.position())
            if idx is not None:
                self._drag_index = idx
                self._drag_pos = event.position()
                self.update()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event) -> None:  # noqa: N802
        self._hover_index = self._hit_test(event.position())
        if self._drag_index is not None:
            self._drag_pos = event.position()
        self.update()
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event) -> None:  # noqa: N802
        if event.button() == Qt.MouseButton.LeftButton and self._drag_index is not None:
            target = self._hit_test(event.position())
            source = self._drag_index
            self._drag_index = None
            if target is not None and target != source:
                self.order_changed.emit(source, target)
            self.update()
        super().mouseReleaseEvent(event)

    def leaveEvent(self, event) -> None:  # noqa: N802
        self._hover_index = None
        self.update()
        super().leaveEvent(event)
