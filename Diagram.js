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
                            "terminator", "data", "cylinder", "note", "text",
                            "triangle", "hexagon", "document", "manualinput",
                            "predefined", "storage", "delay", "onpage",
                            "offpage", "looplimit", "manualop", "image",
                            "vector", "and", "or", "xor", "nand", "nor"];

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

function copyVector(value) {
    if (!value || typeof value !== "object" || !Array.isArray(value.parts))
        return null;
    const parts = [];
    for (const part of value.parts) {
        if (!part || typeof part !== "object") continue;
        const dash = Array.isArray(part.dash)
            ? part.dash.map((n) => number(n, 0)).filter((n) => n > 0) : [];
        parts.push({
            d: text(part.d, ""),
            fill: part.fill === true,
            stroke: part.stroke === true,
            fillColor: text(part.fillColor, ""),
            strokeColor: text(part.strokeColor, ""),
            fillAlpha: number(part.fillAlpha, 1),
            strokeAlpha: number(part.strokeAlpha, 1),
            width: Math.max(0, number(part.width, 0)),
            dash: dash,
            join: text(part.join, ""),
            cap: text(part.cap, ""),
        });
    }
    return {
        w: Math.max(1, number(value.w, 100)),
        h: Math.max(1, number(value.h, 100)),
        parts: parts,
    };
}

function copyShape(s) {
    const shape = {
        id: s.id, kind: s.kind, layer: s.layer, group: s.group,
        x: s.x, y: s.y, w: s.w, h: s.h, rotation: s.rotation,
        text: s.text, fill: s.fill, stroke: s.stroke,
        strokeWidth: s.strokeWidth, dash: s.dash,
        textColor: s.textColor, fontSize: s.fontSize, radius: s.radius,
        textBold: s.textBold, textItalic: s.textItalic,
        textAlign: s.textAlign, textVAlign: s.textVAlign,
        image: s.image || "",
    };
    if (s.vector) shape.vector = copyVector(s.vector);
    return shape;
}

function copyPort(port) {
    return port ? { x: port.x, y: port.y } : null;
}

function readPort(port) {
    if (!port || typeof port !== "object") return null;
    return { x: number(port.x, 0.5), y: number(port.y, 0.5) };
}

function copyWaypoints(points) {
    const out = [];
    for (const point of points || [])
        out.push({ x: point.x, y: point.y });
    return out;
}

function readWaypoints(points) {
    const out = [];
    if (!Array.isArray(points)) return out;
    for (const point of points) {
        if (!point || typeof point !== "object") continue;
        out.push({ x: number(point.x, 0), y: number(point.y, 0) });
    }
    return out;
}

