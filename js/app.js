/**
 * OBS Grid Designer — canvas (scene) + nested layouts → PNG
 *
 * Canvas = free container (like OBS scene). No grid.
 * Layout = grid. Nested under a layout: size locked to parent cell, content 1:1 (no squash).
 */
(function () {
  "use strict";

  var G = window.ObsGrid;
  if (!G) {
    document.getElementById("status").textContent = "grid.js 로드 실패";
    return;
  }

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
  /** Sibling reorder in hierarchy tree: { parentId, index } */
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
    clearBg: $("transparentBg"),
    bg: $("bgColor"),
    bgRow: $("bgColorRow"),
    status: $("status"),
    paths: $("savePaths"),
    stage: $("previewStage"),
    shell: $("previewShell"),
    wrap: $("previewWrap"),
    meta: $("previewMeta"),
    badge: $("canvasSizeBadge"),
    zoomLabel: $("zoomLabel"),
    canvas: $("exportCanvas"),
    file: $("fileInput"),
    reflowBtn: $("reflowGridBtn"),
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

  function makeLayout(name, parentId) {
    var id = uid("lay");
    layouts[id] = {
      id: id,
      name: name || "Layout",
      parentId: parentId || null,
      settings: defaultSettings(),
      transparentBg: true,
      bgColor: "#000000",
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
      var z = ch.frame && ch.frame.z != null ? ch.frame.z : i + 1;
      ch.frame = makeFrame(cells[i], i);
      ch.frame.z = z;
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
    var right = x + w;
    var bottom = y + h;
    if (handle.indexOf("e") >= 0) {
      right += snapDelta([right], guides.x, thresh);
      w = Math.max(24, right - x);
    }
    if (handle.indexOf("w") >= 0) {
      var nx = x + snapDelta([x], guides.x, thresh);
      w = Math.max(24, right - nx);
      x = right - w;
    }
    if (handle.indexOf("s") >= 0) {
      bottom += snapDelta([bottom], guides.y, thresh);
      h = Math.max(24, bottom - y);
    }
    if (handle.indexOf("n") >= 0) {
      var ny = y + snapDelta([y], guides.y, thresh);
      h = Math.max(24, bottom - ny);
      y = bottom - h;
    }
    return { x: x, y: y, w: w, h: h };
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

  function fillAlign(sel) {
    sel.replaceChildren();
    ALIGNS.forEach(function (k) {
      var o = document.createElement("option");
      o.value = k;
      o.textContent = k.split("-").map(function (p) {
        return p.charAt(0).toUpperCase() + p.slice(1);
      }).join(" ");
      sel.appendChild(o);
    });
  }

  function syncChrome() {
    var isC = isCanvas(activeId);
    var locked = isSizeLocked(activeId);
    if (el.layoutSettings) el.layoutSettings.hidden = !!isC;
    if (el.noLayoutHint) el.noLayoutHint.hidden = !isC;
    if (el.layoutPresets) el.layoutPresets.hidden = isC || locked;
    el.sizeLockHint.hidden = !locked;
    el.w.disabled = locked;
    el.h.disabled = locked;
    if (el.reflowBtn) {
      el.reflowBtn.disabled = !!isC;
      el.reflowBtn.title = isC ? "캔버스에는 격자가 없습니다" : "격자 재배치";
    }
    if (el.snapBtn) {
      el.snapBtn.classList.toggle("active", snapEnabled);
      el.snapBtn.title = snapEnabled ? "자석 스냅 ON" : "자석 스냅 OFF";
    }
    var fixed = !isC && el.constraint.value !== "auto";
    el.constraintCountRow.hidden = !fixed;
    var c = canvasSize();
    el.badge.textContent = "캔버스 " + c.w + " × " + c.h;
    el.alignPad.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.align === el.childAlign.value);
    });
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
    el.badge.textContent = "캔버스 " + L.settings.width + " × " + L.settings.height;
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
    el.clearBg.checked = L.transparentBg !== false;
    el.bg.value = L.bgColor || "#000000";
    el.bg.disabled = el.clearBg.checked;
    el.bgRow.style.opacity = el.clearBg.checked ? "0.5" : "1";
    syncChrome();
  }

  function writeForm() {
    writeCanvasSize();
    var L = lay();
    if (!L || isCanvas(L.id)) {
      syncChrome();
      return;
    }
    L.transparentBg = el.clearBg.checked;
    L.bgColor = el.bg.value;

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

  function selectChildNode(parentId, index) {
    var parent = layouts[parentId];
    if (!parent || !parent.children[index]) return;
    writeForm();
    var ch = parent.children[index];
    if (ch.type === "layout" && layouts[ch.refId]) {
      selectLayout(ch.refId);
      return;
    }
    activeId = parentId;
    selectedChild = index;
    expandAncestors(parentId);
    previewSel = isInteractiveChild(parentId, ch)
      ? { parentId: parentId, index: index }
      : { parentId: null, index: -1 };
    readForm();
    refresh();
  }

  function bindSiblingDrag(li, parentId, index) {
    li.draggable = true;
    li.ondragstart = function (e) {
      childDrag = { parentId: parentId, index: index };
      li.classList.add("dragging");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    };
    li.ondragend = function () {
      childDrag = null;
      li.classList.remove("dragging");
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
      if (activeId === parentId) selectedChild = index;
      if (!isCanvas(parentId)) reflow(parent);
      refresh();
    };
  }

  function renderTree() {
    el.tree.replaceChildren();
    if (!canvasId || !layouts[canvasId]) return;

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

          var twist = document.createElement("button");
          twist.type = "button";
          twist.className = "tree-twist" + (hasKids ? "" : " empty");
          twist.title = hasKids ? (isClosed ? "펼치기" : "접기") : "";
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

          var meta = document.createElement("div");
          meta.className = "muted";
          meta.textContent = String(L.children.length);

          li.append(pad, twist, nm, meta);
          li.onclick = function () { selectLayout(L.id); };
          bindSiblingDrag(li, parentId, i);
          el.tree.appendChild(li);
          if (!isClosed) appendChildren(L.id, depth + 1);
          return;
        }

        if (ch.type === "image") {
          var imgActive = activeId === parentId && selectedChild === i;
          var entry = images[ch.refId];
          li.className = "tree-item tree-image" + (imgActive ? " active" : "");

          var spacer = document.createElement("span");
          spacer.className = "tree-twist empty";
          spacer.textContent = "·";

          var thumb = document.createElement("img");
          thumb.alt = "";
          if (entry) thumb.src = entry.url;
          var inm = document.createElement("div");
          inm.className = "name";
          inm.textContent = entry ? entry.name : "(이미지)";
          li.append(pad, spacer, thumb, inm);
          li.onclick = function () { selectChildNode(parentId, i); };
          bindSiblingDrag(li, parentId, i);
          el.tree.appendChild(li);
        }
      });
    }

    appendChildren(canvasId, 0);
  }

  function paint(container, layoutId, depth, highlightId) {
    var L = layouts[layoutId];
    if (!L || depth > 20) return;
    ensureFrames(L);
    var s = ns(L.settings);
    container.dataset.layoutId = layoutId;
    container.style.width = s.width + "px";
    container.style.height = s.height + "px";
    container.style.background = L.transparentBg !== false ? "transparent" : (L.bgColor || "#000");
    container.replaceChildren();

    byZ(L).forEach(function (i) {
      var ch = L.children[i];
      var f = ch.frame;
      var interactive = isInteractiveChild(layoutId, ch);
      var cell = document.createElement("div");
      cell.className = "grid-cell" + (interactive ? " interactive" : "");
      cell.dataset.parentId = layoutId;
      cell.dataset.childIndex = String(i);
      cell.style.cssText =
        "left:" + f.x + "px;top:" + f.y + "px;width:" + f.w + "px;height:" + f.h + "px;z-index:" + (f.z || i + 1);
      if (ch.type === "layout" && ch.refId === highlightId) cell.classList.add("highlight-nested");
      if (interactive && previewSel.parentId === layoutId && previewSel.index === i) {
        cell.classList.add("selected");
        ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach(function (h) {
          var d = document.createElement("div");
          d.className = "resize-handle " + h;
          d.dataset.handle = h;
          cell.appendChild(d);
        });
      }
      if (ch.type === "image" && images[ch.refId] && images[ch.refId].img) {
        var img = document.createElement("img");
        img.src = images[ch.refId].url;
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
        var lab = document.createElement("span");
        lab.className = "grid-cell-label";
        lab.textContent = String(i + 1) + (ch.type === "layout" ? " #" : "");
        cell.appendChild(lab);
      }
      container.appendChild(cell);
    });
  }

  function draw(ctx, layoutId, ox, oy, depth) {
    var L = layouts[layoutId];
    if (!L || depth > 20) return;
    ensureFrames(L);
    var s = ns(L.settings);
    if (L.transparentBg === false) {
      ctx.fillStyle = L.bgColor || "#000";
      ctx.fillRect(ox, oy, s.width, s.height);
    }
    byZ(L).forEach(function (i) {
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
    var editName = activeId !== canvasId && layouts[activeId] ? layouts[activeId].name : "캔버스";
    el.meta.textContent = "캔버스 " + s.width + "×" + s.height + " · 편집: " + editName;
    if ($("zoomOutBtn")) $("zoomOutBtn").disabled = zoom <= 1;
    syncChrome();
  }

  function refreshPreview() {
    writeForm();
    paint(el.stage, canvasId, 0, activeId !== canvasId ? activeId : null);
    applyZoom();
  }

  function refresh() {
    renderTree();
    refreshPreview();
  }

  function addFiles(list) {
    var files = [].slice.call(list || []).filter(function (f) {
      return f.type && f.type.indexOf("image/") === 0;
    });
    if (!files.length) return status("이미지 파일만 추가할 수 있습니다.", "err");
    var L = lay();
    if (!L) return status("레이아웃을 먼저 선택하세요.", "err");

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
          img.onerror = function () { reject(new Error("이미지 로드 실패")); };
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
      refresh();
      status(files.length + "개 이미지 추가됨", "ok");
    }).catch(function (e) {
      if (undoStack.length) undoStack.pop();
      status(String(e.message || e), "err");
    });
  }

  function bindDrop(node) {
    if (!node) return;
    node.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.stopPropagation();
      node.classList.add("dragover");
    });
    node.addEventListener("dragleave", function (e) {
      if (!node.contains(e.relatedTarget)) node.classList.remove("dragover");
    });
    node.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      node.classList.remove("dragover");
      if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
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
        var r = op === "get" ? store.get(key) : store.put(val, key);
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

  function savePng(blob) {
    function hint() {
      el.paths.innerHTML = "PNG: <strong>" + (pngHandle ? pngHandle.name : "(미선택)") + "</strong>";
    }
    if (typeof window.showSaveFilePicker !== "function") {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "obs-grid.png";
      a.click();
      status("다운로드로 저장됨", "err");
      return Promise.resolve();
    }
    function ensurePermission(handle) {
      return handle.queryPermission({ mode: "readwrite" }).then(function (st) {
        if (st === "granted") return true;
        return handle.requestPermission({ mode: "readwrite" }).then(function (n) {
          return n === "granted";
        });
      });
    }
    function writeBlob(handle) {
      return ensurePermission(handle).then(function (ok) {
        if (!ok) throw new Error("쓰기 권한 없음");
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
    if (!pngHandle) return pickPng().then(write);
    return write(pngHandle).catch(function (e) {
      if (e && e.name === "AbortError") throw e;
      // Permission lost / handle stale → ask for a path again
      return pickPng().then(write);
    });
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
      if (!blob) return status("PNG 실패", "err");
      savePng(blob).then(function (name) {
        if (name) status("'" + name + "' 덮어씀", "ok");
      }).catch(function (e) {
        if (e && e.name !== "AbortError") status(String(e.message || e), "err");
      });
    }, "image/png");
  }

  var PROJECT_KIND = "obs-grid-designer";
  var PROJECT_VERSION = 1;

  function cloneLayoutsMap(src) {
    var out = {};
    Object.keys(src).forEach(function (id) {
      var L = src[id];
      out[id] = {
        id: L.id,
        name: L.name,
        parentId: L.parentId,
        settings: Object.assign({}, L.settings),
        transparentBg: L.transparentBg !== false,
        bgColor: L.bgColor || "#000000",
        children: (L.children || []).map(function (ch) {
          return {
            type: ch.type,
            refId: ch.refId,
            frame: ch.frame ? Object.assign({}, ch.frame) : null,
          };
        }),
      };
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
    maxZ = Math.max(1, +snap.maxZ || 1);
    readCanvasSize();
    readForm();
    refresh();
    undoSuspended = false;
  }

  function undo() {
    if (!undoStack.length) {
      status("되돌릴 작업이 없습니다.");
      return;
    }
    restoreState(undoStack.pop());
    status("실행 취소", "ok");
  }

  function clearUndo() {
    undoStack = [];
    formUndoArmed = false;
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
        reader.onerror = function () { reject(reader.error || new Error("이미지 읽기 실패")); };
        reader.readAsDataURL(entry.file);
      });
    }
    return new Promise(function (resolve, reject) {
      var im = entry.img;
      if (!im) return reject(new Error("이미지 없음"));
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

  function buildProject() {
    writeForm();
    var ids = collectUsedImageIds(canvasId);
    var chain = Promise.resolve();
    var imagePayload = {};
    ids.forEach(function (id) {
      chain = chain.then(function () {
        var entry = images[id];
        if (!entry) return;
        return imageToDataUrl(entry).then(function (dataUrl) {
          imagePayload[id] = { id: id, name: entry.name || id, dataUrl: dataUrl };
        });
      });
    });
    return chain.then(function () {
      return {
        kind: PROJECT_KIND,
        version: PROJECT_VERSION,
        canvasId: canvasId,
        maxZ: maxZ,
        layouts: cloneLayoutsMap(layouts),
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
    if (!data || typeof data !== "object") throw new Error("잘못된 파일입니다.");
    if (data.kind !== PROJECT_KIND) throw new Error("OBS Grid Designer 구조 파일이 아닙니다.");
    if (+data.version !== PROJECT_VERSION) throw new Error("지원하지 않는 구조 버전입니다.");
    if (!data.canvasId || !data.layouts || !data.layouts[data.canvasId]) {
      throw new Error("캔버스 정보가 없습니다.");
    }
  }

  function importProject(data) {
    validateProject(data);
    var nextLayouts = cloneLayoutsMap(data.layouts);
    var imgEntries = data.images || {};
    var nextImages = {};
    var chain = Promise.resolve();
    Object.keys(imgEntries).forEach(function (id) {
      chain = chain.then(function () {
        return new Promise(function (resolve, reject) {
          var e = imgEntries[id];
          var dataUrl = e && e.dataUrl;
          if (!dataUrl) return resolve();
          var img = new Image();
          img.onload = function () {
            nextImages[id] = {
              id: id,
              name: (e && e.name) || id,
              url: dataUrl,
              file: null,
              img: img,
            };
            resolve();
          };
          img.onerror = function () { reject(new Error("이미지 로드 실패: " + ((e && e.name) || id))); };
          img.src = dataUrl;
        });
      });
    });
    return chain.then(function () {
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
      readForm();
      refresh();
    });
  }

  function saveProject() {
    status("구조 저장 중…");
    buildProject().then(function (project) {
      downloadJson(project, "grid-composer-structure.json");
      var nLay = Object.keys(project.layouts).length;
      var nImg = Object.keys(project.images).length;
      status("구조 저장됨 (" + nLay + " 레이아웃, " + nImg + " 이미지)", "ok");
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
        if (hasContent && !window.confirm("현재 작업 내용을 덮어쓸까요?")) {
          status("불러오기 취소됨");
          return;
        }
        status("구조 불러오는 중…");
        importProject(data).then(function () {
          var nLay = Object.keys(layouts).length;
          var nImg = Object.keys(images).length;
          status("구조 불러옴 (" + nLay + " 레이아웃, " + nImg + " 이미지)", "ok");
        }).catch(function (e) {
          status(String((e && e.message) || e), "err");
        });
      } catch (e) {
        status("JSON 파싱 실패: " + String((e && e.message) || e), "err");
      }
    };
    reader.onerror = function () { status("파일 읽기 실패", "err"); };
    reader.readAsText(file);
  }

  function selectCanvasFromEmpty() {
    // No layout selected in tree; images add as top-level siblings of layouts
    if (activeId !== canvasId || previewSel.parentId != null || selectedChild >= 0) {
      selectLayout(canvasId);
    } else {
      previewSel = { parentId: null, index: -1 };
      selectedChild = -1;
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
        if (activeId !== ch.refId) {
          activeId = ch.refId;
          selectedChild = -1;
          readForm();
        } else {
          selectedChild = -1;
        }
        expandAncestors(ch.refId);
      } else {
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
    if (e.target !== el.wrap && e.target !== el.shell && e.target !== el.badge) return;
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
    if (snapEnabled) {
      var guides = collectSnapGuides(drag.layoutId, drag.index);
      var snapped = drag.mode === "move"
        ? snapMoveRect(x, y, w, h, guides, SNAP_THRESH)
        : snapResizeRect(x, y, w, h, drag.handle || "", guides, SNAP_THRESH);
      x = snapped.x;
      y = snapped.y;
      w = snapped.w;
      h = snapped.h;
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
    if (changed) status("프레임 수정됨", "ok");
  });

  // wire
  fillAlign(el.childAlign);
  ALIGNS.forEach(function (k) {
    var b = document.createElement("button");
    b.type = "button";
    b.dataset.align = k;
    b.title = k;
    b.onclick = function () {
      if (isCanvas(activeId)) return;
      pushUndo();
      el.childAlign.value = k;
      writeForm();
      reflow(lay());
      refresh();
    };
    el.alignPad.appendChild(b);
  });

  $("addChildLayoutBtn").onclick = function () {
    var parent = lay();
    if (!parent) return;
    writeForm();
    pushUndo();
    var layoutCount = parent.children.filter(function (ch) { return ch.type === "layout"; }).length;
    var id = makeLayout(
      isCanvas(parent.id) ? ("Layout " + (layoutCount + 1)) : (parent.name + " / Child"),
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
  };

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
    var L = lay();
    if (!L) return false;
    if (selectedChild >= 0) {
      var ch = L.children[selectedChild];
      pushUndo();
      if (ch && ch.type === "layout" && ch.refId) {
        deleteLayoutById(ch.refId);
        status("레이아웃 제거됨", "ok");
        return true;
      }
      L.children.splice(selectedChild, 1);
      selectedChild = -1;
      previewSel = { parentId: null, index: -1 };
      if (!isCanvas(L.id)) reflow(L);
      refresh();
      status("이미지 제거됨", "ok");
      return true;
    }
    if (isCanvas(L.id)) {
      status("제거할 항목을 선택하세요.", "err");
      return false;
    }
    pushUndo();
    deleteLayoutById(L.id);
    status("레이아웃 제거됨", "ok");
    return true;
  }

  $("removeNodeBtn").onclick = function () { removeSelected(); };

  $("clearChildrenBtn").onclick = function () {
    var L = lay();
    if (!L || !L.children.length) return;
    var label = isCanvas(L.id) ? "캔버스" : ("'" + L.name + "'");
    if (!confirm(label + "의 자식 항목을 모두 제거할까요?")) return;
    pushUndo();
    L.children = [];
    selectedChild = -1;
    previewSel = { parentId: null, index: -1 };
    if (!isCanvas(L.id)) reflow(L);
    refresh();
  };

  el.reflowBtn.onclick = function () {
    var L = lay();
    if (!L || isCanvas(L.id)) return status("캔버스에는 격자가 없습니다. 레이아웃을 선택하세요.", "err");
    writeForm();
    pushUndo();
    reflow(L);
    selectedChild = -1;
    refresh();
    status("격자 재배치 완료", "ok");
  };

  var formKeys = [
    el.padL, el.padR, el.padT, el.padB,
    el.cellW, el.cellH, el.spacingX, el.spacingY,
    el.startCorner, el.startAxis, el.childAlign,
    el.constraint, el.constraintCount,
    el.w, el.h, el.canvasW, el.canvasH, el.clearBg, el.bg,
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
      });
    });
  });

  function onLayoutSizeChange() {
    if (isCanvas(activeId) || isSizeLocked(activeId)) return;
    writeForm();
    reflow(lay());
    refresh();
  }
  [el.w, el.h].forEach(function (inp) {
    inp.addEventListener("change", onLayoutSizeChange);
    inp.addEventListener("input", onLayoutSizeChange);
  });

  function onCanvasSizeChange() {
    writeCanvasSize();
    refreshPreview();
  }
  [el.canvasW, el.canvasH].forEach(function (inp) {
    inp.addEventListener("change", onCanvasSizeChange);
    inp.addEventListener("input", onCanvasSizeChange);
  });

  el.clearBg.onchange = function () {
    if (isCanvas(activeId)) return;
    el.bg.disabled = el.clearBg.checked;
    el.bgRow.style.opacity = el.clearBg.checked ? "0.5" : "1";
    writeForm();
    refreshPreview();
  };
  el.bg.oninput = function () {
    if (isCanvas(activeId)) return;
    writeForm();
    refreshPreview();
  };

  if (el.snapBtn) {
    el.snapBtn.onclick = function () {
      snapEnabled = !snapEnabled;
      el.snapBtn.classList.toggle("active", snapEnabled);
      el.snapBtn.title = snapEnabled ? "자석 스냅 ON" : "자석 스냅 OFF";
      status(snapEnabled ? "자석 스냅 ON" : "자석 스냅 OFF", "ok");
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
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });
  bindDrop(el.wrap);
  bindDrop(el.hierarchy);

  $("saveProjectBtn").onclick = saveProject;
  $("projectInput").onchange = function () {
    loadProjectFromFile($("projectInput").files && $("projectInput").files[0]);
    $("projectInput").value = "";
  };

  $("exportPngBtn").onclick = exportPng;
  $("changePngPathBtn").onclick = function () {
    if (typeof window.showSaveFilePicker !== "function") return status("이 브라우저는 위치 고정을 지원하지 않습니다.", "err");
    pickPng().then(function (h) {
      pngHandle = h;
      el.paths.innerHTML = "PNG: <strong>" + pngHandle.name + "</strong>";
      status("PNG 위치: " + pngHandle.name, "ok");
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
    };
  });

  window.addEventListener("keydown", function (e) {
    if (isTypingTarget(e.target)) return;
    if (e.key === "Delete") {
      e.preventDefault();
      removeSelected();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    }
  });

  window.addEventListener("resize", refreshPreview);

  canvasId = makeLayout("Canvas", null);
  activeId = canvasId;
  readForm();
  refresh();
  if (typeof window.showSaveFilePicker === "function") {
    idb("get", "png").then(function (h) {
      pngHandle = h;
      el.paths.innerHTML = "PNG: <strong>" + (h ? h.name : "(미선택)") + "</strong>";
    }).catch(function () {});
  }
  status("캔버스에 레이아웃을 추가하거나 이미지를 드롭하세요");
})();
