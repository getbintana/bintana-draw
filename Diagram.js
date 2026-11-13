/*
 * The document behind the canvas: shapes, connectors and the geometry both
 * need. It knows nothing about widgets, which is what lets a plain `main`
 * project (or the self-check) exercise it with no display at all.
 *
 * A diagram is a list of shapes with an id, a rectangle and a kind, plus a list
 * of edges that name two shape ids. **Nothing is cached**: an edge's route is
 * computed from the two rectangles every time it is asked for, so moving or
 * resizing a shape moves its connectors with it and there is no second copy to
 * keep in step.
 */
"use strict";

export const SHAPE_KINDS = ["rect", "round", "ellipse", "diamond",
                            "terminator", "data", "cylinder", "note", "text"];

export const DEFAULT_FILL   = "#dae8fc";
export const DEFAULT_STROKE = "#6c8ebf";
export const DEFAULT_TEXT   = "#1f2937";
export const DEFAULT_EDGE   = "#495057";

const MIN_SIZE = 16;
const STUB     = 18;

/* A stable, finite number, whatever a hand-edited file says. */
function number(value, fallback) {
    return (typeof value === "number" && value === value &&
            value !== Infinity && value !== -Infinity) ? value : fallback;
}

function text(value, fallback) {
    return typeof value === "string" ? value : (fallback || "");
}

function kind(value) {
    return SHAPE_KINDS.indexOf(value) >= 0 ? value : "rect";
}

function copyShape(s) {
    return {
        id: s.id, kind: s.kind, x: s.x, y: s.y, w: s.w, h: s.h,
        text: s.text, fill: s.fill, stroke: s.stroke,
        textColor: s.textColor, fontSize: s.fontSize, radius: s.radius,
    };
}

function copyEdge(e) {
    return {
        id: e.id, from: e.from, to: e.to, text: e.text,
        stroke: e.stroke, dashed: e.dashed, fontSize: e.fontSize,
    };
}

export class Diagram {

    constructor() {
        this.shapes    = [];
        this.edges     = [];
        this.nextShape = 1;
        this.nextEdge  = 1;
    }

    addShape(kindName, x, y, w, h, options) {
        const o = options || {};
        const shape = {
            id: "s" + (this.nextShape++),
            kind: kind(kindName),
            x: Math.round(number(x, 0)),
            y: Math.round(number(y, 0)),
            w: Math.max(MIN_SIZE, Math.round(number(w, 140))),
            h: Math.max(MIN_SIZE, Math.round(number(h, 70))),
            text: text(o.text, ""),
            fill: text(o.fill, DEFAULT_FILL),
            stroke: text(o.stroke, DEFAULT_STROKE),
            textColor: text(o.textColor, DEFAULT_TEXT),
            fontSize: Math.max(6, Math.round(number(o.fontSize, 12))),
            radius: Math.max(0, Math.round(number(o.radius, 12))),
        };
        this.shapes.push(shape);
        return shape;
    }

    addEdge(from, to, options) {
        const o = options || {};
        if (!this.shapeById(from) || !this.shapeById(to)) return null;
        const edge = {
            id: "e" + (this.nextEdge++),
            from: from,
            to: to,
            text: text(o.text, ""),
            stroke: text(o.stroke, DEFAULT_EDGE),
            dashed: o.dashed === true,
            fontSize: Math.max(6, Math.round(number(o.fontSize, 11))),
        };
        this.edges.push(edge);
        return edge;
    }

    shapeById(id) {
        for (const s of this.shapes) if (s.id === id) return s;
        return null;
    }

    edgeById(id) {
        for (const e of this.edges) if (e.id === id) return e;
        return null;
    }

    find(id) {
        return this.shapeById(id) || this.edgeById(id);
    }

    /* The topmost shape under a point, in the same order the canvas paints. */
    shapeAt(x, y) {
        for (let i = this.shapes.length - 1; i >= 0; i--) {
            if (pointInShape(this.shapes[i], x, y)) return this.shapes[i];
        }
        return null;
    }

    /* An edge under a point, within `tolerance` world units. */
    edgeAt(x, y, tolerance) {
        let best = null, bestAt = tolerance;
        for (let i = this.edges.length - 1; i >= 0; i--) {
            const d = distanceToPolyline(edgeRoute(this, this.edges[i]), x, y);
            if (d <= bestAt) { best = this.edges[i]; bestAt = d; }
        }
        return best;
    }

