/**
 * Grid Designer — canvas (scene) + nested layouts → PNG
 *
 * Copyright (c) 2026 AINukeHere
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
  /** Sibling reorder / preview reparent drag: { parentId, index } */
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
  var FOLDER_POLL_MS = 1000;
  var folderHandle = null;
  var folderWatch = {
    enabled: false,
    targetLayoutId: null,
    folderName: "",
  };
  var folderSeenKeys = {};
  var folderPollTimer = null;
  var folderScanBusy = false;
  var folderObserver = null;
  var folderScanDebounce = null;
  var folderPendingStable = {};
  var folderModalDraft = {
    enabled: false,
    targetLayoutId: null,
    folderName: "",
    handle: null,
    clearHandle: false,
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
    };
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

  /** Canvas-direct images + any layout frame are mouse-editable in preview */
  function isInteractiveChild(parentId, ch) {
    if (!ch) return false;
    if (ch.type === "layout") return true;
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
    var cells = computeGrid(Math.max(L.children.length, 1), L.settings);
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

  /** Keep resize aspect ratio from original frame (Shift). */
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

  function byZ(L) {
    return L.children.map(function (_, i) { return i; }).sort(function (a, b) {
      return ((L.children[a].frame && L.children[a].frame.z) || 0) -
        ((L.children[b].frame && L.children[b].frame.z) || 0);
    });
  }

  /** Canvas: free z-order. Layout: hierarchy / children array order. */
  function childPaintOrder(L) {
    if (!L) return [];
    if (isCanvas(L.id)) return byZ(L);
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
      var key = ch.refId || (r.parentId + ":" + r.index);
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
      childDrag = { parentId: parentId, index: index };
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
      if (!isCanvas(parentId)) reflow(parent);
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

  function renderTree() {
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
      parent.children.forEach(function (ch, i) {
        var li = document.createElement("li");
        var pad = document.createElement("span");
        pad.className = "tree-pad";
        pad.style.width = depth * 12 + "px";

        if (ch.type === "layout" && layouts[ch.refId]) {
          var L = layouts[ch.refId];
          var layActive = activeId === L.id && selectedChild < 0;
          var hasKids = L.children.length > 0;
          var isClosed = !!collapsed[L.id];
          li.className = "tree-item tree-layout" + (layActive ? " active" : "") +
            (isClosed ? " collapsed" : "");
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

          li.append(pad, twist, nm, meta);
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
          li.className = "tree-item tree-image" + (imgActive ? " active" : "");

          var spacer = document.createElement("span");
          spacer.className = "tree-twist empty";
          spacer.textContent = "·";

          var thumb = makeTreeThumb(entry);
          var inm = document.createElement("div");
          inm.className = "name";
          inm.textContent = entry ? entry.name : t("imageFallback");
          li.append(pad, spacer, thumb, inm);
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

  function toLocal(clientX, clientY, layoutId) {
    var stage =
      layoutId === canvasId
        ? el.stage
        : el.stage.querySelector('.nested-stage[data-layout-id="' + layoutId + '"]') || el.stage;
    var r = stage.getBoundingClientRect();
    var s = ns(layouts[layoutId].settings);
    return {
      x: (clientX - r.left) * (s.width / Math.max(1, r.width)),
      y: (clientY - r.top) * (s.height / Math.max(1, r.height)),
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
    syncChrome();
  }

  var refreshRaf = 0;
  var refreshWantFull = false;

  function refreshPreviewNow() {
    writeForm();
    paint(el.stage, canvasId, 0, activeId !== canvasId ? activeId : null);
    applyZoom();
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

  function folderFileKey(file) {
    // Name-only: size/mtime change while a file is still being written,
    // which previously caused the same image to be imported twice.
    return file.name;
  }

  function normalizeFolderSeen(raw) {
    var out = {};
    Object.keys(raw || {}).forEach(function (k) {
      var name = String(k).split("|")[0];
      if (name) out[name] = true;
    });
    return out;
  }

  function loadFolderWatchSettings() {
    try {
      var raw = localStorage.getItem(FOLDER_WATCH_LS);
      if (raw) {
        var parsed = JSON.parse(raw);
        folderWatch.enabled = !!parsed.enabled;
        folderWatch.targetLayoutId = parsed.targetLayoutId || null;
        folderWatch.folderName = parsed.folderName || "";
      } else {
        folderWatch.enabled = false;
      }
    } catch (e) {
      folderWatch.enabled = false;
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
        targetLayoutId: folderWatch.targetLayoutId,
        folderName: folderWatch.folderName || "",
      }));
    } catch (e) { /* ignore */ }
  }

  function persistFolderSeen() {
    try {
      localStorage.setItem(FOLDER_SEEN_LS, JSON.stringify(folderSeenKeys));
    } catch (e) { /* ignore */ }
  }

  function resolveFolderWatchTargetId() {
    var id = folderWatch.targetLayoutId;
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
    var on = !!(folderWatch.enabled && folderHandle);
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

  function updateFolderWatchFolderLabel(name) {
    var lab = $("folderWatchFolderLabel");
    if (!lab) return;
    if (name) {
      lab.removeAttribute("data-i18n");
      lab.textContent = name;
    } else {
      lab.setAttribute("data-i18n", "folderWatchNoFolder");
      lab.textContent = t("folderWatchNoFolder");
    }
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

  function seedFolderSeenFromHandle(handle) {
    return iterateFolderImageFiles(handle, function (file) {
      folderSeenKeys[folderFileKey(file)] = true;
    }).then(function () {
      persistFolderSeen();
    });
  }

  function scanWatchFolder() {
    if (!folderWatch.enabled || !folderHandle || !canvasId || folderScanBusy) return;
    folderScanBusy = true;
    ensureFolderReadPermission(folderHandle, false).then(function (ok) {
      if (!ok) {
        folderScanBusy = false;
        return;
      }
      var fresh = [];
      var alive = {};
      return iterateFolderImageFiles(folderHandle, function (file) {
        var key = folderFileKey(file);
        alive[key] = true;
        if (folderSeenKeys[key]) return;

        // Wait until size/mtime stay unchanged across scans (file write finished).
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
          if (!alive[k]) delete folderPendingStable[k];
        });
        if (!fresh.length) return;
        persistFolderSeen();
        addFiles(fresh, resolveFolderWatchTargetId());
      });
    }).catch(function () {
      /* ignore scan errors */
    }).then(function () {
      folderScanBusy = false;
    });
  }

  function startFolderWatch() {
    stopFolderWatch();
    if (!folderWatch.enabled || !folderHandle) {
      updateFolderWatchBtn();
      return;
    }
    updateFolderWatchBtn();
    if (typeof FileSystemObserver === "function") {
      try {
        folderObserver = new FileSystemObserver(function () {
          scheduleFolderScan();
        });
        folderObserver.observe(folderHandle, { recursive: false });
      } catch (e) {
        folderObserver = null;
      }
    }
    // Polling is a backup; observer + debounce cover most updates.
    folderPollTimer = setInterval(scheduleFolderScan, FOLDER_POLL_MS);
    scheduleFolderScan();
  }

  function openFolderWatchModal() {
    var modal = $("folderWatchModal");
    if (!modal) return;
    folderModalDraft.enabled = !!folderWatch.enabled;
    folderModalDraft.targetLayoutId = folderWatch.targetLayoutId || canvasId;
    folderModalDraft.folderName = folderWatch.folderName || (folderHandle && folderHandle.name) || "";
    folderModalDraft.handle = folderHandle;
    folderModalDraft.clearHandle = false;

    var en = $("folderWatchEnabled");
    if (en) en.checked = folderModalDraft.enabled;
    fillFolderWatchTargetSelect($("folderWatchTarget"), folderModalDraft.targetLayoutId);
    updateFolderWatchFolderLabel(folderModalDraft.folderName);

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
    var pickBtn = $("folderWatchPickBtn");
    if (pickBtn) pickBtn.disabled = !supportsFolderWatch();

    modal.hidden = false;
  }

  function closeFolderWatchModal() {
    var modal = $("folderWatchModal");
    if (modal) modal.hidden = true;
  }

  function saveFolderWatchModal() {
    var en = $("folderWatchEnabled");
    var target = $("folderWatchTarget");
    var wantEnable = !!(en && en.checked);
    var targetId = target && target.value ? target.value : canvasId;

    if (wantEnable && !folderModalDraft.handle && !folderHandle) {
      status(t("folderWatchNeedFolder"), "err");
      return;
    }
    if (wantEnable && !supportsFolderWatch()) {
      status(t("folderWatchUnsupported"), "err");
      return;
    }

    var prevHandle = folderHandle;
    if (folderModalDraft.clearHandle) {
      folderHandle = null;
      folderWatch.folderName = "";
      idb("del", "watchFolder").catch(function () {});
      folderSeenKeys = {};
      persistFolderSeen();
    } else if (folderModalDraft.handle) {
      folderHandle = folderModalDraft.handle;
      folderWatch.folderName = folderHandle.name || folderModalDraft.folderName || "";
    }

    folderWatch.enabled = wantEnable && !!folderHandle;
    folderWatch.targetLayoutId = targetId && layouts[targetId] ? targetId : canvasId;
    persistFolderWatchSettings();

    var finish = function () {
      if (folderHandle) {
        return idb("put", "watchFolder", folderHandle).catch(function () { return null; });
      }
      return Promise.resolve();
    };

    var afterSeed = Promise.resolve();
    if (folderWatch.enabled && folderHandle && folderHandle !== prevHandle) {
      folderSeenKeys = {};
      afterSeed = seedFolderSeenFromHandle(folderHandle);
    } else if (folderWatch.enabled && folderHandle && !Object.keys(folderSeenKeys).length) {
      afterSeed = seedFolderSeenFromHandle(folderHandle);
    }

    afterSeed.then(finish).then(function () {
      if (folderWatch.enabled) startFolderWatch();
      else stopFolderWatch();
      updateFolderWatchBtn();
      closeFolderWatchModal();
      status(t("folderWatchSaved"), "ok");
    });
  }

  function pickWatchFolder() {
    if (!supportsFolderWatch()) {
      status(t("folderWatchUnsupported"), "err");
      return;
    }
    window.showDirectoryPicker({ mode: "read" }).then(function (handle) {
      folderModalDraft.handle = handle;
      folderModalDraft.clearHandle = false;
      folderModalDraft.folderName = handle.name || "";
      updateFolderWatchFolderLabel(folderModalDraft.folderName);
    }).catch(function (e) {
      if (!e || e.name !== "AbortError") status(String((e && e.message) || e), "err");
    });
  }

  function clearWatchFolderDraft() {
    folderModalDraft.handle = null;
    folderModalDraft.clearHandle = true;
    folderModalDraft.folderName = "";
    updateFolderWatchFolderLabel("");
  }

  function restoreFolderWatchOnBoot() {
    loadFolderWatchSettings();
    updateFolderWatchBtn();
    if (!supportsFolderWatch()) return;
    idb("get", "watchFolder").then(function (h) {
      folderHandle = h || null;
      if (folderHandle && !folderWatch.folderName) {
        folderWatch.folderName = folderHandle.name || "";
        persistFolderWatchSettings();
      }
      updateFolderWatchBtn();
      if (!folderWatch.enabled || !folderHandle) return;
      return ensureFolderReadPermission(folderHandle, true).then(function (ok) {
        if (!ok) {
          status(t("folderWatchPermission"), "err");
          return;
        }
        var seed = Object.keys(folderSeenKeys).length
          ? Promise.resolve()
          : seedFolderSeenFromHandle(folderHandle);
        return seed.then(function () { startFolderWatch(); });
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
  var PROJECT_VERSION = 1;

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
      selectedChild = -1;
      previewSel = { parentId: null, index: -1 };
      clearImageSel();
      readForm();
      refresh();
    });
  }

  function saveProject() {
    var includeImages = !!( $("saveWithImages") && $("saveWithImages").checked );
    status(includeImages ? t("savingWithImages") : t("savingStructure"));
    buildProject(includeImages).then(function (project) {
      downloadJson(project, "grid-designer-structure.json");
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
        importProject(data).then(function () {
          var nLay = Object.keys(layouts).length;
          var nImg = Object.keys(images).length;
          status(t("loaded", { nLay: nLay, nImg: nImg }), "ok");
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

      previewSel = { parentId: parentId, index: idx };
      maxZ += 1;
      ch.frame.z = maxZ;

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

      var p2 = toLocal(e.clientX, e.clientY, parentId);
      var fr = ch.frame;
      pushUndo();
      drag = {
        mode: handle ? "resize" : "move",
        layoutId: parentId,
        index: idx,
        handle: handle ? handle.dataset.handle : null,
        x0: p2.x,
        y0: p2.y,
        orig: { x: fr.x, y: fr.y, w: fr.w, h: fr.h },
        undoPushed: true,
      };
      refreshPreview();
      renderTree();
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
    var lockAspect = e.shiftKey && drag.mode === "resize" &&
      ch.type === "image" && isCanvas(drag.layoutId);
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
      layouts[ch.refId].settings.width = ch.frame.w;
      layouts[ch.refId].settings.height = ch.frame.h;
      if (activeId === ch.refId) {
        el.w.value = ch.frame.w;
        el.h.value = ch.frame.h;
      }
      if (drag.mode === "resize") reflowIfLayout(ch.refId);
    }
    refreshPreview();
    e.preventDefault();
  });

  window.addEventListener("mouseup", function () {
    if (!drag) return;
    var finished = drag;
    drag = null;
      var PL = layouts[finished.layoutId];
      var pch = PL && PL.children[finished.index];
    var fr = pch && pch.frame;
    var o = finished.orig;
    var changed = !!(fr && o && (
      fr.x !== o.x || fr.y !== o.y || fr.w !== o.w || fr.h !== o.h
    ));
    if (!changed && finished.undoPushed && undoStack.length) undoStack.pop();
    if (finished.mode === "resize" && pch && pch.type === "layout") reflowIfLayout(pch.refId);
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

  if ($("addMenuBtn")) {
    $("addMenuBtn").onclick = function (e) {
      e.stopPropagation();
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
  document.addEventListener("mousedown", function (e) {
    var menu = $("addMenu");
    if (!menu || menu.contains(e.target)) return;
    closeAddMenu();
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
  if ($("folderWatchPickBtn")) {
    $("folderWatchPickBtn").onclick = pickWatchFolder;
  }
  if ($("folderWatchClearBtn")) {
    $("folderWatchClearBtn").onclick = clearWatchFolderDraft;
  }
  if ($("folderWatchSaveBtn")) {
    $("folderWatchSaveBtn").onclick = saveFolderWatchModal;
  }
  document.querySelectorAll("[data-folder-watch-close]").forEach(function (node) {
    node.addEventListener("click", closeFolderWatchModal);
  });
  window.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var modal = $("folderWatchModal");
    if (modal && !modal.hidden) {
      e.preventDefault();
      closeFolderWatchModal();
    }
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
    refreshPngPathLabel();
    updateFolderWatchBtn();
    var modal = $("folderWatchModal");
    if (modal && !modal.hidden) {
      fillFolderWatchTargetSelect(
        $("folderWatchTarget"),
        ($("folderWatchTarget") && $("folderWatchTarget").value) || folderWatch.targetLayoutId || canvasId
      );
      var draftName = folderModalDraft.folderName || (folderModalDraft.handle && folderModalDraft.handle.name) || "";
      updateFolderWatchFolderLabel(draftName);
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
})();
