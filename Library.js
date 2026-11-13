/*
 * A shape library: named stamps made of shapes, groups and connectors. It is
 * the format a person saves a selection into, and the one an imported draw.io
 * stencil or stencil set becomes.
 *
 * An item is normalized: its top-left corner is 0,0 and its own edges still
 * name the item's shapes. Inserting it creates fresh ids, remaps groups and
 * puts every shape on the active layer.
 */
"use strict";

function shapeCopy(s) {
    return {
        id: s.id, kind: s.kind, group: s.group || "",
        x: s.x, y: s.y, w: s.w, h: s.h, rotation: s.rotation || 0,
        text: s.text || "", fill: s.fill, stroke: s.stroke,
        strokeWidth: s.strokeWidth, dash: s.dash,
        textColor: s.textColor, fontSize: s.fontSize, radius: s.radius,
        textBold: s.textBold === true, textItalic: s.textItalic === true,
        textAlign: s.textAlign || "", textVAlign: s.textVAlign || "",
        image: s.image || "", vector: s.vector || null,
    };
}

function edgeCopy(e) {
    return {
        id: e.id, from: e.from, to: e.to,
        fromSide: e.fromSide || "", toSide: e.toSide || "",
        fromPort: e.fromPort ? { x: e.fromPort.x, y: e.fromPort.y } : null,
        toPort: e.toPort ? { x: e.toPort.x, y: e.toPort.y } : null,
        x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2,
        arrowStart: e.arrowStart === true, arrowEnd: e.arrowEnd !== false,
        route: e.route || "orthogonal",
        waypoints: (e.waypoints || []).map((p) => ({ x: p.x, y: p.y })),
        text: e.text || "", stroke: e.stroke, strokeWidth: e.strokeWidth,
        dash: e.dash, dashed: e.dashed, textColor: e.textColor,
        fontSize: e.fontSize, textBold: e.textBold === true,
        textItalic: e.textItalic === true,
    };
}

