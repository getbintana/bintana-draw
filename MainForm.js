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

    doc    = null;
    path   = "";
    sel    = [];
    tool   = "select";
    zoom   = 1;
    panX   = 40;
    panY   = 40;
    grid   = true;
    drag   = null;
    editing = null;

    undo   = null;
    clipboard = null;

    defaultFill   = DEFAULT_FILL_COLOR;
    defaultStroke = DEFAULT_STROKE_COLOR;

    statusText = "";
    syncingColors = false;
    syncingGrid   = false;
    syncingTools  = false;
    exporting     = false;
    forceClose    = false;
    pendingFit    = false;
    lastMouse     = { x: 0, y: 0 };

    /* ------------------------------------------------------------- the form */

    Form_Open() {
        this.doc  = new Diagram();
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
            if (this.pendingFit) { this.pendingFit = false; this.zoomFit(); }
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
        if (this.pendingFit) {
            this.pendingFit = false;
            this.zoomFit();
        }
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
            band: band,
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

    toolHint(tool) {
        switch (tool) {
        case "select":     return Locale.Text("Select and drag. Double-click to edit text.");
        case "connect":    return Locale.Text("Drag from one shape to another to connect them.");
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

    select(ids) {
        this.sel = ids.slice();
        this.syncColors();
        this.updateStatus();
        this.refreshActions();
        if (this.Canvas) this.Canvas.Redraw();
    }

    toggleSelection(id) {
        const at = this.sel.indexOf(id);
        if (at >= 0) this.sel.splice(at, 1);
        else this.sel.push(id);
        this.syncColors();
        this.updateStatus();
        this.refreshActions();
        if (this.Canvas) this.Canvas.Redraw();
    }

    handleAt(x, y) {
        const shapes = this.selectedShapes();
        if (shapes.length !== 1 || this.sel.length !== 1) return "";
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
        if (kind === "note")
            return { fill: "#fff2cc", stroke: "#d6b656", text: "" };
        if (kind === "text")
            return { fill: "rgba(0,0,0,0)", stroke: "rgba(0,0,0,0)",
                     textColor: "#1f2937" };
        return { fill: this.defaultFill, stroke: this.defaultStroke };
    }

    /* ------------------------------------------------------------- pointers */

    Canvas_MouseDown(x, y, button, ctrl, shift) {
        this.Canvas.SetFocus();
        this.lastMouse = { x: x, y: y };

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
            if (from)
                this.drag = { kind: "connect", from: from.id,
                              at: world, target: null };
            return;
        }

        if (this.tool !== "select") {
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
            if (shift) this.toggleSelection(edge.id);
            else this.select([edge.id]);
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
            if (shift) {
                if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
                else dx = 0;
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

        if (d.kind === "pan") {
            this.Canvas.Cursor = this.tool === "select" ? "Arrow" : "Crosshair";
            return;
        }

        if (d.kind === "move" || d.kind === "resize") {
            const after = this.snapshot();
            if (d.before !== after)
                this.pushUndo(d.kind === "resize" ? Locale.Text("Resize")
                                                  : Locale.Text("Move"), d.before);
            this.refreshAll();
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

        shape.x = x; shape.y = y; shape.w = w; shape.h = h;
    }

    finishCreate(d, end) {
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

        const shape = this.doc.addShape(d.tool, x, y, w, h,
                                        this.shapeOptions(d.tool));
        this.select([shape.id]);
        this.pushUndo(Locale.Text("Create shape"), before);
        this.chooseTool("select", this.BtnToolSelect);

        if (d.tool === "text") this.beginEdit(shape);
        this.refreshAll();
    }

    finishConnect(d) {
        if (!d.target || d.target === d.from) {
            this.statusText = Locale.Text("Drop the connector on another shape.");
            this.updateStatus();
            this.Canvas.Redraw();
            return;
        }

        const before = this.snapshot();
        const edge = this.doc.addEdge(d.from, d.target,
                                      { stroke: this.defaultStroke });
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
            w = Math.max(140, object.w * this.zoom);
            h = 38;
            x = this.panX + object.x * this.zoom;
            y = this.panY + (object.y + object.h / 2) * this.zoom - h / 2;
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
        if (!shapes.length) return;
        const before = this.snapshot();
        for (const s of shapes) { s.x += dx; s.y += dy; }
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
                id: s.id, kind: s.kind, x: s.x, y: s.y, w: s.w, h: s.h,
                text: s.text, fill: s.fill, stroke: s.stroke,
                textColor: s.textColor, fontSize: s.fontSize, radius: s.radius,
            });
        }

        const outEdges = [];
        for (const e of this.doc.edges) {
            if (!ids.has(e.from) || !ids.has(e.to)) continue;
            outEdges.push({
                id: e.id, from: e.from, to: e.to, text: e.text,
                stroke: e.stroke, dashed: e.dashed, fontSize: e.fontSize,
            });
        }
        return { shapes: outShapes, edges: outEdges };
    }

    copySelection() {
        const data = this.selectionData();
        if (!data.shapes.length) return false;
        this.clipboard = JSON.stringify(data);
        this.refreshActions();
        this.setStatus(Locale.Text("Copied."));
        return true;
    }

    pasteData(data, dx, dy) {
        if (!data || !data.shapes || !data.shapes.length) return;
        const before = this.snapshot();
        const renamed = new Map();
        const ids = [];

        for (const raw of data.shapes) {
            const shape = this.doc.addShape(
                raw.kind, raw.x + dx, raw.y + dy, raw.w, raw.h,
                { text: raw.text, fill: raw.fill, stroke: raw.stroke,
                  textColor: raw.textColor, fontSize: raw.fontSize,
                  radius: raw.radius });
            renamed.set(raw.id, shape.id);
            ids.push(shape.id);
        }

        for (const raw of data.edges || []) {
            const from = renamed.get(raw.from);
            const to = renamed.get(raw.to);
            if (!from || !to) continue;
            const edge = this.doc.addEdge(from, to,
                { text: raw.text, stroke: raw.stroke,
                  dashed: raw.dashed, fontSize: raw.fontSize });
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
        if (!data.shapes.length) return;
        this.pasteData(data, PASTE_OFFSET, PASTE_OFFSET);
    }

    /* --------------------------------------------------------------- history */

    snapshot() {
        return JSON.stringify(this.doc.toJSON());
    }

    applySnapshot(json) {
        this.cancelEdit();
        this.doc = Diagram.fromJSON(JSON.parse(json));
        this.sel = this.sel.filter((id) => !!this.doc.find(id));
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
        this.doc = new Diagram();
        this.path = "";
        this.sel = [];
        this.undo.Clear();
        this.zoom = 1;
        this.panX = 40;
        this.panY = 40;
        this.statusText = this.toolHint("select");
        this.refreshAll();
    }

    openDocument(path) {
        let doc;
        try {
            doc = Diagram.fromJSON(File.LoadJson(path));
        } catch (e) {
            Message.Error(Locale.Text("Cannot open {0}: {1}"), path, e.message);
            return null;
        }

        this.doc = doc;
        this.path = path;
        this.sel = [];
        this.undo.Clear();
        this.pendingFit = true;
        if (this.Stage.Bounds().Width > 2) {
            this.pendingFit = false;
            this.zoomFit();
        }
        this.setStatus(Locale.Text("Opened {0}", File.Name(path)));
        this.refreshAll();
        return doc;
    }

    writeDocument(path) {
        if (this.editing) this.commitEdit();
        try {
            File.SaveJson(path, this.doc.toJSON());
        } catch (e) {
            Message.Error(Locale.Text("Cannot save {0}: {1}"), path, e.message);
            return false;
        }
        this.path = path;
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
        const folder = this.path ? File.Directory(this.path) : Application.Directory;
        const name = this.path ? File.Name(this.path) : "diagram.draw";
        Dialog.SaveFile(Locale.Text("Save diagram"), {
            Folder: folder,
            Name: name,
            Filters: [[Locale.Text("Bintana Draw diagram"), "*.draw"],
                      [Locale.Text("All files"), "*"]],
        }, (chosen) => {
            let path = chosen;
            if (!File.Extension(path)) path += ".draw";
            if (this.writeDocument(path) && after) after();
        });
    }

    exportDiagram(kind) {
        if (this.editing) this.commitEdit();
        if (!this.doc.bounds()) {
            Message.Warning(Locale.Text("The diagram is empty."));
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
        this.refreshTitle();
        this.refreshActions();
        this.syncColors();
        this.updateStatus();
        this.updateZoomLabel();
        if (this.Canvas) this.Canvas.Redraw();
    }

    refreshTitle() {
        if (!this.undo) return;
        const name = this.path ? File.Name(this.path) : Locale.Text("Untitled");
        const mark = this.undo.Modified ? "• " : "";
        this.Text = mark + name + " — " + Locale.Text("Bintana Draw");
    }

    refreshActions() {
        if (!this.undo) return;
        const selected = this.sel.length > 0;
        this.ActUndo.Enabled      = this.undo.CanUndo;
        this.ActRedo.Enabled      = this.undo.CanRedo;
        this.ActCut.Enabled       = selected;
        this.ActCopy.Enabled      = selected;
        this.ActDelete.Enabled    = selected;
        this.ActDuplicate.Enabled = selected;
        this.ActPaste.Enabled     = !!this.clipboard;
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

    /* --------------------------------------------------------------- actions */

    ActNew_Execute() { this.guard(() => this.resetDocument()); }

    ActOpen_Execute() {
        this.guard(() => {
            const folder = this.path ? File.Directory(this.path)
                                     : Application.Directory;
            Dialog.OpenFile(Locale.Text("Open diagram"), {
                Folder: folder,
                Filters: [[Locale.Text("Bintana Draw diagram"), "*.draw"],
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
        for (const s of this.doc.shapes) ids.push(s.id);
        for (const e of this.doc.edges) ids.push(e.id);
        this.select(ids);
    }

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