function copyEdge(e) {
    return {
        id: e.id, from: e.from, to: e.to, layer: e.layer, text: e.text,
        fromSide: e.fromSide || "", toSide: e.toSide || "",
        fromPort: copyPort(e.fromPort), toPort: copyPort(e.toPort),
        x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2,
        arrowStart: e.arrowStart === true,
        arrowEnd: e.arrowEnd !== false,
        route: e.route || "orthogonal",
        waypoints: copyWaypoints(e.waypoints),
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
            rotation: number(o.rotation, 0),
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
            image: text(o.image, ""),
            vector: copyVector(o.vector),
        };
        this.shapes.push(shape);
        return shape;
    }

    addEdge(from, to, options) {
        const o = options || {};
        const hasFrom = !!this.shapeById(from);
        const hasTo = !!this.shapeById(to);
        if ((from && !hasFrom) || (to && !hasTo)) return null;
        if (!hasFrom && !hasTo)
            return this.addLine(number(o.x1, 0), number(o.y1, 0),
                                number(o.x2, 0), number(o.y2, 0), o);

        const layer = this.layerById(o.layer) ? o.layer : this.layers[0].id;
        const edge = {
            id: "e" + (this.nextEdge++),
            from: hasFrom ? from : "",
            to: hasTo ? to : "",
            fromSide: hasFrom ? text(o.fromSide, "") : "",
            toSide: hasTo ? text(o.toSide, "") : "",
            fromPort: hasFrom ? readPort(o.fromPort) : null,
            toPort: hasTo ? readPort(o.toPort) : null,
            layer: layer,
            x1: hasFrom ? undefined : number(o.x1, 0),
            y1: hasFrom ? undefined : number(o.y1, 0),
            x2: hasTo ? undefined : number(o.x2, 0),
            y2: hasTo ? undefined : number(o.y2, 0),
            route: o.route === "straight" || o.route === "curved"
                ? o.route : "orthogonal",
            waypoints: copyWaypoints(o.waypoints),
            arrowStart: o.arrowStart === true,
            arrowEnd: o.arrowEnd !== false,
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

    /* A line that belongs to no shape: two world points and an arrowhead at
     * the end, or not, chosen by the tool that drew it. */
    addLine(x1, y1, x2, y2, options) {
        const o = options || {};
        const layer = this.layerById(o.layer) ? o.layer : this.layers[0].id;
        const edge = {
            id: "e" + (this.nextEdge++),
            from: "",
            to: "",
            layer: layer,
            x1: number(x1, 0),
            y1: number(y1, 0),
            x2: number(x2, 0),
            y2: number(y2, 0),
            arrowStart: o.arrowStart === true,
            arrowEnd: o.arrowEnd !== false,
            route: o.route === "straight" || o.route === "curved"
                ? o.route : "orthogonal",
            waypoints: copyWaypoints(o.waypoints),
            text: text(o.text, ""),
            stroke: text(o.stroke, DEFAULT_EDGE),
            strokeWidth: Math.max(0.5, number(o.strokeWidth, 2)),
            dash: o.dash === "dash" || o.dash === "dot" ? o.dash : "solid",
            dashed: o.dash === "dash" || o.dash === "dot",
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
        this.edges = this.edges.filter((e) => {
            if (gone.has(e.id)) return false;
            if (e.from && !remains.has(e.from)) return false;
            if (e.to && !remains.has(e.to)) return false;
            return true;
        });
    }

    bounds() {
        if (!this.shapes.length) return null;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const shape of this.shapes) {
            if (!this.layerVisible(shape)) continue;
            const box = shapeRectBounds(shape);
            x0 = Math.min(x0, box.x);
            y0 = Math.min(y0, box.y);
            x1 = Math.max(x1, box.x + box.w);
            y1 = Math.max(y1, box.y + box.h);
        }
        for (const edge of this.edges) {
            if (!this.layerVisible(edge)) continue;
            const points = edgeRoute(this, edge);
            for (let i = 0; i < points.length; i += 2) {
                x0 = Math.min(x0, points[i]);
                y0 = Math.min(y0, points[i + 1]);
                x1 = Math.max(x1, points[i]);
                y1 = Math.max(y1, points[i + 1]);
            }
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
                rotation: number(raw.rotation, 0),
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
                image: text(raw.image, ""),
                vector: copyVector(raw.vector),
            };
            diagram.shapes.push(shape);
        }

        const edges = Array.isArray(data.edges) ? data.edges : [];
        for (const raw of edges) {
            if (!raw || typeof raw !== "object") continue;

            const rawFrom = text(raw.from, "");
            const rawTo   = text(raw.to, "");
            const from = rawFrom
                ? (renamed.has(rawFrom) ? renamed.get(rawFrom) : rawFrom) : "";
            const to = rawTo
                ? (renamed.has(rawTo) ? renamed.get(rawTo) : rawTo) : "";

            if (rawFrom && !diagram.shapeById(from)) continue;
            if (rawTo && !diagram.shapeById(to)) continue;
            if (from && to && from === to) continue;

            const hasFrom = !!from, hasTo = !!to;
            if (!hasFrom && !hasTo &&
                (raw.x1 === undefined || raw.x2 === undefined)) continue;
            if (hasFrom && !hasTo && raw.x2 === undefined) continue;
            if (!hasFrom && hasTo && raw.x1 === undefined) continue;

            let id = text(raw.id, "");
            if (!id || diagram.edgeById(id)) id = "e" + (diagram.nextEdge++);
            const edge = {
                id: id,
                from: from,
                to: to,
                fromSide: hasFrom ? text(raw.fromSide, "") : "",
                toSide: hasTo ? text(raw.toSide, "") : "",
                fromPort: hasFrom ? readPort(raw.fromPort) : null,
                toPort: hasTo ? readPort(raw.toPort) : null,
                layer: diagram.layerById(text(raw.layer, ""))
                    ? raw.layer : diagram.layers[0].id,
                x1: hasFrom ? undefined : number(raw.x1, 0),
                y1: hasFrom ? undefined : number(raw.y1, 0),
                x2: hasTo ? undefined : number(raw.x2, 0),
                y2: hasTo ? undefined : number(raw.y2, 0),
                arrowStart: raw.arrowStart === true,
                arrowEnd: raw.arrowEnd !== false,
                route: raw.route === "straight" || raw.route === "curved"
                    ? raw.route : "orthogonal",
                waypoints: readWaypoints(raw.waypoints),
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

function rotatePoint(x, y, cx, cy, degrees) {
    if (!degrees) return { x: x, y: y };
    const radians = degrees * Math.PI / 180;
    const cos = Math.cos(radians), sin = Math.sin(radians);
    const dx = x - cx, dy = y - cy;
    return { x: cx + dx * cos - dy * sin,
             y: cy + dx * sin + dy * cos };
}

export function shapeRectBounds(s) {
    if (!s.rotation) return { x: s.x, y: s.y, w: s.w, h: s.h };
    const c = shapeCenter(s);
    const corners = [
        rotatePoint(s.x, s.y, c.x, c.y, s.rotation),
        rotatePoint(s.x + s.w, s.y, c.x, c.y, s.rotation),
        rotatePoint(s.x + s.w, s.y + s.h, c.x, c.y, s.rotation),
        rotatePoint(s.x, s.y + s.h, c.x, c.y, s.rotation),
    ];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of corners) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function pointInShape(s, x, y) {
    if (s.rotation) {
        const c = shapeCenter(s);
        const p = rotatePoint(x, y, c.x, c.y, -s.rotation);
        x = p.x;
        y = p.y;
    }
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
    let point;
    switch (side) {
    case "left":   point = { x: s.x,           y: s.y + s.h / 2 }; break;
    case "right":  point = { x: s.x + s.w,     y: s.y + s.h / 2 }; break;
    case "top":    point = { x: s.x + s.w / 2, y: s.y }; break;
    default:       point = { x: s.x + s.w / 2, y: s.y + s.h }; break;
    }
    if (!s.rotation) return point;
    const c = shapeCenter(s);
    return rotatePoint(point.x, point.y, c.x, c.y, s.rotation);
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
    const sides = ["left", "right", "top", "bottom"];
    let best = null;
    for (const sa of sides) {
        const pa = sideAnchor(a, sa);
        for (const sb of sides) {
            const pb = sideAnchor(b, sb);
            const dx = pa.x - pb.x, dy = pa.y - pb.y;
            const distance = dx * dx + dy * dy;
            if (!best || distance < best.distance)
                best = { from: sa, to: sb, distance: distance };
        }
    }
    return [best.from, best.to];
}

export function sideFacing(shape, point) {
    const left = Math.abs(point.x - shape.x);
    const right = Math.abs(point.x - (shape.x + shape.w));
    const top = Math.abs(point.y - shape.y);
    const bottom = Math.abs(point.y - (shape.y + shape.h));
    const least = Math.min(left, right, top, bottom);
    if (least === left) return "left";
    if (least === right) return "right";
    if (least === top) return "top";
    return "bottom";
}

export function gateBubble(shape) {
    return (shape.kind === "nand" || shape.kind === "nor")
        ? Math.min(10, shape.h * 0.14) : 0;
}

export function andGateLayout(shape) {
    const bubble = gateBubble(shape);
    const inset = bubble * 2;
    const right = shape.x + shape.w - inset;
    const r = Math.min(shape.h / 2, (right - shape.x) * 0.55);
    return {
        bubble: bubble, inset: inset, right: right, r: r,
        cx: right - r,
        cy: shape.y + shape.h / 2,
        ry: shape.h / 2,
    };
}

function rectangleOutline(shape) {
    return [
        { x: shape.x, y: shape.y },
        { x: shape.x + shape.w, y: shape.y },
        { x: shape.x + shape.w, y: shape.y + shape.h },
        { x: shape.x, y: shape.y + shape.h },
    ];
}

function ellipseOutline(shape) {
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    const rx = shape.w / 2, ry = shape.h / 2;
    const points = [];
    for (let i = 0; i < 48; i++) {
        const a = i * Math.PI * 2 / 48;
        points.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return points;
}

function roundedOutline(shape, radius) {
    const r = Math.max(0, Math.min(radius, shape.w / 2, shape.h / 2));
    if (r === 0) return rectangleOutline(shape);
    const points = [];
    const arc = (cx, cy, from, to) => {
        for (let i = 0; i <= 8; i++) {
            const a = (from + (to - from) * i / 8) * Math.PI / 180;
            points.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        }
    };
    points.push({ x: shape.x + r, y: shape.y });
    points.push({ x: shape.x + shape.w - r, y: shape.y });
    arc(shape.x + shape.w - r, shape.y + r, -90, 0);
    points.push({ x: shape.x + shape.w, y: shape.y + shape.h - r });
    arc(shape.x + shape.w - r, shape.y + shape.h - r, 0, 90);
    points.push({ x: shape.x + r, y: shape.y + shape.h });
    arc(shape.x + r, shape.y + shape.h - r, 90, 180);
    points.push({ x: shape.x, y: shape.y + r });
    arc(shape.x + r, shape.y + r, 180, 270);
    return points;
}

function appendCubic(points, p0, c1, c2, p1, steps) {
    for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        points.push({
            x: u * u * u * p0.x + 3 * u * u * t * c1.x +
               3 * u * t * t * c2.x + t * t * t * p1.x,
            y: u * u * u * p0.y + 3 * u * u * t * c1.y +
               3 * u * t * t * c2.y + t * t * t * p1.y,
        });
    }
}

function andGateOutline(shape) {
    const g = andGateLayout(shape);
    const points = [{ x: shape.x, y: shape.y },
                    { x: g.cx, y: shape.y }];
    for (let i = 1; i <= 12; i++) {
        const a = -Math.PI / 2 + Math.PI * i / 12;
        points.push({ x: g.cx + g.r * Math.cos(a),
                      y: g.cy + g.ry * Math.sin(a) });
    }
    points.push({ x: shape.x, y: shape.y + shape.h });
    return points;
}

function orGateOutline(shape) {
    const bubble = gateBubble(shape);
    const w = shape.w - bubble * 2;
    const x = shape.x, y = shape.y;
    const right = x + w;
    const cy = y + shape.h / 2;
    const top = x + w * 0.35;
    const left = x + w * 0.12;
    const p0 = { x: top, y: y };
    const p1 = { x: right, y: cy };
    const p2 = { x: top, y: y + shape.h };
    const p3 = { x: left, y: y + shape.h };
    const p4 = { x: left, y: y };
    const points = [{ x: p0.x, y: p0.y }];
    appendCubic(points, p0,
        { x: x + w * 0.62, y: y + shape.h * 0.1 },
        { x: right - w * 0.1, y: y + shape.h * 0.35 }, p1, 12);
    appendCubic(points, p1,
        { x: right - w * 0.1, y: y + shape.h * 0.65 },
        { x: x + w * 0.62, y: y + shape.h * 0.9 }, p2, 12);
    points.push({ x: p3.x, y: p3.y });
    appendCubic(points, p3,
        { x: x + w * 0.32, y: y + shape.h * 0.7 },
        { x: x + w * 0.32, y: y + shape.h * 0.3 }, p4, 12);
    return points;
}

function delayOutline(shape) {
    const r = Math.min(shape.h / 2, shape.w * 0.5);
    const right = shape.x + shape.w - r;
    const cy = shape.y + shape.h / 2;
    const points = [{ x: shape.x, y: shape.y },
                    { x: right, y: shape.y }];
    for (let i = 1; i <= 12; i++) {
        const a = -Math.PI / 2 + Math.PI * i / 12;
        points.push({ x: right + r * Math.cos(a),
                      y: cy + r * Math.sin(a) });
    }
    points.push({ x: shape.x, y: shape.y + shape.h });
    return points;
}

function shapeOutlinePoints(shape) {
    switch (shape.kind) {
    case "ellipse":
    case "onpage":   return ellipseOutline(shape);
    case "round":    return roundedOutline(shape, shape.radius);
    case "terminator": return roundedOutline(shape, shape.h / 2);
    case "diamond":
        return [{ x: shape.x + shape.w / 2, y: shape.y },
                { x: shape.x + shape.w, y: shape.y + shape.h / 2 },
                { x: shape.x + shape.w / 2, y: shape.y + shape.h },
                { x: shape.x, y: shape.y + shape.h / 2 }];
    case "data":
        return [{ x: shape.x + shape.w * 0.18, y: shape.y },
                { x: shape.x + shape.w, y: shape.y },
                { x: shape.x + shape.w * 0.82, y: shape.y + shape.h },
                { x: shape.x, y: shape.y + shape.h }];
    case "note": {
        const fold = Math.min(24, shape.w * 0.22, shape.h * 0.32);
        return [{ x: shape.x, y: shape.y },
                { x: shape.x + shape.w - fold, y: shape.y },
                { x: shape.x + shape.w, y: shape.y + fold },
                { x: shape.x + shape.w, y: shape.y + shape.h },
                { x: shape.x, y: shape.y + shape.h }];
    }
    case "triangle":
        return [{ x: shape.x + shape.w / 2, y: shape.y },
                { x: shape.x + shape.w, y: shape.y + shape.h },
                { x: shape.x, y: shape.y + shape.h }];
    case "hexagon":
        return [{ x: shape.x + shape.w * 0.22, y: shape.y },
                { x: shape.x + shape.w * 0.78, y: shape.y },
                { x: shape.x + shape.w, y: shape.y + shape.h / 2 },
                { x: shape.x + shape.w * 0.78, y: shape.y + shape.h },
                { x: shape.x + shape.w * 0.22, y: shape.y + shape.h },
                { x: shape.x, y: shape.y + shape.h / 2 }];
    case "manualinput":
        return [{ x: shape.x, y: shape.y + shape.h * 0.22 },
                { x: shape.x + shape.w, y: shape.y },
                { x: shape.x + shape.w, y: shape.y + shape.h },
                { x: shape.x, y: shape.y + shape.h }];
    case "offpage":
        return [{ x: shape.x, y: shape.y },
                { x: shape.x + shape.w, y: shape.y },
                { x: shape.x + shape.w, y: shape.y + shape.h * 0.72 },
                { x: shape.x + shape.w / 2, y: shape.y + shape.h },
                { x: shape.x, y: shape.y + shape.h * 0.72 }];
    case "looplimit": {
        const cut = Math.min(20, shape.w * 0.18, shape.h * 0.25);
        return [{ x: shape.x + cut, y: shape.y },
                { x: shape.x + shape.w - cut, y: shape.y },
                { x: shape.x + shape.w, y: shape.y + cut },
                { x: shape.x + shape.w, y: shape.y + shape.h },
                { x: shape.x, y: shape.y + shape.h },
                { x: shape.x, y: shape.y + cut }];
    }
    case "manualop":
        return [{ x: shape.x, y: shape.y },
                { x: shape.x + shape.w, y: shape.y },
                { x: shape.x + shape.w * 0.8, y: shape.y + shape.h },
                { x: shape.x + shape.w * 0.2, y: shape.y + shape.h }];
    case "delay":    return delayOutline(shape);
    case "and":
    case "nand":     return andGateOutline(shape);
    case "or":
    case "nor":
    case "xor":      return orGateOutline(shape);
    default:         return rectangleOutline(shape);
    }
}

/* The nearest point on the outline, not on the rectangle around it. Segment
 * projection is enough for every shape here, and unlike the ray from the
 * centre it still has an answer when the pointer is exactly in the middle. */
function perimeterPoint(shape, x, y) {
    const points = shapeOutlinePoints(shape);
    let best = null, bestDistance = Infinity;
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const ex = b.x - a.x, ey = b.y - a.y;
        const length2 = ex * ex + ey * ey;
        const u = length2
            ? Math.max(0, Math.min(1,
                ((x - a.x) * ex + (y - a.y) * ey) / length2))
            : 0;
        const px = a.x + ex * u, py = a.y + ey * u;
        const dx = px - x, dy = py - y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = { x: px, y: py };
        }
    }
    return best || shapeCenter(shape);
}

export function shapePortPoint(shape, port) {
    let x = shape.x + port.x * shape.w;
    let y = shape.y + port.y * shape.h;
    const p = perimeterPoint(shape, x, y);
    x = p.x; y = p.y;

    if (shape.rotation) {
        const c = shapeCenter(shape);
        const rotated = rotatePoint(x, y, c.x, c.y, shape.rotation);
        x = rotated.x; y = rotated.y;
    }
    return { x: x, y: y };
}

const PORT_LIST = [
    { x: 0.5, y: 0,   side: "top" },
    { x: 1,   y: 0.5, side: "right" },
    { x: 0.5, y: 1,   side: "bottom" },
    { x: 0,   y: 0.5, side: "left" },
    { x: 0,   y: 0,   side: "" },
    { x: 1,   y: 0,   side: "" },
    { x: 1,   y: 1,   side: "" },
    { x: 0,   y: 1,   side: "" },
];

function cornerSide(shape, point) {
    const c = shapeCenter(shape);
    const dx = point.x - c.x, dy = point.y - c.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
    return dy >= 0 ? "bottom" : "top";
}

function andGatePorts(shape) {
    const g = andGateLayout(shape);
    const list = [];
    const add = (x, y, side) => list.push({
        port: { x: (x - shape.x) / shape.w, y: (y - shape.y) / shape.h },
        side: side,
    });
    add(shape.x, g.cy, "left");
    add(shape.x + (g.cx - shape.x) / 2, shape.y, "top");
    add(shape.x + (g.cx - shape.x) / 2, shape.y + shape.h, "bottom");
    add(g.cx, shape.y, "top");
    add(g.cx + g.r * 0.7071, g.cy - g.ry * 0.7071, "right");
    add(g.right, g.cy, "right");
    add(g.cx + g.r * 0.7071, g.cy + g.ry * 0.7071, "right");
    add(g.cx, shape.y + shape.h, "bottom");
    return list.map((item) => ({
        port: item.port,
        side: item.side,
        point: shapePortPoint(shape, item.port),
    }));
}

export function shapePorts(shape) {
    if (shape.kind === "and" || shape.kind === "nand")
        return andGatePorts(shape);
    return PORT_LIST.map((item) => ({
        port: { x: item.x, y: item.y },
        side: item.side,
        point: shapePortPoint(shape, item),
    }));
}

export function nearestPort(shape, point) {
    const c = shapeCenter(shape);
    let target = point;
    if (shape.rotation)
        target = rotatePoint(point.x, point.y, c.x, c.y, -shape.rotation);

    const at = perimeterPoint(shape, target.x, target.y);
    const world = shape.rotation
        ? rotatePoint(at.x, at.y, c.x, c.y, shape.rotation) : at;
    const dx = world.x - c.x, dy = world.y - c.y;
    const side = Math.abs(dx) >= Math.abs(dy)
        ? (dx >= 0 ? "right" : "left")
        : (dy >= 0 ? "bottom" : "top");

    return {
        port: { x: (at.x - shape.x) / shape.w,
                y: (at.y - shape.y) / shape.h },
        side: side,
        point: world,
        distance: (world.x - point.x) * (world.x - point.x) +
                  (world.y - point.y) * (world.y - point.y),
    };
}

function otherEndpoint(diagram, edge, end) {
    if (end === "start") {
        if (edge.to) {
            const shape = diagram.shapeById(edge.to);
            if (shape) return shapeCenter(shape);
        }
        if (edge.x2 !== undefined) return { x: edge.x2, y: edge.y2 };
    } else {
        if (edge.from) {
            const shape = diagram.shapeById(edge.from);
            if (shape) return shapeCenter(shape);
        }
        if (edge.x1 !== undefined) return { x: edge.x1, y: edge.y1 };
    }
    return { x: 0, y: 0 };
}

function portSide(shape, port, other) {
    if (port.x === 0 && port.y > 0 && port.y < 1) return "left";
    if (port.x === 1 && port.y > 0 && port.y < 1) return "right";
    if (port.y === 0 && port.x > 0 && port.x < 1) return "top";
    if (port.y === 1 && port.x > 0 && port.x < 1) return "bottom";
    return cornerSide(shape, other);
}

function endSide(diagram, edge, end) {
    if (end === "start" && edge.fromSide) return edge.fromSide;
    if (end === "end" && edge.toSide) return edge.toSide;

    const a = diagram.shapeById(edge.from);
    const b = diagram.shapeById(edge.to);
    const shape = end === "start" ? a : b;
    const port = end === "start" ? edge.fromPort : edge.toPort;
    if (shape && port)
        return portSide(shape, port, otherEndpoint(diagram, edge, end));

    if (a && b) return chooseSides(a, b)[end === "start" ? 0 : 1];

    if (end === "start" && a) {
        if (edge.fromSide) return edge.fromSide;
        return sideFacing(a, { x: edge.x2, y: edge.y2 });
    }
    if (end === "end" && b) {
        if (edge.toSide) return edge.toSide;
        return sideFacing(b, { x: edge.x1, y: edge.y1 });
    }
    return "";
}

export function edgeEndpoint(diagram, edge, end) {
    if (end === "start") {
        if (edge.from) {
            const shape = diagram.shapeById(edge.from);
            if (!shape) return null;
            if (edge.fromPort) return shapePortPoint(shape, edge.fromPort);
            return sideAnchor(shape, endSide(diagram, edge, "start"));
        }
        return { x: edge.x1, y: edge.y1 };
    }
    if (edge.to) {
        const shape = diagram.shapeById(edge.to);
        if (!shape) return null;
        if (edge.toPort) return shapePortPoint(shape, edge.toPort);
        return sideAnchor(shape, endSide(diagram, edge, "end"));
    }
    return { x: edge.x2, y: edge.y2 };
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
function controlPoints(diagram, edge) {
    const start = edgeEndpoint(diagram, edge, "start");
    const end = edgeEndpoint(diagram, edge, "end");
    if (!start || !end) return [];

    const points = [start];
    for (const point of edge.waypoints || [])
        points.push({ x: point.x, y: point.y });
    points.push(end);

    const flat = [];
    for (const point of points) flat.push(point.x, point.y);
    return flat;
}

export function edgeControlPoints(diagram, edge) {
    return controlPoints(diagram, edge);
}

/* Catmull-Rom through the control points, sampled into a polyline: the
 * painter, the hit test and the arrow all keep working on one shape of data. */
function smoothPath(flat) {
    if (flat.length < 4) return flat;
    if (flat.length === 4) {
        const x1 = flat[0], y1 = flat[1], x2 = flat[2], y2 = flat[3];
        const dx = x2 - x1, dy = y2 - y1;
        const length = Math.hypot(dx, dy) || 1;
        const bow = length * 0.18;
        flat = [x1, y1,
                (x1 + x2) / 2 - dy / length * bow,
                (y1 + y2) / 2 + dx / length * bow,
                x2, y2];
    }
    const points = [];
    for (let i = 0; i < flat.length; i += 2)
        points.push({ x: flat[i], y: flat[i + 1] });

    const out = [points[0].x, points[0].y];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] || points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] || p2;
        for (let step = 1; step <= 10; step++) {
            const t = step / 10;
            const t2 = t * t, t3 = t2 * t;
            const x = 0.5 * ((2 * p1.x) +
                (-p0.x + p2.x) * t +
                (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
                (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
            const y = 0.5 * ((2 * p1.y) +
                (-p0.y + p2.y) * t +
                (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
            out.push(x, y);
        }
    }
    return out;
}

export function edgeRoute(diagram, edge) {
    const route = edge.route || "orthogonal";
    const hasWaypoints = edge.waypoints && edge.waypoints.length > 0;
    const a = diagram.shapeById(edge.from);
    const b = diagram.shapeById(edge.to);
    const hasFrom = !!a, hasTo = !!b;

    /* The automatic orthogonal route is only for two shapes with no bends. */
    if (hasFrom && hasTo && route === "orthogonal" && !hasWaypoints) {
        const auto = chooseSides(a, b);
        const outSide = edge.fromSide || endSide(diagram, edge, "start") || auto[0];
        const inSide = edge.toSide || endSide(diagram, edge, "end") || auto[1];
        /* An explicit port wins over the side's midpoint: the arrow has to
         * start on the point the person chose, not on the bounding box. */
        const p0 = edge.fromPort
            ? edgeEndpoint(diagram, edge, "start") : sideAnchor(a, outSide);
        const p1 = edge.toPort
            ? edgeEndpoint(diagram, edge, "end") : sideAnchor(b, inSide);
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

    /* One end on a shape and the other loose: a stub out of the shape, then
     * one right angle to the loose point. */
    if (hasFrom !== hasTo) {
        if (route === "curved") return smoothPath(controlPoints(diagram, edge));
        if (route === "straight" || hasWaypoints)
            return controlPoints(diagram, edge);

        const fromAnchor = hasFrom
            ? edgeEndpoint(diagram, edge, "start")
            : edgeEndpoint(diagram, edge, "end");
        const free = hasFrom
            ? { x: edge.x2, y: edge.y2 }
            : { x: edge.x1, y: edge.y1 };
        const side = hasFrom
            ? endSide(diagram, edge, "start")
            : endSide(diagram, edge, "end");
        const v = sideVector(side);
        const stub = { x: fromAnchor.x + v.x * STUB,
                       y: fromAnchor.y + v.y * STUB };
        const horizontal = side === "left" || side === "right";
        const corner = horizontal
            ? { x: stub.x, y: free.y }
            : { x: free.x, y: stub.y };

        if (hasFrom) {
            return [fromAnchor.x, fromAnchor.y, stub.x, stub.y,
                    corner.x, corner.y, free.x, free.y];
        }
        return [free.x, free.y, corner.x, corner.y,
                stub.x, stub.y, fromAnchor.x, fromAnchor.y];
    }

    const control = controlPoints(diagram, edge);
    if (route === "curved") return smoothPath(control);
    return control;
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
