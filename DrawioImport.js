/*
 * Opening a draw.io file.
 *
 * draw.io is XML: an `mxGraphModel` with `mxCell`s, each vertex carrying an
 * `mxGeometry` and a style string of `key=value;` pairs. This file maps the
 * useful half of that onto a `Diagram`: top-level and grouped vertices become
 * our shapes, edges become our connectors, and the label loses its HTML.
 *
 * **The compressed form is not read.** draw.io normally writes the page as raw
 * deflate + base64, which this runtime has no verb for; rather than fail with
 * a parser error, the diagram is refused with the sentence that says how to
 * export it uncompressed. The uncompressed form is the one draw.io calls
 * "XML" (`File > Export as > XML`) and it is also what `Extras > Edit Diagram`
 * shows.
 */
"use strict";

function attrNumber(node, name, fallback) {
    const value = node.Attr(name);
    if (value === null || value === "") return fallback;
    const n = parseFloat(value);
    return (n === n && n !== Infinity && n !== -Infinity) ? n : fallback;
}

function styleMap(style) {
    const map = {};
    if (!style) return map;
    for (const part of style.split(";")) {
        if (!part) continue;
        const at = part.indexOf("=");
        if (at < 0) map[part] = "1";
        else map[part.slice(0, at)] = part.slice(at + 1);
    }
    return map;
}

