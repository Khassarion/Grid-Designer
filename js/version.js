/**
 * Grid Designer — app release version (MAJOR.MINOR.PATCH.BUILD)
 *
 * Copyright (c) 2026 Khassarion
 * SPDX-License-Identifier: LicenseRef-GridDesigner-Proprietary
 *
 * Bump GC_APP_VERSION when shipping user-visible changes.
 * Add matching GC_CHANGELOG[version] entries (ko/en) for the What's New dialog.
 * Image lines: ![alt text](screenshots/example.gif) — relative path only.
 * Keep in sync with README changelog.
 * Distinct from PROJECT_VERSION in app.js (JSON project file format).
 */
(function (global) {
  "use strict";
  global.GC_APP_VERSION = "1.1.2.2";
  /** Per-version release notes for the in-app update dialog. */
  global.GC_CHANGELOG = {
    "1.1.2.2": {
      ko: [
        "사이트 주소가 변경되었습니다.",
        "기존: https://ainukehere.github.io/Grid-Designer",
        "변경: https://khassarion.github.io/Grid-Designer",
      ],
      en: [
        "Site address has changed.",
        "Old: https://ainukehere.github.io/Grid-Designer",
        "New: https://khassarion.github.io/Grid-Designer",
      ],
    },
    "1.1.2.1": {
      ko: [
        "Ctrl+레이아웃 크기 조절: 드래그 중에는 내용이 함께 줄어든 것처럼 미리보고, 마우스를 떼면 셀·패딩 크기를 확정합니다.",
        "![Ctrl로 레이아웃 크기 조절](screenshots/ctrl-layout-resize.gif)",
        "Shift+크기 조절로 이미지뿐 아니라 레이아웃도 비율을 유지할 수 있습니다.",
        "계층 구조에서 눈 아이콘으로 레이아웃을 보이거나 숨길 수 있습니다.",
        "자동 추가: 감시 폴더↔레이아웃 규칙을 여러 개 둘 수 있고, 프로젝트에도 저장됩니다.",
      ],
      en: [
        "Ctrl+resize layout: live scaled preview while dragging; cell/padding sizes commit on mouse up.",
        "![Ctrl layout resize](screenshots/ctrl-layout-resize.gif)",
        "Hold Shift while resizing to keep aspect ratio for layouts as well as images.",
        "Toggle layout visibility with the eye icon in the hierarchy.",
        "Auto-add supports multiple folder↔layout rules, saved with the project.",
      ],
    },
  };
})(window);
