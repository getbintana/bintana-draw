/*
 * A draw.io stencil set, read as shape library items.
 *
 * A stencil is vector geometry in its own coordinate box: a `<shape>` with
 * `<background>` and `<foreground>`, and inside them paths, rectangles,
 * ellipses and the paint commands that decide which of the two each piece
 * gets. The importer turns that into the same normalized item the library
 * already stores, with the geometry in `vector.parts` and the coordinates
 * untouched, so resizing is a scale of the whole little drawing.
 *
 * The arc conversion is the only arithmetic worth knowing: draw.io describes
 * an elliptical arc by its two endpoints, and the painter draws cubic Béziers,
 * so each arc becomes the standard centre-parameterised segments.
 */
"use strict";

const KAPPA = 0.5522847498307936;
const DEFAULT_W = 100;
const DEFAULT_H = 100;

function attrNumber(node, name, fallback) {
    const value = node.Attr(name);
    if (value === null || value === "") return fallback;
    const n = parseFloat(value);
    return (n === n && n !== Infinity && n !== -Infinity) ? n : fallback;
}

function numberText(value) {
    const rounded = Math.round(value * 1000) / 1000;
    return String(rounded);
}

function pathText(parts) {
    return parts.join(" ");
}

function lineTo(x, y) {
    return "L " + numberText(x) + " " + numberText(y);
}

function curveTo(x1, y1, x2, y2, x, y) {
    return "C " + numberText(x1) + " " + numberText(y1) + " " +
           numberText(x2) + " " + numberText(y2) + " " +
           numberText(x) + " " + numberText(y);
}

/* The SVG endpoint arc, as cubic segments. `null` when there is nothing to
 * draw, a line when a radius is zero. */
function arcCubics(x1, y1, rx, ry, rotation, large, sweep, x2, y2) {
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (rx === 0 || ry === 0) return null;
    if (Math.abs(x1 - x2) < 1e-9 && Math.abs(y1 - y2) < 1e-9)
        return [];

    const phi = rotation * Math.PI / 180;
    const cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cos * dx + sin * dy;
    const y1p = -sin * dx + cos * dy;

    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
        const k = Math.sqrt(lambda);
        rx *= k;
        ry *= k;
    }

    const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p -
                      ry * ry * x1p * x1p;
    const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    if (denominator === 0) return null;
    const sign = large === sweep ? -1 : 1;
    const coef = sign * Math.sqrt(Math.max(0, numerator / denominator));
    const cxp = coef * (rx * y1p / ry);
    const cyp = coef * (-ry * x1p / rx);
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
    const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;

    const angle = (ux, uy, vx, vy) => {
        const dot = ux * vx + uy * vy;
        const length = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
        let a = Math.acos(Math.max(-1, Math.min(1, dot / length)));
        if (ux * vy - uy * vx < 0) a = -a;
        return a;
    };

    const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
    const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
    const theta = angle(1, 0, ux, uy);
    let delta = angle(ux, uy, vx, vy);
    if (!sweep && delta > 0) delta -= 2 * Math.PI;
    if (sweep && delta < 0) delta += 2 * Math.PI;

    const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
    const step = delta / segments;
    const out = [];
    for (let i = 0; i < segments; i++) {
        const a1 = theta + i * step;
        const a2 = a1 + step;
        const alpha = (4 / 3) * Math.tan((a2 - a1) / 4);

        const p1x = cx + cos * rx * Math.cos(a1) - sin * ry * Math.sin(a1);
        const p1y = cy + sin * rx * Math.cos(a1) + cos * ry * Math.sin(a1);
        const p2x = cx + cos * rx * Math.cos(a2) - sin * ry * Math.sin(a2);
        const p2y = cy + sin * rx * Math.cos(a2) + cos * ry * Math.sin(a2);
        const d1x = -rx * Math.sin(a1), d1y = ry * Math.cos(a1);
        const d2x = -rx * Math.sin(a2), d2y = ry * Math.cos(a2);

        out.push([
            p1x + alpha * (cos * d1x - sin * d1y),
            p1y + alpha * (sin * d1x + cos * d1y),
            p2x - alpha * (cos * d2x - sin * d2y),
            p2y - alpha * (sin * d2x + cos * d2y),
            p2x, p2y,
        ]);
    }
    return out;
}

function rectPath(x, y, w, h) {
    return pathText([
        "M " + numberText(x) + " " + numberText(y),
        lineTo(x + w, y),
        lineTo(x + w, y + h),
        lineTo(x, y + h),
        "Z",
    ]);
}

function roundRectPath(x, y, w, h, radius) {
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    if (r === 0) return rectPath(x, y, w, h);
    const k = r * KAPPA;
    return pathText([
        "M " + numberText(x + r) + " " + numberText(y),
        lineTo(x + w - r, y),
        curveTo(x + w - r + k, y, x + w, y + r - k, x + w, y + r),
        lineTo(x + w, y + h - r),
        curveTo(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h),
        lineTo(x + r, y + h),
        curveTo(x + r - k, y + h, x, y + h - r + k, x, y + h - r),
        lineTo(x, y + r),
        curveTo(x, y + r - k, x + r - k, y, x + r, y),
        "Z",
    ]);
}

