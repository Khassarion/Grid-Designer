"""OBS Grid Layout — standalone GUI entry point.

Connects to OBS via WebSocket and arranges selected image-like sources
into a configurable grid inside a user-defined rectangle.
"""

from __future__ import annotations

import sys

from PyQt6.QtWidgets import QApplication

from ui.main_window import MainWindow


def main() -> int:
    """Create the Qt application and show the main window."""
    app = QApplication(sys.argv)
    app.setApplicationName("OBS Grid Layout")
    app.setOrganizationName("OBS-GridLayout")

    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
