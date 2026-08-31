/* the phone companion — the whole phone app in one file, by design.
   Not a smaller desktop: its own shell and a few views over the same
   backend and the same components. The nest opens first; notes, tasks, brain,
   the canvas are the desktop pages as they are; the
   nest reads as a stacked list and memory as a read-only browser. The
   phone law: nothing is a modal — every tap opens a page, and swiping
   left/right walks history forward/back. Unknown routes land home. */

import { Fragment, useEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { Blocks, Brain, ChevronLeft, ChevronRight, Code, Feather, FileText, Folder, Image as ImageIcon, ListChecks, Paperclip } from "lucide-react";
import { useDash } from "@/api/dash";
import { getNest, type NestWidget } from "@/api/client";
import { formatSize, grpColor } from "@/lib/format";
import { mdlite } from "@/lib/mdlite";
import { ImageLightbox, Nothing, RawHtml } from "@/components/bits";
import HtmlEditor from "@/components/nest/HtmlEditor";
import WidgetByline from "@/components/nest/WidgetByline";
import Prose from "@/components/Prose";
import { canvasBody, isMarkdownCanvas } from "@/lib/canvas";
import { buildMemoryTree, countPages, findMemoryNode, memoryTitle, resolveMemoryPath } from "@/lib/memory";
import { cn } from "@/lib/utils";

const TABS = [
  ["/nest", "nest", Blocks], ["/notes", "notes", Feather],
  ["/tasks", "tasks", ListChecks], ["/brain", "brain", Brain], ["/memory", "memory", Folder],
] as const;

export function PhoneShell() {
  const path = useLocation().pathname;
  const nav = useNavigate();
  // the canvas runs full-bleed: its own header, its own floor
  const chrome = !/^\/canvas/.test(path);

  // swipe right = back, swipe left = forward — the phone's only history
  // controls. Nothing slides: the page stays put and an arrow ramps in at
  // the edge you're dragging from, full once the release will navigate.
  // Releasing there navigates exactly like a tap; below the threshold
  // nothing happens. Once a drag reads as horizontal the page stops
  // scrolling for the rest of it — the only thing moving is the arrow.
  // Swipes inside sideways-scrolling content, or the field you're typing
  // in, are left alone.
  const backArrow = useRef<HTMLDivElement>(null);
  const fwdArrow = useRef<HTMLDivElement>(null);
  // react-router stamps its entry index into history.state — the floor and
  // ceiling of what a swipe may traverse (never swipe out of the app)
  const maxIdx = useRef(0);
  const loc = useLocation();
  useEffect(() => {
    maxIdx.current = Math.max(maxIdx.current, (window.history.state?.idx as number) ?? 0);
  }, [loc]);
  useEffect(() => {
    // what the swipe must not steal from: content that scrolls sideways,
    // and the field you're actually typing in. Focus is the test, not the
    // tag — a canvas being read is a page like any other (its editor
    // covers the whole screen), a canvas being edited owns the drag.
    const keep = (el: EventTarget | null) => {
      for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 4 && getComputedStyle(n).overflowX !== "visible") return true;
        if (n === document.activeElement) return true;
      }
      return false;
    };
    const SLOP = 10, TRIP = 80; // px: a tap's wobble, and the commit distance
    let sx = 0, sy = 0, dx = 0, arm = false;
    // 0 → invisible, 1 → armed; the arrow on the idle side stays at 0
    const paint = (p: number, ease = false) => {
      for (const [el, on] of [[backArrow.current, dx > 0], [fwdArrow.current, dx < 0]] as const) {
        if (!el) continue;
        const v = on ? p : 0;
        el.style.transition = ease ? "opacity .18s ease, transform .18s ease" : "none";
        el.style.opacity = String(v);
        el.style.transform = `translateY(-50%) scale(${0.62 + 0.38 * v})`;
      }
    };
    const goes = () => { // is there history that way?
      const idx = (window.history.state?.idx as number) ?? 0;
      return dx > 0 ? idx > 0 : idx < maxIdx.current;
    };
    const start = (e: TouchEvent) => {
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      dx = 0;
      arm = !keep(e.target);
    };
    const move = (e: TouchEvent) => {
      if (!arm) return;
      dx = e.touches[0].clientX - sx;
      const dy = e.touches[0].clientY - sy;
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 24) { arm = false; paint(0, true); return; }
      if (Math.abs(dx) < SLOP) { paint(0); return; } // a tap is not a drag
      // the drag is horizontal: the page holds still for the rest of it, so
      // a diagonal finger doesn't scroll the page it's about to leave
      e.preventDefault();
      paint(goes() ? Math.min(1, (Math.abs(dx) - SLOP) / (TRIP - SLOP)) : 0);
    };
    const end = () => {
      if (!arm) return;
      arm = false;
      const go = Math.abs(dx) >= TRIP && goes();
      paint(0, true);
      if (go) nav(dx > 0 ? -1 : 1);
    };
    const cancel = () => { arm = false; paint(0, true); };
    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: false }); // it may cancel the scroll
    document.addEventListener("touchend", end, { passive: true });
    document.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", cancel);
    };
  }, [nav]);

  return (
    <>
      {/* overflow-x-clip: the phone never scrolls sideways — Safari renders
          some nowrap lines a few px wider than Chromium, and a stray line
          must not hand the whole page a horizontal scrollbar. clip, not
          hidden: no scroll container is created; inner overflow-x-auto
          content (code blocks) keeps its own scrolling. */}
      <main className={cn("flex w-full min-w-0 min-h-dvh flex-col overflow-x-clip px-gutter pt-2",
                            chrome ? "pb-24" : "pb-0")}>
        <Outlet />
      </main>
      {chrome && (
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line-soft bg-bg pb-[calc(env(safe-area-inset-bottom)+8px)]">
          {TABS.map(([to, label, Icon]) => (
            <NavLink key={to} to={to}
              className={({ isActive }) => cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 font-mono text-[10.5px] tracking-[.12em] uppercase no-underline",
                isActive ? "text-gold" : "text-dim")}>
              <Icon size={19} strokeWidth={1.7} />
              {label}
            </NavLink>
          ))}
        </nav>
      )}
      {/* the swipe's only feedback: an edge arrow, ramped by the drag */}
      {([[backArrow, "left-2", ChevronLeft], [fwdArrow, "right-2", ChevronRight]] as const).map(([ref, side, Icon], i) => (
        <div key={i} ref={ref} aria-hidden
             style={{ transform: "translateY(-50%) scale(.62)" }}
             className={cn("pointer-events-none fixed top-1/2 z-40 grid size-9 place-items-center rounded-full",
                             "border border-line-soft bg-bg text-gold opacity-0", side)}>
          <Icon size={20} strokeWidth={2} />
        </div>
      ))}
    </>
  );
}

