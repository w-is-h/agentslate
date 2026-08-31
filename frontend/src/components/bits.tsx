/* the small shared languages: day cards, search rows, the lightbox, raw html */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, LockOpen } from "lucide-react";
import { dow } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLock } from "@/hooks/useLock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReactNode } from "react";

/* the global lock's header-row button, the same on every surface */
export function LockButton() {
  const { locked, toggle } = useLock();
  return (
    <Button variant="ghost" size="icon-sm" onClick={toggle} className="size-8"
            title={locked ? "unlock — everything editable" : "lock — read-only everywhere"}>
      {locked ? <Lock className="size-4 text-gold" /> : <LockOpen className="size-4" />}
    </Button>
  );
}

export const Nothing = ({ children }: { children: ReactNode }) =>
  <p className="italic text-faint">{children}</p>;

/* the one full-screen image overlay (nest widgets, canvas thumbnails):
   wheel zooms around the cursor, drag pans, click toggles fit ↔ 2× at the
   cursor, Esc or the backdrop closes. Transform maps image point i to
   screen q = offset + s·i, so a zoom keeping q fixed moves the offset by
   q − (s'/s)(q − offset). A nest image widget opens as a gallery: title and
   description under the picture, and with several images arrows, ←/→, a
   counter and a thumbnail strip. Callers keep the component keyed by index
   so stepping remounts — that resets the zoom and keeps this stateless. */
