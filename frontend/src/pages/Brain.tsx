/* the brain: the cap meter, then the prose — edited in place like a
   memory page, autosaved, read-only under the lock */

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { post } from "@/api/client";
import { useDash } from "@/api/dash";
import { LockButton, Meter } from "@/components/bits";
import LiveMd from "@/components/editor/LiveMd";
import { Button } from "@/components/ui/button";
import { useDraft } from "@/hooks/useDraft";
import { useLock } from "@/hooks/useLock";
import { cn, copyText } from "@/lib/utils";

export default function Brain() {
  const { data } = useDash();
  const { locked } = useLock();
  const [copied, setCopied] = useState(false);
  // autosave through the store's own wall; a refusal (the hard cap) shows
  // instead of silently dropping the keystrokes
  const { content, edit, err } = useDraft("brain", data?.brain ?? "",
                                          text => post("/api/brain", { content: text }));
  if (!data) return null;
  const n = [...content].length, cap = data.brain_limit;
  const copy = () => copyText(content).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }).catch(() => {});
  return (
    <>
      <div className="mb-7 flex items-center gap-6">
        <div className="max-w-70 flex-1">
          <div className="mb-1 flex justify-between font-mono text-xs text-dim" title="hard cap — a save over it is refused">
            <span>cap</span><b className={cn(n > cap && "text-overdue")}>{n.toLocaleString()}/{cap.toLocaleString()}</b>
          </div>
          <Meter frac={n / cap} color={n > cap ? "var(--color-overdue)" : undefined} />
        </div>
        <span className="ml-auto flex items-center gap-0.5">
          <LockButton />
          <Button variant="ghost" size="icon-sm" onClick={copy} title="copy" className="size-8">
            {copied ? <Check className="size-4 text-gold" /> : <Copy className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm" title="export pdf" className="size-8"
                  onClick={() => location.assign("/api/brain/pdf")}>
            <span className="font-mono text-[10px] font-medium tracking-[.06em]">PDF</span>
          </Button>
        </span>
      </div>
      {err && <div className="mb-3 font-mono text-[11px] text-overdue">{err}</div>}
      <LiveMd value={content} onChange={edit} readOnly={locked} className="min-h-48" />
    </>
  );
}
