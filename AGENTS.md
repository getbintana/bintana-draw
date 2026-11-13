# Working on bintana-draw

A Bintana application, so the rules of that tree apply: forms are JSON, one
class per form, handlers are `<Control>_<Event>`, and there is no build step.
The runtime is a separate checkout; `bintana` on the `PATH` is the one this
project presumes.

```
bintana .
bintana . examples/flow.draw
bintana check --strict .
BINTANA=/path/to/build/bintana tests/run.sh
```

`tests/run.sh` runs both checks and then the self-check under `xvfb-run`.

## The files that matter

- `Diagram.js` — the book, its pages, each page's layers, and the geometry.
  `Document` holds the pages and the active index; `Diagram` is one page. It
  imports no widget and is exercised with no display.
- `DrawioImport.js` — an uncompressed draw.io file mapped onto a `Diagram`.
  Compressed pages are refused on purpose; there is no deflate verb here.
- `Render.js` — the only painter code. The screen and the export are the same
  routine with different transforms.
- `MainForm.js` — the tool, the selection, the gesture, the file and the undo
  history. No drawing beyond the overlay text editor.
- `MainForm.form` — menus, actions, toolbar, palette, canvas and status bar.

## Traps this project has already met

- **A `DrawingArea` has no natural size.** HAlign Fill leaves it at its declared
  100×100. `fitCanvas()` copies the stage allocation into it on `Allocated` and
  on every `Form_Resize`.
- **Assigning `ToggleButton.Active` raises `Click`.** `chooseTool` sets a
  `syncingTools` guard or the palette recurses until the stack ends.
- **Assigning `ColorButton.Value` raises `Change`.** `syncingColors` is the
  same guard.
- **A handler whose control name is misspelled is silently dead.** The
  self-check asserts every handler in `wiring()` from the form side.
- **One gesture is one undo step.** Snapshot on the press, `pushUndo` on the
  release; never per `MouseMove`.
- **Alignment guides are a second snap, after the grid.** `guideMove` and
  `guideResize` nudge a grid-snapped rectangle onto a neighbour's edge or
  centre; the alignment wins, so a snapped shape may sit off the 10-unit grid.
  The guide lines live in `this.guides` and are cleared on release, cancel and
  Escape.
- **Menu accelerators must not take keys from the inline editor.**
  `editingOwnsKeys()` guards cut, copy, paste, delete, duplicate, select-all,
  undo and redo.
- **Translations are extracted from literals.** A message goes through
  `Locale.Text` as a single string; the extractor cannot see a concatenation.
- **The self-check references the real sources with `../../`**, not copies:
  `bintana check` scans the whole tree and duplicate exports are a warning.
- **An imported `.drawio` is not the save path.** `this.path` stays empty and
  `importedFrom` keeps the source for the title and the Save As name; otherwise
  Ctrl+S would write JSON over the original XML.
- **A layer is part of the page, the active layer is not.** `Diagram.layers`
  carries name, visibility and lock, and every shape and edge names one. The
  active layer lives on the form; `ensureActiveLayer` puts it back after an undo
  or an open. A hidden layer is out of the bounds and out of hit testing; a
  locked one is drawn but `canSelect` refuses it, and an edge whose endpoint
  hides hides with it.
- **Text alignment is stored in lower case and the painter wants Title case.**
  `s.textAlign` is `"left"`, `"center"` or `"right"`; `Painter.Text` wants
  `"Left"`, `"Center"` or `"Right"`, and a wrong one is a `RangeError` from the
  native call, not a silent fallback.
- **A group is a selection rule, not a container.** `shape.group` is an id;
  `select` and `toggleSelection` expand it through `expandGroups`, so every
  gesture sees the whole group. Moving and copying work because the selection
  holds every member; resizing does not, because more than one shape is
  selected and handles only appear for one. A paste must remap group ids, or
  the copy joins the original group.
- **An edge route is one of three things.** With no waypoints and
  `route === "orthogonal"` it is the automatic right-angled path; otherwise the
  control points are the anchors plus the waypoints, `straight` joins them and
  `curved` samples a Catmull-Rom through them. The hollow midpoint handle adds a
  bend only when dragged (`addBend` waits for 3 px), so a double-click at the
  middle still reaches the label editor.
- **A free line is an edge with no shapes.** `from` and `to` are empty and the
  geometry is `x1/y1/x2/y2`; `edgeRoute` returns those two points, `layerVisible`
  does not look for endpoints, and `bounds` includes them. Copy/paste has to
  branch on the empty ends or it drops the line.
- **A rotated shape is drawn, hit-tested and bounded through its centre.** The
  model keeps `x/y/w/h` unrotated; `shapeRectBounds` is the axis-aligned box the
  canvas and the export use, `pointInShape` inverse-rotates the pointer, and
  `sideAnchor` rotates the connector anchor. Resize handles are hidden while a
  shape is rotated (`handleAt` refuses), so the geometry stays honest.
- **The format bar writes defaults as well as the selection.** A change with
  nothing selected is the style the next shape gets; a change with something
  selected is one undo step and also becomes the default. `syncingFormat`
  guards the round trip of every control.
- **A snapshot is the whole book.** `snapshot()` serializes `Document`, not the
  active page: an undo of a page add, delete or rename has to put back every
  page. `applySnapshot` restores `book.active` and makes `this.doc` the page it
  names; a test that assigns `fm.doc` directly would be editing a page the undo
  history does not know.

## Style

Follow the sibling projects: four spaces, `"use strict";`, comments that say why
rather than what, and `Locale.Text` around every word a person reads. `po/es.po`
is the Spanish catalogue; the app's default language is the desktop's.
