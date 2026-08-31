/* livemd — obsidian-style live preview over plain markdown (concept
   study: atomic-editor, MIT — rebuilt small).

   The document stays plain markdown text throughout. Block styling rides
   on line classes applied unconditionally, so a reveal never changes
   line heights; syntax marks (`# `, `**`, backticks, link plumbing) hide
   behind replace decorations except in the construct under the cursor or
   across a selection. A rendered link opens on plain click (cursor enters
   via keyboard or an adjacent click — obsidian's own behavior); checkboxes
   toggle in place. Tables are the sibling module (tables.ts). */

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  Facet, Prec, type EditorState, type Extension, type Range, type Text,
} from "@codemirror/state";
import {
  Decoration, EditorView, ViewPlugin, WidgetType, keymap,
  type DecorationSet, type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import type { SyntaxNode, Tree } from "@lezer/common";
import { freezePlugin, frozenField } from "./freeze";
import { tables } from "./tables";

const LINE_CLASS: Record<string, string> = {
  ATXHeading1: "cm-lm-h1", ATXHeading2: "cm-lm-h2", ATXHeading3: "cm-lm-h3",
  ATXHeading4: "cm-lm-h4", ATXHeading5: "cm-lm-h5", ATXHeading6: "cm-lm-h6",
  SetextHeading1: "cm-lm-h1", SetextHeading2: "cm-lm-h2",
  Blockquote: "cm-lm-quote", FencedCode: "cm-lm-code",
};

const MARK_CLASS: Record<string, string> = {
  // Link is handled explicitly in build() — it renders as a real <a>
  StrongEmphasis: "cm-lm-strong", Emphasis: "cm-lm-em",
  InlineCode: "cm-lm-icode", Strikethrough: "cm-lm-strike",
};

const HIDE = new Set([
  "HeaderMark", "EmphasisMark", "CodeMark", "CodeInfo",
  "StrikethroughMark", "QuoteMark", "LinkMark", "URL", "LinkTitle",
]);

const REVEAL_OWNER = new Set([
  "ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4",
  "ATXHeading5", "ATXHeading6", "SetextHeading1", "SetextHeading2",
  "StrongEmphasis", "Emphasis", "InlineCode", "Strikethrough", "Link",
  "ListItem", "Blockquote", "FencedCode", "HorizontalRule",
]);

function nodeKey(node: SyntaxNode): string {
  return `${node.name}:${node.from}:${node.to}`;
}

function revealOwner(node: SyntaxNode): SyntaxNode | null {
  for (let p = node.parent; p; p = p.parent)
    if (REVEAL_OWNER.has(p.name)) return p;
  return null;
}

function activeRevealOwners(tree: Tree, state: EditorState): Set<string> {
  const owners: SyntaxNode[] = [];
  tree.iterate({
    enter: node => {
      if (REVEAL_OWNER.has(node.name)) owners.push(node.node);
    },
  });

  const active = new Set<string>();
  for (const range of state.selection.ranges) {
    if (range.empty) {
      let smallest: SyntaxNode | null = null;
      for (const owner of owners) {
        if (range.head < owner.from || range.head > owner.to) continue;
        if (!smallest || owner.to - owner.from < smallest.to - smallest.from)
          smallest = owner;
      }
      if (smallest) active.add(nodeKey(smallest));
      continue;
    }
    for (const owner of owners)
      if (range.from < owner.to && range.to > owner.from)
        active.add(nodeKey(owner));
  }
  return active;
}

// children of a Link follow the cursor-inside-the-link rule — a link stays
// rendered while another construct on the same line is being edited
const LINK_CHILD = new Set(["LinkMark", "URL", "LinkTitle"]);

/* the destination URL of a link — the one after the closing `]`. A link
   whose visible label is itself a URL has two URL children; hiding both
   would erase the label. */
function linkUrl(link: SyntaxNode, doc: Text): string {
  const close = link.getChildren("LinkMark")
    .find(m => doc.sliceString(m.from, m.to) === "]");
  const url = close
    ? link.getChildren("URL").find(u => u.from >= close.to)
    : link.getChildren("URL")[0];
  return url ? doc.sliceString(url.from, url.to) : "";
}

class Bullet extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-lm-bullet";
    s.textContent = "•";
    return s;
  }
  ignoreEvent() { return false; }
}
const BULLET = new Bullet();