    /* What Delete removes: the named shapes and edges, and every edge left
     * hanging by a shape that went. */
    remove(ids) {
        const gone = new Set(ids);
        this.shapes = this.shapes.filter((s) => !gone.has(s.id));
        const remains = new Set();
        for (const s of this.shapes) remains.add(s.id);
        this.edges = this.edges.filter((e) =>
            !gone.has(e.id) && remains.has(e.from) && remains.has(e.to));
    }

    bounds() {
        if (!this.shapes.length) return null;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const s of this.shapes) {
            x0 = Math.min(x0, s.x);
            y0 = Math.min(y0, s.y);
            x1 = Math.max(x1, s.x + s.w);
            y1 = Math.max(y1, s.y + s.h);
        }
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    toJSON() {
        return {
            format: "bintana-draw/1",
            version: 1,
            shapes: this.shapes.map(copyShape),
            edges: this.edges.map(copyEdge),
        };
    }

    static fromJSON(data) {
        if (!data || data.format !== "bintana-draw/1")
            throw new Error("Not a Bintana Draw diagram");

        const diagram = new Diagram();
        const used    = new Set();
        const renamed = new Map();

        const shapes = Array.isArray(data.shapes) ? data.shapes : [];
        for (const raw of shapes) {
            if (!raw || typeof raw !== "object") continue;
            const old = text(raw.id, "");
            let id = old;
            if (!id || used.has(id)) id = "s" + (diagram.nextShape++);
            if (old) renamed.set(old, id);
            used.add(id);

            const shape = {
                id: id,
                kind: kind(raw.kind),
                x: Math.round(number(raw.x, 0)),
                y: Math.round(number(raw.y, 0)),
                w: Math.max(MIN_SIZE, Math.round(number(raw.w, 140))),
                h: Math.max(MIN_SIZE, Math.round(number(raw.h, 70))),
                text: text(raw.text, ""),
                fill: text(raw.fill, DEFAULT_FILL),
                stroke: text(raw.stroke, DEFAULT_STROKE),
                textColor: text(raw.textColor, DEFAULT_TEXT),
                fontSize: Math.max(6, Math.round(number(raw.fontSize, 12))),
                radius: Math.max(0, Math.round(number(raw.radius, 12))),
            };
            diagram.shapes.push(shape);
        }

        const edges = Array.isArray(data.edges) ? data.edges : [];
        for (const raw of edges) {
            if (!raw || typeof raw !== "object") continue;
            const from = renamed.has(text(raw.from, "")) ? renamed.get(raw.from) : text(raw.from, "");
            const to   = renamed.has(text(raw.to, "")) ? renamed.get(raw.to) : text(raw.to, "");
            if (!from || !to || from === to) continue;
            if (!diagram.shapeById(from) || !diagram.shapeById(to)) continue;

            let id = text(raw.id, "");
            if (!id || diagram.edgeById(id)) id = "e" + (diagram.nextEdge++);
            const edge = {
                id: id,
                from: from,
                to: to,
                text: text(raw.text, ""),
                stroke: text(raw.stroke, DEFAULT_EDGE),
                dashed: raw.dashed === true,
                fontSize: Math.max(6, Math.round(number(raw.fontSize, 11))),
            };
            diagram.edges.push(edge);
        }

        /* Ids loaded from a file may be "s12" with one shape in it; the next
         * new one must not collide with what is already there. */
        while (diagram.shapeById("s" + diagram.nextShape)) diagram.nextShape++;
        while (diagram.edgeById("e" + diagram.nextEdge)) diagram.nextEdge++;
        return diagram;
    }
}

/* ------------------------------------------------------------------ shapes */

export function pointInShape(s, x, y) {
    if (x < s.x || y < s.y || x > s.x + s.w || y > s.y + s.h) return false;
    if (s.kind === "ellipse") {
        const rx = s.w / 2, ry = s.h / 2;
        const dx = (x - (s.x + rx)) / rx;
        const dy = (y - (s.y + ry)) / ry;
        return dx * dx + dy * dy <= 1;
    }
    if (s.kind === "diamond") {
        const dx = Math.abs(x - (s.x + s.w / 2)) / (s.w / 2);
        const dy = Math.abs(y - (s.y + s.h / 2)) / (s.h / 2);
        return dx + dy <= 1;
    }
    return true;
}

export function shapeCenter(s) {
    return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
}

function sideAnchor(s, side) {
    switch (side) {
    case "left":   return { x: s.x,           y: s.y + s.h / 2 };
    case "right":  return { x: s.x + s.w,     y: s.y + s.h / 2 };
    case "top":    return { x: s.x + s.w / 2, y: s.y };
    default:       return { x: s.x + s.w / 2, y: s.y + s.h };
    }
}

