# Bintana Draw

A diagram editor for the desktop: boxes, decisions, notes and connectors on an
infinite canvas, in one Bintana window and nothing else. A sibling of the
[Bintana](https://github.com/getbintana/bintana) tree, not part of it.

![Bintana Draw](docs/bintana-draw.png)

It is the shape a person reaches for when the drawing is a flowchart rather
than a document: drag a rectangle, drag a diamond beside it, join them with an
arrow, double-click to write inside. Save the result as a `.draw` file that is
plain JSON, or export a PNG or a PDF to put in a mail.

## Running it

With a built `bintana` (on your `PATH`, or `build/bintana` from a checkout):

```sh
bintana bintana-draw
bintana bintana-draw examples/flow.draw
```

The file is optional; it opens that diagram, and `File > Open` opens another.
The window is started with a blank canvas and the shape palette on the left.

## What it does

- **Shapes** — rectangle, rounded rectangle, ellipse, decision diamond,
  terminator, data parallelogram, database cylinder, note and free text. Pick
  one and click for the default size or drag to size it.
- **Connectors** — the connector tool, dragged from one shape to another,
  produces an orthogonal route that follows both shapes when they move or
  resize. Connectors can be labelled and can be dashed.
- **Text** — double-click a shape or a connector and the editor opens over it.
  Enter or clicking away keeps the text; Escape puts it back.
- **Selection** — click, Shift-click, or drag a rubber band. Drag a selected
  shape to move the selection; drag a handle to resize the one shape selected.
  Shift constrains a move to one axis.
- **Style** — fill and line colour apply to the selection, and set the default
  for the next shape when nothing is selected.
- **Undo and redo** — every gesture is one step: a drag through forty motions is
  one thing to take back, not forty. The title bar's dot is the unsaved mark.
- **View** — zoom in and out from the toolbar or with `+`/`-`, fit the diagram,
  pan with the middle button, scroll with the wheel, and toggle the grid from
  the View menu.
- **Files** — `.draw` is JSON, written atomically. The application asks before
  throwing unsaved work away; a diagram dropped on the window opens. Export is
  PNG (at twice the diagram's size) or A4 landscape PDF.
- **Spanish** — the whole interface is in `po/es.po`; run it with
  `LANGUAGE=es bintana bintana-draw`.

## Keyboard and mouse

| | |
|---|---|
| `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` | New, open, save, save as |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo, redo |
| `Ctrl+X` / `Ctrl+C` / `Ctrl+V` / `Ctrl+D` | Cut, copy, paste, duplicate |
| `Delete` | Delete the selection |
| `Ctrl+A` | Select all shapes and connectors |
| Arrow keys / `Shift`+arrows | Move the selection 10 / 1 units |
| `+` / `-` / `0` | Zoom in, zoom out, actual size |
| Middle drag | Pan |
| Wheel | Scroll |
| Double-click | Edit the text of a shape or connector |

The Help menu has the same list.

## The `.draw` file

One object, two arrays, and numbers in canvas units on an unbounded plane:

```json
{
  "format": "bintana-draw/1",
  "version": 1,
  "shapes": [
    { "id": "s1", "kind": "rect", "x": 40, "y": 40, "w": 160, "h": 70,
      "text": "Start", "fill": "#dae8fc", "stroke": "#6c8ebf",
      "textColor": "#1f2937", "fontSize": 12, "radius": 12 }
  ],
  "edges": [
    { "id": "e1", "from": "s1", "to": "s2", "text": "yes",
      "stroke": "#6c8ebf", "dashed": false, "fontSize": 11 }
  ]
}
```

A file is read with `Diagram.fromJSON`, which refuses a foreign `format`,
clamps sizes, drops connectors whose ends are missing and renumbers colliding
ids. That is also the whole of the format's documentation.

## The project

```
Diagram.js       the document and its geometry -- no widgets
Render.js        the canvas and the export, as one painter routine
MainForm.form    the window: menus, toolbar, palette, canvas, status bar
MainForm.js      the hand: tool, selection, gesture, file, undo
ConfirmForm.*    save / discard / cancel
tests/selfcheck  a project that drives the real window and quits with a status
```

Two design notes worth knowing before changing it:

- **The canvas is a world with a transform.** `panX`, `panY` and `zoom` convert
  screen points once; shapes store world coordinates. An export sets
  `exporting`, and `Canvas_Draw` paints the same document fitted to white paper.
- **A `DrawingArea` has no natural size.** HAlign Fill leaves it at the width it
  was declared with, so `fitCanvas()` copies the stage's allocation into it
  whenever the stage changes size.

## Checking it

```sh
bintana check .
bintana check --strict .
bintana check tests/selfcheck
```

The self-check opens the real form under a virtual display and drives it through
the handlers the runtime would call -- drags a rectangle, connects it, edits its
text, saves and reopens the file, undoes and redoes -- then prints a count and
quits with `0` or `1`:

```sh
xvfb-run -a bintana tests/selfcheck
```

It also asserts that every handler the window depends on is wired, because a
handler whose control name is misspelled is silently dead.

## What it does not do yet

This is a first editor, not a draw.io replacement. Missing, in the order they
would change what a person can draw: custom shape libraries and stencils,
alignment guides and distribute commands, layers and multiple pages, curved
connectors with movable waypoints, images and icons, system-clipboard
interchange with other applications, SVG import/export, and collaboration.
There is no autosave and no recovery file; the unsaved-changes question is the
whole of the safety net.

## Licence

MIT — see [LICENSE](LICENSE).

Bintana itself is MIT; QuickJS-ng and GTK4 carry their own licences.
