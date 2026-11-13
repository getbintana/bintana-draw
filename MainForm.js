/*
 * Bintana Draw -- a diagram editor, in one window.
 *
 * The document is `Diagram` (shapes and connectors, no widgets); the frame is
 * `Render`; this file is the hand between them: the tool, the selection, the
 * gesture in flight, the file, and the undo history.
 *
 * **The canvas is a world with a transform.** `panX`/`panY` are screen pixels
 * and `zoom` is the scale between the two, so every pointer event becomes a
 * world point once (`toWorld`) and every shape keeps coordinates that mean
 * something after the window is resized or the view is panned. An export sets
 * `exporting` and draws the same document fitted to white paper.
 *
 * **A gesture is one undo step.** The snapshot is taken on the press and the
 * step is added on the release, so dragging a shape through forty motions is
 * one thing to take back, which is the only useful kind. Everything that
 * changes the document goes through `pushUndo`.
 */
"use strict";

const GRID_STEP    = 10;
const MIN_SIZE     = 20;
const ZOOM_MIN     = 0.2;
const ZOOM_MAX     = 4;
const HANDLE_HIT   = 8;
const EDGE_HIT     = 8;
const PASTE_OFFSET = 20;

const DEFAULT_FILL_COLOR   = "#dae8fc";
const DEFAULT_STROKE_COLOR = "#6c8ebf";

function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
}

/* A ColorButton wants rgb()/rgba(); a shape may carry a hex colour from the
 * file, and the two are the same colour to the painter. */
function colorButtonValue(color) {
    if (typeof color === "string" && color.length === 7 && color[0] === "#") {
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        if (!isNaN(r) && !isNaN(g) && !isNaN(b))
            return "rgb(" + r + "," + g + "," + b + ")";
    }
    return color;
}

function rectOf(a, b) {
    return {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
    };
}

function rectsIntersect(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
}

export class MainForm extends Form {

    book   = null;
    doc    = null;
    path   = "";
    importedFrom = "";
    activePage = 0;
    activeLayer = "";
    sel    = [];
    tool   = "select";
    zoom   = 1;
    panX   = 40;
    panY   = 40;
    grid   = true;
    drag   = null;
    editing = null;
    guides = null;

    undo   = null;
    clipboard = null;

    defaultFill   = DEFAULT_FILL_COLOR;
    defaultStroke = DEFAULT_STROKE_COLOR;
    defaultStrokeWidth = 2;
    defaultDash        = "solid";
    defaultFontSize    = 12;
    defaultTextBold    = false;
    defaultTextItalic  = false;
    defaultTextAlign   = "center";
    defaultTextVAlign  = "middle";
    defaultTextColor   = "#1f2937";
    defaultRotation    = 0;

    statusText = "";
    syncingColors = false;
    syncingGrid   = false;
    syncingTools  = false;
    syncingLayers = false;
    syncingPages  = false;
    syncingFormat = false;
    exporting     = false;
    forceClose    = false;
    pendingFit    = false;
    lastMouse     = { x: 0, y: 0 };

    /* ------------------------------------------------------------- the form */

    Form_Open() {
        this.book = new Document();
        this.activePage = 0;
        this.doc  = this.book.pages[0];
        this.activeLayer = this.defaultActiveLayer(this.doc);
        this.sel  = [];
        this.tool = "select";
        this.zoom = 1;
        this.panX = 40;
        this.panY = 40;
        this.grid = true;

        this.undo = new UndoStack();
        this.undo.Limit = 120;
        this.undo.OnChange = () => {
            this.refreshActions();
            this.refreshTitle();
        };

        this.BtnToolSelect.Active = true;
        this.syncingColors = true;
        this.BtnFill.Value = colorButtonValue(this.defaultFill);
        this.BtnLine.Value = colorButtonValue(this.defaultStroke);
        this.syncingColors = false;

        this.syncingFormat = true;
        this.CmbDash.Add(Locale.Text("Solid"), "solid");
        this.CmbDash.Add(Locale.Text("Dashed"), "dash");
        this.CmbDash.Add(Locale.Text("Dotted"), "dot");
        this.CmbVAlign.Add(Locale.Text("Top"), "top");
        this.CmbVAlign.Add(Locale.Text("Middle"), "middle");
        this.CmbVAlign.Add(Locale.Text("Bottom"), "bottom");

        this.SpnStrokeWidth.Value = this.defaultStrokeWidth;
        this.CmbDash.Index = 0;
        this.SpnFont.Value = this.defaultFontSize;
        this.BtnBold.Active = false;
        this.BtnItalic.Active = false;
        this.BtnAlignLeft.Active = false;
        this.BtnAlignCenter.Active = true;
        this.BtnAlignRight.Active = false;
        this.CmbVAlign.Index = 1;
        this.SpnRotation.Value = this.defaultRotation;
        this.BtnTextColor.Value = colorButtonValue(this.defaultTextColor);
        this.syncingFormat = false;

        this.syncingGrid = true;
        this.MnuGrid.Value = true;
        this.syncingGrid = false;

        this.ActPaste.Enabled = false;
        this.statusText = this.toolHint("select");
        this.refreshAll();

        /* A file manager passes the diagram as an argument. */
        const args = Application.Arguments;
        if (args && args.length && File.Exists(args[0]))
            this.openDocument(args[0]);

        Timer.After(0, () => {
            this.fitCanvas();
            this.Canvas.SetFocus();
            this.fitPending();
        });
    }

    /*
     * A DrawingArea is the one control with no natural size: HAlign Fill alone
     * leaves it at the width it was declared with, because there is nothing
     * inside it asking GTK for the room. So the stage is the measure and the
     * canvas is given its size whenever the stage gets one.
     */
    fitCanvas() {
        if (!this.Stage || !this.Canvas) return;
        const box = this.Stage.Bounds();
        if (box.Width <= 2 || box.Height <= 2) return;
        if (this.Canvas.Width !== box.Width || this.Canvas.Height !== box.Height) {
            this.Canvas.Move(0, 0);
            this.Canvas.Resize(box.Width, box.Height);
        }
    }

    viewport() {
        const box = this.Stage ? this.Stage.Bounds() : { Width: 0, Height: 0 };
        return {
            w: box.Width > 2 ? box.Width : 900,
            h: box.Height > 2 ? box.Height : 600,
        };
    }

    /* GTK's first real allocation: the moment a fit asked for before the window
     * was up can finally measure the stage. */
    Canvas_Allocated() {
        this.fitCanvas();
        this.fitPending();
    }

    /* A file opened before the window was up asks to fit once the stage has a
     * real width. The fallback in `viewport` is for a question asked too early,
     * never for the fit itself. */
    fitPending() {
        if (!this.pendingFit) return;
        if (this.Stage.Bounds().Width <= 2) return;
        this.pendingFit = false;
        this.zoomFit();
    }

    Form_Close() {
        if (this.forceClose || !this.undo.Modified) return false;
        this.guard(() => {
            this.forceClose = true;
            this.Close();
        });
        return true;
    }

    Form_Resize() {
        if (this.editing) this.commitEdit();
        this.fitCanvas();
        if (this.Canvas) this.Canvas.Redraw();
    }

    Stage_Allocated() {
        this.fitCanvas();
        this.fitPending();
    }

    /* -------------------------------------------------------------- drawing */

    Canvas_Draw(p, width, height) {
        if (!this.doc) return;
        if (this.exporting) {
            drawExport(p, this.doc, width, height);
            return;
        }

        let createPreview = null;
        let connectPreview = null;
        let linePreview = null;
        let band = null;

        if (this.drag) {
            if (this.drag.kind === "create") {
                const r = rectOf(this.drag.start, this.drag.at);
                if (r.w >= 2 || r.h >= 2) createPreview = r;
            } else if (this.drag.kind === "connect") {
                const from = this.doc.shapeById(this.drag.from);
                if (from) {
                    const c = shapeCenter(from);
                    connectPreview = {
                        x1: c.x, y1: c.y,
                        x2: this.drag.at.x, y2: this.drag.at.y,
                        zoom: this.zoom,
                    };
                }
            } else if (this.drag.kind === "freeLine") {
                linePreview = {
                    x1: this.drag.start.x, y1: this.drag.start.y,
                    x2: this.drag.at.x, y2: this.drag.at.y,
                    arrow: this.drag.tool === "arrow",
                };
            } else if (this.drag.kind === "band") {
                band = rectOf(this.drag.start, this.drag.at);
            }
        }

        drawCanvas(p, this.doc, {
            panX: this.panX,
            panY: this.panY,
            zoom: this.zoom,
            grid: this.grid,
            selected: this.sel,
            createPreview: createPreview,
            connectPreview: connectPreview,
            linePreview: linePreview,
            band: band,
            guides: this.guides,
        }, width, height);
    }

    /* ---------------------------------------------------------------- tools */

    toolButtons() {
        return [
            this.BtnToolSelect, this.BtnToolRect, this.BtnToolRound,
            this.BtnToolEllipse, this.BtnToolDiamond, this.BtnToolTerminator,
            this.BtnToolData, this.BtnToolCylinder, this.BtnToolNote,
            this.BtnToolText, this.BtnToolConnect,
        ];
    }

    chooseTool(tool, button) {
        if (this.editing) this.commitEdit();
        this.tool = tool;
        /* Assigning Active raises Click on a ToggleButton, which is wired back
         * to this same choice; the guard is what stops that being a loop. */
        this.syncingTools = true;
        for (const b of this.toolButtons()) b.Active = (b === button);
        this.syncingTools = false;
        this.Canvas.Cursor = tool === "select" ? "Arrow" : "Crosshair";
        this.statusText = this.toolHint(tool);
        this.updateStatus();
        this.Canvas.Redraw();
    }

    toolButtonClicked(tool, button) {
        if (this.syncingTools) return;
        if (!button.Active) {
            this.chooseTool("select", this.BtnToolSelect);
            return;
        }
        this.chooseTool(tool, button);
    }

