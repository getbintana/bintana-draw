/*
 * Everything the canvas paints. The renderer is handed a diagram and a view
 * (`panX`, `panY`, `zoom`, what is selected, the gesture in flight) and draws
 * one frame; it keeps no state between frames.
 *
 * Two drawings share the same shape and edge code: the one on screen, with its
 * grid, selection and handles, and the one `Save`/`SavePdf` asks for, which is
 * white paper fitted to the diagram and nothing else. That is what makes an
 * export the same picture as the editor rather than a second implementation.
 */
"use strict";

const KAPPA = 0.5522847498307936;
const ACCENT = "#3584e4";

function dashPattern(dash, dashed) {
    if (dash === "dot") return [2, 3];
    if (dash === "dash" || dashed) return [7, 5];
    return [];
}

function fontDescription(size, bold, italic) {
    let font = "Sans";
    if (bold) font += " Bold";
    if (italic) font += " Italic";
    return font + " " + Math.max(6, Math.round(size || 12));
}

/* ------------------------------------------------------------------ paths */

function roundRectPath(p, x, y, w, h, radius) {
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    if (r === 0) { p.Rectangle(x, y, w, h); return; }
    p.MoveTo(x + r, y);
    p.LineTo(x + w - r, y);
    p.Arc(x + w - r, y + r, r, -90, 0);
    p.LineTo(x + w, y + h - r);
    p.Arc(x + w - r, y + h - r, r, 0, 90);
    p.LineTo(x + r, y + h);
    p.Arc(x + r, y + h - r, r, 90, 180);
    p.LineTo(x, y + r);
    p.Arc(x + r, y + r, r, 180, 270);
    p.ClosePath();
}

function ellipsePath(p, x, y, w, h) {
    const rx = w / 2, ry = h / 2;
    const cx = x + rx, cy = y + ry;
    p.MoveTo(cx + rx, cy);
    p.CurveTo(cx + rx, cy - ry * KAPPA, cx + rx * KAPPA, cy - ry, cx, cy - ry);
    p.CurveTo(cx - rx * KAPPA, cy - ry, cx - rx, cy - ry * KAPPA, cx - rx, cy);
    p.CurveTo(cx - rx, cy + ry * KAPPA, cx - rx * KAPPA, cy + ry, cx, cy + ry);
    p.CurveTo(cx + rx * KAPPA, cy + ry, cx + rx, cy + ry * KAPPA, cx + rx, cy);
    p.ClosePath();
}

function diamondPath(p, s) {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    p.Polygon([cx, s.y, s.x + s.w, cy, cx, s.y + s.h, s.x, cy]);
}

function cylinderPath(p, s) {
    const ry = Math.min(18, s.h * 0.16);
    const x = s.x, y = s.y, w = s.w, h = s.h;
    const cx = x + w / 2;
    const top = y + ry, bottom = y + h - ry;
    p.MoveTo(x, top);
    p.CurveTo(x, top - ry * KAPPA, cx - (w / 2) * KAPPA, y, cx, y);
    p.CurveTo(cx + (w / 2) * KAPPA, y, x + w, top - ry * KAPPA, x + w, top);
    p.LineTo(x + w, bottom);
    p.CurveTo(x + w, bottom + ry * KAPPA, cx + (w / 2) * KAPPA, y + h, cx, y + h);
    p.CurveTo(cx - (w / 2) * KAPPA, y + h, x, bottom + ry * KAPPA, x, bottom);
    p.ClosePath();
}

function cylinderTopPath(p, s) {
    const ry = Math.min(18, s.h * 0.16);
    const x = s.x, y = s.y, w = s.w;
    const cx = x + w / 2;
    const rx = w / 2;
    const cy = y + ry;
    p.MoveTo(cx + rx, cy);
    p.CurveTo(cx + rx, cy - ry * KAPPA, cx + rx * KAPPA, y, cx, y);
    p.CurveTo(cx - rx * KAPPA, y, x, cy - ry * KAPPA, x, cy);
    p.CurveTo(x, cy + ry * KAPPA, cx - rx * KAPPA, y + 2 * ry, cx, y + 2 * ry);
    p.CurveTo(cx + rx * KAPPA, y + 2 * ry, cx + rx, cy + ry * KAPPA, cx + rx, cy);
    p.ClosePath();
}

