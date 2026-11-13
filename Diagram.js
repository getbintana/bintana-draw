/*
 * The document behind the canvas: shapes, connectors and the geometry both
 * need. It knows nothing about widgets, which is what lets a plain `main`
 * project (or the self-check) exercise it with no display at all.
 *
 * A diagram is a list of shapes with an id, a rectangle and a kind, plus a list
 * of edges that name two shape ids. A shape and an edge also name a layer, and
 * the layers carry the visibility and the lock the canvas obeys. **Nothing is
 * cached**: an edge's route is computed from the two rectangles every time it
 * is asked for, so moving or resizing a shape moves its connectors with it and
 * there is no second copy to keep in step.
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
        id: s.id, kind: s.kind, layer: s.layer, group: s.group,
        x: s.x, y: s.y, w: s.w, h: s.h,
        text: s.text, fill: s.fill, stroke: s.stroke,
        strokeWidth: s.strokeWidth, dash: s.dash,
        textColor: s.textColor, fontSize: s.fontSize, radius: s.radius,
        textBold: s.textBold, textItalic: s.textItalic,
        textAlign: s.textAlign, textVAlign: s.textVAlign,
    };
}

function copyEdge(e) {
    return {
        id: e.id, from: e.from, to: e.to, layer: e.layer, text: e.text,
        stroke: e.stroke, strokeWidth: e.strokeWidth, dash: e.dash,
        dashed: e.dash !== "solid", textColor: e.textColor,
        fontSize: e.fontSize, textBold: e.textBold, textItalic: e.textItalic,
    };
}

function pageJSON(page) {
    return {
        layers: page.layers.map((l) => ({
            id: l.id, name: l.name,
            visible: l.visible, locked: l.locked,
        })),
        shapes: page.shapes.map(copyShape),
        edges: page.edges.map(copyEdge),
    };
}

export class Diagram {

    constructor() {
        this.shapes    = [];
        this.edges     = [];
        this.layers    = [{
            id: "l1",
            name: Locale.Text("Layer {0}", 1),
            visible: true,
            locked: false,
        }];
        this.nextShape = 1;
        this.nextEdge  = 1;
        this.nextLayer = 2;
        this.nextGroup = 1;
    }

    addLayer(name) {
        const hierarchy = this.layers.length + 1;
        const layer = {
            id: "l" + (this.nextLayer++),
            name: (typeof name === "string" && name.trim())
                ? name : Locale.Text("Layer {0}", hierarchy),
            visible: true,
            locked: false,
        };
        this.layers.push(layer);
        return layer;
    }

    layerById(id) {
        for (const layer of this.layers) if (layer.id === id) return layer;
        return null;
    }

    /* An object from before layers, or a hand-edited one, belongs to the first
     * layer rather than to nobody. */
    layerOf(object) {
        return this.layerById(object && object.layer) || this.layers[0] || null;
    }

    layerVisible(object) {
        const layer = this.layerOf(object);
        if (!layer || !layer.visible) return false;
        /* An edge whose endpoint is on a hidden layer would read as a line
         * arriving from nowhere; it goes with its shape. */
        if (object && object.from) {
            const from = this.shapeById(object.from);
            const to = this.shapeById(object.to);
            if (from && !this.layerVisible(from)) return false;
            if (to && !this.layerVisible(to)) return false;
        }
        return true;
    }

    canSelect(objectOrId) {
        const object = typeof objectOrId === "string"
            ? this.find(objectOrId)
            : objectOrId;
        if (!object) return false;
        const layer = this.layerOf(object);
        if (!layer || !layer.visible || layer.locked) return false;
        return this.layerVisible(object);
    }

    layerShapeCount(id) {
        let count = 0;
        for (const s of this.shapes) if (s.layer === id) count++;
        return count;
    }

    moveLayer(id, delta) {
        const at = this.layers.findIndex((l) => l.id === id);
        const to = at + delta;
        if (at < 0 || to < 0 || to >= this.layers.length) return false;
        const layer = this.layers[at];
        this.layers.splice(at, 1);
        this.layers.splice(to, 0, layer);
        return true;
    }

    removeLayer(id) {
        if (this.layers.length < 2) return null;
        const layer = this.layerById(id);
        if (!layer) return null;
        const ids = [];
        for (const s of this.shapes) if (s.layer === id) ids.push(s.id);
        for (const e of this.edges) if (e.layer === id) ids.push(e.id);
        this.remove(ids);
        this.layers = this.layers.filter((l) => l.id !== id);
        return layer;
    }

    newGroup() {
        return "g" + (this.nextGroup++);
    }

    groupExists(id) {
        for (const s of this.shapes) if (s.group === id) return true;
        return false;
    }

    groupMembers(id) {
        const out = [];
        if (!id) return out;
        for (const s of this.shapes) if (s.group === id) out.push(s);
        return out;
    }

    addShape(kindName, x, y, w, h, options) {
        const o = options || {};
        const layer = this.layerById(o.layer) ? o.layer : this.layers[0].id;
        const shape = {
            id: "s" + (this.nextShape++),
            kind: kind(kindName),
            layer: layer,
            group: text(o.group, ""),
            x: Math.round(number(x, 0)),
            y: Math.round(number(y, 0)),
            w: Math.max(MIN_SIZE, Math.round(number(w, 140))),
            h: Math.max(MIN_SIZE, Math.round(number(h, 70))),
            text: text(o.text, ""),
            fill: text(o.fill, DEFAULT_FILL),
            stroke: text(o.stroke, DEFAULT_STROKE),
            strokeWidth: Math.max(0.5, number(o.strokeWidth, 1.5)),
            dash: o.dash === "dash" || o.dash === "dot" ? o.dash : "solid",
            textColor: text(o.textColor, DEFAULT_TEXT),
            fontSize: Math.max(6, Math.round(number(o.fontSize, 12))),
            radius: Math.max(0, Math.round(number(o.radius, 12))),
            textBold: o.textBold === true,
            textItalic: o.textItalic === true,
            textAlign: text(o.textAlign, ""),
            textVAlign: text(o.textVAlign, ""),
        };
        this.shapes.push(shape);
        return shape;
    }

    addEdge(from, to, options) {
        const o = options || {};
        if (!this.shapeById(from) || !this.shapeById(to)) return null;
        const layer = this.layerById(o.layer) ? o.layer : this.layers[0].id;
        const edge = {
            id: "e" + (this.nextEdge++),
            from: from,
            to: to,
            layer: layer,
            text: text(o.text, ""),
            stroke: text(o.stroke, DEFAULT_EDGE),
            strokeWidth: Math.max(0.5, number(o.strokeWidth, 2)),
            dash: o.dash === "dash" || o.dash === "dot"
                ? o.dash : (o.dashed === true ? "dash" : "solid"),
            dashed: o.dash === "dash" || o.dash === "dot" ||
                    o.dashed === true,
            textColor: text(o.textColor, ""),
            fontSize: Math.max(6, Math.round(number(o.fontSize, 11))),
            textBold: o.textBold === true,
            textItalic: o.textItalic === true,
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

    /* The topmost shape under a point, in the same order the canvas paints:
     * the last layer first, and inside it the last shape first. */
    shapeAt(x, y) {
        const firstLayer = this.layers.length ? this.layers[0].id : "";
        for (let l = this.layers.length - 1; l >= 0; l--) {
            const layer = this.layers[l];
            if (!layer.visible || layer.locked) continue;
            for (let i = this.shapes.length - 1; i >= 0; i--) {
                const shape = this.shapes[i];
                if ((shape.layer || firstLayer) !== layer.id) continue;
                if (pointInShape(shape, x, y)) return shape;
            }
        }
        return null;
    }

    /* An edge under a point, within `tolerance` world units, top layer first. */
    edgeAt(x, y, tolerance) {
        const firstLayer = this.layers.length ? this.layers[0].id : "";
        for (let l = this.layers.length - 1; l >= 0; l--) {
            const layer = this.layers[l];
            if (!layer.visible || layer.locked) continue;
            for (let i = this.edges.length - 1; i >= 0; i--) {
                const edge = this.edges[i];
                if ((edge.layer || firstLayer) !== layer.id) continue;
                if (!this.layerVisible(edge)) continue;
                if (distanceToPolyline(edgeRoute(this, edge), x, y) <= tolerance)
                    return edge;
            }
        }
        return null;
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
            if (!this.layerVisible(s)) continue;
            x0 = Math.min(x0, s.x);
            y0 = Math.min(y0, s.y);
            x1 = Math.max(x1, s.x + s.w);
            y1 = Math.max(y1, s.y + s.h);
        }
        if (x0 === Infinity) return null;
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    toJSON() {
        return {
            format: "bintana-draw/1",
            version: 1,
            ...pageJSON(this),
        };
    }

    static fromJSON(data) {
        if (!data || data.format !== "bintana-draw/1")
            throw new Error("Not a Bintana Draw diagram");

        const diagram = new Diagram();
        const used    = new Set();
        const renamed = new Map();

        /* Version 1 had no layers; its shapes become the first layer. */
        if (Array.isArray(data.layers) && data.layers.length) {
            const layers = [];
            const layerIds = new Set();
            for (const raw of data.layers) {
                if (!raw || typeof raw !== "object") continue;
                let id = text(raw.id, "");
                if (!id || layerIds.has(id)) id = "l" + (diagram.nextLayer++);
                layerIds.add(id);
                layers.push({
                    id: id,
                    name: (typeof raw.name === "string" && raw.name.trim())
                        ? raw.name
                        : Locale.Text("Layer {0}", layers.length + 1),
                    visible: raw.visible !== false,
                    locked: raw.locked === true,
                });
            }
            if (layers.length) diagram.layers = layers;
            while (diagram.layerById("l" + diagram.nextLayer)) diagram.nextLayer++;
        }

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
                layer: diagram.layerById(text(raw.layer, ""))
                    ? raw.layer : diagram.layers[0].id,
                group: text(raw.group, ""),
                x: Math.round(number(raw.x, 0)),
                y: Math.round(number(raw.y, 0)),
                w: Math.max(MIN_SIZE, Math.round(number(raw.w, 140))),
                h: Math.max(MIN_SIZE, Math.round(number(raw.h, 70))),
                text: text(raw.text, ""),
                fill: text(raw.fill, DEFAULT_FILL),
                stroke: text(raw.stroke, DEFAULT_STROKE),
                strokeWidth: Math.max(0.5, number(raw.strokeWidth, 1.5)),
                dash: raw.dash === "dash" || raw.dash === "dot"
                    ? raw.dash : "solid",
                textColor: text(raw.textColor, DEFAULT_TEXT),
                fontSize: Math.max(6, Math.round(number(raw.fontSize, 12))),
                radius: Math.max(0, Math.round(number(raw.radius, 12))),
                textBold: raw.textBold === true,
                textItalic: raw.textItalic === true,
                textAlign: text(raw.textAlign, ""),
                textVAlign: text(raw.textVAlign, ""),
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
                layer: diagram.layerById(text(raw.layer, ""))
                    ? raw.layer : diagram.layers[0].id,
                text: text(raw.text, ""),
                stroke: text(raw.stroke, DEFAULT_EDGE),
                strokeWidth: Math.max(0.5, number(raw.strokeWidth, 2)),
                dash: raw.dash === "dash" || raw.dash === "dot"
                    ? raw.dash : (raw.dashed === true ? "dash" : "solid"),
                dashed: raw.dash === "dash" || raw.dash === "dot" ||
                        raw.dashed === true,
                textColor: text(raw.textColor, ""),
                fontSize: Math.max(6, Math.round(number(raw.fontSize, 11))),
                textBold: raw.textBold === true,
                textItalic: raw.textItalic === true,
            };
            diagram.edges.push(edge);
        }

        /* Ids loaded from a file may be "s12" with one shape in it; the next
         * new one must not collide with what is already there. */
        while (diagram.shapeById("s" + diagram.nextShape)) diagram.nextShape++;
        while (diagram.edgeById("e" + diagram.nextEdge)) diagram.nextEdge++;
        while (diagram.groupExists("g" + diagram.nextGroup)) diagram.nextGroup++;
        return diagram;
    }
}

