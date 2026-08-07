/**
 * OBS Grid Designer — canvas + nested layouts → PNG
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
  var containRect = G.containRect;
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
  var childDrag = -1;
  var maxZ = 1;
  var pngHandle = null;
  var zoom = 1;
  var sizeFocus = null;
  var drag = null; // { mode, layoutId, index, handle, x0, y0, orig }

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
    scaleKids: $("scaleChildren"),
    cols: $("columns"),
    gap: $("gap"),
    pad: $("padding"),
    aspect: $("aspect"),
    square: $("keepSquare"),
    cellAlign: $("cellAlign"),
    cellAlignRow: $("cellAlignRow"),
    cellAlignHint: $("cellAlignHint"),
    contentAlign: $("contentAlign"),
    alignPad: $("alignPad"),
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
  };

  function status(msg, kind) {
    el.status.textContent = msg || "";
    el.status.className = "status" + (kind ? " " + kind : "");
  }

  function lay() { return layouts[activeId] || null; }
  function canvas() { return layouts[canvasId]; }
  function canvasSize() {
    var s = ns(canvas().settings);
    return { w: s.width, h: s.height };
  }

  function makeLayout(name, parentId) {
    var id = uid("lay");
    layouts[id] = {
      id: id,
      name: name || "Layout",
      parentId: parentId || null,
      settings: ns({
        width: 1920, height: 1080, columns: 4, gap: 10, padding: 20,
        keep_square: false, aspect_ratio: "free",
        cell_align: Align.LEFT_TOP, content_align: Align.LEFT_TOP,
      }),
      transparentBg: true,
      bgColor: "#000000",
      scaleChildren: false,
      children: [],
    };
    return id;
  }

  function intrinsicSize(ch) {
    if (ch.type === "image" && images[ch.refId] && images[ch.refId].img) {
      var im = images[ch.refId].img;
      return { w: im.naturalWidth || 200, h: im.naturalHeight || 200 };
    }
    if (ch.type === "layout" && layouts[ch.refId]) {
      var s = ns(layouts[ch.refId].settings);
      return { w: s.width, h: s.height };
    }
    return { w: 200, h: 200 };
  }

  function makeFrame(ch, cell, i) {
    var sz = intrinsicSize(ch);
    return {
      x: cell ? cell.x : 20,
      y: cell ? cell.y : 20,
      w: sz.w,
      h: sz.h,
      z: i + 1,
    };
  }

  function ensureFrames(L) {
    if (!L) return;
    var cells = computeGrid(L.children.length, L.settings);
    L.children.forEach(function (ch, i) {
      if (!ch.frame || !(ch.frame.w > 0) || !(ch.frame.h > 0)) ch.frame = makeFrame(ch, cells[i], i);
      if (ch.frame.z == null) ch.frame.z = i + 1;
      if (ch.frame.z > maxZ) maxZ = ch.frame.z;
    });
  }

  function reflow(L) {
    var cells = computeGrid(L.children.length, L.settings);
    L.children.forEach(function (ch, i) {
      var z = ch.frame && ch.frame.z != null ? ch.frame.z : i + 1;
      ch.frame = makeFrame(ch, cells[i], i);
      ch.frame.z = z;
    });
  }

  function scaleKids(L, ow, oh, nw, nh) {
    if (!L || !L.scaleChildren || !(ow > 0) || !(oh > 0)) return;
    var sx = nw / ow, sy = nh / oh;
    if (sx === 1 && sy === 1) return;
    L.children.forEach(function (ch) {
      if (!ch.frame) return;
      ch.frame.x = Math.round(ch.frame.x * sx);
      ch.frame.y = Math.round(ch.frame.y * sy);
      ch.frame.w = Math.max(1, Math.round(ch.frame.w * sx));
      ch.frame.h = Math.max(1, Math.round(ch.frame.h * sy));
    });
  }

  function byZ(L) {
    return L.children.map(function (_, i) { return i; }).sort(function (a, b) {
      return ((L.children[a].frame && L.children[a].frame.z) || 0) -
        ((L.children[b].frame && L.children[b].frame.z) || 0);
    });
  }

  // position scales with parent box; size stays intrinsic pixels
  function showFrame(ch, sx, sy) {
    var f = ch.frame;
    return { x: f.x * sx, y: f.y * sy, w: f.w, h: f.h, z: f.z };
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
    var isC = activeId === canvasId;
    el.heading.textContent = isC ? "캔버스 설정" : "레이아웃 설정";
    el.wLabel.textContent = isC ? "캔버스 너비" : "레이아웃 너비";
    el.hLabel.textContent = isC ? "캔버스 높이" : "레이아웃 높이";
    el.presets.hidden = !isC;
    var cellOn = el.square.checked || el.aspect.value !== "free";
    el.cellAlignRow.style.opacity = cellOn ? "1" : "0.45";
    el.cellAlign.disabled = !cellOn;
    el.cellAlignHint.textContent = cellOn
      ? "셀→슬롯: 정사각/고정비율일 때 격자 칸 안 위치. 「격자」로 반영."
      : "셀→슬롯은 정사각/고정비율일 때만 의미 있음.";
    var c = canvasSize();
    el.badge.textContent = "캔버스 " + c.w + " × " + c.h;
  }

  function readForm() {
    var L = lay();
    if (!L) return;
    var s = ns(L.settings);
    el.name.value = L.name;
    el.w.value = s.width;
    el.h.value = s.height;
    el.cols.value = s.columns;
    el.gap.value = s.gap;
    el.pad.value = s.padding;
    el.aspect.value = s.aspect_ratio;
    el.square.checked = s.keep_square;
    el.aspect.disabled = s.keep_square;
    el.cellAlign.value = s.cell_align;
    el.contentAlign.value = s.content_align;
    el.scaleKids.checked = !!L.scaleChildren;
    el.clearBg.checked = L.transparentBg !== false;
    el.bg.value = L.bgColor || "#000000";
    el.bg.disabled = el.clearBg.checked;
    el.bgRow.style.opacity = el.clearBg.checked ? "0.5" : "1";
    el.alignPad.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.align === el.contentAlign.value);
    });
    syncChrome();
  }

  function writeForm() {
    var L = lay();
    if (!L) return;
    L.name = el.name.value.trim() || L.name;
    L.scaleChildren = el.scaleKids.checked;
    L.settings = ns({
      width: Math.max(1, +el.w.value || 1),
      height: Math.max(1, +el.h.value || 1),
      columns: +el.cols.value,
      gap: +el.gap.value,
      padding: +el.pad.value,
      keep_square: el.square.checked,
      aspect_ratio: el.aspect.value,
      cell_align: el.cellAlign.value,
      content_align: el.contentAlign.value,
    });
    L.transparentBg = el.clearBg.checked;
    L.bgColor = el.bg.value;
    syncChrome();
  }

  function selectLayout(id) {
    if (!layouts[id]) return;
    writeForm();
    activeId = id;
    selectedChild = -1;
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
      mark.onchange = function () { selectedChild = i; renderKids(); refreshPreview(); };

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

  function paint(container, layoutId, depth, editId, highlightId) {
    var L = layouts[layoutId];
    if (!L || depth > 20) return;
    ensureFrames(L);
    var s = ns(L.settings);
    var sx = 1, sy = 1; // always paint layout in its own settings space
    container.dataset.layoutId = layoutId;
    container.style.width = s.width + "px";
    container.style.height = s.height + "px";
    container.style.background = L.transparentBg !== false ? "transparent" : (L.bgColor || "#000");
    container.replaceChildren();
    var editable = layoutId === editId;
    if (editable) container.classList.add("editable-stage");
    if (editable && layoutId === canvasId) {
      ["e", "s", "se"].forEach(function (h) {
        var d = document.createElement("div");
        d.className = "canvas-handle " + h;
        d.dataset.canvasHandle = h;
        container.appendChild(d);
      });
    }

    byZ(L).forEach(function (i) {
      var ch = L.children[i];
      var f = showFrame(ch, sx, sy);
      var cell = document.createElement("div");
      cell.className = "grid-cell" + (editable ? " interactive" : "");
      cell.dataset.childIndex = String(i);
      cell.style.cssText =
        "left:" + f.x + "px;top:" + f.y + "px;width:" + f.w + "px;height:" + f.h + "px;z-index:" + (f.z || i + 1);
      if (ch.type === "layout" && ch.refId === highlightId) cell.classList.add("highlight-nested");
      if (editable && i === selectedChild) {
        cell.classList.add("selected");
        ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach(function (h) {
          var d = document.createElement("div");
          d.className = "resize-handle " + h;
          d.dataset.handle = h;
          cell.appendChild(d);
        });
      }
      if (ch.type === "image" && images[ch.refId] && images[ch.refId].img) {
        var item = images[ch.refId];
        var fit = containRect(item.img.naturalWidth, item.img.naturalHeight, f.w, f.h, s.content_align);
        var img = document.createElement("img");
        img.src = item.url;
        img.draggable = false;
        img.style.cssText =
          "left:" + fit.x + "px;top:" + fit.y + "px;width:" + fit.w + "px;height:" + fit.h + "px";
        cell.appendChild(img);
      } else if (ch.type === "layout" && layouts[ch.refId]) {
        var nested = document.createElement("div");
        nested.className = "nested-stage" + (ch.refId === editId ? " editable-stage" : "");
        cell.appendChild(nested);
        paint(nested, ch.refId, depth + 1, editId, highlightId);
      }
      if (editable) {
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
      if (ch.type === "image" && images[ch.refId] && images[ch.refId].img) {
        var item = images[ch.refId];
        var fit = containRect(item.img.naturalWidth, item.img.naturalHeight, f.w, f.h, s.content_align);
        ctx.drawImage(item.img, ox + f.x + fit.x, oy + f.y + fit.y, fit.w, fit.h);
      } else if (ch.type === "layout" && layouts[ch.refId]) {
        draw(ctx, ch.refId, ox + f.x, oy + f.y, depth + 1);
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
    var s = ns(canvas().settings);
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
    var s = ns(canvas().settings);
    paint(el.stage, canvasId, 0, activeId || canvasId, activeId !== canvasId ? activeId : null);
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
      var cells = computeGrid(start + added.length, L.settings);
      added.forEach(function (id, off) {
        var ch = { type: "image", refId: id };
        ch.frame = makeFrame(ch, cells[start + off], start + off);
        if (ch.frame.z > maxZ) maxZ = ch.frame.z;
        L.children.push(ch);
      });
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

  // ——— PNG save ———
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
    var p = pngHandle
      ? write(pngHandle).catch(function () { return pickPng().then(write); })
      : pickPng().then(write);
    return p;
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

  // ——— pointer ———
  el.stage.addEventListener("mousedown", function (e) {
    if (e.button) return;
    var editId = activeId || canvasId;
    var L = layouts[editId];
    if (!L) return;
    writeForm();
    ensureFrames(L);
    var t = e.target;
    if (t.dataset && t.dataset.canvasHandle && editId === canvasId) {
      var p = toLocal(e.clientX, e.clientY, canvasId);
      var s = ns(L.settings);
      drag = { mode: "canvas", layoutId: canvasId, handle: t.dataset.canvasHandle, x0: p.x, y0: p.y, orig: { w: s.width, h: s.height } };
      e.preventDefault();
      return;
    }
    var handle = t.closest && t.closest(".resize-handle");
    var cell = t.closest && t.closest(".grid-cell.interactive");
    if (cell) {
      var idx = +cell.dataset.childIndex;
      selectedChild = idx;
      maxZ += 1;
      L.children[idx].frame.z = maxZ;
      var p2 = toLocal(e.clientX, e.clientY, editId);
      var fr = L.children[idx].frame;
      drag = {
        mode: handle ? "resize" : "move",
        layoutId: editId,
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
      scaleKids(L, drag.orig.w, drag.orig.h, nw, nh);
      L.settings.width = Math.round(nw);
      L.settings.height = Math.round(nh);
      if (drag.layoutId === activeId) {
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
    if (drag.mode === "move") { x = o.x + dx; y = o.y + dy; }
    else {
      var hd = drag.handle;
      if (hd.indexOf("e") >= 0) w = o.w + dx;
      if (hd.indexOf("s") >= 0) h = o.h + dy;
      if (hd.indexOf("w") >= 0) { w = o.w - dx; x = o.x + dx; }
      if (hd.indexOf("n") >= 0) { h = o.h - dy; y = o.y + dy; }
      if (w < 24) { if (hd.indexOf("w") >= 0) x = o.x + o.w - 24; w = 24; }
      if (h < 24) { if (hd.indexOf("n") >= 0) y = o.y + o.h - 24; h = 24; }
    }
    ch.frame.x = Math.round(x);
    ch.frame.y = Math.round(y);
    ch.frame.w = Math.round(w);
    ch.frame.h = Math.round(h);
    refreshPreview();
    e.preventDefault();
  });

  window.addEventListener("mouseup", function () {
    if (!drag) return;
    drag = null;
    status("프레임 수정됨", "ok");
  });

  // ——— wire UI ———
  fillAlign(el.cellAlign);
  fillAlign(el.contentAlign);
  ALIGNS.forEach(function (k) {
    var b = document.createElement("button");
    b.type = "button";
    b.dataset.align = k;
    b.title = k;
    b.onclick = function () {
      el.contentAlign.value = k;
      writeForm();
      refresh();
    };
    el.alignPad.appendChild(b);
  });

  $("addChildLayoutBtn").onclick = function () {
    var parent = lay();
    if (!parent) return;
    writeForm();
    var id = makeLayout(parent.name + " / Child", parent.id);
    layouts[id].settings.width = 960;
    layouts[id].settings.height = 540;
    layouts[id].settings.columns = 2;
    parent.children.push({ type: "layout", refId: id });
    ensureFrames(parent);
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
    selectLayout(parentId && layouts[parentId] ? parentId : canvasId);
  };

  $("removeChildBtn").onclick = function () {
    var L = lay();
    if (!L || selectedChild < 0) return;
    L.children.splice(selectedChild, 1);
    selectedChild = -1;
    refresh();
  };

  $("clearChildrenBtn").onclick = function () {
    var L = lay();
    if (!L || !L.children.length) return;
    if (!confirm("자식 항목을 모두 제거할까요?")) return;
    L.children = [];
    selectedChild = -1;
    refresh();
  };

  $("reflowGridBtn").onclick = function () {
    var L = lay();
    if (!L) return;
    writeForm();
    reflow(L);
    selectedChild = -1;
    refresh();
    status("격자 재배치 완료", "ok");
  };

  ["name", "cols", "gap", "pad", "aspect", "cellAlign", "contentAlign"].forEach(function (k) {
    var map = { name: el.name, cols: el.cols, gap: el.gap, pad: el.pad, aspect: el.aspect, cellAlign: el.cellAlign, contentAlign: el.contentAlign };
    ["input", "change"].forEach(function (ev) {
      map[k].addEventListener(ev, function () { writeForm(); refresh(); });
    });
  });

  [el.w, el.h].forEach(function (inp) {
    inp.addEventListener("focus", function () {
      var L = lay();
      if (!L) return;
      var s = ns(L.settings);
      sizeFocus = { w: s.width, h: s.height };
    });
    inp.addEventListener("change", function () {
      var L = lay();
      if (!L) return;
      writeForm();
      if (sizeFocus && L.scaleChildren) {
        var s = ns(L.settings);
        scaleKids(L, sizeFocus.w, sizeFocus.h, s.width, s.height);
      }
      sizeFocus = null;
      refresh();
    });
  });

  el.scaleKids.onchange = writeForm;
  el.square.onchange = function () {
    el.aspect.disabled = el.square.checked;
    writeForm();
    refresh();
  };
  el.clearBg.onchange = function () {
    el.bg.disabled = el.clearBg.checked;
    el.bgRow.style.opacity = el.clearBg.checked ? "0.5" : "1";
    writeForm();
    refreshPreview();
  };
  el.bg.oninput = function () { writeForm(); refreshPreview(); };

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
      if (activeId !== canvasId) return;
      var L = lay();
      var s = ns(L.settings);
      var nw = +btn.getAttribute("data-w"), nh = +btn.getAttribute("data-h");
      el.w.value = nw;
      el.h.value = nh;
      scaleKids(L, s.width, s.height, nw, nh);
      writeForm();
      refresh();
    };
  });

  window.addEventListener("resize", refreshPreview);

  // boot
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
  status("미리보기나 자식 목록에 이미지를 드롭하세요");
})();
