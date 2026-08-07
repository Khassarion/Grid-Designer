/** Grid math + 9-point align */
(function (global) {
  "use strict";

  var Align = {
    LEFT_TOP: "left-top",
    LEFT_MIDDLE: "left-middle",
    LEFT_BOTTOM: "left-bottom",
    CENTER_TOP: "center-top",
    CENTER_MIDDLE: "center-middle",
    CENTER_BOTTOM: "center-bottom",
    RIGHT_TOP: "right-top",
    RIGHT_MIDDLE: "right-middle",
    RIGHT_BOTTOM: "right-bottom",
  };

  function parseAlign(v) {
    var p = String(v || "left-top").split("-");
    var h = p[0], vv = p[1];
    if (h !== "left" && h !== "center" && h !== "right") h = "center";
    if (vv !== "top" && vv !== "middle" && vv !== "bottom") vv = "middle";
    return { h: h, v: vv, key: h + "-" + vv };
  }

  function alignOffset(inner, outer, axis) {
    var slack = Math.max(0, outer - inner);
    if (axis === "left" || axis === "top") return 0;
    if (axis === "right" || axis === "bottom") return slack;
    return slack / 2;
  }

  function normalizeSettings(d) {
    d = d || {};
    return {
      start_x: +(d.start_x != null ? d.start_x : 0),
      start_y: +(d.start_y != null ? d.start_y : 0),
      width: Math.max(1, +(d.width != null ? d.width : 1920)),
      height: Math.max(1, +(d.height != null ? d.height : 1080)),
      columns: Math.max(1, Math.min(64, Math.floor(+(d.columns != null ? d.columns : 4)))),
      gap: Math.max(0, +(d.gap != null ? d.gap : 10)),
      padding: Math.max(0, +(d.padding != null ? d.padding : 20)),
      keep_square: !!d.keep_square,
      aspect_ratio: String(d.aspect_ratio != null ? d.aspect_ratio : "free"),
      cell_align: parseAlign(d.cell_align).key,
      content_align: parseAlign(d.content_align).key,
    };
  }

  function fitAspect(w, h, rw, rh) {
    if (w <= 0 || h <= 0) return [Math.max(0, w), Math.max(0, h)];
    var t = rw / rh, c = w / h;
    return c > t ? [h * t, h] : [w, w / t];
  }

  function computeGrid(n, input) {
    if (n <= 0) return [];
    var s = normalizeSettings(input);
    var cols = s.columns;
    var rows = Math.max(1, Math.ceil(n / cols));
    var pad = s.padding, gap = s.gap;
    var align = parseAlign(s.cell_align);
    var rawW = (s.width - pad * 2 - gap * (cols - 1)) / cols;
    var rawH = (s.height - pad * 2 - gap * (rows - 1)) / rows;
    var cw = Math.max(0, rawW), ch = Math.max(0, rawH);
    if (s.keep_square) {
      cw = ch = Math.min(cw, ch);
    } else if (s.aspect_ratio === "16:9") {
      var a = fitAspect(cw, ch, 16, 9); cw = a[0]; ch = a[1];
    } else if (s.aspect_ratio === "4:3") {
      var b = fitAspect(cw, ch, 4, 3); cw = b[0]; ch = b[1];
    }
    var ox = alignOffset(cw, rawW, align.h);
    var oy = alignOffset(ch, rawH, align.v);
    var out = [];
    for (var i = 0; i < n; i++) {
      var row = Math.floor(i / cols), col = i % cols;
      out.push({
        index: i, row: row, col: col,
        x: s.start_x + pad + col * (rawW + gap) + ox,
        y: s.start_y + pad + row * (rawH + gap) + oy,
        width: cw, height: ch,
      });
    }
    return out;
  }

  /** Native pixel size; only offset by content_align inside the cell. */
  function containRect(imgW, imgH, cellW, cellH, contentAlign) {
    if (!imgW || !imgH) return { x: 0, y: 0, w: cellW || 0, h: cellH || 0 };
    var a = parseAlign(contentAlign);
    return {
      x: alignOffset(imgW, cellW || imgW, a.h),
      y: alignOffset(imgH, cellH || imgH, a.v),
      w: imgW,
      h: imgH,
    };
  }

  global.ObsGrid = {
    Align: Align,
    normalizeSettings: normalizeSettings,
    computeGrid: computeGrid,
    containRect: containRect,
  };
})(window);