class Checkbox extends WidgetType {
  readonly checked: boolean;
  constructor(checked: boolean) { super(); this.checked = checked; }
  eq(o: Checkbox) { return o.checked === this.checked; }
  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-lm-check";
    input.setAttribute("contenteditable", "false");
    input.addEventListener("mousedown", e => { e.preventDefault(); e.stopPropagation(); });
    input.addEventListener("click", e => {
      e.preventDefault(); e.stopPropagation();
      const pos = view.posAtDOM(input);
      if (pos < 0) return;
      // the widget replaces "- [x]" — find the box within that slice
      const m = view.state.doc.sliceString(pos, pos + 8).match(/\[[ xX]\]/);
      if (m?.index == null) return;
      const from = pos + m.index;
      const checked = /x/i.test(view.state.doc.sliceString(from, from + 3));
      view.dispatch({ changes: { from, to: from + 3, insert: checked ? "[ ]" : "[x]" } });
    });
    return input;
  }
  ignoreEvent(e: Event) { return e.type === "mousedown" || e.type === "click"; }
}

class Rule extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-lm-hr";
    return s;
  }
}
const HR = new Rule();

/* an image link — [name.png](/api/images/<id>) — renders as a small
   thumbnail while the cursor is elsewhere; the cursor inside reveals the
   plain source (the link rule, applied to pictures). eq on url keeps the
   <img> node stable across rebuilds — decorations rebuild on every
   selection change, and a fresh img would flicker and refetch. */
class ImageThumb extends WidgetType {
  readonly url: string;
  readonly name: string;
  constructor(url: string, name: string) { super(); this.url = url; this.name = name; }
  eq(o: ImageThumb) { return o.url === this.url && o.name === this.name; }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-lm-thumbwrap";
    const img = document.createElement("img");
    img.src = this.url;
    img.alt = this.name;
    img.title = this.name;
    img.className = "cm-lm-thumb";
    // hover button, top right: the full image in a new tab — clicking the
    // picture itself still lands the cursor (source reveal)
    const btn = document.createElement("button");
    btn.className = "cm-lm-thumbopen";
    btn.title = "open the image";
    btn.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'
      + '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>'
      + '<line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
    btn.addEventListener("mousedown", e => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      // the app-wide lightbox (GlobalLightbox in bits.tsx) — same view
      // the nest galleries open
      document.dispatchEvent(new CustomEvent("slate-lightbox",
        { detail: { src: this.url, alt: this.name } }));
    });
    wrap.append(img, btn);
    return wrap;
  }
  // the button's events are the widget's own; picture clicks go to CM
  ignoreEvent(e: Event) {
    return e.target instanceof Element && !!e.target.closest(".cm-lm-thumbopen");
  }
}

/* ViewPlugin replace decorations may not cross a line break (CM throws),
   but lezer tokens can (a LinkTitle wrapping two lines) — split per line;
   only the first segment carries the widget, if any. */