    BtnToolSelect_Click() {
        if (this.syncingTools) return;
        this.chooseTool("select", this.BtnToolSelect);
    }
    BtnToolRect_Click()       { this.toolButtonClicked("rect", this.BtnToolRect); }
    BtnToolRound_Click()      { this.toolButtonClicked("round", this.BtnToolRound); }
    BtnToolEllipse_Click()    { this.toolButtonClicked("ellipse", this.BtnToolEllipse); }
    BtnToolDiamond_Click()    { this.toolButtonClicked("diamond", this.BtnToolDiamond); }
    BtnToolTerminator_Click() { this.toolButtonClicked("terminator", this.BtnToolTerminator); }
    BtnToolData_Click()       { this.toolButtonClicked("data", this.BtnToolData); }
    BtnToolCylinder_Click()   { this.toolButtonClicked("cylinder", this.BtnToolCylinder); }
    BtnToolNote_Click()       { this.toolButtonClicked("note", this.BtnToolNote); }
    BtnToolText_Click()       { this.toolButtonClicked("text", this.BtnToolText); }
    BtnToolConnect_Click()    { this.toolButtonClicked("connect", this.BtnToolConnect); }
    BtnToolLine_Click()       { this.toolButtonClicked("line", this.BtnToolLine); }
    BtnToolArrow_Click()      { this.toolButtonClicked("arrow", this.BtnToolArrow); }

    toolHint(tool) {
        switch (tool) {
        case "select":     return Locale.Text("Select and drag. Double-click to edit text.");
        case "connect":    return Locale.Text("Drag from one shape to another to connect them.");
        case "line":       return Locale.Text("Drag to draw a line.");
        case "arrow":      return Locale.Text("Drag to draw an arrow.");
        case "text":       return Locale.Text("Click where the text should go.");
        case "note":       return Locale.Text("Drag a note, or click for the default size.");
        default:           return Locale.Text("Drag a shape, or click for the default size.");
        }
    }

    /* ------------------------------------------------------------ the world */

    toWorld(x, y) {
        return { x: (x - this.panX) / this.zoom, y: (y - this.panY) / this.zoom };
    }

    snap(value) {
        return Math.round(value / GRID_STEP) * GRID_STEP;
    }

    selectedShapes() {
        return this.doc.shapes.filter((s) => this.sel.indexOf(s.id) >= 0);
    }

    selectedEdges() {
        return this.doc.edges.filter((e) => this.sel.indexOf(e.id) >= 0);
    }

    /* ---------------------------------------------------------------- layers */

    defaultActiveLayer(doc) {
        for (const layer of doc.layers)
            if (layer.visible && !layer.locked) return layer.id;
        return doc.layers.length ? doc.layers[0].id : "";
    }

    ensureActiveLayer() {
        if (!this.doc) return;
        if (!this.doc.layerById(this.activeLayer)) {
            this.activeLayer = this.defaultActiveLayer(this.doc);
        }
    }

    activeLayerObject() {
        return this.doc ? this.doc.layerById(this.activeLayer) : null;
    }

    canEditActiveLayer() {
        const layer = this.activeLayerObject();
        if (!layer) {
            this.setStatus(Locale.Text("There is no active layer."));
            return false;
        }
        if (!layer.visible) {
            this.setStatus(Locale.Text("The active layer is hidden."));
            return false;
        }
        if (layer.locked) {
            this.setStatus(Locale.Text("The active layer is locked."));
            return false;
        }
        return true;
    }

    pruneSelection() {
        if (!this.doc) return;
        this.sel = this.expandGroups(
            this.sel.filter((id) => this.doc.canSelect(id)));
    }

    layerLabel(layer) {
        let label = layer.name + " (" + this.doc.layerShapeCount(layer.id) + ")";
        if (!layer.visible) label += " · " + Locale.Text("hidden");
        if (layer.locked) label += " · " + Locale.Text("locked");
        return label;
    }

    refreshLayerControls() {
        if (!this.BtnLayerVisible) return;
        this.ensureActiveLayer();
        const layer = this.activeLayerObject();

        this.syncingLayers = true;
        this.TxtLayerName.Text = layer ? layer.name : "";
        this.BtnLayerVisible.Active = layer ? layer.visible : false;
        this.BtnLayerLocked.Active = layer ? layer.locked : false;
        this.syncingLayers = false;

        const index = layer ? this.doc.layers.indexOf(layer) : -1;
        this.BtnLayerRemove.Enabled = this.doc.layers.length > 1 && !!layer;
        this.BtnLayerUp.Enabled = index >= 0 && index < this.doc.layers.length - 1;
        this.BtnLayerDown.Enabled = index > 0;
        this.BtnLayerAssign.Enabled = !!layer && layer.visible && !layer.locked &&
                                      this.sel.length > 0;
    }

    refreshLayers() {
        if (!this.LstLayers) return;
        this.ensureActiveLayer();
        const layer = this.activeLayerObject();

        this.syncingLayers = true;

        /* Keep the rows when only a count or a name changed: a rebuild would
         * put the scroll back at the top after every drag. */
        let sameRows = this.LstLayers.Count === this.doc.layers.length;
        if (sameRows) {
            for (let i = 0; i < this.doc.layers.length; i++) {
                const item = this.doc.layers[this.doc.layers.length - 1 - i];
                if (this.LstLayers.KeyAt(i) !== item.id) { sameRows = false; break; }
            }
        }
        if (sameRows) {
            for (let i = 0; i < this.doc.layers.length; i++) {
                const item = this.doc.layers[this.doc.layers.length - 1 - i];
                this.LstLayers.SetText(i, this.layerLabel(item));
            }
        } else {
            this.LstLayers.Clear();
            /* The list reads top first, the array paints bottom first. */
            for (let i = this.doc.layers.length - 1; i >= 0; i--) {
                const item = this.doc.layers[i];
                this.LstLayers.Add(this.layerLabel(item), item.id);
            }
        }
        if (layer) this.LstLayers.Key = layer.id;
        this.syncingLayers = false;

        this.refreshLayerControls();
    }

    /* ------------------------------------------------------------ alignment */

    /*
     * The guide arithmetic. Every other shape offers three vertical lines (its
     * left, its centre and its right) and three horizontal ones; the moving
     * rectangle offers the same three. The closest pair inside the tolerance
     * wins, the move is nudged by that difference, and the line is kept so the
     * canvas can draw it while the drag lasts.
     */
    shapesBounds(shapes) {
        if (!shapes.length) return null;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const s of shapes) {
            x0 = Math.min(x0, s.x);
            y0 = Math.min(y0, s.y);
            x1 = Math.max(x1, s.x + s.w);
            y1 = Math.max(y1, s.y + s.h);
        }
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    guideTargets(exclude) {
        const vertical = [], horizontal = [];
        for (const s of this.doc.shapes) {
            if (exclude.has(s.id)) continue;
            vertical.push(s.x, s.x + s.w / 2, s.x + s.w);
            horizontal.push(s.y, s.y + s.h / 2, s.y + s.h);
        }
        return { vertical: vertical, horizontal: horizontal };
    }

    nearestDelta(anchors, targets, tolerance) {
        let best = null;
        for (const a of anchors) {
            for (const t of targets) {
                const delta = t - a;
                if (Math.abs(delta) > tolerance) continue;
                if (best === null || Math.abs(delta) < Math.abs(best))
                    best = delta;
            }
        }
        return best;
    }

    matchingLines(rect, targets) {
        const vertical = [], horizontal = [];
        const vAnchors = [rect.x, rect.x + rect.w / 2, rect.x + rect.w];
        const hAnchors = [rect.y, rect.y + rect.h / 2, rect.y + rect.h];

        for (const line of targets.vertical) {
            for (const a of vAnchors) {
                if (Math.abs(line - a) < 0.25 && vertical.indexOf(line) < 0) {
                    vertical.push(line);
                    break;
                }
            }
        }
        for (const line of targets.horizontal) {
            for (const a of hAnchors) {
                if (Math.abs(line - a) < 0.25 && horizontal.indexOf(line) < 0) {
                    horizontal.push(line);
                    break;
                }
            }
        }
        return { vertical: vertical, horizontal: horizontal };
    }

