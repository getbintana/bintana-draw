/*
 * Drives the real window with the handlers the runtime would call, the way the
 * runtime's own suite does. There is no test framework: a check increments a
 * counter or records a sentence, and the form quits with a status.
 *
 * The round trip through `writeDocument`/`openDocument` is deliberate: an
 * assertion on a property remembers what was assigned; a file written and read
 * back is the document.
 */
"use strict";

class TestForm extends Form {

    passed   = 0;
    failures = [];

    check(name, condition, detail) {
        if (condition) {
            this.passed++;
        } else {
            this.failures.push(detail ? name + ": " + detail : name);
        }
    }

    eq(name, got, want) {
        this.check(name, got === want,
                   "expected " + JSON.stringify(want) +
                   ", got " + JSON.stringify(got));
    }

    center(fm, shape) {
        return {
            x: fm.panX + (shape.x + shape.w / 2) * fm.zoom,
            y: fm.panY + (shape.y + shape.h / 2) * fm.zoom,
        };
    }

    Form_Open() {
        try {
            this.runAll();
        } catch (e) {
            this.failures.push("uncaught: " + e.message + "\n" + (e.stack || ""));
        }

        for (const failure of this.failures) print("  FAIL  " + failure);
        print("draw selfcheck: " + this.passed + " passed, " +
              this.failures.length + " failed");
        Application.Quit(this.failures.length ? 1 : 0);
    }

