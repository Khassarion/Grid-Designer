/**
 * Grid layout: fixed cell size, padding4, spacing, corner/axis, child group align
 *
 * Copyright (c) 2026 AINukeHere
 * SPDX-License-Identifier: LicenseRef-GridComposer-Proprietary
 */
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

  var Corner = {
    LEFT_TOP: "left-top",
    RIGHT_TOP: "right-top",
    LEFT_BOTTOM: "left-bottom",
    RIGHT_BOTTOM: "right-bottom",
  };

  function parseAlign(v) {
    var p = String(v || "left-top").split("-");
    var h = p[0], vv = p[1];
    if (h !== "left" && h !== "center" && h !== "right") h = "left";
    if (vv !== "top" && vv !== "middle" && vv !== "bottom") vv = "top";
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
    var constraint = d.constraint || "auto";
    if (constraint !== "auto" && constraint !== "columns" && constraint !== "rows") constraint = "auto";
    var corner = d.start_corner || Corner.LEFT_TOP;
    if (
      corner !== Corner.LEFT_TOP &&
      corner !== Corner.RIGHT_TOP &&
      corner !== Corner.LEFT_BOTTOM &&
      corner !== Corner.RIGHT_BOTTOM
    ) {
      corner = Corner.LEFT_TOP;
    }
    var axis = d.start_axis === "vertical" ? "vertical" : "horizontal";
    return {
      width: Math.max(1, +(d.width != null ? d.width : 1920)),
      height: Math.max(1, +(d.height != null ? d.height : 1080)),
      pad_l: Math.max(0, +(d.pad_l != null ? d.pad_l : 0)),
      pad_r: Math.max(0, +(d.pad_r != null ? d.pad_r : 0)),
      pad_t: Math.max(0, +(d.pad_t != null ? d.pad_t : 0)),
      pad_b: Math.max(0, +(d.pad_b != null ? d.pad_b : 0)),
      cell_w: Math.max(1, +(d.cell_w != null ? d.cell_w : 200)),
      cell_h: Math.max(1, +(d.cell_h != null ? d.cell_h : 160)),
      spacing_x: +(d.spacing_x != null ? d.spacing_x : 0),
      spacing_y: +(d.spacing_y != null ? d.spacing_y : 0),
      start_corner: corner,
      start_axis: axis,
      child_align: parseAlign(d.child_align || Align.LEFT_TOP).key,
      constraint: constraint,
      constraint_count: Math.max(1, Math.min(64, Math.floor(+(d.constraint_count != null ? d.constraint_count : 4)))),
    };
  }

  function fitCount(usable, cell, spacing) {
    var step = cell + spacing;
    if (step <= 0) return 1;
    return Math.max(1, Math.floor((usable + spacing) / step));
  }

  function computeGrid(n, input) {
    if (n <= 0) return [];
    var s = normalizeSettings(input);
    var usableW = Math.max(0, s.width - s.pad_l - s.pad_r);
    var usableH = Math.max(0, s.height - s.pad_t - s.pad_b);
    var cw = s.cell_w;
    var ch = s.cell_h;
    var sx = s.spacing_x;
    var sy = s.spacing_y;

    var cols;
    var rows;
    if (s.constraint === "columns") {
      cols = s.constraint_count;
      rows = Math.max(1, Math.ceil(n / cols));
    } else if (s.constraint === "rows") {
      rows = s.constraint_count;
      cols = Math.max(1, Math.ceil(n / rows));
    } else if (s.start_axis === "vertical") {
      rows = fitCount(usableH, ch, sy);
      cols = Math.max(1, Math.ceil(n / rows));
    } else {
      cols = fitCount(usableW, cw, sx);
      rows = Math.max(1, Math.ceil(n / cols));
    }

    var gridW = cols * cw + Math.max(0, cols - 1) * sx;
    var gridH = rows * ch + Math.max(0, rows - 1) * sy;
    // negative spacing shrinks total span
    if (cols > 1) gridW = cols * cw + (cols - 1) * sx;
    if (rows > 1) gridH = rows * ch + (rows - 1) * sy;

    var align = parseAlign(s.child_align);
    var originX = s.pad_l + alignOffset(gridW, usableW, align.h);
    var originY = s.pad_t + alignOffset(gridH, usableH, align.v);

    var flipX = s.start_corner === Corner.RIGHT_TOP || s.start_corner === Corner.RIGHT_BOTTOM;
    var flipY = s.start_corner === Corner.LEFT_BOTTOM || s.start_corner === Corner.RIGHT_BOTTOM;
    var vertical = s.start_axis === "vertical";

    var out = [];
    for (var i = 0; i < n; i++) {
      var major;
      var minor;
      var col;
      var row;
      if (vertical) {
        minor = i % rows; // row along secondary
        major = Math.floor(i / rows); // col
        row = flipY ? rows - 1 - minor : minor;
        col = flipX ? cols - 1 - major : major;
      } else {
        minor = i % cols;
        major = Math.floor(i / cols);
        col = flipX ? cols - 1 - minor : minor;
        row = flipY ? rows - 1 - major : major;
      }
      out.push({
        index: i,
        row: row,
        col: col,
        x: originX + col * (cw + sx),
        y: originY + row * (ch + sy),
        width: cw,
        height: ch,
      });
    }
    return out;
  }

  global.ObsGrid = {
    Align: Align,
    Corner: Corner,
    normalizeSettings: normalizeSettings,
    computeGrid: computeGrid,
  };
})(window);