    guideMove(rect, targets, tolerance, lockX, lockY) {
        const vAnchors = [rect.x, rect.x + rect.w / 2, rect.x + rect.w];
        const hAnchors = [rect.y, rect.y + rect.h / 2, rect.y + rect.h];
        const dx = lockX ? 0 : (this.nearestDelta(vAnchors, targets.vertical,
                                                  tolerance) || 0);
        const dy = lockY ? 0 : (this.nearestDelta(hAnchors, targets.horizontal,
                                                  tolerance) || 0);
        const moved = { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
        const guides = this.matchingLines(moved, targets);
        if (lockX) guides.horizontal = [];
        if (lockY) guides.vertical = [];
        return { dx: dx, dy: dy, guides: guides };
    }

    guideResize(rect, dir, targets, tolerance) {
        let x = rect.x, y = rect.y, w = rect.w, h = rect.h;
        const right = x + w, bottom = y + h;
        const vertical = [], horizontal = [];

        if (dir.indexOf("e") >= 0) {
            const d = this.nearestDelta([right], targets.vertical, tolerance);
            if (d !== null && w + d >= MIN_SIZE) {
                w += d;
                vertical.push(right + d);
            }
        }
        if (dir.indexOf("w") >= 0) {
            const d = this.nearestDelta([x], targets.vertical, tolerance);
            if (d !== null && right - (x + d) >= MIN_SIZE) {
                x += d;
                w = right - x;
                vertical.push(x);
            }
        }
        if (dir.indexOf("s") >= 0) {
            const d = this.nearestDelta([bottom], targets.horizontal, tolerance);
            if (d !== null && h + d >= MIN_SIZE) {
                h += d;
                horizontal.push(bottom + d);
            }
        }
        if (dir.indexOf("n") >= 0) {
            const d = this.nearestDelta([y], targets.horizontal, tolerance);
            if (d !== null && bottom - (y + d) >= MIN_SIZE) {
                y += d;
                h = bottom - y;
                horizontal.push(y);
            }
        }

        return { x: x, y: y, w: w, h: h,
                 guides: { vertical: vertical, horizontal: horizontal } };
    }

    expandGroups(ids) {
        const out = [];
        const seen = new Set();
        for (const id of ids) {
            const object = this.doc.find(id);
            if (!object) continue;
            const members = object.from === undefined && object.group
                ? this.doc.groupMembers(object.group)
                : [object];
            for (const member of members) {
                if (!this.doc.canSelect(member) || seen.has(member.id)) continue;
                seen.add(member.id);
                out.push(member.id);
            }
        }
        return out;
    }

    select(ids) {
        this.sel = this.expandGroups(ids);
        this.syncColors();
        this.syncFormatControls();
        this.updateStatus();
        this.refreshActions();
        this.refreshLayerControls();
        if (this.Canvas) this.Canvas.Redraw();
    }

    toggleSelection(id) {
        const object = this.doc.find(id);
        if (!object || !this.doc.canSelect(object)) return;
        const members = object.from === undefined && object.group
            ? this.doc.groupMembers(object.group)
            : [object];
        const ids = members.filter((s) => this.doc.canSelect(s))
                           .map((s) => s.id);
        const all = ids.every((member) => this.sel.indexOf(member) >= 0);

        if (all) {
            this.sel = this.sel.filter((member) => ids.indexOf(member) < 0);
        } else {
            for (const member of ids)
                if (this.sel.indexOf(member) < 0) this.sel.push(member);
        }

        this.syncColors();
        this.syncFormatControls();
        this.updateStatus();
        this.refreshActions();
        this.refreshLayerControls();
        if (this.Canvas) this.Canvas.Redraw();
    }

    handleAt(x, y) {
        const shapes = this.selectedShapes();
        if (shapes.length !== 1 || this.sel.length !== 1) return "";
        if (shapes[0].rotation) return "";
        for (const h of shapeHandles(shapes[0])) {
            const sx = this.panX + h.x * this.zoom;
            const sy = this.panY + h.y * this.zoom;
            if (Math.abs(x - sx) <= HANDLE_HIT &&
                Math.abs(y - sy) <= HANDLE_HIT) return h.dir;
        }
        return "";
    }

    defaultSize(kind) {
        switch (kind) {
        case "ellipse":    return { w: 140, h: 90 };
        case "diamond":    return { w: 150, h: 100 };
        case "terminator": return { w: 150, h: 60 };
        case "cylinder":   return { w: 130, h: 100 };
        case "note":       return { w: 150, h: 90 };
        case "text":       return { w: 180, h: 44 };
        default:           return { w: 150, h: 80 };
        }
    }

    shapeOptions(kind) {
        let options;
        if (kind === "note")
            options = { fill: "#fff2cc", stroke: "#d6b656", text: "" };
        else if (kind === "text")
            options = { fill: "rgba(0,0,0,0)", stroke: "rgba(0,0,0,0)" };
        else
            options = { fill: this.defaultFill, stroke: this.defaultStroke };

        options.strokeWidth = this.defaultStrokeWidth;
        options.dash = this.defaultDash;
        options.fontSize = this.defaultFontSize;
        options.textColor = this.defaultTextColor;
        options.textBold = this.defaultTextBold;
        options.textItalic = this.defaultTextItalic;
        options.textAlign = kind === "note" ? "left" : this.defaultTextAlign;
        options.textVAlign = kind === "note" ? "top" : this.defaultTextVAlign;
        options.rotation = this.defaultRotation;
        return options;
    }

    /* ------------------------------------------------------------- pointers */

    Canvas_MouseDown(x, y, button, ctrl, shift) {
        this.Canvas.SetFocus();
        this.lastMouse = { x: x, y: y };
        this.guides = null;

        if (button === 2) {
            this.drag = { kind: "pan", sx: x, sy: y,
                          panX: this.panX, panY: this.panY };
            this.Canvas.Cursor = "Grabbing";
            return;
        }
        if (button === 3) {
            /* The context menu is the canvas's; what it acts on is what was
             * under the pointer, the way every other editor behaves. */
            const world = this.toWorld(x, y);
            const shape = this.doc.shapeAt(world.x, world.y);
            const edge = shape ? null
                : this.doc.edgeAt(world.x, world.y, EDGE_HIT / this.zoom);
            if (shape) this.select([shape.id]);
            else if (edge) this.select([edge.id]);
            this.Canvas.PopupMenu(x, y);
            return;
        }
        if (button !== 1) return;

        if (this.editing) this.commitEdit();

        const world = this.toWorld(x, y);

        if (this.tool === "connect") {
            const from = this.doc.shapeAt(world.x, world.y);
            if (from && this.canEditActiveLayer())
                this.drag = { kind: "connect", from: from.id,
                              at: world, target: null };
            return;
        }

        if (this.tool === "line" || this.tool === "arrow") {
            if (!this.canEditActiveLayer()) return;
            this.drag = { kind: "freeLine", tool: this.tool,
                          start: world, at: world };
            return;
        }

        if (this.tool !== "select") {
            if (!this.canEditActiveLayer()) return;
            this.drag = { kind: "create", tool: this.tool,
                          start: world, at: world };
            return;
        }

        const handle = this.handleAt(x, y);
        if (handle) {
            const shape = this.selectedShapes()[0];
            this.drag = {
                kind: "resize", dir: handle, id: shape.id,
                start: world,
                orig: { x: shape.x, y: shape.y, w: shape.w, h: shape.h },
                before: this.snapshot(),
            };
            return;
        }

        const shape = this.doc.shapeAt(world.x, world.y);
        if (shape) {
            if (shift) {
                this.toggleSelection(shape.id);
            } else if (this.sel.indexOf(shape.id) < 0) {
                this.select([shape.id]);
            }

            if (this.sel.indexOf(shape.id) >= 0) {
                const items = [];
                for (const s of this.selectedShapes())
                    items.push({ id: s.id, x: s.x, y: s.y });
                this.drag = { kind: "move", start: world,
                              before: this.snapshot(), items: items };
            }
            return;
        }

        const edge = this.doc.edgeAt(world.x, world.y, EDGE_HIT / this.zoom);
        if (edge) {
            if (shift) {
                this.toggleSelection(edge.id);
            } else {
                this.select([edge.id]);
                if (!edge.from && !edge.to) {
                    this.drag = {
                        kind: "moveLine", id: edge.id, start: world,
                        x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2,
                        before: this.snapshot(),
                    };
                }
            }
            return;
        }

        const base = shift ? this.sel.slice() : [];
        if (!shift) this.select([]);
        this.drag = { kind: "band", start: world, at: world, base: base };
    }

    Canvas_MouseMove(x, y, button, ctrl, shift) {
        this.lastMouse = { x: x, y: y };
        if (!this.drag) return;

        const world = this.toWorld(x, y);
        const d = this.drag;

        if (d.kind === "pan") {
            this.panX = d.panX + (x - d.sx);
            this.panY = d.panY + (y - d.sy);
            this.Canvas.Redraw();
            return;
        }

        if (d.kind === "move") {
            let dx = this.snap(world.x - d.start.x);
            let dy = this.snap(world.y - d.start.y);
            let lockX = false, lockY = false;
            if (shift) {
                if (Math.abs(dx) >= Math.abs(dy)) { dy = 0; lockY = true; }
                else { dx = 0; lockX = true; }
            }

            /* The grid gives the coarse position; a neighbour's edge or centre
             * gets the last few units, which is what makes boxes line up. */
            const moving = new Set();
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const item of d.items) {
                const shape = this.doc.shapeById(item.id);
                if (!shape) continue;
                moving.add(item.id);
                x0 = Math.min(x0, item.x);
                y0 = Math.min(y0, item.y);
                x1 = Math.max(x1, item.x + shape.w);
                y1 = Math.max(y1, item.y + shape.h);
            }

            if (moving.size) {
                const rect = { x: x0 + dx, y: y0 + dy, w: x1 - x0, h: y1 - y0 };
                const snap = this.guideMove(
                    rect, this.guideTargets(moving), 6 / this.zoom,
                    lockX, lockY);
                dx += snap.dx;
                dy += snap.dy;
                this.guides = snap.guides;
            }

            for (const item of d.items) {
                const shape = this.doc.shapeById(item.id);
                if (!shape) continue;
                shape.x = item.x + dx;
                shape.y = item.y + dy;
            }
            this.Canvas.Redraw();
            return;
        }

        if (d.kind === "resize") {
            this.resizeShape(d, world);
            this.Canvas.Redraw();
            return;
        }

        if (d.kind === "freeLine") {
            d.at = world;
            this.Canvas.Redraw();
            return;
        }

        if (d.kind === "moveLine") {
            let dx = this.snap(world.x - d.start.x);
            let dy = this.snap(world.y - d.start.y);
            if (shift) {
                if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
                else dx = 0;
            }
            const edge = this.doc.edgeById(d.id);
            if (edge) {
                edge.x1 = d.x1 + dx;
                edge.y1 = d.y1 + dy;
                edge.x2 = d.x2 + dx;
                edge.y2 = d.y2 + dy;
            }
            this.Canvas.Redraw();
            return;
        }

        if (d.kind === "create") {
            d.at = world;
            this.Canvas.Redraw();
            return;
        }

        if (d.kind === "connect") {
            d.at = world;
            const target = this.doc.shapeAt(world.x, world.y);
            d.target = target && target.id !== d.from ? target.id : null;
            this.Canvas.Redraw();
            return;
        }

        if (d.kind === "band") {
            d.at = world;
            this.Canvas.Redraw();
        }
    }