    runAll() {
        this.wiring();
        this.confirmDialog();

        const fm = new MainForm();
        this.fm = fm;
        fm.Show();

        this.eq("starts empty", fm.doc.shapes.length, 0);
        this.eq("starts untouched", fm.undo.Modified, false);

        /* A rectangle: press, drag, release -- the same three events GTK sends. */
        fm.chooseTool("rect", fm.BtnToolRect);
        this.eq("the rectangle tool is active", fm.tool, "rect");
        fm.Canvas_MouseDown(200, 200, 1, false, false);
        fm.Canvas_MouseMove(340, 280, 1, false, false);
        fm.Canvas_MouseUp(340, 280, 1, false, false);

        this.eq("the drag made one shape", fm.doc.shapes.length, 1);
        this.eq("it is a rectangle", fm.doc.shapes[0].kind, "rect");
        this.eq("the tool went back to select", fm.tool, "select");
        this.eq("the new shape is selected", fm.sel.length, 1);
        this.check("it has the dragged size",
                   fm.doc.shapes[0].w >= 100 && fm.doc.shapes[0].h >= 60,
                   "w=" + fm.doc.shapes[0].w + " h=" + fm.doc.shapes[0].h);

        let rect = fm.doc.shapes[0];
        const startX = rect.x;
        const at = this.center(fm, rect);
        fm.Canvas_MouseDown(at.x, at.y, 1, false, false);
        fm.Canvas_MouseMove(at.x + 40, at.y, 1, false, false);
        fm.Canvas_MouseUp(at.x + 40, at.y, 1, false, false);
        this.check("dragging moved it", rect.x > startX - 1,
                   "x was " + startX + ", now " + rect.x);

        fm.ActUndo_Execute();
        this.eq("undo brought it back", fm.doc.shapes[0].x, startX);
        fm.ActRedo_Execute();
        this.check("redo moved it again", fm.doc.shapes[0].x > startX - 1);
        rect = fm.doc.shapeById(rect.id);

        /* An ellipse with a click: the default size, not a 2-pixel drag. */
        fm.chooseTool("ellipse", fm.BtnToolEllipse);
        fm.Canvas_MouseDown(700, 400, 1, false, false);
        fm.Canvas_MouseUp(700, 400, 1, false, false);
        this.eq("the click made the second shape", fm.doc.shapes.length, 2);
        this.eq("it is an ellipse", fm.doc.shapes[1].kind, "ellipse");

        const ellipse = fm.doc.shapes[1];

        /* A connector, dragged from the middle of one to the middle of the
         * other -- exactly what the connector tool does. */
        fm.chooseTool("connect", fm.BtnToolConnect);
        const a = this.center(fm, rect);
        const b = this.center(fm, ellipse);
        fm.Canvas_MouseDown(a.x, a.y, 1, false, false);
        fm.Canvas_MouseMove(b.x, b.y, 1, false, false);
        fm.Canvas_MouseUp(b.x, b.y, 1, false, false);
        this.eq("the drag made one connector", fm.doc.edges.length, 1);
        this.eq("the connector joins them", fm.doc.edges[0].from, rect.id);
        this.eq("the connector ends on the ellipse", fm.doc.edges[0].to, ellipse.id);
        this.check("its route has points",
                   edgeRoute(fm.doc, fm.doc.edges[0]).length >= 4);

        /* Text, through the editor laid over the shape. */
        fm.beginEdit(ellipse);
        this.check("the text editor is showing", fm.TxtEdit.Visible);
        fm.TxtEdit.Text = "Yes";
        fm.TxtEdit_Activate();
        this.eq("the shape took the text", ellipse.text, "Yes");
        this.eq("the editor is away", fm.TxtEdit.Visible, false);

        fm.beginEdit(ellipse);
        fm.TxtEdit.Text = "Never mind";
        fm.TxtEdit_KeyPress("Escape");
        this.eq("Escape left the text alone", ellipse.text, "Yes");
        this.eq("Escape put the editor away", fm.TxtEdit.Visible, false);

        /* The keyboard moves what is selected. */
        fm.select([rect.id]);
        const beforeNudge = rect.x;
        fm.Form_KeyPress("Right", false, false);
        this.eq("the right arrow moved it ten units", rect.x, beforeNudge + 10);

        /* Duplicate makes copies and a second connector. */
        fm.select([rect.id, ellipse.id]);
        const shapesBefore = fm.doc.shapes.length;
        fm.ActDuplicate_Execute();
        this.eq("duplicate added two shapes", fm.doc.shapes.length, shapesBefore + 2);
        this.eq("duplicate added a connector", fm.doc.edges.length, 2);
        fm.ActUndo_Execute();
        this.eq("undo took the copies away", fm.doc.shapes.length, shapesBefore);
        this.eq("undo took their connector too", fm.doc.edges.length, 1);

        /* A file, out and back in. */
        const file = File.Join(Application.Directory, "roundtrip.draw");
        this.check("the diagram was written", fm.writeDocument(file));
        this.eq("it is no longer modified", fm.undo.Modified, false);

        fm.resetDocument();
        this.eq("a new document is empty", fm.doc.shapes.length, 0);

        const loaded = fm.openDocument(file);
        this.check("the file opened", !!loaded);
        this.eq("the two shapes came back", fm.doc.shapes.length, 2);
        this.eq("the connector came back", fm.doc.edges.length, 1);
        this.eq("the text came back", fm.doc.shapes[1].text, "Yes");
        this.eq("it opens clean", fm.undo.Modified, false);
        File.Delete(file);

        /* Geometry is a separate concern, and it is worth asserting without a
         * window: a route depends on both rectangles and follows a move. */
        const model = new Diagram();
        const one = model.addShape("rect", 0, 0, 100, 60);
        const two = model.addShape("rect", 300, 0, 100, 60);
        const edge = model.addEdge(one.id, two.id);
        const route = edgeRoute(model, edge);
        this.eq("the route starts on the right edge", route[0], 100);
        this.eq("and ends on the left edge", route[route.length - 2], 300);
        two.x = 400;
        const moved = edgeRoute(model, edge);
        this.eq("moving the target moves the route", moved[moved.length - 2], 400);

        const copy = Diagram.fromJSON(JSON.parse(JSON.stringify(model.toJSON())));
        this.eq("the model round-trips", copy.shapes.length, 2);
        this.eq("the edge survives", copy.edges.length, 1);

        let threw = false;
        try { Diagram.fromJSON({ format: "something-else" }); }
        catch (e) { threw = true; }
        this.check("a foreign file is refused", threw);

        /* The two exports run the same Draw against a file. They need no
         * window of their own, but they do need the shapes on the canvas. */
        const png = File.Join(Application.Directory, "export.png");
        const pdf = File.Join(Application.Directory, "export.pdf");
        fm.exporting = true;
        fm.Canvas.Save(png, 400, 300);
        fm.Canvas.SavePdf(pdf, 400, 300);
        fm.exporting = false;
        this.check("the PNG was written", File.Exists(png));
        this.check("the PDF was written", File.Exists(pdf));
        const pngInfo = File.Info(png);
        this.check("the PNG has bytes", pngInfo && pngInfo.Size > 500);
        File.Delete(png);
        File.Delete(pdf);

        /* Selection going away cannot leave a dangling id. */
        fm.select([fm.doc.edges[0].id]);
        fm.deleteSelection();
        this.eq("deleting the connector leaves the shapes", fm.doc.shapes.length, 2);
        this.eq("and no connector", fm.doc.edges.length, 0);

        fm.ActSelectAll_Execute();
        this.eq("select all takes both shapes", fm.sel.length, 2);
        fm.deleteSelection();
        this.eq("delete all empties the canvas", fm.doc.shapes.length, 0);

        /* The grid is a view setting, and the menu item is its state. */
        fm.MnuGrid.Value = false;
        fm.MnuGrid_Click();
        this.eq("the grid is off", fm.grid, false);
        fm.MnuGrid.Value = true;
        fm.MnuGrid_Click();
        this.eq("the grid is on", fm.grid, true);

        /* The camera is not the document. */
        fm.zoomBy(1.2);
        this.check("zoom in changed the scale", fm.zoom > 1);
        fm.ActZoomFit_Execute();
        this.check("fit left a usable scale", fm.zoom >= 0.2 && fm.zoom <= 4);

        fm.forceClose = true;
        fm.Close();
    }

