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
  var childDrag = -1;
  var maxZ = 1;
  var pngHandle = null;
  var zoom = 1;
  var drag = null;
  var snapEnabled = true;
  var SNAP_THRESH = 8;

  var el = {
    tree: $("layoutTree"),
    kids: $("childList"),
    kidHint: $("childHint"),
    kidsPanel: $("childrenPanel"),
    heading: $("settingsHeading"),
    name: $("layoutName"),
    w: $("width"),
    h: $("height"),
    wLabel: $("widthLabel"),
    hLabel: $("heightLabel"),
    presets: $("canvasPresets"),
    layoutPresets: $("layoutPresets"),
    sizeLockHint: $("sizeLockHint"),
    canvasHint: $("canvasHint"),
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
      if (i === excludeIndex || !ch.frame || ch.type !== "layout") return;
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
    el.heading.textContent = isC ? "캔버스 설정" : "레이아웃 설정";
    el.wLabel.textContent = isC ? "캔버스 너비" : "레이아웃 너비";
    el.hLabel.textContent = isC ? "캔버스 높이" : "레이아웃 높이";
    el.presets.hidden = !isC;
    if (el.layoutPresets) el.layoutPresets.hidden = isC || locked;
    el.canvasHint.hidden = !isC;
    el.gridSettings.hidden = isC;
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

  function readForm() {
    var L = lay();
    if (!L) return;
    var s = ns(L.settings);
    el.name.value = L.name;
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
    var L = lay();
    if (!L) return;
    L.name = el.name.value.trim() || L.name;
    L.transparentBg = el.clearBg.checked;
    L.bgColor = el.bg.value;

    if (isCanvas(L.id)) {
      L.settings = ns(Object.assign({}, L.settings, {
        width: Math.max(1, +el.w.value || 1),
        height: Math.max(1, +el.h.value || 1),
      }));
      syncChrome();
      return;
    }

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
    // Nested under layout: keep parent frame in sync with settings when form size unlocked path N/A;
    // size-locked layouts sync frame from settings only via reflow / mouse resize.
    if (!locked) {
      var pf = findParentFrame(L.id);
      if (pf) {
        pf.w = ns(L.settings).width;
        pf.h = ns(L.settings).height;
      }
    }
    syncChrome();
  }

  function selectLayout(id) {
    if (!layouts[id]) return;
    writeForm();
    activeId = id;
    selectedChild = -1;
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

  function renderTree() {
    var ordered = [];
    var depth = {};
    function walk(id, d) {
      ordered.push(id);
      depth[id] = d;
      (layouts[id].children || []).forEach(function (ch) {
        if (ch.type === "layout" && layouts[ch.refId]) walk(ch.refId, d + 1);
      });
    }
    walk(canvasId, 0);
    el.tree.replaceChildren();
    ordered.forEach(function (id) {
      var L = layouts[id];
      var li = document.createElement("li");
      li.className = "tree-item" + (id === activeId ? " active" : "");
      var indent = Array(depth[id] + 1).join("· ");
      li.innerHTML =
        '<div class="name"><span class="depth">' + indent + "</span>" +
        L.name.replace(/</g, "&lt;") +
        (id === canvasId ? ' <span class="root-badge">캔버스</span>' : "") +
        '</div><div class="muted">' + L.children.length + " items</div>";
      li.onclick = function () { selectLayout(id); };
      el.tree.appendChild(li);
    });
  }

  function renderKids() {
    var L = lay();
    el.kids.replaceChildren();
    if (!L) return;
    el.kidHint.textContent = L.children.length + "개";
    L.children.forEach(function (ch, i) {
      var li = document.createElement("li");
      li.className = "child-item" + (ch.type === "layout" ? " layout-child" : "") +
        (i === selectedChild ? " selected" : "");
      li.draggable = true;
      var mark = document.createElement("input");
      mark.type = "radio";
      mark.name = "kid";
      mark.checked = i === selectedChild;
      mark.onchange = function () {
        selectedChild = i;
        previewSel = isInteractiveChild(L.id, ch) ? { parentId: L.id, index: i } : { parentId: null, index: -1 };
        renderKids();
        refreshPreview();
      };

      if (ch.type === "image" && images[ch.refId]) {
        var thumb = document.createElement("img");
        thumb.src = images[ch.refId].url;
        var nm = document.createElement("div");
        nm.className = "name";
        nm.textContent = images[ch.refId].name;
        li.append(mark, thumb, nm);
      } else if (ch.type === "layout" && layouts[ch.refId]) {
        var nm2 = document.createElement("div");
        nm2.className = "name";
        nm2.textContent = "▦ " + layouts[ch.refId].name;
        li.append(mark, nm2);
        li.ondblclick = function () { selectLayout(ch.refId); };
      }

      li.onclick = function (e) {
        if (e.target === mark) return;
        selectedChild = i;
        previewSel = isInteractiveChild(L.id, ch) ? { parentId: L.id, index: i } : { parentId: null, index: -1 };
        renderKids();
        refreshPreview();
      };
      li.ondragstart = function () { childDrag = i; li.classList.add("dragging"); };
      li.ondragend = function () { childDrag = -1; li.classList.remove("dragging"); };
      li.ondragover = function (e) { e.preventDefault(); li.classList.add("drag-over"); };
      li.ondragleave = function () { li.classList.remove("drag-over"); };
      li.ondrop = function (e) {
        e.preventDefault();
        li.classList.remove("drag-over");
        if (childDrag < 0 || childDrag === i) return;
        var m = L.children.splice(childDrag, 1)[0];
        L.children.splice(i, 0, m);
        selectedChild = i;
        refresh();
      };
      el.kids.appendChild(li);
    });
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
    if (isCanvas(layoutId)) {
      container.classList.add("editable-stage");
      ["e", "s", "se"].forEach(function (h) {
        var d = document.createElement("div");
        d.className = "canvas-handle " + h;
        d.dataset.canvasHandle = h;
        container.appendChild(d);
      });
    }

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
    syncChrome();
  }

  function refreshPreview() {
    writeForm();
    paint(el.stage, canvasId, 0, activeId !== canvasId ? activeId : null);
    applyZoom();
  }

  function refresh() {
    renderTree();
    renderKids();
    refreshPreview();
  }

  function addFiles(list) {
    var files = [].slice.call(list || []).filter(function (f) {
      return f.type && f.type.indexOf("image/") === 0;
    });
    if (!files.length) return status("이미지 파일만 추가할 수 있습니다.", "err");
    var L = lay();
    if (!L) return status("레이아웃을 먼저 선택하세요.", "err");

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
    }).catch(function (e) { status(String(e.message || e), "err"); });
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
      var req = indexedDB.open("obs-grid-designer", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("handles"); };
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () {
        var tx = req.result.transaction("handles", op === "get" ? "readonly" : "readwrite");
        var store = tx.objectStore("handles");
        var r = op === "get" ? store.get(key) : store.put(val, key);
        r.onsuccess = function () { resolve(op === "get" ? r.result || null : null); };
        r.onerror = function () { reject(r.error); };
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
    function write(handle) {
      return handle.queryPermission({ mode: "readwrite" }).then(function (st) {
        return st === "granted" ? true : handle.requestPermission({ mode: "readwrite" }).then(function (n) {
          return n === "granted";
        });
      }).then(function (ok) {
        if (!ok) throw new Error("쓰기 권한 없음");
        return handle.createWritable().then(function (w) {
          return w.write(blob).then(function () { return w.close(); });
        });
      }).then(function () {
        pngHandle = handle;
        return idb("put", "png", handle).then(function () {
          hint();
          return handle.name;
        });
      });
    }
    return pngHandle
      ? write(pngHandle).catch(function () { return pickPng().then(write); })
      : pickPng().then(write);
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

  // pointer — always edit canvas images + any layout frames (not layout-owned images)
  el.stage.addEventListener("mousedown", function (e) {
    if (e.button) return;
    writeForm();
    var t = e.target;
    if (t.dataset && t.dataset.canvasHandle) {
      var p = toLocal(e.clientX, e.clientY, canvasId);
      var cs = ns(layouts[canvasId].settings);
      drag = {
        mode: "canvas",
        layoutId: canvasId,
        handle: t.dataset.canvasHandle,
        x0: p.x,
        y0: p.y,
        orig: { w: cs.width, h: cs.height },
      };
      e.preventDefault();
      return;
    }
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
          renderTree();
        }
      } else {
        if (activeId !== canvasId) {
          activeId = canvasId;
          readForm();
          renderTree();
        }
        selectedChild = idx;
      }

      var p2 = toLocal(e.clientX, e.clientY, parentId);
      var fr = ch.frame;
      drag = {
        mode: handle ? "resize" : "move",
        layoutId: parentId,
        index: idx,
        handle: handle ? handle.dataset.handle : null,
        x0: p2.x,
        y0: p2.y,
        orig: { x: fr.x, y: fr.y, w: fr.w, h: fr.h },
      };
      refreshPreview();
      renderKids();
      e.preventDefault();
      return;
    }
    previewSel = { parentId: null, index: -1 };
    selectedChild = -1;
    refreshPreview();
    renderKids();
  });

  window.addEventListener("mousemove", function (e) {
    if (!drag) return;
    var L = layouts[drag.layoutId];
    if (!L) return;
    var p = toLocal(e.clientX, e.clientY, drag.layoutId);
    var dx = p.x - drag.x0, dy = p.y - drag.y0;
    if (drag.mode === "canvas") {
      var nw = drag.orig.w, nh = drag.orig.h;
      if (drag.handle.indexOf("e") >= 0) nw = Math.max(64, drag.orig.w + dx);
      if (drag.handle.indexOf("s") >= 0) nh = Math.max(64, drag.orig.h + dy);
      L.settings.width = Math.round(nw);
      L.settings.height = Math.round(nh);
      if (activeId === canvasId) {
        el.w.value = L.settings.width;
        el.h.value = L.settings.height;
      }
      refreshPreview();
      e.preventDefault();
      return;
    }
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
    if (snapEnabled && ch.type === "layout") {
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
    }
    refreshPreview();
    e.preventDefault();
  });

  window.addEventListener("mouseup", function () {
    if (!drag) return;
    var finished = drag;
    drag = null;
    if (finished.mode === "resize") {
      var PL = layouts[finished.layoutId];
      var pch = PL && PL.children[finished.index];
      if (pch && pch.type === "layout") reflowIfLayout(pch.refId);
    }
    refresh();
    status("프레임 수정됨", "ok");
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
    var id = makeLayout(parent.name + " / Child", parent.id);
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

  $("deleteLayoutBtn").onclick = function () {
    if (!activeId || activeId === canvasId) return status("캔버스는 삭제할 수 없습니다.", "err");
    var id = activeId, parentId = layouts[id].parentId;
    Object.keys(layouts).forEach(function (lid) {
      layouts[lid].children = layouts[lid].children.filter(function (ch) {
        return !(ch.type === "layout" && ch.refId === id);
      });
    });
    delete layouts[id];
    if (parentId && layouts[parentId] && !isCanvas(parentId)) reflow(layouts[parentId]);
    selectLayout(parentId && layouts[parentId] ? parentId : canvasId);
  };

  $("removeChildBtn").onclick = function () {
    var L = lay();
    if (!L || selectedChild < 0) return;
    L.children.splice(selectedChild, 1);
    selectedChild = -1;
    previewSel = { parentId: null, index: -1 };
    if (!isCanvas(L.id)) reflow(L);
    refresh();
  };

  $("clearChildrenBtn").onclick = function () {
    var L = lay();
    if (!L || !L.children.length) return;
    if (!confirm("자식 항목을 모두 제거할까요?")) return;
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
    reflow(L);
    selectedChild = -1;
    refresh();
    status("격자 재배치 완료", "ok");
  };

  var formKeys = [
    el.name, el.padL, el.padR, el.padT, el.padB,
    el.cellW, el.cellH, el.spacingX, el.spacingY,
    el.startCorner, el.startAxis, el.childAlign,
    el.constraint, el.constraintCount,
  ];
  formKeys.forEach(function (node) {
    ["input", "change"].forEach(function (ev) {
      node.addEventListener(ev, function () {
        writeForm();
        if (node !== el.name && !isCanvas(activeId)) reflow(lay());
        refresh();
      });
    });
  });

  function onSizeFieldChange() {
    writeForm();
    if (!isCanvas(activeId) && !isSizeLocked(activeId)) reflow(lay());
    refresh();
  }
  [el.w, el.h].forEach(function (inp) {
    inp.addEventListener("change", onSizeFieldChange);
    inp.addEventListener("input", onSizeFieldChange);
  });

  el.clearBg.onchange = function () {
    el.bg.disabled = el.clearBg.checked;
    el.bgRow.style.opacity = el.clearBg.checked ? "0.5" : "1";
    writeForm();
    refreshPreview();
  };
  el.bg.oninput = function () { writeForm(); refreshPreview(); };

  if (el.snapBtn) {
    el.snapBtn.onclick = function () {
      snapEnabled = !snapEnabled;
      el.snapBtn.classList.toggle("active", snapEnabled);
      el.snapBtn.title = snapEnabled ? "자석 스냅 ON" : "자석 스냅 OFF";
      status(snapEnabled ? "자석 스냅 ON" : "자석 스냅 OFF", "ok");
    };
  }

  $("zoomInBtn").onclick = function () { zoom = Math.min(8, zoom * 1.2); applyZoom(); };
  $("zoomOutBtn").onclick = function () { zoom = Math.max(0.25, zoom / 1.2); applyZoom(); };
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
    zoom = Math.min(8, Math.max(0.25, zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
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
  bindDrop(el.kidsPanel);

  $("exportPngBtn").onclick = exportPng;
  $("changePngPathBtn").onclick = function () {
    if (typeof window.showSaveFilePicker !== "function") return status("이 브라우저는 위치 고정을 지원하지 않습니다.", "err");
    pickPng().then(function (h) {
      pngHandle = h;
      return idb("put", "png", h);
    }).then(function () {
      el.paths.innerHTML = "PNG: <strong>" + pngHandle.name + "</strong>";
      status("PNG 위치: " + pngHandle.name, "ok");
    }).catch(function (e) {
      if (!e || e.name !== "AbortError") status(String((e && e.message) || e), "err");
    });
  };

  document.querySelectorAll(".preset-size").forEach(function (btn) {
    btn.onclick = function () {
      if (!activeId || isSizeLocked(activeId)) return;
      var forCanvas = !!(el.presets && el.presets.contains(btn));
      var forLayout = !!(el.layoutPresets && el.layoutPresets.contains(btn));
      if (forCanvas && !isCanvas(activeId)) return;
      if (forLayout && isCanvas(activeId)) return;
      el.w.value = btn.getAttribute("data-w");
      el.h.value = btn.getAttribute("data-h");
      writeForm();
      if (forLayout && !isCanvas(activeId)) reflow(lay());
      refresh();
    };
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
