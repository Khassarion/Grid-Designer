/**
 * Grid Designer — canvas (scene) + nested layouts → PNG
 *
 * Copyright (c) 2026 Khassarion
 * SPDX-License-Identifier: LicenseRef-GridDesigner-Proprietary
 *
 * Canvas = free container (like scene). No grid.
 * Layout = grid. Nested under a layout: size locked to parent cell, content 1:1 (no squash).
 */
(function () {
  "use strict";

  var G = window.ObsGrid;
  var I18N = window.GC_I18N;
  if (!G) {
    document.getElementById("status").textContent =
      (I18N && I18N.t("gridLoadFail")) || "grid.js 로드 실패";
    return;
  }
  if (!I18N) {
    document.getElementById("status").textContent = "i18n.js 로드 실패";
    return;
  }

  var t = I18N.t;
  var alignLabel = I18N.alignLabel;

  var computeGrid = G.computeGrid;
  var ns = G.normalizeSettings;
  var Align = G.Align;

  var ALIGNS = [
    "left-top", "center-top", "right-top",
    "left-middle", "center-middle", "right-middle",
    "left-bottom", "center-bottom", "right-bottom",
  ];

  function $(id) { return document.getElementById(id); }
  function uid(p) { return p + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6); }

  var images = {};
  var layouts = {};
  var canvasId = null;
  var activeId = null;
  var selectedChild = -1;
  /** Preview selection: canvas images + any layout frame { parentId, index } */
  var previewSel = { parentId: null, index: -1 };
  /** Multi-selected images in hierarchy: [{ parentId, index }, ...] */
  var imageSel = [];
  /** Shift-click range anchor for image multi-select */
  var imageSelAnchor = null;
  /** Sibling reorder / preview reparent drag: { parentId, index, refs? } */
  var childDrag = null;
  /** Collapsed layout ids in hierarchy tree */
  var collapsed = {};
  var maxZ = 1;
  var pngHandle = null;
  var zoom = 1;
  var drag = null;
  var snapEnabled = true;
  var SNAP_THRESH = 8;
  var undoStack = [];
  var MAX_UNDO = 50;
  var undoSuspended = false;
  var formUndoArmed = false;
  /** Internal clipboard for layout subtree / image child */
  var clip = null;
  /** Double-click rename detection: { id, t } */
  var renameClick = null;
  var autoExportTimer = null;
  var autoExportBusy = false;
  var autoExportPending = false;

  var FOLDER_WATCH_LS = "grid-designer-folder-watch";
  var FOLDER_SEEN_LS = "grid-designer-folder-seen";
  var FOLDER_HANDLES_IDB = "watchFolders";
  var FOLDER_HANDLE_IDB_LEGACY = "watchFolder";
  var SHOW_TREE_THUMBS_LS = "grid-designer-show-tree-thumbs";
  var LAST_SEEN_VERSION_LS = "grid-designer-last-seen-version";
  var FOLDER_POLL_MS = 1000;
  var showTreeThumbs = true;
  /** @type {{ enabled: boolean, rules: Array<{id:string, folderName:string, targetLayoutId:string|null, handle: any}> }} */
  var folderWatch = {
    enabled: false,
    rules: [],
  };
  var folderSeenKeys = {};
  var folderPollTimer = null;
  var folderScanBusy = false;
  var folderObserver = null;
  var folderScanDebounce = null;
  var folderPendingStable = {};
  /** Modal draft mirrors folderWatch.rules (+ optional clearHandle per rule). */
  var folderModalDraft = {
    enabled: false,
    rules: [],
  };

  var el = {
    tree: $("layoutTree"),
    hierarchy: $("hierarchyPanel"),
    heading: $("settingsHeading"),
    noLayoutHint: $("noLayoutHint"),
    layoutSettings: $("layoutSettingsBlock"),
    w: $("width"),
    h: $("height"),
    canvasW: $("canvasWidth"),
    canvasH: $("canvasHeight"),
    presets: $("canvasPresets"),
    layoutPresets: $("layoutPresets"),
    sizeLockHint: $("sizeLockHint"),
    gridSettings: $("gridSettingsBlock"),
    padL: $("padL"),
    padR: $("padR"),
    padT: $("padT"),
    padB: $("padB"),
    cellW: $("cellW"),
    cellH: $("cellH"),
    spacingX: $("spacingX"),
    spacingY: $("spacingY"),
    startCorner: $("startCorner"),
    startAxis: $("startAxis"),
    childAlign: $("childAlign"),
    alignPad: $("alignPad"),
    constraint: $("constraint"),
    constraintCount: $("constraintCount"),
    constraintCountRow: $("constraintCountRow"),
    bg: $("bgColor"),
    bgAlpha: $("bgAlpha"),
    status: $("status"),
    paths: $("savePaths"),
    stage: $("previewStage"),
    shell: $("previewShell"),
    wrap: $("previewWrap"),
    meta: $("previewMeta"),
    zoomLabel: $("zoomLabel"),
    canvas: $("exportCanvas"),
    file: $("fileInput"),
    removeBtn: $("removeNodeBtn"),
    snapBtn: $("snapToggleBtn"),
  };

  function status(msg, kind) {
    el.status.textContent = msg || "";
    el.status.className = "status" + (kind ? " " + kind : "");
  }

  function lay() { return layouts[activeId] || null; }
  function isCanvas(id) { return id === canvasId; }
  /** Nested under another layout (not under canvas) → size locked to parent cell */
  function isSizeLocked(id) {
    var L = layouts[id];
    return !!(L && L.parentId && L.parentId !== canvasId);
  }

  function canvasSize() {
    var s = ns(layouts[canvasId].settings);
    return { w: s.width, h: s.height };
  }

  function defaultSettings(extra) {
    return ns(Object.assign({
      width: 1920,
      height: 1080,
      pad_l: 0, pad_r: 0, pad_t: 0, pad_b: 0,
      cell_w: 200, cell_h: 160,
      spacing_x: 0, spacing_y: 0,
      start_corner: "left-top",
      start_axis: "horizontal",
      child_align: Align.LEFT_TOP,
      constraint: "auto",
      constraint_count: 4,
    }, extra || {}));
  }

  function clamp01(n) {
    n = +n;
    if (!(n >= 0)) return 0;
    if (n > 1) return 1;
    return n;
  }

  function hexToRgb(hex) {
    var h = String(hex || "#000000").replace("#", "");
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    if (h.length !== 6) return { r: 0, g: 0, b: 0 };
    return {
      r: parseInt(h.slice(0, 2), 16) || 0,
      g: parseInt(h.slice(2, 4), 16) || 0,
      b: parseInt(h.slice(4, 6), 16) || 0,
    };
  }

  /** 0–1 alpha; legacy transparentBg maps to 0 / 1 when bgAlpha missing */
  function getBgAlpha(L) {
    if (!L) return 0;
    if (L.bgAlpha != null && L.bgAlpha !== "") return clamp01(L.bgAlpha);
    return L.transparentBg === false ? 1 : 0;
  }

  function layoutBgCss(L) {
    var a = getBgAlpha(L);
    if (a <= 0) return "transparent";
    var rgb = hexToRgb(L.bgColor || "#000000");
    if (a >= 1) return L.bgColor || "#000000";
    return "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + a + ")";
  }

  function layoutBgFillStyle(L) {
    var a = getBgAlpha(L);
    if (a <= 0) return null;
    var rgb = hexToRgb(L.bgColor || "#000000");
    if (a >= 1) return L.bgColor || "#000000";
    return "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + a + ")";
  }

  function copyBgFields(L) {
    var a = getBgAlpha(L);
    return {
      bgColor: L.bgColor || "#000000",
      bgAlpha: a,
      transparentBg: a <= 0,
      visible: L.visible !== false,
    };
  }

  function isLayoutVisible(id) {
    var L = layouts[id];
    return !!(L && L.visible !== false);
  }

  function setLayoutVisible(id, on) {
    var L = layouts[id];
    if (!L || isCanvas(id)) return;
    L.visible = !!on;
  }

  function makeLayout(name, parentId) {
    var id = uid("lay");
    layouts[id] = {
      id: id,
      name: name || t("layout"),
      parentId: parentId || null,
      settings: defaultSettings(),
      transparentBg: true,
      bgColor: "#000000",
      bgAlpha: 0,
      visible: true,
      children: [],
    };
    return id;
  }

  function makeFrame(cell, i) {
    return {
      x: cell ? cell.x : 0,
      y: cell ? cell.y : 0,
      w: cell ? cell.width : 200,
      h: cell ? cell.height : 160,
      z: i + 1,
    };
  }

  /** Canvas-direct images + any visible layout frame are mouse-editable in preview */
  function isInteractiveChild(parentId, ch) {
    if (!ch) return false;
    if (ch.type === "layout") return isLayoutVisible(ch.refId);
    return ch.type === "image" && parentId === canvasId;
  }

  function syncSizeFromParent(L) {
    if (!L || !isSizeLocked(L.id)) return;
    var parent = layouts[L.parentId];
    if (!parent) return;
    var ps = ns(parent.settings);
    L.settings.width = ps.cell_w;
    L.settings.height = ps.cell_h;
  }

  function syncCanvasChildFrame(layoutId) {
    var L = layouts[layoutId];
    if (!L || L.parentId !== canvasId) return;
    var s = ns(L.settings);
    layouts[canvasId].children.forEach(function (ch) {
      if (ch.type === "layout" && ch.refId === layoutId && ch.frame) {
        ch.frame.w = s.width;
        ch.frame.h = s.height;
      }
    });
  }

  function findParentFrame(layoutId) {
    var L = layouts[layoutId];
    if (!L || !L.parentId || !layouts[L.parentId]) return null;
    var kids = layouts[L.parentId].children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].type === "layout" && kids[i].refId === layoutId) return kids[i].frame;
    }
    return null;
  }

  function ensureFrames(L) {
    if (!L) return;

    if (isCanvas(L.id)) {
      L.children.forEach(function (ch, i) {
        if (!ch.frame || !(ch.frame.w > 0) || !(ch.frame.h > 0)) {
          if (ch.type === "image" && images[ch.refId] && images[ch.refId].img) {
            var im = images[ch.refId].img;
            ch.frame = {
              x: 24 + i * 28,
              y: 24 + i * 28,
              w: im.naturalWidth || 200,
              h: im.naturalHeight || 160,
              z: i + 1,
            };
          } else if (ch.type === "layout" && layouts[ch.refId]) {
            var cs = ns(layouts[ch.refId].settings);
            ch.frame = { x: 40 + i * 28, y: 40 + i * 28, w: cs.width, h: cs.height, z: i + 1 };
          } else {
            ch.frame = makeFrame(null, i);
          }
        }
        if (ch.type === "layout" && layouts[ch.refId]) {
          var ls = ns(layouts[ch.refId].settings);
          ch.frame.w = ls.width;
          ch.frame.h = ls.height;
        }
        if (ch.frame.z == null) ch.frame.z = i + 1;
        if (ch.frame.z > maxZ) maxZ = ch.frame.z;
      });
      return;
    }

    // Layout: create missing frames only — do not re-grid until reflow()
    var missing = false;
    for (var mi = 0; mi < L.children.length; mi++) {
      var mf = L.children[mi].frame;
      if (!mf || !(mf.w > 0) || !(mf.h > 0)) { missing = true; break; }
    }
    var cells = missing ? computeGrid(Math.max(L.children.length, 1), L.settings) : null;
    L.children.forEach(function (ch, i) {
      if (!ch.frame || !(ch.frame.w > 0) || !(ch.frame.h > 0)) {
        ch.frame = makeFrame(cells[i] || cells[0], i);
        if (ch.type === "layout" && layouts[ch.refId]) {
          layouts[ch.refId].settings.width = ch.frame.w;
          layouts[ch.refId].settings.height = ch.frame.h;
        }
      }
      if (ch.frame.z == null) ch.frame.z = i + 1;
      if (ch.frame.z > maxZ) maxZ = ch.frame.z;
    });
  }

  function reflow(L) {
    if (!L || isCanvas(L.id)) return;
    var cells = computeGrid(L.children.length, L.settings);
    var s = ns(L.settings);
    L.children.forEach(function (ch, i) {
      // Keep stack order identical to hierarchy / children order.
      ch.frame = makeFrame(cells[i], i);
      ch.frame.z = i + 1;
      if (ch.frame.z > maxZ) maxZ = ch.frame.z;
      if (ch.type === "layout" && layouts[ch.refId]) {
        layouts[ch.refId].settings.width = s.cell_w;
        layouts[ch.refId].settings.height = s.cell_h;
        syncSizeFromParent(layouts[ch.refId]);
      }
    });
  }

  function collectSnapGuides(parentId, excludeIndex) {
    var parent = layouts[parentId];
    var ps = ns(parent.settings);
    var gx = [0, ps.width, ps.width / 2];
    var gy = [0, ps.height, ps.height / 2];
    parent.children.forEach(function (ch, i) {
      if (i === excludeIndex || !ch.frame) return;
      var f = ch.frame;
      gx.push(f.x, f.x + f.w, f.x + f.w / 2);
      gy.push(f.y, f.y + f.h, f.y + f.h / 2);
    });
    return { x: gx, y: gy };
  }

  function snapDelta(edges, guides, thresh) {
    var best = 0;
    var bestDist = thresh + 1;
    for (var i = 0; i < edges.length; i++) {
      for (var j = 0; j < guides.length; j++) {
        var d = Math.abs(edges[i] - guides[j]);
        if (d <= thresh && d < bestDist) {
          bestDist = d;
          best = guides[j] - edges[i];
        }
      }
    }
    return bestDist <= thresh ? best : 0;
  }

  function snapMoveRect(x, y, w, h, guides, thresh) {
    x += snapDelta([x, x + w, x + w / 2], guides.x, thresh);
    y += snapDelta([y, y + h, y + h / 2], guides.y, thresh);
    return { x: x, y: y, w: w, h: h };
  }

  function snapResizeRect(x, y, w, h, handle, guides, thresh) {
    var hx = handle || "";
    var nx = x, ny = y, nw = w, nh = h;
    if (hx.indexOf("e") >= 0) {
      var r = snapDelta([x + w], guides.x, thresh);
      nw = Math.max(24, w + r);
    }
    if (hx.indexOf("w") >= 0) {
      var l = snapDelta([x], guides.x, thresh);
      nx = x + l;
      nw = Math.max(24, w - l);
    }
    if (hx.indexOf("s") >= 0) {
      var b = snapDelta([y + h], guides.y, thresh);
      nh = Math.max(24, h + b);
    }
    if (hx.indexOf("n") >= 0) {
      var t = snapDelta([y], guides.y, thresh);
      ny = y + t;
      nh = Math.max(24, h - t);
    }
    return { x: nx, y: ny, w: nw, h: nh };
  }

  /** Keep resize aspect ratio from original frame (hold Shift). */
  function applyAspectLock(x, y, w, h, o, hd, minSize) {
    var ratio = o.w / Math.max(1e-6, o.h);
    minSize = minSize || 24;
    w = Math.max(minSize, w);
    h = Math.max(minSize, h);
    hd = hd || "se";

    if (hd === "e" || hd === "w") {
      h = w / ratio;
      if (h < minSize) { h = minSize; w = h * ratio; }
      y = o.y + (o.h - h) / 2;
      x = hd === "w" ? o.x + o.w - w : o.x;
    } else if (hd === "n" || hd === "s") {
      w = h * ratio;
      if (w < minSize) { w = minSize; h = w / ratio; }
      x = o.x + (o.w - w) / 2;
      y = hd === "n" ? o.y + o.h - h : o.y;
    } else {
      var dw = Math.abs(w - o.w);
      var dh = Math.abs(h - o.h);
      if (dw >= dh * ratio) h = w / ratio;
      else w = h * ratio;
      if (w < minSize) { w = minSize; h = w / ratio; }
      if (h < minSize) { h = minSize; w = h * ratio; }
      x = hd.indexOf("w") >= 0 ? o.x + o.w - w : o.x;
      y = hd.indexOf("n") >= 0 ? o.y + o.h - h : o.y;
    }
    return { x: x, y: y, w: w, h: h };
  }

  function getSelectedCanvasImageFrame() {
    if (!canvasId || activeId !== canvasId || selectedChild < 0) return null;
    var ch = layouts[canvasId] && layouts[canvasId].children[selectedChild];
    if (!ch || ch.type !== "image" || !ch.frame) return null;
    return ch.frame;
  }

  function reflowIfLayout(id) {
    if (id && layouts[id] && !isCanvas(id)) reflow(layouts[id]);
  }

  /** Snapshot cell/pad/spacing for Ctrl+resize (recompute px — not CSS transform). */
  function snapshotLayoutCellSettings(rootId) {
    var map = {};
    function walk(id) {
      var L = layouts[id];
      if (!L || isCanvas(id) || map[id]) return;
      var s = ns(L.settings);
      map[id] = {
        cell_w: s.cell_w,
        cell_h: s.cell_h,
        pad_l: s.pad_l,
        pad_r: s.pad_r,
        pad_t: s.pad_t,
        pad_b: s.pad_b,
        spacing_x: s.spacing_x,
        spacing_y: s.spacing_y,
      };
      (L.children || []).forEach(function (ch) {
        if (ch.type === "layout" && ch.refId) walk(ch.refId);
      });
    }
    walk(rootId);
    return map;
  }

  function restoreLayoutCellSettings(origMap) {
    if (!origMap) return;
    Object.keys(origMap).forEach(function (id) {
      var L = layouts[id];
      var o = origMap[id];
      if (!L || !o) return;
      L.settings.cell_w = o.cell_w;
      L.settings.cell_h = o.cell_h;
      L.settings.pad_l = o.pad_l;
      L.settings.pad_r = o.pad_r;
      L.settings.pad_t = o.pad_t;
      L.settings.pad_b = o.pad_b;
      L.settings.spacing_x = o.spacing_x;
      L.settings.spacing_y = o.spacing_y;
    });
  }

  /**
   * Ctrl+layout resize (on mouseup only): change real cell px by layout size ratio
   * so the content group matches the drag preview — not used during drag (CSS scale then).
   */
  function applyProportionalCellSizes(rootId, rw, rh, origMap) {
    if (!origMap) return;
    Object.keys(origMap).forEach(function (id) {
      var L = layouts[id];
      var o = origMap[id];
      if (!L || !o) return;
      L.settings.cell_w = Math.max(1, Math.round(o.cell_w * rw));
      L.settings.cell_h = Math.max(1, Math.round(o.cell_h * rh));
      L.settings.pad_l = Math.max(0, Math.round(o.pad_l * rw));
      L.settings.pad_r = Math.max(0, Math.round(o.pad_r * rw));
      L.settings.pad_t = Math.max(0, Math.round(o.pad_t * rh));
      L.settings.pad_b = Math.max(0, Math.round(o.pad_b * rh));
      L.settings.spacing_x = Math.round(o.spacing_x * rw);
      L.settings.spacing_y = Math.round(o.spacing_y * rh);
    });
    reflowLayoutTree(rootId);
  }

  function reflowLayoutTree(id) {
    reflowIfLayout(id);
    var L = layouts[id];
    if (!L) return;
    (L.children || []).forEach(function (ch) {
      if (ch.type === "layout" && ch.refId) reflowLayoutTree(ch.refId);
    });
  }

  /** Keep frame.z aligned with children[] so stack order == hierarchy order. */
  function syncChildStackZ(parent) {
    if (!parent) return;
    parent.children.forEach(function (ch, i) {
      if (!ch.frame) return;
      ch.frame.z = i + 1;
      if (ch.frame.z > maxZ) maxZ = ch.frame.z;
    });
  }

  /** Paint / hierarchy share the same order: children[] (back → front). */
  function childPaintOrder(L) {
    if (!L) return [];
    return L.children.map(function (_, i) { return i; });
  }

  function fillAlign(sel) {
    sel.replaceChildren();
    ALIGNS.forEach(function (k) {
      var o = document.createElement("option");
      o.value = k;
      o.textContent = alignLabel(k);
      sel.appendChild(o);
    });
  }

  function canRemoveSelected() {
    if (imageSel.length > 0) return true;
    if (selectedChild >= 0) return true;
    return !!(activeId && !isCanvas(activeId) && layouts[activeId]);
  }

  function imageSelKey(parentId, index) {
    return parentId + "\0" + index;
  }

  function isImageSelected(parentId, index) {
    for (var i = 0; i < imageSel.length; i++) {
      if (imageSel[i].parentId === parentId && imageSel[i].index === index) return true;
    }
    return false;
  }

  function clearImageSel() {
    imageSel = [];
    imageSelAnchor = null;
  }

  function normalizeImageSel(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (r) {
      if (!r) return;
      var parent = layouts[r.parentId];
      var ch = parent && parent.children[r.index];
      if (!ch || ch.type !== "image") return;
      var key = imageSelKey(r.parentId, r.index);
      if (seen[key]) return;
      seen[key] = true;
      out.push({ parentId: r.parentId, index: r.index });
    });
    return out;
  }

  function applyImageSel(list, primary) {
    imageSel = normalizeImageSel(list);
    if (!imageSel.length) {
      selectedChild = -1;
      if (previewSel.parentId && layouts[previewSel.parentId]) {
        var pch = layouts[previewSel.parentId].children[previewSel.index];
        if (!pch || pch.type === "image") previewSel = { parentId: null, index: -1 };
      }
      return;
    }
    var prim = primary && isImageSelected(primary.parentId, primary.index)
      ? primary
      : imageSel[imageSel.length - 1];
    activeId = prim.parentId;
    selectedChild = prim.index;
    previewSel = { parentId: prim.parentId, index: prim.index };
    expandAncestors(prim.parentId);
  }

  function imagesInSiblingRange(parentId, a, b) {
    var parent = layouts[parentId];
    if (!parent) return [];
    var lo = Math.min(a, b);
    var hi = Math.max(a, b);
    var out = [];
    for (var i = lo; i <= hi; i++) {
      if (parent.children[i] && parent.children[i].type === "image") {
        out.push({ parentId: parentId, index: i });
      }
    }
    return out;
  }

  function syncChrome() {
    var isC = isCanvas(activeId);
    var locked = isSizeLocked(activeId);
    var imgFr = getSelectedCanvasImageFrame();
    if (el.layoutSettings) el.layoutSettings.hidden = !!isC;
    if (el.noLayoutHint) {
      el.noLayoutHint.hidden = !isC;
      if (isC) {
        var hintKey = imgFr ? "canvasImageHint" : "noLayoutHint";
        el.noLayoutHint.setAttribute("data-i18n", hintKey);
        el.noLayoutHint.textContent = t(hintKey);
      }
    }
    if (el.heading) {
      el.heading.textContent = isC ? t("settingsHeadingCanvas") : t("settingsHeading");
      el.heading.setAttribute("data-i18n", isC ? "settingsHeadingCanvas" : "settingsHeading");
    }
    if (el.layoutPresets) el.layoutPresets.hidden = isC || locked;
    el.sizeLockHint.hidden = !locked;
    el.w.disabled = locked;
    el.h.disabled = locked;
    if (el.removeBtn) {
      var canRemove = canRemoveSelected();
      el.removeBtn.disabled = !canRemove;
      el.removeBtn.title = canRemove ? t("removeEnabledTitle") : t("removeDisabledTitle");
    }
    if (el.snapBtn) {
      el.snapBtn.classList.toggle("active", snapEnabled);
      el.snapBtn.title = snapEnabled ? t("snapOn") : t("snapOff");
    }
    var fixed = !isC && el.constraint.value !== "auto";
    el.constraintCount.disabled = !fixed;
    if (el.alignPad) {
    el.alignPad.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.align === el.childAlign.value);
    });
    }
    var sizeEl = $("canvasImageSize");
    if (sizeEl) {
      if (imgFr) {
        sizeEl.hidden = false;
        sizeEl.textContent = t("canvasImageSize", {
          w: Math.round(imgFr.w),
          h: Math.round(imgFr.h),
        });
      } else {
        sizeEl.hidden = true;
        sizeEl.textContent = "";
      }
    }
  }

  function readCanvasSize() {
    if (!canvasId || !layouts[canvasId]) return;
    var s = ns(layouts[canvasId].settings);
    el.canvasW.value = s.width;
    el.canvasH.value = s.height;
  }

  function writeCanvasSize() {
    if (!canvasId || !layouts[canvasId]) return;
    var L = layouts[canvasId];
    L.settings = ns(Object.assign({}, L.settings, {
      width: Math.max(1, +el.canvasW.value || 1),
      height: Math.max(1, +el.canvasH.value || 1),
    }));
  }

  function readForm() {
    readCanvasSize();
    var L = lay();
    if (!L) return;
    if (isCanvas(L.id)) {
      syncChrome();
      return;
    }
    var s = ns(L.settings);
    el.w.value = s.width;
    el.h.value = s.height;
    el.padL.value = s.pad_l;
    el.padR.value = s.pad_r;
    el.padT.value = s.pad_t;
    el.padB.value = s.pad_b;
    el.cellW.value = s.cell_w;
    el.cellH.value = s.cell_h;
    el.spacingX.value = s.spacing_x;
    el.spacingY.value = s.spacing_y;
    el.startCorner.value = s.start_corner;
    el.startAxis.value = s.start_axis;
    el.childAlign.value = s.child_align;
    el.constraint.value = s.constraint;
    el.constraintCount.value = s.constraint_count;
    el.bg.value = L.bgColor || "#000000";
    el.bgAlpha.value = String(Math.round(getBgAlpha(L) * 100));
    syncChrome();
  }

  function writeForm() {
    writeCanvasSize();
    var L = lay();
    if (!L || isCanvas(L.id)) {
      syncChrome();
      return;
    }
    L.bgColor = el.bg.value || "#000000";
    L.bgAlpha = clamp01((+el.bgAlpha.value || 0) / 100);
    L.transparentBg = L.bgAlpha <= 0;

    var locked = isSizeLocked(L.id);
    var cur = ns(L.settings);
    L.settings = ns({
      width: locked ? cur.width : Math.max(1, +el.w.value || 1),
      height: locked ? cur.height : Math.max(1, +el.h.value || 1),
      pad_l: +el.padL.value || 0,
      pad_r: +el.padR.value || 0,
      pad_t: +el.padT.value || 0,
      pad_b: +el.padB.value || 0,
      cell_w: Math.max(1, +el.cellW.value || 1),
      cell_h: Math.max(1, +el.cellH.value || 1),
      spacing_x: +el.spacingX.value || 0,
      spacing_y: +el.spacingY.value || 0,
      start_corner: el.startCorner.value,
      start_axis: el.startAxis.value,
      child_align: el.childAlign.value,
      constraint: el.constraint.value,
      constraint_count: +el.constraintCount.value || 1,
    });
    syncCanvasChildFrame(L.id);
    if (!locked) {
      var pf = findParentFrame(L.id);
      if (pf) {
        pf.w = ns(L.settings).width;
        pf.h = ns(L.settings).height;
      }
    }
    syncChrome();
  }

  function expandAncestors(id) {
    var cur = layouts[id];
    while (cur && cur.parentId) {
      delete collapsed[cur.parentId];
      cur = layouts[cur.parentId];
    }
  }

  function selectLayout(id) {
    if (!layouts[id]) return;
    writeForm();
    activeId = id;
    selectedChild = -1;
    clearImageSel();
    expandAncestors(id);
    if (id !== canvasId && layouts[id].parentId) {
      var kids = layouts[layouts[id].parentId].children;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].type === "layout" && kids[i].refId === id) {
          previewSel = { parentId: layouts[id].parentId, index: i };
          break;
        }
      }
    } else {
      previewSel = { parentId: null, index: -1 };
    }
    readForm();
    refresh();
  }

  function selectChildNode(parentId, index, opts) {
    var parent = layouts[parentId];
    if (!parent || !parent.children[index]) return;
    writeForm();
    var ch = parent.children[index];
    if (ch.type === "layout" && layouts[ch.refId]) {
      selectLayout(ch.refId);
      return;
    }
    opts = opts || {};
    var toggle = !!opts.toggle;
    var range = !!opts.range;
    var primary = { parentId: parentId, index: index };

    if (range && imageSelAnchor && imageSelAnchor.parentId === parentId) {
      var ranged = imagesInSiblingRange(parentId, imageSelAnchor.index, index);
      if (toggle) {
        var merged = imageSel.slice();
        ranged.forEach(function (r) {
          if (!isImageSelected(r.parentId, r.index)) merged.push(r);
        });
        applyImageSel(merged, primary);
      } else {
        applyImageSel(ranged, primary);
      }
    } else if (toggle) {
      var next = imageSel.slice();
      if (isImageSelected(parentId, index)) {
        next = next.filter(function (r) {
          return !(r.parentId === parentId && r.index === index);
        });
        if (!next.length) {
          clearImageSel();
          selectedChild = -1;
          previewSel = { parentId: null, index: -1 };
          activeId = parentId;
          imageSelAnchor = null;
          readForm();
          refresh();
          return;
        }
        applyImageSel(next, next[next.length - 1]);
      } else {
        next.push(primary);
        applyImageSel(next, primary);
      }
      imageSelAnchor = primary;
    } else {
      applyImageSel([primary], primary);
      imageSelAnchor = primary;
    }

    readForm();
    refresh();
  }

  function draggedImageRefs() {
    if (!childDrag) return null;
    if (childDrag.refs && childDrag.refs.length) return childDrag.refs.slice();
    var parent = layouts[childDrag.parentId];
    var ch = parent && parent.children[childDrag.index];
    if (!ch || ch.type !== "image") return null;
    if (isImageSelected(childDrag.parentId, childDrag.index) && imageSel.length > 0) {
      return imageSel.slice();
    }
    return [{ parentId: childDrag.parentId, index: childDrag.index }];
  }

  function prepareImageFrameForParent(ch, toParentId, slot) {
    var entry = images[ch.refId];
    var im = entry && entry.img;
    var fw = (ch.frame && ch.frame.w) || (im && im.naturalWidth) || 200;
    var fh = (ch.frame && ch.frame.h) || (im && im.naturalHeight) || 160;
    if (isCanvas(toParentId)) {
      maxZ += 1;
      ch.frame = {
        x: 24 + slot * 28,
        y: 24 + slot * 28,
        w: fw,
        h: fh,
        z: maxZ,
      };
    } else {
      ch.frame = null;
    }
  }

  function moveImagesToLayout(refs, toParentId) {
    if (!toParentId || !layouts[toParentId]) return false;
    var to = layouts[toParentId];
    var ordered = [];
    var seen = {};
    (refs || []).forEach(function (r) {
      var p = layouts[r.parentId];
      var ch = p && p.children[r.index];
      if (!ch || ch.type !== "image") return;
      if (r.parentId === toParentId) return;
      // Slot identity — duplicates may share the same image refId.
      var key = r.parentId + ":" + r.index;
      if (seen[key]) return;
      seen[key] = true;
      ordered.push({ parentId: r.parentId, child: ch });
    });
    if (!ordered.length) return false;

    pushUndo();
    var touched = {};
    ordered.forEach(function (item) {
      var p = layouts[item.parentId];
      if (!p) return;
      var idx = p.children.indexOf(item.child);
      if (idx >= 0) p.children.splice(idx, 1);
      touched[item.parentId] = true;
    });
    Object.keys(touched).forEach(function (pid) {
      if (!isCanvas(pid) && layouts[pid]) reflow(layouts[pid]);
    });

    var startSlot = to.children.length;
    ordered.forEach(function (item, off) {
      prepareImageFrameForParent(item.child, toParentId, startSlot + off);
      to.children.push(item.child);
    });
    if (!isCanvas(toParentId)) reflow(to);

    var newSel = ordered.map(function (item) {
      return { parentId: toParentId, index: to.children.indexOf(item.child) };
    }).filter(function (r) { return r.index >= 0; });
    applyImageSel(newSel, newSel[newSel.length - 1] || null);
    imageSelAnchor = newSel.length ? newSel[newSel.length - 1] : null;
    readForm();
    refresh();

    var destName = to.name || t("layout");
    if (ordered.length === 1) status(t("imageMoved", { name: destName }), "ok");
    else status(t("imagesMoved", { n: ordered.length, name: destName }), "ok");
    requestAutoExport(true);
    return true;
  }

  function bindSiblingDrag(li, parentId, index) {
    li.draggable = true;
    li.ondragstart = function (e) {
      var parent = layouts[parentId];
      var ch = parent && parent.children[index];
      if (ch && ch.type === "image" && !isImageSelected(parentId, index)) {
        applyImageSel([{ parentId: parentId, index: index }], { parentId: parentId, index: index });
        imageSelAnchor = { parentId: parentId, index: index };
        renderTree();
        refreshPreview();
      }
      var refs = null;
      if (ch && ch.type === "image") {
        refs = (isImageSelected(parentId, index) && imageSel.length > 0)
          ? imageSel.slice()
          : [{ parentId: parentId, index: index }];
      }
      childDrag = { parentId: parentId, index: index, refs: refs };
      li.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", "grid-child"); } catch (err) { /* ignore */ }
      }
    };
    li.ondragend = function () {
      childDrag = null;
      li.classList.remove("dragging");
      clearDropHighlight();
    };
    li.ondragover = function (e) {
      if (!childDrag || childDrag.parentId !== parentId) return;
      e.preventDefault();
      li.classList.add("drag-over");
    };
      li.ondragleave = function () { li.classList.remove("drag-over"); };
      li.ondrop = function (e) {
        e.preventDefault();
        li.classList.remove("drag-over");
      if (!childDrag || childDrag.parentId !== parentId || childDrag.index === index) return;
      var parent = layouts[parentId];
      if (!parent) return;
      pushUndo();
      var moved = parent.children.splice(childDrag.index, 1)[0];
      parent.children.splice(index, 0, moved);
      if (moved && moved.type === "image") {
        applyImageSel([{ parentId: parentId, index: index }], { parentId: parentId, index: index });
        imageSelAnchor = { parentId: parentId, index: index };
      } else if (activeId === parentId) {
        selectedChild = index;
        if (previewSel.parentId === parentId) previewSel = { parentId: parentId, index: index };
      }
      if (isCanvas(parentId)) syncChildStackZ(parent);
      else reflow(parent);
      refresh();
      requestAutoExport(true);
    };
  }

  function beginRenameLayout(layoutId) {
    var L = layouts[layoutId];
    if (!L) return;
    var li = el.tree.querySelector('.tree-item.tree-layout[data-layout-id="' + layoutId + '"]');
    if (!li) return;
    var nameEl = li.querySelector(".name");
    if (!nameEl || li.querySelector(".tree-rename")) return;

    var done = false;
    var input = document.createElement("input");
    input.type = "text";
    input.className = "tree-rename";
    input.value = L.name;
    input.setAttribute("aria-label", t("renameAria"));

    function finish(commit) {
      if (done) return;
      done = true;
      var next = input.value.trim();
      if (commit && next && next !== L.name) {
        pushUndo();
        L.name = next;
        status(t("renamed"), "ok");
        renderTree();
        requestAutoExport(true);
        return;
      }
      li.draggable = true;
      renderTree();
    }

    li.draggable = false;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    input.onkeydown = function (e) {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    };
    input.onmousedown = function (e) { e.stopPropagation(); };
    input.onclick = function (e) { e.stopPropagation(); };
    input.onblur = function () { finish(true); };
  }

  var TREE_COLLAPSE_CHILD_THRESHOLD = 8;
  var treeThumbObserver = null;
  /** Last user scroll in #layoutTree — survives DOM rebuild / accidental scrollTop=0. */
  var treeScrollTop = 0;

  function ensureTreeThumbObserver() {
    if (treeThumbObserver || !el.tree || typeof IntersectionObserver !== "function") return;
    treeThumbObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var node = en.target;
          var url = node.getAttribute("data-thumb-url");
          if (url) {
            node.style.backgroundImage = "url(" + JSON.stringify(url) + ")";
            node.removeAttribute("data-thumb-url");
          }
          treeThumbObserver.unobserve(node);
        });
      },
      { root: el.tree, rootMargin: "80px 0px", threshold: 0.01 }
    );
  }

  function makeTreeThumb(entry) {
    var thumb = document.createElement("span");
    thumb.className = "tree-thumb";
    thumb.setAttribute("aria-hidden", "true");
    if (!entry || !entry.url) return thumb;
    // Defer bitmap work until the row is near the visible scrollport.
    if (typeof IntersectionObserver === "function") {
      thumb.setAttribute("data-thumb-url", entry.url);
    } else {
      thumb.style.backgroundImage = "url(" + JSON.stringify(entry.url) + ")";
    }
    return thumb;
  }

  function observeTreeThumbs(root) {
    if (!root) return;
    ensureTreeThumbObserver();
    if (!treeThumbObserver) return;
    var nodes = root.querySelectorAll
      ? root.querySelectorAll("[data-thumb-url]")
      : [];
    for (var i = 0; i < nodes.length; i++) treeThumbObserver.observe(nodes[i]);
  }

  function collapseHeavyLayout(layoutId) {
    var L = layouts[layoutId];
    if (!L || isCanvas(layoutId)) return;
    if ((L.children || []).length >= TREE_COLLAPSE_CHILD_THRESHOLD) {
      collapsed[layoutId] = true;
    }
  }

  function rememberTreeScroll() {
    if (el.tree) treeScrollTop = el.tree.scrollTop;
  }

  /** Restore prior scroll after rebuild. Do not chase the active row (collapse/expand must not jump). */
  function restoreTreeScroll(prevScroll) {
    if (!el.tree) return;
    // Force layout so scrollHeight is real before applying scrollTop (otherwise clamped to 0).
    void el.tree.offsetHeight;
    var max = Math.max(0, el.tree.scrollHeight - el.tree.clientHeight);
    el.tree.scrollTop = Math.max(0, Math.min(prevScroll, max));
    treeScrollTop = el.tree.scrollTop;
  }

  function renderTree() {
    rememberTreeScroll();
    var prevScroll = treeScrollTop;
    if (treeThumbObserver) {
      treeThumbObserver.disconnect();
      treeThumbObserver = null;
    }
    el.tree.replaceChildren();
    if (!canvasId || !layouts[canvasId]) return;

    var frag = document.createDocumentFragment();

    function appendChildren(parentId, depth) {
      var parent = layouts[parentId];
      if (!parent) return;
      childPaintOrder(parent).forEach(function (i) {
        var ch = parent.children[i];
        var li = document.createElement("li");
        var pad = document.createElement("span");
        pad.className = "tree-pad";
        pad.style.width = depth * 12 + "px";

        if (ch.type === "layout" && layouts[ch.refId]) {
          var L = layouts[ch.refId];
          var layActive = activeId === L.id && selectedChild < 0;
          var hasKids = L.children.length > 0;
          var isClosed = !!collapsed[L.id];
          var layVisible = isLayoutVisible(L.id);
          li.className = "tree-item tree-layout" + (layActive ? " active" : "") +
            (isClosed ? " collapsed" : "") +
            (layVisible ? "" : " is-hidden");
          li.dataset.layoutId = L.id;

          var twist = document.createElement("button");
          twist.type = "button";
          twist.className = "tree-twist" + (hasKids ? "" : " empty");
          twist.title = hasKids ? (isClosed ? t("expand") : t("collapse")) : "";
          twist.textContent = hasKids ? (isClosed ? "▶" : "▼") : "·";
          twist.disabled = !hasKids;
          twist.onclick = function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (!hasKids) return;
            if (collapsed[L.id]) delete collapsed[L.id];
            else collapsed[L.id] = true;
            renderTree();
          };

          var eye = document.createElement("button");
          eye.type = "button";
          eye.className = "tree-vis" + (layVisible ? "" : " is-off");
          eye.title = layVisible ? t("layoutHide") : t("layoutShow");
          eye.setAttribute("aria-label", eye.title);
          eye.setAttribute("aria-pressed", layVisible ? "true" : "false");
          var eyeImg = document.createElement("img");
          eyeImg.src = layVisible ? "icons/eye.svg" : "icons/eye-off.svg";
          eyeImg.alt = "";
          eyeImg.width = 16;
          eyeImg.height = 16;
          eyeImg.draggable = false;
          eye.appendChild(eyeImg);
          eye.onclick = function (e) {
            e.preventDefault();
            e.stopPropagation();
            pushUndo();
            setLayoutVisible(L.id, !isLayoutVisible(L.id));
            refresh();
            requestAutoExport(false);
          };

          var nm = document.createElement("div");
          nm.className = "name";
          nm.textContent = "▦ " + L.name;
          nm.title = t("renameHint");
          // First click re-renders the tree, so native dblclick never fires.
          // Detect a second click on the same layout within the threshold instead.
          nm.onclick = function (e) {
            e.preventDefault();
            e.stopPropagation();
            var now = Date.now();
            if (renameClick && renameClick.id === L.id && now - renameClick.t < 400) {
              renameClick = null;
              if (!(activeId === L.id && selectedChild < 0)) selectLayout(L.id);
              beginRenameLayout(L.id);
              return;
            }
            renameClick = { id: L.id, t: now };
            // Avoid re-render when already selected so the second click can hit the same node
            if (!(activeId === L.id && selectedChild < 0)) selectLayout(L.id);
          };

          var meta = document.createElement("div");
          meta.className = "muted";
          meta.textContent = String(L.children.length);

          li.append(pad, twist, eye, nm, meta);
          li.onclick = function () {
            renameClick = null;
            selectLayout(L.id);
          };
          bindSiblingDrag(li, parentId, i);
          frag.appendChild(li);
          if (!isClosed) appendChildren(L.id, depth + 1);
          return;
        }

        if (ch.type === "image") {
          var imgActive = isImageSelected(parentId, i);
          var entry = images[ch.refId];
          li.className = "tree-item tree-image" +
            (showTreeThumbs ? "" : " no-thumb") +
            (imgActive ? " active" : "");

          var spacer = document.createElement("span");
          spacer.className = "tree-twist empty";
          spacer.textContent = "·";

          var inm = document.createElement("div");
          inm.className = "name";
          inm.textContent = entry ? entry.name : t("imageFallback");
          if (showTreeThumbs) li.append(pad, spacer, makeTreeThumb(entry), inm);
          else li.append(pad, spacer, inm);
          li.onclick = function (e) {
            selectChildNode(parentId, i, {
              toggle: e.ctrlKey || e.metaKey,
              range: e.shiftKey,
            });
          };
          bindSiblingDrag(li, parentId, i);
          frag.appendChild(li);
        }
      });
    }

    appendChildren(canvasId, 0);
    el.tree.appendChild(frag);
    observeTreeThumbs(el.tree);
    restoreTreeScroll(prevScroll);
  }

  function paint(container, layoutId, depth, highlightId) {
    var L = layouts[layoutId];
    if (!L || depth > 20) return;
    ensureFrames(L);
    var s = ns(L.settings);
    container.dataset.layoutId = layoutId;
    container.style.width = s.width + "px";
    container.style.height = s.height + "px";
    container.style.background = layoutBgCss(L);
    container.replaceChildren();

    childPaintOrder(L).forEach(function (i) {
      var ch = L.children[i];
      var f = ch.frame;
      if (ch.type === "layout" && ch.refId && !isLayoutVisible(ch.refId)) return;
      var interactive = isInteractiveChild(layoutId, ch);
      var cell = document.createElement("div");
      cell.className = "grid-cell" + (interactive ? " interactive" : "");
      cell.dataset.parentId = layoutId;
      cell.dataset.childIndex = String(i);
      var stackZ = isCanvas(layoutId) ? (f.z || i + 1) : (i + 1);
      cell.style.cssText =
        "left:" + f.x + "px;top:" + f.y + "px;width:" + f.w + "px;height:" + f.h + "px;z-index:" + stackZ;
      if (ch.type === "layout" && ch.refId === highlightId) cell.classList.add("highlight-nested");
      var selected = (ch.type === "image" && isImageSelected(layoutId, i)) ||
        (previewSel.parentId === layoutId && previewSel.index === i);
      var primary = previewSel.parentId === layoutId && previewSel.index === i;
      if (selected) {
        cell.classList.add("selected");
        if (ch.type === "image" && !isCanvas(layoutId)) {
          cell.classList.add("selected-nested-image");
        }
        if (interactive && primary) {
        ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach(function (h) {
          var d = document.createElement("div");
          d.className = "resize-handle " + h;
          d.dataset.handle = h;
          cell.appendChild(d);
        });
        }
      }
      if (ch.type === "image" && images[ch.refId] && images[ch.refId].img) {
        var img = document.createElement("img");
        img.src = images[ch.refId].url;
        img.decoding = "async";
        img.draggable = false;
        img.style.cssText = "left:0;top:0;width:100%;height:100%;object-fit:fill";
        cell.appendChild(img);
      } else if (ch.type === "layout" && layouts[ch.refId]) {
        var nestedLay = layouts[ch.refId];
        nestedLay.settings.width = f.w;
        nestedLay.settings.height = f.h;
        var nested = document.createElement("div");
        nested.className = "nested-stage";
        nested.style.width = f.w + "px";
        nested.style.height = f.h + "px";
        cell.appendChild(nested);
        paint(nested, ch.refId, depth + 1, highlightId);
      }
      if (interactive) {
        if (ch.type === "image" && isCanvas(layoutId) && selected && f) {
          var sizeLab = document.createElement("span");
          sizeLab.className = "grid-cell-size";
          sizeLab.textContent = Math.round(f.w) + "×" + Math.round(f.h);
          cell.appendChild(sizeLab);
        } else {
        var lab = document.createElement("span");
        lab.className = "grid-cell-label";
        lab.textContent = String(i + 1) + (ch.type === "layout" ? " #" : "");
        cell.appendChild(lab);
        }
      }
      container.appendChild(cell);
    });
  }

  function draw(ctx, layoutId, ox, oy, depth) {
    var L = layouts[layoutId];
    if (!L || depth > 20) return;
    ensureFrames(L);
    var s = ns(L.settings);
    var fill = layoutBgFillStyle(L);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(ox, oy, s.width, s.height);
    }
    childPaintOrder(L).forEach(function (i) {
      var ch = L.children[i];
      var f = ch.frame;
      if (ch.type === "layout" && ch.refId && !isLayoutVisible(ch.refId)) return;
      var x = ox + f.x;
      var y = oy + f.y;
      if (ch.type === "image" && images[ch.refId] && images[ch.refId].img) {
        ctx.drawImage(images[ch.refId].img, x, y, f.w, f.h);
      } else if (ch.type === "layout" && layouts[ch.refId]) {
        layouts[ch.refId].settings.width = f.w;
        layouts[ch.refId].settings.height = f.h;
        draw(ctx, ch.refId, x, y, depth + 1);
      }
    });
  }

  function stageElFor(layoutId) {
    if (layoutId === canvasId) return el.stage;
    return el.stage.querySelector('.nested-stage[data-layout-id="' + layoutId + '"]') || el.stage;
  }

  function measureLocal(layoutId) {
    var stage = stageElFor(layoutId);
    var r = stage.getBoundingClientRect();
    var s = ns(layouts[layoutId].settings);
    return {
      left: r.left,
      top: r.top,
      sx: s.width / Math.max(1, r.width),
      sy: s.height / Math.max(1, r.height),
    };
  }

  function toLocal(clientX, clientY, layoutId) {
    var m = drag && drag.local && drag.layoutId === layoutId
      ? drag.local
      : measureLocal(layoutId);
    return {
      x: (clientX - m.left) * m.sx,
      y: (clientY - m.top) * m.sy,
    };
  }

  function applyZoom() {
    // zoom=1 → canvas fully visible (fit). Do not allow smaller than that.
    zoom = Math.min(8, Math.max(1, zoom));
    var s = ns(layouts[canvasId].settings);
    var fit = Math.min(1, el.wrap.clientWidth / s.width, el.wrap.clientHeight / s.height) || 1;
    var sc = fit * zoom;
    el.shell.style.width = s.width * sc + "px";
    el.shell.style.height = s.height * sc + "px";
    el.stage.style.width = s.width + "px";
    el.stage.style.height = s.height + "px";
    el.stage.style.transform = "scale(" + sc + ")";
    el.zoomLabel.textContent = Math.round(zoom * 100) + "%";
    var editName = activeId !== canvasId && layouts[activeId] ? layouts[activeId].name : t("canvas");
    var meta = t("metaLine", { w: s.width, h: s.height, edit: editName });
    var imgFr = getSelectedCanvasImageFrame();
    if (imgFr) {
      meta += " · " + t("imagePxSize", { w: Math.round(imgFr.w), h: Math.round(imgFr.h) });
    }
    el.meta.textContent = meta;
    if ($("zoomOutBtn")) $("zoomOutBtn").disabled = zoom <= 1;
  }

  var refreshRaf = 0;
  var refreshWantFull = false;
  var dragRaf = 0;

  /** Move/resize one cell in place — no full preview rebuild (avoids tree layout thrash). */
  function updateDragVisual() {
    if (!drag || !drag.cell || !drag.cell.isConnected) return;
    var L = layouts[drag.layoutId];
    var ch = L && L.children[drag.index];
    if (!ch || !ch.frame) return;
    var f = ch.frame;
    var cell = drag.cell;
    cell.style.left = f.x + "px";
    cell.style.top = f.y + "px";
    cell.style.width = f.w + "px";
    cell.style.height = f.h + "px";
    if (f.z != null) cell.style.zIndex = String(f.z);

    if (ch.type === "layout" && layouts[ch.refId]) {
      var nested = null;
      for (var ni = 0; ni < cell.children.length; ni++) {
        if (cell.children[ni].classList.contains("nested-stage")) {
          nested = cell.children[ni];
          break;
        }
      }
      if (nested) {
        var o = drag.orig;
        if (drag.proportionalCells && drag.mode === "resize" && o) {
          // Live preview: CSS scale of original content (no grid reflow while dragging).
          var rw = f.w / Math.max(1, o.w);
          var rh = f.h / Math.max(1, o.h);
          nested.style.width = o.w + "px";
          nested.style.height = o.h + "px";
          nested.style.transformOrigin = "0 0";
          nested.style.transform = "scale(" + rw + ", " + rh + ")";
          cell.style.overflow = "hidden";
          if (drag.repaintNested) {
            paint(nested, ch.refId, 1, activeId !== canvasId ? activeId : null);
            drag.repaintNested = false;
          }
        } else {
          nested.style.transform = "";
          nested.style.transformOrigin = "";
          nested.style.width = f.w + "px";
          nested.style.height = f.h + "px";
          cell.style.overflow = "";
          if (drag.repaintNested) {
            paint(nested, ch.refId, 1, activeId !== canvasId ? activeId : null);
            drag.repaintNested = false;
          }
        }
      }
    }

    var sizeLab = null;
    for (var si = 0; si < cell.children.length; si++) {
      if (cell.children[si].classList.contains("grid-cell-size")) {
        sizeLab = cell.children[si];
        break;
      }
    }
    if (sizeLab) sizeLab.textContent = Math.round(f.w) + "×" + Math.round(f.h);
  }

  function scheduleDragVisual() {
    if (dragRaf) return;
    dragRaf = requestAnimationFrame(function () {
      dragRaf = 0;
      if (!drag) return;
      if (!drag.cell || !drag.cell.isConnected) {
        // Fallback if the cell node was detached — rare, keep editing usable.
        paint(el.stage, canvasId, 0, activeId !== canvasId ? activeId : null);
        drag.cell = el.stage.querySelector(
          '.grid-cell.interactive[data-parent-id="' + drag.layoutId +
          '"][data-child-index="' + drag.index + '"]'
        );
        drag.local = measureLocal(drag.layoutId);
        return;
      }
      updateDragVisual();
    });
  }

  function refreshPreviewNow() {
    if (drag) {
      updateDragVisual();
      return;
    }
    writeForm();
    paint(el.stage, canvasId, 0, activeId !== canvasId ? activeId : null);
    applyZoom();
    syncChrome();
  }

  function refreshNow() {
    renderTree();
    refreshPreviewNow();
  }

  /** Coalesce bursty UI updates (drag / duplicate / import) into one frame. */
  function scheduleRefresh(full) {
    if (full) refreshWantFull = true;
    if (refreshRaf) return;
    refreshRaf = requestAnimationFrame(function () {
      refreshRaf = 0;
      var fullPass = refreshWantFull;
      refreshWantFull = false;
      if (fullPass) refreshNow();
      else refreshPreviewNow();
    });
  }

  function refreshPreview() {
    if (drag) {
      scheduleDragVisual();
      return;
    }
    scheduleRefresh(false);
  }

  function refresh() {
    scheduleRefresh(true);
  }

  /** Deepest layout under a client point in the preview (for file drops). */
  function layoutIdAtClient(clientX, clientY) {
    var node = document.elementFromPoint(clientX, clientY);
    if (!node || !el.wrap.contains(node)) return null;
    if (!el.stage.contains(node) && node !== el.stage) return canvasId;
    var cell = node.closest && node.closest(".grid-cell");
    if (cell && el.stage.contains(cell)) {
      var parentId = cell.dataset.parentId;
      var idx = +cell.dataset.childIndex;
      var parent = layouts[parentId];
      var ch = parent && parent.children[idx];
      if (ch && ch.type === "layout" && layouts[ch.refId]) return ch.refId;
      if (ch) return parentId;
    }
    var host = node.closest && node.closest("[data-layout-id]");
    if (host && host.dataset.layoutId && layouts[host.dataset.layoutId]) {
      return host.dataset.layoutId;
    }
    return canvasId;
  }

  function dropTargetNode(layoutId) {
    if (!layoutId || !layouts[layoutId]) return null;
    if (layoutId === canvasId) return el.stage;
    var nested = el.stage.querySelector('.nested-stage[data-layout-id="' + layoutId + '"]');
    if (nested) {
      var parentCell = nested.parentElement;
      if (parentCell && parentCell.classList.contains("grid-cell")) return parentCell;
      return nested;
    }
    var cells = el.stage.querySelectorAll(".grid-cell");
    for (var i = 0; i < cells.length; i++) {
      var pid = cells[i].dataset.parentId;
      var idx = +cells[i].dataset.childIndex;
      var ch = layouts[pid] && layouts[pid].children[idx];
      if (ch && ch.type === "layout" && ch.refId === layoutId) return cells[i];
    }
    return null;
  }

  var dropHighlightId = null;

  function clearDropHighlight() {
    dropHighlightId = null;
    el.stage.classList.remove("drop-target");
    el.stage.querySelectorAll(".drop-target").forEach(function (n) {
      n.classList.remove("drop-target");
    });
  }

  function setDropHighlight(layoutId) {
    if (layoutId === dropHighlightId) return;
    clearDropHighlight();
    if (!layoutId) return;
    var node = dropTargetNode(layoutId);
    if (!node) return;
    dropHighlightId = layoutId;
    node.classList.add("drop-target");
  }

  function addFiles(list, targetLayoutId) {
    var files = [].slice.call(list || []).filter(function (f) {
      return f.type && f.type.indexOf("image/") === 0;
    });
    if (!files.length) return status(t("errImageOnly"), "err");
    writeForm();
    var L = (targetLayoutId && layouts[targetLayoutId]) || lay();
    if (!L) return status(t("errSelectLayout"), "err");

    pushUndo();
    var chain = Promise.resolve();
    var added = [];
    files.forEach(function (file) {
      chain = chain.then(function () {
        return new Promise(function (resolve, reject) {
          var url = URL.createObjectURL(file);
          var img = new Image();
          img.onload = function () {
            var id = uid("img");
            images[id] = { id: id, name: file.name, url: url, file: file, img: img };
            added.push(id);
            resolve();
          };
          img.onerror = function () { reject(new Error(t("errImageLoad"))); };
          img.src = url;
        });
      });
    });
    chain.then(function () {
      if (!added.length) {
        if (undoStack.length) undoStack.pop();
        return;
      }
      var start = L.children.length;
      if (isCanvas(L.id)) {
        added.forEach(function (id, off) {
          var im = images[id].img;
          var i = start + off;
          var ch = {
            type: "image",
            refId: id,
            frame: {
              x: 24 + i * 28,
              y: 24 + i * 28,
              w: im.naturalWidth || 200,
              h: im.naturalHeight || 160,
              z: i + 1,
            },
          };
          if (ch.frame.z > maxZ) maxZ = ch.frame.z;
          L.children.push(ch);
        });
      } else {
        added.forEach(function (id) {
          L.children.push({ type: "image", refId: id, frame: null });
        });
        reflow(L);
      }
      if (targetLayoutId) selectLayout(L.id);
      else refresh();
      status(t("imagesAdded", { n: files.length, name: L.name || t("layout") }), "ok");
      requestAutoExport(true);
    }).catch(function (e) {
      if (undoStack.length) undoStack.pop();
      status(String(e.message || e), "err");
    });
  }

  function supportsFolderWatch() {
    return typeof window.showDirectoryPicker === "function";
  }

  function folderFileKey(ruleId, file) {
    // Name scoped by rule: size/mtime change while a file is still being written,
    // which previously caused the same image to be imported twice.
    return String(ruleId || "") + "|" + file.name;
  }

  function normalizeFolderSeen(raw) {
    var out = {};
    Object.keys(raw || {}).forEach(function (k) {
      var key = String(k);
      if (!key) return;
      // Legacy unscoped name → keep as-is until migrated against a rule id.
      out[key] = true;
    });
    return out;
  }

  function newFolderWatchRuleId() {
    return uid("fw");
  }

  function cloneFolderWatchRules(rules) {
    return (rules || []).map(function (r) {
      return {
        id: r.id || newFolderWatchRuleId(),
        folderName: r.folderName || "",
        targetLayoutId: r.targetLayoutId || null,
        handle: r.handle || null,
      };
    });
  }

  function activeFolderWatchRules(src) {
    return (src || []).filter(function (r) { return !!(r && r.handle); });
  }

  function loadFolderWatchSettings() {
    try {
      var raw = localStorage.getItem(FOLDER_WATCH_LS);
      if (raw) {
        var parsed = JSON.parse(raw);
        folderWatch.enabled = !!parsed.enabled;
        if (Array.isArray(parsed.rules)) {
          folderWatch.rules = parsed.rules.map(function (r) {
            return {
              id: r.id || newFolderWatchRuleId(),
              folderName: r.folderName || "",
              targetLayoutId: r.targetLayoutId || null,
              handle: null,
            };
          });
        } else if (parsed.folderName || parsed.targetLayoutId) {
          // Migrate single-folder settings.
          folderWatch.rules = [{
            id: newFolderWatchRuleId(),
            folderName: parsed.folderName || "",
            targetLayoutId: parsed.targetLayoutId || null,
            handle: null,
          }];
        } else {
          folderWatch.rules = [];
        }
      } else {
        folderWatch.enabled = false;
        folderWatch.rules = [];
      }
    } catch (e) {
      folderWatch.enabled = false;
      folderWatch.rules = [];
    }
    try {
      var seen = localStorage.getItem(FOLDER_SEEN_LS);
      folderSeenKeys = normalizeFolderSeen(seen ? JSON.parse(seen) : {});
    } catch (e2) {
      folderSeenKeys = {};
    }
  }

  function persistFolderWatchSettings() {
    try {
      localStorage.setItem(FOLDER_WATCH_LS, JSON.stringify({
        enabled: !!folderWatch.enabled,
        rules: folderWatch.rules.map(function (r) {
          return {
            id: r.id,
            folderName: r.folderName || "",
            targetLayoutId: r.targetLayoutId || null,
          };
        }),
      }));
    } catch (e) { /* ignore */ }
  }

  function persistFolderSeen() {
    try {
      localStorage.setItem(FOLDER_SEEN_LS, JSON.stringify(folderSeenKeys));
    } catch (e) { /* ignore */ }
  }

  function persistFolderHandles() {
    var map = {};
    folderWatch.rules.forEach(function (r) {
      if (r.id && r.handle) map[r.id] = r.handle;
    });
    return idb("put", FOLDER_HANDLES_IDB, map).catch(function () { return null; })
      .then(function () { return idb("del", FOLDER_HANDLE_IDB_LEGACY).catch(function () { return null; }); });
  }

  function resolveFolderWatchTargetId(rule) {
    var id = rule && rule.targetLayoutId;
    if (id && layouts[id]) return id;
    return canvasId;
  }

  function listLayoutOptionsForWatch() {
    var out = [];
    function walk(id, depth) {
      var L = layouts[id];
      if (!L) return;
      var pad = "";
      for (var i = 0; i < depth; i++) pad += "· ";
      out.push({ id: id, label: pad + (isCanvas(id) ? t("canvas") : (L.name || t("layout"))) });
      (L.children || []).forEach(function (ch) {
        if (ch.type === "layout" && ch.refId) walk(ch.refId, depth + 1);
      });
    }
    if (canvasId) walk(canvasId, 0);
    return out;
  }

  function fillFolderWatchTargetSelect(sel, selectedId) {
    if (!sel) return;
    var opts = listLayoutOptionsForWatch();
    sel.replaceChildren();
    opts.forEach(function (o) {
      var option = document.createElement("option");
      option.value = o.id;
      option.textContent = o.label;
      sel.appendChild(option);
    });
    if (selectedId && layouts[selectedId]) sel.value = selectedId;
    else if (canvasId) sel.value = canvasId;
  }

  function updateFolderWatchBtn() {
    var on = !!(folderWatch.enabled && activeFolderWatchRules(folderWatch.rules).length);
    var addBtn = $("addMenuBtn");
    if (addBtn) {
      addBtn.classList.toggle("folder-watch-on", on);
      addBtn.title = on ? t("folderWatchOn") : "";
    }
    var item = $("folderWatchMenuBtn");
    if (!item) return;
    item.classList.toggle("active", on);
    item.title = on ? t("folderWatchOn") : t("folderWatchTitle");
    item.textContent = on ? t("folderWatchMenuOn") : t("folderWatch");
    if (on) item.removeAttribute("data-i18n");
    else item.setAttribute("data-i18n", "folderWatch");
  }

  function findDraftRule(ruleId) {
    for (var i = 0; i < folderModalDraft.rules.length; i++) {
      if (folderModalDraft.rules[i].id === ruleId) return folderModalDraft.rules[i];
    }
    return null;
  }

  function renderFolderWatchRuleList() {
    var list = $("folderWatchRuleList");
    if (!list) return;
    list.replaceChildren();
    if (!folderModalDraft.rules.length) {
      var empty = document.createElement("p");
      empty.className = "folder-watch-empty";
      empty.setAttribute("data-i18n", "folderWatchEmpty");
      empty.textContent = t("folderWatchEmpty");
      list.appendChild(empty);
      return;
    }
    var canPick = supportsFolderWatch();
    folderModalDraft.rules.forEach(function (rule) {
      var li = document.createElement("li");
      li.className = "folder-watch-rule";
      li.dataset.ruleId = rule.id;

      var main = document.createElement("div");
      main.className = "folder-watch-rule-main";

      var folderRow = document.createElement("div");
      folderRow.className = "folder-watch-rule-folder";

      var pickBtn = document.createElement("button");
      pickBtn.type = "button";
      pickBtn.setAttribute("data-fw-action", "pick");
      pickBtn.setAttribute("data-rule-id", rule.id);
      pickBtn.setAttribute("data-i18n", "folderWatchPick");
      pickBtn.textContent = t("folderWatchPick");
      pickBtn.disabled = !canPick;

      var clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.setAttribute("data-fw-action", "clear");
      clearBtn.setAttribute("data-rule-id", rule.id);
      clearBtn.setAttribute("data-i18n", "folderWatchClear");
      clearBtn.textContent = t("folderWatchClear");

      var path = document.createElement("p");
      path.className = "muted modal-path";
      if (rule.folderName) {
        path.textContent = rule.folderName;
      } else {
        path.setAttribute("data-i18n", "folderWatchNoFolder");
        path.textContent = t("folderWatchNoFolder");
      }

      folderRow.append(pickBtn, clearBtn, path);

      var targetLab = document.createElement("label");
      targetLab.setAttribute("data-i18n", "folderWatchTarget");
      targetLab.textContent = t("folderWatchTarget");

      var sel = document.createElement("select");
      sel.setAttribute("data-fw-action", "target");
      sel.setAttribute("data-rule-id", rule.id);
      fillFolderWatchTargetSelect(sel, rule.targetLayoutId || canvasId);

      main.append(folderRow, targetLab, sel);

      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "danger folder-watch-rule-remove";
      removeBtn.setAttribute("data-fw-action", "remove");
      removeBtn.setAttribute("data-rule-id", rule.id);
      removeBtn.setAttribute("data-i18n-title", "folderWatchRemoveRule");
      removeBtn.title = t("folderWatchRemoveRule");
      removeBtn.textContent = "−";

      li.append(main, removeBtn);
      list.appendChild(li);
    });
  }

  function addFolderWatchDraftRule() {
    folderModalDraft.rules.push({
      id: newFolderWatchRuleId(),
      folderName: "",
      targetLayoutId: canvasId,
      handle: null,
    });
    renderFolderWatchRuleList();
  }

  function removeFolderWatchDraftRule(ruleId) {
    folderModalDraft.rules = folderModalDraft.rules.filter(function (r) {
      return r.id !== ruleId;
    });
    renderFolderWatchRuleList();
  }

  function stopFolderWatch() {
    if (folderPollTimer) {
      clearInterval(folderPollTimer);
      folderPollTimer = null;
    }
    if (folderScanDebounce) {
      clearTimeout(folderScanDebounce);
      folderScanDebounce = null;
    }
    if (folderObserver && folderObserver.disconnect) {
      try { folderObserver.disconnect(); } catch (e) { /* ignore */ }
    }
    folderObserver = null;
    folderPendingStable = {};
  }

  function scheduleFolderScan() {
    if (folderScanDebounce) clearTimeout(folderScanDebounce);
    folderScanDebounce = setTimeout(function () {
      folderScanDebounce = null;
      scanWatchFolder();
    }, 200);
  }

  function ensureFolderReadPermission(handle, allowRequest) {
    if (!handle || !handle.queryPermission) return Promise.resolve(false);
    return handle.queryPermission({ mode: "read" }).then(function (st) {
      if (st === "granted") return true;
      if (!allowRequest || !handle.requestPermission) return false;
      return handle.requestPermission({ mode: "read" }).then(function (n) {
        return n === "granted";
      }).catch(function () { return false; });
    }).catch(function () { return false; });
  }

  function iterateFolderImageFiles(handle, onFile) {
    if (!handle || !handle.values) return Promise.resolve();
    var it = handle.values();
    function next() {
      return it.next().then(function (res) {
        if (res.done) return;
        var entry = res.value;
        if (!entry || entry.kind !== "file") return next();
        return entry.getFile().then(function (file) {
          if (file && file.type && file.type.indexOf("image/") === 0) onFile(file);
          return next();
        }).catch(function () { return next(); });
      });
    }
    return next();
  }

  function seedFolderSeenFromHandle(ruleId, handle) {
    return iterateFolderImageFiles(handle, function (file) {
      folderSeenKeys[folderFileKey(ruleId, file)] = true;
    }).then(function () {
      persistFolderSeen();
    });
  }

  function migrateLegacySeenKeysForRule(ruleId) {
    if (!ruleId) return;
    Object.keys(folderSeenKeys).forEach(function (k) {
      if (k.indexOf("|") >= 0) return;
      folderSeenKeys[ruleId + "|" + k] = true;
      delete folderSeenKeys[k];
    });
    persistFolderSeen();
  }

  function scanOneWatchRule(rule) {
    if (!rule || !rule.handle) return Promise.resolve();
    return ensureFolderReadPermission(rule.handle, false).then(function (ok) {
      if (!ok) return;
      var fresh = [];
      var alive = {};
      return iterateFolderImageFiles(rule.handle, function (file) {
        var key = folderFileKey(rule.id, file);
        alive[key] = true;
        if (folderSeenKeys[key]) return;

        var prev = folderPendingStable[key];
        if (!prev || prev.size !== file.size || prev.lastModified !== file.lastModified) {
          folderPendingStable[key] = {
            size: file.size,
            lastModified: file.lastModified,
            hits: 1,
            file: file,
          };
          return;
        }
        prev.hits += 1;
        prev.file = file;
        if (prev.hits < 2) return;

        folderSeenKeys[key] = true;
        delete folderPendingStable[key];
        fresh.push(file);
      }).then(function () {
        Object.keys(folderPendingStable).forEach(function (k) {
          if (k.indexOf(String(rule.id) + "|") === 0 && !alive[k]) delete folderPendingStable[k];
        });
        if (!fresh.length) return;
        persistFolderSeen();
        addFiles(fresh, resolveFolderWatchTargetId(rule));
      });
    });
  }

  function scanWatchFolder() {
    if (!folderWatch.enabled || !canvasId || folderScanBusy) return;
    var rules = activeFolderWatchRules(folderWatch.rules);
    if (!rules.length) return;
    folderScanBusy = true;
    var chain = Promise.resolve();
    rules.forEach(function (rule) {
      chain = chain.then(function () { return scanOneWatchRule(rule); });
    });
    chain.catch(function () { /* ignore scan errors */ }).then(function () {
      folderScanBusy = false;
    });
  }

  function startFolderWatch() {
    stopFolderWatch();
    var rules = activeFolderWatchRules(folderWatch.rules);
    if (!folderWatch.enabled || !rules.length) {
      updateFolderWatchBtn();
      return;
    }
    updateFolderWatchBtn();
    if (typeof FileSystemObserver === "function") {
      try {
        folderObserver = new FileSystemObserver(function () {
          scheduleFolderScan();
        });
        rules.forEach(function (rule) {
          try { folderObserver.observe(rule.handle, { recursive: false }); } catch (eObs) { /* ignore */ }
        });
      } catch (e) {
        folderObserver = null;
      }
    }
    folderPollTimer = setInterval(scheduleFolderScan, FOLDER_POLL_MS);
    scheduleFolderScan();
  }

  function openFolderWatchModal() {
    var modal = $("folderWatchModal");
    if (!modal) return;
    folderModalDraft.enabled = !!folderWatch.enabled;
    folderModalDraft.rules = cloneFolderWatchRules(folderWatch.rules);
    if (!folderModalDraft.rules.length) {
      folderModalDraft.rules.push({
        id: newFolderWatchRuleId(),
        folderName: "",
        targetLayoutId: canvasId,
        handle: null,
      });
    }

    var en = $("folderWatchEnabled");
    if (en) en.checked = folderModalDraft.enabled;
    renderFolderWatchRuleList();

    var hint = $("folderWatchSupportHint");
    if (hint) {
      if (!supportsFolderWatch()) {
        hint.hidden = false;
        hint.setAttribute("data-i18n", "folderWatchUnsupported");
        hint.textContent = t("folderWatchUnsupported");
      } else {
        hint.hidden = true;
        hint.textContent = "";
      }
    }

    modal.hidden = false;
  }

  function closeFolderWatchModal() {
    var modal = $("folderWatchModal");
    if (modal) modal.hidden = true;
  }

  function saveFolderWatchModal() {
    var en = $("folderWatchEnabled");
    var wantEnable = !!(en && en.checked);
    var draftRules = cloneFolderWatchRules(folderModalDraft.rules);
    var ready = activeFolderWatchRules(draftRules);

    if (wantEnable && !ready.length) {
      status(t("folderWatchNeedFolder"), "err");
      return;
    }
    if (wantEnable && !supportsFolderWatch()) {
      status(t("folderWatchUnsupported"), "err");
      return;
    }

    var prevHandleById = {};
    folderWatch.rules.forEach(function (r) {
      prevHandleById[r.id] = r.handle || null;
    });

    folderWatch.rules = draftRules.map(function (r) {
      return {
        id: r.id,
        folderName: r.handle ? (r.handle.name || r.folderName || "") : (r.folderName || ""),
        targetLayoutId: r.targetLayoutId && layouts[r.targetLayoutId] ? r.targetLayoutId : canvasId,
        handle: r.handle || null,
      };
    });
    folderWatch.enabled = wantEnable && !!activeFolderWatchRules(folderWatch.rules).length;
    persistFolderWatchSettings();

    var seedChain = Promise.resolve();
    folderWatch.rules.forEach(function (rule) {
      if (!rule.handle) return;
      var prevHandle = prevHandleById[rule.id] || null;
      var folderChanged = rule.handle !== prevHandle;
      var hasSeen = Object.keys(folderSeenKeys).some(function (k) {
        return k.indexOf(String(rule.id) + "|") === 0;
      });
      if (folderChanged || !hasSeen) {
        if (folderChanged) {
          Object.keys(folderSeenKeys).forEach(function (k) {
            if (k.indexOf(String(rule.id) + "|") === 0) delete folderSeenKeys[k];
          });
        }
        seedChain = seedChain.then(function () {
          return seedFolderSeenFromHandle(rule.id, rule.handle);
        });
      }
    });
    Object.keys(folderSeenKeys).forEach(function (k) {
      var sep = k.indexOf("|");
      if (sep < 0) return;
      var rid = k.slice(0, sep);
      var still = folderWatch.rules.some(function (r) { return r.id === rid; });
      if (!still) delete folderSeenKeys[k];
    });
    persistFolderSeen();

    seedChain.then(function () {
      return persistFolderHandles();
    }).then(function () {
      if (folderWatch.enabled) startFolderWatch();
      else stopFolderWatch();
      updateFolderWatchBtn();
      closeFolderWatchModal();
      status(t("folderWatchSaved"), "ok");
    });
  }

  function pickWatchFolderForRule(ruleId) {
    if (!supportsFolderWatch()) {
      status(t("folderWatchUnsupported"), "err");
      return;
    }
    var rule = findDraftRule(ruleId);
    if (!rule) return;
    window.showDirectoryPicker({ mode: "read" }).then(function (handle) {
      rule.handle = handle;
      rule.folderName = handle.name || "";
      renderFolderWatchRuleList();
    }).catch(function (e) {
      if (!e || e.name !== "AbortError") status(String((e && e.message) || e), "err");
    });
  }

  function clearWatchFolderForRule(ruleId) {
    var rule = findDraftRule(ruleId);
    if (!rule) return;
    rule.handle = null;
    rule.folderName = "";
    renderFolderWatchRuleList();
  }

  function restoreFolderWatchOnBoot() {
    loadFolderWatchSettings();
    updateFolderWatchBtn();
    if (!supportsFolderWatch()) return;

    idb("get", FOLDER_HANDLES_IDB).then(function (map) {
      map = map || {};
      return idb("get", FOLDER_HANDLE_IDB_LEGACY).then(function (legacy) {
        if (legacy && folderWatch.rules.length === 1 && !folderWatch.rules[0].handle) {
          folderWatch.rules[0].handle = legacy;
          if (!folderWatch.rules[0].folderName) {
            folderWatch.rules[0].folderName = legacy.name || "";
          }
          migrateLegacySeenKeysForRule(folderWatch.rules[0].id);
        }
        folderWatch.rules.forEach(function (rule) {
          if (map[rule.id]) {
            rule.handle = map[rule.id];
            if (!rule.folderName && rule.handle) rule.folderName = rule.handle.name || "";
          }
        });
        persistFolderWatchSettings();
        updateFolderWatchBtn();
        if (!folderWatch.enabled || !activeFolderWatchRules(folderWatch.rules).length) return;

        var chain = Promise.resolve();
        activeFolderWatchRules(folderWatch.rules).forEach(function (rule) {
          chain = chain.then(function () {
            return ensureFolderReadPermission(rule.handle, true).then(function (ok) {
              if (!ok) {
                status(t("folderWatchPermission"), "err");
                return;
              }
              var hasSeen = Object.keys(folderSeenKeys).some(function (k) {
                return k.indexOf(String(rule.id) + "|") === 0;
              });
              if (hasSeen) return;
              return seedFolderSeenFromHandle(rule.id, rule.handle);
            });
          });
        });
        return chain.then(function () { startFolderWatch(); });
      });
    }).catch(function () {});
  }

  function dataTransferHasFiles(dt) {
    if (!dt || !dt.types) return false;
    for (var i = 0; i < dt.types.length; i++) {
      if (dt.types[i] === "Files") return true;
    }
    return false;
  }

  function bindDrop(node, resolveLayoutId) {
    if (!node) return;
    var isPreview = node === el.wrap;
    node.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (isPreview && typeof resolveLayoutId === "function") {
        if (draggedImageRefs() || dataTransferHasFiles(e.dataTransfer)) {
          setDropHighlight(resolveLayoutId(e));
        } else {
          clearDropHighlight();
        }
      } else {
      node.classList.add("dragover");
      }
    });
    node.addEventListener("dragleave", function (e) {
      if (node.contains(e.relatedTarget)) return;
      if (isPreview) clearDropHighlight();
      else node.classList.remove("dragover");
    });
    node.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (isPreview) clearDropHighlight();
      else node.classList.remove("dragover");

      if (isPreview && draggedImageRefs()) {
        var refs = draggedImageRefs();
        var targetId = typeof resolveLayoutId === "function"
          ? resolveLayoutId(e)
          : null;
        moveImagesToLayout(refs, targetId);
        childDrag = null;
        return;
      }

      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      var fileTargetId = typeof resolveLayoutId === "function"
        ? resolveLayoutId(e)
        : null;
      addFiles(e.dataTransfer.files, fileTargetId || undefined);
    });
  }

  function idb(op, key, val) {
    return new Promise(function (resolve, reject) {
      // Do not pass a fixed version — opening with a lower version than the
      // existing DB throws VersionError ("requested version (1) < existing (2)").
      var req = indexedDB.open("obs-grid-designer");
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("handles")) db.createObjectStore("handles");
      };
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("handles")) {
          db.close();
          reject(new Error("handles store missing"));
          return;
        }
        var tx = db.transaction("handles", op === "get" ? "readonly" : "readwrite");
        var store = tx.objectStore("handles");
        var r;
        if (op === "get") r = store.get(key);
        else if (op === "del") r = store.delete(key);
        else r = store.put(val, key);
        r.onsuccess = function () { resolve(op === "get" ? r.result || null : null); };
        r.onerror = function () { reject(r.error); };
        tx.oncomplete = function () { db.close(); };
      };
    });
  }

  function pickPng() {
    return window.showSaveFilePicker({
      suggestedName: "obs-grid.png",
      types: [{ description: "PNG", accept: { "image/png": [".png"] } }],
    });
  }

  // Serialize all PNG writes — overlapping createWritable() on the same handle
  // fails, and the old catch path re-opened the save dialog (esp. on rapid
  // spacing/padding input → debounced auto-export).
  var pngWriteChain = Promise.resolve();

  function savePng(blob, opts) {
    opts = opts || {};
    var allowPick = opts.allowPick !== false;
    function hint() {
      el.paths.innerHTML = t("pngLine") + "<strong>" + (pngHandle ? pngHandle.name : t("notSelected")) + "</strong>";
    }
    if (typeof window.showSaveFilePicker !== "function") {
      if (!allowPick) return Promise.reject(new Error(t("errNoPathPicker")));
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "obs-grid.png";
      a.click();
      status(t("pngSavedDownload"), "err");
      return Promise.resolve();
    }
    function ensurePermission(handle) {
      return handle.queryPermission({ mode: "readwrite" }).then(function (st) {
        if (st === "granted") return true;
        // requestPermission needs a user gesture — debounced auto-export has none.
        return handle.requestPermission({ mode: "readwrite" }).then(function (n) {
          return n === "granted";
        }).catch(function () {
          return false;
        });
      }).catch(function () {
        return false;
      });
    }
    function writeBlob(handle) {
      return ensurePermission(handle).then(function (ok) {
        if (!ok) throw new Error(t("errWritePermission"));
        return handle.createWritable().then(function (w) {
          return w.write(blob).then(function () { return w.close(); });
        });
      });
    }
    function remember(handle) {
        pngHandle = handle;
          hint();
      // Persist handle for next visit — failure must not look like a save failure
      // (old code re-opened the file picker after a successful write).
      return idb("put", "png", handle).catch(function () { return null; }).then(function () {
          return handle.name;
        });
    }
    function write(handle) {
      return writeBlob(handle).then(function () { return remember(handle); });
    }
    function run() {
      if (!pngHandle) {
        if (!allowPick) throw new Error(t("errWritePermission"));
        return pickPng().then(write);
      }
      return write(pngHandle).catch(function (e) {
        if (e && e.name === "AbortError") throw e;
        // Manual export only: permission lost / handle stale → ask again.
        // Auto-export must never open a picker (would interrupt typing/editing).
        if (!allowPick) throw e;
        return pickPng().then(write);
      });
    }
    var task = pngWriteChain.then(run, run);
    pngWriteChain = task.then(function () {}, function () {});
    return task;
  }

  function exportPng() {
    writeForm();
    var s = canvasSize();
    el.canvas.width = s.w;
    el.canvas.height = s.h;
    var ctx = el.canvas.getContext("2d");
    ctx.clearRect(0, 0, s.w, s.h);
    draw(ctx, canvasId, 0, 0, 0);
    el.canvas.toBlob(function (blob) {
      if (!blob) return status(t("pngFail"), "err");
      savePng(blob).then(function (name) {
        if (name) status(t("pngOverwritten", { name: name }), "ok");
      }).catch(function (e) {
        if (e && e.name !== "AbortError") status(String(e.message || e), "err");
      });
    }, "image/png");
  }

  function isAutoExportOn() {
    var cb = $("autoExportPng");
    return !!(cb && cb.checked);
  }

  function canAutoExport() {
    // Require a fixed PNG path — never open a file picker from auto-export.
    return isAutoExportOn() && !!canvasId && !!pngHandle;
  }

  function requestAutoExport(immediate) {
    if (!canAutoExport()) return;
    if (drag) return; // resize/move in progress — wait until mouseup
    clearTimeout(autoExportTimer);
    autoExportTimer = null;
    // Never run export synchronously on the same turn as a DOM refresh —
    // full-res canvas draw is what feels like frame drops after load/dup.
    // "immediate" only shortens the debounce; still yields via rAF.
    var delay = immediate ? 48 : 280;
    autoExportTimer = setTimeout(function () {
      autoExportTimer = null;
      requestAnimationFrame(function () {
        runAutoExport();
      });
    }, delay);
  }

  function runAutoExport() {
    if (!canAutoExport()) return;
    if (autoExportBusy) {
      autoExportPending = true;
      return;
    }
    autoExportBusy = true;
    writeForm();
    var s = canvasSize();
    el.canvas.width = s.w;
    el.canvas.height = s.h;
    var ctx = el.canvas.getContext("2d");
    ctx.clearRect(0, 0, s.w, s.h);
    draw(ctx, canvasId, 0, 0, 0);
    el.canvas.toBlob(function (blob) {
      if (!blob) {
        autoExportBusy = false;
        status(t("autoExportFail"), "err");
        return;
      }
      savePng(blob, { allowPick: false }).then(function (name) {
        if (name) status(t("autoExportOk", { name: name }), "ok");
      }).catch(function (e) {
        if (e && e.name !== "AbortError") status(String(e.message || e), "err");
      }).then(function () {
        autoExportBusy = false;
        if (autoExportPending) {
          autoExportPending = false;
          runAutoExport();
        }
      });
    }, "image/png");
  }

  var PROJECT_KIND = "obs-grid-designer";
  /** JSON project file format — not the app release version (see js/version.js). */
  var PROJECT_VERSION = 1;
  var APP_VERSION = (window.GC_APP_VERSION && String(window.GC_APP_VERSION)) || "0.0.0";

  function cloneLayoutsMap(src) {
    var out = {};
    Object.keys(src).forEach(function (id) {
      var L = src[id];
      out[id] = Object.assign({
        id: L.id,
        name: L.name,
        parentId: L.parentId,
        settings: Object.assign({}, L.settings),
        children: (L.children || []).map(function (ch) {
          return {
            type: ch.type,
            refId: ch.refId,
            frame: ch.frame ? Object.assign({}, ch.frame) : null,
          };
        }),
      }, copyBgFields(L));
    });
    return out;
  }

  function snapshotState() {
    return {
      layouts: cloneLayoutsMap(layouts),
      canvasId: canvasId,
      activeId: activeId,
      selectedChild: selectedChild,
      previewSel: { parentId: previewSel.parentId, index: previewSel.index },
      imageSel: imageSel.map(function (r) {
        return { parentId: r.parentId, index: r.index };
      }),
      imageSelAnchor: imageSelAnchor
        ? { parentId: imageSelAnchor.parentId, index: imageSelAnchor.index }
        : null,
      maxZ: maxZ,
    };
  }

  function pushUndo() {
    if (undoSuspended || !canvasId || !layouts[canvasId]) return;
    writeForm();
    undoStack.push(snapshotState());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }

  function restoreState(snap) {
    if (!snap || !snap.layouts || !snap.canvasId) return;
    undoSuspended = true;
    layouts = cloneLayoutsMap(snap.layouts);
    canvasId = snap.canvasId;
    activeId = snap.activeId && layouts[snap.activeId] ? snap.activeId : canvasId;
    selectedChild = typeof snap.selectedChild === "number" ? snap.selectedChild : -1;
    previewSel = snap.previewSel
      ? { parentId: snap.previewSel.parentId, index: snap.previewSel.index }
      : { parentId: null, index: -1 };
    imageSel = normalizeImageSel(snap.imageSel || (
      selectedChild >= 0 && layouts[activeId] &&
      layouts[activeId].children[selectedChild] &&
      layouts[activeId].children[selectedChild].type === "image"
        ? [{ parentId: activeId, index: selectedChild }]
        : []
    ));
    imageSelAnchor = snap.imageSelAnchor
      ? { parentId: snap.imageSelAnchor.parentId, index: snap.imageSelAnchor.index }
      : (imageSel.length ? imageSel[imageSel.length - 1] : null);
    maxZ = Math.max(1, +snap.maxZ || 1);
    readCanvasSize();
    readForm();
    refresh();
    undoSuspended = false;
    requestAutoExport(true);
  }

  function undo() {
    if (!undoStack.length) {
      status(t("nothingToUndo"));
      return;
    }
    restoreState(undoStack.pop());
    status(t("undone"), "ok");
  }

  function clearUndo() {
    undoStack = [];
    formUndoArmed = false;
    clip = null;
  }

  function armFormUndo() {
    if (formUndoArmed || undoSuspended) return;
    pushUndo();
    formUndoArmed = true;
  }

  function isTypingTarget(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || !!t.isContentEditable;
  }

  function imageToDataUrl(entry) {
    if (entry.file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(reader.error || new Error(t("errImageRead"))); };
        reader.readAsDataURL(entry.file);
      });
    }
    return new Promise(function (resolve, reject) {
      var im = entry.img;
      if (!im) return reject(new Error(t("errNoImage")));
      var c = document.createElement("canvas");
      c.width = im.naturalWidth || 1;
      c.height = im.naturalHeight || 1;
      try {
        c.getContext("2d").drawImage(im, 0, 0);
        resolve(c.toDataURL("image/png"));
      } catch (e) {
        reject(e);
      }
    });
  }

  function clearProjectState() {
    Object.keys(images).forEach(function (id) {
      var entry = images[id];
      if (entry && entry.url && entry.url.indexOf("blob:") === 0) {
        try { URL.revokeObjectURL(entry.url); } catch (e) { /* ignore */ }
      }
    });
    images = {};
    layouts = {};
    canvasId = null;
    activeId = null;
    selectedChild = -1;
    previewSel = { parentId: null, index: -1 };
    clearImageSel();
    childDrag = null;
    collapsed = {};
    maxZ = 1;
    clearUndo();
  }

  function collectUsedImageIds(rootId) {
    var used = {};
    function walk(id) {
      var L = layouts[id];
      if (!L) return;
      (L.children || []).forEach(function (ch) {
        if (ch.type === "image" && ch.refId) used[ch.refId] = true;
        else if (ch.type === "layout" && ch.refId) walk(ch.refId);
      });
    }
    walk(rootId);
    return Object.keys(used);
  }

  function stripImageChildren(layoutsMap) {
    Object.keys(layoutsMap).forEach(function (id) {
      var L = layoutsMap[id];
      L.children = (L.children || []).filter(function (ch) {
        return ch.type !== "image";
      });
    });
    return layoutsMap;
  }

  function buildProject(includeImages) {
    writeForm();
    var imagePayload = {};
    var chain = Promise.resolve();
    if (includeImages) {
      var ids = collectUsedImageIds(canvasId);
    ids.forEach(function (id) {
      chain = chain.then(function () {
        var entry = images[id];
        if (!entry) return;
        return imageToDataUrl(entry).then(function (dataUrl) {
          imagePayload[id] = { id: id, name: entry.name || id, dataUrl: dataUrl };
        });
      });
    });
    }
    return chain.then(function () {
      var layoutPayload = cloneLayoutsMap(layouts);
      if (!includeImages) stripImageChildren(layoutPayload);
      return {
        kind: PROJECT_KIND,
        version: PROJECT_VERSION,
        canvasId: canvasId,
        maxZ: maxZ,
        layouts: layoutPayload,
        images: imagePayload,
        folderWatch: serializeFolderWatchForProject(),
      };
    });
  }

  function downloadJson(obj, filename) {
    var blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "obs-grid-project.json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function validateProject(data) {
    if (!data || typeof data !== "object") throw new Error(t("errBadFile"));
    if (data.kind !== PROJECT_KIND) throw new Error(t("errWrongKind"));
    if (+data.version !== PROJECT_VERSION) throw new Error(t("errBadVersion"));
    if (!data.canvasId || !data.layouts || !data.layouts[data.canvasId]) {
      throw new Error(t("errNoCanvas"));
    }
  }

  /** Prefer blob: URLs over data: — DOM rebuilds re-assign src often; data URLs re-parse. */
  function objectUrlFromDataUrl(dataUrl) {
    if (!dataUrl || dataUrl.indexOf("data:") !== 0) return Promise.resolve(dataUrl);
    return fetch(dataUrl)
      .then(function (r) { return r.blob(); })
      .then(function (blob) { return URL.createObjectURL(blob); });
  }

  function loadImageEntry(id, e) {
    var dataUrl = e && e.dataUrl;
    if (!dataUrl) return Promise.resolve(null);
    var name = (e && e.name) || id;
    return objectUrlFromDataUrl(dataUrl).catch(function () {
      return dataUrl;
    }).then(function (url) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          resolve({
            id: id,
            name: name,
            url: url,
            file: null,
            img: img,
          });
        };
        img.onerror = function () {
          if (url && url.indexOf("blob:") === 0) {
            try { URL.revokeObjectURL(url); } catch (err) { /* ignore */ }
          }
          reject(new Error(t("errImageLoadNamed", { name: name })));
        };
        img.src = url;
      });
    });
  }

  function serializeFolderWatchForProject() {
    return {
      enabled: !!folderWatch.enabled,
      rules: folderWatch.rules.map(function (r) {
        return {
          id: r.id,
          folderName: r.folderName || (r.handle && r.handle.name) || "",
          targetLayoutId: r.targetLayoutId || null,
        };
      }),
    };
  }

  function applyFolderWatchFromProject(fw) {
    if (!fw || typeof fw !== "object") return Promise.resolve();
    stopFolderWatch();
    folderWatch.enabled = !!fw.enabled;
    folderWatch.rules = (Array.isArray(fw.rules) ? fw.rules : []).map(function (r) {
      var targetId = r && r.targetLayoutId;
      return {
        id: (r && r.id) || newFolderWatchRuleId(),
        folderName: (r && r.folderName) || "",
        targetLayoutId: targetId && layouts[targetId] ? targetId : canvasId,
        handle: null,
      };
    });
    persistFolderWatchSettings();
    updateFolderWatchBtn();

    if (!supportsFolderWatch()) return Promise.resolve();

    return idb("get", FOLDER_HANDLES_IDB).then(function (map) {
      map = map || {};
      return idb("get", FOLDER_HANDLE_IDB_LEGACY).then(function (legacy) {
        var byName = {};
        Object.keys(map).forEach(function (id) {
          var h = map[id];
          if (h && h.name) byName[h.name] = h;
        });
        if (legacy && legacy.name) byName[legacy.name] = byName[legacy.name] || legacy;

        folderWatch.rules.forEach(function (rule) {
          if (map[rule.id]) rule.handle = map[rule.id];
          else if (rule.folderName && byName[rule.folderName]) rule.handle = byName[rule.folderName];
          if (rule.handle && !rule.folderName) rule.folderName = rule.handle.name || "";
        });

        return persistFolderHandles().then(function () {
          persistFolderWatchSettings();
          updateFolderWatchBtn();
          var missing = folderWatch.rules.some(function (r) {
            return !r.handle && r.folderName;
          });
          var active = activeFolderWatchRules(folderWatch.rules);
          if (!folderWatch.enabled || !active.length) {
            stopFolderWatch();
            return (folderWatch.enabled && folderWatch.rules.length) || missing ? "relink" : null;
          }
          var note = missing ? "relink" : null;
          var chain = Promise.resolve();
          active.forEach(function (rule) {
            chain = chain.then(function () {
              return ensureFolderReadPermission(rule.handle, true).then(function (ok) {
                if (!ok) {
                  note = "permission";
                  return;
                }
                var hasSeen = Object.keys(folderSeenKeys).some(function (k) {
                  return k.indexOf(String(rule.id) + "|") === 0;
                });
                if (!hasSeen) return seedFolderSeenFromHandle(rule.id, rule.handle);
              });
            });
          });
          return chain.then(function () {
            startFolderWatch();
            return note;
          });
        });
      });
    }).catch(function () {
      updateFolderWatchBtn();
      return null;
    });
  }

  function importProject(data) {
    validateProject(data);
    var nextLayouts = cloneLayoutsMap(data.layouts);
    var imgEntries = data.images || {};
    var ids = Object.keys(imgEntries);
    // Decode in parallel — sequential data-URL load was a multi-second main-thread stall.
    return Promise.all(ids.map(function (id) {
      return loadImageEntry(id, imgEntries[id]);
    })).then(function (entries) {
      var nextImages = {};
      entries.forEach(function (entry) {
        if (entry) nextImages[entry.id] = entry;
      });
      clearProjectState();
      clearUndo();
      layouts = nextLayouts;
      images = nextImages;
      canvasId = data.canvasId;
      activeId = layouts[data.canvasId] ? data.canvasId : Object.keys(layouts)[0];
      maxZ = Math.max(1, +data.maxZ || 1);
      Object.keys(layouts).forEach(function (id) {
        ensureFrames(layouts[id]);
        (layouts[id].children || []).forEach(function (ch) {
          if (ch.frame && ch.frame.z != null && ch.frame.z > maxZ) maxZ = ch.frame.z;
        });
      });
      // Migrate old canvas z-stack into children[] order (hierarchy == paint).
      if (layouts[canvasId]) {
        layouts[canvasId].children.sort(function (a, b) {
          return ((a.frame && a.frame.z) || 0) - ((b.frame && b.frame.z) || 0);
        });
        syncChildStackZ(layouts[canvasId]);
      }
      selectedChild = -1;
      previewSel = { parentId: null, index: -1 };
      clearImageSel();
      readForm();
      refresh();
      return applyFolderWatchFromProject(data.folderWatch);
    });
  }

  function saveProject() {
    var includeImages = !!( $("saveWithImages") && $("saveWithImages").checked );
    status(includeImages ? t("savingWithImages") : t("savingStructure"));
    buildProject(includeImages).then(function (project) {
      downloadJson(project, "grid-designer-structure.json");
      persistFolderHandles().catch(function () {});
      var nLay = Object.keys(project.layouts).length;
      var nImg = Object.keys(project.images).length;
      if (includeImages) {
        status(t("savedWithImages", { nLay: nLay, nImg: nImg }), "ok");
      } else {
        status(t("savedNoImages", { nLay: nLay }), "ok");
      }
    }).catch(function (e) {
      status(String((e && e.message) || e), "err");
    });
  }

  function loadProjectFromFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var hasContent =
          Object.keys(layouts).length > 1 ||
          (layouts[canvasId] && layouts[canvasId].children && layouts[canvasId].children.length > 0) ||
          Object.keys(images).length > 0;
        if (hasContent && !window.confirm(t("confirmOverwrite"))) {
          status(t("loadCancelled"));
          return;
        }
        status(t("loading"));
        importProject(data).then(function (fwNote) {
          var nLay = Object.keys(layouts).length;
          var nImg = Object.keys(images).length;
          status(t("loaded", { nLay: nLay, nImg: nImg }), "ok");
          if (fwNote === "permission") status(t("folderWatchPermission"), "err");
          else if (fwNote === "relink") status(t("folderWatchRelink"), "err");
        }).catch(function (e) {
          status(String((e && e.message) || e), "err");
        });
      } catch (e) {
        status(t("errJsonParse", { msg: String((e && e.message) || e) }), "err");
      }
    };
    reader.onerror = function () { status(t("errFileRead"), "err"); };
    reader.readAsText(file);
  }

  function selectCanvasFromEmpty() {
    // No layout selected in tree; images add as top-level siblings of layouts
    if (activeId !== canvasId || previewSel.parentId != null || selectedChild >= 0 || imageSel.length) {
      selectLayout(canvasId);
    } else {
      previewSel = { parentId: null, index: -1 };
      selectedChild = -1;
      clearImageSel();
      refresh();
    }
  }

  // pointer — always edit canvas images + any layout frames (not layout-owned images)
  el.stage.addEventListener("mousedown", function (e) {
    if (e.button) return;
    // Prevent wrap "outside click" handler: refreshPreview() detaches the target,
    // so wrap would see a detached node and wrongly select the canvas.
    e.stopPropagation();
    writeForm();
    var t = e.target;
    var handle = t.closest && t.closest(".resize-handle");
    var cell = t.closest && t.closest(".grid-cell.interactive");
    if (cell) {
      var parentId = cell.dataset.parentId;
      var idx = +cell.dataset.childIndex;
      var parent = layouts[parentId];
      if (!parent || !parent.children[idx]) return;
      var ch = parent.children[idx];
      if (!isInteractiveChild(parentId, ch)) return;

      pushUndo();
      previewSel = { parentId: parentId, index: idx };

      if (ch.type === "layout" && layouts[ch.refId]) {
        clearImageSel();
        if (activeId !== ch.refId) {
          activeId = ch.refId;
          selectedChild = -1;
          readForm();
        } else {
          selectedChild = -1;
        }
        expandAncestors(ch.refId);
      } else {
        applyImageSel([{ parentId: parentId, index: idx }], { parentId: parentId, index: idx });
        imageSelAnchor = { parentId: parentId, index: idx };
        if (activeId !== parentId) {
          activeId = parentId;
          readForm();
        }
        selectedChild = idx;
        expandAncestors(parentId);
      }

      // Paint selection chrome once, then measure local coords from the live stage.
      paint(el.stage, canvasId, 0, activeId !== canvasId ? activeId : null);
      applyZoom();
      syncChrome();
      renderTree();

      var liveCell = el.stage.querySelector(
        '.grid-cell.interactive[data-parent-id="' + parentId + '"][data-child-index="' + idx + '"]'
      );
      var local = measureLocal(parentId);
      var fr = ch.frame;
      drag = {
        mode: handle ? "resize" : "move",
        layoutId: parentId,
        index: idx,
        handle: handle ? handle.dataset.handle : null,
        x0: (e.clientX - local.left) * local.sx,
        y0: (e.clientY - local.top) * local.sy,
        orig: { x: fr.x, y: fr.y, w: fr.w, h: fr.h },
        origSettings: (handle && ch.type === "layout" && ch.refId)
          ? snapshotLayoutCellSettings(ch.refId)
          : null,
        proportionalCells: false,
        undoPushed: true,
        cell: liveCell,
        local: local,
        repaintNested: false,
      };
      e.preventDefault();
      return;
    }
    selectCanvasFromEmpty();
    e.preventDefault();
  });

  // Click outside the canvas (black preview area) → same as empty canvas click
  el.wrap.addEventListener("mousedown", function (e) {
    if (e.button) return;
    if (e.target !== el.wrap && e.target !== el.shell) return;
    selectCanvasFromEmpty();
  });

  // Empty space in hierarchy panel → select canvas
  if (el.hierarchy) {
    el.hierarchy.addEventListener("mousedown", function (e) {
      if (e.button) return;
      if (e.target.closest && e.target.closest(".tree-item")) return;
      if (e.target.closest && e.target.closest("button, label, input, select, a")) return;
      selectCanvasFromEmpty();
    });
  }

  window.addEventListener("mousemove", function (e) {
    if (!drag) return;
    var L = layouts[drag.layoutId];
    if (!L) return;
    var p = toLocal(e.clientX, e.clientY, drag.layoutId);
    var dx = p.x - drag.x0, dy = p.y - drag.y0;
    var ch = L.children[drag.index];
    if (!ch || !ch.frame) return;
    var o = drag.orig, x = o.x, y = o.y, w = o.w, h = o.h;
    if (drag.mode === "move") {
      x = o.x + dx;
      y = o.y + dy;
    } else {
      var hd = drag.handle;
      if (hd.indexOf("e") >= 0) w = o.w + dx;
      if (hd.indexOf("s") >= 0) h = o.h + dy;
      if (hd.indexOf("w") >= 0) { w = o.w - dx; x = o.x + dx; }
      if (hd.indexOf("n") >= 0) { h = o.h - dy; y = o.y + dy; }
      if (w < 24) { if (hd.indexOf("w") >= 0) x = o.x + o.w - 24; w = 24; }
      if (h < 24) { if (hd.indexOf("n") >= 0) y = o.y + o.h - 24; h = 24; }
    }
    // Hold Shift to keep aspect (images & layouts).
    var lockAspect = e.shiftKey && drag.mode === "resize" && (
      (ch.type === "image" && isCanvas(drag.layoutId)) ||
      (ch.type === "layout" && !!layouts[ch.refId])
    );
    if (snapEnabled && !lockAspect) {
      var guides = collectSnapGuides(drag.layoutId, drag.index);
      var snapped = drag.mode === "move"
        ? snapMoveRect(x, y, w, h, guides, SNAP_THRESH)
        : snapResizeRect(x, y, w, h, drag.handle || "", guides, SNAP_THRESH);
      x = snapped.x;
      y = snapped.y;
      w = snapped.w;
      h = snapped.h;
    }
    if (lockAspect) {
      var locked = applyAspectLock(x, y, w, h, o, drag.handle || "se", 24);
      x = locked.x;
      y = locked.y;
      w = locked.w;
      h = locked.h;
    }
    ch.frame.x = Math.round(x);
    ch.frame.y = Math.round(y);
    ch.frame.w = Math.round(w);
    ch.frame.h = Math.round(h);
    if (ch.type === "layout" && layouts[ch.refId]) {
      if (drag.mode === "resize") {
        var proportionalCells = !!(e.ctrlKey || e.metaKey) && !!drag.origSettings;
        var entered = proportionalCells && !drag.proportionalCells;
        var exited = !proportionalCells && drag.proportionalCells;
        drag.proportionalCells = proportionalCells;

        if (proportionalCells) {
          // While dragging: keep original grid in the model; preview via CSS scale.
          restoreLayoutCellSettings(drag.origSettings);
          layouts[ch.refId].settings.width = o.w;
          layouts[ch.refId].settings.height = o.h;
          if (entered) {
            reflowLayoutTree(ch.refId);
            drag.repaintNested = true;
          }
        } else {
          layouts[ch.refId].settings.width = ch.frame.w;
          layouts[ch.refId].settings.height = ch.frame.h;
          if (exited && drag.origSettings) restoreLayoutCellSettings(drag.origSettings);
          reflowIfLayout(ch.refId);
          drag.repaintNested = true;
        }
      } else {
        layouts[ch.refId].settings.width = ch.frame.w;
        layouts[ch.refId].settings.height = ch.frame.h;
      }
    }
    scheduleDragVisual();
    e.preventDefault();
  });

  window.addEventListener("mouseup", function () {
    if (!drag) return;
    var finished = drag;
    drag = null;
    if (dragRaf) {
      cancelAnimationFrame(dragRaf);
      dragRaf = 0;
    }
    var PL = layouts[finished.layoutId];
    var pch = PL && PL.children[finished.index];
    var fr = pch && pch.frame;
    var o = finished.orig;
    var changed = !!(fr && o && (
      fr.x !== o.x || fr.y !== o.y || fr.w !== o.w || fr.h !== o.h
    ));
    if (!changed && finished.undoPushed && undoStack.length) undoStack.pop();
    if (finished.mode === "resize" && pch && pch.type === "layout" && layouts[pch.refId]) {
      if (finished.proportionalCells && finished.origSettings && fr && o) {
        // Commit: layout size + proportional cell px (matches the CSS-scale preview).
        layouts[pch.refId].settings.width = fr.w;
        layouts[pch.refId].settings.height = fr.h;
        applyProportionalCellSizes(
          pch.refId,
          fr.w / Math.max(1, o.w),
          fr.h / Math.max(1, o.h),
          finished.origSettings
        );
      } else {
        if (finished.origSettings) restoreLayoutCellSettings(finished.origSettings);
        layouts[pch.refId].settings.width = fr ? fr.w : layouts[pch.refId].settings.width;
        layouts[pch.refId].settings.height = fr ? fr.h : layouts[pch.refId].settings.height;
        reflowIfLayout(pch.refId);
      }
      if (activeId === pch.refId || (finished.origSettings && finished.origSettings[activeId])) {
        readForm();
      }
    } else if (pch && pch.type === "layout" && layouts[pch.refId] && activeId === pch.refId) {
      el.w.value = pch.frame.w;
      el.h.value = pch.frame.h;
    }
    refresh();
    if (changed) {
      status(t("frameUpdated"), "ok");
      requestAutoExport(true);
    }
  });

  // wire
  fillAlign(el.childAlign);
  if (el.alignPad) {
  ALIGNS.forEach(function (k) {
    var b = document.createElement("button");
    b.type = "button";
    b.dataset.align = k;
      b.title = alignLabel(k);
    b.onclick = function () {
      if (isCanvas(activeId)) return;
        pushUndo();
      el.childAlign.value = k;
      writeForm();
      reflow(lay());
      refresh();
        requestAutoExport(true);
    };
    el.alignPad.appendChild(b);
  });
  }

  $("addChildLayoutBtn").onclick = function () {
    closeAddMenu();
    var parent = lay();
    if (!parent) return;
    writeForm();
    pushUndo();
    var layoutCount = parent.children.filter(function (ch) { return ch.type === "layout"; }).length;
    var id = makeLayout(
      isCanvas(parent.id) ? t("layoutN", { n: layoutCount + 1 }) : (parent.name + t("childSuffix")),
      parent.id
    );
    if (isCanvas(parent.id)) {
      layouts[id].settings.width = 960;
      layouts[id].settings.height = 540;
      var i = parent.children.length;
      parent.children.push({
        type: "layout",
        refId: id,
        frame: { x: 40 + i * 28, y: 40 + i * 28, w: 960, h: 540, z: i + 1 },
      });
    } else {
      var ps = ns(parent.settings);
      layouts[id].settings.width = ps.cell_w;
      layouts[id].settings.height = ps.cell_h;
      parent.children.push({ type: "layout", refId: id, frame: null });
      reflow(parent);
    }
    selectLayout(id);
    status(t("layoutAdded"), "ok");
    requestAutoExport(true);
  };

  function setAddMenuOpen(open) {
    var panel = $("addMenuPanel");
    var btn = $("addMenuBtn");
    if (!panel || !btn) return;
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function closeAddMenu() { setAddMenuOpen(false); }

  function setTreeViewMenuOpen(open) {
    var panel = $("treeViewMenuPanel");
    var btn = $("treeViewMenuBtn");
    if (!panel || !btn) return;
    if (open) syncTreeViewMenu();
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function closeTreeViewMenu() { setTreeViewMenuOpen(false); }

  function syncTreeViewMenu() {
    var thumbsBtn = $("toggleTreeThumbsBtn");
    if (!thumbsBtn) return;
    thumbsBtn.classList.toggle("is-checked", !!showTreeThumbs);
    thumbsBtn.setAttribute("aria-checked", showTreeThumbs ? "true" : "false");
  }

  function walkTreeLayouts(fn) {
    function walk(id) {
      var L = layouts[id];
      if (!L) return;
      (L.children || []).forEach(function (ch) {
        if (ch.type === "layout" && ch.refId && layouts[ch.refId]) {
          fn(layouts[ch.refId]);
          walk(ch.refId);
        }
      });
    }
    if (canvasId) walk(canvasId);
  }

  function collapseAllTreeLayouts() {
    walkTreeLayouts(function (L) {
      if (L.children && L.children.length) collapsed[L.id] = true;
    });
    renderTree();
  }

  function expandAllTreeLayouts() {
    collapsed = {};
    renderTree();
  }

  function setShowTreeThumbs(on) {
    showTreeThumbs = !!on;
    try {
      localStorage.setItem(SHOW_TREE_THUMBS_LS, showTreeThumbs ? "1" : "0");
    } catch (ePersist) { /* ignore */ }
    syncTreeViewMenu();
    renderTree();
  }

  if ($("addMenuBtn")) {
    $("addMenuBtn").onclick = function (e) {
      e.stopPropagation();
      closeTreeViewMenu();
      var panel = $("addMenuPanel");
      setAddMenuOpen(!!(panel && panel.hidden));
    };
  }
  if ($("addImageMenuBtn")) {
    $("addImageMenuBtn").onclick = function () {
      closeAddMenu();
      if (el.file) el.file.click();
    };
  }

  if ($("treeViewMenuBtn")) {
    $("treeViewMenuBtn").onclick = function (e) {
      e.stopPropagation();
      closeAddMenu();
      var panel = $("treeViewMenuPanel");
      setTreeViewMenuOpen(!!(panel && panel.hidden));
    };
  }
  if ($("toggleTreeThumbsBtn")) {
    $("toggleTreeThumbsBtn").setAttribute("role", "menuitemcheckbox");
    $("toggleTreeThumbsBtn").onclick = function () {
      setShowTreeThumbs(!showTreeThumbs);
    };
  }
  if ($("collapseAllLayoutsBtn")) {
    $("collapseAllLayoutsBtn").onclick = function () {
      closeTreeViewMenu();
      collapseAllTreeLayouts();
    };
  }
  if ($("expandAllLayoutsBtn")) {
    $("expandAllLayoutsBtn").onclick = function () {
      closeTreeViewMenu();
      expandAllTreeLayouts();
    };
  }

  document.addEventListener("mousedown", function (e) {
    var addMenu = $("addMenu");
    if (addMenu && !addMenu.contains(e.target)) closeAddMenu();
    var treeMenu = $("treeViewMenu");
    if (treeMenu && !treeMenu.contains(e.target)) closeTreeViewMenu();
  });

  function deleteLayoutById(id) {
    if (!id || id === canvasId || !layouts[id]) return false;
    var parentId = layouts[id].parentId;
    Object.keys(layouts).forEach(function (lid) {
      layouts[lid].children = layouts[lid].children.filter(function (ch) {
        return !(ch.type === "layout" && ch.refId === id);
      });
    });
    delete layouts[id];
    if (parentId && layouts[parentId] && !isCanvas(parentId)) reflow(layouts[parentId]);
    selectLayout(parentId && layouts[parentId] ? parentId : canvasId);
    return true;
  }

  function removeSelected() {
    if (imageSel.length > 0) {
      var refs = imageSel.slice().sort(function (a, b) {
        if (a.parentId !== b.parentId) return a.parentId < b.parentId ? -1 : 1;
        return b.index - a.index;
      });
      pushUndo();
      var touched = {};
      var n = 0;
      refs.forEach(function (r) {
        var parent = layouts[r.parentId];
        if (!parent || !parent.children[r.index] || parent.children[r.index].type !== "image") return;
        parent.children.splice(r.index, 1);
        touched[r.parentId] = true;
        n += 1;
      });
      Object.keys(touched).forEach(function (pid) {
        if (!isCanvas(pid) && layouts[pid]) reflow(layouts[pid]);
      });
      clearImageSel();
      selectedChild = -1;
      previewSel = { parentId: null, index: -1 };
      refresh();
      status(n === 1 ? t("imageRemoved") : t("imagesRemoved", { n: n }), "ok");
      requestAutoExport(true);
      return true;
    }

    var L = lay();
    if (!L) return false;
    if (selectedChild >= 0) {
      var ch = L.children[selectedChild];
      pushUndo();
      if (ch && ch.type === "layout" && ch.refId) {
        deleteLayoutById(ch.refId);
        status(t("layoutRemoved"), "ok");
        requestAutoExport(true);
        return true;
      }
    L.children.splice(selectedChild, 1);
    selectedChild = -1;
    previewSel = { parentId: null, index: -1 };
      clearImageSel();
    if (!isCanvas(L.id)) reflow(L);
    refresh();
      status(t("imageRemoved"), "ok");
      requestAutoExport(true);
      return true;
    }
    if (isCanvas(L.id)) {
      status(t("errNothingToRemove"), "err");
      return false;
    }
    pushUndo();
    deleteLayoutById(L.id);
    status(t("layoutRemoved"), "ok");
    requestAutoExport(true);
    return true;
  }

  function getCopyTarget() {
    if (selectedChild >= 0) {
      var parent = lay();
      if (!parent || !parent.children[selectedChild]) return null;
      var ch = parent.children[selectedChild];
      if (ch.type === "image") return { kind: "image", parentId: parent.id, index: selectedChild };
      if (ch.type === "layout" && ch.refId) return { kind: "layout", id: ch.refId };
      return null;
    }
    if (activeId && !isCanvas(activeId) && layouts[activeId]) {
      return { kind: "layout", id: activeId };
    }
    return null;
  }

  function cloneLayoutSubtree(rootId) {
    var idMap = {};
    var order = [];
    function walk(id) {
      if (!layouts[id] || idMap[id]) return;
      order.push(id);
      idMap[id] = uid("lay");
      (layouts[id].children || []).forEach(function (ch) {
        if (ch.type === "layout" && layouts[ch.refId]) walk(ch.refId);
      });
    }
    walk(rootId);
    var out = {};
    order.forEach(function (oldId) {
      var L = layouts[oldId];
      var newId = idMap[oldId];
      out[newId] = Object.assign({
        id: newId,
        name: oldId === rootId ? (L.name + t("copySuffix")) : L.name,
        parentId: oldId === rootId ? null : idMap[L.parentId],
        settings: Object.assign({}, L.settings),
        children: (L.children || []).map(function (ch) {
          if (ch.type === "layout") {
            return {
              type: "layout",
              refId: idMap[ch.refId],
              frame: ch.frame ? Object.assign({}, ch.frame) : null,
            };
          }
          return {
            type: "image",
            refId: ch.refId,
            frame: ch.frame ? Object.assign({}, ch.frame) : null,
          };
        }),
      }, copyBgFields(L));
    });
    return { rootId: idMap[rootId], layouts: out };
  }

  function copySelection() {
    var target = getCopyTarget();
    if (!target) {
      status(t("errCopySelect"), "err");
      return;
    }
    if (target.kind === "image") {
      var ch = layouts[target.parentId].children[target.index];
      if (!ch || !images[ch.refId]) {
        status(t("errCopyImage"), "err");
        return;
      }
      clip = {
        kind: "image",
        child: {
          type: "image",
          refId: ch.refId,
          frame: ch.frame ? Object.assign({}, ch.frame) : null,
        },
      };
      status(t("imageCopied"), "ok");
      return;
    }
    if (!layouts[target.id]) {
      status(t("errCopyLayout"), "err");
      return;
    }
    var sub = cloneLayoutSubtree(target.id);
    var pf = findParentFrame(target.id);
    clip = {
      kind: "layout",
      rootId: sub.rootId,
      layouts: sub.layouts,
      frame: pf ? Object.assign({}, pf) : null,
    };
    status(t("layoutCopied"), "ok");
  }

  function pasteParentId() {
    if (!activeId || !layouts[activeId]) return canvasId;
    return activeId;
  }

  function instantiateClipLayouts(srcRootId, srcLayouts, parentId) {
    var idMap = {};
    Object.keys(srcLayouts).forEach(function (srcId) {
      idMap[srcId] = uid("lay");
    });
    var newRoot = idMap[srcRootId];
    Object.keys(srcLayouts).forEach(function (srcId) {
      var src = srcLayouts[srcId];
      var nid = idMap[srcId];
      layouts[nid] = Object.assign({
        id: nid,
        name: src.name,
        parentId: srcId === srcRootId ? parentId : idMap[src.parentId],
        settings: Object.assign({}, src.settings),
        children: (src.children || []).map(function (ch) {
          if (ch.type === "layout") {
            return {
              type: "layout",
              refId: idMap[ch.refId],
              frame: ch.frame ? Object.assign({}, ch.frame) : null,
            };
          }
          return {
            type: "image",
            refId: ch.refId,
            frame: ch.frame ? Object.assign({}, ch.frame) : null,
          };
        }),
      }, copyBgFields(src));
    });
    return newRoot;
  }

  function pasteClipboard() {
    if (!clip) {
      status(t("errPasteEmpty"), "err");
      return;
    }
    var parentId = pasteParentId();
    var parent = layouts[parentId];
    if (!parent) return;

    pushUndo();

    if (clip.kind === "image") {
      if (!images[clip.child.refId]) {
        if (undoStack.length) undoStack.pop();
        status(t("errPasteImageMissing"), "err");
        return;
      }
      var frame = null;
      if (isCanvas(parentId)) {
        var src = clip.child.frame || { x: 24, y: 24, w: 200, h: 160, z: 1 };
        maxZ += 1;
        frame = {
          x: Math.round((src.x || 0) + 24),
          y: Math.round((src.y || 0) + 24),
          w: src.w || 200,
          h: src.h || 160,
          z: maxZ,
        };
      }
      parent.children.push({ type: "image", refId: clip.child.refId, frame: frame });
      if (!isCanvas(parentId)) reflow(parent);
      var idx = parent.children.length - 1;
      activeId = parentId;
      selectedChild = idx;
      previewSel = isInteractiveChild(parentId, parent.children[idx])
        ? { parentId: parentId, index: idx }
        : { parentId: null, index: -1 };
      readForm();
      refresh();
      status(t("imagePasted"), "ok");
      requestAutoExport(true);
      return;
    }

    if (clip.kind === "layout") {
      var newRoot = instantiateClipLayouts(clip.rootId, clip.layouts, parentId);
      var rootLay = layouts[newRoot];
      if (isCanvas(parentId)) {
        var i = parent.children.length;
        var w = ns(rootLay.settings).width;
        var h = ns(rootLay.settings).height;
        var fx = clip.frame ? Math.round(clip.frame.x + 24) : 40 + i * 28;
        var fy = clip.frame ? Math.round(clip.frame.y + 24) : 40 + i * 28;
        maxZ += 1;
        parent.children.push({
          type: "layout",
          refId: newRoot,
          frame: { x: fx, y: fy, w: w, h: h, z: maxZ },
        });
      } else {
        var ps = ns(parent.settings);
        rootLay.settings.width = ps.cell_w;
        rootLay.settings.height = ps.cell_h;
        parent.children.push({ type: "layout", refId: newRoot, frame: null });
        reflow(parent);
      }
      collapseHeavyLayout(newRoot);
      selectLayout(newRoot);
      status(t("layoutPasted"), "ok");
      requestAutoExport(true);
    }
  }

  function duplicateSelection() {
    var target = getCopyTarget();
    if (!target) {
      status(t("errDupSelect"), "err");
      return;
    }
    pushUndo();

    if (target.kind === "image") {
      var parent = layouts[target.parentId];
      var ch = parent && parent.children[target.index];
      if (!parent || !ch || !images[ch.refId]) {
        if (undoStack.length) undoStack.pop();
        status(t("errDupImage"), "err");
        return;
      }
      var frame = null;
      if (isCanvas(parent.id)) {
        var src = ch.frame || { x: 24, y: 24, w: 200, h: 160, z: 1 };
        maxZ += 1;
        frame = {
          x: Math.round((src.x || 0) + 24),
          y: Math.round((src.y || 0) + 24),
          w: src.w || 200,
          h: src.h || 160,
          z: maxZ,
        };
      }
      parent.children.splice(target.index + 1, 0, {
        type: "image",
        refId: ch.refId,
        frame: frame,
      });
      if (!isCanvas(parent.id)) reflow(parent);
      selectChildNode(parent.id, target.index + 1);
      status(t("imageDuplicated"), "ok");
      requestAutoExport(false);
      return;
    }

    var srcLay = layouts[target.id];
    var parentId = srcLay && srcLay.parentId;
    var parent = parentId && layouts[parentId];
    if (!srcLay || !parent) {
      if (undoStack.length) undoStack.pop();
      status(t("errDupLayout"), "err");
      return;
    }
    var idx = -1;
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i].type === "layout" && parent.children[i].refId === target.id) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      if (undoStack.length) undoStack.pop();
      status(t("errDupLayout"), "err");
      return;
    }

    var sub = cloneLayoutSubtree(target.id);
    var newRoot = instantiateClipLayouts(sub.rootId, sub.layouts, parentId);
    var rootLay = layouts[newRoot];
    var childEntry;
    if (isCanvas(parentId)) {
      var pf = parent.children[idx].frame || findParentFrame(target.id);
      maxZ += 1;
      childEntry = {
        type: "layout",
        refId: newRoot,
        frame: {
          x: Math.round(((pf && pf.x) || 40) + 24),
          y: Math.round(((pf && pf.y) || 40) + 24),
          w: ns(rootLay.settings).width,
          h: ns(rootLay.settings).height,
          z: maxZ,
        },
      };
    } else {
      var ps = ns(parent.settings);
      rootLay.settings.width = ps.cell_w;
      rootLay.settings.height = ps.cell_h;
      childEntry = { type: "layout", refId: newRoot, frame: null };
    }
    parent.children.splice(idx + 1, 0, childEntry);
    if (!isCanvas(parentId)) reflow(parent);
    // Keep heavy image lists folded — tree thumbs were the main dup hitch.
    collapseHeavyLayout(target.id);
    collapseHeavyLayout(newRoot);
    selectLayout(newRoot);
    status(t("layoutDuplicated"), "ok");
    requestAutoExport(false);
  }

  $("removeNodeBtn").onclick = function () { removeSelected(); };

  $("clearChildrenBtn").onclick = function () {
    var L = lay();
    if (!L || !L.children.length) return;
    var label = isCanvas(L.id) ? t("canvas") : ("'" + L.name + "'");
    if (!confirm(t("confirmClearChildren", { label: label }))) return;
    pushUndo();
    L.children = [];
    selectedChild = -1;
    previewSel = { parentId: null, index: -1 };
    clearImageSel();
    if (!isCanvas(L.id)) reflow(L);
    refresh();
    requestAutoExport(true);
  };

  if ($("folderWatchMenuBtn")) {
    $("folderWatchMenuBtn").onclick = function () {
      closeAddMenu();
      openFolderWatchModal();
    };
  }
  if ($("folderWatchAddRuleBtn")) {
    $("folderWatchAddRuleBtn").onclick = function () {
      addFolderWatchDraftRule();
    };
  }
  if ($("folderWatchRuleList")) {
    $("folderWatchRuleList").addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-fw-action]");
      if (!btn) return;
      var ruleId = btn.getAttribute("data-rule-id");
      var action = btn.getAttribute("data-fw-action");
      if (action === "pick") pickWatchFolderForRule(ruleId);
      else if (action === "clear") clearWatchFolderForRule(ruleId);
      else if (action === "remove") removeFolderWatchDraftRule(ruleId);
    });
    $("folderWatchRuleList").addEventListener("change", function (e) {
      var sel = e.target;
      if (!sel || sel.tagName !== "SELECT") return;
      if (sel.getAttribute("data-fw-action") !== "target") return;
      var rule = findDraftRule(sel.getAttribute("data-rule-id"));
      if (rule) rule.targetLayoutId = sel.value;
    });
  }
  if ($("folderWatchSaveBtn")) {
    $("folderWatchSaveBtn").onclick = saveFolderWatchModal;
  }
  document.querySelectorAll("[data-folder-watch-close]").forEach(function (node) {
    node.addEventListener("click", closeFolderWatchModal);
  });
  window.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var lb = $("whatsNewLightbox");
    if (lb && !lb.hidden) {
      e.preventDefault();
      closeWhatsNewLightbox();
      return;
    }
    var whatsNew = $("whatsNewModal");
    if (whatsNew && !whatsNew.hidden) {
      e.preventDefault();
      dismissWhatsNew();
      return;
    }
    var modal = $("folderWatchModal");
    if (modal && !modal.hidden) {
      e.preventDefault();
      closeFolderWatchModal();
    }
  });

  var LAST_SEEN_FROM = null;

  function parseVersionParts(v) {
    return String(v || "0")
      .split(".")
      .map(function (p) { return parseInt(p, 10) || 0; });
  }

  function compareVersions(a, b) {
    var pa = parseVersionParts(a);
    var pb = parseVersionParts(b);
    var n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var da = pa[i] || 0;
      var db = pb[i] || 0;
      if (da !== db) return da < db ? -1 : 1;
    }
    return 0;
  }

  function getLastSeenVersion() {
    try {
      return localStorage.getItem(LAST_SEEN_VERSION_LS) || "";
    } catch (e) {
      return "";
    }
  }

  function setLastSeenVersion(v) {
    try {
      localStorage.setItem(LAST_SEEN_VERSION_LS, String(v || APP_VERSION));
    } catch (e) { /* ignore */ }
  }

  function changelogEntriesSince(fromVersion) {
    var log = (window.GC_CHANGELOG && typeof window.GC_CHANGELOG === "object")
      ? window.GC_CHANGELOG
      : {};
    var keys = Object.keys(log).filter(function (v) {
      if (compareVersions(v, APP_VERSION) > 0) return false;
      if (!fromVersion) return compareVersions(v, APP_VERSION) === 0;
      return compareVersions(v, fromVersion) > 0;
    });
    keys.sort(compareVersions);
    return keys.map(function (v) {
      var entry = log[v] || {};
      var lang = I18N.getLang();
      var lines = entry[lang] || entry.ko || entry.en || [];
      return { version: v, lines: lines };
    }).filter(function (block) {
      return block.lines && block.lines.length;
    });
  }

  /** Changelog line `![alt](relative/path.gif)` → image in What's New. */
  function parseChangelogMedia(line) {
    var m = String(line || "").trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (!m) return null;
    var src = String(m[2] || "").trim();
    if (!src) return null;
    if (/^(https?:|data:|javascript:|file:)/i.test(src)) return null;
    if (src.indexOf("..") >= 0 || src.charAt(0) === "/" || src.indexOf("\\") >= 0) return null;
    return { alt: m[1] || "", src: src };
  }

  function fillWhatsNewModal() {
    var lead = $("whatsNewLead");
    var body = $("whatsNewBody");
    if (!body) return;
    var from = LAST_SEEN_FROM || "";
    if (lead) {
      lead.textContent = from
        ? t("whatsNewLeadFrom", { from: from, version: APP_VERSION })
        : t("whatsNewLead", { version: APP_VERSION });
    }
    body.replaceChildren();
    var blocks = changelogEntriesSince(from);
    if (!blocks.length) {
      var empty = document.createElement("p");
      empty.className = "muted modal-desc";
      empty.textContent = t("whatsNewLead", { version: APP_VERSION });
      body.appendChild(empty);
      return;
    }
    blocks.forEach(function (block) {
      var section = document.createElement("section");
      var ver = document.createElement("h3");
      ver.className = "whats-new-ver";
      ver.textContent = "v" + block.version;
      var ul = document.createElement("ul");
      ul.className = "whats-new-list";
      block.lines.forEach(function (line) {
        var li = document.createElement("li");
        var media = parseChangelogMedia(line);
        if (media) {
          li.className = "whats-new-media";
          var img = document.createElement("img");
          img.src = media.src;
          img.alt = media.alt || "";
          img.title = t("whatsNewImageZoom");
          img.loading = "lazy";
          img.decoding = "async";
          img.style.cursor = "zoom-in";
          img.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            openWhatsNewLightbox(media.src, media.alt || "");
          });
          li.appendChild(img);
        } else {
          li.textContent = line;
        }
        ul.appendChild(li);
      });
      section.append(ver, ul);
      body.appendChild(section);
    });
  }

  function openWhatsNewModal(fromVersion) {
    LAST_SEEN_FROM = fromVersion || "";
    fillWhatsNewModal();
    var modal = $("whatsNewModal");
    if (modal) modal.hidden = false;
  }

  function dismissWhatsNew() {
    closeWhatsNewLightbox();
    setLastSeenVersion(APP_VERSION);
    LAST_SEEN_FROM = null;
    var modal = $("whatsNewModal");
    if (modal) modal.hidden = true;
  }

  function closeWhatsNewLightbox() {
    var box = $("whatsNewLightbox");
    var img = $("whatsNewLightboxImg");
    if (img) {
      img.removeAttribute("src");
      img.alt = "";
    }
    if (box) box.hidden = true;
  }

  function openWhatsNewLightbox(src, alt) {
    var box = $("whatsNewLightbox");
    var img = $("whatsNewLightboxImg");
    if (!box || !img || !src) return;
    img.src = src;
    img.alt = alt || "";
    var closeBtn = box.querySelector(".whats-new-lightbox-close");
    if (closeBtn) closeBtn.setAttribute("aria-label", t("whatsNewLightboxClose"));
    box.hidden = false;
  }

  function maybeShowWhatsNew() {
    var force = false;
    try {
      force = /(?:\?|&)whatsnew=1(?:&|$)/.test(String(location.search || ""));
    } catch (eForce) { /* ignore */ }
    var last = getLastSeenVersion();
    // First visit: remember version only — no update dialog.
    if (!force && !last) {
      setLastSeenVersion(APP_VERSION);
      return;
    }
    if (!force && last === APP_VERSION) return;
    var blocks = changelogEntriesSince(force ? "" : last);
    if (!blocks.length) {
      if (!force) setLastSeenVersion(APP_VERSION);
      return;
    }
    openWhatsNewModal(force ? (last && last !== APP_VERSION ? last : "") : last);
  }

  document.querySelectorAll("[data-whats-new-close]").forEach(function (node) {
    node.addEventListener("click", dismissWhatsNew);
  });
  document.querySelectorAll("[data-whats-new-lightbox-close]").forEach(function (node) {
    node.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeWhatsNewLightbox();
    });
  });

  var formKeys = [
    el.padL, el.padR, el.padT, el.padB,
    el.cellW, el.cellH, el.spacingX, el.spacingY,
    el.startCorner, el.startAxis, el.childAlign,
    el.constraint, el.constraintCount,
    el.w, el.h, el.canvasW, el.canvasH, el.bg, el.bgAlpha,
  ];
  formKeys.forEach(function (node) {
    if (!node) return;
    node.addEventListener("focus", armFormUndo);
    node.addEventListener("blur", function () { formUndoArmed = false; });
  });

  [el.padL, el.padR, el.padT, el.padB,
    el.cellW, el.cellH, el.spacingX, el.spacingY,
    el.startCorner, el.startAxis, el.childAlign,
    el.constraint, el.constraintCount,
  ].forEach(function (node) {
    ["input", "change"].forEach(function (ev) {
      node.addEventListener(ev, function () {
        if (isCanvas(activeId)) return;
        writeForm();
        reflow(lay());
        refresh();
        requestAutoExport(false);
      });
    });
  });

  function onLayoutSizeInput() {
    if (isCanvas(activeId) || isSizeLocked(activeId)) return;
    writeForm();
    reflow(lay());
    refresh();
  }
  function onLayoutSizeChange() {
    onLayoutSizeInput();
    requestAutoExport(true);
  }
  [el.w, el.h].forEach(function (inp) {
    inp.addEventListener("input", onLayoutSizeInput);
    inp.addEventListener("change", onLayoutSizeChange);
  });

  function onCanvasSizeInput() {
    writeCanvasSize();
    refreshPreview();
  }
  function onCanvasSizeChange() {
    onCanvasSizeInput();
    requestAutoExport(true);
  }
  [el.canvasW, el.canvasH].forEach(function (inp) {
    inp.addEventListener("input", onCanvasSizeInput);
    inp.addEventListener("change", onCanvasSizeChange);
  });

  function onBgChange() {
    if (isCanvas(activeId)) return;
    writeForm();
    refreshPreview();
    requestAutoExport(false);
  }
  el.bg.addEventListener("input", onBgChange);
  el.bg.addEventListener("change", function () {
    onBgChange();
    requestAutoExport(true);
  });
  el.bgAlpha.addEventListener("input", onBgChange);
  el.bgAlpha.addEventListener("change", function () {
    onBgChange();
    requestAutoExport(true);
  });

  if (el.snapBtn) {
    el.snapBtn.onclick = function () {
      snapEnabled = !snapEnabled;
      el.snapBtn.classList.toggle("active", snapEnabled);
      el.snapBtn.title = snapEnabled ? t("snapOn") : t("snapOff");
      status(snapEnabled ? t("snapOn") : t("snapOff"), "ok");
    };
  }

  $("zoomInBtn").onclick = function () { zoom = Math.min(8, zoom * 1.2); applyZoom(); };
  $("zoomOutBtn").onclick = function () { zoom = Math.max(1, zoom / 1.2); applyZoom(); };
  $("zoomResetBtn").onclick = function () {
    zoom = 1;
    applyZoom();
    el.wrap.scrollLeft = el.wrap.scrollTop = 0;
  };
  el.wrap.addEventListener("wheel", function (e) {
    e.preventDefault();
    var r = el.wrap.getBoundingClientRect();
    var ax = e.clientX - r.left, ay = e.clientY - r.top;
    var prev = zoom;
    zoom = Math.min(8, Math.max(1, zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    if (zoom === prev) return;
    var ratio = zoom / prev;
    el.wrap.scrollLeft = (el.wrap.scrollLeft + ax) * ratio - ax;
    el.wrap.scrollTop = (el.wrap.scrollTop + ay) * ratio - ay;
    applyZoom();
  }, { passive: false });

  el.file.onchange = function () { addFiles(el.file.files); el.file.value = ""; };
  // Prevent browser from opening dropped files; only the preview accepts image drops.
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) { e.preventDefault(); });
  bindDrop(el.wrap, function (e) {
    return layoutIdAtClient(e.clientX, e.clientY);
  });

  $("saveProjectBtn").onclick = saveProject;
  $("projectInput").onchange = function () {
    loadProjectFromFile($("projectInput").files && $("projectInput").files[0]);
    $("projectInput").value = "";
  };

  $("exportPngBtn").onclick = exportPng;
  $("changePngPathBtn").onclick = function () {
    if (typeof window.showSaveFilePicker !== "function") return status(t("errNoPathPicker"), "err");
    pickPng().then(function (h) {
      pngHandle = h;
      el.paths.innerHTML = t("pngLine") + "<strong>" + pngHandle.name + "</strong>";
      status(t("pngPathSet", { name: pngHandle.name }), "ok");
      return idb("put", "png", h).catch(function () { return null; });
    }).catch(function (e) {
      if (!e || e.name !== "AbortError") status(String((e && e.message) || e), "err");
    });
  };

  document.querySelectorAll(".canvas-preset").forEach(function (btn) {
    btn.onclick = function () {
      pushUndo();
      el.canvasW.value = btn.getAttribute("data-w");
      el.canvasH.value = btn.getAttribute("data-h");
      writeCanvasSize();
      refreshPreview();
      requestAutoExport(true);
    };
  });
  document.querySelectorAll(".layout-preset").forEach(function (btn) {
    btn.onclick = function () {
      if (!activeId || isCanvas(activeId) || isSizeLocked(activeId)) return;
      pushUndo();
      el.w.value = btn.getAttribute("data-w");
      el.h.value = btn.getAttribute("data-h");
      writeForm();
      reflow(lay());
      refresh();
      requestAutoExport(true);
    };
  });

  window.addEventListener("keydown", function (e) {
    var mod = e.ctrlKey || e.metaKey;
    // Always block the browser "Save page as HTML" shortcut.
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (e.shiftKey) saveProject();
      else exportPng();
      return;
    }
    if (isTypingTarget(e.target)) return;
    if (e.key === "Delete") {
      e.preventDefault();
      removeSelected();
      return;
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copySelection();
      return;
    }
    if (mod && e.key.toLowerCase() === "v") {
      e.preventDefault();
      pasteClipboard();
      return;
    }
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicateSelection();
    }
  });

  window.addEventListener("resize", refreshPreview);

  function refreshPngPathLabel() {
    el.paths.innerHTML = t("pngLine") + "<strong>" + (pngHandle ? pngHandle.name : t("notSelected")) + "</strong>";
  }

  function refreshAlignUi() {
    var cur = el.childAlign.value;
    fillAlign(el.childAlign);
    if (cur) el.childAlign.value = cur;
    if (el.alignPad) {
      el.alignPad.querySelectorAll("button").forEach(function (b) {
        b.title = alignLabel(b.dataset.align);
        b.classList.toggle("active", b.dataset.align === el.childAlign.value);
      });
    }
  }

  function applyLanguageUi() {
    refreshAlignUi();
    syncChrome();
    applyZoom();
    renderTree();
    syncTreeViewMenu();
    refreshPngPathLabel();
    updateFolderWatchBtn();
    var modal = $("folderWatchModal");
    if (modal && !modal.hidden) {
      renderFolderWatchRuleList();
    }
    var whatsNew = $("whatsNewModal");
    if (whatsNew && !whatsNew.hidden) {
      fillWhatsNewModal();
    }
    var statusKey = I18N.findKeyByText(el.status.textContent);
    if (statusKey) {
      var kind = el.status.classList.contains("ok")
        ? "ok"
        : el.status.classList.contains("err") ? "err" : "";
      status(t(statusKey), kind || undefined);
    }
  }

  I18N.applyDom();
  var langSel = $("langSelect");
  if (langSel) {
    langSel.value = I18N.getLang();
    langSel.onchange = function () {
      I18N.setLang(langSel.value);
    };
  }
  I18N.onChange(applyLanguageUi);

  var appVerEl = $("appVersion");
  if (appVerEl) appVerEl.textContent = "v" + APP_VERSION;

  if (el.tree) {
    el.tree.addEventListener("scroll", rememberTreeScroll, { passive: true });
  }

  try {
    var storedThumbs = localStorage.getItem(SHOW_TREE_THUMBS_LS);
    if (storedThumbs === "0" || storedThumbs === "false") showTreeThumbs = false;
    else if (storedThumbs === "1" || storedThumbs === "true") showTreeThumbs = true;
  } catch (eThumbs) { /* ignore */ }
  syncTreeViewMenu();

  canvasId = makeLayout(t("canvas"), null);
  activeId = canvasId;
  readForm();
  refresh();
  updateFolderWatchBtn();
  restoreFolderWatchOnBoot();
  if (typeof window.showSaveFilePicker === "function") {
    idb("get", "png").then(function (h) {
      pngHandle = h;
      refreshPngPathLabel();
    }).catch(function () {});
  }
  status(t("statusReady"));
  maybeShowWhatsNew();
})();
