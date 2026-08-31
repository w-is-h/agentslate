/* canvases: live documents the agent creates via the canvas tools and you
   edit in place as livemd — the full page at #/canvas, the nest's canvas
   tiles. Ids are permanent; the backend cuts content versions at author
   handoffs and configured idle gaps. */

import { useEffect, useState } from "react";
import { Check, Code, Copy, Eye, History, Maximize2, Minimize2, Star, Trash2, X } from "lucide-react";
import { mdlite } from "@/lib/mdlite";
import { getCanvasVersion, getCanvasVersions, post,
         type CanvasDoc, type CanvasVersion } from "@/api/client";
import { useCanvasDraft } from "@/hooks/useDraft";
import { useLock } from "@/hooks/useLock";
import { isMarkdownCanvas } from "@/lib/canvas";
import { LockButton, RawHtml } from "@/components/bits";
import LiveMd from "@/components/editor/LiveMd";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, copyRichText, copyText } from "@/lib/utils";

function HeadBtn({ title, active, disabled, onClick, children }: {
  title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <Button variant="ghost" size="icon-sm" title={title} onClick={onClick} disabled={disabled}
            className={cn("size-8", active && "text-gold")}>
      {children}
    </Button>
  );
}

export function CanvasView({ doc, page = false, wide, onWide, onClose, onDeleted }: {
  doc: CanvasDoc; page?: boolean; wide?: boolean; onWide?: () => void;
  onClose?: () => void; onDeleted?: () => void;
}) {
  const [src, setSrc] = useState(!isMarkdownCanvas(doc)); // file-backed docs' raw/rendered state
  const [copied, setCopied] = useState(false);
  // delete arms on the first click and fires on the second — the canvas and
  // its whole history go, so a lone misclick must not be enough
  const [armed, setArmed] = useState(false);
  // an archived run pinned in place of the live content, read-only
  const [viewing, setViewing] = useState<CanvasVersion | null>(null);
  const [vers, setVers] = useState<CanvasVersion[] | null>(null);
  const [vOpen, setVOpen] = useState(false);
  // starred canvases surface as one-click shortcuts on the nest's add panel;
  // local state so the toggle lands instantly, resynced from the poll
  const [starred, setStarred] = useState(doc.starred);
  useEffect(() => setStarred(doc.starred), [doc.id, doc.starred]);
  const star = () => {
    const on = !starred;
    setStarred(on);
    post("/api/canvas/star", { id: doc.id, on });
  };
  const { locked } = useLock();
  const editable = !doc.source; // the disk file is a file-backed canvas's truth
  const markdown = isMarkdownCanvas(doc);
  const { content, edit, err } = useCanvasDraft(doc);
  // keyed on id, not ts — autosave bumps ts, and that must not flip the view
  useEffect(() => setSrc(!isMarkdownCanvas(doc)), [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setArmed(false), [doc.id]);
  useEffect(() => { setViewing(null); setVers(null); }, [doc.id]);
  const shown = viewing ? viewing.content || "" : content;
  const openVers = (o: boolean) => {
    setVOpen(o);
    if (o) getCanvasVersions(doc.id).then(j => setVers(j.versions)).catch(() => {});
  };
  const nuke = () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 2500);
      return;
    }
    post("/api/canvas/rm", { id: doc.id }).then(() => onDeleted?.());
  };
  const copy = () => (markdown ? copyRichText(shown, mdlite(shown)) : copyText(shown)).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }).catch(() => {});
  return (
    <div className="min-w-0">
      {/* the label is the content's first line — renaming is editing the
          text, and the page view lets the content's own heading lead */}
      <div className={cn("group flex items-baseline gap-3", page ? "mb-2 flex-wrap" : "mb-4")}>
        {!page && <span className="min-w-0 truncate font-display text-[19px]">{doc.label}</span>}
        {doc.source && doc.source !== doc.label && (
          <span className="min-w-0 truncate font-mono text-xs text-faint">{doc.source}</span>
        )}
        <span className={cn("ml-auto flex flex-none items-center gap-0.5 self-center",
                            page && "max-[860px]:basis-full max-[860px]:justify-end")}>
          {onWide && (
            // the page's width toggle: prose column ↔ spread across the page.
            // Pointless on phones (the viewport is narrower than the column)
            <span className="max-[860px]:hidden">
              <HeadBtn title={wide ? "prose width" : "full width"} onClick={onWide}>
                {wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </HeadBtn>
            </span>
          )}
          {!editable && (
            <HeadBtn title={src ? "rendered" : "source"} onClick={() => setSrc(s => !s)}>
              {src ? <Eye className="size-4" /> : <Code className="size-4" />}
            </HeadBtn>
          )}
          {/* always there: the history is part of the canvas even when it is one run long */}
          <Popover open={vOpen} onOpenChange={openVers}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" title="versions"
                      className={cn("size-8", viewing && "text-gold")}>
                <History className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="max-h-72 w-76 overflow-y-auto overscroll-contain p-1 [scrollbar-width:thin]">
              <button onClick={() => { setViewing(null); setVOpen(false); }}
                      className={cn("flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-hover",
                                      !viewing && "bg-hover")}>
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">current — {doc.author}</span>
                <span className="flex-none font-mono text-[11px] text-faint">{doc.ts}</span>
              </button>
              {vers && vers.length === 0 && (
                <span className="block px-2.5 py-2 font-mono text-[11px] text-faint">no earlier versions</span>
              )}
              {(vers || []).map(v => (
                <button key={v.id}
                        onClick={() => getCanvasVersion(v.id).then(j => { setViewing(j.version); setVOpen(false); }).catch(() => {})}
                        className={cn("flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-hover",
                                        viewing?.id === v.id && "bg-hover")}>
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{v.author}</span>
                  <span className="flex-none font-mono text-[11px] text-faint">{v.ts}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <LockButton />
          <HeadBtn title={starred ? "unstar" : "star — a shortcut on the nest's add panel"}
                   onClick={star} disabled={locked}>
            <Star className={cn("size-4", starred && "fill-gold text-gold")} />
          </HeadBtn>
          <HeadBtn title="copy" onClick={copy}>
            {copied ? <Check className="size-4 text-gold" /> : <Copy className="size-4" />}
          </HeadBtn>
          {/* no honest pdf/md glyphs in the icon set — mono text labels */}
          <HeadBtn title="export pdf" onClick={() => location.assign(`/api/canvas/pdf?id=${doc.id}`)}>
            <span className="font-mono text-[10px] font-medium tracking-[.06em]">PDF</span>
          </HeadBtn>
          <HeadBtn title="export markdown" onClick={() => location.assign(`/api/canvas/md?id=${doc.id}`)}>
            <span className="font-mono text-[10px] font-medium tracking-[.06em]">MD</span>
          </HeadBtn>
          <HeadBtn title={armed ? "click again — deletes every version" : "delete canvas"}
                   onClick={nuke} disabled={locked}>
            <Trash2 className={cn("size-4", armed && "text-overdue")} />
          </HeadBtn>
          {onClose && (
            <HeadBtn title="close" onClick={onClose}><X className="size-4" /></HeadBtn>
          )}
        </span>
      </div>
      {viewing && (
        <div className="mb-4 flex items-baseline gap-2.5 font-mono text-[11px] text-faint">
          <span>{viewing.author}'s version, {viewing.ts} — read-only</span>
          <button onClick={() => setViewing(null)}
                  className="cursor-pointer text-gold-dim hover:text-gold">back to current</button>
        </div>
      )}
      {err && !viewing && (
        <div className="mb-2 font-mono text-[11px] text-overdue">{err}</div>
      )}
      {viewing
        ? markdown
          ? <RawHtml className="turn-md text-[16px] font-normal [overflow-wrap:anywhere]"
                     html={mdlite(shown)} />
          : <pre className="font-mono text-[12.5px]/[1.7] whitespace-pre-wrap [overflow-wrap:anywhere] text-dim">{shown}</pre>
        : editable
          // keyed by doc id: LiveMd is uncontrolled and refuses external
          // content while focused (typing-vs-poll protection) — navigating
          // to ANOTHER canvas must remount it or the old text lingers
          ? <LiveMd key={doc.id} value={content} onChange={edit}
                    copyHtml={markdown ? mdlite : undefined}
                    readOnly={locked} className="min-h-40" />
          : src
            ? <pre className="font-mono text-[12.5px]/[1.7] whitespace-pre-wrap [overflow-wrap:anywhere] text-dim">{content}</pre>
            : <RawHtml className="turn-md text-[16px] font-normal [overflow-wrap:anywhere]"
                       html={mdlite(content)} />}
    </div>
  );
}
