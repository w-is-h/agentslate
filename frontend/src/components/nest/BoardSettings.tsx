import { useEffect, useRef, useState, type FormEvent } from "react";
import { Blocks, Lock, LockOpen, Maximize2, Minimize2, Pencil, Settings, Trash2 } from "lucide-react";
import { post } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useLock } from "@/hooks/useLock";
import { cn } from "@/lib/utils";

const GRIDS: [number, number][] = [[4, 4], [6, 4], [8, 5]];

/* The same controls appear in the floating menu and a board's settings
   widget. Board actions work while the content lock is on. */
export default function BoardSettings({ cols, rows, hidden, board, boards, full, onFull, onChanged, onOpen, embedded = false }: {
  cols: number; rows: number; hidden: number;
  board: string; boards: string[];
  full?: boolean; onFull?: () => void; onChanged: () => void;
  onOpen: (name: string) => void;
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [custom, setCustom] = useState("");
  const [newName, setNewName] = useState("");
  const [rename, setRename] = useState<string | null>(null);
  const [armedBoard, setArmedBoard] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const showSettings = !embedded || expanded;
  const { locked, toggle: toggleLock } = useLock();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (boxRef.current && event.target instanceof Node && !boxRef.current.contains(event.target))
        setOpen(false);
    };
    const blur = () => setOpen(false);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", blur);
    };
  }, [open]);

  const showWidget = async () => {
    setPlacing(true);
    setError("");
    try {
      await post("/api/nest/settings", { name: board });
      setOpen(false);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPlacing(false);
    }
  };

  const createBoard = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (name) post("/api/nest/board", { name })
      .then(() => { setNewName(""); onOpen(name); });
  };
  const commitRename = (event: FormEvent) => {
    event.preventDefault();
    const name = rename?.trim();
    if (name && name !== board)
      post("/api/nest/board/rename", { old: board, new: name })
        .then(() => { setRename(null); onOpen(name); });
    else setRename(null);
  };
  const removeBoard = () => {
    if (!armedBoard) {
      setArmedBoard(true);
      setTimeout(() => setArmedBoard(false), 2500);
      return;
    }
    post("/api/nest/board/rm", { name: board }).then(() => onOpen("main"));
  };
  const applyCustom = (event: FormEvent) => {
    event.preventDefault();
    const match = custom.trim().match(/^(\d{1,2})\s*[x×]\s*(\d{1,2})$/);
    if (match) post("/api/nest/grid", { cols: +match[1], rows: +match[2], board })
      .then(() => { setCustom(""); onChanged(); });
  };
  const clear = () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 2500);
      return;
    }
    post("/api/nest/clear", { name: board }).then(() => { setOpen(false); onChanged(); });
  };

  const panel = (
    <div className={cn("flex min-h-0 flex-col",
                       embedded ? "flex-1" : "max-h-[80dvh] max-w-72 rounded-md border border-line bg-raise shadow-float")}>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain p-3 [scrollbar-width:thin] [&>*]:shrink-0">
        {!embedded && <span className="flex items-center gap-2 font-mono text-[11px] tracking-[.14em] text-faint uppercase">
          boards
        </span>}
        <div className="flex flex-wrap items-center gap-1.5">
          {boards.map(name => name === board && rename !== null ? (
            <form key={name} onSubmit={commitRename} className="max-w-full">
              <input autoFocus value={rename} onChange={event => setRename(event.target.value)}
                     onKeyDown={event => event.key === "Escape" && setRename(null)}
                     onBlur={() => setRename(null)}
                     className="h-8 w-28 max-w-full rounded-md border border-gold-dim bg-bg px-2 font-mono text-[12px] text-ink outline-none" />
            </form>
          ) : (
            <Button key={name} variant="outline" size="sm"
                    className={cn("max-w-[min(10rem,100%)]", name === board && "border-gold-dim text-gold")}
                    onClick={() => onOpen(name)}>
              <span className="truncate">{name}</span>
            </Button>
          ))}
          {showSettings && <form onSubmit={createBoard} className="max-w-full">
            <input value={newName} onChange={event => setNewName(event.target.value)}
                   placeholder="new board" title="name a new board — Enter creates it and opens it here"
                   className="h-8 w-24 max-w-full rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-ink outline-none placeholder:text-faint focus:border-gold-dim" />
          </form>}
        </div>
        {showSettings && <>
          <span className="flex flex-wrap items-center gap-2 font-mono text-[11px] tracking-[.14em] text-faint uppercase">
            this board
            {board !== "main" && (
              <span className="ml-auto flex items-center gap-1.5">
                <button title={`rename "${board}"`} onClick={() => setRename(board)}
                        className="cursor-pointer p-0.5 text-faint hover:text-ink">
                  <Pencil className="size-3" />
                </button>
                <button title={armedBoard ? "click again — board and widgets go" : `delete "${board}"`}
                        onClick={removeBoard}
                        className={cn("cursor-pointer p-0.5",
                                        armedBoard ? "text-overdue" : "text-faint hover:text-overdue")}>
                  <Trash2 className="size-3" />
                </button>
              </span>
            )}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {GRIDS.map(([gridCols, gridRows]) => (
              <Button key={gridCols} variant="outline" size="sm"
                      title={gridCols < cols || gridRows < rows ? "smaller grid — widgets past the edge close" : `${gridCols}×${gridRows}`}
                      className={cn(cols === gridCols && rows === gridRows && "border-gold-dim text-gold")}
                      onClick={() => post("/api/nest/grid", { cols: gridCols, rows: gridRows, board }).then(onChanged)}>
                {gridCols}×{gridRows}
              </Button>
            ))}
            <form onSubmit={applyCustom}>
              <input value={custom} onChange={event => setCustom(event.target.value)}
                     placeholder={`${cols}×${rows}`} title="custom, e.g. 7x4 — Enter applies"
                     className="h-8 w-14 rounded-md border border-line bg-bg px-2 text-center font-mono text-[12px] text-ink outline-none placeholder:text-faint focus:border-gold-dim" />
            </form>
          </div>
          {onFull && <Button variant="outline" size="sm" onClick={onFull}
                             className="h-auto min-h-8 whitespace-normal py-1.5">
            {full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            {full ? "exit full screen" : "full screen"}
          </Button>}
          <Button variant="outline" size="sm" onClick={toggleLock}
                  className={cn("h-auto min-h-8 whitespace-normal py-1.5", locked && "border-gold-dim text-gold")}>
            {locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
            <span className="min-w-0 [overflow-wrap:anywhere]">{locked ? "locked — unlock" : "lock canvases and pages"}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={clear}
                  className={cn("h-auto min-h-8 whitespace-normal py-1.5", armed && "border-overdue text-overdue")}>
            <Trash2 className="size-3.5" /><span className="min-w-0 [overflow-wrap:anywhere]">{armed ? "sure? every widget goes" : "clear board"}</span>
          </Button>
          {hidden > 0 && (
            <span className="font-mono text-[11px] text-faint">
              {hidden} hidden under overlaps — move things to uncover
            </span>
          )}
        </>}
        {!embedded && (
          <Button variant="outline" size="sm" onClick={showWidget} disabled={placing}>
            <Blocks className="size-3.5" />show widget
          </Button>
        )}
        {error && <p role="alert" className="text-[12px] text-overdue">{error}</p>}
      </div>
      {embedded && (
        <button role="switch" aria-label="all settings" aria-checked={expanded}
                onClick={() => { setExpanded(value => !value); setRename(null); }}
                className="mx-3 mb-3 flex min-h-6 shrink-0 cursor-pointer items-center justify-between gap-2 text-[11px] text-dim hover:text-ink">
          <span className="min-w-0 text-left">all settings</span>
          <span className={cn("flex h-4 w-7 flex-none items-center rounded-full border px-0.5",
                              expanded ? "border-gold bg-gold/20" : "border-line bg-bg")}>
            <span className={cn("size-2.5 rounded-full transition-transform",
                                expanded ? "translate-x-3 bg-gold" : "bg-faint")} />
          </span>
        </button>
      )}
    </div>
  );
  if (embedded) return panel;
  return (
    <div ref={boxRef} className="fixed right-3 bottom-3 z-[65] flex flex-col items-end gap-2">
      {open && panel}
      <button onClick={() => { setError(""); setOpen(current => !current); }} title="board settings"
              className={cn("flex size-9 cursor-pointer items-center justify-center rounded-full",
                              "border border-line bg-raise text-faint shadow-float transition-colors",
                              "hover:text-ink", open && "text-gold hover:text-gold")}>
        <Settings className="size-4" />
      </button>
    </div>
  );
}
