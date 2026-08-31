/* Overlay for [text](~/path) prose links. The open file lives in the url
   (?f=path) so it's linkable and back closes it. */

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getFile } from "@/api/client";
import { mdlite, esc } from "@/lib/mdlite";
import { RawHtml } from "@/components/bits";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function FileViewer() {
  const [params, setParams] = useSearchParams();
  const path = params.get("f");
  const [file, setFile] = useState<{ path: string; name: string; html: string } | null>(null);

  const close = () => { params.delete("f"); setParams(params); };

  useEffect(() => {
    if (!path) { setFile(null); return; }
    let stale = false;
    getFile(path).then(f => {
      if (stale) return;
      if (!f) { close(); return; }
      const html = /\.(md|markdown)$/i.test(f.name)
        ? mdlite(f.content)
        : `<pre style="font:400 12.5px/1.7 var(--font-mono);white-space:pre-wrap">${esc(f.content)}</pre>`;
      setFile({ path, name: f.name, html });
    });
    return () => { stale = true; };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!path || !file) return null;
  return (
    <Dialog open onOpenChange={o => { if (!o) close(); }}>
      <DialogContent className="max-w-[860px]">
        <DialogHeader>
          <DialogTitle>{file.name}</DialogTitle>
          <span className="flex-1 overflow-hidden text-right font-mono text-[11.5px] text-ellipsis whitespace-nowrap text-faint">{file.path}</span>
        </DialogHeader>
        <DialogBody>
          <RawHtml className="prose wide [overflow-wrap:anywhere]" html={file.html} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
