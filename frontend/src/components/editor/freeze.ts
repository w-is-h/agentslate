/* pointer-freeze: while the mouse is down (and for a beat after), reveal
   decorations hold still. Without it, clicking a heading reveals the `# `
   prefix mid-click and the text shifts under the pointer — sometimes
   turning the click into a micro-drag. Shared by the inline preview and
   the table field. */

import { EditorSelection, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

export const setFrozen = StateEffect.define<boolean>();

export const frozenField = StateField.define<boolean>({
  create: () => false,
  update(prev, tr) {
    for (const e of tr.effects) if (e.is(setFrozen)) return e.value;
    return prev;
  },
});

const FREEZE_TAIL_MS = 100;
const DRAG_THRESHOLD_PX = 3;

/* A drag that begins at the first rendered character can land just after a
   hidden block prefix. Include that prefix before the decorations thaw, so
   the source that reappears is part of the selection. */
function blockPrefixStart(state: EditorState, pos: number): number | null {
  const line = state.doc.lineAt(pos);
  const text = line.text;
  let end = 0;
  let found = false;

  // Nested blockquotes may carry another block prefix after their marks.
  while (true) {
    const quote = text.slice(end).match(/^ {0,3}> ?/);
    if (!quote) break;
    end += quote[0].length;
    found = true;
  }

  const rest = text.slice(end);
  const heading = rest.match(/^ {0,3}#{1,6} /);
  const list = rest.match(/^\s*[-+*] (?:\[[ xX]\] )?/);
  if (heading) { end += heading[0].length; found = true; }
  else if (list) { end += list[0].length; found = true; }

  return found && pos === line.from + end ? line.from : null;
}

function includeDraggedBlockPrefix(state: EditorState): EditorSelection | null {
  let changed = false;
  const ranges = state.selection.ranges.map(range => {
    if (range.empty) return range;
    const from = blockPrefixStart(state, range.from);
    if (from == null) return range;
    changed = true;
    return EditorSelection.range(
      range.anchor === range.from ? from : range.anchor,
      range.head === range.from ? from : range.head,
    );
  });
  return changed ? EditorSelection.create(ranges, state.selection.mainIndex) : null;
}

export const freezePlugin = ViewPlugin.fromClass(
  class {
    private down = false;
    private dragged = false;
    private downX = 0;
    private downY = 0;
    private timer: number | null = null;

    private readonly onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target;
      if (!(t instanceof Node) || !this.view.contentDOM.contains(t)) return;
      this.down = true;
      this.dragged = false;
      this.downX = e.clientX;
      this.downY = e.clientY;
      if (this.timer != null) { clearTimeout(this.timer); this.timer = null; }
      if (!this.view.state.field(frozenField))
        this.view.dispatch({ effects: setFrozen.of(true) });
    };

    private readonly onMove = (e: PointerEvent) => {
      if (!this.down || this.dragged) return;
      const dx = e.clientX - this.downX, dy = e.clientY - this.downY;
      if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX)
        this.dragged = true;
    };

    private readonly onUp = (e: PointerEvent) => {
      if (!this.down) return;
      const normalize = e.type === "pointerup" && this.dragged;
      this.down = false;
      if (this.timer != null) clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        this.timer = null;
        try {
          const selection = normalize
            ? includeDraggedBlockPrefix(this.view.state)
            : null;
          this.view.dispatch({
            ...(selection ? { selection } : {}),
            effects: setFrozen.of(false),
          });
        }
        catch { /* view destroyed while the timer was pending */ }
      }, FREEZE_TAIL_MS);
    };

    readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      // capture phase: the freeze must land before CM's own pointerdown
      // moves the selection and rebuilds decorations
      view.dom.addEventListener("pointerdown", this.onDown, true);
      window.addEventListener("pointermove", this.onMove);
      window.addEventListener("pointerup", this.onUp);
      window.addEventListener("pointercancel", this.onUp);
    }

    destroy() {
      this.view.dom.removeEventListener("pointerdown", this.onDown, true);
      window.removeEventListener("pointermove", this.onMove);
      window.removeEventListener("pointerup", this.onUp);
      window.removeEventListener("pointercancel", this.onUp);
      if (this.timer != null) clearTimeout(this.timer);
    }
  },
);