    Canvas_MouseUp(x, y, button, ctrl, shift) {
        if (!this.drag) return;
        const d = this.drag;
        this.drag = null;
        this.guides = null;

        if (d.kind === "pan") {
            this.Canvas.Cursor = this.tool === "select" ? "Arrow" : "Crosshair";
            return;
        }

        if (d.kind === "move" || d.kind === "resize" || d.kind === "moveLine") {
            const after = this.snapshot();
            if (d.before !== after)
                this.pushUndo(d.kind === "resize" ? Locale.Text("Resize")
                                                  : Locale.Text("Move"), d.before);
            this.refreshAll();
            return;
        }

        if (d.kind === "freeLine") {
            this.finishFreeLine(d, this.toWorld(x, y));
            return;
        }

        if (d.kind === "create") {
            this.finishCreate(d, this.toWorld(x, y));
            return;
        }

        if (d.kind === "connect") {
            this.finishConnect(d);
            return;
        }

        if (d.kind === "band") {
            d.at = this.toWorld(x, y);
            this.finishBand(d);
        }
    }

    Canvas_MouseCancel() {
        const d = this.drag;
        this.drag = null;
        this.guides = null;
        this.Canvas.Cursor = this.tool === "select" ? "Arrow" : "Crosshair";
        if (d && d.before) this.applySnapshot(d.before);
        else this.Canvas.Redraw();
    }

    Canvas_MouseLeave() {
        /* A drag has the pointer grabbed; leaving the widget is not the end of
         * it. Nothing to do, and deliberately so. */
    }

    Canvas_DblClick(x, y) {
        const world = this.toWorld(x, y);
        const shape = this.doc.shapeAt(world.x, world.y);
        if (shape) {
            this.select([shape.id]);
            this.beginEdit(shape);
            return;
        }
        const edge = this.doc.edgeAt(world.x, world.y, EDGE_HIT / this.zoom);
        if (edge) {
            this.select([edge.id]);
            this.beginEdit(edge);
        }
    }

    Canvas_MouseWheel(dx, dy) {
        this.panX -= (dx || 0) * 30;
        this.panY -= (dy || 0) * 30;
        this.Canvas.Redraw();
        return true;
    }

    openDropped(paths) {
        if (!paths || !paths.length) return;
        const file = paths[0];
        if (!File.Exists(file)) return;
        this.guard(() => this.openDocument(file));
    }

    Canvas_FileDrop(paths) { this.openDropped(paths); }

    Form_FileDrop(paths) { this.openDropped(paths); }

    resizeShape(d, world) {
        const shape = this.doc.shapeById(d.id);
        if (!shape) return;
        const o = d.orig;
        const dx = world.x - d.start.x;
        const dy = world.y - d.start.y;

        let x = o.x, y = o.y, w = o.w, h = o.h;

        if (d.dir.indexOf("e") >= 0)
            w = Math.max(MIN_SIZE, this.snap(o.x + o.w + dx) - x);
        if (d.dir.indexOf("s") >= 0)
            h = Math.max(MIN_SIZE, this.snap(o.y + o.h + dy) - y);
        if (d.dir.indexOf("w") >= 0) {
            x = Math.min(this.snap(o.x + dx), o.x + o.w - MIN_SIZE);
            w = o.x + o.w - x;
        }
        if (d.dir.indexOf("n") >= 0) {
            y = Math.min(this.snap(o.y + dy), o.y + o.h - MIN_SIZE);
            h = o.y + o.h - y;
        }

        const targets = this.guideTargets(new Set([shape.id]));
        const aligned = this.guideResize({ x: x, y: y, w: w, h: h }, d.dir,
                                          targets, 6 / this.zoom);
        shape.x = aligned.x;
        shape.y = aligned.y;
        shape.w = aligned.w;
        shape.h = aligned.h;
        this.guides = aligned.guides;
    }

    finishCreate(d, end) {
        if (!this.canEditActiveLayer()) return;
        const r = rectOf(d.start, end);
        const before = this.snapshot();
        let x, y, w, h;

        if (r.w < 12 || r.h < 12) {
            const size = this.defaultSize(d.tool);
            x = this.snap(d.start.x - size.w / 2);
            y = this.snap(d.start.y - size.h / 2);
            w = size.w;
            h = size.h;
        } else {
            x = this.snap(r.x);
            y = this.snap(r.y);
            w = Math.max(MIN_SIZE, this.snap(r.w));
            h = Math.max(MIN_SIZE, this.snap(r.h));
        }

        const options = this.shapeOptions(d.tool);
        options.layer = this.activeLayer;
        const shape = this.doc.addShape(d.tool, x, y, w, h, options);
        this.select([shape.id]);
        this.pushUndo(Locale.Text("Create shape"), before);
        this.chooseTool("select", this.BtnToolSelect);

        if (d.tool === "text") this.beginEdit(shape);
        this.refreshAll();
    }

    finishFreeLine(d, end) {
        if (!this.canEditActiveLayer()) return;
        const dx = end.x - d.start.x;
        const dy = end.y - d.start.y;
        if (Math.hypot(dx, dy) < 6) return;

        const before = this.snapshot();
        const edge = this.doc.addLine(d.start.x, d.start.y, end.x, end.y, {
            layer: this.activeLayer,
            arrowEnd: d.tool === "arrow",
            stroke: this.defaultStroke,
            strokeWidth: this.defaultStrokeWidth,
            dash: this.defaultDash,
            textColor: this.defaultTextColor,
            fontSize: this.defaultFontSize,
            textBold: this.defaultTextBold,
            textItalic: this.defaultTextItalic,
        });

        this.select([edge.id]);
        this.pushUndo(d.tool === "arrow" ? Locale.Text("Draw arrow")
                                         : Locale.Text("Draw line"), before);
        this.chooseTool("select", this.BtnToolSelect);
        this.refreshAll();
    }

    finishConnect(d) {
        if (!this.canEditActiveLayer()) return;
        if (!d.target || d.target === d.from) {
            this.statusText = Locale.Text("Drop the connector on another shape.");
            this.updateStatus();
            this.Canvas.Redraw();
            return;
        }

        const before = this.snapshot();
        const edge = this.doc.addEdge(d.from, d.target, {
            stroke: this.defaultStroke,
            layer: this.activeLayer,
            strokeWidth: this.defaultStrokeWidth,
            dash: this.defaultDash,
            textColor: this.defaultTextColor,
            fontSize: this.defaultFontSize,
            textBold: this.defaultTextBold,
            textItalic: this.defaultTextItalic,
        });
        if (!edge) return;

        this.select([edge.id]);
        this.pushUndo(Locale.Text("Connect shapes"), before);
        this.chooseTool("select", this.BtnToolSelect);
        this.setStatus(Locale.Text("Connector added."));
        this.refreshAll();
    }

    finishBand(d) {
        const band = rectOf(d.start, d.at);
        const ids = d.base.slice();
        for (const s of this.doc.shapes) {
            if (ids.indexOf(s.id) >= 0) continue;
            if (rectsIntersect(band, { x: s.x, y: s.y, w: s.w, h: s.h }))
                ids.push(s.id);
        }
        this.select(ids);
    }

    /* ---------------------------------------------------------------- text */

    beginEdit(object) {
        if (!object) return;
        if (this.editing) this.commitEdit();

        const isEdge = object.from !== undefined;
        let x, y, w, h;

        if (isEdge) {
            const points = edgeRoute(this.doc, object);
            const at = edgeMidpoint(points) || { x: 0, y: 0 };
            w = 200;
            h = 36;
            x = this.panX + at.x * this.zoom - w / 2;
            y = this.panY + at.y * this.zoom - h / 2;
            this.editing = { kind: "edge", id: object.id };
        } else {
            const box = shapeRectBounds(object);
            w = Math.max(140, box.w * this.zoom);
            h = 38;
            x = this.panX + (box.x + box.w / 2) * this.zoom - w / 2;
            y = this.panY + (box.y + box.h / 2) * this.zoom - h / 2;
            this.editing = { kind: "shape", id: object.id };
        }

        const size = clamp(Math.round((object.fontSize || 12) * this.zoom), 10, 38);
        this.TxtEdit.Font = "Sans " + size;
        this.TxtEdit.Text = object.text || "";
        this.TxtEdit.Move(Math.round(x), Math.round(y));
        this.TxtEdit.Resize(Math.round(w), Math.round(h));
        this.TxtEdit.Visible = true;
        this.TxtEdit.Raise();
        this.TxtEdit.SetFocus();
        this.TxtEdit.SelectAll();
    }

    commitEdit() {
        const editing = this.editing;
        if (!editing) return;

        const value = this.TxtEdit.Text;
        this.editing = null;
        this.TxtEdit.Visible = false;
        this.Canvas.SetFocus();

        const object = editing.kind === "shape"
            ? this.doc.shapeById(editing.id)
            : this.doc.edgeById(editing.id);
        if (!object) { this.Canvas.Redraw(); return; }

        /* A text shape with no text is an invisible rectangle: the text tool
         * would leave one behind every time somebody changed their mind. */
        if (editing.kind === "shape" && object.kind === "text" &&
            value.trim() === "") {
            const before = this.snapshot();
            this.doc.remove([object.id]);
            this.sel = [];
            this.pushUndo(Locale.Text("Delete"), before);
            this.refreshAll();
            return;
        }

        if (object.text === value) { this.refreshAll(); return; }

        const before = this.snapshot();
        object.text = value;
        this.pushUndo(Locale.Text("Edit text"), before);
        this.refreshAll();
    }

    cancelEdit() {
        if (!this.editing) return;
        this.editing = null;
        this.TxtEdit.Visible = false;
        this.Canvas.SetFocus();
        this.Canvas.Redraw();
    }

    TxtEdit_Activate() { this.commitEdit(); }

    TxtEdit_KeyPress(key) {
        if (key === "Escape") {
            this.cancelEdit();
            return true;
        }
        return false;
    }

    TxtEdit_LostFocus() { this.commitEdit(); }

    /* ------------------------------------------------------------ selection */

