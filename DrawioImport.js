/*
 * Opening a draw.io file.
 *
 * draw.io is XML: an `mxGraphModel` with `mxCell`s, each vertex carrying an
 * `mxGeometry` and a style string of `key=value;` pairs. This file maps the
 * useful half of that onto a `Diagram`: top-level and grouped vertices become
 * our shapes, edges become our connectors, and the label loses its HTML.
 *
 * **Both forms are read.** draw.io normally writes a page as raw DEFLATE of
 * its percent-encoded XML, then Base64; `Zlib` inflates it and the percent
 * escapes are decoded. The uncompressed form is what draw.io calls "XML"
 * (`File > Export as > XML`), and it is also what `Extras > Edit Diagram`
 * shows. A page that is compressed and still cannot be read is refused with a
 * sentence, rather than a parser error.
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
    const parts = style.split(";");
    for (let i = 0; i < parts.length; i++) {
        let part = parts[i];
        /* An inline picture is `image=data:image/png;base64,...`: its own
         * semicolon is not a style separator, so the two halves are joined
         * back before the key is read. */
        if (part.indexOf("data:image/") >= 0 && part.indexOf(",") < 0 &&
            i + 1 < parts.length)
            part += ";" + parts[++i];
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

/* An image cell in an uncompressed draw.io file usually carries its pixels
 * inline as a base64 data URI. A path or a URL is not embedded, so it cannot
 * travel with the document and the cell is skipped as before. */
function inlineImage(value) {
    if (!value || value.indexOf("data:image/") !== 0) return "";
    const comma = value.indexOf(",");
    if (comma < 0) return "";
    if (value.slice(0, comma).indexOf(";base64") < 0) return "";
    return value.slice(comma + 1);
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

/* The nearest ancestor that draw.io marks as a group, if any. */
function groupOf(cell, byId) {
    let id = cell.parent;
    const seen = new Set();
    while (id && id !== "0" && id !== "1" && !seen.has(id)) {
        seen.add(id);
        const up = byId.get(id);
        if (!up) break;
        const map = styleMap(up.node.Attr("style") || "");
        if (map.group === "1" || (map.shape || "").indexOf("group") >= 0)
            return id;
        id = up.parent;
    }
    return "";
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
    const groupMap = new Map();

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
        if (map.group === "1" || (map.shape || "").indexOf("group") >= 0)
            continue;
        const image = inlineImage(map.image);
        if (!image && (map.shape || "").indexOf("image") >= 0) continue;
        const kind = image ? "image" : shapeKind(map, style);
        const fill = (kind === "text" || kind === "image")
            ? "rgba(0,0,0,0)" : colour(map, "fillColor", "#ffffff");
        const stroke = (kind === "text" || kind === "image")
            ? "rgba(0,0,0,0)" : colour(map, "strokeColor", "#000000");
        const textColor = colour(map, "fontColor", "#000000");
        const fontValue = parseFloat(map.fontSize || "12");
        const fontSize = (fontValue === fontValue) ? fontValue : 12;
        const arcSize = parseFloat(map.arcSize || "15");
        const radius = Math.max(0, Math.min(
            Math.min(rect.w, rect.h) / 2,
            isNaN(arcSize) ? 12 : Math.min(rect.w, rect.h) * arcSize / 100));

        const shapeWidth = parseFloat(map.strokeWidth || "1.5");
        const fontStyle = parseInt(map.fontStyle || "0", 10);
        const geometry = cell.node.Find("mxGeometry");
        const rotationValue = parseFloat(
            map.rotation || (geometry && geometry.Attr("rotation")) || "0");
        const oldGroup = groupOf(cell, byId);
        let group = "";
        if (oldGroup) {
            if (!groupMap.has(oldGroup))
                groupMap.set(oldGroup, diagram.newGroup());
            group = groupMap.get(oldGroup);
        }
        const shape = diagram.addShape(kind, rect.x, rect.y, rect.w, rect.h, {
            layer: layerMap.get(layerOf(cell, byId)) || diagram.layers[0].id,
            group: group,
            text: cleanText(node.Attr("value")),
            fill: fill,
            stroke: stroke,
            strokeWidth: shapeWidth === shapeWidth ? shapeWidth : 1.5,
            dash: map.dashed === "1" ? "dash" : "solid",
            textColor: textColor,
            fontSize: fontSize === fontSize ? Math.round(fontSize) : 12,
            radius: Math.round(radius),
            image: image,
            textBold: (fontStyle & 1) !== 0,
            textItalic: (fontStyle & 2) !== 0,
            textAlign: map.align || "",
            textVAlign: map.verticalAlign || "",
            rotation: rotationValue === rotationValue ? rotationValue : 0,
        });
        mapped.set(id, shape.id);
    }

    for (const node of nodes) {
        if (node.Attr("edge") !== "1") continue;
        if (node.Attr("visible") === "0") continue;

        const source = mapped.get(node.Attr("source"));
        const target = mapped.get(node.Attr("target"));

        const style = node.Attr("style") || "";
        const map = styleMap(style);
        const fontValue = parseFloat(map.fontSize || "11");
        const fontSize = (fontValue === fontValue) ? fontValue : 11;
        const edgeCell = byId.get(node.Attr("id"));
        const layer = edgeCell
            ? (layerMap.get(layerOf(edgeCell, byId)) || diagram.layers[0].id)
            : diagram.layers[0].id;
        const edgeWidth = parseFloat(map.strokeWidth || "2");
        const fontStyle = parseInt(map.fontStyle || "0", 10);
        const geometry = node.Find("mxGeometry");
        const waypoints = [];
        if (geometry) {
            const array = geometry.Find("Array");
            if (array) {
                for (const point of array.FindAll("mxPoint")) {
                    waypoints.push({
                        x: attrNumber(point, "x", 0),
                        y: attrNumber(point, "y", 0),
                    });
                }
            }
        }
        const route = map.curved === "1" ? "curved"
                    : (map.edgeStyle === "none" ? "straight" : "orthogonal");
        const common = {
            layer: layer,
            route: route,
            waypoints: waypoints,
            fromPort: stylePort(map, "exitX", "exitY"),
            toPort: stylePort(map, "entryX", "entryY"),
            arrowStart: map.startArrow && map.startArrow !== "none",
            arrowEnd: map.endArrow !== "none",
            text: cleanText(node.Attr("value")),
            stroke: colour(map, "strokeColor", "#000000"),
            strokeWidth: edgeWidth === edgeWidth ? edgeWidth : 2,
            dash: map.dashed === "1" ? "dash" : "solid",
            textColor: colour(map, "fontColor", ""),
            fontSize: fontSize === fontSize ? Math.round(fontSize) : 11,
            textBold: (fontStyle & 1) !== 0,
            textItalic: (fontStyle & 2) !== 0,
        };

        if (source && target) {
            diagram.addEdge(source, target, common);
            continue;
        }

        /* A line with no shapes has its two ends in sourcePoint/targetPoint. */
        let sx = null, sy = null, tx = null, ty = null;
        if (geometry) {
            for (const point of geometry.FindAll("mxPoint")) {
                const at = point.Attr("as");
                if (at === "sourcePoint") {
                    sx = attrNumber(point, "x", 0);
                    sy = attrNumber(point, "y", 0);
                } else if (at === "targetPoint") {
                    tx = attrNumber(point, "x", 0);
                    ty = attrNumber(point, "y", 0);
                }
            }
        }
        if (sx !== null && tx !== null) {
            diagram.addLine(sx, sy, tx, ty, common);
        }
    }

    return diagram;
}

