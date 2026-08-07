"""Settings panel widgets for layout parameters and connection."""

from __future__ import annotations

from PyQt6.QtCore import pyqtSignal
from PyQt6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDoubleSpinBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from layout.grid_layout import AspectRatio, GridLayoutSettings


class SettingsPanel(QWidget):
    """Collects connection info and grid layout parameters from the user."""

    settings_changed = pyqtSignal()
    connect_requested = pyqtSignal()
    load_scene_requested = pyqtSignal()
    apply_requested = pyqtSignal()
    undo_requested = pyqtSignal()
    save_json_requested = pyqtSignal()
    load_json_requested = pyqtSignal()
    save_preset_requested = pyqtSignal()
    load_preset_requested = pyqtSignal(str)
    delete_preset_requested = pyqtSignal(str)
    use_canvas_size_requested = pyqtSignal()
    use_monitor_size_requested = pyqtSignal(int)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._building = True
        self._build_ui()
        self._building = False

    def _build_ui(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)

        root.addWidget(self._build_connection_group())
        root.addWidget(self._build_layout_group())
        root.addWidget(self._build_options_group())
        root.addWidget(self._build_actions_group())
        root.addWidget(self._build_preset_group())
        root.addWidget(self._build_monitor_group())
        root.addStretch(1)

    def _build_connection_group(self) -> QGroupBox:
        group = QGroupBox("OBS 연결")
        form = QFormLayout(group)

        self.host_edit = QLineEdit("localhost")
        self.port_spin = QSpinBox()
        self.port_spin.setRange(1, 65535)
        self.port_spin.setValue(4455)
        self.password_edit = QLineEdit()
        self.password_edit.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_edit.setPlaceholderText("비밀번호 (선택)")

        self.connect_btn = QPushButton("연결")
        self.connect_btn.clicked.connect(self.connect_requested.emit)
        self.connection_status = QLabel("연결 안 됨")
        self.connection_status.setStyleSheet("color: #b00020;")

        form.addRow("Host", self.host_edit)
        form.addRow("Port", self.port_spin)
        form.addRow("Password", self.password_edit)
        form.addRow(self.connect_btn)
        form.addRow("상태", self.connection_status)
        return group

    def _build_layout_group(self) -> QGroupBox:
        group = QGroupBox("배치 영역")
        form = QFormLayout(group)

        self.start_x = self._make_double_spin(-100000, 100000, 0, 1)
        self.start_y = self._make_double_spin(-100000, 100000, 0, 1)
        self.width_spin = self._make_double_spin(1, 100000, 1920, 1)
        self.height_spin = self._make_double_spin(1, 100000, 1080, 1)
        self.columns_spin = QSpinBox()
        self.columns_spin.setRange(1, 64)
        self.columns_spin.setValue(4)
        self.gap_spin = self._make_double_spin(0, 10000, 10, 1)
        self.padding_spin = self._make_double_spin(0, 10000, 20, 1)

        for widget in (
            self.start_x,
            self.start_y,
            self.width_spin,
            self.height_spin,
            self.columns_spin,
            self.gap_spin,
            self.padding_spin,
        ):
            widget.valueChanged.connect(self._emit_settings_changed)

        form.addRow("시작 X", self.start_x)
        form.addRow("시작 Y", self.start_y)
        form.addRow("너비", self.width_spin)
        form.addRow("높이", self.height_spin)
        form.addRow("열 개수", self.columns_spin)
        form.addRow("셀 간격", self.gap_spin)
        form.addRow("내부 패딩", self.padding_spin)
        return group

    def _build_options_group(self) -> QGroupBox:
        group = QGroupBox("셀 옵션")
        form = QFormLayout(group)

        self.keep_square = QCheckBox("정사각형 셀 유지")
        self.keep_square.toggled.connect(self._on_square_toggled)

        self.aspect_combo = QComboBox()
        self.aspect_combo.addItem("자유", AspectRatio.FREE.value)
        self.aspect_combo.addItem("16:9", AspectRatio.RATIO_16_9.value)
        self.aspect_combo.addItem("4:3", AspectRatio.RATIO_4_3.value)
        self.aspect_combo.currentIndexChanged.connect(self._emit_settings_changed)

        form.addRow(self.keep_square)
        form.addRow("셀 비율", self.aspect_combo)
        return group

    def _build_actions_group(self) -> QGroupBox:
        group = QGroupBox("동작")
        layout = QVBoxLayout(group)

        self.load_scene_btn = QPushButton("현재 장면 불러오기")
        self.load_scene_btn.clicked.connect(self.load_scene_requested.emit)

        self.apply_btn = QPushButton("배치")
        self.apply_btn.setStyleSheet("font-weight: bold;")
        self.apply_btn.clicked.connect(self.apply_requested.emit)

        self.undo_btn = QPushButton("Undo")
        self.undo_btn.setEnabled(False)
        self.undo_btn.clicked.connect(self.undo_requested.emit)

        row = QHBoxLayout()
        self.save_json_btn = QPushButton("JSON 저장")
        self.load_json_btn = QPushButton("JSON 불러오기")
        self.save_json_btn.clicked.connect(self.save_json_requested.emit)
        self.load_json_btn.clicked.connect(self.load_json_requested.emit)
        row.addWidget(self.save_json_btn)
        row.addWidget(self.load_json_btn)

        layout.addWidget(self.load_scene_btn)
        layout.addWidget(self.apply_btn)
        layout.addWidget(self.undo_btn)
        layout.addLayout(row)
        return group

    def _build_preset_group(self) -> QGroupBox:
        group = QGroupBox("프리셋")
        layout = QVBoxLayout(group)

        self.preset_combo = QComboBox()
        self.preset_combo.setEditable(True)
        self.preset_combo.setPlaceholderText("프리셋 이름")

        row = QHBoxLayout()
        self.save_preset_btn = QPushButton("저장")
        self.load_preset_btn = QPushButton("불러오기")
        self.delete_preset_btn = QPushButton("삭제")
        self.save_preset_btn.clicked.connect(self.save_preset_requested.emit)
        self.load_preset_btn.clicked.connect(
            lambda: self.load_preset_requested.emit(self.preset_combo.currentText().strip())
        )
        self.delete_preset_btn.clicked.connect(
            lambda: self.delete_preset_requested.emit(self.preset_combo.currentText().strip())
        )
        row.addWidget(self.save_preset_btn)
        row.addWidget(self.load_preset_btn)
        row.addWidget(self.delete_preset_btn)

        layout.addWidget(self.preset_combo)
        layout.addLayout(row)
        return group

    def _build_monitor_group(self) -> QGroupBox:
        group = QGroupBox("캔버스 / 모니터")
        layout = QVBoxLayout(group)

        self.canvas_btn = QPushButton("OBS 캔버스 크기 적용")
        self.canvas_btn.clicked.connect(self.use_canvas_size_requested.emit)

        self.monitor_combo = QComboBox()
        self.monitor_apply_btn = QPushButton("선택 모니터 크기 적용")
        self.monitor_apply_btn.clicked.connect(
            lambda: self.use_monitor_size_requested.emit(self.monitor_combo.currentIndex())
        )

        layout.addWidget(self.canvas_btn)
        layout.addWidget(self.monitor_combo)
        layout.addWidget(self.monitor_apply_btn)
        return group

    @staticmethod
    def _make_double_spin(
        minimum: float,
        maximum: float,
        value: float,
        decimals: int,
    ) -> QDoubleSpinBox:
        spin = QDoubleSpinBox()
        spin.setRange(minimum, maximum)
        spin.setDecimals(decimals)
        spin.setValue(value)
        spin.setSingleStep(1.0)
        return spin

    def _emit_settings_changed(self, *_args: object) -> None:
        if not self._building:
            self.settings_changed.emit()

    def _on_square_toggled(self, checked: bool) -> None:
        self.aspect_combo.setEnabled(not checked)
        self._emit_settings_changed()

    def set_connection_status(self, connected: bool, message: str = "") -> None:
        """Update connection status label."""
        if connected:
            self.connection_status.setText(message or "연결됨")
            self.connection_status.setStyleSheet("color: #0a7a2f;")
        else:
            self.connection_status.setText(message or "연결 안 됨")
            self.connection_status.setStyleSheet("color: #b00020;")

    def set_undo_enabled(self, enabled: bool) -> None:
        """Enable or disable the Undo button."""
        self.undo_btn.setEnabled(enabled)

    def connection_params(self) -> tuple[str, int, str]:
        """Return (host, port, password)."""
        return (
            self.host_edit.text().strip() or "localhost",
            int(self.port_spin.value()),
            self.password_edit.text(),
        )

    def get_settings(self) -> GridLayoutSettings:
        """Read current layout settings from the form widgets."""
        aspect_value = self.aspect_combo.currentData()
        aspect = AspectRatio(str(aspect_value)) if aspect_value else AspectRatio.FREE
        return GridLayoutSettings(
            start_x=float(self.start_x.value()),
            start_y=float(self.start_y.value()),
            width=float(self.width_spin.value()),
            height=float(self.height_spin.value()),
            columns=int(self.columns_spin.value()),
            gap=float(self.gap_spin.value()),
            padding=float(self.padding_spin.value()),
            keep_square=self.keep_square.isChecked(),
            aspect_ratio=aspect,
        )

    def set_settings(self, settings: GridLayoutSettings) -> None:
        """Write layout settings into the form widgets without feedback loops."""
        self._building = True
        try:
            self.start_x.setValue(settings.start_x)
            self.start_y.setValue(settings.start_y)
            self.width_spin.setValue(settings.width)
            self.height_spin.setValue(settings.height)
            self.columns_spin.setValue(settings.columns)
            self.gap_spin.setValue(settings.gap)
            self.padding_spin.setValue(settings.padding)
            self.keep_square.setChecked(settings.keep_square)
            idx = self.aspect_combo.findData(settings.aspect_ratio.value)
            if idx >= 0:
                self.aspect_combo.setCurrentIndex(idx)
            self.aspect_combo.setEnabled(not settings.keep_square)
        finally:
            self._building = False
        self.settings_changed.emit()

    def set_preset_names(self, names: list[str]) -> None:
        """Refresh the preset combo box items."""
        current = self.preset_combo.currentText()
        self.preset_combo.blockSignals(True)
        self.preset_combo.clear()
        self.preset_combo.addItems(names)
        if current:
            self.preset_combo.setEditText(current)
        self.preset_combo.blockSignals(False)

    def preset_name(self) -> str:
        """Return the currently typed/selected preset name."""
        return self.preset_combo.currentText().strip()

    def set_monitors(self, labels: list[str]) -> None:
        """Populate the monitor combo box."""
        self.monitor_combo.clear()
        self.monitor_combo.addItems(labels)
