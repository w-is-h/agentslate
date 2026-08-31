/* notes & tasks: the day-card timeline, newest first, live search */

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useDash } from "@/api/dash";
import { esc, hl } from "@/lib/mdlite";
import { DayCard, Nothing, RawHtml, SearchRow } from "@/components/bits";

/* a task-log line is `project: what got done` — the project is the chip.
   Kept in step with TASK_PREFIX_RE in store.py, which exempts the prefix
   from the day's character budget. */
const CHIP_LINE_RE = /^([^\s:]{1,48}):\s+(.*)$/;

/* a commit hash in a task line — 7+ hex chars with at least one letter,
   so plain numbers stay text */
const HASH_RE = /\b(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g;

/* wrap hashes in links to the repo the line's chip names; runs on escaped,
   search-highlighted html, so a hash split by a highlight just stays text */
const linkHashes = (html: string, repoUrl: string) =>
  html.replace(HASH_RE, h =>
    `<a href="${repoUrl}/commit/${h}" target="_blank" rel="noopener" class="underline decoration-line underline-offset-3 hover:decoration-gold">${h}</a>`);

export default function Logs({ kind }: { kind: "notes" | "tasks" }) {
  const { data } = useDash();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  if (!data) return null;

  const days = data[kind];
  const query = q.trim().toLowerCase();
  const list = [...days].reverse().filter(d => !query || d.body.toLowerCase().includes(query));
  if (!days.some(d => d.day === data.today) && !query)
    list.unshift({ day: data.today, body: "" });
  /* the notes summary: the rolling storyline, folded from the days below it at session
     end — collapsed to its header until clicked, or while a search hits it */
  const summary = kind === "notes" && data.note_summary
    && (!query || data.note_summary.toLowerCase().includes(query)) ? data.note_summary : "";
  const summaryOpen = open || !!query;

  return (
    <>
      <SearchRow value={q} onChange={setQ} placeholder={`search the ${kind}…`} />
      {summary && (
        <article className="reveal relative mb-4.5 rounded-xl border border-gold-dim bg-raise px-6.5 py-5">
          <button onClick={() => setOpen(o => !o)} aria-expanded={summaryOpen}
                  className="group flex w-full cursor-pointer items-center gap-2.5 font-mono text-xs tracking-[.12em] text-faint">
            <ChevronRight className={"size-3 flex-none transition-transform group-hover:text-ink" + (summaryOpen ? " rotate-90" : "")} />
            <span>summary</span><span className="text-dim">through {data.note_summary_through}</span>
            <span className="ml-auto">{summary.length}/{data.note_summary_limit}</span>
          </button>
          {summaryOpen && (
            <RawHtml className="mt-2.5 text-left text-[16px] font-normal whitespace-pre-wrap [overflow-wrap:anywhere]"
                     html={hl(esc(summary), query)} />
          )}
        </article>
      )}
      {list.length ? list.map((d, i) => (
        <DayCard key={d.day} day={d.day} today={d.day === data.today}
                 empty={!d.body} delay={Math.min(i, 8) * 45}>
          {!d.body ? "nothing yet — the day is young."
            : kind === "tasks" ? d.body.split("\n").filter(l => l.trim()).map((l, j) => {
                const m = l.match(CHIP_LINE_RE);
                /* a chip that is a page key with a learned host links out:
                   the chip to the repo, the line's hashes to its commits.
                   A group page (an org/group on the forge) has no host of
                   its own — it links when its learned children agree on
                   one; hashes never link through a group. */
                const prefix = m?.[1] ?? "";
                const host = data.repo_hosts[prefix];
                const repoUrl = host ? `https://${host}/${prefix}` : "";
                const kidHosts = prefix && !host
                  ? new Set(Object.entries(data.repo_hosts)
                      .filter(([k]) => k.startsWith(prefix + "/")).map(([, h]) => h))
                  : new Set<string>();
                const chipUrl = repoUrl
                  || (kidHosts.size === 1 ? `https://${[...kidHosts][0]}/${prefix}` : "");
                const chipCls = "max-w-full justify-self-end overflow-hidden rounded-full border border-line bg-bg px-2.25 py-px font-mono text-[11px] text-ellipsis whitespace-nowrap text-dim max-[640px]:justify-self-start";
                let body = hl(esc(m ? m[2] : l), query);
                if (repoUrl) body = linkHashes(body, repoUrl);
                return (
                  <div key={j} className="grid grid-cols-[130px_1fr] items-baseline gap-3 py-1.25 max-[640px]:grid-cols-1 max-[640px]:gap-0.5 max-[640px]:py-2">
                    {m && (chipUrl
                      ? <a href={chipUrl} target="_blank" rel="noopener" title={prefix}
                           className={chipCls + " hover:border-gold-dim hover:text-ink"}>
                          {prefix.split("/").pop()}
                        </a>
                      : <span title={prefix} className={chipCls}>{prefix.split("/").pop()}</span>)}
                    <RawHtml tag="span" className={m ? "text-base" : "col-span-full text-base"}
                             html={body} />
                  </div>
                );
              })
            : <RawHtml tag="span" html={hl(esc(d.body), query)} />}
        </DayCard>
      )) : <Nothing>no matches.</Nothing>}
    </>
  );
}
