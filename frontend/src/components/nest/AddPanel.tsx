import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, Code, Copy, FileText, Image as ImageIcon, Maximize2, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { getCanvases, getHtmls, post, uploadNestFiles, type CanvasMeta, type HtmlMeta } from "@/api/client";
import HtmlEditor from "@/components/nest/HtmlEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function GhostCell({ col, row, board, onOpen, onAdded }: {
  col: number; row: number; board: string; onOpen: () => void; onAdded: () => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <button onClick={onOpen} style={{ gridColumnStart: col, gridRowStart: row }}
            onDragOver={e => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={e => {
              e.preventDefault();
              setOver(false);
              const fs = [...e.dataTransfer.files];
              if (fs.length) uploadNestFiles(col, row, fs, board).then(onAdded);
            }}
            className={cn("group/ghost flex h-full cursor-pointer items-center justify-center",
                            "rounded-md border border-dashed transition-colors",
                            over ? "border-gold bg-hover"
                                 : "border-transparent hover:border-line focus-visible:border-line")}>
      <Plus className={cn("size-5 text-faint transition-opacity",
                            over ? "text-gold opacity-100"
                                 : "opacity-0 group-hover/ghost:opacity-100 group-focus-visible/ghost:opacity-100")} />
    </button>
  );
}