function pushReplace(
  ranges: Range<Decoration>[], doc: Text, from: number, to: number,
  spec: Parameters<typeof Decoration.replace>[0] = {},
) {
  if (from >= to) return;
  let cur = from, first = true;
  while (cur < to) {
    const line = doc.lineAt(cur);
    const end = Math.min(to, line.to);
    if (end > cur) {
      ranges.push(Decoration.replace(first ? spec : {}).range(cur, end));
      first = false;
    }
    cur = line.to + 1;
  }
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const ranges: Range<Decoration>[] = [];

  // whole tree, whole doc — scrolling then never rebuilds. ensureSyntaxTree
  // because the incremental parser's first pass may fall short of the end,
  // and content past that point would render as raw `##`/`**` forever.
  const tree = ensureSyntaxTree(state, doc.length, 200) ?? syntaxTree(state);
  const activeOwners = view.hasFocus
    ? activeRevealOwners(tree, state)
    : new Set<string>();

  // Link nodes the selection overlaps — filled on the way in (pre-order:
  // a Link is entered before the LinkMark/URL children that consult this)
  const activeLinks = new Set<number>();

  tree.iterate({
    enter: node => {
      // tables render whole or not at all (tables.ts); a revealed table
      // is plain source — no mark styling or hiding inside it
      if (node.name === "Table") return false;
      // images stay source for now — rendering them is its own surface
      if (node.name === "Image") return false;

      // a bracketed token with no destination — `[w23]`, `[2026-08-07]` —
      // parses as a shortcut-reference Link but isn't one: keep it plain
      // text (no link styling, brackets visible, no click)
      if (node.name === "Link" && !linkUrl(node.node, doc)) {
        activeLinks.add(node.from);
        return;
      }

      if (node.name === "Link" && activeOwners.has(nodeKey(node.node)))
        activeLinks.add(node.from);

      // an image-store link becomes a thumbnail unless the cursor is inside
      if (node.name === "Link" && !activeLinks.has(node.from)) {
        const url = linkUrl(node.node, doc);
        if (url.startsWith("/api/images/")) {
          const close = node.node.getChildren("LinkMark")
            .find(mk => doc.sliceString(mk.from, mk.to) === "]");
          const label = close ? doc.sliceString(node.from + 1, close.from) : "image";
          pushReplace(ranges, doc, node.from, node.to,
                      { widget: new ImageThumb(url, label) });
          return false; // no marks or hides under the picture
        }
      }

      // a real link renders as an <a>: native right-click/middle-click
      // work; plain left click stays ours (linkClicks). A markdown link
      // title — [#341](url "name") — becomes the hover tooltip.
      if (node.name === "Link") {
        const href = resolveHref(view, linkUrl(node.node, doc));
        const lt = node.node.getChildren("LinkTitle")[0];
        const title = lt ? doc.sliceString(lt.from + 1, lt.to - 1) : "";
        ranges.push(Decoration.mark(href
          ? { tagName: "a", class: "cm-lm-link",
              attributes: { href, rel: "noopener noreferrer", draggable: "false",
                            ...(title ? { title } : {}) } }
          : { class: "cm-lm-link" }).range(node.from, node.to));
      }

      const lc = LINE_CLASS[node.name];
      if (lc) {
        const last = doc.lineAt(node.to).number;
        for (let n = doc.lineAt(node.from).number; n <= last; n++)
          ranges.push(Decoration.line({ class: lc }).range(doc.line(n).from));
      }

      const mc = MARK_CLASS[node.name];
      if (mc && node.from < node.to)
        ranges.push(Decoration.mark({ class: mc }).range(node.from, node.to));

      if (node.name === "ListMark") {
        const line = doc.lineAt(node.from);
        const owner = revealOwner(node.node);
        if (!owner || !activeOwners.has(nodeKey(owner))) {
          if (/^[-*+]$/.test(doc.sliceString(node.from, node.to))) {
            // task item? swallow "- [x]" into one checkbox
            const m = doc.sliceString(node.to, Math.min(node.to + 5, line.to)).match(/^ \[([ xX])\]/);
            if (m) pushReplace(ranges, doc, node.from, node.to + 4,
                               { widget: new Checkbox(/x/i.test(m[1])) });
            else pushReplace(ranges, doc, node.from, node.to, { widget: BULLET });
          } else {
            ranges.push(Decoration.mark({ class: "cm-lm-olmark" }).range(node.from, node.to));
          }
        }
        return;
      }

      if (node.name === "HorizontalRule" && !activeOwners.has(nodeKey(node.node))) {
        pushReplace(ranges, doc, node.from, node.to, { widget: HR });
        return;
      }

      if (HIDE.has(node.name) && node.from < node.to) {
        let hide: boolean;
        if (LINK_CHILD.has(node.name)) {
          let p: SyntaxNode | null = node.node.parent;
          while (p && p.name !== "Link" && p.name !== "Image") p = p.parent;
          if (p?.name === "Link") {
            hide = !activeLinks.has(p.from);
            if (hide && node.name === "URL") {
              // only the destination URL collapses — a URL before the
              // closing `]` is the link's visible label
              const close = p.getChildren("LinkMark")
                .find(mk => doc.sliceString(mk.from, mk.to) === "]");
              if (!close || node.from < close.to) hide = false;
            }
          } else {
            // bare/auto URL, or link plumbing outside a Link: stay visible
            hide = false;
          }
        } else {
          const owner = revealOwner(node.node);
          hide = !owner || !activeOwners.has(nodeKey(owner));
        }
        if (hide) {
          let from = node.from, to = node.to;
          // `# ` and `> `: the space after the mark goes with it
          if ((node.name === "HeaderMark" || node.name === "QuoteMark")
              && doc.sliceString(to, to + 1) === " ") to += 1;
          // the gap between a URL and its title goes with the title
          if (node.name === "LinkTitle")
            while (from > 0 && /\s/.test(doc.sliceString(from - 1, from))) from -= 1;
          pushReplace(ranges, doc, from, to);
        }
      }
    },
  });

  return Decoration.set(ranges, true);
}

const previewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(u: ViewUpdate) {
      const frozen = u.state.field(frozenField);
      const thawed = u.startState.field(frozenField) && !frozen;
      if (u.docChanged || (u.focusChanged && !frozen) || thawed || (u.selectionSet && !frozen))
        this.decorations = build(u.view);
    }
  },
  { decorations: v => v.decorations },
);

/* an app-level link interceptor: a surface provides one (LiveMd's onLink)
   to claim targets the default rules can't route — memory's relative key
   links. A handler returning true has dealt with the click. */
export const linkOpener = Facet.define<(url: string) => boolean>();

/* href resolution for the real <a> the link renders as — so right-click
   "open in new tab" and middle-click work natively. A surface maps raw
   targets it understands (memory keys → "#/memory/…"); absolute targets
   fall through to themselves; null renders a plain styled span. */
export const linkHref = Facet.define<(url: string) => string | null>();

function resolveHref(view: EditorView, url: string): string | null {
  for (const h of view.state.facet(linkHref)) {
    const r = h(url);
    if (r) return r;
  }
  return /^(https?:|mailto:|#|\/)/.test(url) ? url : null;
}

/* plain click on a rendered link opens it — in READ-ONLY views only
   (locked memory/canvas, skills). An editable view keeps every plain
   click for editing; its links follow via ctrl/cmd-click, middle-click
   or right-click on the anchor. The pointerdown guard stops CM from
   moving the selection into the link — which would reveal source
   before the click lands. */
function linkAt(view: EditorView, target: EventTarget | null): SyntaxNode | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>(".cm-lm-link");
  if (!el || !view.contentDOM.contains(el)) return null;
  const pos = view.posAtDOM(el);
  if (pos < 0) return null;
  let n: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1);
  while (n && n.name !== "Link") n = n.parent;
  if (!n) return null;
  const opened = view.hasFocus
    && view.state.selection.ranges.some(r => r.from <= n!.to && r.to >= n!.from);
  return opened ? null : n; // revealed link: not ours
}

const linkClicks = Prec.high(EditorView.domEventHandlers({
  pointerdown(e, view) {
    if (!view.state.readOnly) return false; // editable: clicks edit
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    if (!linkAt(view, e.target)) return false;
    e.preventDefault(); // keep the selection (and the reveal) where it is
    return true;
  },
  click(e, view) {
    if (!view.state.readOnly) return false; // editable: clicks edit
    // modified clicks are the browser's — ctrl/cmd-click opens the <a>
    // in a new tab natively
    if (e.ctrlKey || e.metaKey || e.shiftKey) return false;
    const link = linkAt(view, e.target);
    if (!link) return false;
    const url = linkUrl(link, view.state.doc);
    for (const h of view.state.facet(linkOpener)) if (h(url)) {
      e.preventDefault();
      return true;
    }
    // in-app targets ("#/canvas?id=7") navigate in place — back returns;
    // the world opens in a new tab
    if (url.startsWith("#/")) location.hash = url;
    else if (url) window.open(url, "_blank", "noopener,noreferrer");
    e.preventDefault();
    return true;
  },
}));

/* a pasted image uploads to /api/images and lands at the cursor as
   [name](/api/images/<id>) — the thumbnail rule renders it. Text pastes
   pass through untouched. */
const imagePaste = EditorView.domEventHandlers({
  paste(e, view) {
    const files = [...(e.clipboardData?.items || [])]
      .filter(i => i.kind === "file").map(i => i.getAsFile())
      .filter((f): f is File => !!f && f.type.startsWith("image/"));
    if (!files.length) return false;
    e.preventDefault();
    const at = view.state.selection.main.head;
    Promise.all(files.map(f => {
      const fd = new FormData();
      fd.append("file", f, f.name || "pasted.png");
      return fetch("/api/images", { method: "POST", body: fd })
        .then(r => (r.ok ? r.json() : null)).catch(() => null);
    })).then(rs => {
      const text = rs.filter(Boolean)
        .map(r => `[${r.name}](/api/images/${r.id})`).join(" ");
      if (text) view.dispatch({ changes: { from: at, insert: text },
                                selection: { anchor: at + text.length } });
    });
    return true;
  },
});

export function livemd(): Extension {
  return [
    markdown({ base: markdownLanguage }),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    frozenField,
    freezePlugin,
    previewPlugin,
    linkClicks,
    imagePaste,
    tables(),
  ];
}