function ellipsePath(x, y, w, h) {
    const rx = w / 2, ry = h / 2;
    const cx = x + rx, cy = y + ry;
    const kx = rx * KAPPA, ky = ry * KAPPA;
    return pathText([
        "M " + numberText(cx + rx) + " " + numberText(cy),
        curveTo(cx + rx, cy - ky, cx + kx, cy - ry, cx, cy - ry),
        curveTo(cx - kx, cy - ry, cx - rx, cy - ky, cx - rx, cy),
        curveTo(cx - rx, cy + ky, cx - kx, cy + ry, cx, cy + ry),
        curveTo(cx + kx, cy + ry, cx + rx, cy + ky, cx + rx, cy),
        "Z",
    ]);
}

function pathFromCommands(node) {
    const out = [];
    let currentX = 0, currentY = 0;
    for (const child of node.Children) {
        switch (child.Name) {
        case "move":
            currentX = attrNumber(child, "x", 0);
            currentY = attrNumber(child, "y", 0);
            out.push("M " + numberText(currentX) + " " + numberText(currentY));
            break;
        case "line":
            currentX = attrNumber(child, "x", currentX);
            currentY = attrNumber(child, "y", currentY);
            out.push(lineTo(currentX, currentY));
            break;
        case "quad": {
            const qx = attrNumber(child, "x1", currentX);
            const qy = attrNumber(child, "y1", currentY);
            currentX = attrNumber(child, "x2", currentX);
            currentY = attrNumber(child, "y2", currentY);
            out.push("Q " + numberText(qx) + " " + numberText(qy) + " " +
                     numberText(currentX) + " " + numberText(currentY));
            break;
        }
        case "curve": {
            const x1 = attrNumber(child, "x1", currentX);
            const y1 = attrNumber(child, "y1", currentY);
            const x2 = attrNumber(child, "x2", currentX);
            const y2 = attrNumber(child, "y2", currentY);
            currentX = attrNumber(child, "x3", currentX);
            currentY = attrNumber(child, "y3", currentY);
            out.push(curveTo(x1, y1, x2, y2, currentX, currentY));
            break;
        }
        case "arc": {
            const x2 = attrNumber(child, "x", currentX);
            const y2 = attrNumber(child, "y", currentY);
            const cubics = arcCubics(
                currentX, currentY,
                attrNumber(child, "rx", 0), attrNumber(child, "ry", 0),
                attrNumber(child, "x-axis-rotation", 0),
                attrNumber(child, "large-arc-flag", 0) !== 0,
                attrNumber(child, "sweep-flag", 0) !== 0,
                x2, y2);
            if (cubics === null) out.push(lineTo(x2, y2));
            else for (const c of cubics)
                out.push(curveTo(c[0], c[1], c[2], c[3], c[4], c[5]));
            currentX = x2;
            currentY = y2;
            break;
        }
        case "close":
            out.push("Z");
            break;
        }
    }
    return pathText(out);
}

function stateCopy(state) {
    return {
        fillColor: state.fillColor, strokeColor: state.strokeColor,
        width: state.width, alpha: state.alpha,
        fillAlpha: state.fillAlpha, strokeAlpha: state.strokeAlpha,
        dash: state.dash.slice(), join: state.join, cap: state.cap,
    };
}

function defaultState() {
    return {
        fillColor: "", strokeColor: "", width: 0, alpha: 1,
        fillAlpha: 1, strokeAlpha: 1, dash: [], join: "", cap: "",
    };
}

function addPart(parts, d) {
    parts.push({ d: d, fill: false, stroke: false });
    return parts[parts.length - 1];
}

function paintLast(parts, state, fill, stroke) {
    const part = parts[parts.length - 1];
    if (!part) return;
    if (fill) {
        part.fill = true;
        part.fillColor = state.fillColor;
        part.fillAlpha = state.alpha * state.fillAlpha;
    }
    if (stroke) {
        part.stroke = true;
        part.strokeColor = state.strokeColor;
        part.strokeAlpha = state.alpha * state.strokeAlpha;
        part.width = state.width;
        part.dash = state.dash.slice();
        part.join = state.join;
        part.cap = state.cap;
    }
}

