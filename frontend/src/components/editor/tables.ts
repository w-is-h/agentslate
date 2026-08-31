/* markdown tables in live preview: the whole Table node collapses into a
   block widget rendered by mdlite — the app's one markdown renderer, so
   a table reads identically here and in any prose view (shared
   .prose/.cm-lm-table selectors in index.css; the prose class itself
   stays off the widget — its max-width and block rules don't belong
   inside the editor). The cursor
   entering the table (click a row, arrow in) reveals the source; leaving
   collapses it back. Cell-level grid editing is deliberately absent —
   the source is the editor.

   Block-spanning replace decorations must come from a StateField (a
   ViewPlugin may not replace line breaks), which also can't see focus —
   a focusChangeEffect relays it in. */

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { mdlite } from "@/lib/mdlite";
import { frozenField } from "./freeze";

const setFocus = StateEffect.define<boolean>();

const focusField = StateField.define<boolean>({
  create: () => false,
  update(prev, tr) {
    for (const e of tr.effects) if (e.is(setFocus)) return e.value;
    return prev;
  },
});

class TableWidget extends WidgetType {
  readonly src: string;
  constructor(src: string) { super(); this.src = src; }
  eq(o: TableWidget) { return o.src === this.src; }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-lm-table";
    el.innerHTML = mdlite(this.src);
    // click a row → cursor lands on that row's source line, revealing it
    el.addEventListener("mousedown", e => {
      e.preventDefault();
      const from = view.posAtDOM(el);
      if (from < 0) return;
      const tr = e.target instanceof Element ? e.target.closest("tr") : null;
      const rows = Array.from(el.querySelectorAll("tr"));
      const i = tr ? rows.indexOf(tr) : -1;
      // header = source line 0; body row i sits below header + delimiter
      const line = doc0(view, from) + (i <= 0 ? 0 : i + 1);
      const pos = view.state.doc.line(Math.min(line, view.state.doc.lines)).from;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    });
    return el;
  }
}

const doc0 = (view: EditorView, pos: number) => view.state.doc.lineAt(pos).number;

function buildTables(state: EditorState, hasFocus: boolean): DecorationSet {
  const doc = state.doc;
  const ranges: Range<Decoration>[] = [];
  const active = new Set<number>();
  if (hasFocus)
    for (const r of state.selection.ranges) {
      const last = doc.lineAt(r.to).number;
      for (let n = doc.lineAt(r.from).number; n <= last; n++) active.add(n);
    }
  const tree = ensureSyntaxTree(state, doc.length, 50) ?? syntaxTree(state);
  tree.iterate({
    enter: node => {
      if (node.name !== "Table") return;
      const first = doc.lineAt(node.from).number, last = doc.lineAt(node.to).number;
      for (let n = first; n <= last; n++)
        if (active.has(n)) return false; // revealed: plain source
      ranges.push(Decoration.replace({
        widget: new TableWidget(doc.sliceString(node.from, node.to)), block: true,
      }).range(node.from, node.to));
      return false;
    },
  });
  return Decoration.set(ranges);
}

const tableField = StateField.define<DecorationSet>({
  create: state => buildTables(state, false),
  update(deco, tr) {
    let focus: boolean | null = null;
    for (const e of tr.effects) if (e.is(setFocus)) focus = e.value;
    const frozen = tr.state.field(frozenField, false) ?? false;
    const thawed = (tr.startState.field(frozenField, false) ?? false) && !frozen;
    if (tr.docChanged || thawed || focus !== null || (tr.selection && !frozen))
      return buildTables(tr.state, focus ?? tr.state.field(focusField));
    return deco.map(tr.changes);
  },
  provide: f => EditorView.decorations.from(f),
});

export function tables(): Extension {
  return [
    focusField,
    EditorView.focusChangeEffect.of((_s, focusing) => setFocus.of(focusing)),
    tableField,
  ];
}