export function ImageLightbox({ src, alt, onClose, title, descr, gallery }: {
  src: string; alt: string; onClose: () => void;
  title?: string; descr?: string;
  gallery?: { urls: string[]; index: number; onIndex: (i: number) => void };
}) {
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const moved = useRef(false); // a pan must not fire the click toggle

  function zoom(cx: number, cy: number, k: number) {
    setT(t => {
      const s = Math.min(8, Math.max(0.25, t.s * k));
      const qx = cx - innerWidth / 2, qy = cy - innerHeight / 2;
      return { s, x: qx - (s / t.s) * (qx - t.x), y: qy - (s / t.s) * (qy - t.y) };
    });
  }

  useEffect(() => {
    // wheel must beat page scroll — React's onWheel is passive, so wire it
    // by hand; the page behind is frozen while the overlay is up
    const el = box.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      // factor from the actual delta, not a fixed step: a pinch (ctrlKey)
      // streams dozens of tiny deltas — fixed 25% steps per event explode
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoom(e.clientX, e.clientY, Math.exp(-d * (e.ctrlKey ? 0.012 : 0.002)));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (!gallery) return;
      if (e.key === "ArrowRight") gallery.onIndex(Math.min(gallery.urls.length - 1, gallery.index + 1));
      if (e.key === "ArrowLeft") gallery.onIndex(Math.max(0, gallery.index - 1));
    };
    addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      el.removeEventListener("wheel", wheel);
      removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    moved.current = false;
    const sx = e.clientX, sy = e.clientY, from = t;
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 4) moved.current = true;
      setT({ s: from.s, x: from.x + ev.clientX - sx, y: from.y + ev.clientY - sy });
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  const click = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (moved.current) return;
    if (t.s === 1) zoom(e.clientX, e.clientY, 2);
    else setT({ s: 1, x: 0, y: 0 });
  };
  const many = !!gallery && gallery.urls.length > 1;
  const caption = !!(title || descr || many);
  const step = (i: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    gallery!.onIndex(i);
  };
  return (
    <div ref={box} onClick={onClose}
         className={cn("fixed inset-0 z-50 flex items-center justify-center bg-black/85",
                         caption && "pb-40")}>
      <img src={src} alt={alt} draggable={false}
           onClick={click} onPointerDown={down}
           style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }}
           className={cn("max-w-[94vw] rounded-lg shadow-pop select-none",
                           caption ? "max-h-[72dvh]" : "max-h-[92dvh]",
                           t.s === 1 ? "cursor-zoom-in" : "cursor-zoom-out")} />
      {many && gallery.index > 0 && (
        <button onClick={step(gallery.index - 1)} title="previous (←)"
                className="absolute top-1/2 left-3 z-10 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white">
          <ChevronLeft className="size-6" />
        </button>
      )}
      {many && gallery.index < gallery.urls.length - 1 && (
        <button onClick={step(gallery.index + 1)} title="next (→)"
                className="absolute top-1/2 right-3 z-10 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white">
          <ChevronRight className="size-6" />
        </button>
      )}
      {caption && (
        <div onClick={e => e.stopPropagation()}
             className="absolute inset-x-0 bottom-0 flex cursor-default flex-col items-center gap-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-6 pt-12 pb-4">
          {title && <div className="font-display text-[17px] text-white/95">{title}</div>}
          {descr && (
            <div className="max-w-[64ch] text-center text-[14px]/[1.55] text-white/70">{descr}</div>
          )}
          {many && (
            <>
              <div className="mt-1 flex max-w-[90vw] gap-1.5 overflow-x-auto [scrollbar-width:thin]">
                {gallery.urls.map((u, i) => (
                  <img key={u} src={u} alt="" onClick={step(i)}
                       className={cn("size-12 flex-none cursor-pointer rounded-sm object-cover transition-opacity",
                                       i === gallery.index
                                         ? "opacity-100 ring-2 ring-gold"
                                         : "opacity-50 hover:opacity-90")} />
                ))}
              </div>
              <span className="font-mono text-[11px] text-white/55">
                {gallery.index + 1} / {gallery.urls.length}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* the app-wide lightbox: plain-DOM surfaces (the livemd thumbnail button,
   mdlite thumbnails) can't render ImageLightbox themselves — they dispatch
   "slate-lightbox" with {src, alt} and this one component, mounted once in
   App, answers. It also catches clicks on any .md-thumb (read-only
   thumbnails), whose <a> stays as a no-JS fallback. */
export function GlobalLightbox() {
  const [img, setImg] = useState<{ src: string; alt: string } | null>(null);
  useEffect(() => {
    const open = (e: Event) => setImg((e as CustomEvent).detail);
    const click = (e: MouseEvent) => {
      const t = e.target instanceof Element && e.target.closest("img.md-thumb");
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      const el = t as HTMLImageElement;
      setImg({ src: el.src, alt: el.alt });
    };
    document.addEventListener("slate-lightbox", open);
    document.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("slate-lightbox", open);
      document.removeEventListener("click", click, true);
    };
  }, []);
  return img
    ? <ImageLightbox src={img.src} alt={img.alt} onClose={() => setImg(null)} />
    : null;
}

/* Raw HTML rendered outside React's reconciler: children are written
   imperatively, and only when the string actually changes. React's
   dangerouslySetInnerHTML re-assigns identical html on poll re-renders
   (observed live), recreating every child node — which destroys any text
   selection the reader is holding: the anchor dies mid-drag and the
   selection re-anchors above and balloons. All raw-html rendering goes
   through this component; never inline dangerouslySetInnerHTML. */
export function RawHtml({ tag = "div", html, className, onClick }: {
  tag?: "div" | "pre" | "span"; html: string; className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLElement & { __html?: string }>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.__html !== html) { el.innerHTML = html; el.__html = html; }
  }, [html]);
  const Tag = tag as "div";
  return <Tag ref={ref as React.Ref<HTMLDivElement>} className={className} onClick={onClick} />;
}

/* the one budget/usage meter — brain budget, memory cap, wet-ink bars */
export function Meter({ frac, color = "var(--color-gold)", className }: {
  frac: number; color?: string; className?: string;
}) {
  return (
    <div className={cn("h-2.5 overflow-hidden rounded-sm bg-line-soft", className)}>
      <div className="h-full rounded-sm"
           style={{ width: `${Math.min(100, 100 * frac)}%`, background: color }} />
    </div>
  );
}

export function SearchRow({ value, onChange, placeholder, className }: {
  value: string; onChange: (v: string) => void; placeholder: string; className?: string;
}) {
  return (
    <div className={cn("mb-6.5", className)}>
      <Input placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

export function DayCard({ day, today, empty, delay, children }: {
  day: string; today: boolean; empty?: boolean; delay?: number; children: ReactNode;
}) {
  const state = "rounded-full border px-2 py-0.5 text-[10px] tracking-[.14em] uppercase "
    + (today ? "border-gold-dim text-gold" : "border-line text-dim");
  return (
    <article className={cn("reveal relative mb-4.5 rounded-xl border bg-raise px-6.5 py-5 transition-colors",
                             today ? "border-gold-dim" : "border-line-soft hover:border-line")}
             style={delay ? { animationDelay: `${delay}ms` } : undefined}>
      <div className="mb-2.5 flex items-center gap-2.5 font-mono text-xs tracking-[.12em] text-faint">
        <span>{day}</span><span className="text-dim">{dow(day)}</span>
        <span className={state}>
          {today && <span className="pulse mr-1.5 inline-block size-[5px] rounded-full bg-gold align-[1px]" />}
          {today ? "wet ink" : "stone"}
        </span>
      </div>
      <div className={cn("text-[16px] font-normal whitespace-pre-wrap [overflow-wrap:anywhere]", empty && "italic text-faint")}>
        {children}
      </div>
    </article>
  );
}
