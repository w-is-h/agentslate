/* the livemd editor as a React component. An uncontrolled CM6 view owns
   the text; `value` syncs in only while the editor is unfocused, so a
   poll re-render can never clobber typing mid-word. */

import { useEffect, useRef } from "react";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, placeholder as cmPlaceholder } from "@codemirror/view";
import { linkHref, linkOpener, livemd } from "./preview";
import { cn } from "@/lib/utils";

/* marks a change that came from the server, not the keyboard */
const external = Annotation.define<boolean>();

/* put a server value into the view, marked external */
const syncDoc = (v: EditorView, value: string) => {
  const cur = v.state.doc.toString();
  if (value !== cur)
    v.dispatch({ changes: { from: 0, to: cur.length, insert: value }, annotations: external.of(true) });
};

interface Props {
  value: string;
  onChange?: (v: string) => void;
  /* Add rendered HTML beside the Markdown source on the clipboard. */
  copyHtml?: (markdown: string) => string;
  /* claim a clicked link target before the default rules (#/ navigates,
     the world opens a tab) — return true when handled */
  onLink?: (url: string) => boolean;
  /* map a raw link target to the href its rendered <a> carries (memory
     keys → "#/memory/…"); null falls through to the default rules */
  hrefFor?: (url: string) => string | null;
  placeholder?: string;
  autoFocus?: boolean;
  readOnly?: boolean; // same view, editing off — a locked canvas stays pixel-identical
  className?: string;
  style?: React.CSSProperties;
}

const roExt = (on?: boolean) =>
  on ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];

export default function LiveMd({ value, onChange, copyHtml, onLink, hrefFor, placeholder, autoFocus, readOnly, className, style }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const renderCopy = useRef(copyHtml);
  renderCopy.current = copyHtml;
  const link = useRef(onLink);
  link.current = onLink;
  const href = useRef(hrefFor);
  href.current = hrefFor;
  const ro = useRef(new Compartment());
  const latest = useRef(value);
  latest.current = value;

  // one view for the component's life; value/placeholder seed it
  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          livemd(),
          EditorView.domEventHandlers({
            // a value that arrived mid-focus was skipped — catch up the
            // moment focus leaves. While a draft is pending, `value` is the
            // user's own text, so this can never undo typing.
            blur(_event, view) {
              syncDoc(view, latest.current);
            },
            copy(event, view) {
              const render = renderCopy.current;
              if (!render || !event.clipboardData) return false;
              const selected = view.state.selection.ranges
                .filter(range => !range.empty)
                .map(range => view.state.sliceDoc(range.from, range.to));
              if (!selected.length) {
                let lastLine = -1;
                for (const range of view.state.selection.ranges) {
                  const line = view.state.doc.lineAt(range.from);
                  if (line.number > lastLine) selected.push(line.text);
                  lastLine = line.number;
                }
              }
              const markdown = selected.join(view.state.lineBreak);
              event.clipboardData.clearData();
              event.clipboardData.setData("text/plain", markdown);
              event.clipboardData.setData("text/html", render(markdown));
              return true;
            },
          }),
          linkOpener.of(url => link.current?.(url) ?? false),
          linkHref.of(url => href.current?.(url) ?? null),
          ro.current.of(roExt(readOnly)),
          placeholder ? cmPlaceholder(placeholder) : [],
          EditorView.updateListener.of(u => {
            // only the user's own edits reach onChange — a value flowing in
            // from the server is marked external, or it would be posted
            // straight back and overwrite whatever the agent wrote meanwhile
            if (u.docChanged && !u.transactions.some(t => t.annotation(external)))
              change.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    if (autoFocus) v.focus();
    return () => { v.destroy(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // lock toggles on a live view — reconfigure, never remount
  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure(roExt(readOnly)) });
  }, [readOnly]);

  // external value changes flow in only while the editor is idle; one that
  // lands mid-focus waits in `latest` for the blur handler above
  useEffect(() => {
    const v = view.current;
    if (!v || v.hasFocus) return;
    syncDoc(v, value);
  }, [value]);

  // clicks on the dead space around the text (the stretch below a short
  // doc) still mean "edit": focus with the caret at the end — which for an
  // empty doc is the beginning. Real text clicks stay CM's.
  const down = (e: React.MouseEvent) => {
    const v = view.current;
    if (!v || !change.current || readOnly) return;
    if (e.target instanceof Node && v.contentDOM.contains(e.target)) return;
    e.preventDefault();
    v.focus();
    v.dispatch({ selection: { anchor: v.state.doc.length } });
  };

  return <div ref={host} style={style} onMouseDown={down} className={cn("cm-lm", className)} />;
}