/* Labels are HTML more often than not (`html=1` is draw.io's default). */
function cleanText(value) {
    if (!value) return "";
    let text = String(value);
    text = text.replace(/<br\s*\/?>/gi, "\n");
    text = text.replace(/<\/div\s*>/gi, "\n");
    text = text.replace(/<[^>]*>/g, "");
    text = text.replace(/&nbsp;/gi, " ");
    text = text.replace(/&amp;/gi, "&");
    text = text.replace(/&lt;/gi, "<");
    text = text.replace(/&gt;/gi, ">");
    text = text.replace(/&quot;/gi, "\"");
    text = text.replace(/&#39;/gi, "'");
    return text.replace(/\r/g, "").trim();
}

function colour(map, key, fallback) {
    const value = map[key];
    if (value === undefined || value === "") return fallback;
    if (value === "none") return "rgba(0,0,0,0)";
    if (value === "default") return fallback;
    return value;
}

function shapeKind(map, style) {
    const shape = map.shape || "";

    if (map.text === "1" || shape === "text" ||
        (style && style.indexOf("text;") === 0)) return "text";
    if (shape.indexOf("note") >= 0) return "note";
    if (shape.indexOf("cylinder") >= 0 || shape.indexOf("database") >= 0 ||
        shape.indexOf("datastore") >= 0) return "cylinder";
    if (shape.indexOf("parallelogram") >= 0 || shape.indexOf("data") >= 0)
        return "data";
    if (shape.indexOf("terminator") >= 0) return "terminator";
    if (shape.indexOf("ellipse") >= 0 || map.ellipse === "1") return "ellipse";
    if (shape.indexOf("rhombus") >= 0 || shape.indexOf("decision") >= 0 ||
        map.rhombus === "1") return "diamond";
    if (map.rounded === "1") return "round";
    return "rect";
}

/* A child's geometry is relative to its parent; a group is just a cell with
 * children. Sum the offsets up to the layer, which has no geometry. */
function absoluteRect(cell, byId) {
    const geometry = cell.node.Find("mxGeometry");
    if (!geometry) return null;

    let x = attrNumber(geometry, "x", 0);
    let y = attrNumber(geometry, "y", 0);
    const w = attrNumber(geometry, "width", 120);
    const h = attrNumber(geometry, "height", 60);

    const seen = new Set();
    let parent = cell.parent;
    while (parent && parent !== "0" && parent !== "1" && byId.has(parent) &&
           !seen.has(parent)) {
        seen.add(parent);
        const up = byId.get(parent);
        const upGeometry = up.node.Find("mxGeometry");
        if (upGeometry) {
            x += attrNumber(upGeometry, "x", 0);
            y += attrNumber(upGeometry, "y", 0);
        }
        parent = up.parent;
    }

    return {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.max(16, Math.round(w)),
        h: Math.max(16, Math.round(h)),
    };
}

/* The layer is the cell directly under the root (id "0") on the way up. */
function layerOf(cell, byId) {
    let id = cell.parent;
    let layer = "";
    const seen = new Set();
    while (id && id !== "0" && !seen.has(id)) {
        seen.add(id);
        const up = byId.get(id);
        if (!up) break;
        layer = id;
        id = up.parent;
    }
    return layer;
}

function importModel(model) {
    const rootCell = model.Find("root");
    if (!rootCell)
        throw new Error(Locale.Text("Not a draw.io diagram."));

    const nodes = rootCell.FindAll("mxCell");
    const byId = new Map();
    for (const node of nodes) {
        const id = node.Attr("id");
        if (!id) continue;
        byId.set(id, {
            node: node,
            parent: node.Attr("parent") || "",
            id: id,
        });
    }

    const diagram = new Diagram();
    const mapped = new Map();
    const layerMap = new Map();

    /* A layer is a cell whose parent is the root, with no vertex or edge of
     * its own. The first one reuses the layer the document starts with. */
    let firstLayer = true;
    for (const node of nodes) {
        if (node.Attr("parent") !== "0") continue;
        if (!node.Attr("id") || node.Attr("id") === "0") continue;
        if (node.Attr("vertex") === "1" || node.Attr("edge") === "1") continue;

        const id = node.Attr("id");
        const name = cleanText(node.Attr("value"));
        let layer;
        if (firstLayer) {
            layer = diagram.layers[0];
            if (name) layer.name = name;
            firstLayer = false;
        } else {
            layer = diagram.addLayer(name);
        }
        layer.visible = node.Attr("visible") !== "0";
        layerMap.set(id, layer.id);
    }

    /* Vertices first, so an edge may point at any of them whatever the file
     * order. The ids draw.io wrote are kept in `mapped`, not in the model. */
    for (const node of nodes) {
        if (node.Attr("vertex") !== "1") continue;
        if (node.Attr("visible") === "0") continue;

        const id = node.Attr("id");
        const cell = byId.get(id);
        if (!id || !cell) continue;

        const rect = absoluteRect(cell, byId);
        if (!rect) continue;

        const style = node.Attr("style") || "";
        const map = styleMap(style);
        if (map.group === "1" || (map.shape || "").indexOf("group") >= 0 ||
            (map.shape || "").indexOf("image") >= 0) continue;
        const kind = shapeKind(map, style);
        const fill = kind === "text" ? "rgba(0,0,0,0)"
                                     : colour(map, "fillColor", "#ffffff");
        const stroke = kind === "text" ? "rgba(0,0,0,0)"
                                       : colour(map, "strokeColor", "#000000");
        const textColor = colour(map, "fontColor", "#000000");
        const fontValue = parseFloat(map.fontSize || "12");
        const fontSize = (fontValue === fontValue) ? fontValue : 12;
        const arcSize = parseFloat(map.arcSize || "15");
        const radius = Math.max(0, Math.min(
            Math.min(rect.w, rect.h) / 2,
            isNaN(arcSize) ? 12 : Math.min(rect.w, rect.h) * arcSize / 100));

        const shapeWidth = parseFloat(map.strokeWidth || "1.5");
        const fontStyle = parseInt(map.fontStyle || "0", 10);
        const shape = diagram.addShape(kind, rect.x, rect.y, rect.w, rect.h, {
            layer: layerMap.get(layerOf(cell, byId)) || diagram.layers[0].id,
            text: cleanText(node.Attr("value")),
            fill: fill,
            stroke: stroke,
            strokeWidth: shapeWidth === shapeWidth ? shapeWidth : 1.5,
            dash: map.dashed === "1" ? "dash" : "solid",
            textColor: textColor,
            fontSize: fontSize === fontSize ? Math.round(fontSize) : 12,
            radius: Math.round(radius),
            textBold: (fontStyle & 1) !== 0,
            textItalic: (fontStyle & 2) !== 0,
            textAlign: map.align || "",
            textVAlign: map.verticalAlign || "",
        });
        mapped.set(id, shape.id);
    }

    for (const node of nodes) {
        if (node.Attr("edge") !== "1") continue;
        if (node.Attr("visible") === "0") continue;

        const source = mapped.get(node.Attr("source"));
        const target = mapped.get(node.Attr("target"));
        if (!source || !target) continue;

        const style = node.Attr("style") || "";
        const map = styleMap(style);
        const fontValue = parseFloat(map.fontSize || "11");
        const fontSize = (fontValue === fontValue) ? fontValue : 11;
        const edgeCell = byId.get(node.Attr("id"));
        const edgeWidth = parseFloat(map.strokeWidth || "2");
        const fontStyle = parseInt(map.fontStyle || "0", 10);
        diagram.addEdge(source, target, {
            layer: edgeCell
                ? (layerMap.get(layerOf(edgeCell, byId)) || diagram.layers[0].id)
                : diagram.layers[0].id,
            text: cleanText(node.Attr("value")),
            stroke: colour(map, "strokeColor", "#000000"),
            strokeWidth: edgeWidth === edgeWidth ? edgeWidth : 2,
            dash: map.dashed === "1" ? "dash" : "solid",
            textColor: colour(map, "fontColor", ""),
            fontSize: fontSize === fontSize ? Math.round(fontSize) : 11,
            textBold: (fontStyle & 1) !== 0,
            textItalic: (fontStyle & 2) !== 0,
        });
    }

    return diagram;
}

export class DrawioImport {

    static parse(text) {
        const document = Xml.Parse(text);
        const root = document.Root;
        if (!root) throw new Error(Locale.Text("Not a draw.io diagram."));

        const compressed = Locale.Text("This .drawio file is compressed. In draw.io, use File > Export as > XML and open that file.");
        const pages = [];
        const names = [];

        if (root.Name === "mxGraphModel") {
            pages.push(importModel(root));
            names.push("");
        } else if (root.Name === "diagram") {
            const model = root.Find("mxGraphModel");
            if (!model) {
                if (root.Text.trim() !== "") throw new Error(compressed);
                pages.push(new Diagram());
            } else {
                pages.push(importModel(model));
            }
            names.push(root.Attr("name") || "");
        } else if (root.Name === "mxfile") {
            const diagrams = root.FindAll("diagram");
            if (!diagrams.length) {
                const model = root.Find("mxGraphModel");
                if (!model) throw new Error(compressed);
                pages.push(importModel(model));
                names.push("");
            } else {
                for (const diagram of diagrams) {
                    const model = diagram.Find("mxGraphModel");
                    const name = diagram.Attr("name") || "";
                    if (!model) {
                        if (diagram.Text.trim() !== "") throw new Error(compressed);
                        pages.push(new Diagram());
                    } else {
                        pages.push(importModel(model));
                    }
                    names.push(name);
                }
            }
        } else {
            throw new Error(Locale.Text("Not a draw.io diagram."));
        }

        if (!pages.length) throw new Error(Locale.Text("Not a draw.io diagram."));

        return {
            diagram: pages[0],
            diagrams: pages,
            names: names,
            pages: pages.length,
            pageName: names[0] || "",
        };
    }
}