/*
 * The book: one or more pages, each a `Diagram` with its own layers and
 * shapes. The canvas always edits the active page; the file holds them all.
 * A file from before pages existed is one page and opens the same way.
 */
export class Document {

    constructor() {
        this.pages = [new Diagram()];
        this.names = [Locale.Text("Page {0}", 1)];
        this.active = 0;
    }

    static fromPages(pages, names, active) {
        const document = new Document();
        if (!pages.length) return document;

        document.pages = pages.slice();
        document.names = [];
        for (let i = 0; i < pages.length; i++) {
            const name = names && typeof names[i] === "string"
                ? names[i].trim() : "";
            document.names.push(name || Locale.Text("Page {0}", i + 1));
        }
        document.active = Math.max(0, Math.min(pages.length - 1,
                                               Math.floor(number(active, 0))));
        return document;
    }

    addPage(name) {
        const page = new Diagram();
        let label = typeof name === "string" ? name.trim() : "";
        if (!label) label = Locale.Text("Page {0}", this.pages.length + 1);
        this.pages.push(page);
        this.names.push(label);
        return page;
    }

    removePage(index) {
        if (this.pages.length < 2) return null;
        if (index < 0 || index >= this.pages.length) return null;
        const page = this.pages.splice(index, 1)[0];
        this.names.splice(index, 1);
        if (this.active >= this.pages.length) this.active = this.pages.length - 1;
        else if (this.active > index) this.active--;
        return page;
    }

