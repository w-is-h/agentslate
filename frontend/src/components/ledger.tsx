/* the ledger rail language of the memory index: an
   underline search instrument, small-caps section heads on a rule with a
   terminal fold chevron, flush rows marked by ink weight and a gold bar
   in the left margin, and highlighted search-hit cards. */

import { ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function RailSearch({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div className="relative mb-4 flex-none">
      <Search className="pointer-events-none absolute top-1/2 left-0 size-3.5 -translate-y-1/2 text-faint" />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} spellCheck={false}
             className="w-full border-b border-line bg-transparent py-1.5 pr-6 pl-6 text-[13.5px] text-ink outline-none transition-colors placeholder:font-mono placeholder:text-[12px] placeholder:tracking-[.08em] placeholder:text-faint focus:border-gold-dim" />
      {value && (
        <button onClick={() => onChange("")} aria-label="clear search"
                className="absolute top-1/2 right-0 -translate-y-1/2 cursor-pointer p-1 text-faint hover:text-ink">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/* the section device: hue dot, small-caps label, a rule running out to
   the fold chevron; collapsed sections show their row count on the rule.
   With onSelect the label is its own button (a section that is also a
   page) and only the rule + chevron fold. */
export function SectionHead({ hue, label, open, count, onToggle, onSelect, active }: {
  hue: string; label: string; open: boolean; count?: number; onToggle: () => void;
  onSelect?: () => void; active?: boolean;
}) {
  return (
    <div className="group/g mb-1 flex w-full items-center gap-2 py-0.5">
      <span className="size-[5px] flex-none rounded-full" style={{ background: hue }} />
      <button onClick={onSelect ?? onToggle}
              className={cn("cursor-pointer font-mono text-[11px] font-medium tracking-[.16em] uppercase transition-colors",
                            active ? "text-ink" : "text-dim hover:text-ink")}>
        {label}
      </button>
      <button onClick={onToggle} className="flex min-w-3 flex-1 cursor-pointer items-center gap-2">
        <span className="h-px min-w-3 flex-1 bg-line-soft" />
        {!open && count !== undefined && <span className="font-mono text-[10.5px] text-faint">{count}</span>}
        <ChevronRight className={cn("size-3 flex-none text-faint transition-transform group-hover/g:text-ink",
                                    open && "rotate-90")} />
      </button>
    </div>
  );
}

/* a ledger row: flush left, ink weight for state, a 2px gold bar in the
   left margin when active; `right` is the row's numeral-column cell. `sub`
   is a row nested under another row — one ink step fainter at rest, so
   the levels read apart without a second device */
export function RailRow({ active, sub, onClick, right, children }: {
  active: boolean; sub?: boolean; onClick: () => void; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="relative flex items-center">
      {active && <span className="absolute inset-y-[6px] left-0 w-[2px] bg-gold" />}
      <button onClick={onClick}
              className={cn("min-w-0 flex-1 cursor-pointer truncate py-[5px] pr-2 pl-[13px] text-left text-[14px] transition-colors",
                            active ? "font-medium text-ink" : sub ? "text-faint hover:text-ink" : "text-dim hover:text-ink")}>
        {children}
      </button>
      {right}
    </div>
  );
}

/* one line of a search hit, the match lit gold; trimmed to start near it */
export function Snip({ text, q }: { text: string; q: string }) {
  const t = text.trim();
  const i = t.toLowerCase().indexOf(q);
  if (i < 0) return <>{t}</>;
  const a = Math.max(0, i - 40);
  return (
    <>
      {a > 0 && "…"}{t.slice(a, i)}
      <mark className="bg-transparent font-medium text-gold">{t.slice(i, i + q.length)}</mark>
      {t.slice(i + q.length)}
    </>
  );
}

export function HitCard({ head, lines, more, q, onClick }: {
  head: React.ReactNode; lines: string[]; more: number; q: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
            className="mb-1.5 block w-full cursor-pointer rounded-lg border border-line-soft px-4 py-3 text-left transition-colors hover:border-gold-dim hover:bg-hover">
      <div className="mb-1 font-mono text-[12.5px] text-ink">{head}</div>
      {lines.map((l, i) => (
        <div key={i} className="truncate text-[13.5px] text-dim"><Snip text={l} q={q} /></div>
      ))}
      {more > 0 &&
        <div className="mt-0.5 font-mono text-[10.5px] text-faint">+{more} more line{more === 1 ? "" : "s"}</div>}
    </button>
  );
}