function notePath(p, s) {
    const fold = Math.min(24, s.w * 0.22, s.h * 0.32);
    p.Polygon([s.x, s.y, s.x + s.w - fold, s.y, s.x + s.w, s.y + fold,
               s.x + s.w, s.y + s.h, s.x, s.y + s.h]);
}

function shapePath(p, s) {
    switch (s.kind) {
    case "round":      roundRectPath(p, s.x, s.y, s.w, s.h, s.radius); break;
    case "terminator": roundRectPath(p, s.x, s.y, s.w, s.h, s.h / 2); break;
    case "ellipse":    ellipsePath(p, s.x, s.y, s.w, s.h); break;
    case "diamond":    diamondPath(p, s); break;
    case "data":
        p.Polygon([s.x + s.w * 0.18, s.y, s.x + s.w, s.y,
                   s.x + s.w * 0.82, s.y + s.h, s.x, s.y + s.h]);
        break;
    case "cylinder":   cylinderPath(p, s); break;
    case "note":       notePath(p, s); break;
    default:           p.Rectangle(s.x, s.y, s.w, s.h); break;
    }
}

function selectionOutline(p, s) {
    if (s.kind === "text") p.Rectangle(s.x, s.y, s.w, s.h);
    else shapePath(p, s);
}

/* ------------------------------------------------------------------ labels */

function labelInShape(p, s) {
    if (!s.text) return;

    const wide = s.kind === "ellipse" || s.kind === "diamond";
    const note = s.kind === "note";
    const fold = note ? Math.min(24, s.w * 0.22, s.h * 0.32) : 0;
    const padX = note ? 12 : (wide ? s.w * 0.18 : 10);
    const width = Math.max(10, note ? s.w - fold - 18 : s.w - padX * 2);
    const align = s.textAlign || (note ? "left" : "center");
    const vAlign = s.textVAlign || (note ? "top" : "middle");
    const x = s.x + padX;

    p.Font = fontDescription(s.fontSize, s.textBold, s.textItalic);
    p.Color = s.textColor || DEFAULT_TEXT;

    const pangoAlign = align === "left" ? "Left"
                     : (align === "right" ? "Right" : "Center");
    const options = { Width: width, Align: pangoAlign };
    const height = p.TextHeight(s.text, options);
    let y;
    if (vAlign === "top") y = s.y + (note ? 10 : 8);
    else if (vAlign === "bottom") y = s.y + s.h - height - 8;
    else y = s.y + (s.h - height) / 2;

    /* A long label must not paint outside the shape it belongs to. */
    p.Push();
    if (s.kind === "text") p.Rectangle(s.x, s.y, s.w, s.h);
    else shapePath(p, s);
    p.Clip();
    p.Text(s.text, x, y, options);
    p.Pop();
}

function edgeLabel(p, e, points) {
    if (!e.text) return;
    const at = edgeMidpoint(points);
    if (!at) return;

    p.Font = fontDescription(e.fontSize, e.textBold, e.textItalic);
    const tw = p.TextWidth(e.text);
    const th = p.TextHeight(e.text);
    const pad = 4;
    roundRectPath(p, at.x - tw / 2 - pad, at.y - th / 2 - pad,
                  tw + pad * 2, th + pad * 2, 4);
    p.Color = "rgba(255,255,255,0.94)";
    p.Fill();

    p.Color = e.textColor || e.stroke || DEFAULT_EDGE;
    p.Text(e.text, at.x - tw / 2, at.y - th / 2);
}

/* ------------------------------------------------------------------ pieces */

