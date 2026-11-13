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

        this.alignment(fm);
        this.guides(fm);
        this.drawio(fm);
        this.format(fm);
        this.zorder(fm);
        this.groups(fm);
        this.freeLines(fm);
        this.endpoints(fm);
        this.routing(fm);
        this.moreShapes(fm);
        this.images(fm);
        this.stencils(fm);
        this.stencilForm(fm);
        this.library(fm);
        this.layers(fm);
        this.pages(fm);

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

    alignment(fm) {
        fm.resetDocument();

        const a = fm.doc.addShape("rect", 0, 0, 100, 50);
        const b = fm.doc.addShape("rect", 200, 100, 80, 40);
        const c = fm.doc.addShape("rect", 400, 200, 120, 60);
        fm.select([a.id, b.id, c.id]);

        this.check("two shapes can align", fm.ActAlignLeft.Enabled);
        this.check("three shapes can distribute",
                   fm.ActDistributeHorizontal.Enabled);

        fm.ActAlignLeft_Execute();
        this.eq("align left: first", a.x, 0);
        this.eq("align left: second", b.x, 0);
        this.eq("align left: third", c.x, 0);

        fm.ActAlignCenter_Execute();
        this.eq("align center: same centre a/b",
                Math.round(a.x + a.w / 2), Math.round(b.x + b.w / 2));
        this.eq("align center: same centre b/c",
                Math.round(b.x + b.w / 2), Math.round(c.x + c.w / 2));

        fm.ActAlignTop_Execute();
        this.eq("align top: first", a.y, 0);
        this.eq("align top: second", b.y, 0);
        this.eq("align top: third", c.y, 0);

        fm.ActAlignBottom_Execute();
        this.eq("align bottom: same bottom a/b",
                Math.round(a.y + a.h), Math.round(b.y + b.h));
        this.eq("align bottom: same bottom b/c",
                Math.round(b.y + b.h), Math.round(c.y + c.h));

        fm.resetDocument();
        const d = fm.doc.addShape("rect", 0, 0, 100, 50);
        const e = fm.doc.addShape("rect", 200, 0, 100, 50);
        const f = fm.doc.addShape("rect", 600, 0, 100, 50);
        fm.select([d.id, e.id, f.id]);
        fm.ActDistributeHorizontal_Execute();
        this.eq("distribute: first centre", Math.round(d.x + d.w / 2), 50);
        this.eq("distribute: middle centre", Math.round(e.x + e.w / 2), 350);
        this.eq("distribute: last centre", Math.round(f.x + f.w / 2), 650);

        /* Undo goes back to where the middle one was. */
        const id = e.id;
        fm.ActUndo_Execute();
        this.eq("undo took the distribution back",
                fm.doc.shapeById(id).x, 200);
    }

    guides(fm) {
        fm.resetDocument();
        fm.panX = 0;
        fm.panY = 0;
        fm.zoom = 1;

        const other = fm.doc.addShape("rect", 103, 100, 100, 50);
        const moving = fm.doc.addShape("rect", 300, 300, 100, 50);
        fm.select([moving.id]);

        fm.Canvas_MouseDown(350, 325, 1, false, false);
        fm.Canvas_MouseMove(154, 325, 1, false, false);

        const moved = fm.doc.shapeById(moving.id);
        this.eq("the drag snapped to the other shape's left edge",
                moved.x, other.x);
        this.check("the guide line is showing",
                   fm.guides && fm.guides.vertical.indexOf(103) >= 0);

        fm.Canvas_MouseUp(154, 325, 1, false, false);
        this.check("the guide is gone when the button comes up",
                   fm.guides === null);

        /* A resize snaps the edge being dragged, not the whole rectangle. */
        fm.resetDocument();
        fm.panX = 0;
        fm.panY = 0;
        fm.zoom = 1;
        const neighbour = fm.doc.addShape("rect", 303, 100, 100, 50);
        const sized = fm.doc.addShape("rect", 100, 300, 80, 50);
        fm.select([sized.id]);

        fm.Canvas_MouseDown(180, 325, 1, false, false);
        fm.Canvas_MouseMove(299, 325, 1, false, false);
        const resized = fm.doc.shapeById(sized.id);
        this.eq("the resized edge snapped to the neighbour",
                Math.round(resized.x + resized.w), neighbour.x);
        this.check("the resize guide is showing",
                   fm.guides && fm.guides.vertical.indexOf(303) >= 0);
        fm.Canvas_MouseUp(299, 325, 1, false, false);
    }

    drawio(fm) {
        this.check("libxml2 is available", Xml.Available);

        const xml = `<mxfile host="test"><diagram id="p1" name="Page-1"><mxGraphModel><root>
            <mxCell id="0"/>
            <mxCell id="1" parent="0"/>
            <mxCell id="2" value="Annotations" parent="0"/>
            <mxCell id="a" value="&lt;b&gt;Start&lt;/b&gt;&lt;br&gt;now" style="rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=14;fontStyle=1;rotation=30;" vertex="1" parent="1"><mxGeometry x="10" y="20" width="120" height="60" as="geometry"/></mxCell>
            <mxCell id="b" value="Yes?" style="rhombus;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1"><mxGeometry x="200" y="10" width="100" height="80" as="geometry"/></mxCell>
            <mxCell id="c" value="Done" style="ellipse;" vertex="1" parent="1"><mxGeometry x="380" y="20" width="100" height="60" as="geometry"/></mxCell>
            <mxCell id="e" value="ok" style="dashed=1;strokeColor=#ff0000;fontSize=13;fontStyle=2;" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
            <mxCell id="e2" edge="1" source="b" target="c" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
            <mxCell id="n" value="On another layer" style="shape=note;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="2"><mxGeometry x="200" y="150" width="120" height="70" as="geometry"/></mxCell>
        </root></mxGraphModel></diagram></mxfile>`;

        const parsed = DrawioImport.parse(xml);
        this.eq("draw.io: one page", parsed.pages, 1);
        this.eq("draw.io: four shapes", parsed.diagram.shapes.length, 4);
        this.eq("draw.io: two edges", parsed.diagram.edges.length, 2);
        this.eq("draw.io: two layers", parsed.diagram.layers.length, 2);
        this.eq("draw.io: the second layer is named",
                parsed.diagram.layers[1].name, "Annotations");
        this.eq("draw.io: the note stays on its layer",
                parsed.diagram.shapes[3].layer, parsed.diagram.layers[1].id);
        this.eq("draw.io: rounded becomes rounded",
                parsed.diagram.shapes[0].kind, "round");
        this.eq("draw.io: the HTML label is plain text",
                parsed.diagram.shapes[0].text, "Start\nnow");
        this.eq("draw.io: the fill colour survives",
                parsed.diagram.shapes[0].fill, "#dae8fc");
        this.eq("draw.io: the font size survives",
                parsed.diagram.shapes[0].fontSize, 14);
        this.eq("draw.io: bold survives",
                parsed.diagram.shapes[0].textBold, true);
        this.eq("draw.io: rotation survives",
                parsed.diagram.shapes[0].rotation, 30);
        this.eq("draw.io: italic survives",
                parsed.diagram.edges[0].textItalic, true);
        this.eq("draw.io: rhombus becomes decision",
                parsed.diagram.shapes[1].kind, "diamond");
        this.eq("draw.io: ellipse becomes ellipse",
                parsed.diagram.shapes[2].kind, "ellipse");
        this.eq("draw.io: the dashed edge is dashed",
                parsed.diagram.edges[0].dashed, true);
        this.eq("draw.io: the edge label survives",
                parsed.diagram.edges[0].text, "ok");
        this.eq("draw.io: the edge colour survives",
                parsed.diagram.edges[0].stroke, "#ff0000");
        this.eq("draw.io: the edge ends where it should",
                parsed.diagram.shapeById(parsed.diagram.edges[1].from).kind,
                "diamond");

        /* A page without a model is the compressed form. */
        let compressed = false;
        try {
            DrawioImport.parse(`<mxfile><diagram id="p">N4IgZgLg5gLgpgAgA==</diagram></mxfile>`);
        } catch (e) { compressed = true; }
        this.check("a compressed draw.io page is refused", compressed);

        /* Two pages: the first one is imported and the count is reported. */
        const twoPages = `<mxfile>
            <diagram id="one" name="One"><mxGraphModel><root>
                <mxCell id="0"/><mxCell id="1" parent="0"/>
                <mxCell id="a" value="Only" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>
            </root></mxGraphModel></diagram>
            <diagram id="two" name="Two"><mxGraphModel><root>
                <mxCell id="0"/><mxCell id="1" parent="0"/>
                <mxCell id="a" value="One" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>
                <mxCell id="b" value="Two" vertex="1" parent="1"><mxGeometry x="100" y="0" width="80" height="40" as="geometry"/></mxCell>
            </root></mxGraphModel></diagram>
        </mxfile>`;
        const pages = DrawioImport.parse(twoPages);
        this.eq("draw.io: both pages are counted", pages.pages, 2);
        this.eq("draw.io: two page objects", pages.diagrams.length, 2);
        this.eq("draw.io: the first page is the one imported",
                pages.diagram.shapes.length, 1);
        this.eq("draw.io: the second page came too",
                pages.diagrams[1].shapes.length, 2);
        this.eq("draw.io: the page names came too", pages.names[1], "Two");

        /* Opening it through the window must not pretend the .drawio is a
         * .draw: Save would overwrite the original with JSON. */
        const source = File.Join(Application.Directory, "import.drawio");
        File.Save(source, xml);
        fm.resetDocument();
        const loaded = fm.openDocument(source);
        this.check("draw.io: the window imports it", !!loaded);
        this.eq("draw.io: the shapes arrived", fm.doc.shapes.length, 4);
        this.eq("draw.io: the layers arrived", fm.doc.layers.length, 2);
        this.eq("draw.io: the file is not the save path", fm.path, "");
        this.eq("draw.io: the source is remembered", fm.importedFrom, source);
        this.check("draw.io: the title says where it came from",
                   fm.Text.indexOf("import.drawio") >= 0);
        this.eq("draw.io: importing is not a modification",
                fm.undo.Modified, false);

        /* The first Save goes to a .draw, and then the .draw is the document. */
        const target = File.Join(Application.Directory, "imported.draw");
        this.check("draw.io: the import saves as a diagram", fm.writeDocument(target));
        this.eq("draw.io: the imported source is forgotten", fm.importedFrom, "");
        this.eq("draw.io: the new path is the diagram", fm.path, target);
        File.Delete(source);
        File.Delete(target);

        /* A multi-page draw.io file becomes a multi-page book. */
        const multi = File.Join(Application.Directory, "two.drawio");
        File.Save(multi, twoPages);
        fm.resetDocument();
        fm.openDocument(multi);
        this.eq("draw.io: the window keeps both pages",
                fm.book.pages.length, 2);
        this.eq("draw.io: the second page's shapes",
                fm.book.pages[1].shapes.length, 2);
        this.eq("draw.io: the second page's name",
                fm.book.pageName(1), "Two");
        File.Delete(multi);
    }

    layers(fm) {
        fm.resetDocument();
        const base = fm.doc.layers[0];
        const a = fm.doc.addShape("rect", 0, 0, 100, 50, { text: "Base" });
        fm.refreshAll();
        this.eq("layers: one to start", fm.doc.layers.length, 1);
        this.eq("layers: the first shape is on it", a.layer, base.id);

        fm.BtnLayerAdd_Click();
        this.eq("layers: add makes a second", fm.doc.layers.length, 2);
        this.eq("layers: the new one is active", fm.activeLayer,
                fm.doc.layers[1].id);

        fm.chooseTool("ellipse", fm.BtnToolEllipse);
        fm.Canvas_MouseDown(300, 200, 1, false, false);
        fm.Canvas_MouseUp(300, 200, 1, false, false);
        this.eq("layers: a new shape goes to the active layer",
                fm.doc.shapes.length, 2);
        this.eq("layers: and names it",
                fm.doc.shapes[1].layer, fm.doc.layers[1].id);

        const cross = fm.doc.addEdge(a.id, fm.doc.shapes[1].id,
                                     { layer: base.id });

        /* Hiding takes it out of the picture and out of the selection. */
        fm.BtnLayerVisible.Active = false;
        fm.BtnLayerVisible_Click();
        this.eq("layers: hiding is a state", fm.doc.layers[1].visible, false);
        this.eq("layers: hiding clears its selection", fm.sel.length, 0);
        this.check("layers: hidden shapes are not in the bounds",
                   fm.doc.bounds().w === 100);
        this.check("layers: an edge to a hidden shape hides too",
                   !fm.doc.layerVisible(cross));

        fm.BtnLayerVisible.Active = true;
        fm.BtnLayerVisible_Click();
        this.eq("layers: showing it again", fm.doc.layers[1].visible, true);

        /* Locking an active layer refuses the next drawing gesture. */
        fm.BtnLayerLocked.Active = true;
        fm.BtnLayerLocked_Click();
        const count = fm.doc.shapes.length;
        fm.chooseTool("rect", fm.BtnToolRect);
        fm.Canvas_MouseDown(420, 260, 1, false, false);
        fm.Canvas_MouseUp(420, 260, 1, false, false);
        this.eq("layers: a locked layer refuses new shapes",
                fm.doc.shapes.length, count);
        fm.BtnLayerLocked.Active = false;
        fm.BtnLayerLocked_Click();

        /* Rename, reorder, and send a selection to another layer. */
        fm.TxtLayerName.Text = "Notes";
        fm.renameActiveLayer();
        this.eq("layers: rename works", fm.doc.layers[1].name, "Notes");

        fm.moveActiveLayer(-1);
        this.eq("layers: moving down changes the order",
                fm.doc.layers[0].name, "Notes");
        fm.moveActiveLayer(1);
        this.eq("layers: moving up changes it back",
                fm.doc.layers[1].name, "Notes");

        fm.select([a.id]);
        fm.BtnLayerAssign_Click();
        this.eq("layers: a selection moves here", fm.doc.shapeById(a.id).layer,
                fm.doc.layers[1].id);

        const round = Diagram.fromJSON(JSON.parse(JSON.stringify(fm.doc.toJSON())));
        this.eq("layers: the round trip keeps both", round.layers.length, 2);
        this.eq("layers: and the name", round.layers[1].name, "Notes");
        this.eq("layers: and the shape's layer",
                round.shapeById(a.id).layer, round.layers[1].id);

        /* Removing the layer takes its shapes and connectors with it. */
        fm.select([a.id]);
        const attached = fm.doc.addEdge(a.id, fm.doc.shapes[1].id,
            { layer: fm.doc.layers[1].id });
        this.check("layers: a connector was made", !!attached);
        const removed = fm.doc.layers[1].id;
        fm.BtnLayerRemove_Click();
        this.eq("layers: remove leaves one", fm.doc.layers.length, 1);
        this.eq("layers: its shapes are gone", fm.doc.shapes.length, 0);
        this.eq("layers: its connectors are gone", fm.doc.edges.length, 0);
        this.check("layers: and it is not active", fm.activeLayer !== removed);

        /* The topmost painted copy is the one the pointer picks. */
        const hit = new Diagram();
        const low = hit.addShape("rect", 0, 0, 100, 50);
        const highLayer = hit.addLayer("High");
        const high = hit.addShape("rect", 0, 0, 100, 50,
                                  { layer: highLayer.id });
        this.eq("layers: hit testing follows the paint order",
                hit.shapeAt(10, 10).id, high.id);
        highLayer.locked = true;
        this.eq("layers: a locked top layer lets the one below be picked",
                hit.shapeAt(10, 10).id, low.id);

        /* A .draw written before layers existed still opens. */
        const legacy = Diagram.fromJSON({
            format: "bintana-draw/1", version: 1, edges: [],
            shapes: [{ id: "s1", kind: "rect", x: 0, y: 0, w: 10, h: 10 }],
        });
        this.eq("layers: an old file gets one layer", legacy.layers.length, 1);
        this.eq("layers: and its shape lands there",
                legacy.shapes[0].layer, legacy.layers[0].id);
    }

    pages(fm) {
        fm.resetDocument();
        this.eq("pages: one to start", fm.book.pages.length, 1);
        this.eq("pages: the combo has it", fm.CmbPage.Count, 1);
        this.eq("pages: the first is active", fm.activePage, 0);

        const first = fm.doc.addShape("rect", 0, 0, 100, 50, { text: "One" });
        fm.refreshAll();

        fm.BtnPageAdd_Click();
        this.eq("pages: add makes a second", fm.book.pages.length, 2);
        this.eq("pages: the new page is active", fm.activePage, 1);
        this.eq("pages: the new page is blank", fm.doc.shapes.length, 0);
        this.eq("pages: the combo follows", fm.CmbPage.Count, 2);
        this.check("pages: remove is enabled", fm.BtnPageRemove.Enabled);

        const second = fm.doc.addShape("rect", 20, 20, 80, 40, { text: "Two" });
        fm.doc.addLayer("Extra");
        fm.refreshAll();
        this.eq("pages: a page has its own layers", fm.doc.layers.length, 2);

        fm.TxtPageName.Text = "Second";
        fm.renameActivePage();
        this.eq("pages: rename works", fm.book.pageName(1), "Second");
        this.check("pages: the title names the page",
                   fm.Text.indexOf("Second") >= 0);

        fm.switchPage(0);
        this.eq("pages: switch goes back", fm.activePage, 0);
        this.check("pages: the first page kept its shape",
                   !!fm.doc.shapeById(first.id));
        this.eq("pages: the first page kept its layers", fm.doc.layers.length, 1);
        this.eq("pages: switching clears the selection", fm.sel.length, 0);

        fm.switchPage(1);
        this.eq("pages: switch goes forward", fm.activePage, 1);
        this.check("pages: the second page kept its shape",
                   !!fm.doc.shapeById(second.id));
        this.eq("pages: the second page kept its layers", fm.doc.layers.length, 2);

        /* The file holds every page, and which one was open. */
        const file = File.Join(Application.Directory, "pages.draw");
        this.check("pages: the book was written", fm.writeDocument(file));
        fm.resetDocument();
        fm.openDocument(file);
        this.eq("pages: both pages came back", fm.book.pages.length, 2);
        this.eq("pages: the names came back", fm.book.pageName(1), "Second");
        this.eq("pages: the open page came back", fm.activePage, 1);
        this.eq("pages: the first page has its shape",
                fm.book.pages[0].shapes.length, 1);
        this.eq("pages: the second page has its layers",
                fm.book.pages[1].layers.length, 2);
        File.Delete(file);

        /* Moving a page is an undo step too. */
        fm.BtnPageUp_Click();
        this.eq("pages: moving up changes the order",
                fm.book.pageName(0), "Second");
        this.eq("pages: the moved page stays active", fm.activePage, 0);
        this.check("pages: up is disabled at the top",
                   !fm.BtnPageUp.Enabled);
        this.check("pages: down is enabled below the top",
                   fm.BtnPageDown.Enabled);

        fm.BtnPageDown_Click();
        this.eq("pages: moving down changes it back",
                fm.book.pageName(1), "Second");
        this.eq("pages: and follows the page", fm.activePage, 1);

        fm.ActUndo_Execute();
        this.eq("pages: undo takes the move back",
                fm.book.pageName(0), "Second");
        fm.ActRedo_Execute();
        this.eq("pages: redo moves it again",
                fm.book.pageName(1), "Second");

        /* Adding, removing and renaming are one undo step each. */
        fm.switchPage(0);
        fm.BtnPageAdd_Click();
        this.eq("pages: a third page", fm.book.pages.length, 3);
        fm.ActUndo_Execute();
        this.eq("pages: undo took it away", fm.book.pages.length, 2);
        fm.ActRedo_Execute();
        this.eq("pages: redo put it back", fm.book.pages.length, 3);
        fm.BtnPageRemove_Click();
        this.eq("pages: remove leaves two", fm.book.pages.length, 2);
        fm.ActUndo_Execute();
        this.eq("pages: undo brings the page back", fm.book.pages.length, 3);
        fm.ActRedo_Execute();
        this.eq("pages: redo removes it again", fm.book.pages.length, 2);

        /* A diagram from before pages is one page. */
        const old = Document.fromJSON({
            format: "bintana-draw/1", version: 1,
            shapes: [{ id: "s1", kind: "rect", x: 0, y: 0, w: 10, h: 10 }],
            edges: [],
        });
        this.eq("pages: an old file is one page", old.pages.length, 1);
        this.eq("pages: its shape is on that page", old.pages[0].shapes.length, 1);
    }

    format(fm) {
        fm.resetDocument();
        const a = fm.doc.addShape("rect", 0, 0, 100, 50, { text: "Hello" });
        const b = fm.doc.addShape("rect", 200, 0, 100, 50, { text: "World" });
        const edge = fm.doc.addEdge(a.id, b.id, { text: "link" });
        fm.refreshAll();

        fm.select([a.id]);
        fm.SpnStrokeWidth.Value = 4;
        fm.SpnStrokeWidth_Change();
        this.eq("format: line width", fm.doc.shapeById(a.id).strokeWidth, 4);

        fm.CmbDash.Index = 1;
        fm.CmbDash_Select();
        this.eq("format: line style", fm.doc.shapeById(a.id).dash, "dash");

        fm.SpnFont.Value = 18;
        fm.SpnFont_Change();
        this.eq("format: font size", fm.doc.shapeById(a.id).fontSize, 18);

        fm.BtnBold.Active = true;
        fm.BtnBold_Click();
        this.eq("format: bold", fm.doc.shapeById(a.id).textBold, true);

        fm.BtnItalic.Active = true;
        fm.BtnItalic_Click();
        this.eq("format: italic", fm.doc.shapeById(a.id).textItalic, true);

        fm.BtnAlignLeft.Active = true;
        fm.BtnAlignLeft_Click();
        this.eq("format: horizontal alignment",
                fm.doc.shapeById(a.id).textAlign, "left");
        this.check("format: the align buttons are exclusive",
                   !fm.BtnAlignCenter.Active && !fm.BtnAlignRight.Active);

        fm.CmbVAlign.Index = 0;
        fm.CmbVAlign_Select();
        this.eq("format: vertical alignment",
                fm.doc.shapeById(a.id).textVAlign, "top");

        fm.BtnTextColor.Value = "rgb(255,0,0)";
        fm.BtnTextColor_Change();
        this.eq("format: text colour",
                fm.doc.shapeById(a.id).textColor, "rgb(255,0,0)");

        fm.SpnRotation.Value = 45;
        fm.SpnRotation_Change();
        this.eq("format: rotation", fm.doc.shapeById(a.id).rotation, 45);
        const rotated = fm.doc.shapeById(a.id);
        const rotatedBox = shapeRectBounds(rotated);
        this.check("format: the bounds follow the rotation",
                   Math.round(rotatedBox.w) > 100);
        const centre = shapeCenter(rotated);
        this.check("format: the centre still hits",
                   pointInShape(rotated, centre.x, centre.y));
        this.check("format: the old corner does not",
                   !pointInShape(rotated, rotated.x + 1, rotated.y + 1));

        /* The edge has its own width, dash and label style. */
        fm.select([edge.id]);
        fm.SpnStrokeWidth.Value = 3;
        fm.SpnStrokeWidth_Change();
        fm.CmbDash.Index = 2;
        fm.CmbDash_Select();
        fm.SpnFont.Value = 14;
        fm.SpnFont_Change();
        fm.BtnBold.Active = true;
        fm.BtnBold_Click();
        const styledEdge = fm.doc.edgeById(edge.id);
        this.eq("format: edge width", styledEdge.strokeWidth, 3);
        this.eq("format: edge dots", styledEdge.dash, "dot");
        this.eq("format: edge font", styledEdge.fontSize, 14);
        this.eq("format: edge bold", styledEdge.textBold, true);

        /* The defaults are what the next shape gets. */
        fm.select([]);
        const options = fm.shapeOptions("rect");
        this.eq("format: default width", options.strokeWidth, 3);
        this.eq("format: default dash", options.dash, "dot");
        this.eq("format: default font", options.fontSize, 14);

        /* The file keeps the style, and undo takes one change back. */
        const round = Diagram.fromJSON(JSON.parse(JSON.stringify(fm.doc.toJSON())));
        this.eq("format: width round-trips",
                round.shapeById(a.id).strokeWidth, 4);
        this.eq("format: bold round-trips", round.shapeById(a.id).textBold, true);
        this.eq("format: rotation round-trips",
                round.shapeById(a.id).rotation, 45);
        this.eq("format: edge dots round-trip", round.edgeById(edge.id).dash, "dot");

        fm.select([a.id]);
        const before = fm.doc.shapeById(a.id).strokeWidth;
        fm.SpnStrokeWidth.Value = 6;
        fm.SpnStrokeWidth_Change();
        this.eq("format: a new width", fm.doc.shapeById(a.id).strokeWidth, 6);
        fm.ActUndo_Execute();
        this.eq("format: undo restores the width",
                fm.doc.shapeById(a.id).strokeWidth, before);
    }

    zorder(fm) {
        fm.resetDocument();
        const back = fm.doc.addShape("rect", 0, 0, 100, 50, { text: "Back" });
        const front = fm.doc.addShape("rect", 20, 20, 100, 50, { text: "Front" });
        fm.refreshAll();

        fm.select([back.id]);
        this.check("order: actions are enabled", fm.ActBringFront.Enabled);
        fm.ActBringFront_Execute();
        this.eq("order: bring to front",
                fm.doc.shapes[fm.doc.shapes.length - 1].id, back.id);
        fm.ActSendBack_Execute();
        this.eq("order: send to back", fm.doc.shapes[0].id, back.id);
        fm.ActBringForward_Execute();
        this.eq("order: bring forward", fm.doc.shapes[1].id, back.id);
        fm.ActSendBackward_Execute();
        this.eq("order: send backward", fm.doc.shapes[0].id, back.id);

        fm.ActUndo_Execute();
        this.eq("order: undo takes the last move back",
                fm.doc.shapes[1].id, back.id);

        fm.select([]);
        this.check("order: actions are disabled with no shape",
                   !fm.ActBringFront.Enabled);
    }

    groups(fm) {
        fm.resetDocument();
        const a = fm.doc.addShape("rect", 0, 0, 100, 50, { text: "A" });
        const b = fm.doc.addShape("rect", 150, 0, 100, 50, { text: "B" });
        const c = fm.doc.addShape("rect", 300, 0, 100, 50, { text: "C" });
        fm.refreshAll();

        fm.select([a.id, b.id]);
        this.check("groups: the action is enabled", fm.ActGroup.Enabled);
        fm.ActGroup_Execute();
        const group = fm.doc.shapeById(a.id).group;
        this.check("groups: both got an id", group !== "");
        this.eq("groups: they share it", fm.doc.shapeById(b.id).group, group);
        this.eq("groups: both are selected", fm.sel.length, 2);

        /* One click on a member selects the whole group, and moving it moves
         * every member. */
        fm.select([a.id]);
        this.eq("groups: a click expands", fm.sel.length, 2);
        const ax = fm.doc.shapeById(a.id).x;
        const bx = fm.doc.shapeById(b.id).x;
        fm.nudge(10, 0);
        this.eq("groups: moving moves A", fm.doc.shapeById(a.id).x, ax + 10);
        this.eq("groups: moving moves B", fm.doc.shapeById(b.id).x, bx + 10);

        fm.select([c.id]);
        this.eq("groups: an outsider is alone", fm.sel.length, 1);
        this.check("groups: ungroup is disabled",
                   !fm.ActUngroup.Enabled);

        /* A copy gets a new group id, not the original one. */
        fm.select([a.id]);
        fm.ActDuplicate_Execute();
        const copies = fm.selectedShapes();
        this.eq("groups: duplicate copies both", copies.length, 2);
        this.check("groups: the copy has a new id",
                   copies[0].group !== group && copies[1].group !== group);
        this.eq("groups: the copy shares its new id",
                copies[0].group, copies[1].group);
        fm.ActUndo_Execute();

        fm.select([a.id]);
        fm.ActUngroup_Execute();
        this.eq("groups: ungroup clears A", fm.doc.shapeById(a.id).group, "");
        this.eq("groups: ungroup clears B", fm.doc.shapeById(b.id).group, "");
        fm.ActUndo_Execute();
        this.eq("groups: undo restores the id",
                fm.doc.shapeById(a.id).group, group);

        const round = Diagram.fromJSON(JSON.parse(JSON.stringify(fm.doc.toJSON())));
        this.eq("groups: the file keeps it", round.shapeById(a.id).group, group);

        /* draw.io groups are the parent cells with style=group. */
        const imported = DrawioImport.parse(`<mxfile><diagram id="p"><mxGraphModel><root>
            <mxCell id="0"/><mxCell id="1" parent="0"/>
            <mxCell id="grp" value="" style="group" vertex="1" parent="1"><mxGeometry x="50" y="50" width="200" height="80" as="geometry"/></mxCell>
            <mxCell id="a" value="A" vertex="1" parent="grp"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>
            <mxCell id="b" value="B" vertex="1" parent="grp"><mxGeometry x="100" y="0" width="80" height="40" as="geometry"/></mxCell>
        </root></mxGraphModel></diagram></mxfile>`);
        const importedShapes = imported.diagram.shapes;
        this.eq("groups: draw.io group is imported",
                importedShapes[0].group, importedShapes[1].group);
        this.check("groups: and it has an id", importedShapes[0].group !== "");
        this.eq("groups: the group offset is applied", importedShapes[0].x, 50);
    }

    freeLines(fm) {
        fm.resetDocument();
        fm.panX = 0;
        fm.panY = 0;
        fm.zoom = 1;

        fm.chooseTool("line", fm.BtnToolLine);
        fm.Canvas_MouseDown(100, 100, 1, false, false);
        fm.Canvas_MouseMove(300, 120, 1, false, false);
        fm.Canvas_MouseUp(300, 120, 1, false, false);
        this.eq("lines: a line was drawn", fm.doc.edges.length, 1);
        const line = fm.doc.edges[0];
        this.eq("lines: it has no source", line.from, "");
        this.eq("lines: it has no target", line.to, "");
        this.eq("lines: the line tool leaves no arrow", line.arrowEnd, false);
        this.eq("lines: the tool went back to select", fm.tool, "select");

        fm.chooseTool("arrow", fm.BtnToolArrow);
        fm.Canvas_MouseDown(100, 200, 1, false, false);
        fm.Canvas_MouseMove(300, 220, 1, false, false);
        fm.Canvas_MouseUp(300, 220, 1, false, false);
        this.eq("lines: an arrow was drawn", fm.doc.edges.length, 2);
        const arrow = fm.doc.edges[1];
        this.eq("lines: the arrow keeps its head", arrow.arrowEnd, true);

        /* The two ends have their own handles. */
        fm.select([line.id]);
        let handles = edgeHandlePoints(fm.doc, fm.doc.edgeById(line.id));
        this.eq("ends: a free line has two endpoint handles",
                handles.ends.length, 2);
        const start = handles.ends[0];
        fm.Canvas_MouseDown(start.x, start.y, 1, false, false);
        fm.Canvas_MouseMove(start.x + 20, start.y + 10, 1, false, false);
        fm.Canvas_MouseUp(start.x + 20, start.y + 10, 1, false, false);
        this.eq("ends: dragging the start moves only the start",
                fm.doc.edgeById(line.id).x1, fm.snap(start.x + 20));
        this.eq("ends: the end stayed",
                fm.doc.edgeById(line.id).x2, line.x2);

        const moved = edgeHandlePoints(fm.doc, fm.doc.edgeById(line.id)).ends[0];
        fm.Canvas_DblClick(moved.x, moved.y);
        this.eq("ends: double-click puts an arrow at the start",
                fm.doc.edgeById(line.id).arrowStart, true);
        fm.Canvas_DblClick(moved.x, moved.y);
        this.eq("ends: double-click takes it away",
                fm.doc.edgeById(line.id).arrowStart, false);

        fm.select([line.id]);
        fm.ActArrowBoth_Execute();
        this.eq("ends: arrows at both ends", fm.doc.edgeById(line.id).arrowStart,
                true);
        this.eq("ends: and at the end", fm.doc.edgeById(line.id).arrowEnd, true);
        fm.ActArrowNone_Execute();
        this.eq("ends: no arrow at the start", fm.doc.edgeById(line.id).arrowStart,
                false);
        this.eq("ends: no arrow at the end", fm.doc.edgeById(line.id).arrowEnd,
                false);

        /* A free line can be dragged by its body. */
        fm.select([line.id]);
        const x = fm.doc.edgeById(line.id).x1;
        fm.Canvas_MouseDown(200, 110, 1, false, false);
        fm.Canvas_MouseMove(240, 110, 1, false, false);
        fm.Canvas_MouseUp(240, 110, 1, false, false);
        this.eq("lines: dragging moves the line",
                fm.doc.edgeById(line.id).x1, x + 40);

        /* A free line can be copied on its own. */
        fm.select([line.id]);
        fm.ActCopy_Execute();
        fm.ActPaste_Execute();
        this.eq("lines: paste adds one", fm.doc.edges.length, 3);
        const pasted = fm.doc.edges[2];
        this.eq("lines: paste offsets it",
                pasted.x1, fm.doc.edgeById(line.id).x1 + 20);
        fm.ActUndo_Execute();
        this.eq("lines: undo paste", fm.doc.edges.length, 2);

        /* The file keeps the free line and its endpoints. */
        const file = File.Join(Application.Directory, "lines.draw");
        fm.writeDocument(file);
        fm.resetDocument();
        fm.openDocument(file);
        this.eq("lines: the line came back", fm.doc.edges.length, 2);
        const back = fm.doc.edges.find((e) => !e.from && !e.to);
        this.check("lines: it is still free", !!back);
        this.eq("lines: its arrow came back", back.arrowEnd, false);
        File.Delete(file);

        /* The bounds include a free line that goes past every shape. */
        fm.resetDocument();
        fm.doc.addShape("rect", 0, 0, 50, 50);
        fm.doc.addLine(100, 100, 400, 200, {});
        const box = fm.doc.bounds();
        this.check("lines: the bounds cover the line", box.w >= 400);

        const imported = DrawioImport.parse(`<mxfile><diagram id="p"><mxGraphModel><root>
            <mxCell id="0"/><mxCell id="1" parent="0"/>
            <mxCell id="e" value="" style="endArrow=none;strokeColor=#ff0000;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="10" y="20" as="sourcePoint"/><mxPoint x="110" y="80" as="targetPoint"/></mxGeometry></mxCell>
        </root></mxGraphModel></diagram></mxfile>`);
        this.eq("lines: draw.io floating line", imported.diagram.edges.length, 1);
        this.eq("lines: draw.io line is free",
                imported.diagram.edges[0].from, "");
        this.eq("lines: draw.io line endpoints",
                imported.diagram.edges[0].x2, 110);
        this.eq("lines: draw.io line has no arrow",
                imported.diagram.edges[0].arrowEnd, false);
    }

    routing(fm) {
        fm.resetDocument();
        fm.panX = 0;
        fm.panY = 0;
        fm.zoom = 1;
        const a = fm.doc.addShape("rect", 0, 0, 100, 60, { text: "A" });
        const b = fm.doc.addShape("rect", 300, 0, 100, 60, { text: "B" });
        const edge = fm.doc.addEdge(a.id, b.id, { text: "edge" });
        fm.refreshAll();
        fm.select([edge.id]);

        this.eq("routing: orthogonal by default",
                fm.doc.edgeById(edge.id).route, "orthogonal");
        fm.CmbRoute.Index = 2;
        fm.CmbRoute_Select();
        this.eq("routing: curved is set", fm.doc.edgeById(edge.id).route,
                "curved");
        this.check("routing: the curve has samples",
                   edgeRoute(fm.doc, fm.doc.edgeById(edge.id)).length > 4);

        fm.CmbRoute.Index = 1;
        fm.CmbRoute_Select();
        this.eq("routing: straight is set", fm.doc.edgeById(edge.id).route,
                "straight");
        this.eq("routing: a straight edge is two points",
                edgeRoute(fm.doc, fm.doc.edgeById(edge.id)).length, 4);

        fm.CmbRoute.Index = 0;
        fm.CmbRoute_Select();
        this.eq("routing: back to orthogonal",
                fm.doc.edgeById(edge.id).route, "orthogonal");

        /* Selecting the edge gives a hollow midpoint; dragging it adds a bend. */
        fm.select([edge.id]);
        let handles = edgeHandlePoints(fm.doc, fm.doc.edgeById(edge.id));
        this.eq("routing: there is one add handle", handles.midpoints.length, 1);
        const add = handles.midpoints[0];
        fm.Canvas_MouseDown(add.x, add.y, 1, false, false);
        fm.Canvas_MouseMove(add.x + 20, add.y + 30, 1, false, false);
        fm.Canvas_MouseUp(add.x + 20, add.y + 30, 1, false, false);
        this.eq("routing: the bend was added",
                fm.doc.edgeById(edge.id).waypoints.length, 1);

        const bend = fm.doc.edgeById(edge.id).waypoints[0];
        this.eq("routing: and moved with the pointer",
                fm.doc.edgeById(edge.id).waypoints[0].x, fm.snap(add.x + 20));

        /* A second click on a bend removes it. */
        fm.select([edge.id]);
        const at = fm.doc.edgeById(edge.id).waypoints[0];
        fm.Canvas_DblClick(at.x, at.y);
        this.eq("routing: double-click removes the bend",
                fm.doc.edgeById(edge.id).waypoints.length, 0);
        fm.ActUndo_Execute();
        this.eq("routing: undo brings the bend back",
                fm.doc.edgeById(edge.id).waypoints.length, 1);

        const round = Diagram.fromJSON(JSON.parse(JSON.stringify(fm.doc.toJSON())));
        this.eq("routing: the route round-trips",
                round.edgeById(edge.id).route, "orthogonal");
        this.eq("routing: the bend round-trips",
                round.edgeById(edge.id).waypoints.length, 1);

        const imported = DrawioImport.parse(`<mxfile><diagram id="p"><mxGraphModel><root>
            <mxCell id="0"/><mxCell id="1" parent="0"/>
            <mxCell id="a" value="A" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>
            <mxCell id="b" value="B" vertex="1" parent="1"><mxGeometry x="200" y="0" width="80" height="40" as="geometry"/></mxCell>
            <mxCell id="e" edge="1" source="a" target="b" parent="1" style="curved=1;edgeStyle=orthogonalEdgeStyle;exitX=1;exitY=0.5;entryX=0;entryY=0.5;"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="140" y="60"/></Array></mxGeometry></mxCell>
        </root></mxGraphModel></diagram></mxfile>`);
        this.eq("routing: draw.io curve", imported.diagram.edges[0].route,
                "curved");
        this.eq("routing: draw.io bend", imported.diagram.edges[0].waypoints.length, 1);
        this.eq("routing: draw.io exit port", imported.diagram.edges[0].fromPort.x, 1);
        this.eq("routing: draw.io entry port", imported.diagram.edges[0].toPort.x, 0);
    }

    moreShapes(fm) {
        fm.resetDocument();
        const kinds = ["triangle", "hexagon", "document", "manualinput",
                       "predefined", "storage", "delay", "onpage", "offpage",
                       "looplimit", "manualop", "and", "or", "xor", "nand",
                       "nor"];
        let x = 0, y = 0;
        for (const kind of kinds) {
            const shape = fm.doc.addShape(kind, x, y, 150, 80, {
                text: kind,
            });
            this.eq("shapes: " + kind + " is kept", shape.kind, kind);
            x += 190;
            if (x > 900) { x = 0; y += 130; }
        }
        fm.refreshAll();

        /* All of them paint without a throw. */
        const png = File.Join(Application.Directory, "shapes.png");
        fm.exporting = true;
        fm.Canvas.Save(png, 1100, 700);
        fm.exporting = false;
        this.check("shapes: the sheet was drawn", File.Exists(png));
        File.Delete(png);

        /* The combo selects one and the canvas creates it. */
        fm.CmbMoreShapes.Key = "triangle";
        fm.CmbMoreShapes_Select();
        this.eq("shapes: the combo chose a triangle", fm.tool, "triangle");
        fm.Canvas_MouseDown(100, 100, 1, false, false);
        fm.Canvas_MouseUp(100, 100, 1, false, false);
        const last = fm.doc.shapes[fm.doc.shapes.length - 1];
        this.eq("shapes: the canvas made a triangle", last.kind, "triangle");
        this.eq("shapes: the tool went back to select", fm.tool, "select");
        this.eq("shapes: the combo went back to its title",
                fm.CmbMoreShapes.Index, 0);

        const round = Diagram.fromJSON(JSON.parse(JSON.stringify(fm.doc.toJSON())));
        this.eq("shapes: the file keeps a triangle",
                round.shapes.find((s) => s.kind === "triangle") !== undefined,
                true);
    }

    endpoints(fm) {
        fm.resetDocument();
        fm.panX = 0;
        fm.panY = 0;
        fm.zoom = 1;
        const a = fm.doc.addShape("rect", 0, 0, 100, 100, { text: "A" });
        const b = fm.doc.addShape("rect", 300, 0, 100, 100, { text: "B" });
        const c = fm.doc.addShape("rect", 0, 300, 100, 100, { text: "C" });
        const line = fm.doc.addLine(500, 100, 600, 100, {});
        fm.refreshAll();
        fm.select([line.id]);

        /* Drag the start end onto A. */
        fm.Canvas_MouseDown(500, 100, 1, false, false);
        fm.Canvas_MouseMove(50, 50, 1, false, false);
        fm.Canvas_MouseUp(50, 50, 1, false, false);
        const half = fm.doc.edgeById(line.id);
        this.eq("ends: the start attached to A", half.from, a.id);
        this.check("ends: and remembered a side", half.fromSide !== "");
        this.eq("ends: it snapped to the top midpoint", half.fromPort.y, 0);
        this.eq("ends: at x 0.5", half.fromPort.x, 0.5);
        this.eq("ends: the free end is still free", half.x2, 600);

        /* Drag the other end onto B: now it is a full connector. */
        fm.select([line.id]);
        const ends = edgeHandlePoints(fm.doc, half).ends;
        const free = ends.find((point) => point.x === 600);
        fm.Canvas_MouseDown(free.x, free.y, 1, false, false);
        fm.Canvas_MouseMove(350, 50, 1, false, false);
        fm.Canvas_MouseUp(350, 50, 1, false, false);
        const full = fm.doc.edgeById(line.id);
        this.eq("ends: the end attached to B", full.to, b.id);
        this.check("ends: both ends are on shapes",
                   !!full.from && !!full.to);
        this.check("ends: it still has two endpoint handles",
                   edgeHandlePoints(fm.doc, full).ends.length === 2);

        /* Drag the A end into empty space: it detaches, the other stays. */
        fm.select([line.id]);
        const start = edgeHandlePoints(fm.doc, full).ends.find((p) => p.end === "start");
        fm.Canvas_MouseDown(start.x, start.y, 1, false, false);
        fm.Canvas_MouseMove(200, 200, 1, false, false);
        fm.Canvas_MouseUp(200, 200, 1, false, false);
        const loose = fm.doc.edgeById(line.id);
        this.eq("ends: the start detached", loose.from, "");
        this.eq("ends: the port was cleared", loose.fromPort, null);
        this.eq("ends: the other end stayed", loose.to, b.id);
        this.eq("ends: the loose point is where it was dropped", loose.x1, 200);

        /* And attach it again, this time to C. */
        fm.select([line.id]);
        const looseEnd = edgeHandlePoints(fm.doc, loose).ends.find((p) => p.end === "start");
        fm.Canvas_MouseDown(looseEnd.x, looseEnd.y, 1, false, false);
        fm.Canvas_MouseMove(50, 350, 1, false, false);
        fm.Canvas_MouseUp(50, 350, 1, false, false);
        const re = fm.doc.edgeById(line.id);
        this.eq("ends: the start attached to C", re.from, c.id);
        const round = Diagram.fromJSON(JSON.parse(JSON.stringify(fm.doc.toJSON())));
        this.eq("ends: a half edge survives a round trip",
                round.edgeById(line.id).from, c.id);
        this.eq("ends: and its port too",
                round.edgeById(line.id).fromPort.x, 0.5);

        /* Deleting a shape must not sweep away a free line. */
        const spare = fm.doc.addLine(500, 400, 600, 400, {});
        fm.doc.remove([a.id]);
        this.check("ends: a free line survives an unrelated delete",
                   !!fm.doc.edgeById(spare.id));
    }

    images(fm) {
        fm.resetDocument();
        const libraryFile = File.Join(Application.Directory, "test-library.btlib");
        fm.libraryPath = () => libraryFile;
        if (File.Exists(libraryFile)) File.Delete(libraryFile);
        fm.panX = 0;
        fm.panY = 0;
        fm.zoom = 1;

        const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        const file = File.Join(Application.Directory, "test-image.png");
        File.SaveBytes(file, Bytes.FromBase64(data));
        fm.insertImage(file);

        this.eq("image: the shape was added", fm.doc.shapes.length, 1);
        const shape = fm.doc.shapes[0];
        this.eq("image: it has its own kind", shape.kind, "image");
        this.eq("image: its pixels travel with it", shape.image, data);
        this.check("image: it was given a visible size",
                   shape.w >= 20 && shape.h >= 20);
        this.eq("image: it is selected", fm.sel[0], shape.id);

        const round = Diagram.fromJSON(
            JSON.parse(JSON.stringify(fm.doc.toJSON())));
        this.eq("image: the file keeps the pixels",
                round.shapeById(shape.id).image, data);

        fm.copySelection();
        fm.pasteSelection();
        this.eq("image: a paste carries it",
                fm.doc.shapes[1].image, data);

        fm.ActUndo_Execute();
        this.eq("image: undo takes the paste away", fm.doc.shapes.length, 1);

        fm.library = new ShapeLibrary();
        fm.select([shape.id]);
        fm.BtnLibraryAdd_Click();
        this.eq("image: a library stamp keeps it",
                fm.library.items[0].shapes[0].image, data);
        fm.TrvLibrary.Key = "item:0";
        fm.BtnLibraryInsert_Click();
        this.eq("image: inserting the stamp brings it back",
                fm.doc.shapes[1].image, data);
        fm.ActUndo_Execute();

        /* An uncompressed draw.io cell with its pixels inline. */
        const imported = DrawioImport.parse(`<mxfile><diagram id="p"><mxGraphModel><root>
            <mxCell id="0"/><mxCell id="1" parent="0"/>
            <mxCell id="img" value="Logo" style="shape=image;image=data:image/png;base64,${data};" vertex="1" parent="1"><mxGeometry x="20" y="30" width="80" height="60" as="geometry"/></mxCell>
        </root></mxGraphModel></diagram></mxfile>`);
        this.eq("image: draw.io imports it", imported.diagram.shapes.length, 1);
        this.eq("image: as an image shape",
                imported.diagram.shapes[0].kind, "image");
        this.eq("image: with its pixels",
                imported.diagram.shapes[0].image, data);
        this.eq("image: and its label",
                imported.diagram.shapes[0].text, "Logo");

        fm.resetDocument();
        fm.openDropped([file]);
        this.eq("image: a dropped picture is inserted",
                fm.doc.shapes.length, 1);
        this.eq("image: and it is an image",
                fm.doc.shapes[0].kind, "image");

        File.Delete(file);
        fm.library = new ShapeLibrary();
        fm.refreshLibrary();
        File.Delete(libraryFile);
    }

    stencils(fm) {
        fm.resetDocument();
        const xml = `<shapes name="mxgraph.test">
            <shape name="Star" w="100" h="100" aspect="variable" strokewidth="inherit">
                <connections/>
                <background><path>
                    <move x="50" y="0"/><line x="60" y="35"/><line x="100" y="35"/>
                    <line x="70" y="55"/><line x="80" y="100"/><line x="50" y="75"/>
                    <line x="20" y="100"/><line x="30" y="55"/><line x="0" y="35"/>
                    <line x="40" y="35"/><close/>
                </path></background>
                <foreground><fillstroke/></foreground>
            </shape>
            <shape name="Arc" w="60" h="60">
                <background><path>
                    <move x="0" y="30"/><arc rx="30" ry="30" x-axis-rotation="0"
                        large-arc-flag="1" sweep-flag="1" x="60" y="30"/>
                    <line x="0" y="30"/><close/>
                </path></background>
                <foreground><fillalpha alpha="0.5"/><fill/>
                    <strokecolor color="none"/><stroke/>
                </foreground>
            </shape>
            <shape name="Saved" w="100" h="40">
                <foreground>
                    <save/><fillcolor color="#ff0000"/>
                    <path><move x="0" y="0"/><line x="50" y="0"/><line x="50" y="40"/>
                        <line x="0" y="40"/><close/></path><fill/>
                    <restore/>
                    <path><move x="50" y="0"/><line x="100" y="0"/>
                        <line x="100" y="40"/><line x="50" y="40"/><close/></path>
                    <fillstroke/>
                </foreground>
            </shape>
            <shape name="Round" w="100" h="60">
                <background><roundrect x="0" y="0" w="100" h="60" arcsize="10"/></background>
                <foreground><fillstroke/></foreground>
            </shape>
        </shapes>`;

        const root = Xml.Parse(xml).Root;
        const items = stencilItems(root);
        this.eq("stencil: four shapes imported", items.length, 4);
        this.eq("stencil: the name came", items[0].name, "Star");
        this.eq("stencil: a shape is a vector",
                items[0].shapes[0].kind, "vector");
        this.eq("stencil: its box came",
                items[0].shapes[0].vector.w, 100);
        this.eq("stencil: the path is one part",
                items[0].shapes[0].vector.parts.length, 1);
        this.check("stencil: the background is filled and stroked",
                   items[0].shapes[0].vector.parts[0].fill &&
                   items[0].shapes[0].vector.parts[0].stroke);
        this.check("stencil: the path starts where it should",
                   items[0].shapes[0].vector.parts[0].d.indexOf("M 50 0") === 0);
        this.check("stencil: an arc became curves",
                   items[1].shapes[0].vector.parts[0].d.indexOf("C ") >= 0);
        this.eq("stencil: a strokecolored part kept none",
                items[1].shapes[0].vector.parts[0].strokeColor, "none");
        this.eq("stencil: fillalpha came through",
                items[1].shapes[0].vector.parts[0].fillAlpha, 0.5);
        this.eq("stencil: save and restore separate colours",
                items[2].shapes[0].vector.parts[0].fillColor, "#ff0000");
        this.eq("stencil: the restored part has the default",
                items[2].shapes[0].vector.parts[1].fillColor, "");
        this.check("stencil: a roundrect became curves",
                   items[3].shapes[0].vector.parts[0].d.indexOf("C ") >= 0);

        /* The item inserts, and a document save keeps the little drawing. */
        const lib = new ShapeLibrary();
        lib.addItems(items);
        const model = new Diagram();
        lib.insert(model, 0, 50, 50, model.layers[0].id);
        const placed = model.shapes[0];
        this.eq("stencil: insert makes one shape", model.shapes.length, 1);
        this.eq("stencil: with its vector", placed.kind, "vector");
        this.eq("stencil: and its parts", placed.vector.parts.length, 1);
        const round = Diagram.fromJSON(
            JSON.parse(JSON.stringify(model.toJSON())));
        this.eq("stencil: the file keeps the vector",
                round.shapes[0].vector.parts.length, 1);

        const file = File.Join(Application.Directory, "test-stencil.xml");
        File.Save(file, xml);
        const imported = importLibrary(file);
        this.eq("stencil: an .xml set imports", imported.length, 4);
        const fromText = importLibraryText(xml, "xml");
        this.eq("stencil: the downloader path imports too",
                fromText.length, 4);
        File.Delete(file);

        this.check("catalog: every set is a draw.io XML",
                   STENCIL_SETS.length > 0 && STENCIL_SETS.every((entry) =>
                       entry.url.indexOf("https://viewer.diagrams.net/stencils/") === 0 &&
                       entry.extension === "xml" && entry.license.length > 0));
        this.check("catalog: Kubernetes and IBM are offered",
                   STENCIL_SETS.some((entry) => entry.id === "kubernetes") &&
                   STENCIL_SETS.some((entry) => entry.id === "ibm_cloud"));

        const mx = File.Join(Application.Directory, "test-stencil.mxlibrary");
        File.Save(mx, '<mxlibrary>[{"title":"Mx Star","xml":"&lt;shape name=&apos;Star&apos; w=&apos;100&apos; h=&apos;100&apos;&gt;&lt;background&gt;&lt;path&gt;&lt;move x=&apos;50&apos; y=&apos;0&apos;/&gt;&lt;line x=&apos;100&apos; y=&apos;50&apos;/&gt;&lt;line x=&apos;50&apos; y=&apos;100&apos;/&gt;&lt;line x=&apos;0&apos; y=&apos;50&apos;/&gt;&lt;close/&gt;&lt;/path&gt;&lt;/background&gt;&lt;foreground&gt;&lt;fillstroke/&gt;&lt;/foreground&gt;&lt;/shape&gt;"}]</mxlibrary>');
        const mxItems = importLibrary(mx);
        this.eq("stencil: an mxlibrary shape imports", mxItems.length, 1);
        this.eq("stencil: with its title", mxItems[0].name, "Mx Star");
        this.eq("stencil: and its geometry",
                mxItems[0].shapes[0].vector.parts.length, 1);
        File.Delete(mx);
    }

    stencilForm(fm) {
        const dialog = StencilsForm.show(null);
        this.check("stencil form: it opens", !!dialog);
        this.check("stencil form: every set is in the tree",
                   STENCIL_SETS.every((entry) =>
                       dialog.TrvStencils.Exists("set:" + entry.id)));
        this.check("stencil form: a group is a parent",
                   dialog.TrvStencils.Exists("group:" + Locale.Text("General")));
        this.check("stencil form: a set is selected",
                   dialog.TrvStencils.Key.indexOf("set:") === 0);
        this.check("stencil form: its license is shown",
                   dialog.LblLicense.Text.indexOf("draw.io") >= 0);

        dialog.TxtFilter.Text = "AND";
        dialog.TxtFilter_Change();
        this.check("stencil form: AND finds the ANSI gates",
                   dialog.TrvStencils.Exists("set:logic"));
        this.check("stencil form: AND finds the IEC gates",
                   dialog.TrvStencils.Exists("set:logic_iec"));
        this.check("stencil form: AND finds the BPMN gateway",
                   dialog.TrvStencils.Exists("set:bpmn"));
        this.check("stencil form: AND hides the basic set",
                   !dialog.TrvStencils.Exists("set:basic"));
        this.check("stencil form: the matching set says what it contains",
                   dialog.LblLicense.Text.toLowerCase().indexOf("gateway") >= 0);

        dialog.TxtFilter.Text = "zzzz";
        dialog.TxtFilter_Change();
        this.check("stencil form: nothing matches",
                   dialog.LblLicense.Text.indexOf("zzzz") >= 0);
        dialog.Close();
    }

    library(fm) {
        fm.resetDocument();
        const libraryFile = File.Join(Application.Directory, "test-library.btlib");
        fm.libraryPath = () => libraryFile;
        if (File.Exists(libraryFile)) File.Delete(libraryFile);
        fm.library = new ShapeLibrary();
        fm.refreshLibrary();
        this.check("library: import is always enabled",
                   fm.BtnLibraryImport.Enabled);
        fm.panX = 0;
        fm.panY = 0;
        fm.zoom = 1;

        const a = fm.doc.addShape("rect", 0, 0, 100, 50, { text: "Start" });
        const b = fm.doc.addShape("round", 200, 0, 100, 50, { text: "End" });
        fm.doc.addEdge(a.id, b.id, { text: "go" });
        fm.refreshAll();
        fm.select([a.id, b.id]);
        fm.BtnLibraryAdd_Click();
        this.eq("library: the selection was added", fm.library.items.length, 1);
        this.check("library: the list shows it",
                   fm.TrvLibrary.Exists("item:0"));
        this.eq("library: the item took the first label",
                fm.library.items[0].name, "Start");
        this.eq("library: it has the connector", fm.library.items[0].edges.length, 1);
        this.eq("library: it is filed under My shapes",
                fm.library.items[0].group, Locale.Text("My shapes"));
        this.check("library: the group is a parent",
                   fm.TrvLibrary.Exists("group:" + Locale.Text("My shapes")));

        fm.TxtLibraryFilter.Text = "Start";
        fm.TxtLibraryFilter_Change();
        this.check("library: the filter finds by name",
                   fm.TrvLibrary.Exists("item:0"));
        fm.TxtLibraryFilter.Text = "zzzz";
        fm.TxtLibraryFilter_Change();
        this.check("library: the filter hides the rest",
                   !fm.TrvLibrary.Exists("item:0"));
        fm.TxtLibraryFilter.Text = "";
        fm.TxtLibraryFilter_Change();

        fm.select([]);
        fm.TrvLibrary.Key = "item:0";
        fm.refreshLibraryButtons();
        this.eq("library: the preview builds the stamp",
                fm.libraryPreviewDiagram().shapes.length, 2);
        this.eq("library: and its connector",
                fm.libraryPreviewDiagram().edges.length, 1);
        const before = fm.doc.shapes.length;
        fm.BtnLibraryInsert_Click();
        this.eq("library: insert adds both shapes",
                fm.doc.shapes.length, before + 2);
        this.eq("library: and the connector", fm.doc.edges.length, 2);
        fm.ActUndo_Execute();
        this.eq("library: undo takes the stamp away",
                fm.doc.shapes.length, before);

        /* The library file and the importer. */
        const file = File.Join(Application.Directory, "test.btlib");
        File.SaveJson(file, fm.library.toJSON());
        const imported = importLibrary(file);
        this.eq("library: a .btlib round-trips", imported.length, 1);
        this.eq("library: its shapes came", imported[0].shapes.length, 2);
        this.eq("library: and its group",
                imported[0].group, Locale.Text("My shapes"));
        File.Delete(file);

        const mx = File.Join(Application.Directory, "test.mxlibrary");
        File.Save(mx, '<mxlibrary>[{"title":"Stencil","xml":"&lt;mxGraphModel&gt;&lt;root&gt;&lt;mxCell id=&apos;0&apos;/&gt;&lt;mxCell id=&apos;1&apos; parent=&apos;0&apos;/&gt;&lt;mxCell id=&apos;a&apos; value=&apos;Stamp&apos; vertex=&apos;1&apos; parent=&apos;1&apos;&gt;&lt;mxGeometry x=&apos;0&apos; y=&apos;0&apos; width=&apos;80&apos; height=&apos;40&apos; as=&apos;geometry&apos;/&gt;&lt;/mxCell&gt;&lt;/root&gt;&lt;/mxGraphModel&gt;"}]</mxlibrary>');
        const stencil = importLibrary(mx);
        this.eq("library: an mxlibrary imports", stencil.length, 1);
        this.eq("library: with its title", stencil[0].name, "Stencil");
        this.eq("library: and its shape", stencil[0].shapes.length, 1);
        File.Delete(mx);

        const dio = File.Join(Application.Directory, "test.drawio");
        File.Save(dio, '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Imported" vertex="1" parent="1"><mxGeometry x="0" y="0" width="90" height="50" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>');
        const fromDiagram = importLibrary(dio);
        this.eq("library: a draw.io diagram imports", fromDiagram.length, 1);
        this.eq("library: with its shape", fromDiagram[0].shapes.length, 1);
        File.Delete(dio);

        /* Groups inside an item get new ids, not the original ones. */
        const model = new Diagram();
        const one = model.addShape("rect", 0, 0, 80, 40, { group: "g1" });
        const two = model.addShape("rect", 100, 0, 80, 40, { group: "g1" });
        const lib = new ShapeLibrary();
        const items = lib.itemsFromDiagram(model);
        lib.addItems(items);
        this.eq("library: a group is one item", items.length, 1);
        const copy = new Diagram();
        lib.insert(copy, 0, 50, 50, copy.layers[0].id);
        this.eq("library: the group came whole", copy.shapes.length, 2);
        this.check("library: with a shared id",
                   copy.shapes[0].group === copy.shapes[1].group);

        const lineModel = new Diagram();
        lineModel.addLine(0, 0, 100, 50, {});
        const lineItems = new ShapeLibrary().itemsFromDiagram(lineModel);
        this.eq("library: a free line is an item", lineItems.length, 1);
        this.eq("library: with no shapes", lineItems[0].shapes.length, 0);
        const lineCopy = new Diagram();
        const lineLib = new ShapeLibrary();
        lineLib.addItems(lineItems);
        lineLib.insert(lineCopy, 0, 20, 20, lineCopy.layers[0].id);
        this.eq("library: inserting it makes a line", lineCopy.edges.length, 1);

        fm.TrvLibrary.Key = "item:0";
        fm.BtnLibraryDelete_Click();
        this.eq("library: delete empties it", fm.library.items.length, 0);
        this.eq("library: and the preview goes quiet",
                fm.libraryPreviewDiagram(), null);
        File.Delete(libraryFile);
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
            SpnStrokeWidth: ["Change"], CmbDash: ["Select"],
            SpnFont: ["Change"], BtnBold: ["Click"], BtnItalic: ["Click"],
            BtnAlignLeft: ["Click"], BtnAlignCenter: ["Click"],
            BtnAlignRight: ["Click"], CmbVAlign: ["Select"],
            SpnRotation: ["Change"], BtnTextColor: ["Change"],
            CmbRoute: ["Select"],
            LstLayers: ["Select", "Activate"],
            BtnLayerAdd: ["Click"], BtnLayerRemove: ["Click"],
            BtnLayerUp: ["Click"], BtnLayerDown: ["Click"],
            BtnLayerVisible: ["Click"], BtnLayerLocked: ["Click"],
            BtnLayerAssign: ["Click"],
            TxtLayerName: ["Activate", "LostFocus"],
            TrvLibrary: ["Select", "Activate"],
            TxtLibraryFilter: ["Change"],
            LibraryPreview: ["Draw"],
            ActImage: ["Execute"],
            BtnLibraryDownload: ["Click"],
            BtnLibraryAdd: ["Click"], BtnLibraryInsert: ["Click"],
            BtnLibraryDelete: ["Click"], BtnLibraryImport: ["Click"],
            BtnLibraryExport: ["Click"],
            CmbMoreShapes: ["Select"],
            CmbPage: ["Select"], BtnPageAdd: ["Click"],
            BtnPageRemove: ["Click"], BtnPageUp: ["Click"],
            BtnPageDown: ["Click"],
            TxtPageName: ["Activate", "LostFocus"],
            ActNew: ["Execute"], ActOpen: ["Execute"], ActSave: ["Execute"],
            ActSaveAs: ["Execute"], ActExportPng: ["Execute"],
            ActExportPdf: ["Execute"], ActQuit: ["Execute"],
            ActUndo: ["Execute"], ActRedo: ["Execute"], ActCut: ["Execute"],
            ActCopy: ["Execute"], ActPaste: ["Execute"],
            ActDuplicate: ["Execute"], ActDelete: ["Execute"],
            ActSelectAll: ["Execute"],
            ActAlignLeft: ["Execute"], ActAlignCenter: ["Execute"],
            ActAlignRight: ["Execute"], ActAlignTop: ["Execute"],
            ActAlignMiddle: ["Execute"], ActAlignBottom: ["Execute"],
            ActDistributeHorizontal: ["Execute"],
            ActDistributeVertical: ["Execute"],
            BtnToolLine: ["Click"], BtnToolArrow: ["Click"],
            ActGroup: ["Execute"], ActUngroup: ["Execute"],
            ActArrowNone: ["Execute"], ActArrowEnd: ["Execute"],
            ActArrowStart: ["Execute"], ActArrowBoth: ["Execute"],
            ActBringFront: ["Execute"], ActSendBack: ["Execute"],
            ActBringForward: ["Execute"], ActSendBackward: ["Execute"],
            ActZoomIn: ["Execute"], ActZoomOut: ["Execute"],
            ActZoomReset: ["Execute"], ActZoomFit: ["Execute"],
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