    deleteSelection() {
        if (!this.sel.length) return;
        const before = this.snapshot();
        this.doc.remove(this.sel);
        this.sel = [];
        this.pushUndo(Locale.Text("Delete"), before);
        this.refreshAll();
    }

    nudge(dx, dy) {
        const shapes = this.selectedShapes();
        const lines = this.selectedEdges()
            .filter((e) => !e.from && !e.to);
        if (!shapes.length && !lines.length) return;
        const before = this.snapshot();
        for (const s of shapes) { s.x += dx; s.y += dy; }
        for (const e of lines) {
            e.x1 += dx; e.y1 += dy;
            e.x2 += dx; e.y2 += dy;
        }
        this.pushUndo(Locale.Text("Move"), before);
        this.refreshAll();
    }

    selectionData() {
        const shapes = this.selectedShapes();
        const ids = new Set();
        for (const s of shapes) ids.add(s.id);

        const outShapes = [];
        for (const s of this.doc.shapes) {
            if (!ids.has(s.id)) continue;
            outShapes.push({
                id: s.id, kind: s.kind, group: s.group,
                x: s.x, y: s.y, w: s.w, h: s.h, rotation: s.rotation,
                text: s.text, fill: s.fill, stroke: s.stroke,
                strokeWidth: s.strokeWidth, dash: s.dash,
                textColor: s.textColor, fontSize: s.fontSize, radius: s.radius,
                textBold: s.textBold, textItalic: s.textItalic,
                textAlign: s.textAlign, textVAlign: s.textVAlign,
            });
        }

        const outEdges = [];
        for (const e of this.doc.edges) {
            const free = !e.from && !e.to;
            if (free) {
                if (this.sel.indexOf(e.id) < 0) continue;
            } else if (!ids.has(e.from) || !ids.has(e.to)) {
                continue;
            }
            if (!this.doc.canSelect(e)) continue;
            outEdges.push({
                id: e.id, from: e.from, to: e.to, text: e.text,
                x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2,
                arrowEnd: e.arrowEnd !== false,
                stroke: e.stroke, strokeWidth: e.strokeWidth,
                dash: e.dash, dashed: e.dashed, textColor: e.textColor,
                fontSize: e.fontSize, textBold: e.textBold,
                textItalic: e.textItalic,
            });
        }
        return { shapes: outShapes, edges: outEdges };
    }

    copySelection() {
        const data = this.selectionData();
        if (!data.shapes.length && !data.edges.length) return false;
        this.clipboard = JSON.stringify(data);
        this.refreshActions();
        this.setStatus(Locale.Text("Copied."));
        return true;
    }

    pasteData(data, dx, dy) {
        if (!data || (!data.shapes.length && !data.edges.length)) return;
        if (!this.canEditActiveLayer()) return;
        const before = this.snapshot();
        const renamed = new Map();
        const groups = new Map();
        const ids = [];

        for (const raw of data.shapes) {
            let group = "";
            if (raw.group) {
                if (!groups.has(raw.group))
                    groups.set(raw.group, this.doc.newGroup());
                group = groups.get(raw.group);
            }
            const shape = this.doc.addShape(
                raw.kind, raw.x + dx, raw.y + dy, raw.w, raw.h,
                { text: raw.text, fill: raw.fill, stroke: raw.stroke,
                  strokeWidth: raw.strokeWidth, dash: raw.dash,
                  textColor: raw.textColor, fontSize: raw.fontSize,
                  radius: raw.radius, textBold: raw.textBold,
                  textItalic: raw.textItalic, textAlign: raw.textAlign,
                  textVAlign: raw.textVAlign, group: group,
                  rotation: raw.rotation, layer: this.activeLayer });
            renamed.set(raw.id, shape.id);
            ids.push(shape.id);
        }

        for (const raw of data.edges || []) {
            let edge;
            if (!raw.from && !raw.to) {
                edge = this.doc.addLine(raw.x1 + dx, raw.y1 + dy,
                                        raw.x2 + dx, raw.y2 + dy,
                    { arrowEnd: raw.arrowEnd !== false,
                      text: raw.text, stroke: raw.stroke,
                      strokeWidth: raw.strokeWidth, dash: raw.dash,
                      textColor: raw.textColor, fontSize: raw.fontSize,
                      textBold: raw.textBold, textItalic: raw.textItalic,
                      layer: this.activeLayer });
            } else {
                const from = renamed.get(raw.from);
                const to = renamed.get(raw.to);
                if (!from || !to) continue;
                edge = this.doc.addEdge(from, to,
                    { text: raw.text, stroke: raw.stroke,
                      strokeWidth: raw.strokeWidth, dash: raw.dash,
                      dashed: raw.dashed, textColor: raw.textColor,
                      fontSize: raw.fontSize, textBold: raw.textBold,
                      textItalic: raw.textItalic, layer: this.activeLayer });
            }
            if (edge) ids.push(edge.id);
        }

        this.select(ids);
        this.pushUndo(Locale.Text("Paste"), before);
        this.refreshAll();
    }

    pasteSelection() {
        if (!this.clipboard) return;
        this.pasteData(JSON.parse(this.clipboard), PASTE_OFFSET, PASTE_OFFSET);
    }

    duplicateSelection() {
        const data = this.selectionData();
        if (!data.shapes.length && !data.edges.length) return;
        this.pasteData(data, PASTE_OFFSET, PASTE_OFFSET);
    }

    /* --------------------------------------------------------------- history */

    snapshot() {
        return JSON.stringify(this.book.toJSON());
    }

    applySnapshot(json) {
        this.cancelEdit();
        this.guides = null;
        const book = Document.fromJSON(JSON.parse(json));
        this.book = book;
        this.activePage = book.active;
        this.doc = book.pages[this.activePage];
        this.activeLayer = this.defaultActiveLayer(this.doc);
        this.sel = this.sel.filter((id) => this.doc.canSelect(id));
        this.refreshAll();
    }

    pushUndo(text, before) {
        const after = this.snapshot();
        if (before === after) return;
        this.undo.Add(text,
            () => this.applySnapshot(after),
            () => this.applySnapshot(before));
        this.refreshActions();
        this.refreshTitle();
    }

    /* ---------------------------------------------------------------- files */

    guard(action) {
        if (this.editing) this.commitEdit();
        if (!this.undo.Modified) { action(); return; }
        ConfirmForm.ask(
            Locale.Text("Unsaved changes"),
            Locale.Text("Save the diagram before continuing?"),
            Locale.Text("Save"),
            () => this.saveDocument(action),
            Locale.Text("Discard"),
            action);
    }

    resetDocument() {
        this.book = new Document();
        this.activePage = 0;
        this.doc = this.book.pages[0];
        this.path = "";
        this.importedFrom = "";
        this.activeLayer = this.defaultActiveLayer(this.doc);
        this.sel = [];
        this.guides = null;
        this.undo.Clear();
        this.zoom = 1;
        this.panX = 40;
        this.panY = 40;
        this.statusText = this.toolHint("select");
        this.refreshAll();
    }

    openDocument(path) {
        let book;
        let pages = 0;
        const isDrawio = File.IsExtension(path, "drawio") ||
                         File.IsExtension(path, "xml");

        try {
            if (isDrawio) {
                const imported = DrawioImport.parse(File.Load(path));
                book = Document.fromPages(imported.diagrams, imported.names, 0);
                pages = imported.pages;
            } else {
                book = Document.fromJSON(File.LoadJson(path));
            }
        } catch (e) {
            Message.Error(Locale.Text("Cannot open {0}: {1}"), path, e.message);
            return null;
        }

        this.book = book;
        this.activePage = book.active;
        this.doc = book.pages[this.activePage];
        this.activeLayer = this.defaultActiveLayer(this.doc);
        this.path = isDrawio ? "" : path;
        this.importedFrom = isDrawio ? path : "";
        this.sel = [];
        this.guides = null;
        this.undo.Clear();
        this.pendingFit = true;
        this.fitPending();

        if (isDrawio) {
            if (pages > 1)
                this.setStatus(Locale.Text("Imported {0} pages from {1}",
                                           pages, File.Name(path)));
            else
                this.setStatus(Locale.Text("Imported {0}", File.Name(path)));
        } else {
            this.setStatus(Locale.Text("Opened {0}", File.Name(path)));
        }
        this.refreshAll();
        return this.doc;
    }

    writeDocument(path) {
        if (this.editing) this.commitEdit();
        try {
            File.SaveJson(path, this.book.toJSON());
        } catch (e) {
            Message.Error(Locale.Text("Cannot save {0}: {1}"), path, e.message);
            return false;
        }
        this.path = path;
        this.importedFrom = "";
        this.undo.MarkClean();
        this.refreshActions();
        this.refreshTitle();
        this.setStatus(Locale.Text("Saved {0}", File.Name(path)));
        return true;
    }

    saveDocument(after) {
        if (this.editing) this.commitEdit();
        if (!this.path) { this.saveAs(after); return; }
        if (this.writeDocument(this.path) && after) after();
    }

    saveAs(after) {
        const source = this.path || this.importedFrom;
        const folder = source ? File.Directory(source) : Application.Directory;
        let name = "diagram.draw";
        if (this.path) name = File.Name(this.path);
        else if (this.importedFrom) name = File.BaseName(this.importedFrom) + ".draw";
        Dialog.SaveFile(Locale.Text("Save diagram"), {
            Folder: folder,
            Name: name,
            Filters: [[Locale.Text("Bintana Draw diagram"), "*.draw"],
                      [Locale.Text("All files"), "*"]],
        }, (chosen) => {
            let path = chosen;
            /* The document format is .draw, and only .draw: a Save As that
             * named the imported .drawio would overwrite it with JSON. */
            if (!File.IsExtension(path, "draw")) path += ".draw";
            if (this.writeDocument(path) && after) after();
        });
    }