    movePage(index, delta) {
        const to = index + delta;
        if (index < 0 || index >= this.pages.length ||
            to < 0 || to >= this.pages.length) return false;
        const page = this.pages.splice(index, 1)[0];
        const name = this.names.splice(index, 1)[0];
        this.pages.splice(to, 0, page);
        this.names.splice(to, 0, name);
        if (this.active === index) this.active = to;
        else if (this.active === to) this.active = index;
        return true;
    }

    setPageName(index, name) {
        if (index < 0 || index >= this.pages.length) return;
        const value = typeof name === "string" ? name.trim() : "";
        if (value) this.names[index] = value;
    }

    pageName(index) {
        return this.names[index] || "";
    }

    toJSON() {
        return {
            format: "bintana-draw/1",
            version: 2,
            active: this.active,
            pages: this.pages.map((page, i) => ({
                name: this.names[i],
                ...pageJSON(page),
            })),
        };
    }

    static fromJSON(data) {
        if (!data || data.format !== "bintana-draw/1")
            throw new Error("Not a Bintana Draw diagram");

        if (Array.isArray(data.pages) && data.pages.length) {
            const pages = [];
            const names = [];
            for (const raw of data.pages) {
                if (!raw || typeof raw !== "object") continue;
                pages.push(Diagram.fromJSON({
                    format: data.format,
                    version: data.version,
                    layers: raw.layers,
                    shapes: raw.shapes,
                    edges: raw.edges,
                }));
                names.push(text(raw.name, ""));
            }
            if (!pages.length)
                throw new Error("Not a Bintana Draw diagram");
            return Document.fromPages(pages, names, data.active);
        }

        /* Version 1 and everything written before pages: one flat page. */
        const page = Diagram.fromJSON(data);
        return Document.fromPages([page], [""], 0);
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