function sideVector(side) {
    switch (side) {
    case "left":   return { x: -1, y: 0 };
    case "right":  return { x: 1,  y: 0 };
    case "top":    return { x: 0,  y: -1 };
    default:       return { x: 0,  y: 1 };
    }
}

function chooseSides(a, b) {
    const ca = shapeCenter(a), cb = shapeCenter(b);
    const dx = cb.x - ca.x, dy = cb.y - ca.y;

    /* Which way the two rectangles are actually apart, not where their
     * centres are: a target below and to one side takes the vertical route
     * when the vertical gap is the larger one, which is the line a person
     * draws between stacked boxes. */
    const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
    const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));

    if (gapX >= gapY)
        return dx >= 0 ? ["right", "left"] : ["left", "right"];
    return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

function dedupe(points) {
    const out = [];
    for (const p of points) {
        const last = out[out.length - 1];
        if (last && Math.abs(last.x - p.x) < 0.01 &&
                   Math.abs(last.y - p.y) < 0.01) continue;
        out.push(p);
    }
    return out;
}

/*
 * An orthogonal route from one rectangle to another, as a flat array of
 * x, y pairs -- the shape `Painter.Polyline` takes.
 *
 * The rule is the one a person draws: leave each shape square to the side
 * facing the other, then join the two stubs with as few right angles as the
 * two directions allow. Opposite sides meet halfway, the same side takes a
 * corridor outside both, and perpendicular sides turn once.
 */
export function edgeRoute(diagram, edge) {
    const a = diagram.shapeById(edge.from);
    const b = diagram.shapeById(edge.to);
    if (!a || !b) return [];

    const sides = chooseSides(a, b);
    const outSide = sides[0], inSide = sides[1];
    const p0 = sideAnchor(a, outSide);
    const p1 = sideAnchor(b, inSide);
    const v0 = sideVector(outSide);
    const v1 = sideVector(inSide);

    const A = { x: p0.x + v0.x * STUB, y: p0.y + v0.y * STUB };
    const B = { x: p1.x + v1.x * STUB, y: p1.y + v1.y * STUB };
    const points = [p0, A];
    const horizontal0 = outSide === "left" || outSide === "right";
    const horizontal1 = inSide === "left" || inSide === "right";

    if (horizontal0 && horizontal1) {
        let x;
        if ((outSide === "right" && inSide === "left") ||
            (outSide === "left" && inSide === "right")) {
            x = (A.x + B.x) / 2;
        } else if (outSide === "right") {
            x = Math.max(A.x, B.x);
        } else {
            x = Math.min(A.x, B.x);
        }
        points.push({ x: x, y: A.y }, { x: x, y: B.y });
    } else if (!horizontal0 && !horizontal1) {
        let y;
        if ((outSide === "bottom" && inSide === "top") ||
            (outSide === "top" && inSide === "bottom")) {
            y = (A.y + B.y) / 2;
        } else if (outSide === "bottom") {
            y = Math.max(A.y, B.y);
        } else {
            y = Math.min(A.y, B.y);
        }
        points.push({ x: A.x, y: y }, { x: B.x, y: y });
    } else if (horizontal0) {
        points.push({ x: B.x, y: A.y });
    } else {
        points.push({ x: A.x, y: B.y });
    }

    points.push(B, p1);
    const clean = dedupe(points);
    const flat = [];
    for (const p of clean) flat.push(p.x, p.y);
    return flat;
}

export function polylineLength(points) {
    let total = 0;
    for (let i = 2; i < points.length; i += 2) {
        total += Math.hypot(points[i] - points[i - 2],
                            points[i + 1] - points[i - 1]);
    }
    return total;
}

export function edgeMidpoint(points) {
    if (points.length < 2) return null;
    const half = polylineLength(points) / 2;
    let walked = 0;
    for (let i = 2; i < points.length; i += 2) {
        const ax = points[i - 2], ay = points[i - 1];
        const bx = points[i],     by = points[i + 1];
        const seg = Math.hypot(bx - ax, by - ay);
        if (walked + seg >= half) {
            const t = seg ? (half - walked) / seg : 0;
            return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
        }
        walked += seg;
    }
    return { x: points[points.length - 2], y: points[points.length - 1] };
}

export function distanceToPolyline(points, x, y) {
    if (points.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 2; i < points.length; i += 2) {
        best = Math.min(best, distanceToSegment(x, y,
            points[i - 2], points[i - 1], points[i], points[i + 1]));
    }
    return best;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const length2 = dx * dx + dy * dy;
    let t = length2 ? ((px - ax) * dx + (py - ay) * dy) / length2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