    exportDiagram(kind) {
        if (this.editing) this.commitEdit();
        if (!this.doc.bounds()) {
            Message.Warning(Locale.Text("There is nothing visible to export."));
            return;
        }

        const base = this.path ? File.BaseName(this.path) : "diagram";
        const folder = this.path ? File.Directory(this.path) : Application.Directory;
        const title = kind === "png"
            ? Locale.Text("Export PNG")
            : Locale.Text("Export PDF");
        const filter = kind === "png"
            ? Locale.Text("PNG image")
            : Locale.Text("PDF document");

        Dialog.SaveFile(title, {
            Folder: folder,
            Name: base + "." + kind,
            Filters: [[filter, "*." + kind]],
        }, (chosen) => {
            let path = chosen;
            if (!File.IsExtension(path, kind)) path += "." + kind;
            this.exporting = true;
            let written = false;
            try {
                if (kind === "png") {
                    const size = this.exportSize();
                    this.Canvas.Save(path, size.w, size.h);
                } else {
                    this.Canvas.SavePdf(path, 842, 595);
                }
                written = true;
            } catch (e) {
                Message.Error(Locale.Text("Cannot export {0}: {1}"), path, e.message);
            } finally {
                this.exporting = false;
                this.Canvas.Redraw();
            }
            if (written)
                this.setStatus(Locale.Text("Exported {0}", File.Name(path)));
        });
    }

    exportSize() {
        const b = this.doc.bounds();
        const pad = 80;
        return {
            w: clamp(Math.ceil((b.w + pad) * 2), 320, 4096),
            h: clamp(Math.ceil((b.h + pad) * 2), 240, 4096),
        };
    }

    /* ----------------------------------------------------------------- view */

    zoomTo(value, cx, cy) {
        const before = this.toWorld(cx, cy);
        this.zoom = clamp(value, ZOOM_MIN, ZOOM_MAX);
        this.panX = cx - before.x * this.zoom;
        this.panY = cy - before.y * this.zoom;
        this.updateZoomLabel();
        this.Canvas.Redraw();
    }

    zoomBy(factor) {
        const box = this.viewport();
        this.zoomTo(this.zoom * factor, box.w / 2, box.h / 2);
    }

    zoomFit() {
        const box = this.viewport();
        const width = box.w;
        const height = box.h;
        const content = this.doc.bounds();

        if (!content) {
            this.zoom = 1;
            this.panX = 40;
            this.panY = 40;
        } else {
            const pad = 70;
            const z = Math.min((width - pad * 2) / Math.max(1, content.w),
                               (height - pad * 2) / Math.max(1, content.h));
            this.zoom = clamp(z, ZOOM_MIN, 2);
            this.panX = (width - content.w * this.zoom) / 2 - content.x * this.zoom;
            this.panY = (height - content.h * this.zoom) / 2 - content.y * this.zoom;
        }
        this.updateZoomLabel();
        this.Canvas.Redraw();
    }

    updateZoomLabel() {
        if (this.LblZoom)
            this.LblZoom.Text = Math.round(this.zoom * 100) + "%";
    }

    /* -------------------------------------------------------------- the rest */

    refreshAll() {
        this.ensureActiveLayer();
        this.pruneSelection();
        this.refreshLayers();
        this.refreshPages();
        this.refreshTitle();
        this.refreshActions();
        this.syncColors();
        this.syncFormatControls();
        this.updateStatus();
        this.updateZoomLabel();
        if (this.Canvas) this.Canvas.Redraw();
    }

    refreshTitle() {
        if (!this.undo) return;
        const name = this.path ? File.Name(this.path)
                   : this.importedFrom
                       ? Locale.Text("Imported {0}", File.Name(this.importedFrom))
                       : Locale.Text("Untitled");
        const mark = this.undo.Modified ? "• " : "";
        const page = this.book && this.book.pages.length > 1
            ? " · " + this.book.pageName(this.activePage) : "";
        this.Text = mark + name + page + " — " + Locale.Text("Bintana Draw");
    }

    refreshActions() {
        if (!this.undo) return;
        const selected = this.sel.length > 0;
        const shapeCount = this.selectedShapes().length;
        const canAlign = shapeCount >= 2;
        const canDistribute = shapeCount >= 3;

        this.ActUndo.Enabled      = this.undo.CanUndo;
        this.ActRedo.Enabled      = this.undo.CanRedo;
        this.ActCut.Enabled       = selected;
        this.ActCopy.Enabled      = selected;
        this.ActDelete.Enabled    = selected;
        this.ActDuplicate.Enabled = selected;
        this.ActPaste.Enabled     = !!this.clipboard;

        this.ActAlignLeft.Enabled   = canAlign;
        this.ActAlignCenter.Enabled = canAlign;
        this.ActAlignRight.Enabled  = canAlign;
        this.ActAlignTop.Enabled    = canAlign;
        this.ActAlignMiddle.Enabled = canAlign;
        this.ActAlignBottom.Enabled = canAlign;
        this.ActDistributeHorizontal.Enabled = canDistribute;
        this.ActDistributeVertical.Enabled   = canDistribute;

        this.ActGroup.Enabled         = shapeCount >= 2;
        this.ActUngroup.Enabled       = this.selectedShapes()
                                            .some((s) => s.group);
        this.ActBringFront.Enabled    = shapeCount > 0;
        this.ActSendBack.Enabled      = shapeCount > 0;
        this.ActBringForward.Enabled  = shapeCount > 0;
        this.ActSendBackward.Enabled  = shapeCount > 0;
    }

    syncColors() {
        if (!this.doc) return;
        const shapes = this.selectedShapes();
        const edges = this.selectedEdges();
        const fill = shapes.length ? shapes[0].fill : this.defaultFill;
        const line = shapes.length ? shapes[0].stroke
                   : (edges.length ? edges[0].stroke : this.defaultStroke);

        this.syncingColors = true;
        this.BtnFill.Value = colorButtonValue(fill);
        this.BtnLine.Value = colorButtonValue(line);
        this.syncingColors = false;
    }

    syncFormatControls() {
        if (!this.SpnStrokeWidth) return;

        const shapes = this.selectedShapes();
        const edges = this.selectedEdges();
        const object = shapes.length ? shapes[0] : (edges.length ? edges[0] : null);
        const edge = !!object && object.from !== undefined;

        const width = object
            ? (object.strokeWidth || (edge ? 2 : 1.5))
            : this.defaultStrokeWidth;
        const dash = object
            ? (object.dash || (object.dashed ? "dash" : "solid"))
            : this.defaultDash;
        const size = object
            ? (object.fontSize || (edge ? 11 : 12))
            : this.defaultFontSize;
        const bold = object ? object.textBold === true : this.defaultTextBold;
        const italic = object ? object.textItalic === true : this.defaultTextItalic;
        const align = edge ? this.defaultTextAlign
            : (object && object.textAlign ? object.textAlign : this.defaultTextAlign);
        const vAlign = edge ? this.defaultTextVAlign
            : (object && object.textVAlign
                ? object.textVAlign : this.defaultTextVAlign);
        const color = object
            ? (object.textColor || (edge ? (object.stroke || this.defaultTextColor)
                                         : this.defaultTextColor))
            : this.defaultTextColor;

        this.syncingFormat = true;
        this.SpnStrokeWidth.Value = Math.max(1, Math.round(width));
        this.CmbDash.Index = dash === "dot" ? 2 : (dash === "dash" ? 1 : 0);
        this.SpnFont.Value = Math.max(6, Math.round(size));
        this.BtnBold.Active = bold;
        this.BtnItalic.Active = italic;
        this.BtnAlignLeft.Active = align === "left";
        this.BtnAlignCenter.Active = align === "center" || align === "";
        this.BtnAlignRight.Active = align === "right";
        this.CmbVAlign.Index = vAlign === "top" ? 0 : (vAlign === "bottom" ? 2 : 1);
        this.SpnRotation.Value = object && object.from === undefined
            ? Math.round(object.rotation || 0) : this.defaultRotation;
        this.BtnTextColor.Value = colorButtonValue(color);
        this.syncingFormat = false;
    }

    applyFormat(text, apply) {
        const before = this.snapshot();
        for (const s of this.selectedShapes()) apply(s);
        for (const e of this.selectedEdges()) apply(e);
        this.pushUndo(text, before);
        this.refreshAll();
    }

    SpnStrokeWidth_Change() {
        if (this.syncingFormat) return;
        const value = Math.max(1, Math.round(this.SpnStrokeWidth.Value));
        this.defaultStrokeWidth = value;
        this.applyFormat(Locale.Text("Line width"), (o) => { o.strokeWidth = value; });
    }

    CmbDash_Select() {
        if (this.syncingFormat) return;
        const value = this.CmbDash.Index === 2 ? "dot"
                    : (this.CmbDash.Index === 1 ? "dash" : "solid");
        this.defaultDash = value;
        this.applyFormat(Locale.Text("Line style"), (o) => {
            o.dash = value;
            if (o.from !== undefined) o.dashed = value !== "solid";
        });
    }

    SpnFont_Change() {
        if (this.syncingFormat) return;
        const value = Math.max(6, Math.round(this.SpnFont.Value));
        this.defaultFontSize = value;
        this.applyFormat(Locale.Text("Font size"), (o) => { o.fontSize = value; });
    }

    BtnBold_Click() {
        if (this.syncingFormat) return;
        const value = this.BtnBold.Active;
        this.defaultTextBold = value;
        this.applyFormat(Locale.Text("Bold"), (o) => { o.textBold = value; });
    }

    BtnItalic_Click() {
        if (this.syncingFormat) return;
        const value = this.BtnItalic.Active;
        this.defaultTextItalic = value;
        this.applyFormat(Locale.Text("Italic"), (o) => { o.textItalic = value; });
    }

    setTextAlign(value, button) {
        if (this.syncingFormat) return;
        this.syncingFormat = true;
        for (const b of [this.BtnAlignLeft, this.BtnAlignCenter,
                         this.BtnAlignRight]) b.Active = (b === button);
        this.syncingFormat = false;
        this.defaultTextAlign = value;
        this.applyFormat(Locale.Text("Align text"), (o) => {
            if (o.from === undefined) o.textAlign = value;
        });
    }