function drawShape(p, s) {
    const turn = s.rotation ? true : false;
    if (turn) {
        const c = shapeCenter(s);
        p.Push();
        p.Translate(c.x, c.y);
        p.Rotate(s.rotation);
        p.Translate(-c.x, -c.y);
    }

    if (s.kind === "text") {
        labelInShape(p, s);
        if (turn) p.Pop();
        return;
    }

    shapePath(p, s);
    p.Color = s.fill || DEFAULT_FILL;
    p.Fill();

    shapePath(p, s);
    p.Color = s.stroke || DEFAULT_STROKE;
    p.LineWidth = s.strokeWidth || 1.5;
    p.LineDash = dashPattern(s.dash, false);
    p.Stroke();
    p.LineDash = [];

    if (s.kind === "cylinder") {
        cylinderTopPath(p, s);
        p.Color = s.stroke || DEFAULT_STROKE;
        p.LineWidth = s.strokeWidth || 1.5;
        p.LineDash = dashPattern(s.dash, false);
        p.Stroke();
        p.LineDash = [];
    } else if (s.kind === "note") {
        const fold = Math.min(24, s.w * 0.22, s.h * 0.32);
        p.Color = s.stroke || DEFAULT_STROKE;
        p.LineWidth = s.strokeWidth || 1.5;
        p.LineDash = dashPattern(s.dash, false);
        p.MoveTo(s.x + s.w - fold, s.y);
        p.LineTo(s.x + s.w - fold, s.y + fold);
        p.LineTo(s.x + s.w, s.y + fold);
        p.Stroke();
        p.LineDash = [];
    }

    labelInShape(p, s);
    if (turn) p.Pop();
}

function arrowHead(p, points, color, width) {
    if (points.length < 4) return;
    const ex = points[points.length - 2], ey = points[points.length - 1];
    const px = points[points.length - 4], py = points[points.length - 3];
    const angle = Math.atan2(ey - py, ex - px);
    const size = 9 + (width || 2);
    const spread = 0.42;
    const ax = ex - size * Math.cos(angle - spread);
    const ay = ey - size * Math.sin(angle - spread);
    const bx = ex - size * Math.cos(angle + spread);
    const by = ey - size * Math.sin(angle + spread);
    p.Polygon([ex, ey, ax, ay, bx, by]);
    p.Color = color;
    p.Fill();
}

function drawEdgeLine(p, e, points) {
    if (points.length < 4) return;
    const color = e.stroke || DEFAULT_EDGE;
    const width = e.strokeWidth || 2;
    p.Color = color;
    p.LineWidth = width;
    p.LineDash = dashPattern(e.dash, e.dashed);
    p.Polyline(points);
    p.Stroke();
    p.LineDash = [];
    arrowHead(p, points, color, width);
}

/* ------------------------------------------------------------------ handles */

export function shapeHandles(s) {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    return [
        { dir: "nw", x: s.x,       y: s.y },
        { dir: "n",  x: cx,        y: s.y },
        { dir: "ne", x: s.x + s.w, y: s.y },
        { dir: "e",  x: s.x + s.w, y: cy },
        { dir: "se", x: s.x + s.w, y: s.y + s.h },
        { dir: "s",  x: cx,        y: s.y + s.h },
        { dir: "sw", x: s.x,       y: s.y + s.h },
        { dir: "w",  x: s.x,       y: cy },
    ];
}