function stylePort(map, xKey, yKey) {
    const x = parseFloat(map[xKey]);
    const y = parseFloat(map[yKey]);
    if (x !== x || y !== y) return null;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

export class DrawioImport {

    /* A compressed page: Base64 over raw DEFLATE (or the zlib wrapper, which
     * `Graph.compress(data, true)` writes), of the page's percent-encoded XML.
     * `Zlib` gets it back; `decodeURIComponent` undoes draw.io's escaping. */
    static inflate(text) {
        try {
            /* Base64 carries no whitespace; a hand-wrapped page may still
             * have some, and `FromBase64` refuses it. */
            const bytes = Bytes.FromBase64(text.replace(/\s+/g, ""));
            let xml;
            try {
                xml = Zlib.Decompress(bytes, { Raw: true }).ToText();
            } catch (raw) {
                xml = Zlib.Decompress(bytes).ToText();
            }
            xml = xml.trim();
            if (xml.indexOf("%3C") === 0 || xml.indexOf("%3c") === 0)
                xml = decodeURIComponent(xml);
            return xml.trim();
        } catch (e) {
            throw new Error(Locale.Text("This compressed draw.io content could not be read. Export it as uncompressed XML and open that."));
        }
    }

    /* The page's `<mxGraphModel>`, inline or compressed inside its `<diagram>`. */
    static modelOf(diagram) {
        const model = diagram.Find("mxGraphModel");
        if (model) return model;

        const text = diagram.Text.trim();
        if (text === "") return null;

        const document = Xml.Parse(DrawioImport.inflate(text));
        const root = document.Root;
        if (!root || root.Name !== "mxGraphModel")
            throw new Error(Locale.Text("This compressed draw.io page does not hold a diagram."));
        return root;
    }

    static parse(text) {
        const document = Xml.Parse(text);
        const root = document.Root;
        if (!root) throw new Error(Locale.Text("Not a draw.io diagram."));

        const pages = [];
        const names = [];

        if (root.Name === "mxGraphModel") {
            pages.push(importModel(root));
            names.push("");
        } else if (root.Name === "diagram") {
            const model = DrawioImport.modelOf(root);
            if (model) pages.push(importModel(model));
            else pages.push(new Diagram());
            names.push(root.Attr("name") || "");
        } else if (root.Name === "mxfile") {
            const diagrams = root.FindAll("diagram");
            if (!diagrams.length) {
                const model = root.Find("mxGraphModel");
                if (!model) throw new Error(Locale.Text("Not a draw.io diagram."));
                pages.push(importModel(model));
                names.push("");
            } else {
                for (const diagram of diagrams) {
                    const model = DrawioImport.modelOf(diagram);
                    const name = diagram.Attr("name") || "";
                    if (model) pages.push(importModel(model));
                    else pages.push(new Diagram());
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