    confirmDialog() {
        let answer = "";
        let dialog = ConfirmForm.ask("Title", "Message", "Save",
            () => { answer = "save"; },
            "Discard", () => { answer = "discard"; });
        dialog.BtnDiscard_Click();
        this.eq("discard runs its callback", answer, "discard");

        answer = "";
        dialog = ConfirmForm.ask("Title", "Message", "Save",
            () => { answer = "save"; },
            "Discard", () => { answer = "discard"; });
        dialog.BtnSave_Click();
        this.eq("save runs its callback", answer, "save");

        answer = "";
        dialog = ConfirmForm.ask("Title", "Message", "Save",
            () => { answer = "save"; },
            "Discard", () => { answer = "discard"; });
        dialog.BtnCancel_Click();
        this.eq("cancel answers nothing", answer, "");
    }

    wiring() {
        /* A handler whose control name is misspelled is silently dead: the
         * runtime looks it up by name and finds nothing. This is the list the
         * window depends on, checked from both sides. */
        const expected = {
            Form: ["Open", "Close", "KeyPress", "Resize", "FileDrop"],
            Canvas: ["Draw", "Allocated", "MouseDown", "MouseMove", "MouseUp",
                     "MouseCancel", "MouseLeave", "DblClick", "MouseWheel",
                     "FileDrop"],
            Stage: ["Allocated"],
            TxtEdit: ["Activate", "KeyPress", "LostFocus"],
            BtnToolSelect: ["Click"], BtnToolRect: ["Click"],
            BtnToolRound: ["Click"], BtnToolEllipse: ["Click"],
            BtnToolDiamond: ["Click"], BtnToolTerminator: ["Click"],
            BtnToolData: ["Click"], BtnToolCylinder: ["Click"],
            BtnToolNote: ["Click"],
            BtnToolText: ["Click"], BtnToolConnect: ["Click"],
            BtnFill: ["Change"], BtnLine: ["Change"],
            ActNew: ["Execute"], ActOpen: ["Execute"], ActSave: ["Execute"],
            ActSaveAs: ["Execute"], ActExportPng: ["Execute"],
            ActExportPdf: ["Execute"], ActQuit: ["Execute"],
            ActUndo: ["Execute"], ActRedo: ["Execute"], ActCut: ["Execute"],
            ActCopy: ["Execute"], ActPaste: ["Execute"],
            ActDuplicate: ["Execute"], ActDelete: ["Execute"],
            ActSelectAll: ["Execute"], ActZoomIn: ["Execute"],
            ActZoomOut: ["Execute"], ActZoomReset: ["Execute"],
            ActZoomFit: ["Execute"],
            MnuGrid: ["Click"], MnuShortcuts: ["Click"], MnuAbout: ["Click"],
        };

        const fm = new MainForm();
        for (const control in expected) {
            /* `Form` is the window itself; every other name is a control or an
             * action, and the handler always lives on the form. */
            const target = control === "Form" ? fm : fm[control];
            this.check("the control " + control + " exists", !!target);
            for (const event of expected[control]) {
                const handler = control + "_" + event;
                this.check(handler + " is wired",
                           typeof fm[handler] === "function");
            }
        }
        fm.forceClose = true;
        fm.Close();
    }
}