function parseDrawing(node, width, height, state, parts, stack) {
    if (!node) return;
    for (const child of node.Children) {
        switch (child.Name) {
        case "save":
            stack.push(stateCopy(state));
            break;
        case "restore":
            if (stack.length) {
                const saved = stack.pop();
                state.fillColor = saved.fillColor;
                state.strokeColor = saved.strokeColor;
                state.width = saved.width;
                state.alpha = saved.alpha;
                state.fillAlpha = saved.fillAlpha;
                state.strokeAlpha = saved.strokeAlpha;
                state.dash = saved.dash;
                state.join = saved.join;
                state.cap = saved.cap;
            }
            break;
        case "fillcolor": {
            const color = child.Attr("color") || "";
            state.fillColor = (color === "accentColor" || color === "default")
                ? (child.Attr("default") || "") : color;
            break;
        }
        case "strokecolor": {
            const color = child.Attr("color") || "";
            state.strokeColor = (color === "accentColor" || color === "default")
                ? (child.Attr("default") || "") : color;
            break;
        }
        case "strokewidth":
            state.width = attrNumber(child, "width", state.width);
            break;
        case "alpha":
            state.alpha = attrNumber(child, "alpha", state.alpha);
            break;
        case "fillalpha":
            state.fillAlpha = attrNumber(child, "alpha", state.fillAlpha);
            break;
        case "strokealpha":
            state.strokeAlpha = attrNumber(child, "alpha", state.strokeAlpha);
            break;
        case "dashed":
            if (child.Attr("dashed") === "1") {
                if (!state.dash.length) state.dash = [5, 5];
            } else {
                state.dash = [];
            }
            break;
        case "dashpattern": {
            const pattern = child.Attr("pattern") || "";
            state.dash = pattern === "none" || pattern === ""
                ? [] : pattern.split(/\s+/).map(Number).filter((n) => n > 0);
            break;
        }
        case "linejoin":
            state.join = child.Attr("join") || "";
            break;
        case "linecap":
            state.cap = child.Attr("cap") || "";
            break;
        case "fill":
            paintLast(parts, state, true, false);
            break;
        case "stroke":
            paintLast(parts, state, false, true);
            break;
        case "fillstroke":
            paintLast(parts, state, true, true);
            break;
        case "path":
            addPart(parts, pathFromCommands(child));
            break;
        case "rect": {
            const x = attrNumber(child, "x", 0);
            const y = attrNumber(child, "y", 0);
            const w = attrNumber(child, "w", width);
            const h = attrNumber(child, "h", height);
            addPart(parts, rectPath(x, y, w, h));
            break;
        }
        case "roundrect": {
            const x = attrNumber(child, "x", 0);
            const y = attrNumber(child, "y", 0);
            const w = attrNumber(child, "w", width);
            const h = attrNumber(child, "h", height);
            const radius = attrNumber(child, "arcsize", 0);
            addPart(parts, roundRectPath(x, y, w, h, radius));
            break;
        }
        case "ellipse": {
            const x = attrNumber(child, "x", 0);
            const y = attrNumber(child, "y", 0);
            const w = attrNumber(child, "w", width);
            const h = attrNumber(child, "h", height);
            addPart(parts, ellipsePath(x, y, w, h));
            break;
        }
        case "line": {
            const x1 = attrNumber(child, "x1", 0);
            const y1 = attrNumber(child, "y1", 0);
            const x2 = attrNumber(child, "x2", 0);
            const y2 = attrNumber(child, "y2", 0);
            addPart(parts, pathText([
                "M " + numberText(x1) + " " + numberText(y1),
                lineTo(x2, y2),
            ]));
            break;
        }
        }
    }
}

function stencilParts(node, width, height) {
    const parts = [];
    const state = defaultState();
    const stack = [];
    parseDrawing(node.Find("background"), width, height, state, parts, stack);
    parseDrawing(node.Find("foreground"), width, height, state, parts, stack);

    /* A background without a paint command is still the filled outline, which
     * is how the simplest stencils are written. */
    for (const part of parts)
        if (!part.fill && !part.stroke) {
            part.fill = true;
            part.stroke = true;
        }
    return parts.filter((part) => part.d);
}

function stencilShape(node, width, height, parts) {
    const scale = Math.min(4, 120 / Math.max(width, height));
    const w = Math.max(20, Math.round(width * scale));
    const h = Math.max(20, Math.round(height * scale));
    const stroke = attrNumber(node, "strokewidth", 1.5);
    return {
        id: "v1", kind: "vector", group: "", layer: "",
        x: 0, y: 0, w: w, h: h, rotation: 0,
        text: "", fill: "#dae8fc", stroke: "#6c8ebf",
        strokeWidth: stroke > 0 ? stroke : 1.5,
        dash: "solid", textColor: "#1f2937", fontSize: 12, radius: 12,
        textBold: false, textItalic: false,
        textAlign: "", textVAlign: "", image: "",
        vector: { w: width, h: height, parts: parts },
    };
}

export function stencilItems(root) {
    if (!root) return [];
    const nodes = root.Name === "shape" ? [root] : root.FindAll("shape");
    const items = [];
    for (const node of nodes) {
        const name = node.Attr("name") || Locale.Text("Stencil");
        const width = attrNumber(node, "w", DEFAULT_W);
        const height = attrNumber(node, "h", DEFAULT_H);
        const parts = stencilParts(node, width, height);
        if (!parts.length) continue;
        const shape = stencilShape(node, width, height, parts);
        items.push({
            name: name, w: shape.w, h: shape.h,
            shapes: [shape], edges: [],
        });
    }
    return items;
}
