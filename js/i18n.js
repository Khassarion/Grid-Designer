/**
 * Grid Composer — UI strings (ko / en)
 *
 * Copyright (c) 2026 AINukeHere
 * SPDX-License-Identifier: LicenseRef-GridComposer-Proprietary
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "grid-composer-lang";

  var STRINGS = {
    ko: {
      appTitle: "OBS Grid Designer",
      tutorial: "튜토리얼",
      tutorialTitle: "후원 이미지 벽지 사용법",
      open: "열기",
      save: "저장",
      includeImages: "이미지 포함",
      includeImagesTitle: "체크 시 JSON에 이미지 데이터 포함",
      projectGroupTitle: "프로젝트 파일",
      autoExport: "자동 내보내기",
      autoExportTitle: "구조가 바뀔 때마다 PNG를 자동 저장합니다. PNG 위치가 지정된 경우에만 동작하며, 크기 조절은 끝난 뒤에만 저장합니다.",
      changePath: "위치 변경",
      changePathTitle: "PNG 저장 위치 변경",
      exportPng: "내보내기",
      hierarchy: "계층 구조",
      addMenu: "추가 ▾",
      addImage: "이미지 추가",
      addLayout: "레이아웃 추가",
      folderWatch: "자동 설정",
      folderWatchMenuOn: "자동 설정 · ON",
      folderWatchTitle: "자동 이미지 추가 설정",
      folderWatchModalTitle: "자동 이미지 추가",
      folderWatchDesc: "지정한 폴더에 새 이미지가 생기면 선택한 레이아웃에 자동으로 추가합니다. Chrome/Edge 등에서 동작하며, 이 탭이 열려 있는 동안만 감시합니다.",
      folderWatchEnable: "자동 추가 사용",
      folderWatchFolder: "감시 폴더",
      folderWatchPick: "폴더 선택",
      folderWatchClear: "해제",
      folderWatchNoFolder: "(미선택)",
      folderWatchTarget: "추가할 레이아웃",
      folderWatchCancel: "취소",
      folderWatchSave: "저장",
      folderWatchUnsupported: "이 브라우저는 폴더 감시를 지원하지 않습니다. Chrome 또는 Edge를 사용하세요.",
      folderWatchNeedFolder: "감시할 폴더를 먼저 선택하세요.",
      folderWatchSaved: "자동 이미지 추가 설정을 저장했습니다",
      folderWatchOn: "자동 추가 ON",
      folderWatchOff: "자동 추가 OFF",
      folderWatchPermission: "폴더 접근 권한이 필요합니다. 설정에서 폴더를 다시 선택하세요.",
      remove: "제거",
      removeTitle: "선택 항목 제거",
      clearAll: "전체",
      clearAllTitle: "선택 대상의 자식 전체 제거",
      settingsHeading: "레이아웃 설정",
      settingsHeadingCanvas: "캔버스",
      noLayoutHint: "캔버스가 선택되어 있습니다. 이미지·레이아웃은 캔버스에 바로 추가됩니다. 미리보기의 레이아웃 위에 이미지를 드롭하면 그 레이아웃으로 들어갑니다.",
      canvasImageHint: "캔버스 이미지가 선택되어 있습니다. 미리보기에서 드래그로 이동·크기 조절할 수 있습니다. Shift를 누른 채 크기 조절하면 비율이 유지됩니다.",
      width: "너비",
      height: "높이",
      sizeLockHint: "부모 레이아웃 셀 크기로 고정",
      padding: "패딩",
      padL: "좌",
      padR: "우",
      padT: "상",
      padB: "하",
      cellSize: "셀 크기",
      cellW: "가로",
      cellH: "세로",
      cellHint: "고정 크기 · 이미지는 셀에 꽉 채움",
      spacing: "스페이싱",
      spacingX: "가로",
      spacingY: "세로",
      spacingHint: "음수 가능 (겹침)",
      placement: "배치",
      startCorner: "시작 코너",
      startAxis: "시작 축",
      axisHorizontal: "수평",
      axisVertical: "수직",
      childAlign: "자식 정렬",
      childAlignHint: "자식 정렬 = 셀 그룹이 레이아웃 안 어디에 붙는지",
      constraint: "제약",
      constraintAuto: "자동",
      constraintColumns: "열 개수",
      constraintRows: "행 개수",
      constraintCount: "개수",
      transparentBg: "배경 투명",
      preview: "미리보기",
      canvasSizeTitle: "캔버스 크기",
      snap: "자석",
      snapTitle: "자석 스냅",
      zoomOut: "축소",
      zoomIn: "확대",
      zoomFit: "맞춤",
      previewDropTitle: "스크롤 휠로 확대/축소 · 레이아웃 위에 이미지 드롭으로 추가",
      langTitle: "언어",

      alignLeftTop: "좌측 상단",
      alignCenterTop: "중앙 상단",
      alignRightTop: "우측 상단",
      alignLeftMiddle: "좌측 중단",
      alignCenterMiddle: "정중앙",
      alignRightMiddle: "우측 중단",
      alignLeftBottom: "좌측 하단",
      alignCenterBottom: "중앙 하단",
      alignRightBottom: "우측 하단",

      canvasImageSize: "선택 이미지 {w} × {h} px",
      imagePxSize: "{w}×{h} px",
      canvas: "캔버스",
      layout: "레이아웃",
      layoutN: "레이아웃 {n}",
      childSuffix: " / 하위",
      imageFallback: "(이미지)",
      notSelected: "(미선택)",
      editing: "편집",

      renameAria: "레이아웃 이름",
      renameHint: "더블클릭하여 이름 수정",
      expand: "펼치기",
      collapse: "접기",
      removeEnabledTitle: "선택 항목 제거",
      removeDisabledTitle: "선택된 레이아웃 또는 이미지가 없습니다",
      snapOn: "자석 스냅 ON",
      snapOff: "자석 스냅 OFF",

      statusReady: "캔버스에 레이아웃을 추가하거나 이미지를 드롭하세요",
      statusCompose: "레이아웃을 구성하세요",
      gridLoadFail: "grid.js 로드 실패",
      renamed: "이름 변경됨",
      errImageOnly: "이미지 파일만 추가할 수 있습니다.",
      errSelectLayout: "레이아웃을 먼저 선택하세요.",
      errImageLoad: "이미지 로드 실패",
      imagesAdded: "{n}개 이미지 추가됨 → {name}",
      imageMoved: "이미지 이동됨 → {name}",
      imagesMoved: "{n}개 이미지 이동됨 → {name}",
      imagesRemoved: "{n}개 이미지 제거됨",
      pngSavedDownload: "다운로드로 저장됨",
      pngFail: "PNG 실패",
      pngOverwritten: "'{name}' 덮어씀",
      autoExportFail: "자동 내보내기 실패",
      autoExportOk: "자동 내보내기: '{name}'",
      nothingToUndo: "되돌릴 작업이 없습니다.",
      undone: "실행 취소",
      errBadFile: "잘못된 파일입니다.",
      errWrongKind: "OBS Grid Designer 구조 파일이 아닙니다.",
      errBadVersion: "지원하지 않는 구조 버전입니다.",
      errNoCanvas: "캔버스 정보가 없습니다.",
      errImageLoadNamed: "이미지 로드 실패: {name}",
      errWritePermission: "쓰기 권한 없음",
      errImageRead: "이미지 읽기 실패",
      errNoImage: "이미지 없음",
      copySuffix: " 복사",
      savingWithImages: "구조·이미지 저장 중…",
      savingStructure: "구조 저장 중…",
      savedWithImages: "구조 저장됨 ({nLay} 레이아웃, {nImg} 이미지)",
      savedNoImages: "구조 저장됨 ({nLay} 레이아웃, 이미지 제외)",
      confirmOverwrite: "현재 작업 내용을 덮어쓸까요?",
      loadCancelled: "불러오기 취소됨",
      loading: "구조 불러오는 중…",
      loaded: "구조 불러옴 ({nLay} 레이아웃, {nImg} 이미지)",
      errJsonParse: "JSON 파싱 실패: {msg}",
      errFileRead: "파일 읽기 실패",
      frameUpdated: "프레임 수정됨",
      layoutAdded: "레이아웃 추가됨",
      layoutRemoved: "레이아웃 제거됨",
      imageRemoved: "이미지 제거됨",
      errNothingToRemove: "제거할 항목을 선택하세요.",
      errCopySelect: "복사할 레이아웃 또는 이미지를 선택하세요.",
      errCopyImage: "이미지를 복사할 수 없습니다.",
      imageCopied: "이미지 복사됨",
      errCopyLayout: "레이아웃을 복사할 수 없습니다.",
      layoutCopied: "레이아웃 복사됨 (하위 포함)",
      errPasteEmpty: "붙여넣을 내용이 없습니다.",
      errPasteImageMissing: "복사한 이미지를 찾을 수 없습니다.",
      imagePasted: "이미지 붙여넣음",
      layoutPasted: "레이아웃 붙여넣음",
      errDupSelect: "복제할 레이아웃 또는 이미지를 선택하세요.",
      errDupImage: "이미지를 복제할 수 없습니다.",
      imageDuplicated: "이미지 복제됨",
      errDupLayout: "레이아웃을 복제할 수 없습니다.",
      layoutDuplicated: "레이아웃 복제됨",
      confirmClearChildren: "{label}의 자식 항목을 모두 제거할까요?",
      errNoPathPicker: "이 브라우저는 위치 고정을 지원하지 않습니다.",
      pngPathSet: "PNG 위치: {name}",
      metaLine: "캔버스 {w}×{h} · 편집: {edit}",
      badgeCanvas: "캔버스 {w} × {h}",
      pngLine: "PNG: ",
    },
    en: {
      appTitle: "OBS Grid Designer",
      tutorial: "Tutorial",
      tutorialTitle: "Donation wallpaper walkthrough",
      open: "Open",
      save: "Save",
      includeImages: "Include images",
      includeImagesTitle: "When checked, image data is embedded in the JSON",
      projectGroupTitle: "Project file",
      autoExport: "Auto export",
      autoExportTitle: "Automatically save PNG when the structure changes. Only works after a PNG path is set. Size changes save only when finished.",
      changePath: "Change path",
      changePathTitle: "Change PNG save location",
      exportPng: "Export",
      hierarchy: "Hierarchy",
      addMenu: "Add ▾",
      addImage: "Add image",
      addLayout: "Add layout",
      folderWatch: "Auto settings",
      folderWatchMenuOn: "Auto settings · ON",
      folderWatchTitle: "Auto-add images settings",
      folderWatchModalTitle: "Auto-add images",
      folderWatchDesc: "When new images appear in the chosen folder, they are added to the selected layout. Works in Chrome/Edge and only while this tab is open.",
      folderWatchEnable: "Enable auto-add",
      folderWatchFolder: "Watch folder",
      folderWatchPick: "Choose folder",
      folderWatchClear: "Clear",
      folderWatchNoFolder: "(none)",
      folderWatchTarget: "Target layout",
      folderWatchCancel: "Cancel",
      folderWatchSave: "Save",
      folderWatchUnsupported: "This browser does not support folder watching. Use Chrome or Edge.",
      folderWatchNeedFolder: "Choose a folder to watch first.",
      folderWatchSaved: "Auto-add settings saved",
      folderWatchOn: "Auto-add ON",
      folderWatchOff: "Auto-add OFF",
      folderWatchPermission: "Folder access permission is required. Choose the folder again in settings.",
      remove: "Remove",
      removeTitle: "Remove selection",
      clearAll: "Clear",
      clearAllTitle: "Remove all children of the selection",
      settingsHeading: "Layout settings",
      settingsHeadingCanvas: "Canvas",
      noLayoutHint: "Canvas is selected. New images and layouts are added directly to the canvas. Drop images onto a layout in the preview to place them there.",
      canvasImageHint: "A canvas image is selected. Drag in the preview to move or resize. Hold Shift while resizing to keep the aspect ratio.",
      width: "Width",
      height: "Height",
      sizeLockHint: "Locked to parent layout cell size",
      padding: "Padding",
      padL: "L",
      padR: "R",
      padT: "T",
      padB: "B",
      cellSize: "Cell size",
      cellW: "Width",
      cellH: "Height",
      cellHint: "Fixed size · images fill the cell",
      spacing: "Spacing",
      spacingX: "X",
      spacingY: "Y",
      spacingHint: "Negative values allowed (overlap)",
      placement: "Placement",
      startCorner: "Start corner",
      startAxis: "Start axis",
      axisHorizontal: "Horizontal",
      axisVertical: "Vertical",
      childAlign: "Child alignment",
      childAlignHint: "Child alignment = where the cell group sits inside the layout",
      constraint: "Constraint",
      constraintAuto: "Auto",
      constraintColumns: "Column count",
      constraintRows: "Row count",
      constraintCount: "Count",
      transparentBg: "Transparent background",
      preview: "Preview",
      canvasSizeTitle: "Canvas size",
      snap: "Snap",
      snapTitle: "Magnetic snap",
      zoomOut: "Zoom out",
      zoomIn: "Zoom in",
      zoomFit: "Fit",
      previewDropTitle: "Scroll to zoom · Drop images onto a layout to add them",
      langTitle: "Language",

      alignLeftTop: "Upper Left",
      alignCenterTop: "Upper Center",
      alignRightTop: "Upper Right",
      alignLeftMiddle: "Middle Left",
      alignCenterMiddle: "Middle Center",
      alignRightMiddle: "Middle Right",
      alignLeftBottom: "Lower Left",
      alignCenterBottom: "Lower Center",
      alignRightBottom: "Lower Right",

      canvasImageSize: "Selected image {w} × {h} px",
      imagePxSize: "{w}×{h} px",
      canvas: "Canvas",
      layout: "Layout",
      layoutN: "Layout {n}",
      childSuffix: " / Child",
      imageFallback: "(image)",
      notSelected: "(none)",
      editing: "Editing",

      renameAria: "Layout name",
      renameHint: "Double-click to rename",
      expand: "Expand",
      collapse: "Collapse",
      removeEnabledTitle: "Remove selection",
      removeDisabledTitle: "No layout or image selected",
      snapOn: "Snap ON",
      snapOff: "Snap OFF",

      statusReady: "Add a layout to the canvas or drop images",
      statusCompose: "Compose your layout",
      gridLoadFail: "Failed to load grid.js",
      renamed: "Renamed",
      errImageOnly: "Only image files can be added.",
      errSelectLayout: "Select a layout first.",
      errImageLoad: "Failed to load image",
      imagesAdded: "Added {n} image(s) → {name}",
      imageMoved: "Image moved → {name}",
      imagesMoved: "{n} image(s) moved → {name}",
      imagesRemoved: "{n} image(s) removed",
      pngSavedDownload: "Saved via download",
      pngFail: "PNG export failed",
      pngOverwritten: "Overwrote '{name}'",
      autoExportFail: "Auto export failed",
      autoExportOk: "Auto export: '{name}'",
      nothingToUndo: "Nothing to undo.",
      undone: "Undone",
      errBadFile: "Invalid file.",
      errWrongKind: "Not an OBS Grid Designer project file.",
      errBadVersion: "Unsupported project version.",
      errNoCanvas: "Canvas data is missing.",
      errImageLoadNamed: "Failed to load image: {name}",
      errWritePermission: "Write permission denied",
      errImageRead: "Failed to read image",
      errNoImage: "Image missing",
      copySuffix: " copy",
      savingWithImages: "Saving structure & images…",
      savingStructure: "Saving structure…",
      savedWithImages: "Saved ({nLay} layouts, {nImg} images)",
      savedNoImages: "Saved ({nLay} layouts, images excluded)",
      confirmOverwrite: "Overwrite the current work?",
      loadCancelled: "Load cancelled",
      loading: "Loading structure…",
      loaded: "Loaded ({nLay} layouts, {nImg} images)",
      errJsonParse: "JSON parse failed: {msg}",
      errFileRead: "Failed to read file",
      frameUpdated: "Frame updated",
      layoutAdded: "Layout added",
      layoutRemoved: "Layout removed",
      imageRemoved: "Image removed",
      errNothingToRemove: "Select an item to remove.",
      errCopySelect: "Select a layout or image to copy.",
      errCopyImage: "Could not copy image.",
      imageCopied: "Image copied",
      errCopyLayout: "Could not copy layout.",
      layoutCopied: "Layout copied (with children)",
      errPasteEmpty: "Nothing to paste.",
      errPasteImageMissing: "Copied image not found.",
      imagePasted: "Image pasted",
      layoutPasted: "Layout pasted",
      errDupSelect: "Select a layout or image to duplicate.",
      errDupImage: "Could not duplicate image.",
      imageDuplicated: "Image duplicated",
      errDupLayout: "Could not duplicate layout.",
      layoutDuplicated: "Layout duplicated",
      confirmClearChildren: "Remove all children of {label}?",
      errNoPathPicker: "This browser does not support fixed save paths.",
      pngPathSet: "PNG path: {name}",
      metaLine: "Canvas {w}×{h} · Editing: {edit}",
      badgeCanvas: "Canvas {w} × {h}",
      pngLine: "PNG: ",
    },
  };

  var ALIGN_KEYS = {
    "left-top": "alignLeftTop",
    "center-top": "alignCenterTop",
    "right-top": "alignRightTop",
    "left-middle": "alignLeftMiddle",
    "center-middle": "alignCenterMiddle",
    "right-middle": "alignRightMiddle",
    "left-bottom": "alignLeftBottom",
    "center-bottom": "alignCenterBottom",
    "right-bottom": "alignRightBottom",
  };

  var lang = "ko";
  var listeners = [];

  function readStored() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v === "en" || v === "ko") return v;
    } catch (e) { /* ignore */ }
    return "ko";
  }

  function t(key, vars) {
    var dict = STRINGS[lang] || STRINGS.ko;
    var s = (dict && dict[key]) || STRINGS.ko[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return s;
  }

  function alignLabel(key) {
    return t(ALIGN_KEYS[key] || key);
  }

  function applyDom() {
    document.documentElement.lang = lang === "en" ? "en" : "ko";
    document.title = t("appTitle");
    document.querySelectorAll("[data-i18n]").forEach(function (node) {
      var key = node.getAttribute("data-i18n");
      if (key) node.textContent = t(key);
    });
    document.querySelectorAll("[data-i18n-title]").forEach(function (node) {
      var key = node.getAttribute("data-i18n-title");
      if (key) node.setAttribute("title", t(key));
    });
    var sel = document.getElementById("langSelect");
    if (sel && sel.value !== lang) sel.value = lang;
  }

  function setLang(next) {
    if (next !== "en" && next !== "ko") next = "ko";
    lang = next;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
    applyDom();
    listeners.forEach(function (fn) {
      try { fn(lang); } catch (e) { /* ignore */ }
    });
  }

  function onChange(fn) {
    if (typeof fn === "function") listeners.push(fn);
  }

  /** If text matches any language's exact string, return its key. */
  function findKeyByText(text) {
    if (!text) return null;
    var codes = Object.keys(STRINGS);
    for (var i = 0; i < codes.length; i++) {
      var dict = STRINGS[codes[i]];
      for (var key in dict) {
        if (Object.prototype.hasOwnProperty.call(dict, key) && dict[key] === text) {
          return key;
        }
      }
    }
    return null;
  }

  lang = readStored();

  global.GC_I18N = {
    t: t,
    alignLabel: alignLabel,
    getLang: function () { return lang; },
    setLang: setLang,
    applyDom: applyDom,
    onChange: onChange,
    findKeyByText: findKeyByText,
    ALIGN_KEYS: ALIGN_KEYS,
  };
})(window);
