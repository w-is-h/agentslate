import { useEffect, useRef, useState } from "react";
import { post, type CanvasDoc } from "@/api/client";

/* Autosave for every editable surface (canvases, memory pages). The draft
   is keyed, so a poll can never put text under the user's fingers; it
   clears the moment the server's copy matches it. Saves debounce 800ms
   and flush on unmount; a refused save (a cap) surfaces as err instead of
   silently dropping the keystrokes. */
export function useDraft(key: string | number, saved: string,
                         save: (text: string) => Promise<unknown>) {
  const [draft, setDraft] = useState<{ key: string | number; text: string } | null>(null);
  const [err, setErr] = useState<{ key: string | number; msg: string } | null>(null);
  const timer = useRef(0);
  const pending = useRef<(() => void) | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const content = draft?.key === key ? draft.text : saved;

  useEffect(() => {
    if (draft?.key === key && draft.text === saved) setDraft(null);
  }, [key, saved, draft]);
  // A key change keeps this hook mounted (memory navigation). Flush that
  // page's closure before the next page can replace the pending save.
  useEffect(() => () => {
    clearTimeout(timer.current);
    const run = pending.current;
    pending.current = null;
    run?.();
  }, [key]);

  const edit = (text: string) => {
    setDraft({ key, text });
    const run = () => {
      pending.current = null;
      const request = queue.current.then(() => save(text));
      queue.current = request.then(() => undefined, () => undefined);
      request.then(
        () => setErr(null),
        error => setErr({ key, msg: error instanceof Error ? error.message : "save failed" }),
      );
    };
    pending.current = run;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(run, 800);
  };
  return { content, edit, err: err?.key === key ? err.msg : null };
}

export const useCanvasDraft = (doc: CanvasDoc) =>
  useDraft(doc.id, doc.content, text => post("/api/canvas", { id: doc.id, content: text }));