function drawSelection(p, diagram, selected, zoom) {
    const ids = new Set(selected);

    for (const s of diagram.shapes) {
        if (!ids.has(s.id) || !diagram.layerVisible(s)) continue;
        if (s.rotation) {
            const c = shapeCenter(s);
            p.Push();
            p.Translate(c.x, c.y);
            p.Rotate(s.rotation);
            p.Translate(-c.x, -c.y);
        }
        selectionOutline(p, s);
        p.Color = ACCENT;
        p.LineWidth = 1.5 / zoom;
        p.LineDash = [4 / zoom, 3 / zoom];
        p.Stroke();
        p.LineDash = [];
        if (s.rotation) p.Pop();
    }

    /* A group gets one dashed box around its selected members, so a click
     * that took two shapes reads as one object. */
    const groups = new Map();
    for (const s of diagram.shapes) {
        if (!ids.has(s.id) || !s.group) continue;
        if (!groups.has(s.group)) groups.set(s.group, []);
        groups.get(s.group).push(s);
    }
    for (const members of groups.values()) {
        if (members.length < 2) continue;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const s of members) {
            const box = shapeRectBounds(s);
            x0 = Math.min(x0, box.x);
            y0 = Math.min(y0, box.y);
            x1 = Math.max(x1, box.x + box.w);
            y1 = Math.max(y1, box.y + box.h);
        }
        p.Color = "rgba(53,132,228,0.5)";
        p.LineWidth = 1 / zoom;
        p.LineDash = [4 / zoom, 3 / zoom];
        p.Rectangle(x0 - 5 / zoom, y0 - 5 / zoom,
                    x1 - x0 + 10 / zoom, y1 - y0 + 10 / zoom);
        p.Stroke();
        p.LineDash = [];
    }

    /* Handles only when one shape and nothing else is selected. */
    const shapes = diagram.shapes.filter((s) => ids.has(s.id));
    if (shapes.length === 1 && selected.length === 1 && !shapes[0].rotation) {
        const size = 8 / zoom;
        for (const h of shapeHandles(shapes[0])) {
            p.Rectangle(h.x - size / 2, h.y - size / 2, size, size);
            p.Color = "#ffffff";
            p.Fill();
            p.Rectangle(h.x - size / 2, h.y - size / 2, size, size);
            p.Color = ACCENT;
            p.LineWidth = 1.4 / zoom;
            p.Stroke();
        }
    }

    for (const e of diagram.edges) {
        if (!ids.has(e.id) || !diagram.layerVisible(e)) continue;
        const points = edgeRoute(diagram, e);
        if (points.length < 4) continue;
        p.Color = "rgba(53,132,228,0.28)";
        p.LineWidth = 8 / zoom;
        p.Polyline(points);
        p.Stroke();
        p.Color = ACCENT;
        p.LineWidth = 1.5 / zoom;
        p.LineDash = [5 / zoom, 4 / zoom];
        p.Polyline(points);
        p.Stroke();
        p.LineDash = [];
    }
}

function drawGrid(p, view, width, height) {
    let step = 20 * view.zoom;
    if (step < 7) step *= 5;
    if (step < 7) return;

    const first = Math.floor((-view.panX) / step) - 1;
    const lastX = Math.ceil((width - view.panX) / step) + 1;
    const firstY = Math.floor((-view.panY) / step) - 1;
    const lastY = Math.ceil((height - view.panY) / step) + 1;

    p.Antialias = false;
    p.LineWidth = 1;

    p.Color = "rgba(15,23,42,0.055)";
    for (let i = first; i <= lastX; i++) {
        if (i % 5 === 0) continue;
        const x = view.panX + i * step;
        p.MoveTo(x, 0); p.LineTo(x, height);
    }
    for (let i = firstY; i <= lastY; i++) {
        if (i % 5 === 0) continue;
        const y = view.panY + i * step;
        p.MoveTo(0, y); p.LineTo(width, y);
    }
    p.Stroke();

    p.Color = "rgba(15,23,42,0.10)";
    for (let i = first; i <= lastX; i++) {
        if (i % 5 !== 0) continue;
        const x = view.panX + i * step;
        p.MoveTo(x, 0); p.LineTo(x, height);
    }
    for (let i = firstY; i <= lastY; i++) {
        if (i % 5 !== 0) continue;
        const y = view.panY + i * step;
        p.MoveTo(0, y); p.LineTo(width, y);
    }
    p.Stroke();
    p.Antialias = true;
}

/* ------------------------------------------------------------------ frames */

function drawContent(p, diagram, selected, zoom) {
    p.LineCap = "Round";
    p.LineJoin = "Round";

    /* Layers are the paint order: the last one in the document is the one on
     * top, so the canvas walks them from the end back to the first. */
    const firstLayer = diagram.layers && diagram.layers.length
        ? diagram.layers[0].id : "";
    const layerOf = (object) => object.layer || firstLayer;

    for (let i = diagram.layers.length - 1; i >= 0; i--) {
        const layer = diagram.layers[i];
        if (!layer.visible) continue;

        for (const s of diagram.shapes)
            if (layerOf(s) === layer.id) drawShape(p, s);

        for (const e of diagram.edges)
            if (layerOf(e) === layer.id && diagram.layerVisible(e))
                drawEdgeLine(p, e, edgeRoute(diagram, e));

        for (const e of diagram.edges)
            if (layerOf(e) === layer.id && diagram.layerVisible(e))
                edgeLabel(p, e, edgeRoute(diagram, e));
    }

    if (selected && selected.length)
        drawSelection(p, diagram, selected, zoom);
}