    BtnAlignLeft_Click()   { this.setTextAlign("left", this.BtnAlignLeft); }
    BtnAlignCenter_Click() { this.setTextAlign("center", this.BtnAlignCenter); }
    BtnAlignRight_Click()  { this.setTextAlign("right", this.BtnAlignRight); }

    CmbVAlign_Select() {
        if (this.syncingFormat) return;
        const value = this.CmbVAlign.Index === 0 ? "top"
                    : (this.CmbVAlign.Index === 2 ? "bottom" : "middle");
        this.defaultTextVAlign = value;
        this.applyFormat(Locale.Text("Vertical align"), (o) => {
            if (o.from === undefined) o.textVAlign = value;
        });
    }

    SpnRotation_Change() {
        if (this.syncingFormat) return;
        const value = Math.round(this.SpnRotation.Value);
        this.defaultRotation = value;
        this.applyFormat(Locale.Text("Rotate"), (o) => {
            if (o.from === undefined) o.rotation = value;
        });
    }

    BtnTextColor_Change() {
        if (this.syncingFormat) return;
        const value = this.BtnTextColor.Value;
        this.defaultTextColor = value;
        this.applyFormat(Locale.Text("Text color"), (o) => { o.textColor = value; });
    }

    updateStatus() {
        if (!this.doc || !this.LblStatus) return;

        if (this.sel.length) {
            const n = this.sel.length;
            this.LblStatus.Text = Locale.Plural(
                "{0} item selected", "{0} items selected", n, n);
        } else {
            this.LblStatus.Text = this.statusText || this.toolHint(this.tool);
        }

        const shapes = this.doc.shapes.length;
        this.LblCount.Text = Locale.Plural(
            "{0} shape", "{0} shapes", shapes, shapes);
    }

    setStatus(text) {
        this.statusText = text;
        this.updateStatus();
    }

    /* ------------------------------------------------------------- pages */

    refreshPages() {
        if (!this.CmbPage) return;
        this.syncingPages = true;

        let sameRows = this.CmbPage.Count === this.book.pages.length;
        if (sameRows) {
            for (let i = 0; i < this.book.pages.length; i++) {
                if (this.CmbPage.KeyAt(i) !== String(i)) { sameRows = false; break; }
            }
        }
        if (sameRows) {
            for (let i = 0; i < this.book.pages.length; i++)
                this.CmbPage.SetText(i, this.book.pageName(i));
        } else {
            this.CmbPage.Clear();
            for (let i = 0; i < this.book.pages.length; i++)
                this.CmbPage.Add(this.book.pageName(i), String(i));
        }
        this.CmbPage.Index = this.activePage;
        this.TxtPageName.Text = this.book.pageName(this.activePage);
        this.BtnPageRemove.Enabled = this.book.pages.length > 1;
        this.BtnPageUp.Enabled = this.activePage > 0;
        this.BtnPageDown.Enabled = this.activePage < this.book.pages.length - 1;
        this.syncingPages = false;
    }

    switchPage(index) {
        if (index < 0 || index >= this.book.pages.length) return;
        if (index === this.activePage) return;
        if (this.editing) this.commitEdit();

        this.activePage = index;
        this.book.active = index;
        this.doc = this.book.pages[index];
        this.activeLayer = this.defaultActiveLayer(this.doc);
        this.sel = [];
        this.guides = null;
        this.refreshAll();
        this.zoomFit();
    }

    CmbPage_Select() {
        if (this.syncingPages) return;
        this.switchPage(this.CmbPage.Index);
    }

    BtnPageAdd_Click() {
        if (this.editing) this.commitEdit();
        const before = this.snapshot();
        const page = this.book.addPage();
        this.activePage = this.book.pages.length - 1;
        this.book.active = this.activePage;
        this.doc = page;
        this.activeLayer = this.defaultActiveLayer(this.doc);
        this.sel = [];
        this.guides = null;
        this.pushUndo(Locale.Text("Add page"), before);
        this.refreshAll();
        this.zoomFit();
        this.TxtPageName.SetFocus();
        this.TxtPageName.SelectAll();
    }

    BtnPageRemove_Click() {
        if (this.book.pages.length < 2) return;
        if (this.editing) this.commitEdit();
        const before = this.snapshot();
        this.book.removePage(this.activePage);
        this.activePage = this.book.active;
        this.doc = this.book.pages[this.activePage];
        this.activeLayer = this.defaultActiveLayer(this.doc);
        this.sel = [];
        this.guides = null;
        this.pushUndo(Locale.Text("Delete page"), before);
        this.refreshAll();
        this.zoomFit();
    }

    BtnPageUp_Click()   { this.moveActivePage(-1); }
    BtnPageDown_Click() { this.moveActivePage(1); }

    moveActivePage(delta) {
        if (this.editing) this.commitEdit();
        const before = this.snapshot();
        if (!this.book.movePage(this.activePage, delta)) return;
        this.activePage = this.book.active;
        this.doc = this.book.pages[this.activePage];
        this.pushUndo(Locale.Text("Move page"), before);
        this.refreshAll();
    }

    renameActivePage() {
        if (this.syncingPages) return;
        const name = this.TxtPageName.Text.trim();
        const current = this.book.pageName(this.activePage);
        if (!name) {
            this.TxtPageName.Text = current;
            return;
        }
        if (name === current) return;

        const before = this.snapshot();
        this.book.setPageName(this.activePage, name);
        this.pushUndo(Locale.Text("Rename page"), before);
        this.refreshAll();
    }

    TxtPageName_Activate() { this.renameActivePage(); }

    TxtPageName_LostFocus() { this.renameActivePage(); }

    /* ------------------------------------------------------------ layer verbs */

    LstLayers_Select() {
        if (this.syncingLayers) return;
        const id = this.LstLayers.Key;
        if (!id || !this.doc.layerById(id)) return;
        this.activeLayer = id;
        this.refreshLayerControls();
        this.refreshActions();
        this.Canvas.Redraw();
    }

    LstLayers_Activate() {
        this.TxtLayerName.SetFocus();
        this.TxtLayerName.SelectAll();
    }

    BtnLayerAdd_Click() {
        const before = this.snapshot();
        const layer = this.doc.addLayer();
        this.activeLayer = layer.id;
        this.pushUndo(Locale.Text("Add layer"), before);
        this.refreshAll();
        this.TxtLayerName.SetFocus();
        this.TxtLayerName.SelectAll();
    }

    BtnLayerRemove_Click() {
        if (this.doc.layers.length < 2) return;
        const before = this.snapshot();
        this.doc.removeLayer(this.activeLayer);
        this.activeLayer = this.defaultActiveLayer(this.doc);
        this.pushUndo(Locale.Text("Delete layer"), before);
        this.refreshAll();
    }

    BtnLayerUp_Click()   { this.moveActiveLayer(1); }
    BtnLayerDown_Click() { this.moveActiveLayer(-1); }

    moveActiveLayer(delta) {
        const before = this.snapshot();
        if (!this.doc.moveLayer(this.activeLayer, delta)) return;
        this.pushUndo(Locale.Text("Move layer"), before);
        this.refreshAll();
    }

    BtnLayerVisible_Click() {
        if (this.syncingLayers) return;
        const layer = this.activeLayerObject();
        if (!layer) return;
        const before = this.snapshot();
        layer.visible = this.BtnLayerVisible.Active;
        this.pruneSelection();
        this.pushUndo(Locale.Text("Layer visibility"), before);
        this.refreshAll();
    }

    BtnLayerLocked_Click() {
        if (this.syncingLayers) return;
        const layer = this.activeLayerObject();
        if (!layer) return;
        const before = this.snapshot();
        layer.locked = this.BtnLayerLocked.Active;
        this.pruneSelection();
        this.pushUndo(Locale.Text("Layer lock"), before);
        this.refreshAll();
    }

    renameActiveLayer() {
        if (this.syncingLayers) return;
        const layer = this.activeLayerObject();
        if (!layer) return;
        const name = this.TxtLayerName.Text.trim();
        if (!name) {
            this.TxtLayerName.Text = layer.name;
            return;
        }
        if (name === layer.name) return;
        const before = this.snapshot();
        layer.name = name;
        this.pushUndo(Locale.Text("Rename layer"), before);
        this.refreshAll();
    }

    TxtLayerName_Activate() { this.renameActiveLayer(); }

    TxtLayerName_LostFocus() { this.renameActiveLayer(); }

    BtnLayerAssign_Click() {
        const layer = this.activeLayerObject();
        if (!layer || !layer.visible || layer.locked) return;

        const shapes = this.selectedShapes();
        const edges = this.selectedEdges();
        if (!shapes.length && !edges.length) return;

        const before = this.snapshot();
        const selected = new Set();
        for (const s of shapes) { selected.add(s.id); s.layer = layer.id; }
        for (const e of edges) e.layer = layer.id;
        for (const e of this.doc.edges) {
            if (!selected.has(e.from) || !selected.has(e.to)) continue;
            if (!this.doc.canSelect(e)) continue;
            e.layer = layer.id;
        }

        this.pushUndo(Locale.Text("Move to layer"), before);
        this.refreshAll();
    }

    /* --------------------------------------------------------------- actions */

    ActNew_Execute() { this.guard(() => this.resetDocument()); }

    ActOpen_Execute() {
        this.guard(() => {
            const folder = this.path ? File.Directory(this.path)
                                     : Application.Directory;
            Dialog.OpenFile(Locale.Text("Open diagram"), {
                Folder: folder,
                Filters: [[Locale.Text("Bintana Draw diagram"), "*.draw"],
                          [Locale.Text("draw.io diagram"), "*.drawio"],
                          [Locale.Text("XML file"), "*.xml"],
                          [Locale.Text("All files"), "*"]],
            }, (path) => this.openDocument(path));
        });
    }

    ActSave_Execute() { this.saveDocument(); }

    ActSaveAs_Execute() { this.saveAs(); }