/* one lean row language for everything tappable on the list views */
function Row({ to, icon: Icon, title, meta, color }: {
  to: string; icon?: typeof Blocks; title: string; meta?: string; color?: string;
}) {
  return (
    <Link to={to}
          className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 no-underline hover:bg-hover">
      {Icon && <Icon size={18} strokeWidth={1.7} className="flex-none text-gold-dim" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[16px] text-ink">{title}</span>
        {meta && (
          <span className="block truncate font-mono text-[11px] text-faint" style={color ? { color } : undefined}>
            {meta}
          </span>
        )}
      </span>
    </Link>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-5 mb-1.5 flex items-center gap-3 first:mt-0">
    <span className="font-mono text-[10px] tracking-[.16em] uppercase text-faint">{children}</span>
    <i className="h-px flex-1 bg-line-soft" />
  </div>
);

/* the nest, phoned: the same board read as a page — every widget a
   full-width box, stacked in the order the grid reads (row, then column).
   A viewer: composing and rearranging stay on the desktop board; canvas
   titles tap through to the canvas page. */
function NestBox({ w }: { w: NestWidget }) {
  const [big, setBig] = useState(-1);
  const Icon = w.kind === "canvas" ? FileText : w.kind === "image" ? ImageIcon
    : w.kind === "html" ? Code : Paperclip;
  const title = (w.kind === "canvas" ? w.canvas?.label : w.title) || w.title;
  const items = w.items ?? [];
  const body = w.canvas ? canvasBody(w.canvas.content) : "";
  return (
    <section className="rounded-md border border-line bg-raise p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="size-3.5 flex-none text-gold-dim" />
        {w.kind === "canvas" && w.canvas ? (
          <Link to={`/canvas?id=${w.canvas.id}`}
                className="min-w-0 truncate font-display text-[15px] text-ink no-underline">
            {title}
          </Link>
        ) : w.kind === "html" && w.html ? (
          <Link to={`/html?id=${w.html.id}`}
                className="min-w-0 truncate font-display text-[15px] text-ink no-underline">
            #{w.html.id} · {title}
          </Link>
        ) : (
          <span className="min-w-0 truncate font-display text-[15px]">{title}</span>
        )}
      </div>
      {/* -mr/pr against the box's p-3.5: the scrollbar rides the box's right edge */}
      {w.kind === "canvas" && w.canvas && (
        <div className="-mr-3.5 max-h-[55vh] overflow-y-auto overscroll-contain pr-3.5 [scrollbar-width:thin]">
          {isMarkdownCanvas(w.canvas)
            ? <RawHtml className="turn-md text-[16px] font-normal [overflow-wrap:anywhere]" html={mdlite(body)} />
            : <pre className="font-mono text-[12.5px]/[1.7] whitespace-pre-wrap [overflow-wrap:anywhere] text-dim">{body}</pre>}
        </div>
      )}
      {w.kind === "image" && (items.length === 1 ? (
        <img src={items[0].url} alt={items[0].name} onClick={() => setBig(0)}
             className="max-h-[55vh] w-full rounded-sm object-contain" />
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {items.map((it, i) => (
            <img key={i} src={it.url} alt={it.name} onClick={() => setBig(i)}
                 className="aspect-square w-full rounded-sm object-cover" />
          ))}
        </div>
      ))}
      {w.kind === "html" && items[0] && (
        <iframe src={items[0].url} sandbox="allow-scripts" title={w.title}
                className="h-72 w-full rounded-sm border-0" />
      )}
      {w.kind === "file" && items.map((it, i) => (
        <a key={i} href={it.url} download={it.name}
           className="flex items-center gap-2 rounded-md px-1.5 py-1.5">
          <Paperclip className="size-3.5 flex-none text-gold-dim" />
          <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{it.name}</span>
          <span className="flex-none font-mono text-[11px] text-faint">{formatSize(it.size)}</span>
        </a>
      ))}
      <div className="mt-2 flex justify-end"><WidgetByline widget={w} /></div>
      {big >= 0 && items[big] && (
        <ImageLightbox key={big} src={items[big].url} alt={items[big].name}
                       title={w.title} descr={w.descr}
                       gallery={{ urls: items.map(it => it.url), index: big, onIndex: setBig }}
                       onClose={() => setBig(-1)} />
      )}
    </section>
  );
}

export function PhoneNest() {
  // which board rides in the URL (?b=name), as on the desktop
  const name = new URLSearchParams(useLocation().search).get("b") || "main";
  const [board, setBoard] = useState<{ widgets: NestWidget[]; boards: string[] }>();
  useEffect(() => {
    // a board switch can leave the old board's fetch in flight — stale
    // responses must not land
    let stale = false;
    const load = () => getNest(name).then(b => { if (!stale) setBoard(b); }).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => { stale = true; clearInterval(t); };
  }, [name]);
  if (!board) return <Nothing>loading…</Nothing>;
  const visible = board.widgets.filter(w => !w.hidden);
  return (
    <>
      {board.boards.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {board.boards.map(b => (
            <Link key={b} to={b === "main" ? "/nest" : `/nest?b=${encodeURIComponent(b)}`}
                  className={cn("rounded-md border px-2.5 py-1 font-mono text-[11px] no-underline",
                                  b === name ? "border-gold-dim text-gold" : "border-line-soft text-dim")}>
              {b}
            </Link>
          ))}
        </div>
      )}
      {visible.length ? (
        <div className="flex flex-col gap-3">
          {[...visible].sort((a, b) => a.row - b.row || a.col - b.col).map(w => (
            <NestBox key={w.id} w={w} />
          ))}
        </div>
      ) : <Nothing>this board is empty.</Nothing>}
    </>
  );
}

export function PhoneHtml() {
  const nav = useNavigate();
  const id = Number(new URLSearchParams(useLocation().search).get("id"));
  if (!id) return <Nothing>no HTML document selected.</Nothing>;
  return <HtmlEditor id={id} page onClose={() => nav(-1)} onChanged={() => {}} />;
}

/* memory, phoned: the tree of pages, one level per screen — a page's
   content as rendered prose above the pages under it; tapping drills
   down, back goes up. Reading only; editing stays on the desktop's
   livemd. The url shape is the desktop's: /memory/<path>. */
export function PhoneMemory() {
  const { data } = useDash();
  const nav = useNavigate();
  const splat = useParams()["*"] || "";
  if (!data) return <Nothing>loading…</Nothing>;
  const mem = data.memory;
  const tree = buildMemoryTree(mem);
  const path = splat.split("/").filter(Boolean).map(decodeURIComponent).join("/");
  const node = path ? findMemoryNode(tree, path) : undefined;
  if (path && !node) return <Navigate to="/memory" replace />;
  const kids = node ? node.kids : tree;
  const cur = node?.page;
  const segs = path ? path.split("/") : [];
  const onLink = (url: string) => {
    const t = resolveMemoryPath(mem, path, url);
    if (t) nav(t);
  };
  return (
    <>
      <div className="mb-3 flex min-w-0 items-baseline gap-2 font-display text-[16px] leading-none">
        {path ? <Link to="/memory" className="text-dim no-underline">memory</Link>
              : <span className="text-ink">memory</span>}
        {segs.map((s, i) => {
          const p = segs.slice(0, i + 1).join("/");
          return (
            <Fragment key={p}>
              <span className="text-faint">/</span>
              {i === segs.length - 1
                ? <span className="min-w-0 truncate text-ink">{s}</span>
                : <Link to={`/memory/${p}`} className="min-w-0 truncate text-dim no-underline">{s}</Link>}
            </Fragment>
          );
        })}
      </div>
      {cur && (
        <>
          <Prose html={mdlite(cur.content)} onLink={onLink} />
          <div className="mt-4 font-mono text-[11px] text-faint">
            modified {cur.updated || "—"} · read {cur.accessed || "—"}
          </div>
        </>
      )}
      {kids.length > 0 && (
        <>
          <Label>pages</Label>
          {kids.map(k => {
            const n = countPages(k);
            const meta = k.page ? (n > 0 ? `${n} under it` : "") : `${n} page${n === 1 ? "" : "s"}`;
            return <Row key={k.path} to={`/memory/${k.path}`} title={k.page ? memoryTitle(k.page.content) : k.name} meta={meta}
                        color={grpColor(k.path.split("/")[0])} />;
          })}
        </>
      )}
      {!cur && !kids.length && <Nothing>no memory yet.</Nothing>}
    </>
  );
}
