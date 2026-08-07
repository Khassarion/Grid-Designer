"""Main application window coordinating UI, OBS client, and layout logic."""

from __future__ import annotations

from pathlib import Path

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QGuiApplication
from PyQt6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QSplitter,
    QVBoxLayout,
    QWidget,
)

from layout.grid_layout import GridLayoutSettings, compute_grid
from models.source_item import SourceItem, TransformSnapshot
from obs.obs_client import ObsClient, ObsClientError
from persistence import (
    PersistenceError,
    load_layout_json,
    load_presets,
    save_layout_json,
    save_presets,
)
from ui.preview_widget import PreviewWidget
from ui.settings_panel import SettingsPanel


class MainWindow(QWidget):
    """Top-level MVC controller for the OBS Grid Layout tool."""

    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("OBS Grid Layout")
        self.resize(1180, 720)

        self._obs = ObsClient()
        self._scene_name: str = ""
        self._sources: list[SourceItem] = []
        self._undo_stack: list[list[TransformSnapshot]] = []
        self._presets: dict[str, dict] = load_presets()

        self._build_ui()
        self._wire_signals()
        self._refresh_monitors()
        self._settings.set_preset_names(sorted(self._presets.keys()))
        self._refresh_preview()

    def _build_ui(self) -> None:
        root = QHBoxLayout(self)
        splitter = QSplitter(Qt.Orientation.Horizontal)
        root.addWidget(splitter)

        self._settings = SettingsPanel()
        splitter.addWidget(self._settings)

        sources_panel = QWidget()
        sources_layout = QVBoxLayout(sources_panel)
        self._scene_label = QLabel("장면: (없음)")
        self._scene_label.setWordWrap(True)
        sources_layout.addWidget(self._scene_label)

        select_row = QHBoxLayout()
        self._select_all = QCheckBox("전체 선택")
        self._select_all.setChecked(True)
        self._select_all.toggled.connect(self._on_select_all_toggled)
        select_row.addWidget(self._select_all)
        select_row.addStretch(1)
        sources_layout.addLayout(select_row)

        self._source_list = QListWidget()
        self._source_list.setSelectionMode(QAbstractItemView.SelectionMode.NoSelection)
        self._source_list.itemChanged.connect(self._on_source_item_changed)
        sources_layout.addWidget(self._source_list, stretch=1)

        hint = QLabel("미리보기에서 셀을 드래그하면 순서를 바꿀 수 있습니다.")
        hint.setWordWrap(True)
        hint.setStyleSheet("color: #666;")
        sources_layout.addWidget(hint)
        splitter.addWidget(sources_panel)

        preview_panel = QWidget()
        preview_layout = QVBoxLayout(preview_panel)
        preview_layout.addWidget(QLabel("미리보기"))
        self._preview = PreviewWidget()
        preview_layout.addWidget(self._preview, stretch=1)
        splitter.addWidget(preview_panel)

        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 0)
        splitter.setStretchFactor(2, 1)
        splitter.setSizes([320, 260, 600])

    def _wire_signals(self) -> None:
        s = self._settings
        s.connect_requested.connect(self._connect_obs)
        s.load_scene_requested.connect(self._load_scene)
        s.apply_requested.connect(self._apply_layout)
        s.undo_requested.connect(self._undo)
        s.settings_changed.connect(self._refresh_preview)
        s.save_json_requested.connect(self._save_json)
        s.load_json_requested.connect(self._load_json)
        s.save_preset_requested.connect(self._save_preset)
        s.load_preset_requested.connect(self._load_preset)
        s.delete_preset_requested.connect(self._delete_preset)
        s.use_canvas_size_requested.connect(self._use_obs_canvas)
        s.use_monitor_size_requested.connect(self._use_monitor)
        self._preview.order_changed.connect(self._reorder_sources)

    def _connect_obs(self) -> None:
        host, port, password = self._settings.connection_params()
        try:
            self._obs.connect(host=host, port=port, password=password)
            self._settings.set_connection_status(True, f"연결됨 ({host}:{port})")
            QMessageBox.information(self, "연결 성공", "OBS WebSocket에 연결되었습니다.")
        except ObsClientError as exc:
            self._settings.set_connection_status(False, "연결 실패")
            QMessageBox.critical(self, "연결 실패", str(exc))

    def _load_scene(self) -> None:
        if not self._obs.is_connected:
            QMessageBox.warning(self, "알림", "먼저 OBS에 연결하세요.")
            return
        try:
            scene_name, sources = self._obs.get_layout_sources()
        except ObsClientError as exc:
            QMessageBox.critical(self, "불러오기 실패", str(exc))
            return

        self._scene_name = scene_name
        self._sources = sources
        self._scene_label.setText(f"장면: {scene_name}  ({len(sources)}개 소스)")
        self._rebuild_source_list()
        self._refresh_preview()

    def _rebuild_source_list(self) -> None:
        self._source_list.blockSignals(True)
        self._source_list.clear()
        for source in self._sources:
            item = QListWidgetItem(f"{source.source_name}  [{source.input_kind}]")
            item.setFlags(
                Qt.ItemFlag.ItemIsEnabled
                | Qt.ItemFlag.ItemIsUserCheckable
                | Qt.ItemFlag.ItemIsSelectable
            )
            item.setCheckState(
                Qt.CheckState.Checked if source.selected else Qt.CheckState.Unchecked
            )
            item.setData(Qt.ItemDataRole.UserRole, source.scene_item_id)
            self._source_list.addItem(item)
        self._source_list.blockSignals(False)
        self._sync_select_all_checkbox()

    def _on_source_item_changed(self, item: QListWidgetItem) -> None:
        scene_item_id = item.data(Qt.ItemDataRole.UserRole)
        checked = item.checkState() == Qt.CheckState.Checked
        for source in self._sources:
            if source.scene_item_id == scene_item_id:
                source.selected = checked
                break
        self._sync_select_all_checkbox()
        self._refresh_preview()

    def _on_select_all_toggled(self, checked: bool) -> None:
        for source in self._sources:
            source.selected = checked
        self._rebuild_source_list()
        self._refresh_preview()

    def _sync_select_all_checkbox(self) -> None:
        if not self._sources:
            self._select_all.blockSignals(True)
            self._select_all.setChecked(False)
            self._select_all.blockSignals(False)
            return
        all_selected = all(s.selected for s in self._sources)
        self._select_all.blockSignals(True)
        self._select_all.setChecked(all_selected)
        self._select_all.blockSignals(False)

    def _selected_sources(self) -> list[SourceItem]:
        return [s for s in self._sources if s.selected]

    def _refresh_preview(self) -> None:
        settings = self._settings.get_settings()
        selected = self._selected_sources()
        labels = [s.source_name for s in selected]
        self._preview.set_preview(settings, len(selected), labels)

    def _reorder_sources(self, from_index: int, to_index: int) -> None:
        selected = self._selected_sources()
        if not (0 <= from_index < len(selected) and 0 <= to_index < len(selected)):
            return
        moving = selected[from_index]
        selected.pop(from_index)
        selected.insert(to_index, moving)

        selected_ids = {s.scene_item_id for s in selected}
        selected_iter = iter(selected)
        new_order: list[SourceItem] = []
        for source in self._sources:
            if source.scene_item_id in selected_ids:
                new_order.append(next(selected_iter))
            else:
                new_order.append(source)
        self._sources = new_order
        for index, source in enumerate(self._sources):
            source.index = index
        self._rebuild_source_list()
        self._refresh_preview()

    def _apply_layout(self) -> None:
        if not self._obs.is_connected:
            QMessageBox.warning(self, "알림", "먼저 OBS에 연결하세요.")
            return
        if not self._scene_name:
            QMessageBox.warning(self, "알림", "먼저 현재 장면을 불러오세요.")
            return

        selected = self._selected_sources()
        if not selected:
            QMessageBox.warning(self, "알림", "배치할 소스를 하나 이상 선택하세요.")
            return

        settings = self._settings.get_settings()
        cells = compute_grid(len(selected), settings)

        try:
            snapshots = self._obs.capture_transforms(self._scene_name, selected)
            placements = [
                (source, cell.x, cell.y, cell.width, cell.height)
                for source, cell in zip(selected, cells, strict=True)
            ]
            self._obs.apply_grid_transforms(self._scene_name, placements)
            self._undo_stack.append(snapshots)
            self._settings.set_undo_enabled(True)
            QMessageBox.information(
                self,
                "배치 완료",
                f"{len(selected)}개 소스를 그리드로 배치했습니다.",
            )
        except ObsClientError as exc:
            QMessageBox.critical(self, "배치 실패", str(exc))

    def _undo(self) -> None:
        if not self._undo_stack:
            self._settings.set_undo_enabled(False)
            return
        if not self._obs.is_connected:
            QMessageBox.warning(self, "알림", "OBS에 연결된 상태에서만 Undo할 수 있습니다.")
            return
        snapshots = self._undo_stack.pop()
        try:
            self._obs.restore_transforms(snapshots)
            QMessageBox.information(self, "Undo", "이전 transform으로 복원했습니다.")
        except ObsClientError as exc:
            QMessageBox.critical(self, "Undo 실패", str(exc))
        finally:
            self._settings.set_undo_enabled(bool(self._undo_stack))

    def _save_json(self) -> None:
        path_str, _ = QFileDialog.getSaveFileName(
            self,
            "레이아웃 JSON 저장",
            "layout.json",
            "JSON Files (*.json)",
        )
        if not path_str:
            return
        try:
            save_layout_json(
                Path(path_str),
                self._settings.get_settings(),
                self._sources,
                self._scene_name,
            )
            QMessageBox.information(self, "저장", "JSON 파일을 저장했습니다.")
        except PersistenceError as exc:
            QMessageBox.critical(self, "저장 실패", str(exc))

    def _load_json(self) -> None:
        path_str, _ = QFileDialog.getOpenFileName(
            self,
            "레이아웃 JSON 불러오기",
            "",
            "JSON Files (*.json)",
        )
        if not path_str:
            return
        try:
            data = load_layout_json(Path(path_str))
            settings = GridLayoutSettings.from_dict(data.get("settings") or {})
            self._settings.set_settings(settings)
            self._scene_name = str(data.get("scene_name") or self._scene_name)
            raw_sources = data.get("sources") or []
            if isinstance(raw_sources, list) and raw_sources:
                self._sources = [
                    SourceItem.from_dict(item)
                    for item in raw_sources
                    if isinstance(item, dict)
                ]
                self._scene_label.setText(
                    f"장면: {self._scene_name or '(JSON)'}  ({len(self._sources)}개 소스)"
                )
                self._rebuild_source_list()
            self._refresh_preview()
            QMessageBox.information(self, "불러오기", "JSON 설정을 적용했습니다.")
        except (PersistenceError, ValueError, TypeError, KeyError) as exc:
            QMessageBox.critical(self, "불러오기 실패", str(exc))

    def _save_preset(self) -> None:
        name = self._settings.preset_name()
        if not name:
            QMessageBox.warning(self, "알림", "프리셋 이름을 입력하세요.")
            return
        self._presets[name] = self._settings.get_settings().to_dict()
        try:
            save_presets(self._presets)
            self._settings.set_preset_names(sorted(self._presets.keys()))
            QMessageBox.information(self, "프리셋", f"'{name}' 프리셋을 저장했습니다.")
        except PersistenceError as exc:
            QMessageBox.critical(self, "프리셋 저장 실패", str(exc))

    def _load_preset(self, name: str) -> None:
        if not name:
            QMessageBox.warning(self, "알림", "프리셋 이름을 선택하세요.")
            return
        data = self._presets.get(name)
        if not data:
            QMessageBox.warning(self, "알림", f"프리셋 '{name}'을(를) 찾을 수 없습니다.")
            return
        try:
            self._settings.set_settings(GridLayoutSettings.from_dict(data))
        except (ValueError, TypeError, KeyError) as exc:
            QMessageBox.critical(self, "프리셋 오류", str(exc))

    def _delete_preset(self, name: str) -> None:
        if not name or name not in self._presets:
            QMessageBox.warning(self, "알림", "삭제할 프리셋을 선택하세요.")
            return
        del self._presets[name]
        try:
            save_presets(self._presets)
            self._settings.set_preset_names(sorted(self._presets.keys()))
            self._settings.preset_combo.setEditText("")
            QMessageBox.information(self, "프리셋", f"'{name}' 프리셋을 삭제했습니다.")
        except PersistenceError as exc:
            QMessageBox.critical(self, "프리셋 삭제 실패", str(exc))

    def _use_obs_canvas(self) -> None:
        if not self._obs.is_connected:
            QMessageBox.warning(self, "알림", "먼저 OBS에 연결하세요.")
            return
        try:
            width, height = self._obs.get_video_canvas_size()
            settings = self._settings.get_settings()
            settings.width = float(width)
            settings.height = float(height)
            settings.start_x = 0.0
            settings.start_y = 0.0
            self._settings.set_settings(settings)
        except ObsClientError as exc:
            QMessageBox.critical(self, "캔버스 크기", str(exc))

    def _refresh_monitors(self) -> None:
        screens = QGuiApplication.screens()
        labels: list[str] = []
        for index, screen in enumerate(screens):
            geo = screen.geometry()
            labels.append(
                f"{index}: {screen.name()} ({geo.width()}×{geo.height()} @ {geo.x()},{geo.y()})"
            )
        self._settings.set_monitors(labels)

    def _use_monitor(self, index: int) -> None:
        screens = QGuiApplication.screens()
        if index < 0 or index >= len(screens):
            QMessageBox.warning(self, "알림", "유효한 모니터를 선택하세요.")
            return
        geo = screens[index].geometry()
        settings = self._settings.get_settings()
        settings.start_x = float(geo.x())
        settings.start_y = float(geo.y())
        settings.width = float(geo.width())
        settings.height = float(geo.height())
        self._settings.set_settings(settings)

    def closeEvent(self, event) -> None:  # noqa: N802
        self._obs.disconnect()
        super().closeEvent(event)