    ActExportPng_Execute() { this.exportDiagram("png"); }

    ActExportPdf_Execute() { this.exportDiagram("pdf"); }

    ActQuit_Execute() { this.Close(); }

    /* While the little editor is open, these keys belong to the text field:
     * Ctrl+A selects its text, Delete deletes a character. The window's
     * accelerators must not take them to the diagram. */
    editingOwnsKeys() {
        return this.editing !== null;
    }

    ActUndo_Execute() {
        if (this.editingOwnsKeys()) return;
        this.undo.Undo();
    }

    ActRedo_Execute() {
        if (this.editingOwnsKeys()) return;
        this.undo.Redo();
    }

    ActCut_Execute() {
        if (this.editingOwnsKeys()) return;
        this.copySelection();
        this.deleteSelection();
    }

    ActCopy_Execute() {
        if (this.editingOwnsKeys()) return;
        this.copySelection();
    }

    ActPaste_Execute() {
        if (this.editingOwnsKeys()) return;
        this.pasteSelection();
    }

    ActDuplicate_Execute() {
        if (this.editingOwnsKeys()) return;
        this.duplicateSelection();
    }

    ActDelete_Execute() {
        if (this.editingOwnsKeys()) return;
        this.deleteSelection();
    }

    ActSelectAll_Execute() {
        if (this.editingOwnsKeys()) return;
        const ids = [];
        for (const s of this.doc.shapes)
            if (this.doc.canSelect(s)) ids.push(s.id);
        for (const e of this.doc.edges)
            if (this.doc.canSelect(e)) ids.push(e.id);
        this.select(ids);
    }

    alignSelection(mode) {
        const shapes = this.selectedShapes();
        if (shapes.length < 2) return;
        const bounds = this.shapesBounds(shapes);
        const before = this.snapshot();

        for (const s of shapes) {
            if (mode === "left")
                s.x = bounds.x;
            else if (mode === "center")
                s.x = bounds.x + bounds.w / 2 - s.w / 2;
            else if (mode === "right")
                s.x = bounds.x + bounds.w - s.w;
            else if (mode === "top")
                s.y = bounds.y;
            else if (mode === "middle")
                s.y = bounds.y + bounds.h / 2 - s.h / 2;
            else if (mode === "bottom")
                s.y = bounds.y + bounds.h - s.h;
        }

        this.pushUndo(Locale.Text("Align"), before);
        this.refreshAll();
    }

    distributeSelection(axis) {
        const shapes = this.selectedShapes();
        if (shapes.length < 3) return;

        const sorted = shapes.slice().sort((a, b) => {
            return axis === "horizontal"
                ? (a.x + a.w / 2) - (b.x + b.w / 2)
                : (a.y + a.h / 2) - (b.y + b.h / 2);
        });

        const first = axis === "horizontal"
            ? sorted[0].x + sorted[0].w / 2
            : sorted[0].y + sorted[0].h / 2;
        const last = axis === "horizontal"
            ? sorted[sorted.length - 1].x + sorted[sorted.length - 1].w / 2
            : sorted[sorted.length - 1].y + sorted[sorted.length - 1].h / 2;
        const step = (last - first) / (sorted.length - 1);

        const before = this.snapshot();
        for (let i = 1; i < sorted.length - 1; i++) {
            const s = sorted[i];
            if (axis === "horizontal")
                s.x = first + step * i - s.w / 2;
            else
                s.y = first + step * i - s.h / 2;
        }

        this.pushUndo(Locale.Text("Distribute"), before);
        this.refreshAll();
    }

    ActGroup_Execute() {
        const shapes = this.selectedShapes();
        if (shapes.length < 2) return;
        const before = this.snapshot();
        const group = this.doc.newGroup();
        for (const shape of shapes) shape.group = group;
        this.pushUndo(Locale.Text("Group"), before);
        this.refreshAll();
    }

    ActUngroup_Execute() {
        const shapes = this.selectedShapes();
        if (!shapes.some((s) => s.group)) return;
        const before = this.snapshot();
        for (const shape of shapes) shape.group = "";
        this.pushUndo(Locale.Text("Ungroup"), before);
        this.refreshAll();
    }

    zOrder(mode) {
        const shapes = this.selectedShapes();
        if (!shapes.length) return;

        const before = this.snapshot();
        const selected = new Set();
        for (const s of shapes) selected.add(s.id);

        if (mode === "front" || mode === "back") {
            const chosen = this.doc.shapes.filter((s) => selected.has(s.id));
            const rest = this.doc.shapes.filter((s) => !selected.has(s.id));
            this.doc.shapes = mode === "front" ? rest.concat(chosen)
                                               : chosen.concat(rest);
        } else {
            const ordered = shapes.slice().sort((a, b) =>
                this.doc.shapes.indexOf(a) - this.doc.shapes.indexOf(b));
            if (mode === "forward") ordered.reverse();

            for (const shape of ordered) {
                let at = this.doc.shapes.indexOf(shape);
                if (at < 0) continue;
                let to = at + (mode === "forward" ? 1 : -1);
                while (to >= 0 && to < this.doc.shapes.length) {
                    if (this.doc.shapes[to].layer === shape.layer) {
                        const other = this.doc.shapes[to];
                        this.doc.shapes[to] = shape;
                        this.doc.shapes[at] = other;
                        break;
                    }
                    to += mode === "forward" ? 1 : -1;
                }
            }
        }

        let step = Locale.Text("Bring to front");
        if (mode === "back") step = Locale.Text("Send to back");
        else if (mode === "forward") step = Locale.Text("Bring forward");
        else if (mode === "backward") step = Locale.Text("Send backward");

        this.pushUndo(step, before);
        this.refreshAll();
    }

    ActBringFront_Execute()   { this.zOrder("front"); }
    ActSendBack_Execute()     { this.zOrder("back"); }
    ActBringForward_Execute() { this.zOrder("forward"); }
    ActSendBackward_Execute() { this.zOrder("backward"); }

    ActAlignLeft_Execute()   { this.alignSelection("left"); }
    ActAlignCenter_Execute() { this.alignSelection("center"); }
    ActAlignRight_Execute()  { this.alignSelection("right"); }
    ActAlignTop_Execute()    { this.alignSelection("top"); }
    ActAlignMiddle_Execute() { this.alignSelection("middle"); }
    ActAlignBottom_Execute() { this.alignSelection("bottom"); }

    ActDistributeHorizontal_Execute() { this.distributeSelection("horizontal"); }
    ActDistributeVertical_Execute()   { this.distributeSelection("vertical"); }

    ActZoomIn_Execute() { this.zoomBy(1.2); }

    ActZoomOut_Execute() { this.zoomBy(1 / 1.2); }

    ActZoomReset_Execute() {
        const box = this.viewport();
        this.zoomTo(1, box.w / 2, box.h / 2);
    }

    ActZoomFit_Execute() { this.zoomFit(); }

    MnuGrid_Click() {
        if (this.syncingGrid) return;
        this.grid = this.MnuGrid.Value;
        this.Canvas.Redraw();
    }

    MnuShortcuts_Click() {
        Message.Info(Locale.Text("Ctrl+N  New\nCtrl+O  Open\nCtrl+S  Save\nCtrl+Shift+S  Save As\nCtrl+Z  Undo\nCtrl+Shift+Z  Redo\nCtrl+X  Cut\nCtrl+C  Copy\nCtrl+V  Paste\nCtrl+D  Duplicate\nCtrl+A  Select All\nDelete  Delete\nArrows  Move the selection\nShift+Arrows  Move one unit\n+ / −  Zoom\n0  Actual size\nMiddle drag  Pan\nWheel  Scroll\nDouble-click  Edit text"));
    }

    MnuAbout_Click() {
        Message.Info(Locale.Text("Bintana Draw {0}"), Application.Version);
    }

    /* ---------------------------------------------------------------- colours */

    BtnFill_Change() {
        if (this.syncingColors || !this.doc) return;
        const value = this.BtnFill.Value;
        this.defaultFill = value;
        const shapes = this.selectedShapes();
        if (!shapes.length) return;

        const before = this.snapshot();
        for (const s of shapes) {
            if (s.kind !== "text") s.fill = value;
        }
        this.pushUndo(Locale.Text("Fill color"), before);
        this.refreshAll();
    }

    BtnLine_Change() {
        if (this.syncingColors || !this.doc) return;
        const value = this.BtnLine.Value;
        this.defaultStroke = value;
        const shapes = this.selectedShapes();
        const edges = this.selectedEdges();
        if (!shapes.length && !edges.length) return;

        const before = this.snapshot();
        for (const s of shapes) s.stroke = value;
        for (const e of edges) e.stroke = value;
        this.pushUndo(Locale.Text("Line color"), before);
        this.refreshAll();
    }

    /* -------------------------------------------------------------- keyboard */

    Form_KeyPress(key, ctrl, shift) {
        if (this.editing) return false;

        if (key === "Escape") {
            if (this.drag) {
                const drag = this.drag;
                this.drag = null;
                this.guides = null;
                this.Canvas.Cursor = this.tool === "select" ? "Arrow" : "Crosshair";
                if (drag.before) this.applySnapshot(drag.before);
                else this.Canvas.Redraw();
            } else {
                this.select([]);
            }
            return true;
        }

        if (ctrl) return false;

        if (key === "Left")  { this.nudge(shift ? -1 : -10, 0); return true; }
        if (key === "Right") { this.nudge(shift ? 1 : 10, 0); return true; }
        if (key === "Up")    { this.nudge(0, shift ? -1 : -10); return true; }
        if (key === "Down")  { this.nudge(0, shift ? 1 : 10); return true; }

        if (key === "plus" || key === "equal") { this.zoomBy(1.2); return true; }
        if (key === "minus") { this.zoomBy(1 / 1.2); return true; }
        if (key === "0") { this.ActZoomReset_Execute(); return true; }
        if (key === "BackSpace") { this.deleteSelection(); return true; }

        return false;
    }
}
