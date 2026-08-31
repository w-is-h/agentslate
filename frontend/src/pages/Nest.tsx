/* #/nest — the shared widget board: a grid (4×4 default, resizable in
   settings) that always fits the window (no scroll — cells stretch with
   it). The agent composes it via the nest tools, and you compose
   right here — every empty cell is a plus (pick or create a canvas; paste,
   drop, or browse an image; paste html). A tile spans w×h cells; drag any
   edge or corner to resize in cell steps. Widgets stack, never close each
   other: whatever a moved or grown rect covers hides and reappears when
   uncovered. Canvas tiles are live version chains edited in place; every
   widget names who placed it. The nest is many named boards; which one a
   tab shows rides in its URL (?b=name), so tabs never sync. */

import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Code, FileText, Image as ImageIcon, Paperclip, Pencil, X } from "lucide-react";
import { getNest, post, uploadNestFiles, type NestWidget } from "@/api/client";
import { useLock } from "@/hooks/useLock";
import { ImageLightbox, Nothing, RawHtml } from "@/components/bits";
import { useCanvasDraft } from "@/hooks/useDraft";
import { isMarkdownCanvas } from "@/lib/canvas";
import LiveMd from "@/components/editor/LiveMd";
import { AddPanel, GhostCell } from "@/components/nest/AddPanel";
import BoardSettings from "@/components/nest/BoardSettings";
import HtmlEditor from "@/components/nest/HtmlEditor";
import WidgetByline from "@/components/nest/WidgetByline";
import { mdlite } from "@/lib/mdlite";
import { formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const GAP = 12;  // px — keep in step with the grid's gap-3

/* the tile's chrome, all overlay, never layout: an × in the upper right
   that hides the widget from the nest (the thing itself survives where it
   has a life of its own); a head stripe — icon + title on a full-width
   shaded band — that only appears while the pointer is over the tile's
   top; a foot strip on tile hover — the placer's address and, for
   canvases, shaded pill bottom-right. Both are grab bars:
   a drag anywhere on them (title included) moves the tile; a clean click
   anywhere on the stripe opens the widget — the canvas page, the gallery
   view. */
function Head({ w, title, link, onOpen }: {
  w: NestWidget; title: string; link?: string; onOpen?: () => void;
}) {
  const Icon = w.kind === "canvas" ? FileText : w.kind === "image" ? ImageIcon
    : w.kind === "html" ? Code : Paperclip;
  const inner = (
    <>
      <Icon className="size-3.5 flex-none text-gold-dim" />
      <span className="min-w-0 truncate font-display text-[15px]">{title}</span>
    </>
  );
  const cls = "flex min-w-0 flex-1 items-center gap-2";
  return link ? (
    <Link to={link} className={cn(cls, "hover:text-gold")}>{inner}</Link>
  ) : onOpen ? (
    // a span, not a button — the grab bar skips buttons, and this whole
    // stripe must both drag and click-open
    <span onClick={onOpen} className={cn(cls, "cursor-pointer hover:text-gold")}>{inner}</span>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

function Foot({ w }: { w: NestWidget }) {
  // deleting the thing itself (a canvas, a saved doc) lives in that thing's
  // own view — the board only ever hides
  return (
    <span className="flex min-w-0 items-center gap-2 rounded-md bg-raise/80 px-2 py-1 backdrop-blur-sm">
      <WidgetByline widget={w} />
    </span>
  );
}

interface Rect { col: number; row: number; w: number; h: number }

/* the tile shell: fixed w×h cell span, real border, resize edges and
   corners, and header-drag to move — all in cell steps. The rect previews
   locally while dragging (the tile lifts and jumps cell to cell,
   kanban-style); release commits, and whatever the landed rect covers
   hides under it until uncovered. */
function Tile({ w, cols, rows, onResize, onHide, contentGrab, overlayHead = false, head, footer, children }: {
  w: NestWidget; cols: number; rows: number;
  onResize: (r: Rect) => Promise<unknown>;
  onHide?: () => void; // only kinds whose thing survives a hide get the ×
  contentGrab?: boolean; // media kinds: the content itself drags the tile
  overlayHead?: boolean; // html: hover drag bar above its full-size frame
  head: ReactNode; footer?: ReactNode; children: ReactNode;
}) {
  const { locked } = useLock();
  const [preview, setPreview] = useState<Rect | null>(null);
  const ref = useRef<HTMLElement>(null);
  const moved = useRef(false); // a real drag must not fire the link under it
  const rect = preview ?? { col: w.col, row: w.row, w: w.w, h: w.h };
  const drag = (e: React.PointerEvent, apply: (sp: Rect, dx: number, dy: number) => Rect,
                moving = false) => {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    const b = ref.current!.getBoundingClientRect();
    const sp = rect;
    const cw = (b.width - GAP * (sp.w - 1)) / sp.w;
    const ch = (b.height - GAP * (sp.h - 1)) / sp.h;
    const sx = e.clientX, sy = e.clientY;
    let last = sp;
    document.body.style.userSelect = "none"; // a drag must never start a text selection
    // an iframe under the pointer would swallow the move events mid-drag —
    // freeze them out for the drag's duration (rules in index.css); a MOVE
    // also turns the cursor into a fist everywhere (resizes keep theirs)
    document.body.classList.add("nest-dragging");
    if (moving) document.body.classList.add("nest-moving");
    const move = (ev: PointerEvent) => {
      last = apply(sp, Math.round((ev.clientX - sx) / (cw + GAP)),
                   Math.round((ev.clientY - sy) / (ch + GAP)));
      setPreview(last);
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      document.body.classList.remove("nest-dragging", "nest-moving");
      if (last.col === w.col && last.row === w.row && last.w === w.w && last.h === w.h)
        setPreview(null);
      else onResize(last).then(() => setPreview(null), () => setPreview(null));
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  // dir is any compass mix — "e" an edge, "se" a corner pulling both axes
  const resize = (e: React.PointerEvent, dir: string) =>
    drag(e, (sp, dx, dy) => {
      const r = { ...sp };
      if (dir.includes("e")) r.w = Math.min(cols - sp.col + 1, Math.max(1, sp.w + dx));
      if (dir.includes("s")) r.h = Math.min(rows - sp.row + 1, Math.max(1, sp.h + dy));
      if (dir.includes("w")) {
        const d = Math.min(sp.w - 1, Math.max(1 - sp.col, dx));
        r.col = sp.col + d;
        r.w = sp.w - d;
      }
      if (dir.includes("n")) {
        const d = Math.min(sp.h - 1, Math.max(1 - sp.row, dy));
        r.row = sp.row + d;
        r.h = sp.h - d;
      }
      return r;
    });
  // both strips are grab bars, links included: a drag from anywhere on
  // them (past a few px) moves the tile; a clean click on the title or
  // placer link still navigates (the capture guard below eats the click
  // only after real movement). Buttons (×, trash) stay plain clicks.
  const grab = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button,input")) return;
    moved.current = false;
    const sx = e.clientX, sy = e.clientY;
    const track = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) moved.current = true;
    };
    addEventListener("pointermove", track);
    addEventListener("pointerup", () => removeEventListener("pointermove", track), { once: true });
    drag(e, (sp, dx, dy) => ({
      col: Math.min(cols - sp.w + 1, Math.max(1, sp.col + dx)),
      row: Math.min(rows - sp.h + 1, Math.max(1, sp.row + dy)),
      w: sp.w, h: sp.h,
    }), true);
  };
  const clickGuard = (e: React.MouseEvent) => {
    if (moved.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  // two dress codes: media kinds (image, html) sit flat on the page —
  // no border, no panel, edge-to-edge; text kinds (canvas, file) keep the
  // classic padded box. Drag always lifts on a solid panel.
  const boxed = w.kind === "canvas" || w.kind === "file";
  return (
    <section ref={ref}
             style={{ gridColumn: `${rect.col} / span ${rect.w}`, gridRow: `${rect.row} / span ${rect.h}` }}
             className={cn("group relative flex min-w-0 flex-col rounded-md border transition-colors",
                             // boxed tiles keep no RIGHT padding — the scroller
                             // must own the border so its bar sits at the edge;
                             // content pads itself back (pr on the scrollers)
                             w.kind === "canvas" ? "bg-raise pb-3 pl-3"
                               : w.kind === "file" ? "bg-raise py-3 pl-3" : "p-0",
                             preview ? "z-10 border-gold-dim bg-raise shadow-float"
                               : cn("hover:border-gold-dim",
                                      boxed ? "border-line" : "border-transparent bg-transparent"))}>
      {/* the clip lives here, not on the shell — the resize hitboxes hang
          past the tile edge and must not be cut off. rounded to follow the
          border now that content runs edge to edge.
          contentGrab: pointerdown anywhere here drags the tile; the click
          guard eats the click only after real movement, so clean clicks
          still open galleries */}
      <div onPointerDown={contentGrab && !locked ? grab : undefined}
           onClickCapture={contentGrab && !locked ? clickGuard : undefined}
           className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[5px]">
        {children}
      </div>
      {/* hover chrome overlays the content and never takes layout space */}
      {onHide && !locked && (
        <button title="hide from the nest" onClick={onHide}
                className={cn("absolute top-1.5 right-1.5 flex size-6 cursor-pointer items-center",
                                overlayHead ? "z-[60]" : "z-20",
                                "justify-center rounded-md bg-raise/85 text-faint opacity-0",
                                "transition-opacity group-hover:opacity-100 hover:text-ink")}>
          <X className="size-4" />
        </button>
      )}
      {/* head stripe: a full-width shaded band across the tile's top,
          revealed only while the pointer is over it. pr clears the × */}
      <div onPointerDown={locked ? undefined : grab} onClickCapture={locked ? undefined : clickGuard}
           className={cn("absolute inset-x-0 top-0 flex items-center rounded-t-md",
                           locked ? "cursor-default" : "cursor-grab",
                           overlayHead ? "z-50" : "z-10",
                           "bg-raise/90 px-3 py-1.5 pr-9 backdrop-blur-sm",
                           "transition-opacity active:cursor-grabbing",
                           preview ? "opacity-100" : "opacity-0 hover:opacity-100")}>
        {head}
      </div>
      {/* foot strip: transparent, on tile hover — the shade lives on the
          pill around the placer text, bottom right */}
      {footer && (
        <div onPointerDown={locked ? undefined : grab} onClickCapture={locked ? undefined : clickGuard}
             className={cn("absolute inset-x-0 bottom-0 z-10 flex items-center justify-end px-2 pb-1.5",
                             locked ? "cursor-default" : "cursor-grab",
                             "transition-opacity active:cursor-grabbing",
                             preview ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
          {footer}
        </div>
      )}
      {/* resize hitboxes: 20px — 14 inside the tile plus 6 hanging into the
          grid gap (neighbours split the 12px evenly)
          — showing a slim gold line at the true edge */}
      {!locked && <>
      <div onPointerDown={e => resize(e, "e")} title="resize"
           className="group/rz absolute top-0 -right-1.5 z-20 h-full w-5 cursor-ew-resize">
        <div className="absolute inset-y-0 right-1.5 w-1 opacity-0 transition-opacity group-hover/rz:opacity-100 group-hover/rz:bg-gold/45" />
      </div>
      <div onPointerDown={e => resize(e, "w")} title="resize"
           className="group/rz absolute top-0 -left-1.5 z-20 h-full w-5 cursor-ew-resize">
        <div className="absolute inset-y-0 left-1.5 w-1 opacity-0 transition-opacity group-hover/rz:opacity-100 group-hover/rz:bg-gold/45" />
      </div>
      <div onPointerDown={e => resize(e, "s")} title="resize"
           className="group/rz absolute -bottom-1.5 left-0 z-20 h-5 w-full cursor-ns-resize">
        <div className="absolute inset-x-0 bottom-1.5 h-1 opacity-0 transition-opacity group-hover/rz:opacity-100 group-hover/rz:bg-gold/45" />
      </div>
      <div onPointerDown={e => resize(e, "n")} title="resize"
           className="group/rz absolute -top-1.5 left-0 z-20 h-5 w-full cursor-ns-resize">
        <div className="absolute inset-x-0 top-1.5 h-1 opacity-0 transition-opacity group-hover/rz:opacity-100 group-hover/rz:bg-gold/45" />
      </div>
      {/* corner hitboxes ride above the edges and pull both axes; the dot
          marks the true corner (the tile edge sits 8px into each box) */}
      {([["nw", "-top-1.5 -left-1.5 cursor-nwse-resize", "top-1.5 left-1.5"],
         ["ne", "-top-1.5 -right-1.5 cursor-nesw-resize", "top-1.5 right-1.5"],
         ["sw", "-bottom-1.5 -left-1.5 cursor-nesw-resize", "bottom-1.5 left-1.5"],
         ["se", "-bottom-1.5 -right-1.5 cursor-nwse-resize", "bottom-1.5 right-1.5"]] as const
      ).map(([dir, at, dot]) => (
        <div key={dir} onPointerDown={e => resize(e, dir)} title="resize"
             className={cn("group/rz absolute z-30 size-5", at)}>
          <div className={cn("absolute size-2 opacity-0 transition-opacity",
                               "group-hover/rz:bg-gold/45 group-hover/rz:opacity-100", dot)} />
        </div>
      ))}
      </>}
    </section>
  );
}

function CanvasWidget({ w, cols, rows, onResize, onRm }: {
  w: NestWidget; cols: number; rows: number;
  onResize: (r: Rect) => Promise<unknown>; onRm: () => void;
}) {
  const doc = w.canvas!; // the page only mounts this when the doc resolved
  const { content, edit, err } = useCanvasDraft(doc);
  const { locked } = useLock();
  const markdown = isMarkdownCanvas(doc);
  return (
    <Tile w={w} cols={cols} rows={rows} onResize={onResize} onHide={onRm}
          head={<Head w={w} title={doc.label} link={`/canvas?id=${doc.id}`} />}
          footer={<Foot w={w} />}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-3 [scrollbar-width:thin]">
        {doc.source
          ? markdown
            ? <RawHtml className="turn-md text-[16px] font-normal [overflow-wrap:anywhere]" html={mdlite(content)} />
            : <pre className="font-mono text-[12.5px]/[1.7] whitespace-pre-wrap [overflow-wrap:anywhere] text-dim">{content}</pre>
          : <LiveMd key={doc.id} value={content} onChange={edit}
                    copyHtml={markdown ? mdlite : undefined}
                    readOnly={locked} className="min-h-full" />}
        {err && <div className="pr-3 font-mono text-[11px] text-overdue">{err}</div>}
      </div>
    </Tile>
  );
}

/* an image widget IS a gallery — one image fills the tile, several pack it
   as a grid of covers; any click opens the same gallery view (the lightbox
   with title, description, thumbnails), ←/→ steps through, and the index
   key remounts to reset the zoom */
function ImageWidget({ w, cols, rows, onResize, onRm }: {
  w: NestWidget; cols: number; rows: number;
  onResize: (r: Rect) => Promise<unknown>; onRm: () => void;
}) {
  const [big, setBig] = useState(-1);
  const items = w.items!;
  const galCols = Math.ceil(Math.sqrt(items.length));
  return (
    <Tile w={w} cols={cols} rows={rows} onResize={onResize} onHide={onRm} contentGrab
          head={<Head w={w} title={w.title} onOpen={() => setBig(0)} />}
          footer={<Foot w={w} />}>
      {items.length === 1 ? (
        <div className="min-h-0 flex-1">
          <img src={items[0].url} alt={items[0].name} onClick={() => setBig(0)}
               className="h-full w-full cursor-zoom-in object-contain" />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-1.5"
             style={{ gridTemplateColumns: `repeat(${galCols}, minmax(0, 1fr))`,
                      gridAutoRows: "minmax(0, 1fr)" }}>
          {items.map((it, i) => (
            <img key={i} src={it.url} alt={it.name} onClick={() => setBig(i)}
                 className="h-full w-full cursor-zoom-in rounded-sm object-cover" />
          ))}
        </div>
      )}
      {big >= 0 && items[big] && (
        <ImageLightbox key={big} src={items[big].url} alt={items[big].name}
                       title={w.title} descr={w.descr}
                       gallery={{ urls: items.map(it => it.url), index: big, onIndex: setBig }}
                       onClose={() => setBig(-1)} />
      )}
    </Tile>
  );
}

/* the freeform widget: one agent-authored HTML/CSS/JS document in a
   sandboxed iframe — scripts run, nothing reaches the page. The stripe
   click opens it big in an overlay. */
function HtmlWidget({ w, cols, rows, onResize, onRm, onChanged }: {
  w: NestWidget; cols: number; rows: number;
  onResize: (r: Rect) => Promise<unknown>; onRm: () => void; onChanged: () => void;
}) {
  const [big, setBig] = useState(false);
  const [editing, setEditing] = useState(false);
  const url = w.items?.[0]?.url;
  useEffect(() => {
    if (!big) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setBig(false);
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [big]);
  return (
    <>
      <Tile w={w} cols={cols} rows={rows} onResize={onResize} onHide={onRm} overlayHead
            head={(
              <>
                <Head w={w} title={`#${w.html?.id ?? "?"} · ${w.title}`} onOpen={() => setBig(true)} />
                <span className="flex min-w-0 items-center gap-1.5">
                  {w.html && (
                    <button onClick={() => setEditing(true)} title={`edit HTML document #${w.html.id}`}
                            className="flex size-6 flex-none cursor-pointer items-center justify-center rounded-md text-faint hover:text-gold">
                      <Pencil className="size-3" />
                    </button>
                  )}
                  <WidgetByline widget={w} />
                </span>
              </>
            )}>
        {url && (
          <div className="relative z-40 min-h-0 flex-1">
            <iframe src={url} sandbox="allow-scripts" title={w.title}
                    className="h-full w-full rounded-sm border-0" />
          </div>
        )}
      </Tile>
      {big && url && (
        <div onClick={() => setBig(false)}
             className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85">
          <iframe src={url} sandbox="allow-scripts" title={w.title}
                  className="h-[90dvh] w-[92vw] rounded-lg border-0 bg-bg shadow-pop" />
        </div>
      )}
      {editing && w.html && (
        <HtmlEditor id={w.html.id} onClose={() => setEditing(false)} onChanged={onChanged} />
      )}
    </>
  );
}

/* a file widget is a download card — your side of the file road; the
   upload side is the same cells (drop, paste, browse). Several files in
   one widget list as download rows. */
function FileWidget({ w, cols, rows, onResize, onRm }: {
  w: NestWidget; cols: number; rows: number;
  onResize: (r: Rect) => Promise<unknown>; onRm: () => void;
}) {
  const items = w.items!;
  return (
    <Tile w={w} cols={cols} rows={rows} onResize={onResize} onHide={onRm}
          head={<Head w={w} title={w.title} />} footer={<Foot w={w} />}>
      {items.length === 1 ? (
        <a href={items[0].url} download={items[0].name}
           className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 pr-3.5 text-dim">
          <Paperclip className="size-7 text-gold-dim" />
          <span className="max-w-full truncate px-2 text-[14px] text-ink">{items[0].name}</span>
          <span className="font-mono text-[11px] text-faint">{formatSize(items[0].size)} · download</span>
        </a>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-3 [scrollbar-width:thin]">
          {items.map((it, i) => (
            <a key={i} href={it.url} download={it.name}
               className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-hover">
              <Paperclip className="size-3.5 flex-none text-gold-dim" />
              <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{it.name}</span>
              <span className="flex-none font-mono text-[11px] text-faint">{formatSize(it.size)}</span>
            </a>
          ))}
        </div>
      )}
    </Tile>
  );
}

/* the cells no visible widget covers, in reading order — hidden widgets
   (covered by a higher rect) hold no cells */
function freeCells(b: { cols: number; rows: number; widgets: NestWidget[] }) {
  const taken = new Set<string>();
  for (const w of b.widgets) if (!w.hidden)
    for (let r = w.row; r < w.row + w.h; r++)
      for (let c = w.col; c < w.col + w.w; c++) taken.add(`${c},${r}`);
  const free: { col: number; row: number }[] = [];
  for (let r = 1; r <= b.rows; r++)
    for (let c = 1; c <= b.cols; c++)
      if (!taken.has(`${c},${r}`)) free.push({ col: c, row: r });
  return free;
}

/* an empty cell is the add affordance: click opens the panel, anything
   dropped straight on it lands as a widget there (images as images,
   the rest as file cards) */
export default function Nest() {
  // which board this tab shows lives in its own URL (#/nest?b=name) and
  // nowhere else — two tabs sit on two boards, and nothing on the server
  // remembers what was open
  const [params, setParams] = useSearchParams();
  const { locked } = useLock();
  const name = params.get("b") || "main";
  const open = (n: string) => setParams(n === "main" ? {} : { b: n });
  const [board, setBoard] = useState<{
    cols: number; rows: number; widgets: NestWidget[]; board: string; boards: string[];
  }>();
  const [adding, setAdding] = useState<{ col: number; row: number } | null>(null);
  // full screen (board settings): a body class Shell's grid answers to;
  // per-device, so it lives in localStorage, and only while the nest shows
  const [full, setFull] = useState(() => localStorage.getItem("slate.nest-full") === "1");
  useEffect(() => {
    document.body.classList.toggle("nest-full", full);
    localStorage.setItem("slate.nest-full", full ? "1" : "0");
    return () => document.body.classList.remove("nest-full");
  }, [full]);
  // guard the landing, not the launch: a board switch can leave the old
  // board's fetch in flight, and it must not overwrite the new one
  const nameRef = useRef(name);
  nameRef.current = name;
  const load = () => {
    const n = name;
    return getNest(n).then(b => { if (n === nameRef.current) setBoard(b); }).catch(() => {});
  };
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    loadRef.current(); // a switch swaps the tiles when the new board lands
    const t = setInterval(() => loadRef.current(), 3000);
    return () => clearInterval(t);
  }, [name]);
  // paste anywhere on the open board: clipboard files become a new widget in
  // the first free cell. An open add panel owns its own paste, and a focused
  // editor (canvas livemd, inputs) keeps every paste to itself.
  const boardRef = useRef(board);
  boardRef.current = board;
  const addingRef = useRef(adding);
  addingRef.current = adding;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      if (addingRef.current || lockedRef.current) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName))) return;
      const fs = [...(e.clipboardData?.items || [])].filter(i => i.kind === "file")
        .map(i => i.getAsFile()).filter((f): f is File => !!f);
      const text = fs.length ? "" : (e.clipboardData?.getData("text") || "").trim();
      const b = boardRef.current;
      if ((!fs.length && !text) || !b) return;
      const cell = freeCells(b)[0];
      if (!cell) return;
      e.preventDefault();
      (fs.length ? uploadNestFiles(cell.col, cell.row, fs, b.board)
                 : post("/api/nest/add", { ...cell, board: b.board, content: text }))
        .then(() => loadRef.current());
    };
    document.addEventListener("paste", h);
    return () => document.removeEventListener("paste", h);
  }, []);
  const rm = (id: number) => post("/api/nest/rm", { id }).then(load);
  const resize = (id: number) => (r: Rect) =>
    post("/api/nest/resize", { id, ...r }).then(load);
  if (!board) return <Nothing>loading…</Nothing>;

  // the board shows the visible layer only
  const visible = board.widgets.filter(w => !w.hidden);
  const empty = freeCells(board);
  const done = () => { setAdding(null); load(); };

  return (
    // the whole board is the viewport: fixed tracks, cells stretch, and
    // nothing ever scrolls the page
    <div className="grid h-full min-h-0 gap-3" style={{
      gridTemplateColumns: `repeat(${board.cols}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${board.rows}, minmax(0, 1fr))`,
    }}>
      {visible.map(w => {
        const props = {
          w, cols: board.cols, rows: board.rows,
          onResize: resize(w.id), onRm: () => rm(w.id),
        };
        return w.kind === "canvas"
          ? (w.canvas && <CanvasWidget key={w.id} {...props} />)
          : w.kind === "image"
            ? <ImageWidget key={w.id} {...props} />
            : w.kind === "html"
              ? <HtmlWidget key={w.id} {...props} onChanged={load} />
              : <FileWidget key={w.id} {...props} />;
      })}
      {!locked && empty.map(c => adding && adding.col === c.col && adding.row === c.row ? (
        <AddPanel key={`a${c.col},${c.row}`} col={c.col} row={c.row} board={board.board}
                  onClose={() => setAdding(null)} onAdded={done} />
      ) : (
        <GhostCell key={`g${c.col},${c.row}`} col={c.col} row={c.row} board={board.board}
                   onOpen={() => setAdding(c)} onAdded={done} />
      ))}
      <BoardSettings cols={board.cols} rows={board.rows}
                     hidden={board.widgets.length - visible.length}
                     board={board.board} boards={board.boards}
                     full={full} onFull={() => setFull(f => !f)} onChanged={done}
                     onOpen={open} />
    </div>
  );
}
