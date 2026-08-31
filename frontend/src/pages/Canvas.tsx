/* #/canvas — the canvas full-page. ?id=N pins one doc (nest tiles link
   here); without it, the latest-shown canvas renders and the agent's fresh
   show lands within a poll. */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getCanvas, type CanvasDoc } from "@/api/client";
import { Nothing } from "@/components/bits";
import { CanvasView } from "@/components/canvas";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WIDE_KEY = "slate.canvas-wide";

export default function CanvasPage() {
  const [doc, setDoc] = useState<CanvasDoc | null | undefined>(undefined);
  // prose column by default; the header's corner toggle spreads the canvas
  // across the page (persisted — a wide reader stays wide)
  const [wide, setWide] = useState(() => localStorage.getItem(WIDE_KEY) === "1");
  const id = Number(useSearchParams()[0].get("id")) || 0;
  const nav = useNavigate();
  const toggleWide = () => setWide(w => {
    localStorage.setItem(WIDE_KEY, w ? "0" : "1");
    return !w;
  });
  useEffect(() => {
    const load = () => getCanvas(id || undefined).then(j => setDoc(j.canvas)).catch(() => {});
    load();
    // even a pinned id needs the poll — it resolves to the chain's live
    // end, which moves under edits from either side
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [id]);
  useEffect(() => {
    if (doc) document.title = `slate · ${doc.label}`;
  }, [doc?.label]); // eslint-disable-line react-hooks/exhaustive-deps
  if (doc === undefined) return <Nothing>loading…</Nothing>;
  if (!doc) return <Nothing>the canvas is empty — the agent puts documents here with the canvas tools.</Nothing>;
  return (
    // w-full: an auto-margin child of a flex column shrink-wraps without it
    <div className={cn("mx-auto w-full", !wide && "max-w-[860px]")}>
      {/* back to wherever the canvas was opened from */}
      <Button variant="quiet" size="none" onClick={() => nav(-1)}
              className="mb-3 font-mono text-xs tracking-[.08em] text-faint hover:text-gold">
        ← back
      </Button>
      <CanvasView doc={doc} page wide={wide} onWide={toggleWide} onDeleted={() => nav(-1)} />
    </div>
  );
}
