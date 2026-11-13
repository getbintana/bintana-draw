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

## The four files that matter

- `Diagram.js` — the document and its geometry. It imports no widget and is
  exercised with no display.
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

## Style

Follow the sibling projects: four spaces, `"use strict";`, comments that say why
rather than what, and `Locale.Text` around every word a person reads. `po/es.po`
is the Spanish catalogue; the app's default language is the desktop's.
