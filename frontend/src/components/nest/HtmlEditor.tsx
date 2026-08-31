import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Code, Copy, History, RotateCcw, X } from "lucide-react";
import {
  getHtml,
  getHtmlVersion,
  getHtmlVersions,
  post,
  type HtmlDoc,
  type HtmlVersion,
} from "@/api/client";
import { TextDiff } from "@/components/diff";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLock } from "@/hooks/useLock";
import { cn } from "@/lib/utils";

export default function HtmlEditor({ id, onClose, onChanged, page = false }: {
  id: number; onClose: () => void; onChanged: () => void; page?: boolean;
}) {
  const [docId, setDocId] = useState(id);
  const [doc, setDoc] = useState<HtmlDoc | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [versions, setVersions] = useState<HtmlVersion[]>([]);
  const [chosen, setChosen] = useState<HtmlVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { locked } = useLock();
  const dirty = !!doc && (title.trim() !== doc.title || content !== doc.content);
  const requestClose = () => {
    if (!dirty || window.confirm("Discard unsaved changes?")) onClose();
  };
  const close = useRef(requestClose);
  close.current = requestClose;

  const load = useCallback((target: number) => Promise.all([getHtml(target), getHtmlVersions(target)])
    .then(([d, v]) => {
      setDoc(d.html);
      setTitle(d.html.title);
      setContent(d.html.content);
      setVersions(v.versions);
      setChosen(null);
    }), []);

  useEffect(() => { load(docId).catch(() => close.current()); }, [docId, load]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);

  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setErr("");
    try {
      await work();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "request failed");
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    if (!doc || !title.trim()) return;
    perform(async () => {
      await post("/api/nest/html", { id: docId, title: title.trim(), content });
      await load(docId);
      onChanged();
    });
  };
  const copy = () => {
    perform(async () => {
      const made = await post("/api/nest/html/copy", { id: docId });
      if (!made.id || !made.html) throw new Error("copy failed");
      setDoc(made.html);
      setTitle(made.html.title);
      setContent(made.html.content);
      setVersions([]);
      setChosen(null);
      setDocId(made.id);
      onChanged();
    });
  };
  const choose = (version: HtmlVersion) =>
    getHtmlVersion(version.id).then(result => setChosen(result.version)).catch(() => {});
  const restore = () => {
    if (!chosen) return;
    perform(async () => {
      await post("/api/nest/html/restore", { id: docId, version: chosen.id });
      await load(docId);
      onChanged();
    });
  };

  return (
    <div onPointerDown={e => e.stopPropagation()} onClick={e => {
           if (!page && e.target === e.currentTarget) requestClose();
         }}
        className={page
           ? "flex h-[calc(100dvh-7rem)] min-h-[500px] w-full min-w-0 flex-col"
           : "fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-2 sm:p-5"}>
      <section className={cn("flex w-full min-w-0 flex-col overflow-hidden rounded-md border border-line bg-raise",
                              page ? "h-full" : "h-[96dvh] max-w-[1400px] shadow-pop sm:h-[92dvh]")}>
        <header className="flex flex-none flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
          {page && (
            <button onClick={requestClose} title="back"
                    className="cursor-pointer p-1 text-faint hover:text-ink">
              <ChevronLeft className="size-4" />
            </button>
          )}
          <Code className="size-4 flex-none text-gold-dim" />
          <span className="flex-none font-mono text-[12px] text-faint">HTML document #{docId}</span>
          <Input value={title} onChange={e => setTitle(e.target.value)}
                 readOnly={locked}
                 aria-label="document title" placeholder="document title"
                 className="order-3 w-full min-w-0 flex-1 sm:order-none sm:w-auto" />
          <Button variant="outline" size="sm" onClick={copy}
                  disabled={busy || !doc || locked || dirty}
                  title="copy to a new document id with independent history">
            <Copy className="size-3.5" />copy
          </Button>
          <Button variant="outline" size="sm" onClick={save}
                  disabled={busy || locked || !dirty || !title.trim()}>
            save
          </Button>
          {!page && (
            <button onClick={requestClose} title="close editor"
                    className="cursor-pointer p-1 text-faint hover:text-ink">
              <X className="size-4" />
            </button>
          )}
          {err && <span className="order-4 w-full font-mono text-[11px] text-overdue">{err}</span>}
        </header>
        {doc ? (
          <div className={cn("grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_340px] md:grid-rows-1",
                             versions.length
                               ? "grid-rows-[minmax(0,1fr)_minmax(180px,34dvh)]"
                               : "grid-rows-[minmax(0,1fr)_auto]")}>
            <div className="flex min-h-0 flex-col p-3 sm:p-4">
              <div className="mb-2 flex flex-none items-center justify-between gap-3 font-mono text-[11px] text-faint">
                <span>{content.length.toLocaleString()} chars</span>
                <span>live by {doc.author} · {doc.ts}</span>
              </div>
              <textarea value={content} onChange={e => setContent(e.target.value)} readOnly={locked}
                        aria-label="HTML source"
                        className="min-h-0 flex-1 resize-none rounded-md border border-line bg-bg p-3 font-mono text-[12.5px]/[1.55] text-ink outline-none [scrollbar-width:thin] focus:border-gold-dim" />
            </div>
            <aside className="flex min-h-0 flex-col border-t border-line md:border-t-0 md:border-l">
              <div className="flex flex-none items-center gap-2 px-3 pt-3 pb-2 font-mono text-[11px] tracking-[.12em] text-faint uppercase">
                <History className="size-3.5" />history · {versions.length}
              </div>
              <div className={cn("min-h-0 overflow-y-auto px-2 [scrollbar-width:thin]",
                                  chosen ? "max-h-32 flex-none" : "flex-1")}>
                {versions.map(version => (
                  <button key={version.id} onClick={() => choose(version)}
                          className={cn("flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left",
                                          chosen?.id === version.id ? "bg-hover text-ink" : "text-dim hover:bg-hover")}>
                    <span className="flex-none font-mono text-[11px] text-gold-dim">v{version.id}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px]">{version.title}</span>
                    <span className="flex-none font-mono text-[10px] text-faint">{version.author} · {version.ts.slice(0, 10)}</span>
                  </button>
                ))}
                {!versions.length && (
                  <p className="px-2 py-2 text-[12px] italic text-faint">No snapshots yet. The first save creates one.</p>
                )}
              </div>
              {chosen && (
                <div className="flex min-h-0 flex-1 flex-col border-t border-line-soft">
                  <div className="flex flex-none items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-dim">
                      v{chosen.id} → live
                    </span>
                    <Button variant="outline" size="sm" onClick={restore}
                            disabled={busy || locked || dirty}
                            title="restore this snapshot; the current state is preserved">
                      <RotateCcw className="size-3.5" />restore
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto border-t border-line-soft [scrollbar-width:thin]">
                    <TextDiff oldText={chosen.content || ""} newText={doc.content} />
                  </div>
                </div>
              )}
            </aside>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-faint">loading…</div>
        )}
      </section>
    </div>
  );
}
