/* App chrome — desktop only (the phone mounts PhoneShell instead):
   sidebar (collapsible), per-view title, file-viewer overlay. Views
   render into the outlet. */

import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Blocks, Brain, Feather, Folder, ListChecks, Moon, PanelLeft, Sun,
} from "lucide-react";
import { useDash } from "@/api/dash";
import FileViewer from "@/components/FileViewer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TITLES: Record<string, [string, string]> = {
  notes: ["the ", "storyline"],
  tasks: ["what got ", "done"],
  brain: ["what's ", "true"],
};

const NAV_ITEMS: [string, string, typeof Blocks][] = [
  ["nest", "nest", Blocks],
  ["notes", "notes", Feather],
  ["tasks", "tasks", ListChecks],
  ["brain", "brain", Brain],
  ["memory", "memory", Folder],
];

export default function Shell() {
  const { data } = useDash();
  const [mini, setMini] = useState(() => localStorage.getItem("slate.sidebar") === "mini");
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light");
  const path = useLocation().pathname;
  const view = path.split("/")[1];

  const counts: Record<string, string | number> = {
    nest: data?.nest || "",
    notes: data?.notes.length ?? "",
    tasks: data ? data.tasks.reduce((a, d) => a + d.body.split("\n").filter(l => l.trim()).length, 0) : "",
    brain: data ? (data.brain.length / 1000).toFixed(1) + "k" : "",
    memory: data?.memory.length ?? "",
  };

  const toggleMini = () => {
    localStorage.setItem("slate.sidebar", mini ? "full" : "mini");
    setMini(!mini);
  };

  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  useEffect(() => {
    const dark = theme === "dark";
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.style.background = dark ? "#16130f" : "#fbfaf9";
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#16130f" : "#fbfaf9");
    localStorage.setItem("slate.theme", theme);
  }, [theme]);

  useEffect(() => {
    const label = NAV_ITEMS.find(([path]) => path === view)?.[1];
    document.title = view === "nest" || !label ? "slate" : `slate · ${label}`;
  }, [view]);

  const [t1, t2] = TITLES[view] ?? ["", ""];
  return (
    // slate-shell: the nest's full-screen mode targets this grid and its nav
    // from index.css (body.nest-full), so the board can take the viewport
    <div className={cn("slate-shell grid min-h-screen transition-[grid-template-columns] duration-250",
                         mini ? "grid-cols-[64px_1fr]" : "grid-cols-[232px_1fr]")}>
      <nav className={cn(
        "flex flex-col border-r border-line-soft bg-linear-180 from-raise to-bg to-60% pt-6",
        "sticky top-0 z-50 h-screen")}>
        <Link to="/nest">
          <div className={cn("font-emphasis text-[34px] font-normal italic",
                               mini ? "pb-1.5 text-center" : "px-7 pb-1.5")}>
            s{!mini && "late"}<span className="text-gold">.</span>
          </div>
          {!mini && <div className="px-7 pb-7.5 font-mono text-[10.5px] tracking-[.14em] uppercase text-faint">
            shared state
          </div>}
        </Link>
        {NAV_ITEMS.map(([path, label, Icon]) => (
          <NavLink key={path} to={`/${path}`} title={mini ? label : undefined}
            className={({ isActive }) => cn(
              "flex items-center gap-3 border-l-2 py-2.25 text-base transition-colors",
              mini ? "justify-center px-0" : "px-7",
              isActive
                ? "border-gold bg-raise text-ink"
                : "border-transparent text-dim hover:bg-hover hover:text-ink")}>
            <Icon size={17} strokeWidth={1.7} className="flex-none opacity-85" />
            <span className={cn("flex-1", mini && "hidden")}>{label}</span>
            <span className={cn("font-mono text-[11px] text-faint", mini && "hidden")}>{counts[path]}</span>
          </NavLink>
        ))}
        {!mini && (
          <div className="mt-auto px-7 pt-5 pb-4 font-mono text-[11px] leading-8 text-faint">
            <b className="font-medium text-dim">{data?.today}</b><br />
            day runs 6am–6am<br />
            wet ink → stone
          </div>
        )}
        <div className={cn(
          "flex border-t border-line-soft px-4 pt-3 pb-4",
          mini ? "mt-auto flex-col items-center gap-1" : "items-center justify-between",
        )}>
          <Button variant="ghost" size="icon-sm" onClick={toggleTheme}
            aria-label={`switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            {theme === "dark"
              ? <Sun size={17} strokeWidth={1.7} />
              : <Moon size={17} strokeWidth={1.7} />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={toggleMini}
            aria-label={mini ? "expand" : "collapse"} title={mini ? "expand" : "collapse"}>
            <PanelLeft size={17} strokeWidth={1.7} />
          </Button>
        </div>
      </nav>

      {/* min-w-0: main is a flex child — without it, one long nowrap line
          anywhere sets the page's min width and the whole layout overflows
          sideways. flex-col: the grid stretches main to the viewport floor,
          so a page that wants the floor is just flex-1. */}
      <main className={cn("flex w-full min-w-0 flex-col px-8",
                            // the nest board always fits the window — no
                            // scroll, cells squish instead; half the usual
                            // edge padding, the board owns the room
                            view === "nest" ? "h-dvh px-3 pt-3 pb-2"
                              // memory is static: the page fits the
                              // viewport and scrolls inside
                              : view === "memory" ? "h-dvh pt-8 pb-0"
                                : "pt-10 pb-20",
                            // canvas: the page centers its own prose column
                            // and its wide toggle wants the whole width
                            // memory: rail left, centered column + wide toggle
                            view === "nest" || view === "canvas" || view === "memory"
                              ? "max-w-none" : "mx-auto max-w-[1040px]")}>
        {/* the nest is a board, not a document — no big title, full height;
            memory gives the room to the content instead */}
        {t1 && (
          <header className="mb-8.5 flex flex-wrap items-end justify-between gap-6">
            <h1 className="font-display text-[44px] leading-[1.05] font-medium tracking-[-.038em] [text-wrap:balance]">
              {t1}<em className="italic text-gold">{t2}</em>
            </h1>
          </header>
        )}
        <Outlet />
      </main>
      <FileViewer />
    </div>
  );
}