function normalize(shapes, edges) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of shapes) {
        x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y);
        x1 = Math.max(x1, s.x + s.w); y1 = Math.max(y1, s.y + s.h);
    }
    for (const e of edges) {
        if (e.x1 !== undefined) {
            x0 = Math.min(x0, e.x1); y0 = Math.min(y0, e.y1);
            x1 = Math.max(x1, e.x1); y1 = Math.max(y1, e.y1);
        }
        if (e.x2 !== undefined) {
            x0 = Math.min(x0, e.x2); y0 = Math.min(y0, e.y2);
            x1 = Math.max(x1, e.x2); y1 = Math.max(y1, e.y2);
        }
        for (const p of e.waypoints || []) {
            x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
            x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
        }
    }
    if (x0 === Infinity) return { shapes: shapes, edges: edges, w: 0, h: 0 };

    for (const s of shapes) { s.x -= x0; s.y -= y0; }
    for (const e of edges) {
        if (e.x1 !== undefined) { e.x1 -= x0; e.y1 -= y0; }
        if (e.x2 !== undefined) { e.x2 -= x0; e.y2 -= y0; }
        for (const p of e.waypoints || []) { p.x -= x0; p.y -= y0; }
    }
    return { shapes: shapes, edges: edges,
             w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

function nameFor(shapes) {
    for (const s of shapes) {
        const label = (s.text || "").trim();
        if (label) return label.length > 40 ? label.slice(0, 40) : label;
    }
    return shapes.length ? shapes[0].kind : Locale.Text("Empty");
}

export class ShapeLibrary {

    constructor() {
        this.items = [];
    }

    static fromJSON(data) {
        if (!data || data.format !== "bintana-draw-library/1")
            throw new Error(Locale.Text("Not a Bintana Draw library."));
        const library = new ShapeLibrary();
        for (const raw of data.items || []) {
            if (!raw || !Array.isArray(raw.shapes) ||
                (!raw.shapes.length && !(raw.edges || []).length))
                continue;
            library.items.push({
                name: typeof raw.name === "string" && raw.name.trim()
                    ? raw.name : Locale.Text("Item"),
                w: Math.max(1, Number(raw.w) || 1),
                h: Math.max(1, Number(raw.h) || 1),
                shapes: raw.shapes.map(shapeCopy),
                edges: (raw.edges || []).map(edgeCopy),
            });
        }
        return library;
    }

    toJSON() {
        return {
            format: "bintana-draw-library/1",
            version: 1,
            items: this.items.map((item) => ({
                name: item.name, w: item.w, h: item.h,
                shapes: item.shapes.map(shapeCopy),
                edges: item.edges.map(edgeCopy),
            })),
        };
    }

    addSelection(data) {
        if (!data || (!data.shapes.length && !data.edges.length)) return null;
        const shapes = data.shapes.map(shapeCopy);
        const edges = data.edges.map(edgeCopy);
        const item = normalize(shapes, edges);
        const saved = {
            name: shapes.length ? nameFor(shapes) : Locale.Text("Line"),
            w: item.w, h: item.h,
            shapes: item.shapes, edges: item.edges,
        };
        this.items.push(saved);
        return saved;
    }

    itemsFromDiagram(diagram) {
        const byId = new Map();
        for (const shape of diagram.shapes) byId.set(shape.id, shape);

        const items = [];
        const visited = new Set();
        const addItem = (members) => {
            const ids = new Set(members.map((s) => s.id));
            const edges = diagram.edges.filter((e) => {
                if (e.from && e.to)
                    return ids.has(e.from) && ids.has(e.to);
                if (e.from) return ids.has(e.from);
                if (e.to) return ids.has(e.to);
                return false;
            });
            const shapes = members.map(shapeCopy);
            const copiedEdges = edges.map(edgeCopy);
            const item = normalize(shapes, copiedEdges);
            items.push({
                name: nameFor(shapes), w: item.w, h: item.h,
                shapes: item.shapes, edges: item.edges,
            });
        };

        /* An explicit group is one item, whether or not its shapes touch. */
        const groups = new Map();
        for (const shape of diagram.shapes) {
            if (!shape.group) continue;
            if (!groups.has(shape.group)) groups.set(shape.group, []);
            groups.get(shape.group).push(shape);
        }
        for (const members of groups.values()) {
            for (const shape of members) visited.add(shape.id);
            addItem(members);
        }

        /* Ungrouped shapes follow the edges that reach them, so a drawing's
         * little connected pieces travel together. */
        for (const shape of diagram.shapes) {
            if (visited.has(shape.id) || shape.group) continue;
            const members = [];
            const queue = [shape];
            visited.add(shape.id);
            while (queue.length) {
                const current = queue.shift();
                members.push(current);
                for (const edge of diagram.edges) {
                    if (!edge.from || !edge.to) continue;
                    let next = null;
                    if (edge.from === current.id) next = byId.get(edge.to);
                    else if (edge.to === current.id) next = byId.get(edge.from);
                    if (!next || visited.has(next.id) || next.group) continue;
                    visited.add(next.id);
                    queue.push(next);
                }
            }
            addItem(members);
        }

        for (const edge of diagram.edges) {
            if (edge.from || edge.to) continue;
            const copied = edgeCopy(edge);
            const item = normalize([], [copied]);
            items.push({
                name: Locale.Text("Line"), w: item.w, h: item.h,
                shapes: [], edges: item.edges,
            });
        }
        return items;
    }

    addItems(items) {
        for (const item of items)
            if (item && (item.shapes.length || item.edges.length))
                this.items.push(item);
    }

    insert(diagram, index, x, y, layer) {
        const item = this.items[index];
        if (!item) return [];
        const offsetX = x - item.w / 2;
        const offsetY = y - item.h / 2;
        const names = new Map();
        const groups = new Map();
        const ids = [];

        for (const raw of item.shapes) {
            let group = "";
            if (raw.group) {
                if (!groups.has(raw.group)) groups.set(raw.group, diagram.newGroup());
                group = groups.get(raw.group);
            }
            const shape = diagram.addShape(
                raw.kind, raw.x + offsetX, raw.y + offsetY, raw.w, raw.h, {
                    text: raw.text, fill: raw.fill, stroke: raw.stroke,
                    strokeWidth: raw.strokeWidth, dash: raw.dash,
                    textColor: raw.textColor, fontSize: raw.fontSize,
                    radius: raw.radius, textBold: raw.textBold,
                    textItalic: raw.textItalic, textAlign: raw.textAlign,
                    textVAlign: raw.textVAlign, rotation: raw.rotation,
                    image: raw.image, vector: raw.vector,
                    group: group, layer: layer,
                });
            names.set(raw.id, shape.id);
            ids.push(shape.id);
        }

        for (const raw of item.edges) {
            const from = raw.from ? names.get(raw.from) : "";
            const to = raw.to ? names.get(raw.to) : "";
            if (raw.from && !from) continue;
            if (raw.to && !to) continue;

            const waypoints = (raw.waypoints || []).map((p) => ({
                x: p.x + offsetX, y: p.y + offsetY,
            }));
            const options = {
                text: raw.text, stroke: raw.stroke,
                strokeWidth: raw.strokeWidth, dash: raw.dash,
                dashed: raw.dashed, route: raw.route,
                waypoints: waypoints, fromSide: raw.fromSide,
                toSide: raw.toSide, fromPort: raw.fromPort,
                toPort: raw.toPort, arrowStart: raw.arrowStart,
                arrowEnd: raw.arrowEnd, textColor: raw.textColor,
                fontSize: raw.fontSize, textBold: raw.textBold,
                textItalic: raw.textItalic, layer: layer,
            };

            let edge;
            if (!from && !to) {
                edge = diagram.addLine((raw.x1 || 0) + offsetX,
                                       (raw.y1 || 0) + offsetY,
                                       (raw.x2 || 0) + offsetX,
                                       (raw.y2 || 0) + offsetY, options);
            } else {
                options.x1 = from ? undefined : (raw.x1 || 0) + offsetX;
                options.y1 = from ? undefined : (raw.y1 || 0) + offsetY;
                options.x2 = to ? undefined : (raw.x2 || 0) + offsetX;
                options.y2 = to ? undefined : (raw.y2 || 0) + offsetY;
                edge = diagram.addEdge(from, to, options);
            }
            if (edge) ids.push(edge.id);
        }
        return ids;
    }
}

/* --------------------------------------------------------------- importing */

function entriesFromStencil(root) {
    const items = [];
    const json = JSON.parse(root.Text || "[]");
    for (const entry of json) {
        const title = entry.title || "";
        let xml = entry.xml || "";
        if (!xml) continue;
        if (xml.indexOf("%3C") === 0 || xml.indexOf("%3c") === 0)
            xml = decodeURIComponent(xml);
        if (xml.charAt(0) !== "<")
            throw new Error(Locale.Text("This stencil is compressed. Export it as uncompressed XML and import that."));
        const document = Xml.Parse(xml);
        if (document.Root && (document.Root.Name === "shape" ||
                              document.Root.Name === "shapes")) {
            for (const item of stencilItems(document.Root)) {
                if (title) item.name = title;
                items.push(item);
            }
            continue;
        }

        const imported = DrawioImport.parse(xml);
        for (const page of imported.diagrams) {
            const library = new ShapeLibrary();
            for (const item of library.itemsFromDiagram(page)) {
                if (title) item.name = title;
                items.push(item);
            }
        }
    }
    return items;
}

export function importLibrary(path) {
    const extension = File.Extension(path).toLowerCase();

    if (extension === "btlib") {
        const library = ShapeLibrary.fromJSON(File.LoadJson(path));
        return library.items;
    }

    if (extension === "draw") {
        const book = Document.fromJSON(File.LoadJson(path));
        const library = new ShapeLibrary();
        let items = [];
        for (const page of book.pages)
            items = items.concat(library.itemsFromDiagram(page));
        return items;
    }

    if (extension === "drawio" || extension === "xml" ||
        extension === "mxlibrary") {
        const text = File.Load(path);
        const document = Xml.Parse(text);
        if (document.Root && document.Root.Name === "mxlibrary")
            return entriesFromStencil(document.Root);
        if (document.Root && (document.Root.Name === "shape" ||
                              document.Root.Name === "shapes"))
            return stencilItems(document.Root);

        const imported = DrawioImport.parse(text);
        const library = new ShapeLibrary();
        let items = [];
        for (const page of imported.diagrams)
            items = items.concat(library.itemsFromDiagram(page));
        return items;
    }

    throw new Error(Locale.Text("Unknown library format."));
}