export function AddPanel({ col, row, board, onClose, onAdded }: {
  col: number; row: number; board: string; onClose: () => void; onAdded: () => void;
}) {
  const [mode, setMode] = useState<"pick" | "canvas" | "file" | "html">("pick");
  const [canvases, setCanvases] = useState<CanvasMeta[] | null>(null);
  const [htmls, setHtmls] = useState<HtmlMeta[] | null>(null);
  const [editingDoc, setEditingDoc] = useState<number | null>(null);
  const [markup, setMarkup] = useState("");
  const [hq, setHq] = useState(""); // filters the saved-docs list
  const [hview, setHview] = useState<"place" | "new">("place");
  const [popped, setPopped] = useState(false); // the creator, in a roomy modal
  const [armedDoc, setArmedDoc] = useState(0); // saved-doc delete arms first
  const [name, setName] = useState("");
  // keyboard selection over the filtered list: -1 = nothing picked, Enter
  // creates; arrows move, Enter takes the highlighted canvas
  const [sel, setSel] = useState(-1);
  const selRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const q = name.trim().toLowerCase();
  const shown = mode === "canvas"
    ? (canvases || []).filter(c => !q || c.label.toLowerCase().includes(q)) : [];
  useEffect(() => { selRef.current?.scrollIntoView({ block: "nearest" }); }, [sel]);
  // fetched on open — the picker list, and the shortcuts' click-time lookup
  useEffect(() => { getCanvases().then(j => setCanvases(j.canvases)).catch(() => {}); }, []);
  // the saved html documents load when the html mode opens
  useEffect(() => {
    if (mode === "html" && !htmls) getHtmls().then(j => setHtmls(j.htmls)).catch(() => {});
  }, [mode, htmls]);
  // pasted files — any kind, not just images — land in this cell whichever
  // mode the panel is in; the backend sorts image widget vs file card
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      const fs = [...(e.clipboardData?.items || [])].filter(i => i.kind === "file")
        .map(i => i.getAsFile()).filter((f): f is File => !!f);
      if (fs.length) { e.preventDefault(); uploadNestFiles(col, row, fs, board).then(onAdded); }
    };
    document.addEventListener("paste", h);
    return () => document.removeEventListener("paste", h);
  }, [col, row, board, onAdded]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && editingDoc == null && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [editingDoc, onClose]);
  // a click outside the in-cell creator closes it (the popped modal's own
  // backdrop already does this job, so skip while popped); window blur
  // catches clicks that land inside iframe tiles
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (popped || editingDoc != null) return;
    const h = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target))
        onClose();
    };
    const blur = () => onClose();
    document.addEventListener("pointerdown", h, true); // capture — see above
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", h, true);
      window.removeEventListener("blur", blur);
    };
  }, [popped, editingDoc, onClose]);
  // a dense grid means tiny cells — the in-cell creator can't fit, so it
  // opens straight into the modal instead of spilling over its block.
  // Layout effect: the measurement and flip land BEFORE the first paint,
  // or the cell version flashes for a frame
  useLayoutEffect(() => {
    const r = rootRef.current?.getBoundingClientRect();
    if (r && (r.width < 240 || r.height < 200)) setPopped(true);
  }, []);
  const addCanvas = (canvas_id: number, title = "") =>
    post("/api/nest/add", { col, row, board, canvas_id, title }).then(onAdded);
  const refreshHtmls = () => getHtmls().then(j => setHtmls(j.htmls)).catch(() => {});
  const copyHtml = (id: number) =>
    post("/api/nest/html/copy", { id }).then(refreshHtmls);
  // the same creator lives in the cell or, popped out, in a roomy modal —
  // one body, one set of state, two frames
  const body = (
    <>
      <div className="mb-2.5 flex flex-none items-center gap-2">
        {mode !== "pick" && (
          <button title="back" onClick={() => setMode("pick")}
                  className="-ml-1 cursor-pointer text-faint hover:text-ink">
            <ChevronLeft className="size-4" />
          </button>
        )}
        <span className="font-mono text-[11px] tracking-[.14em] text-faint uppercase">
          {mode === "pick" ? "add a widget" : mode === "canvas" ? "place a canvas"
            : mode === "html" ? "place html" : "place a file"}
        </span>
        <span className="ml-auto flex flex-none items-center gap-2.5">
          {!popped && (
            <button title="pop out" onClick={() => setPopped(true)}
                    className="cursor-pointer text-faint hover:text-ink">
              <Maximize2 className="size-3.5" />
            </button>
          )}
          <button onClick={onClose} className="cursor-pointer text-faint hover:text-ink">
            <X className="size-4" />
          </button>
        </span>
      </div>
      {mode === "pick" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3.5">
          <div className="flex flex-none flex-wrap gap-2.5">
            <Button variant="outline" size="sm" onClick={() => setMode("canvas")}>
              <FileText className="size-3.5" />canvas
            </Button>
            <Button variant="outline" size="sm" onClick={() => setMode("file")}>
              <ImageIcon className="size-3.5" />image / file
            </Button>
            <Button variant="outline" size="sm" onClick={() => setMode("html")}>
              <Code className="size-3.5" />html
            </Button>
          </div>
          <i className="h-px flex-none bg-line-soft" />
          {/* shortcuts = starred canvases (the star in any canvas view —
              the chaos pad is just one of them); there can be many, so
              the block scrolls inside whatever room the cell or modal has */}
          <div className="flex min-h-0 flex-1 flex-wrap content-start gap-2.5 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
            {(canvases || []).filter(c => c.starred).map(c => (
              <Button key={c.id} variant="outline" size="sm" onClick={() => addCanvas(c.id)}>
                <Star className="size-3.5 fill-gold-dim text-gold-dim" />
                <span className="max-w-40 truncate">{c.label}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
      {mode === "canvas" && (
        // one input, two jobs: it filters the canvases, and Enter takes the
        // arrow-highlighted one — or, with nothing highlighted, creates
        // a new canvas under the typed name
        <>
          <form className="flex-none"
                onSubmit={e => {
                  e.preventDefault();
                  if (sel >= 0 && shown[sel]) addCanvas(shown[sel].id);
                  else addCanvas(0, name.trim() || "untitled");
                }}>
            <Input value={name} autoFocus
                   onChange={e => { setName(e.target.value); setSel(-1); }}
                   onKeyDown={e => {
                     if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(shown.length - 1, s + 1)); }
                     if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(-1, s - 1)); }
                   }}
                   placeholder="search — Enter creates a new one" />
          </form>
          {!!shown.length && (
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
              {shown.map((c, i) => (
                <button key={c.id} onClick={() => addCanvas(c.id)}
                        ref={i === sel ? selRef : undefined}
                        className={cn("flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover",
                                        i === sel && "bg-hover")}>
                  <FileText className="size-3.5 flex-none text-gold-dim" />
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{c.label}</span>
                  <span className="flex-none font-mono text-[11px] text-faint">#{c.id}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {mode === "html" && (
        // two tabs, the canvas-mode shape: place = search over every saved
        // document (they outlive their widgets), new = paste a fresh one.
        // × on a row deletes a doc for good.
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex flex-none border-b border-line-soft">
            {(["place", "new"] as const).map(v => (
              <button key={v} onClick={() => setHview(v)}
                      className={cn("-mb-px cursor-pointer border-b-2 px-3 pb-1.5 text-[13px] transition-colors",
                                      hview === v ? "border-gold text-ink"
                                        : "border-transparent text-dim hover:text-ink")}>
                {v === "place" ? "place a widget" : "new widget"}
              </button>
            ))}
          </div>
          {hview === "place" ? (
            <>
              <Input value={hq} autoFocus onChange={e => setHq(e.target.value)}
                     placeholder="search saved documents" className="flex-none" />
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
                {(htmls || []).filter(d => !hq.trim()
                  || d.title.toLowerCase().includes(hq.trim().toLowerCase())
                  || String(d.id).includes(hq.trim())).map(d => (
                  <div key={d.id}
                       className="group/doc flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover">
                    <button onClick={() => post("/api/nest/add", { col, row, board, html_id: d.id }).then(onAdded)}
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
                      <Code className="size-3.5 flex-none text-gold-dim" />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{d.title}</span>
                      <span className="flex-none font-mono text-[11px] text-faint">#{d.id}</span>
                    </button>
                    <button title={`edit document #${d.id}`} onClick={() => setEditingDoc(d.id)}
                            className="flex-none cursor-pointer text-faint opacity-0 group-hover/doc:opacity-100 hover:text-gold focus:opacity-100">
                      <Pencil className="size-3.5" />
                    </button>
                    <button title={`copy document #${d.id} to a new id`} onClick={() => copyHtml(d.id)}
                            className="flex-none cursor-pointer text-faint opacity-0 group-hover/doc:opacity-100 hover:text-gold focus:opacity-100">
                      <Copy className="size-3.5" />
                    </button>
                    <button title={armedDoc === d.id ? "click again — gone for good" : "delete the saved document"}
                            onClick={() => {
                              if (armedDoc !== d.id) {
                                setArmedDoc(d.id);
                                setTimeout(() => setArmedDoc(a => a === d.id ? 0 : a), 2500);
                                return;
                              }
                              post("/api/nest/html/rm", { id: d.id })
                                .then(() => setHtmls(hs => (hs || []).filter(h => h.id !== d.id)));
                            }}
                            className={cn("flex-none cursor-pointer opacity-0 group-hover/doc:opacity-100",
                                            armedDoc === d.id ? "text-overdue opacity-100" : "text-faint hover:text-overdue")}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
                {htmls && !htmls.length && (
                  <p className="px-2 py-1.5 text-[13px] italic text-faint">nothing saved yet</p>
                )}
              </div>
            </>
          ) : (
            <>
              <textarea value={markup} autoFocus
                        onChange={e => setMarkup(e.target.value)}
                        placeholder="paste a complete html document"
                        className="min-h-16 flex-1 resize-none rounded-md border border-line bg-bg p-2 font-mono text-[12.5px]/[1.5] text-ink outline-none [scrollbar-width:thin] focus:border-gold-dim" />
              <Button variant="outline" size="sm" disabled={!markup.trim()}
                      onClick={() => post("/api/nest/add", { col, row, board, html: markup }).then(onAdded)}>
                <Code className="size-3.5" />place it
              </Button>
            </>
          )}
        </div>
      )}
      {mode === "file" && (
        <div onDragOver={e => e.preventDefault()}
             onDrop={e => {
               e.preventDefault();
               const fs = [...e.dataTransfer.files];
               if (fs.length) uploadNestFiles(col, row, fs, board).then(onAdded);
             }}
             className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
          <span className="px-2 text-center text-[14px] text-dim">
            drop or paste anything — images show as images, several at once make a gallery
          </span>
          <Button variant="quiet" size="none" className="text-xs" onClick={() => fileRef.current?.click()}>
            browse…
          </Button>
          <input ref={fileRef} type="file" hidden multiple
                 onChange={e => {
                   const fs = [...(e.target.files || [])];
                   if (fs.length) uploadNestFiles(col, row, fs, board).then(onAdded);
                 }} />
        </div>
      )}
    </>
  );
  const editor = editingDoc != null && (
    <HtmlEditor id={editingDoc} onClose={() => setEditingDoc(null)} onChanged={refreshHtmls} />
  );
  if (popped) return (
    <>
      <div style={{ gridColumnStart: col, gridRowStart: row }}
           className="rounded-md border border-dashed border-line-soft" />
      <div onClick={onClose}
           className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
        <div onClick={e => e.stopPropagation()}
             className="flex h-[70dvh] w-[560px] min-w-0 max-w-[92vw] flex-col rounded-md border border-line bg-raise p-4 shadow-float">
          {body}
        </div>
      </div>
      {editor}
    </>
  );
  return (
    <>
      <div ref={rootRef} style={{ gridColumnStart: col, gridRowStart: row }}
           className="flex h-full min-h-0 flex-col rounded-md border border-dashed border-line-soft p-3.5">
        {body}
      </div>
      {editor}
    </>
  );
}