function drawCreatePreview(p, preview) {
    p.Color = "rgba(53,132,228,0.10)";
    p.Rectangle(preview.x, preview.y, preview.w, preview.h);
    p.Fill();
    p.Color = ACCENT;
    p.LineWidth = 1.5;
    p.LineDash = [5, 4];
    p.Rectangle(preview.x, preview.y, preview.w, preview.h);
    p.Stroke();
    p.LineDash = [];
}

function drawConnectPreview(p, preview) {
    p.Color = ACCENT;
    p.LineWidth = 2;
    p.LineDash = [6, 5];
    p.MoveTo(preview.x1, preview.y1);
    p.LineTo(preview.x2, preview.y2);
    p.Stroke();
    p.LineDash = [];
    p.Arc(preview.x2, preview.y2, 4 / Math.max(0.001, preview.zoom), 0, 360);
    p.Fill();
}

/* The lines an alignment snap is following, across the visible canvas. */
function drawGuides(p, guides, view, width, height) {
    if (!guides) return;
    const vertical = guides.vertical || [];
    const horizontal = guides.horizontal || [];
    if (!vertical.length && !horizontal.length) return;

    const left = -view.panX / view.zoom;
    const right = (width - view.panX) / view.zoom;
    const top = -view.panY / view.zoom;
    const bottom = (height - view.panY) / view.zoom;

    p.Color = "rgba(53,132,228,0.8)";
    p.LineWidth = 1 / view.zoom;
    p.LineDash = [5 / view.zoom, 4 / view.zoom];
    for (const x of vertical) {
        p.MoveTo(x, top);
        p.LineTo(x, bottom);
    }
    for (const y of horizontal) {
        p.MoveTo(left, y);
        p.LineTo(right, y);
    }
    p.Stroke();
    p.LineDash = [];
}

function drawBand(p, band) {
    p.Color = "rgba(53,132,228,0.12)";
    p.Rectangle(band.x, band.y, band.w, band.h);
    p.Fill();
    p.Color = ACCENT;
    p.LineWidth = 1;
    p.LineDash = [4, 3];
    p.Rectangle(band.x, band.y, band.w, band.h);
    p.Stroke();
    p.LineDash = [];
}

export function drawCanvas(p, diagram, view, width, height) {
    p.Color = "#f7f8fa";
    p.Rectangle(0, 0, width, height);
    p.Fill();

    if (view.grid) drawGrid(p, view, width, height);

    p.Push();
    p.Translate(view.panX, view.panY);
    p.Scale(view.zoom);

    drawContent(p, diagram, view.selected, view.zoom);
    drawGuides(p, view.guides, view, width, height);
    if (view.createPreview) drawCreatePreview(p, view.createPreview);
    if (view.connectPreview) drawConnectPreview(p, view.connectPreview);
    if (view.band) drawBand(p, view.band);

    p.Pop();
}

export function drawExport(p, diagram, width, height) {
    p.Color = "#ffffff";
    p.Rectangle(0, 0, width, height);
    p.Fill();

    const bounds = diagram.bounds();
    if (!bounds) return;

    const pad = 28;
    const zoom = Math.min((width - pad * 2) / Math.max(1, bounds.w),
                          (height - pad * 2) / Math.max(1, bounds.h), 4);
    const safe = Math.max(0.01, zoom);

    p.Push();
    p.Translate(pad + (width - pad * 2 - bounds.w * safe) / 2 - bounds.x * safe,
                pad + (height - pad * 2 - bounds.h * safe) / 2 - bounds.y * safe);
    p.Scale(safe);
    drawContent(p, diagram, null, safe);
    p.Pop();
}
