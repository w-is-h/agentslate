/* Rendered mdlite HTML. The generator escapes everything itself; wikilink
   clicks are delegated here — data-path opens the file viewer (?f= in the
   url), data-link goes to the page's own resolver (memory files). */

import { useSearchParams } from "react-router-dom";
import { RawHtml } from "@/components/bits";
import { cn } from "@/lib/utils";

export default function Prose({ html, wide, onLink }: {
  html: string;
  wide?: boolean;
  onLink?: (name: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  const click = (e: React.MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(".wikilink");
    if (!t) return;
    if (t.dataset.path) {
      params.set("f", t.dataset.path);
      setParams(params);
    } else if (t.dataset.link && onLink) onLink(t.dataset.link);
  };
  return <RawHtml className={cn("prose reveal", wide && "wide")}
                  onClick={click} html={html} />;
}
