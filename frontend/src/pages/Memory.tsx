/* memory: a tree of pages keyed by path, on a quiet ledger rail — search
   above, one editable page right (livemd, behind one global lock). The
   page is static: the rail scrolls on its own and the content side is the
   other scroll region, under a permanent heading. The url always names
   what's on screen: /memory/<path>. The phone has its own read-only view. */

import { Fragment, useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { Check, ChevronRight, Copy, Maximize2, Minimize2, Trash2 } from "lucide-react";
import { post, type MemPage } from "@/api/client";
import { useDash } from "@/api/dash";
import { grpColor } from "@/lib/format";
import { LockButton, Meter, Nothing } from "@/components/bits";
import { HitCard, RailRow, RailSearch, SectionHead } from "@/components/ledger";
import { useDraft } from "@/hooks/useDraft";
import { useLock } from "@/hooks/useLock";
import { useRail } from "@/hooks/useRail";
import LiveMd from "@/components/editor/LiveMd";
import { Button } from "@/components/ui/button";
import { cn, copyText } from "@/lib/utils";
import {
  buildMemoryTree, countPages, findMemoryNode, memoryTitle, parentPath, resolveMemoryPath,
  type MemoryNode,
} from "@/lib/memory";

const WIDE_KEY = "slate.memory-wide";
const TREE_KEY = "slate.memory-tree";

/* the rail is a ledger: one flush left edge, ink weight for state, a
   right-hand numeral column, no background washes. A top-level node with
   children is a section head; every other node is a row, its children
   indented behind a guide line. A node that is a page opens on click;
   an implicit one only folds. Ink carries the level: a project's row
   (under a section, or under a group with no page of its own) is dim,
   a subpage's row — one nested under a page — faint. */
function TreeRow({ n, depth, sub, open, path, pick, toggle }: {
  n: MemoryNode; depth: number; sub?: boolean;
  open: Record<string, boolean>; path: string;
  pick: (p: string) => void; toggle: (k: string, dflt: boolean) => void;
}) {
  const exp = (open[n.path] ?? depth === 0) && n.kids.length > 0;
  const active = n.path === path;
  if (depth === 0 && n.kids.length) return (
    <div className="mt-6 first:mt-0">
      <SectionHead hue={grpColor(n.name)} label={n.name} open={exp} count={countPages(n)} active={active}
                   onToggle={() => toggle(n.path, true)} onSelect={n.page && (() => pick(n.path))} />
      {exp && n.kids.map(k => <TreeRow key={k.path} n={k} depth={1} open={open} path={path} pick={pick} toggle={toggle} />)}
    </div>
  );
  return (
    <div>
      <RailRow active={active} sub={sub} onClick={() => n.page ? pick(n.path) : toggle(n.path, false)}
               right={n.kids.length > 0 && (
                 <button onClick={() => toggle(n.path, false)} title={exp ? "collapse" : "expand"}
                         className="flex flex-none cursor-pointer items-center gap-1 py-[5px] pr-0.5 text-faint transition-colors hover:text-ink">
                   <span className="font-mono text-[10.5px]">{countPages(n)}</span>
                   <ChevronRight className={cn("size-3 transition-transform", exp && "rotate-90")} />
                 </button>)}>
        {n.name}
      </RailRow>
      {exp && (
        <div className="mb-1.5 ml-[13px] border-l border-line-soft">
          {n.kids.map(k => <TreeRow key={k.path} n={k} depth={depth + 1} sub={!!n.page} open={open} path={path} pick={pick} toggle={toggle} />)}
        </div>
      )}
    </div>
  );
}

export default function Memory() {
  const { data, api } = useDash();
  const nav = useNavigate();
  const { search } = useLocation();
  const splat = useParams()["*"] || "";

  // ---- derived selection (empty-safe while data loads): the page the url
  // names, else the first page under that path, else the first page
  const mem = data?.memory ?? [];
  const tree = buildMemoryTree(mem);
  const asked = splat.split("/").filter(Boolean).map(decodeURIComponent).join("/");
  const path = mem.some(m => m.path === asked) ? asked
             : (mem.find(m => m.path.startsWith(asked + "/")) ?? mem[0])?.path ?? "";
  const cur = mem.find(m => m.path === path);
  const node = findMemoryNode(tree, path);

  const [wide, setWide] = useState(() => localStorage.getItem(WIDE_KEY) === "1");
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"all" | "top" | "here">("all");
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(TREE_KEY) || "{}"); } catch { return {}; }
  });
  const rail = useRail();

  // delete arms on the first click and fires on the second — the page and
  // everything under it go, so a lone misclick must not be enough
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(false), [path]);

  const { locked } = useLock();
  const [copied, setCopied] = useState(false);

  // autosave through the store's own wall; a refusal (the cap) shows
  // instead of silently dropping the keystrokes
  const { content, edit, err } = useDraft(path, cur?.content ?? "",
                                          text => post("/api/memory", { path, content: text }));

  // selecting a page reveals its ancestors in the tree (they stay collapsible after)
  useEffect(() => {
    if (!path) return;
    setOpen(o => {
      const n = { ...o };
      const segs = path.split("/");
      for (let i = 1; i < segs.length; i++) n[segs.slice(0, i).join("/")] = true;
      localStorage.setItem(TREE_KEY, JSON.stringify(n));
      return n;
    });
  }, [path]);

  if (!data) return null;
  if (!mem.length) return <Nothing>no memory yet.</Nothing>;

  // canonicalize (replace, so normalization never makes a history entry)
  const canonical = `/memory/${path}`;
  if (decodeURI(location.hash.split("?")[0].slice(1)) !== canonical)
    return <Navigate to={{ pathname: canonical, search }} replace />;

  const pick = (p: string) => nav(`/memory/${p}`);

  const toggleWide = () => setWide(w => { localStorage.setItem(WIDE_KEY, w ? "0" : "1"); return !w; });
  const copy = () => copyText(content).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }).catch(() => {});
  const beneath = node ? countPages(node) : 0;
  const nuke = () => {
    if (locked) return;
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 2500);
      return;
    }
    api("/api/memory/rm", { path }).then(() => nav("/memory"));
  };

  const resolve = (url: string) => resolveMemoryPath(mem, path, url);
  const onLink = (url: string) => {
    const t = resolve(url);
    if (t) { nav(t); return true; }
    // absolute targets take the default rules; a bare name resolving
    // nowhere is never a web URL — swallow it
    return !/^(https?:|mailto:|#|\/)/.test(url);
  };
  // the href its rendered <a> carries, so right-click open-in-new-tab works
  const hrefFor = (url: string) => {
    const t = resolve(url);
    return t ? `#${t}` : null;
  };

  const toggle = (k: string, dflt: boolean) => setOpen(o => {
    const n = { ...o, [k]: !(o[k] ?? dflt) };
    localStorage.setItem(TREE_KEY, JSON.stringify(n));
    return n;
  });

  // top-level leaves first, then the sections
  const tops = [...tree.filter(n => !n.kids.length), ...tree.filter(n => n.kids.length)];

  // ---- search: everything client-side, the whole store is already here
  const ql = q.trim().toLowerCase();
  const top = path.split("/")[0];
  const under = (root: string) => (m: MemPage) => m.path === root || m.path.startsWith(root + "/");
  const scopes: { id: typeof scope; label: string; test: (m: MemPage) => boolean }[] = [
    { id: "all", label: "everywhere", test: () => true },
    ...(path.includes("/") ? [{ id: "top" as const, label: `${top}/*`, test: under(top) }] : []),
    { id: "here", label: node?.kids.length ? `${path}/*` : path, test: under(path) },
  ];
  const sc = scopes.find(s => s.id === scope) ?? scopes[0];
  const hits = !ql ? [] : mem.map(m => {
    if (!sc.test(m)) return null;
    const nameHit = m.path.toLowerCase().includes(ql);
    const lines = m.content.split("\n").filter(l => l.toLowerCase().includes(ql));
    return nameHit || lines.length
      ? { m, lines: lines.slice(0, 3), more: Math.max(0, lines.length - 3) }
      : null;
  }).filter((h): h is NonNullable<typeof h> => !!h);

  const cap = data.memory_page_limit;
  const n = [...content].length;
  const segs = path.split("/");

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="flex flex-none flex-col pr-4" style={{ width: rail.width }}>
        <RailSearch value={q} onChange={setQ} placeholder="search memory" />
        {ql && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {scopes.map(s => (
              <button key={s.id} onClick={() => setScope(s.id)}
                      className={cn("cursor-pointer rounded-md border px-2 py-0.5 font-mono text-[10.5px] tracking-[.04em] transition-colors",
                                    sc.id === s.id ? "border-gold-dim bg-hover text-gold"
                                                   : "border-line-soft text-faint hover:bg-hover hover:text-dim")}>
                {s.label}
              </button>
            ))}
          </div>
        )}
        {/* -mr/pr: the scrollbar rides the rail's edge, at the divider */}
        <div className="-mr-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-4 pb-8 [scrollbar-width:thin]">
          {tops.map(t => <TreeRow key={t.path} n={t} depth={0} open={open} path={path} pick={pick} toggle={toggle} />)}
        </div>
      </nav>
      {rail.handle}

      <section className="flex min-h-0 min-w-0 flex-1 flex-col pl-5">
        {/* the permanent heading — the content side scrolls beneath it */}
        <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line-soft pb-3">
          {ql ? (
            <span className="font-mono text-[11px] tracking-[.04em] text-faint">
              {hits.length} page{hits.length === 1 ? "" : "s"} match “{q.trim()}” in {sc.label}
            </span>
          ) : (
            /* breadcrumbs: one font and size throughout, color carries the
               hierarchy — ancestors dim, clickable where a page exists at
               that path, the current segment ink */
            <span className="flex min-w-0 items-baseline gap-2 font-display text-[16px] leading-none">
              {segs.map((s, i) => {
                const p = segs.slice(0, i + 1).join("/");
                return (
                  <Fragment key={p}>
                    {i > 0 && <span className="text-faint">/</span>}
                    {i === segs.length - 1
                      ? <span className="min-w-0 truncate text-ink">{s}</span>
                      : mem.some(m => m.path === p)
                        ? <button onClick={() => pick(p)}
                                  className="min-w-0 cursor-pointer truncate text-left text-dim transition-colors hover:text-gold">{s}</button>
                        : <span className="min-w-0 truncate text-dim">{s}</span>}
                  </Fragment>
                );
              })}
            </span>
          )}
          <span className="ml-auto flex flex-none flex-wrap items-center gap-x-3 gap-y-1">
            {!ql && (
              <span className="font-mono text-[11px] tracking-[.04em] text-faint">
                modified {cur?.updated || "—"} · read {cur?.accessed || "—"}
              </span>
            )}
            {!ql && (
              <span className="flex items-center gap-2 font-mono text-[11px] text-faint" title="hard cap">
                <span className={cn(n > cap && "text-overdue")}>{n.toLocaleString()}/{cap.toLocaleString()}</span>
                <Meter frac={n / cap} className="h-1.5 w-16"
                       color={n > cap ? "var(--color-overdue)" : undefined} />
              </span>
            )}
            <span className="flex items-center gap-0.5">
              <Button variant="ghost" size="icon-sm" title={wide ? "prose width" : "full width"}
                      onClick={toggleWide} className="size-8">
                {wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </Button>
              <LockButton />
              <Button variant="ghost" size="icon-sm" onClick={copy} title="copy" className="size-8">
                {copied ? <Check className="size-4 text-gold" /> : <Copy className="size-4" />}
              </Button>
              <Button variant="ghost" size="icon-sm" title="export pdf" className="size-8"
                      onClick={() => location.assign(`/api/memory/pdf?path=${encodeURIComponent(path)}`)}>
                <span className="font-mono text-[10px] font-medium tracking-[.06em]">PDF</span>
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={nuke}
                      disabled={locked}
                      title={armed
                        ? `click again — deletes ${path}${beneath > 0 ? ` and the ${beneath} page${beneath === 1 ? "" : "s"} under it` : ""}`
                        : "delete page"}
                      className="size-8">
                <Trash2 className={cn("size-4", armed && "text-overdue")} />
              </Button>
            </span>
          </span>
        </div>
        {err && !ql && (
          <div className="flex-none pt-2 font-mono text-[11px] text-overdue">{err}</div>
        )}
        {/* -mr/pr against Shell's px-8: the scrollbar rides the window edge */}
        <div className="-mr-8 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-8 [scrollbar-width:thin]">
          <div className={cn("mx-auto w-full pt-5 pb-24", !wide && "max-w-[880px]")}>
            {ql ? (
              <>
                {hits.map(h => (
                  <HitCard key={h.m.path} q={ql} lines={h.lines} more={h.more}
                           head={parentPath(h.m.path)
                             ? <>{parentPath(h.m.path)}<span className="text-faint">/{h.m.path.split("/").pop()}</span></>
                             : h.m.path}
                           onClick={() => { pick(h.m.path); setQ(""); }} />
                ))}
                {!hits.length && <Nothing>nothing matches.</Nothing>}
              </>
            ) : (
              /* keyed by page: LiveMd is uncontrolled — navigating to
                 another page must remount it or the old text lingers */
              <>
                <LiveMd key={path} value={content} onChange={edit} readOnly={locked}
                        onLink={onLink} hrefFor={hrefFor} className="min-h-48" />
                {/* a page always lists what sits beneath it — generated from
                    the tree, each child by its first line, never hand-written */}
                {node && node.kids.length > 0 && (
                  <div className="mt-10 border-t border-line pt-4">
                    <span className="font-mono text-[11px] font-medium tracking-[.16em] uppercase text-faint">subpages</span>
                    <ul className="mt-2 flex flex-col">
                      {node.kids.map(k => (
                        <li key={k.path}>
                          <button onClick={() => pick(k.path)}
                                  className="flex w-full cursor-pointer items-baseline gap-3 rounded-md px-2 py-1.5 text-left hover:bg-hover">
                            {/* the child's title is the row — the rule makes it descriptive;
                                an implicit node has only its name */}
                            <span className={cn("min-w-0 flex-1 truncate text-[14px]", k.page ? "text-ink" : "text-dim")}>
                              {k.page ? memoryTitle(k.page.content) : `${k.name} — no page of its own`}
                            </span>
                            {k.kids.length > 0 && (
                              <span className="flex-none font-mono text-[10.5px] text-faint">{countPages(k)} under it</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
